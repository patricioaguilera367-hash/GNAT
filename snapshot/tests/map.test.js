const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const moduleMap=import('data:text/javascript;base64,'+fs.readFileSync('web/map.js').toString('base64'));
test('blocks filter shared openings and independent labels preserve display gaps',async()=>{
  const m=await moduleMap;
  assert.equal(typeof m.matchesBlock,'function');
  const p={id:72,numero:21,codigo:'F5353',bloques:['B1','B2'],clase:'apertura'};
  assert.equal(m.matchesBlock(p,'B2'),true);assert.equal(m.matchesBlock(p,'B3'),false);assert.equal(m.matchesBlock(p,''),true);
  assert.equal(m.pointLabel(p,true,false),'21');assert.equal(m.pointLabel(p,false,true),'F5353');assert.equal(m.pointLabel(p,true,true),'21 · F5353');assert.equal(m.pointLabel(p,false,false),'');
});
test('default offline renderer never loads OSM, selects by ID and draws X at point footprint',async()=>{
  const {LocalMap}=await moduleMap;
  global.window={devicePixelRatio:1};global.ResizeObserver=class{observe(){}};
  global.requestAnimationFrame=()=>{};global.document={getElementById(){return null;}};
  const canvas={getContext(){return {};},parentElement:{getBoundingClientRect(){return {width:500,height:400};}},style:{},addEventListener(){}};
  const map=new LocalMap(canvas);map.render=()=>{};
  assert.equal(map.showOSM,false);
  const events=[];map.ctx=new Proxy({}, {get(target,key){return (...args)=>events.push([key,...args]);},set(){return true;}});
  const opening={id:900,numero:21,codigo:'F5353',clase:'apertura',supervisor:'Azul',longitud:-72.6,latitud:-38.74};
  map.setPoints([opening]);assert.equal(map.hit(250,200).id,900);map.draw();
  assert.equal(events.some(e=>e[0]==='arc'),false);
  assert.equal(events.some(e=>e[0]==='moveTo' && e[1]===244 && e[2]===194),true);
  assert.equal(events.some(e=>e[0]==='lineTo' && e[1]===256 && e[2]===206),true);
});

test('optional synthetic line overlay draws all segments without adding or changing points',async()=>{
  const {LocalMap}=await moduleMap;
  const map=Object.create(LocalMap.prototype);map.render=()=>{};map.points=[{id:7,numero:83}];
  const calls=[];map.ctx=new Proxy({}, {get(t,k){return (...v)=>calls.push([k,...v]);},set(){return true;}});map.toScreen=(x,y)=>[x,y];
  assert.equal(typeof map.setAssetGeometry,'function');
  map.setAssetGeometry({type:'MultiLineString',coordinates:[[[1,2],[3,4]],[[5,6],[7,8]]]});map.drawAssetOverlay();
  assert.deepEqual(calls.filter(x=>x[0]==='moveTo'),[['moveTo',1,2],['moveTo',5,6]]);
  assert.deepEqual(calls.filter(x=>x[0]==='lineTo'),[['lineTo',3,4],['lineTo',7,8]]);
  assert.deepEqual(map.points,[{id:7,numero:83}]);map.setAssetGeometry(null);assert.equal(map.assetGeometry,null);
});
