"""Georeferenced manual viewport capture imports (NO automated scraping)."""
import base64
import json
import math
import re
import uuid
from pathlib import Path
from .config import CAPTURE_DIR

MANIFEST = CAPTURE_DIR / 'indice.json'
MAGIC = b'\x89PNG\r\n\x1a\n'
MERCATOR_LIMIT = 20037508.35

def list_captures():
    if not MANIFEST.exists(): return []
    try: return json.loads(MANIFEST.read_text(encoding='utf8'))
    except (ValueError, OSError): return []

def persist(items):
    tmp = MANIFEST.with_suffix('.tmp')
    tmp.write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf8')
    tmp.replace(MANIFEST)

def add_capture(payload):
    if payload.get('format')!='centrality-local-capture-v1':
        raise ValueError('No es una captura compatible')
    bounds=payload.get('bounds3857',[])
    if len(bounds)!=4: raise ValueError('Falta extensión geográfica EPSG:3857')
    try: a,b,c,d=map(float,bounds)
    except (TypeError,ValueError): raise ValueError('Extensión inválida')
    if not all(math.isfinite(v) and -MERCATOR_LIMIT-1000<v<MERCATOR_LIMIT+1000 for v in (a,b,c,d)) or a>=c or b>=d:
        raise ValueError('Extensión fuera de rango')
    data=str(payload.get('imageDataUrl',''))
    if not data.startswith('data:image/png;base64,'): raise ValueError('Se requiere imagen PNG')
    try: binary=base64.b64decode(data.partition(',')[2],validate=True)
    except Exception: raise ValueError('PNG base64 inválido')
    if not binary.startswith(MAGIC) or len(binary)>12*1024*1024: raise ValueError('PNG inválido o demasiado grande')
    width,height=int.from_bytes(binary[16:20],'big'),int.from_bytes(binary[20:24],'big')
    if width<100 or height<100 or width>10000 or height>10000: raise ValueError('Dimensiones de imagen inválidas')
    filename=str(uuid.uuid4())+'.png'
    (CAPTURE_DIR / filename).write_bytes(binary)
    entry={'id':filename[:-4], 'archivo':filename, 'bounds3857':[a,b,c,d],
           'width':width,'height':height,'zoom':payload.get('zoom'),
           'fecha':str(payload.get('capturedAt') or '')[:40]}
    existing=list_captures()
    existing.append(entry)
    persist(existing)
    return entry

def delete_capture(cid):
    if not re.fullmatch(r'[a-f0-9\-]{36}',str(cid)):raise ValueError('Identificador inválido')
    items=list_captures()
    survivors=[x for x in items if x['id']!=cid]
    if len(items)==len(survivors):raise ValueError('Captura no encontrada')
    persist(survivors)
    (CAPTURE_DIR / (cid+'.png')).unlink(missing_ok=True)
