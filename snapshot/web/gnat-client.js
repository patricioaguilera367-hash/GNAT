/* Optional GNAT panel. Only local status/MOCK routes; no corporate transport. */
const $=id=>document.getElementById(id);
const textElement=(tag,text)=>{const el=document.createElement(tag);el.textContent=String(text??'');return el;};
export function renderAsset(host,asset){
  host.replaceChildren();
  const heading=textElement('h3',asset.synthetic?'MOCK · geometría SINTÉTICA':'MOCK · activo de ejemplo');
  const fields=[['Código',asset.code],['ID interno',asset.id],['Tipo',asset.asset_type],
    ['Geometría',asset.geometry?.type||'No disponible'],['Metadatos',asset.metadata||'Sin datos'],
    ['Procedencia',asset.source],['Consulta local del fixture',asset.consulted_at]];
  const list=document.createElement('dl');
  for(const [label,value] of fields)list.append(textElement('dt',label),textElement('dd',value));
  host.append(heading,list);
}
export async function initGNAT(api,map){
  let asset=null;
  const status=$('gnat-status'),host=$('gnat-asset'),overlay=$('gnat-overlay');
  $('gnat-consult').disabled=true;
  overlay.disabled=true;
  function clear(){asset=null;overlay.checked=false;overlay.disabled=true;map.setAssetGeometry(null);host.replaceChildren();}
  function show(next){
    clear();asset=next;renderAsset(host,asset);overlay.disabled=!asset.geometry;
  }
  overlay.addEventListener('change',()=>{
    map.setAssetGeometry(overlay.checked?asset?.geometry:null);
    if(overlay.checked)map.fitAssetGeometry();
  });
  $('gnat-clear').addEventListener('click',()=>{clear();status.textContent='Ficha y capa MOCK eliminadas de esta sesión; GNAT sigue desconectado.';});
  $('gnat-mock').addEventListener('click',async()=>{
    const button=$('gnat-mock');button.disabled=true;clear();status.textContent='Cargando fixture MOCK local…';
    try{
      const query=$('gnat-query').value;
      const type=$('gnat-type').value;
      const result=await api('/api/gnat/mock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query,asset_types:type?[type]:[]})});
      if(!result.ok)throw Error(result.error?.message||'No se pudo cargar el fixture');
      const matches=result.data.matches;
      if(matches.length===1){show(matches[0]);status.textContent='MOCK cargado. GNAT desconectado; ningún punto de trabajo fue modificado.';}
      else if(matches.length>1){
        status.textContent='MOCK ambiguo: seleccione el ID deseado.';
        for(const item of matches){const pick=textElement('button',item.code+' · ID '+item.id);pick.addEventListener('click',()=>show(item));host.appendChild(pick);}
      } else status.textContent='Sin coincidencia exacta en fixtures MOCK. Pruebe F5353, SINTETICO_LINEA o SINTETICO_MULTILINEA.';
    }catch(error){status.textContent='Error MOCK: '+error.message+' Los puntos locales siguen disponibles.';}
    finally{button.disabled=false;}
  });
  try{
    const connection=await api('/api/gnat/status');
    // No live adapter is implemented, so a remote-query button must never become active.
    status.textContent=connection.message;
  }catch(error){status.textContent='No se pudo comprobar el estado local de GNAT: '+error.message;}
}
