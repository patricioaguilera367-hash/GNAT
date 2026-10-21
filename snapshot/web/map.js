/* Independent canvas WebMercator viewer. No mapping SDK/API key required.
   Ordinary interactive OSM tiles only (no offline bulk download).
   Authorized georeferenced captures are loaded from this local server. */
const MAX_LAT = 85.05112878;
const HALF_MERC = 20037508.342789244;
export const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const RAD=Math.PI/180;
function mercatorFromGeo(lon,lat) {
  lat=clamp(lat,-MAX_LAT,MAX_LAT);
  const s=Math.sin(lat*RAD);
  return [(lon+180)/360, 0.5-Math.log((1+s)/(1-s))/(4*Math.PI)];
}
function geoFromMercator(x,y) {
  return [x*360-180, Math.atan(Math.sinh(Math.PI*(1-2*y)))/RAD];
}
function mercatorMetresToWorld(x,y) {
  return [(x+HALF_MERC)/(2*HALF_MERC), 0.5-y/(2*HALF_MERC)];
}

const COLORS={'':'#e24040','Verde':'#198754','Naranjo':'#ed8915','Azul':'#2775df'};
export const matchesBlock = (point, block) => !block || (point.bloques||[]).includes(block);
export const pointLabel = (point, numbers, codes) => [numbers?String(point.numero):'', codes?point.codigo:''].filter(Boolean).join(' · ');
export const layerProviders = [
  {id:'captures',name:'Capturas locales',available:true},
  {id:'wmts',name:'WMTS autenticado',available:false,reason:'Contrato y acceso no validados'}
];
export class LocalMap {
  constructor(canvas, {onPick}={}) {
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.view={lon:-72.6,lat:-38.74,zoom:10};
    this.points=[];this.captures=[];this.active=null;
    this.showOSM=false;this.showNumbers=true;this.showCodes=false;this.showCaptures=true;this.labels='cerca';
    this.onPick=onPick||(()=>{});
    this.tiles=new Map();this.captureImages=new Map();
    this.pixelRatio=1;this.width=1;this.height=1;
    this.pendingDraw=false;
    this.drag=null;
    this.installEvents();
    const observer = new ResizeObserver(()=>this.resize());
    observer.observe(canvas.parentElement);
    this.observer=observer;
    this.resize();
  }
  resize(){
    const rect=this.canvas.parentElement.getBoundingClientRect();
    this.width=Math.max(100,Math.floor(rect.width));
    this.height=Math.max(100,Math.floor(rect.height));
    this.pixelRatio=Math.min(window.devicePixelRatio||1,2);
    this.canvas.width=Math.round(this.width*this.pixelRatio);
    this.canvas.height=Math.round(this.height*this.pixelRatio);
    this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';
    this.render();
  }
  worldSize(){return 256*Math.pow(2,this.view.zoom);}
  centerWorld(){return mercatorFromGeo(this.view.lon,this.view.lat);}
  toScreen(lon,lat){
    const [x,y]=mercatorFromGeo(lon,lat),[cx,cy]=this.centerWorld(),scale=this.worldSize();
    return [this.width/2+(x-cx)*scale,this.height/2+(y-cy)*scale];
  }
  screenToGeo(sx,sy){
    const [cx,cy]=this.centerWorld(),scale=this.worldSize();
    return geoFromMercator(cx+(sx-this.width/2)/scale,cy+(sy-this.height/2)/scale);
  }
  setView(lon,lat,zoom=this.view.zoom){
    this.view={lon:clamp(lon,-180,180),lat:clamp(lat,-MAX_LAT,MAX_LAT),zoom:clamp(zoom,2,20)};
    this.render();
  }
  setZoomAt(nextZoom,sx,sy){
    const before=this.screenToGeo(sx,sy);
    this.view.zoom=clamp(nextZoom,2,20);
    const after=this.screenToGeo(sx,sy);
    const centerWorld=this.centerWorld();
    const [bx,by]=mercatorFromGeo(...before),[ax,ay]=mercatorFromGeo(...after);
    const corrected=geoFromMercator(centerWorld[0]+bx-ax,centerWorld[1]+by-ay);
    this.setView(...corrected,this.view.zoom);
  }
  fitGeo(points, padding=55) {
    if(!points.length)return;
    const xy=points.map(p=>mercatorFromGeo(p.longitud,p.latitud));
    this.fitWorld(xy,padding);
  }
  fitBounds3857(bounds,padding=50){
    const a=mercatorMetresToWorld(bounds[0],bounds[1]),b=mercatorMetresToWorld(bounds[2],bounds[3]);
    this.fitWorld([a,b],padding);
  }
  fitWorld(xy,padding=55){
    const xs=xy.map(v=>v[0]), ys=xy.map(v=>v[1]);
    const [minx,maxx,miny,maxy]=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
    const maxAvailableX=Math.max(100,this.width-padding*2),maxAvailableY=Math.max(100,this.height-padding*2);
    const available=Math.min(maxAvailableX/Math.max(0.000001,maxx-minx),maxAvailableY/Math.max(0.000001,maxy-miny));
    const zoom=clamp(Math.log2(available/256),2,18.5);
    const center=geoFromMercator((minx+maxx)/2,(miny+maxy)/2);
    this.setView(...center,zoom);
  }
  setPoints(points){this.points=points;this.render();}
  setAssetGeometry(geometry){this.assetGeometry=geometry;this.render();}
  fitAssetGeometry(){
    const g=this.assetGeometry;if(!g)return;
    const positions=g.type==='Point'?[g.coordinates]:g.type==='LineString'?g.coordinates:g.coordinates.flat();
    this.fitGeo(positions.map(([longitud,latitud])=>({longitud,latitud})));
  }
  drawAssetOverlay(){
    const g=this.assetGeometry;if(!g)return;
    const ctx=this.ctx;ctx.save();ctx.strokeStyle='#783eaf';ctx.fillStyle='#783eaf';ctx.lineWidth=3;ctx.setLineDash([7,4]);
    if(g.type==='Point'){
      const [x,y]=this.toScreen(...g.coordinates);ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.stroke();
    } else {
      const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
      for(const line of lines){ctx.beginPath();line.forEach((p,i)=>{const xy=this.toScreen(...p);if(i)ctx.lineTo(...xy);else ctx.moveTo(...xy);});ctx.stroke();}
    }
    ctx.restore();
  }
  setCaptures(captures){this.captures=captures;this.render();}
  setOptions(opts){Object.assign(this,opts);this.render();}
  highlight(id){this.active=id;this.render();}
  installEvents(){
    this.canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag={x:e.offsetX,y:e.offsetY,origin:this.centerWorld(),moved:false};
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove',e=>{
      if(!this.drag)return;
      const dx=e.offsetX-this.drag.x,dy=e.offsetY-this.drag.y;
      if(Math.abs(dx)+Math.abs(dy)>5)this.drag.moved=true;
      const scale=this.worldSize();
      const [cx,cy]=this.drag.origin;
      const geo=geoFromMercator(cx-dx/scale,cy-dy/scale);
      this.view.lon=clamp(geo[0],-180,180);this.view.lat=clamp(geo[1],-MAX_LAT,MAX_LAT);
      this.render();
    });
    this.canvas.addEventListener('pointerup',e=>{
      const moved=this.drag?.moved;
      this.drag=null;this.canvas.classList.remove('dragging');
      if(!moved){
        const p=this.hit(e.offsetX,e.offsetY);
        if(p)this.onPick(p);
      }
    });
    this.canvas.addEventListener('pointercancel',()=>{this.drag=null;this.canvas.classList.remove('dragging');});
    this.canvas.addEventListener('wheel',e=>{
      e.preventDefault();
      this.setZoomAt(this.view.zoom+(e.deltaY<0?0.5:-0.5),e.offsetX,e.offsetY);
    },{passive:false});
    this.canvas.addEventListener('dblclick',e=>{
      e.preventDefault();this.setZoomAt(this.view.zoom+1,e.offsetX,e.offsetY);
    });
  }
  hit(x,y){
    let chosen=null,best=15*15;
    for(const p of this.points){
      const [px,py]=this.toScreen(p.longitud,p.latitud);
      const dist=(x-px)**2+(y-py)**2;
      if(dist<best){best=dist;chosen=p;}
    }
    return chosen;
  }
  getTile(z,x,y){
    const key=z+'/'+x+'/'+y;
    if(this.tiles.has(key))return this.tiles.get(key);
    const img=new Image();const record={img,status:'loading'};
    this.tiles.set(key,record);
    img.onload=()=>{record.status='ready';this.render();};
    img.onerror=()=>{record.status='error';this.render();};
    // This is ordinary interactive tile access, not batch/offline prefetch.
    img.src=`https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    if(this.tiles.size>350){
      const old=[...this.tiles.keys()].slice(0,100);
      for(const k of old)this.tiles.delete(k);
    }
    return record;
  }
  render(){
    if(this.pendingDraw)return;
    this.pendingDraw=true;
    requestAnimationFrame(()=>{this.pendingDraw=false;this.draw();});
  }
  draw(){
    const ctx=this.ctx,dpr=this.pixelRatio,w=this.width,h=this.height;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    ctx.fillStyle='#eef3f0';ctx.fillRect(0,0,w,h);
    const [cx,cy]=this.centerWorld(); const scale=this.worldSize();
    if(this.showOSM){
      const z=Math.floor(this.view.zoom),num=2**z,factor=2**(this.view.zoom-z),tile=256*factor;
      const tx=cx*num,ty=cy*num;
      const startX=Math.floor(tx-w/(2*tile))-1,stopX=Math.ceil(tx+w/(2*tile))+1;
      const startY=Math.max(0,Math.floor(ty-h/(2*tile))-1),stopY=Math.min(num-1,Math.ceil(ty+h/(2*tile))+1);
      for(let y=startY;y<=stopY;y++)for(let x=startX;x<=stopX;x++){
        const wrap=(x%num+num)%num;
        const screenX=w/2+(x-tx)*tile,screenY=h/2+(y-ty)*tile;
        const rec=this.getTile(z,wrap,y);
        if(rec.status==='ready')ctx.drawImage(rec.img,screenX,screenY,tile+.7,tile+.7);
      }
    } else {
      ctx.lineWidth=1;ctx.strokeStyle='#dce7e1';
      for(let x=0;x<w;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
      for(let y=0;y<h;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    }
    if(this.showCaptures){
      const sorted=[...this.captures].sort((a,b)=>{
        const sa=(a.bounds3857[2]-a.bounds3857[0])/a.width;
        const sb=(b.bounds3857[2]-b.bounds3857[0])/b.width;
        return sb-sa;
      });
      for(const capture of sorted){
        const b=capture.bounds3857;
        const [ax,ay]=mercatorMetresToWorld(b[0],b[3]);
        const [bx,by]=mercatorMetresToWorld(b[2],b[1]);
        const left=w/2+(ax-cx)*scale,top=h/2+(ay-cy)*scale;
        const cw=(bx-ax)*scale,ch=(by-ay)*scale;
        if(left>w||top>h||left+cw<0||top+ch<0)continue;
        let image=this.captureImages.get(capture.id);
        if(!image){
          image=new Image();this.captureImages.set(capture.id,image);
          image.onload=()=>this.render();
          image.src='/capturas/'+encodeURIComponent(capture.archivo);
        }
        if(image.complete&&image.naturalWidth>0){ctx.drawImage(image,left,top,cw,ch);}
      }
    }
    this.drawAssetOverlay();
    ctx.textBaseline='middle';ctx.textAlign='center';
    for(const p of this.points){
      const [x,y]=this.toScreen(p.longitud,p.latitud);
      if(x< -100||y< -100||x>w+100||y>h+100)continue;
      const selected=this.active===p.id;
      const radius=selected?9:6;
      ctx.beginPath();
      if(p.clase==='apertura'){
        ctx.moveTo(x-radius,y-radius);ctx.lineTo(x+radius,y+radius);
        ctx.moveTo(x+radius,y-radius);ctx.lineTo(x-radius,y+radius);
        ctx.strokeStyle='#fff';ctx.lineWidth=selected?6:5;ctx.stroke();
        ctx.strokeStyle=COLORS[p.supervisor]||COLORS[''];ctx.lineWidth=selected?4:3;ctx.stroke();
      } else {
        ctx.arc(x,y,radius,0,Math.PI*2);
        ctx.fillStyle=COLORS[p.supervisor]||COLORS[''];ctx.fill();
        ctx.strokeStyle=selected?'#20334a':'#fff';ctx.lineWidth=selected?3:1.6;ctx.stroke();
      }
      if(this.labels==='siempre'||(this.labels==='cerca'&&this.view.zoom>=13.2)){
        const label=pointLabel(p,this.showNumbers,this.showCodes);
        ctx.font='bold 12px Arial';ctx.lineJoin='round';ctx.lineWidth=3.8;
        ctx.strokeStyle='#102239';ctx.strokeText(label,x,y-15);
        ctx.fillStyle='#fff';ctx.fillText(label,x,y-15);
      }
    }
    const z=this.view.zoom.toFixed(1);
    const el=document.getElementById('map-coordinates');
    if(el)el.textContent=`Zoom ${z}  ·  ${this.view.lat.toFixed(5)}, ${this.view.lon.toFixed(5)}`;
  }
}
