"""Compatible local SQLite store. Coordinates are WGS84 latitude/longitude."""
import sqlite3
import json
from contextlib import closing
from contextlib import contextmanager
from datetime import datetime, timezone
from .config import DB_PATH

COLUMNS = ('numero','codigo','tipo','categoria','supervisor','latitud','longitud','descripcion','origen','clase','import_id','bloques')
SELECT_COLUMNS = 'id, ' + ', '.join(COLUMNS)
WRITE_COLUMNS = ('numero','codigo','codigo_busqueda',*COLUMNS[2:],'actualizado')
VALID_TYPES = {'poste','subestacion','sin clasificar','otro'}
VALID_SUPERVISORS = {'', 'Verde', 'Naranjo', 'Azul'}

@contextmanager
def connection():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    finally:
        db.close()

def init_db():
    with connection() as db:
        columns = {r[1] for r in db.execute('PRAGMA table_info(puntos)')}
        additions = {'clase': "TEXT NOT NULL DEFAULT 'recorrido'",
                     'import_id': "TEXT NOT NULL DEFAULT ''", 'bloques': "TEXT NOT NULL DEFAULT '[]'"}
        missing = additions.keys() - columns
        if columns and missing:
            backup = DB_PATH.with_name(DB_PATH.name + '.pre-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.bak')
            with closing(sqlite3.connect(backup)) as dest:
                db.backup(dest)
            for name in sorted(missing):
                db.execute('ALTER TABLE puntos ADD COLUMN ' + name + ' ' + additions[name])
            db.commit()
        db.executescript('''
        CREATE TABLE IF NOT EXISTS puntos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            codigo_busqueda TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'sin clasificar',
            categoria TEXT NOT NULL DEFAULT '',
            supervisor TEXT NOT NULL DEFAULT '',
            latitud REAL NOT NULL CHECK(latitud BETWEEN -90 AND 90),
            longitud REAL NOT NULL CHECK(longitud BETWEEN -180 AND 180),
            descripcion TEXT NOT NULL DEFAULT '',
            origen TEXT NOT NULL DEFAULT '',
            actualizado TEXT NOT NULL,
            clase TEXT NOT NULL DEFAULT 'recorrido',
            import_id TEXT NOT NULL DEFAULT '',
            bloques TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_codigo ON puntos(codigo_busqueda);
        CREATE INDEX IF NOT EXISTS idx_numero ON puntos(numero);
        ''')

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def clean_code(code):
    return str(code or '').strip().upper()

def clean_record(record):
    c = str(record.get('codigo','')).strip()
    if not c:
        raise ValueError('Hay un punto sin código')
    lat = float(record['latitud']); lon = float(record['longitud'])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError('Coordenadas fuera de rango')
    tipo = str(record.get('tipo') or 'sin clasificar').strip().lower()
    if tipo not in VALID_TYPES: tipo = 'otro'
    supervisor = str(record.get('supervisor') or '').strip().capitalize()
    if supervisor not in VALID_SUPERVISORS: supervisor = ''
    kind = record.get('clase') or 'recorrido'
    if kind not in ('recorrido','apertura'): raise ValueError('Clase no válida')
    blocks = record.get('bloques') or []
    if not isinstance(blocks, list): raise ValueError('Bloques debe ser una lista')
    return (int(record.get('numero') or 0), c, clean_code(c), tipo,
            str(record.get('categoria') or '')[:180], supervisor, lat, lon,
            str(record.get('descripcion') or '')[:1000], str(record.get('origen') or '')[:180], kind, str(record.get('import_id') or '')[:180],
            json.dumps(list(dict.fromkeys(str(b).strip() for b in blocks if str(b).strip())),ensure_ascii=False), now_iso())

def decode_point(row):
    point = dict(row)
    point['bloques'] = json.loads(point['bloques'])
    return point


def list_points():
    with connection() as db:
        return [decode_point(r) for r in db.execute('SELECT '+SELECT_COLUMNS+' FROM puntos ORDER BY numero, id')]


