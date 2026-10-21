import {initGNAT} from './gnat-client.js';
import {LocalMap,matchesBlock} from './map.js';
const $=id=>document.getElementById(id);
const map=new LocalMap($('map'),{onPick:pickPoint});
let points=[],captures=[],filtered=[],focus=null;
const selected=new Set();
const COLORS={'':'#e24040','Verde':'#198754','Naranjo':'#ed8915','Azul':'#2775df'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
function say(msg,error=false){$('message').textContent=msg;$('message').classList.toggle('error',error);}
async function api(path,options={}){
  const resp=await fetch(path,{cache:'no-store',...options});
  let body;try{body=await resp.json();}catch{throw Error('Respuesta no reconocida del servidor local');}
  if(!resp.ok){const error=Error(body.error||`HTTP ${resp.status}`);error.details=body;throw error;}
  return body;
}
async function refreshPoints(){
  const r=await api('/api/points');points=r.items;
  const previous=$('filter-block').value;
  $('filter-block').replaceChildren(new Option('Todos los bloques',''));
  for(const block of [...new Set(points.flatMap(p=>p.bloques||[]))].sort())$('filter-block').add(new Option(block,block));
  if([...$('filter-block').options].some(o=>o.value===previous))$('filter-block').value=previous;
  renderRows();
}
async function refreshCaptures(){
  const r=await api('/api/captures');captures=r.items;map.setCaptures(captures);renderCaptures();
}
function renderRows(){
  const query=$('find').value.trim().toUpperCase();const supervisor=$('filter-supervisor').value;
  filtered=points.filter(p=>{
    const groupOK=!supervisor || (supervisor==='_none'?!p.supervisor:p.supervisor===supervisor);
    return groupOK && matchesBlock(p,$('filter-block').value) && (String(p.numero).includes(query)||p.codigo.toUpperCase().includes(query));
  });
  map.setPoints(filtered);
  const tbody=$('point-rows');tbody.replaceChildren();
  for(const p of filtered){
    const tr=make('tr',p.id===focus?'focused':'');tr.dataset.id=p.id;
    const tdCheck=make('td');const check=make('input');check.type='checkbox';check.checked=selected.has(p.id);check.setAttribute('aria-label','Seleccionar '+p.numero);
    check.addEventListener('click',e=>e.stopPropagation());check.addEventListener('change',()=>{if(check.checked)selected.add(p.id);else selected.delete(p.id);updateSelected();});tdCheck.appendChild(check);tr.appendChild(tdCheck);
    const tdNo=make('td',null,String(p.numero));tr.appendChild(tdNo);
    const tdKind=make('td',null,p.clase==='apertura'?'Apertura':'Recorrido');tr.appendChild(tdKind);
    const tdCode=make('td',null,p.codigo);tdCode.title=p.codigo;tr.appendChild(tdCode);
    const tdSup=make('td');const dot=make('span','square');dot.style.background=COLORS[p.supervisor]||COLORS[''];tdSup.appendChild(dot);tdSup.appendChild(document.createTextNode(p.supervisor||'—'));tr.appendChild(tdSup);
    tr.addEventListener('click',()=>pickPoint(p));tbody.appendChild(tr);
  }
  $('counters').textContent=`${points.length} puntos · ${filtered.length} visibles · ${points.filter(p=>!p.supervisor).length} sin asignar`;
  updateSelected();
}
function updateSelected(){$('selected-count').textContent=selected.size+' seleccionados';}
function pickPoint(p){
  focus=p.id;map.highlight(p.id);
  map.setView(p.longitud,p.latitud,Math.max(map.view.zoom,16));
  $('editor-num').textContent=p.numero;
  $('edit-code').value=p.codigo;$('edit-type').value=p.tipo;
  $('edit-supervisor').value=p.supervisor;
  $('edit-category').value=p.categoria;$('edit-description').value=p.descripcion;
  $('point-editor').classList.remove('hidden');
  document.querySelector('[data-tab=puntos]').click();
  renderRows();
}
function updateTabs(name){
  for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===name);
  for(const s of document.querySelectorAll('.tab-section'))s.classList.toggle('hidden',s.id!=='tab-'+name);
}
for(const b of document.querySelectorAll('[data-tab]'))b.addEventListener('click',()=>updateTabs(b.dataset.tab));
$('toggle-sidebar').addEventListener('click',()=>{$('layout').classList.toggle('collapsed');setTimeout(()=>map.resize(),30);});
$('zoom-in').addEventListener('click',()=>map.setZoomAt(map.view.zoom+1,map.width/2,map.height/2));
$('zoom-out').addEventListener('click',()=>map.setZoomAt(map.view.zoom-1,map.width/2,map.height/2));
$('fit-all').addEventListener('click',()=>{if(filtered.length)map.fitGeo(filtered);else say('No hay puntos visibles.',true);});
$('find').addEventListener('input',renderRows);
$('filter-supervisor').addEventListener('change',renderRows);
$('filter-block').addEventListener('change',renderRows);
$('check-all').addEventListener('click',()=>{const all=filtered.every(p=>selected.has(p.id));for(const p of filtered){if(all)selected.delete(p.id);else selected.add(p.id);}renderRows();});
for(const b of document.querySelectorAll('[data-assign]'))b.addEventListener('click',async()=>{
  if(!selected.size)return say('Marca uno o más puntos en la tabla.',true);
  try{
    const sup=b.dataset.assign;const quantity=selected.size;
    await api('/api/supervisores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected],supervisor:sup})});
    selected.clear();await refreshPoints();say(`${quantity} puntos asignados a ${sup||'Sin supervisor'}.`);
  }catch(e){say(e.message,true);}
});
$('save-point').addEventListener('click',async()=>{
  if(!focus)return;
  const body={codigo:$('edit-code').value,tipo:$('edit-type').value,supervisor:$('edit-supervisor').value,categoria:$('edit-category').value,descripcion:$('edit-description').value};
  try{await api('/api/points/'+focus,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      await refreshPoints();say('Punto actualizado en SQLite.');}
  catch(e){say(e.message,true);}
});
$('import-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    say('Procesando '+file.name+'...');
    const data=await file.arrayBuffer();
    const path='/api/import?filename='+encodeURIComponent(file.name);
    const options={method:'POST',headers:{'Content-Type':'application/octet-stream'},body:data};
    let rsp;
    try{rsp=await api(path,options);}catch(error){
      if(!error.details?.requires_confirmation)throw error;
      if(!confirm(error.message+' ¿Confirmar reemplazo?')){say('Importación cancelada; los puntos no cambiaron.');return;}
      rsp=await api(path+'&confirm_replace=1',options);
    }
    focus=null;selected.clear();$('point-editor').classList.add('hidden');
    await refreshPoints();if(rsp.modo==='reemplazo')map.fitGeo(points);
    say(`${rsp.puntos} puntos ${rsp.modo==='reemplazo'?'importados':'actualizados'}.`+
      (rsp.sin_coincidencia?.length?` ${rsp.sin_coincidencia.length} filas sin coincidencia exacta.`:''));
  }catch(err){say('No se pudo importar: '+err.message,true);}finally{e.target.value='';}
});
$('download-csv').addEventListener('click',()=>{window.location.href='/api/export.csv?kind='+encodeURIComponent($('export-kind').value);});
$('batch-search').addEventListener('click',async()=>{
  const codes=$('batch-codes').value.split(/[\n;,\t]+/).map(v=>v.trim()).filter(Boolean);
  if(!codes.length)return say('Ingresa al menos un código.',true);
  if(codes.length>500)return say('Máximo 500 códigos por búsqueda.',true);
  const types=[];
  if($('type-poste').checked)types.push('poste');
  if($('type-sed').checked)types.push('subestacion');
  if($('type-unclassified').checked)types.push('sin clasificar');
  if(!types.length)return say('Marca al menos un tipo de activo.',true);
  try{
    const out=await api('/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({codes,types})});
    const counts={encontrado:0,ambiguo:0,'no encontrado':0};
    const results=$('batch-results');results.replaceChildren();
    for(const item of out.items){
      counts[item.estado]++;
      const card=make('div','result');
      const line=make('div');line.appendChild(make('span','code',item.codigo));
      const state=make('span','state '+item.estado.replace(' ','-'),item.estado);
      line.appendChild(state);card.appendChild(line);
      if(item.coincidencias.length){
        for(const p of item.coincidencias){
          const btn=make('button','secondary',`#${p.numero} · ${p.tipo}`);
          btn.title='Ir al punto en el mapa';
          btn.addEventListener('click',()=>{
            const point=points.find(x=>x.id===p.id);
            if(point)pickPoint(point);
          });card.appendChild(btn);
        }
      } else if(item.total_codigo>0){
        card.appendChild(make('small','muted','Existe el código, pero no coincide con los tipos seleccionados.'));
      }
      results.appendChild(card);
    }
    $('batch-summary').textContent=`${counts.encontrado} únicos · ${counts.ambiguo} ambiguos · ${counts['no encontrado']} sin resultado`;
    say('Búsqueda local exacta finalizada.');
  }catch(err){say(err.message,true);}
});
function renderCaptures(){
  const host=$('capture-list');host.replaceChildren();
  if(!captures.length){host.appendChild(make('p','muted','Aún no hay capturas importadas.'));return;}
  host.appendChild(make('p','muted',captures.length+' captura(s) locales.'));
  for(const c of captures){
    const item=make('div','capture-card');
    item.appendChild(make('strong',null,`Captura ${c.id.slice(0,8)}`));
    item.appendChild(make('div','hint',`${c.width} × ${c.height} px · zoom ${Number(c.zoom||0).toFixed(1)}`));
    const go=make('button','secondary','Ver zona');go.addEventListener('click',()=>map.fitBounds3857(c.bounds3857));
    const del=make('button','secondary','Eliminar');del.addEventListener('click',async()=>{
      if(!confirm('¿Eliminar esta captura local?'))return;
      try{await api('/api/captures/'+c.id,{method:'DELETE'});await refreshCaptures();say('Captura eliminada.');}
      catch(e){say(e.message,true);}
    });item.append(go,del);host.appendChild(item);
  }
}
$('capture-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=await file.text();
    const payload=JSON.parse(data);
    const rsp=await api('/api/captures/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    await refreshCaptures();map.fitBounds3857(rsp.capture.bounds3857);say('Captura cartográfica georreferenciada importada.');
  }catch(err){say(err.message,true);}finally{e.target.value='';}
});
$('toggle-osm').addEventListener('change',e=>map.setOptions({showOSM:e.target.checked}));
$('toggle-captures').addEventListener('change',e=>map.setOptions({showCaptures:e.target.checked}));
$('toggle-numbers').addEventListener('change',e=>map.setOptions({showNumbers:e.target.checked}));
$('toggle-codes').addEventListener('change',e=>map.setOptions({showCodes:e.target.checked}));
$('label-mode').addEventListener('change',e=>map.setOptions({labels:e.target.value}));

initGNAT(api,map);

Promise.all([refreshPoints(),refreshCaptures()]).then(()=>{
  $('status-top').textContent='● Local · SQLite';
  if(points.length)map.fitGeo(points);
  else if(captures.length)map.fitBounds3857(captures[0].bounds3857);
  say('Visor listo. Tus datos permanecen en este computador.');
}).catch(e=>{say('Error al iniciar: '+e.message,true);$('status-top').textContent='Error de conexión';});
