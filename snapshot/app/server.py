"""Small local-only HTTP API, Python standard library, no remote service dependency."""
import csv
import io
import json
import mimetypes
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from . import db, importers, captures
from .integrations import gnat
from .config import WEB_DIR, CAPTURE_DIR, MAX_UPLOAD, MAX_CAPTURE_UPLOAD

PORT=8765

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'

    def log_message(self, fmt, *args):
        print('[local]',fmt % args)

    def reply(self, status, data, content_type='application/json; charset=utf-8', attachment=None):
        if isinstance(data,(dict,list)):
            data=json.dumps(data,ensure_ascii=False).encode('utf8')
        elif isinstance(data,str): data=data.encode('utf8')
        if status == 403: self.close_connection = True
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'")
        if attachment:
            self.send_header('Content-Disposition',f'attachment; filename="{attachment}"')
        self.end_headers()
        self.wfile.write(data)

    def json_body(self,limit=MAX_UPLOAD):
        raw=self.read_body(limit)
        try: return json.loads(raw)
        except (ValueError,UnicodeDecodeError):raise ValueError('JSON inválido')

    def read_body(self,limit=MAX_UPLOAD):
        try: length=int(self.headers.get('Content-Length',-1))
        except ValueError: raise ValueError('Tamaño inválido')
        if length<0 or length>limit:raise ValueError('Archivo/cuerpo demasiado grande')
        return self.rfile.read(length)

    def check_local_host(self):
        hostname=self.headers.get('Host','').lower()
        return hostname in {f'127.0.0.1:{PORT}',f'localhost:{PORT}'}

    def check_write_origin(self):
        origin=self.headers.get('Origin')
        if origin not in (None,f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'):
            return False
        # Browsers can't normally send cross-site JSON, but Origin validation
        # is required too, to avoid cross-site localhost writes.
        return True

    def do_GET(self):
        if not self.check_local_host():return self.reply(403,{'error':'Host no permitido'})
        path=urllib.parse.urlparse(self.path).path
        try:
            if path=='/api/gnat/status':return self.reply(200,gnat.DisconnectedAdapter().get_connection_status())
            if path=='/api/health':return self.reply(200,{'ok':True,'version':'5.0-piloto','electrico_remoto':'no conectado'})
            if path=='/api/points':return self.reply(200,{'items':db.list_points()})
            if path=='/api/captures':return self.reply(200,{'items':captures.list_captures()})
            if path=='/api/export.csv':return self.export_csv()
            if path.startswith('/capturas/'):
                filename=path.removeprefix('/capturas/')
                if not filename.endswith('.png') or filename.count('/') or not filename.replace('-','').replace('.png','').isalnum():
                    return self.reply(404,{'error':'Archivo no encontrado'})
                target=CAPTURE_DIR / filename
                if not target.exists():return self.reply(404,{'error':'No encontrado'})
                return self.reply(200,target.read_bytes(),'image/png')
            target=WEB_DIR / (path.lstrip('/') or 'index.html')
            if target.resolve().is_relative_to(WEB_DIR.resolve()) and target.is_file():
                typ=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                return self.reply(200,target.read_bytes(),typ + ('; charset=utf-8' if typ.startswith(('text/','application/javascript')) else ''))
            return self.reply(404,{'error':'No encontrado'})
        except Exception as exc:
            return self.reply(500,{'error':str(exc)})

    def do_POST(self):
        if not self.check_local_host() or not self.check_write_origin():
            return self.reply(403,{'error':'Origen no permitido'})
        path=urllib.parse.urlparse(self.path).path
        try:
            if path=='/api/gnat/mock':
                data=self.json_body(5000)
                if not isinstance(data,dict): raise ValueError('Se requiere un objeto JSON')
                adapter=gnat.FixtureAdapter()
                if 'object_id' in data: result=adapter.get_asset_by_id(data['object_id'])
                else: result=adapter.search_assets(data.get('query',''),data.get('asset_types'))
                return self.reply(200,gnat.public_result(result))
            if path=='/api/import':
                qs=urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name=qs.get('filename',['archivo'])[0]
                if '/' in name or '\\' in name or len(name)>150:raise ValueError('Nombre de archivo inválido')
                records,with_coords=importers.from_upload(name,self.read_body())
                if with_coords:
                    kinds={r.get('clase','recorrido') for r in records}
                    existing=[p for p in db.list_points() if p['clase'] in kinds]
                    if existing and qs.get('confirm_replace') != ['1']:
                        return self.reply(409,{'error':f'La importación reemplazará {len(existing)} puntos del tipo importado. Exporte un respaldo antes de confirmar.',
                                               'requires_confirmation':True,'clases':sorted(kinds),'reemplaza':len(existing)})
                    quantity=db.replace_points(records)
                    return self.reply(200,{'modo':'reemplazo','puntos':quantity,'mensaje':'Importación completa. Reemplazó los puntos anteriores.'})
                report=db.merge_attributes(records)
                return self.reply(200,{'modo':'actualizacion','puntos':report['actualizados'],'sin_coincidencia':report['sin_coincidencia']})
            if path=='/api/batch':
                data=self.json_body(200_000)
                codes=data.get('codes',[])
                if not isinstance(codes,list) or len(codes)>500:raise ValueError('Máximo 500 códigos por consulta')
                return self.reply(200,{'items':db.search_exact(codes,data.get('types',[]))})
            if path=='/api/supervisores':
                data=self.json_body(100_000)
                return self.reply(200,{'actualizados':db.bulk_supervisor(data.get('ids',[]),data.get('supervisor',''))})
            if path=='/api/captures/import':
                payload=self.json_body(MAX_CAPTURE_UPLOAD)
                return self.reply(200,{'capture':captures.add_capture(payload)})
            return self.reply(404,{'error':'Ruta no encontrada'})
        except (ValueError,KeyError,OverflowError) as exc:
            return self.reply(400,{'error':str(exc)})
        except Exception as exc:
            return self.reply(500,{'error':'Error interno: '+str(exc)})

    def do_PATCH(self):
        if not self.check_local_host() or not self.check_write_origin():
            return self.reply(403,{'error':'Origen no permitido'})
        path=urllib.parse.urlparse(self.path).path
        try:
            if path.startswith('/api/points/'):
                num=int(path.rsplit('/',1)[-1])
                p=db.update_point(num,self.json_body(20_000))
                return self.reply(200,{'point':p})
            return self.reply(404,{'error':'Ruta no encontrada'})
        except (ValueError,KeyError,OverflowError) as exc:
            return self.reply(400,{'error':str(exc)})

    def do_DELETE(self):
        if not self.check_local_host() or not self.check_write_origin():
            return self.reply(403,{'error':'Origen no permitido'})
        path=urllib.parse.urlparse(self.path).path
        try:
            if path.startswith('/api/captures/'):
                captures.delete_capture(path.rsplit('/',1)[-1]);return self.reply(200,{'ok':True})
            return self.reply(404,{'error':'Ruta no encontrada'})
        except ValueError as exc:
            return self.reply(400,{'error':str(exc)})

    def export_csv(self):
        kind=urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('kind',['legacy'])[0]
        if kind not in ('route','opening','legacy'): return self.reply(400,{'error':'Tipo de exportación no válido'})
        out=io.StringIO()
        writer=csv.writer(out,delimiter=';',lineterminator='\r\n')
        if kind=='route': headers=['ID','Numero','Subestacion','Longitud','Latitud','SupervisorColor','BloqueID']
        elif kind=='opening': headers=['ID','Numero','Codigo','Longitud','Latitud','SupervisorColor','Bloques']
        else: headers=['Numero','CodigoPoste','Tipo','Categoria','Bloque','Latitud','Longitud','Descripcion','ID','ClasePunto','Bloques']
        writer.writerow(headers)
        def safe(value):
            text=str(value)
            return "'"+text if text.startswith(('=','+','-','@','\t','\r')) else text
        for p in db.list_points():
            if kind!='legacy' and p['clase']!=('recorrido' if kind=='route' else 'apertura'): continue
            lon=str(p['longitud']).replace('.',','); lat=str(p['latitud']).replace('.',',')
            identity=safe(p['import_id'] or 'local-'+str(p['id']))
            blocks=safe('|'.join(p['bloques']))
            if kind=='legacy':
                row=[p['numero'],safe(p['codigo']),p['tipo'],safe(p['categoria']),p['supervisor'],lat,lon,safe(p['descripcion']),identity,p['clase'],blocks]
            else:
                row=[identity,p['numero'],safe(p['codigo']),lon,lat,p['supervisor'] or 'Sin asignar',blocks]
            writer.writerow(row)
        return self.reply(200,'\ufeff'+out.getvalue(),'text/csv; charset=utf-8','centrality_'+kind+'.csv')

def serve():
    db.init_db()
    srv=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    print('\nCENTRALITY LOCAL')
    print(f'Abre http://127.0.0.1:{PORT}')
    print('Datos locales: datos/puntos.sqlite3')
    print('Detener: Ctrl+C\n')
    try:srv.serve_forever()
    except KeyboardInterrupt:pass
    finally:srv.server_close()
