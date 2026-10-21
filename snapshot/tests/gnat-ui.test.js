const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const load=async()=>{if(!fs.existsSync('web/gnat-client.js'))return null;return import('data:text/javascript;base64,'+fs.readFileSync('web/gnat-client.js').toString('base64'));};
class Element{
  constructor(){this.children=[];this.textContent='';this.handlers={};this.classList={toggle(){}};}
  append(...values){this.children.push(...values);} appendChild(v){this.children.push(v);return v;}
  replaceChildren(...values){this.children=values;} addEventListener(k,fn){this.handlers[k]=fn;}
  set innerHTML(v){throw Error('Unsafe HTML boundary');}
}
function dom(){const elements=new Map();global.document={createElement(){return new Element();},getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};return elements;}
function allText(el){return el.textContent+' '+el.children.map(allText).join(' ');}
test('asset fiche uses inert text, provenance and does not create HTML',async()=>{
  const module=await load();assert.ok(module,'GNAT UI module absent');dom();const host=new Element();
  module.renderAsset(host,{id:'8659987',code:'<img src=x onerror=alert(1)>',asset_type:'poste',geometry:{type:'Point'},metadata:'<script>alert(2)</script>',source:'MOCK',consulted_at:'2026-10-20T20:00:00+00:00',synthetic:false});
  const text=allText(host);assert.ok(text.includes('<img src=x onerror=alert(1)>'));assert.ok(text.includes('MOCK'));assert.ok(text.includes('2026-10-20'));assert.ok(text.includes('Point'));
});
test('disconnected real query disabled; explicit mock load and clear only touch optional overlay',async()=>{
  const module=await load();assert.ok(module,'GNAT UI module absent');const elements=dom();const calls=[];const overlays=[];
  const asset={id:'8659987',code:'F5353',asset_type:'poste',geometry:{type:'Point',coordinates:[-72,-38]},metadata:'MOCK',source:'MOCK',consulted_at:'now'};
  const api=async(path)=>{calls.push(path);return path.endsWith('/status')?{validated:false,state:'disconnected',message:'Pendiente'}:{ok:true,data:{state:'found',matches:[asset]}};};
  await module.initGNAT(api,{setAssetGeometry(v){overlays.push(v);},fitAssetGeometry(){}});
  assert.equal(document.getElementById('gnat-consult').disabled,true);assert.deepEqual(calls,['/api/gnat/status']);
  document.getElementById('gnat-query').value='F5353';document.getElementById('gnat-type').value='';
  await document.getElementById('gnat-mock').handlers.click();assert.deepEqual(calls,['/api/gnat/status','/api/gnat/mock']);
  document.getElementById('gnat-overlay').checked=true;document.getElementById('gnat-overlay').handlers.change();
  assert.deepEqual(overlays.at(-1),asset.geometry);
  document.getElementById('gnat-clear').handlers.click();assert.equal(overlays.at(-1),null);
});

test('MOCK failure stays local and leaves panel usable while live query remains disabled',async()=>{
  const module=await load();dom();const overlays=[];
  await module.initGNAT(async(path)=>{if(path.endsWith('/status'))throw Error('local status unavailable');return {ok:false,error:{message:'Tiempo de espera'}};},{setAssetGeometry(v){overlays.push(v);}});
  document.getElementById('gnat-query').value='F5353';document.getElementById('gnat-type').value='';
  await document.getElementById('gnat-mock').handlers.click();
  assert.ok(document.getElementById('gnat-status').textContent.includes('Tiempo de espera'));
  assert.equal(document.getElementById('gnat-mock').disabled,false);assert.equal(document.getElementById('gnat-consult').disabled,true);assert.equal(overlays.at(-1),null);
});