def replace_points(records):
    normalized = [clean_record(r) for r in records]
    if not normalized: raise ValueError('El archivo no contiene puntos válidos')
    kinds = {r[10] for r in normalized}
    with connection() as db:
        db.executemany('DELETE FROM puntos WHERE clase=?', [(kind,) for kind in kinds])
        db.executemany('INSERT INTO puntos ('+','.join(WRITE_COLUMNS)+') VALUES ('+','.join('?' for _ in WRITE_COLUMNS)+')', normalized)
    return len(normalized)


def update_point(id_, changes):
    allowed = {'codigo', 'tipo', 'categoria', 'supervisor', 'descripcion'}
    edits = {key: val for key, val in changes.items() if key in allowed}
    if not edits: raise ValueError('Sin campos editables')
    if 'codigo' in edits:
        edits['codigo'] = str(edits['codigo']).strip()
        if not edits['codigo']: raise ValueError('Código vacío')
        edits['codigo_busqueda'] = clean_code(edits['codigo'])
    if 'tipo' in edits:
        if edits['tipo'] not in VALID_TYPES: raise ValueError('Tipo no válido')
    if 'supervisor' in edits:
        if edits['supervisor'] not in VALID_SUPERVISORS: raise ValueError('Supervisor no válido')
    for key in ('categoria', 'descripcion'):
        if key in edits: edits[key] = str(edits[key])[:(180 if key=='categoria' else 1000)]
    edits['actualizado'] = now_iso()
    with connection() as db:
        cur = db.execute('UPDATE puntos SET ' + ','.join(k+'=?' for k in edits) + ' WHERE id=?', list(edits.values())+[int(id_)])
        if not cur.rowcount: raise ValueError('Punto inexistente')
        r = db.execute('SELECT '+SELECT_COLUMNS+' FROM puntos WHERE id=?', (int(id_),)).fetchone()
        return decode_point(r)

def bulk_supervisor(ids, supervisor):
    if supervisor not in VALID_SUPERVISORS: raise ValueError('Supervisor no válido')
    ids = [int(x) for x in ids]
    if not ids or len(ids)>10000: raise ValueError('Seleccione puntos válidos')
    with connection() as db:
        db.executemany('UPDATE puntos SET supervisor=?, actualizado=? WHERE id=?', [(supervisor, now_iso(), i) for i in ids])
    return len(ids)

def merge_attributes(rows):
    """Update existing points by BOTH numero and exact code; keep omitted fields intact."""
    updates = 0; misses = []
    allowed = {'tipo','categoria','descripcion','supervisor'}
    with connection() as db:
        for r in rows:
            number = int(r.get('numero') or 0)
            code = clean_code(r.get('codigo'))
            matches = db.execute('SELECT id FROM puntos WHERE numero=? AND codigo_busqueda=?', (number, code)).fetchall()
            if len(matches)!=1:
                misses.append({'numero':number,'codigo':code,'coincidencias':len(matches)})
                continue
            fields = {k:r[k] for k in allowed if k in r}
            if 'tipo' in fields:
                fields['tipo']=str(fields['tipo'] or 'sin clasificar').lower()
                if fields['tipo'] not in VALID_TYPES:fields['tipo']='otro'
            if 'supervisor' in fields:
                fields['supervisor']=str(fields['supervisor'] or '').capitalize()
                if fields['supervisor'] not in VALID_SUPERVISORS:fields['supervisor']=''
            if not fields:continue
            fields['actualizado']=now_iso()
            db.execute('UPDATE puntos SET '+','.join(k+'=?' for k in fields)+' WHERE id=?', [*fields.values(),matches[0]['id']])
            updates += 1
    return {'actualizados':updates,'sin_coincidencia':misses}

def search_exact(codes, types):
    codes=[clean_code(c) for c in codes if clean_code(c)]
    types=set(types).intersection(VALID_TYPES)
    with connection() as db:
        outcomes=[]
        for code in codes[:500]:
            matches=[dict(r) for r in db.execute('SELECT id,numero,codigo,tipo,categoria,supervisor,latitud,longitud FROM puntos WHERE codigo_busqueda=? ORDER BY numero,id',(code,))]
            selected=[r for r in matches if r['tipo'] in types] if types else matches
            reason = 'encontrado' if len(selected)==1 else ('ambiguo' if len(selected)>1 else 'no encontrado')
            outcomes.append({'codigo':code,'estado':reason,'coincidencias':selected,'total_codigo':len(matches)})
        return outcomes
