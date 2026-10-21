"""CSV/KMZ/KML readers independent from HTTP/database layers."""
import csv
import io
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from html import unescape

COLUMNS = {'numero':['numero','n','n°','nº','id_punto'],
           'codigo':['codigo','codigo_poste','codigoposte','code','poste','nombre','subestacion'],
           'tipo':['tipo','clase','tipo_activo'],
           'categoria':['categoria','category'],
           'supervisor':['supervisor','bloque','grupo','supervisorcolor'],
           'latitud':['latitud','latitude','lat'],
           'longitud':['longitud','longitude','lon','lng'],
           'descripcion':['descripcion','description','detalle'],
           'import_id':['id'], 'clase':['clasepunto','clase_punto'], 'bloques':['bloques','bloqueid']}

def plain_text(s):
    return unescape(re.sub(r'<[^>]*>', ' ', s or '')).strip()

def infer_type(desc):
    s = (desc or '').lower()
    if 'subestaci' in s or re.search(r'\bsed\b',s): return 'subestacion'
    if 'poste' in s: return 'poste'
    return 'sin clasificar'

def strip_number(name):
    s=str(name or '').strip()
    return re.sub(r'^\d+\s*(?:[-–—·.:#/]\s*|\s+)', '', s).strip() or s

def from_kml(data, source_name):
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise ValueError('KML inválido: ' + str(e))
    result = []
    for placemark in root.iter():
        if placemark.tag.rsplit('}',1)[-1] != 'Placemark': continue
        name=''; desc=''; coords=[]
        for e in placemark.iter():
            tag=e.tag.rsplit('}',1)[-1]
            if e is placemark: continue
            if tag=='name' and not name: name=e.text or ''
            if tag=='description' and not desc: desc=plain_text(e.text or '')
        # Only Point coordinates; don't turn route vertices into assets.
        for e in placemark.iter():
            if e.tag.rsplit('}',1)[-1] != 'Point': continue
            for child in e.iter():
                if child.tag.rsplit('}',1)[-1]=='coordinates' and child.text:
                    for token in child.text.split():
                        a=token.split(',')
                        row=len(result)+1
                        if len(a)<2: raise ValueError(f'Fila {row}, columna Longitud/Latitud: coordenadas KML incompletas')
                        lon=coordinate(a[0],180,row,'Longitud')
                        lat=coordinate(a[1],90,row,'Latitud')
                        coords.append((lat,lon))
        for lat,lon in coords:
            result.append({'numero':len(result)+1, 'codigo':strip_number(name) or ('Punto '+str(len(result)+1)),
                           'tipo':infer_type(desc+' '+name),'categoria':'','supervisor':'',
                           'latitud':lat,'longitud':lon,'descripcion':desc,'origen':source_name})
    return result

def parse_kmz(blob, name):
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            candidate=[m for m in z.infolist() if m.filename.lower().endswith('.kml') and not m.is_dir()]
            if not candidate: raise ValueError('El KMZ no tiene archivos KML')
            candidate.sort(key=lambda i:(not i.filename.lower().endswith('doc.kml'),i.filename))
            if candidate[0].file_size>30_000_000: raise ValueError('KML interno demasiado grande')
            return from_kml(z.read(candidate[0]),name)
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError) as exc:
        raise ValueError('KMZ inválido o no compatible') from exc


def norm_head(s):
    import unicodedata
    s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower().strip()
    return re.sub(r'[^a-z0-9]+','_',s).strip('_')

def coordinate(value, limit, row, column):
    text = str(value).strip()
    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:[.,][0-9]*)?|[.,][0-9]+)(?:[eE][+-]?[0-9]+)?', text):
        raise ValueError(f'Fila {row}, columna {column}: coordenada inválida')
    number = float(text.replace(',', '.'))
    if not math.isfinite(number) or abs(number) > limit:
        raise ValueError(f'Fila {row}, columna {column}: coordenada fuera de rango')
    return number


