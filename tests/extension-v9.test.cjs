const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'GNAT_Extension_V9');
const script = fs.readFileSync(path.join(root, 'centrality_v9.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const state = require(path.join(root, 'src/core/state.js'));
const autosave = require(path.join(root, 'src/core/autosave.js'));
const grid = require(path.join(root, 'src/ui/grid-engine.js'));
function source(name) {return fs.readFileSync(path.join(root,name),'utf8')}

test('manifiesto y módulos MAIN/ISOLATED cargados en orden sin bundler', () => {
  assert.equal(manifest.version, '9.3.0');
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'scripting', 'storage']);
  for (const f of ['centrality_v9.js','background.js','src/core/state.js','src/core/autosave.js',
     'src/gis/map-bridge.js','src/ui/grid-engine.js','src/background/storage-bridge.js']) {
    new vm.Script(source(f), {filename:f});
  }
  assert.match(source('background.js'), /world:'ISOLATED'/);
  assert.match(source('background.js'), /src\/core\/state\.js/);
  assert.match(source('background.js'), /src\/ui\/grid-engine\.js/);
});

test('colores del mapa dependen solo del supervisor y aperturas X rojas', () => {
  const block = script.match(/  function colorDePunto\(f\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(block);
  assert.match(block, /COLOR_APERTURAS/);
  assert.match(block, /COLORES\[categoriaSupervisor\(f\)\]/);
  assert.doesNotMatch(block, /coloresBloques\.get/);
});

test('búsqueda y lista de navegación se conservan', () => {
  assert.match(script, /Ir a un poste o apertura:/);
  assert.match(script, /controles\.insertBefore\(lista,barraFiltros\)/);
  assert.match(script, /busqueda\.addEventListener\("input", \(\) => \{\s*reconstruirLista\(\)/);
});

test('Excel, Zonas, ingreso masivo y borrador se conservan', () => {
  for (const s of [/function construirEditorExcel\(/,/function abrirEditorV8\(/,
                   /Ingreso Masivo/,/Catálogo Aperturas/,/excelBorrador/,
                   /function guardarCSVHumano/]) assert.match(script,s);
  assert.deepEqual(grid.parseClipboardMatrix(' F100\t X100\r\nF200\tX200\r\n'),
    [['F100','X100'],['F200','X200']]);
});

test('JSON manual y autosave usan un único serializador compatible V4', () => {
  const props={id:'p-1',numero:1,tipo:'PUNTO',codigo:'F100',bloque:'Naranjo',bloqueId:'D1',
    aperturasIds:['a-1'],supervisorNombre:'Supervisor',fechaPlanificacion:'2026-10-21'};
  const feature={get:key=>props[key],getGeometry:()=>({getCoordinates:()=>[123,456]})};
  const draft={version:1,recorrido:[{subestacion:'PENDIENTE'}],aperturas:[],masivo:{filas:[]}};
  const project=state.buildProject({features:[feature],toLonLat:()=>[-72.6,-38.73],projection:'EPSG:3857',
    zoneEntries:new Map([['D1','Desconexión 1']]),zoneColors:new Map([['D1','#ff6600']]),
    zoneSupervisors:new Map([['D1','Responsable']]),fallbackColor:()=> '#198754',
    supervisorColors:{Verde:'#198754',Naranjo:'#ef8b16',Azul:'#2469d8','Sin asignar':'#e53935'},
    visibleSupervisors:new Set(['Naranjo']),excelDraft:draft});
  assert.equal(project.version,4);
  assert.equal(project.registros[0].aperturasIds[0],'a-1');
  assert.equal(project.registros[0].supervisorNombre,'Supervisor');
  assert.equal(project.bloques[0].responsable,'Responsable');
  assert.equal(project.bloques[0].color,'#ff6600');
  assert.deepEqual(project.excelBorrador,draft);
  assert.equal(state.isMeaningful(project),true);
  assert.match(script,/const proyecto = construirProyectoActual\(\);/);
});

test('autosave no sobrescribe respaldo previo al abrir sin cambios',async()=>{
  const listeners=new Map();const doc={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
  let data={schema:1,timestamp:1,project:{formato:'CentralityLocal',version:4,registros:[],bloques:[]}},writes=0;
  const win={location:{origin:'https://example.test'},document:doc,__centralityProjectState:state,
    addEventListener:(_,cb)=>listeners.set('message',cb),removeEventListener(){},setTimeout:()=>1,clearTimeout(){},
    setInterval:()=>1,clearInterval(){},postMessage(message){
      queueMicrotask(()=>{
        if(message.action==='set') {writes++;data=message.payload}
        listeners.get('message')({source:win,origin:win.location.origin,
          data:{channel:message.channel,side:'bridge',requestId:message.requestId,ok:true,
          value:message.action==='get'?data:{timestamp:data.timestamp}}});
      });
    }};
  let snapshot={formato:'CentralityLocal',version:4,registros:[{codigo:'F1'}],bloques:[]};
  const svc=autosave.createAutosave({win,build:()=>snapshot});
  await svc.save();assert.equal(writes,0);
  const old=await svc.read();assert.equal(old.timestamp,1);
  snapshot={...snapshot,registros:[{codigo:'F2'}]};
  await svc.save();assert.equal(writes,1);
  const result=await svc.read();assert.equal(result.project.registros[0].codigo,'F2');
  await svc.save();assert.equal(writes,1);
  svc.destroy();
});

test('archivo JSON recuperado pasa por validador de proyecto existente',()=>{
  assert.match(script,/new File\(\[data\], 'centrality-autosave\.json'/);
  assert.match(script,/archivoProyecto\.dispatchEvent\(new Event\('change'/);
  assert.match(script,/!\[1,2,3,4\]\.includes\(data\.version\)/);
  assert.match(script,/window\.confirm\(/);
});

test('persistencia fuera de MAIN; único acceso Chrome en isolated bridge',()=>{
  assert.doesNotMatch(script,/chrome\.storage\.local\.(get|set)\(/);
  assert.match(source('src/background/storage-bridge.js'),/chrome\.storage\.local\.set/);
  assert.match(source('src/background/storage-bridge.js'),/chrome\.storage\.local\.get/);
});


test('el autosave incluye códigos de poste completamente numéricos sin geometría', () => {
  assert.equal(state.isMeaningful({formato:'CentralityLocal',registros:[],bloques:[],
    excelBorrador:{recorrido:[{numero:'1',subestacion:'626164'}],aperturas:[]}}),true);
});
