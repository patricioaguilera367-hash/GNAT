/* Ejecutar MANUALMENTE en el contexto del mapa oficial autorizado.
   Solo observa tráfico de la UI: no consulta, no captura credenciales ni transmite.
   Detención automática: 60 s, 24 muestras, 3 por acción y 64 KB por respuesta. */
(() => {
  'use strict';
  if(window.centralityGNATDiagnostic){console.warn('El diagnóstico ya existe. Deténgalo y cierre el panel antes de repetir.');return;}
  const services=new Set(['svc_wmc.php','svc_object_view.php','svc_web_services.php','svc_location.php','svc_condition.php']);
  const actions={textual_search:'busqueda',get_objects_geojson:'geometria',get_objects_info_for_point:'identificacion',get_object_definition:'definicion_ficha',get_widget_content:'widgets_ficha'};
  const requestKeys=new Set(['action','limit','page','query','start','object_ids','bounds','lonlat','scale','units_per_pixel','object_id','widget_ids','type','dir','location_id','sort']);
  const responseKeys=new Set(['success','data','type','geometry','coordinates','id','object_id','properties','display_name','display','description','image','bbox','title','widget_definition','message_error','header_widgets','tab_widgets','tool_widgets','action_widgets','widget_id','content','store_fields','grid_columns','text','renderer','dataIndex','autoAdjustSize','surrogate_in_map_id','pin_location']);
  const geometryTypes=new Set(['Point','LineString','MultiLineString','Polygon','MultiPolygon','MultiPoint','GeometryCollection']);
  const samples=[],counts=new Map(),pendingListeners=new Set(),readers=new Set();
  let active=true,pending=0;
  const originalFetch=window.fetch,proto=window.XMLHttpRequest?.prototype;
  const originalOpen=proto?.open,originalSend=proto?.send,xhrMeta=new WeakMap();
  const MAX_RESPONSE=64000;
  const panel=document.createElement('section');panel.id='centrality-gnat-diagnostic';
  Object.assign(panel.style,{position:'fixed',bottom:'12px',left:'12px',zIndex:'2147483647',background:'#fff',color:'#142439',padding:'14px',border:'1px solid #607184',maxWidth:'340px',font:'13px Segoe UI, sans-serif',boxShadow:'0 4px 16px #0003'});
  const title=document.createElement('strong');title.textContent='Diagnóstico GNAT · pasivo';
  const state=document.createElement('p');state.textContent='Activo durante 60 s. Busque, seleccione y abra una ficha voluntariamente.';
  panel.append(title,state);document.body.appendChild(panel);
  function button(label,handler){const b=document.createElement('button');b.textContent=label;b.style.margin='4px';b.addEventListener('click',handler);panel.appendChild(b);}
  function report(){return JSON.parse(JSON.stringify({format:'centrality-gnat-safe-diagnostic-v1',cors_localhost:'NO_VERIFICADO',active,samples}));}
  function stop(){
    if(!active)return;
    active=false;clearTimeout(timer);
    if(window.fetch===fetchObserver)window.fetch=originalFetch;
    if(proto?.open===openObserver)proto.open=originalOpen;
    if(proto?.send===sendObserver)proto.send=originalSend;
    for(const remove of pendingListeners)remove();pendingListeners.clear();
    for(const reader of readers)void reader.cancel().catch(()=>{});readers.clear();
    state.textContent='Detenido. Hooks propios restaurados; '+samples.length+' muestras saneadas en memoria. Exporte solo si desea compartirlas.';
  }
  function download(extension){
    stop();const data=JSON.stringify(report(),null,2);
    const url=URL.createObjectURL(new Blob([data],{type:extension==='json'?'application/json':'text/plain'}));
    const link=document.createElement('a');link.href=url;link.download='diagnostico_gnat_saneado.'+extension;
    panel.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  button('Detener y restaurar',stop);button('Exportar TXT',()=>download('txt'));button('Exportar JSON',()=>download('json'));
  button('Cerrar y borrar',()=>{stop();samples.length=0;panel.remove();delete window.centralityGNATDiagnostic;});
  function metadata(input,body){
    try{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
      const service=url.pathname.split('/').pop();
      if(url.origin!==location.origin||!services.has(service))return null;
      const fields=new Set();let action='otro_valor_omitido';
      const add=(key,value)=>{if(!requestKeys.has(key))return;fields.add(key);if(key==='action'&&typeof value==='string'&&value.length<=60&&Object.hasOwn(actions,value))action=value;};
      for(const [key,value] of url.searchParams)add(key,value);
      if(typeof body==='string'&&body.length<=16000){for(const [key,value] of new URLSearchParams(body))add(key,value);}
      else if(body instanceof URLSearchParams || (typeof FormData!=='undefined'&&body instanceof FormData)){
        let count=0;for(const [key,value] of body){if(++count>100)break;add(key,typeof value==='string'?value:'');}
      }
      return {service,action,operation:actions[action]||'otra_operacion_no_caracterizada',request_fields:[...fields].sort()};
    }catch{return null;}
  }
  function shape(value,depth=0){
    if(value===null)return 'null';
    if(depth>=4)return Array.isArray(value)?'array':typeof value;
    if(Array.isArray(value))return {type:'array',length:Math.min(value.length,100),sample:value.length?[shape(value[0],depth+1)]:[]};
    if(typeof value==='object'){
      const fields={};let count=0;
      for(const key of Object.keys(value)){if(!responseKeys.has(key))continue;if(++count>12)break;fields[key]=shape(value[key],depth+1);}
      return {type:'object',fields};
    }
    return typeof value;
  }
  function geometryType(value){
    const data=value?.data;
    const geometry=data?.geometry||data?.features?.[0]?.geometry;
    return geometryTypes.has(geometry?.type)?geometry.type:'no_observado';
  }
  function record(meta,status,text,responseState='observed'){
    if(!active||samples.length>=24)return;
    const key=meta.service+':'+meta.action;if((counts.get(key)||0)>=3)return;
    let value=null;
    if(responseState==='observed'){
      if(typeof text==='string'){
        if(text.length>MAX_RESPONSE)responseState='oversize';
        else try{value=JSON.parse(text);}catch{responseState=text?'invalid_json':'empty';}
      }else if(text&&typeof text==='object')value=text;
      else responseState='unavailable';
    }
    const sample={sequence:samples.length+1,...meta,status:Number.isInteger(status)?status:0,response_state:responseState,
      response_shape:value?shape(value):null,geometry_type:value?geometryType(value):'no_observado'};
    if(JSON.stringify(sample).length>6000||JSON.stringify(samples).length+JSON.stringify(sample).length>60000){stop();return;}
    samples.push(sample);counts.set(key,(counts.get(key)||0)+1);
    state.textContent='Activo · '+samples.length+' muestras. Ningún valor de negocio ni credencial se exporta.';
    if(samples.length>=24)stop();
  }
  async function readBounded(response){
    const clone=response.clone();
    if(!clone.body?.getReader)return {text:null,state:'unavailable'};
    const reader=clone.body.getReader();readers.add(reader);const chunks=[];let length=0;
    try{
      while(true){
        const chunk=await reader.read();if(chunk.done)break;
        length+=chunk.value.byteLength;
        if(length>MAX_RESPONSE){void reader.cancel().catch(()=>{});return {text:null,state:'oversize'};}
        chunks.push(chunk.value);
      }
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      return {text:new TextDecoder().decode(bytes),state:'observed'};
    }catch{return {text:null,state:'unavailable'};}
    finally{readers.delete(reader);}
  }
  function fetchObserver(...args){
    const meta=active?metadata(args[0],args[1]?.body):null;
    const promise=Reflect.apply(originalFetch,this,args);
    if(meta&&pending<4&&samples.length<24&&(counts.get(meta.service+':'+meta.action)||0)<3){
      pending++;
      void promise.then(async response=>{
        if(!active)return;
        const result=await readBounded(response);record(meta,response.status,result.text,result.state);
      },()=>record(meta,0,null,'network_error')).catch(()=>{}).finally(()=>{pending--;});
    }
    return promise;
  }
  function openObserver(method,url,...rest){
    xhrMeta.set(this,active?metadata(url):null);
    return Reflect.apply(originalOpen,this,[method,url,...rest]);
  }
  function sendObserver(body){
    const original=xhrMeta.get(this);
    if(active&&original){
      // Only retain sanitized request metadata, never URL/body/header values.
      const extra=metadata('/'+original.service,body);
      const meta={...original,action:extra?.action||original.action,operation:extra?.operation||original.operation,
        request_fields:[...new Set([...original.request_fields,...extra?.request_fields||[]])].sort()};
      if(extra?.action==='otro_valor_omitido'&&original.action!=='otro_valor_omitido'){meta.action=original.action;meta.operation=original.operation;}
      const remove=()=>this.removeEventListener('loadend',done);
      const done=()=>{
        remove();pendingListeners.delete(remove);if(!active)return;
        try{
          if(this.responseType==='json'){record(meta,this.status,null,'unavailable_json_object');return;}
          const value=(!this.responseType||this.responseType==='text')?this.responseText:null;
          record(meta,this.status,value);
        }catch{record(meta,0,null,'unavailable');}
      };
      this.addEventListener('loadend',done);pendingListeners.add(remove);
    }
    return Reflect.apply(originalSend,this,[body]);
  }
  const timer=setTimeout(stop,60000);
  if(typeof originalFetch==='function')window.fetch=fetchObserver;
  if(proto){proto.open=openObserver;proto.send=sendObserver;}
  window.centralityGNATDiagnostic={stop,report};
})();
