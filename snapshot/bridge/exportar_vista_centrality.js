/*
 * Puente local V5: exporta SOLO la vista ACTUAL del mapa Centrality
 * como un JSON con PNG + extensión EPSG:3857.
 * Sin llamadas a una API privada, sin lectura de cookies/tokens,
 * sin peticiones adicionales, sin recorrido masivo.
 * Requiere acceso autorizado a la cartografía y permiso de conservarla.
 * Cómo usar: Centrality > Mapas > F12 > Sources > Snippets.
 */
(async () => {
  'use strict';
  const frame=document.querySelector('iframe#content');
  const w=frame?.contentWindow, map=w?.webMap_?.map;
  if (!map) {console.error('Abre Centrality > Mapas antes de ejecutar.');return;}
  const doc=w.document;
  const view=map.getView();
  const size=map.getSize();
  if(!size?.[0]||!size?.[1])throw Error('Mapa no disponible');
  if(Math.abs(view.getRotation?.()||0)>0.000001){
    console.error('Pon el mapa con orientación norte antes de exportar.');return;
  }
  // Use view extent; no network requests triggered intentionally.
  const bounds=view.calculateExtent(size);
  let output=doc.createElement('canvas');
  output.width=Math.round(size[0]);output.height=Math.round(size[1]);
  const ctx=output.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,output.width,output.height);
  const viewport=map.getViewport(), canvases=[...viewport.querySelectorAll('.ol-layer canvas, canvas.ol-layer')]
    .filter(c=>c.width>0&&c.height>0);
  if(!canvases.length){console.error('No se encontraron lienzos OpenLayers para capturar.');return;}
  let composed=0;
  for(const canvas of canvases){
    const owner=canvas.closest('.ol-layer')||canvas.parentElement;
    if(w.getComputedStyle(canvas).display==='none')continue;
    if(owner&&w.getComputedStyle(owner).display==='none')continue;
    ctx.save();
    const alpha=Number.parseFloat(w.getComputedStyle(owner||canvas).opacity||'1');
    ctx.globalAlpha=Number.isFinite(alpha)?alpha:1;
    const cssTransform=w.getComputedStyle(canvas).transform;
    if(cssTransform&&cssTransform!=='none'){
      const m=new w.DOMMatrix(cssTransform);
      ctx.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);
    }else{
      const r=canvas.getBoundingClientRect(),origin=viewport.getBoundingClientRect();
      ctx.setTransform(r.width/canvas.width,0,0,r.height/canvas.height,r.left-origin.left,r.top-origin.top);
    }
    try{ctx.drawImage(canvas,0,0);composed++;}catch(e){console.warn('Se omitió una capa no capturable',e.message);}
    ctx.restore();
  }
  if(!composed){console.error('No fue posible componer ninguna capa.');return;}
  let dataUrl;
  try{dataUrl=output.toDataURL('image/png');}
  catch(e){console.error('El navegador bloqueó la captura por seguridad CORS:',e.message);return;}
  if(dataUrl==='data:,'){console.error('No se generó imagen.');return;}
  const payload={format:'centrality-local-capture-v1',projection:'EPSG:3857',
    bounds3857:bounds,width:output.width,height:output.height,
    zoom:view.getZoom(),capturedAt:new Date().toISOString(),imageDataUrl:dataUrl};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  if(blob.size>16*1024*1024){console.error('Vista demasiado grande para piloto. Acerca o reduce ventana.');return;}
  const url=w.URL.createObjectURL(blob);
  const a=doc.createElement('a');a.href=url;
  a.download='centrality_vista_'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.json';
  doc.body.appendChild(a);a.click();a.remove();
  w.setTimeout(()=>w.URL.revokeObjectURL(url),10000);
  console.log('Captura V5 exportada:',output.width,'x',output.height,
    'zoom',view.getZoom(),'capas canvas',composed,'. Importa el JSON en la pestaña Mosaico de Centrality Local.');
})();
