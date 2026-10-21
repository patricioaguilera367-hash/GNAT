import base64
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from app import server, db, captures
from test_compat import ROUTE, OPENING

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        root=Path(self.tmp.name)
        cap=root/'captures'; cap.mkdir()
        self.patches=[patch.object(db,'DB_PATH',root/'points.sqlite3'), patch.object(captures,'CAPTURE_DIR',cap),
                      patch.object(captures,'MANIFEST',cap/'indice.json'),patch.object(server,'CAPTURE_DIR',cap)]
        for item in self.patches:item.start()
        db.init_db()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.patches.append(patch.object(server,'PORT',self.http.server_port));self.patches[-1].start()
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join()
        for item in reversed(self.patches):item.stop()
        self.tmp.cleanup()
    def request(self, method, path, body=None, headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.http.server_port,timeout=3)
        try:
            conn.request(method,path,body,headers or {})
            response=conn.getresponse();data=response.read()
            return response.status, data, dict(response.getheaders())
        finally:conn.close()
    def upload(self,text,confirm=False):
        return self.request('POST','/api/import?filename=test.csv'+('&confirm_replace=1' if confirm else ''),text.encode())
    def test_import_confirms_only_replaced_kind(self):
        self.assertEqual(self.upload(ROUTE)[0],200)
        self.assertEqual(self.upload(OPENING)[0],200)
        before=db.list_points()
        status,body,_=self.upload(ROUTE)
        self.assertEqual(status,409)
        self.assertTrue(json.loads(body)['requires_confirmation'])
        self.assertEqual(db.list_points(),before)
        self.assertEqual(self.upload(ROUTE,True)[0],200)
        self.assertIn(before[0],db.list_points())
    def test_export_two_schemas_decimal_comma_roundtrip(self):
        self.upload(ROUTE);self.upload(OPENING)
        for kind,header in [('route','ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID'),
                            ('opening','ID;Numero;Codigo;Longitud;Latitud;SupervisorColor;Bloques')]:
            status,data,headers=self.request('GET','/api/export.csv?kind='+kind)
            text=data.decode('utf-8-sig')
            self.assertEqual(status,200);self.assertEqual(text.splitlines()[0],header)
            self.assertIn('-72,59',text)
            self.assertEqual(self.upload(text,True)[0],200)
        self.assertEqual(len(db.list_points()),3)
    def test_bad_upload_and_foreign_origin_do_not_mutate(self):
        self.upload(ROUTE);before=db.list_points()
        self.assertEqual(self.request('POST','/api/import?filename=bad.kmz',b'not zip')[0],400)
        self.assertEqual(self.request('POST','/api/import?filename=bad.csv',ROUTE.replace('-72,59','-725900').encode())[0],400)
        self.assertEqual(self.request('POST','/api/supervisores',b'{}',{'Origin':'https://foreign.invalid'})[0],403)
        self.assertEqual(db.list_points(),before)
    def test_health_static_editor_batch_and_captures_remain_local(self):
        self.upload(ROUTE)
        self.assertEqual(self.request('GET','/')[0],200)
        self.assertEqual(self.request('GET','/api/health')[0],200)
        point=db.list_points()[0]
        status,body,_=self.request('PATCH','/api/points/'+str(point['id']),json.dumps({'supervisor':'Azul'}))
        self.assertEqual(status,200);self.assertEqual(json.loads(body)['point']['import_id'],'r-9')
        status,body,_=self.request('POST','/api/batch',json.dumps({'codes':['SED_9','SED_90'],'types':[]}))
        self.assertEqual([x['estado'] for x in json.loads(body)['items']],['encontrado','no encontrado'])
        png=b'\x89PNG\r\n\x1a\n'+b'\x00'*8+(100).to_bytes(4,'big')*2
        payload={'format':'centrality-local-capture-v1','bounds3857':[0,0,100,100],'imageDataUrl':'data:image/png;base64,'+base64.b64encode(png).decode()}
        status,body,_=self.request('POST','/api/captures/import',json.dumps(payload))
        self.assertEqual(status,200);capture=json.loads(body)['capture']
        self.assertEqual(self.request('GET','/capturas/'+capture['archivo'])[1],png)
        self.assertEqual(self.request('GET','/api/captures')[0],200)
        self.assertEqual(self.request('DELETE','/api/captures/'+capture['id'])[0],200)

    def test_gnat_status_mock_isolation_and_no_raw_html(self):
        self.upload(ROUTE);before=db.list_points()
        status,body,_=self.request('GET','/api/gnat/status')
        self.assertEqual(status,200);self.assertFalse(json.loads(body)['validated'])
        status,body,_=self.request('POST','/api/gnat/mock',json.dumps({'query':' f5353 '}))
        self.assertEqual(status,200);result=json.loads(body)
        self.assertEqual(result['data']['state'],'found')
        self.assertIn('MOCK',result['data']['matches'][0]['source'])
        self.assertNotIn('raw_response',body.decode())
        self.assertEqual(db.list_points(),before)

    def test_default_and_legacy_export_roundtrip_preserves_both_point_kinds(self):
        self.assertEqual(self.upload(ROUTE)[0],200)
        self.assertEqual(self.upload(OPENING)[0],200)
        expected=[
            ('apertura','a-4',4,'F5353','Azul',['B1','B2'],-72.59,-38.735),
            ('recorrido','r-9',9,'SED_9','Verde',['B1'],-72.59,-38.735),
            ('recorrido','r-21',21,'SED_21','',['B2'],-72.60,-38.74),
        ]
        for path in ('/api/export.csv','/api/export.csv?kind=legacy'):
            with self.subTest(path=path):
                status,data,_=self.request('GET',path)
                self.assertEqual(status,200)
                status,body,_=self.request('POST','/api/import?filename=roundtrip.csv&confirm_replace=1',data)
                self.assertEqual(status,200,body.decode())
                actual=[tuple(p[k] for k in ('clase','import_id','numero','codigo','supervisor','bloques','longitud','latitud')) for p in db.list_points()]
                self.assertEqual(actual,expected)
