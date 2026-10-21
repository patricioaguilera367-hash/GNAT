const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
function environment(){
  let requests=0;let clones=0;let responseBody=JSON.stringify({success:true,data:{type:'Feature',id:8659987,geometry:{type:'Point',coordinates:[-72.06376236,-37.780086409]},properties:{display_name:'PRIVATE_NAME',token:'SECRET'}}});
  class El{constructor(){this.children=[];this.style={};this.listeners={};} append(...x){this.children.push(...x);} appendChild(x){this.children.push(x);return x;} addEventListener(k,f){this.listeners[k]=f;} remove(){} click(){} set innerHTML(x){throw Error('Unsafe HTML');}}
  class XHR{constructor(){this.listeners={};this.status=200;this.responseType='';} open(){} send(){this.responseText=responseBody;this.listeners.loadend?.();} addEventListener(k,f){this.listeners[k]=f;} removeEventListener(k){delete this.listeners[k];}}
  const originalFetch=async()=>{requests++;const text=responseBody;return {status:200,clone(){clones++;let delivered=false;return {body:{getReader(){return {async read(){if(delivered)return {done:true};delivered=true;return {done:false,value:new TextEncoder().encode(text)};},async cancel(){}};}}};}};};
  const doc={body:new El(),createElement(){return new El();},getElementById(){return null;}};
  const context={window:null,location:{href:'https://official.invalid/maps/index.php',origin:'https://official.invalid'},document:doc,fetch:originalFetch,XMLHttpRequest:XHR,URL,URLSearchParams,FormData,TextDecoder,TextEncoder,Blob,console:{warn(){}},performance:{now(){return 1;}},setTimeout(){return 1;},clearTimeout(){}};
  context.window=context;vm.createContext(context);
  const path='bridge/diagnostico_contrato_gnat.js';if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),context);
  return {context,originalFetch,XHR,requests:()=>requests,clones:()=>clones,setBody(v){responseBody=v;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('diagnostic is passive, same origin, bounded and never exports payloads or credentials',async()=>{
  const e=environment();const diag=e.context.centralityGNATDiagnostic;assert.ok(diag,'Missing diagnostic');assert.equal(e.requests(),0);
  await e.context.fetch('/maps/svc_wmc.php?token=TOP_SECRET',{method:'POST',body:'action=get_objects_geojson&object_ids=8659987&csrf=SUPER_SECRET'});await tick();
  let data=diag.report();assert.equal(data.samples.length,1);
  const serialized=JSON.stringify(data);for(const value of ['official.invalid','TOP_SECRET','SUPER_SECRET','8659987','PRIVATE_NAME','-72.063','csrf','token'])assert.equal(serialized.includes(value),false,value);
  assert.equal(data.samples[0].action,'get_objects_geojson');assert.equal(data.samples[0].geometry_type,'Point');assert.equal(data.cors_localhost,'NO_VERIFICADO');
  await e.context.fetch('https://unrelated.invalid/svc_wmc.php',{body:'action=textual_search'});
  await e.context.fetch('/unrelated.php',{body:'action=textual_search'});await tick();assert.equal(e.clones(),1);
  diag.stop();assert.equal(e.context.fetch,e.originalFetch);
});
test('XHR shape observer restores hooks and sample cap; raw large or bad responses omitted',async()=>{
  const e=environment();const diag=e.context.centralityGNATDiagnostic;assert.ok(diag,'Missing diagnostic');
  for(let i=0;i<40;i++){const xhr=new e.XHR();xhr.open('POST','/maps/svc_wmc.php');xhr.send('action=get_objects_geojson&object_ids=1');}
  assert.ok(diag.report().samples.length<=24);assert.ok(JSON.stringify(diag.report()).length<=64000);
  const replacement=()=>{};e.context.fetch=replacement;diag.stop();assert.equal(e.context.fetch,replacement);
  const before=diag.report().samples.length;const xhr=new e.XHR();xhr.open('POST','/maps/svc_wmc.php');xhr.send('action=textual_search');assert.equal(diag.report().samples.length,before);
  const f=environment();f.setBody('SECRET'.repeat(30000));await f.context.fetch('/maps/svc_wmc.php',{body:'action=textual_search'});await tick();assert.equal(f.context.centralityGNATDiagnostic.report().samples[0].response_state,'oversize');
  f.context.centralityGNATDiagnostic.stop();
});

test('JSON-typed XHR bodies are not traversed without a byte-size bound; malformed text is reported safely',async()=>{
  const e=environment();const diag=e.context.centralityGNATDiagnostic;
  const xhr=new e.XHR();xhr.open('POST','/maps/svc_object_view.php');xhr.responseType='json';
  xhr.response={success:true,data:{secret:'PRIVATE_VALUE'}};xhr.send('action=get_object_definition');
  assert.equal(diag.report().samples[0].response_state,'unavailable_json_object');
  assert.equal(diag.report().samples[0].response_shape,null);
  e.setBody('{PRIVATE_BROKEN_JSON');await e.context.fetch('/maps/svc_wmc.php',{body:'action=textual_search'});await tick();
  assert.equal(diag.report().samples[1].response_state,'invalid_json');assert.equal(JSON.stringify(diag.report()).includes('PRIVATE'),false);
  diag.stop();
});