def from_csv(blob, name):
    try: raw=blob.decode('utf-8-sig')
    except UnicodeDecodeError: raw=blob.decode('cp1252')
    try: dialect=csv.Sniffer().sniff(raw[:8192],delimiters=';,\t')
    except csv.Error: dialect=csv.excel; dialect.delimiter=';'
    reader=csv.DictReader(io.StringIO(raw), dialect=dialect, strict=True)
    if not reader.fieldnames: raise ValueError('CSV vacío')
    aliases = {key: {norm_head(a) for a in group} for key,group in COLUMNS.items()}
    field_map={}
    for col in reader.fieldnames:
        for canonical, choices in aliases.items():
            if norm_head(col) in choices:
                if canonical in field_map.values(): raise ValueError('Columna repetida: '+col)
                field_map[col]=canonical
                break
    mapped=set(field_map.values())
    if 'codigo' not in mapped: raise ValueError('Falta columna de código en CSV')
    if ('latitud' in mapped) != ('longitud' in mapped):
        raise ValueError('El CSV debe incluir ambas columnas Latitud y Longitud')
    headers = {norm_head(h) for h in reader.fieldnames}
    explicit = 'supervisorcolor' in headers or 'subestacion' in headers
    kind = 'apertura' if 'bloques' in headers and 'subestacion' not in headers else 'recorrido'
    hascoords = 'latitud' in mapped
    records=[]; ids=set(); numbers=set()
    try:
        for r in reader:
            row=reader.line_num
            if not any(v for v in r.values()): continue
            if None in r or any(v is None for v in r.values()):
                raise ValueError(f'Fila {row}: columnas incompletas o adicionales')
            n={field_map[k]:v.strip() for k,v in r.items() if k in field_map}
            if not n.get('codigo'): raise ValueError(f'Fila {row}, columna Código: valor vacío')
            number=n.get('numero') or str(len(records)+1)
            if not re.fullmatch(r'[0-9]+',number) or not 0<int(number)<=9007199254740991:
                raise ValueError(f'Fila {row}, columna Numero: entero positivo requerido')
            n['numero']=int(number)
            n['clase']=n.get('clase') or kind
            if n['clase'] not in ('recorrido','apertura'): raise ValueError(f'Fila {row}: Clase inválida')
            identity=n.get('import_id','')
            if identity and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,179}',identity) or (n['clase'],identity) in ids):
                raise ValueError(f'Fila {row}, columna ID: inválido o duplicado')
            if (n['clase'],n['numero']) in numbers: raise ValueError(f'Fila {row}, columna Numero: duplicado')
            ids.add((n['clase'],identity)); numbers.add((n['clase'],n['numero']))
            if not explicit: n['codigo']=strip_number(n['codigo'])
            supervisor=n.get('supervisor','')
            if supervisor == 'Sin asignar': supervisor=''
            supervisor=supervisor.capitalize()
            if supervisor not in ('','Verde','Naranjo','Azul'):
                raise ValueError(f'Fila {row}, columna SupervisorColor: color no válido')
            if 'supervisor' in n: n['supervisor']=supervisor
            blocks=n.get('bloques','').split('|')
            n['bloques']=list(dict.fromkeys(b.strip() for b in blocks if b.strip()))
            if 'bloqueid' in headers and len(n['bloques'])>1:
                raise ValueError(f'Fila {row}, columna BloqueID: admite un solo bloque')
            if hascoords:
                for column,limit in (('longitud',180),('latitud',90)):
                    n[column]=coordinate(n.get(column,''),limit,row,column.capitalize())
            n['origen']=name
            records.append(n)
    except csv.Error as exc:
        raise ValueError(f'Fila {reader.line_num}: CSV inválido ({exc})') from exc
    if not records: raise ValueError('No hay filas en CSV')
    return records,hascoords


def from_upload(filename, data):
    ext=filename.lower().rsplit('.',1)[-1]
    if ext=='kmz': return parse_kmz(data,filename),True
    if ext=='kml': return from_kml(data,filename),True
    if ext=='csv': return from_csv(data,filename)
    raise ValueError('Solo se admite KMZ, KML o CSV')
