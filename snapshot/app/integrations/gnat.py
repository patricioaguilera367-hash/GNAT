"""Offline GNAT contract. No HTTP transport or authentication is implemented."""
import copy
import json
import math
from datetime import datetime, timezone
from html.parser import HTMLParser


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def failure(code, message):
    return {'ok': False, 'data': None, 'error': {'code': code, 'message': message}, 'consulted_at': timestamp()}


def success(data):
    return {'ok': True, 'data': data, 'error': None, 'consulted_at': timestamp()}


class TextOnly(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
        if tag in ('div', 'p', 'br', 'li', 'td'): self.parts.append(' ')

    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def metadata_text(value):
    """Extract text, not reusable HTML. UI must still use textContent."""
    if isinstance(value, list):
        return '\n'.join(metadata_text(item.get('content', '')) for item in value[:30] if isinstance(item, dict))[:8000]
    if not isinstance(value, str): return ''
    parser = TextOnly()
    parser.feed(value[:64000])
    return ' '.join(''.join(parser.parts).split())[:8000]


def validate_geometry(geometry):
    if not isinstance(geometry, dict): raise ValueError('Falta geometría GeoJSON')
    kind = geometry.get('type')
    coordinates = geometry.get('coordinates')

    def position(p):
        if not isinstance(p, list) or len(p) not in (2, 3): return False
        if not all(type(v) in (int, float) and math.isfinite(v) for v in p): return False
        return -180 <= p[0] <= 180 and -90 <= p[1] <= 90

    def line(values):
        return isinstance(values, list) and 2 <= len(values) <= 10000 and all(position(p) for p in values)

    valid = (kind == 'Point' and position(coordinates) or
             kind == 'LineString' and line(coordinates) or
             kind == 'MultiLineString' and isinstance(coordinates, list) and
             1 <= len(coordinates) <= 100 and all(line(values) for values in coordinates))
    if not valid: raise ValueError('GeoJSON inválido: se requieren coordenadas WGS84 [longitud, latitud]')
    return {'type': kind, 'coordinates': copy.deepcopy(coordinates)}


def normalize_response(body, *, http_status=200, transport_error=None, source='GNAT no validado'):
    """Validate supplied diagnostic responses; this function sends no requests."""
    if transport_error is not None:
        code = 'timeout' if isinstance(transport_error, TimeoutError) else 'connection_error'
        return failure(code, 'La consulta no pudo completarse; los puntos locales no cambiaron')
    if http_status in (401, 403): return failure('not_authorized', 'Acceso no autorizado (401/403)')
    if http_status != 200: return failure('http_error', 'Respuesta HTTP no válida')
    if body is None or body == '' or body == b'': return failure('empty_response', 'Respuesta vacía')
    if isinstance(body, (str, bytes)):
        if len(body) > 256000: return failure('invalid_response', 'Respuesta demasiado grande')
        try: body = json.loads(body)
        except (ValueError, UnicodeDecodeError): return failure('invalid_json', 'JSON inválido')
    if not isinstance(body, dict) or not isinstance(body.get('success'), bool):
        return failure('invalid_response', 'Falta el indicador success')
    if body['success'] is False: return failure('service_error', 'El servicio informó success:false')
    feature = body.get('data')
    if not isinstance(feature, dict) or feature.get('type') != 'Feature' or feature.get('id') is None:
        return failure('invalid_response', 'Falta un Feature con ID')
    identity = feature['id']
    if type(identity) not in (int, str) or not str(identity).strip() or len(str(identity)) > 180:
        return failure('invalid_response', 'ID no válido')
    properties = feature.get('properties')
    if not isinstance(properties, dict) or not isinstance(properties.get('display_name'), str):
        return failure('invalid_response', 'Falta properties.display_name')
    try: geometry = validate_geometry(feature.get('geometry'))
    except ValueError as exc: return failure('invalid_geometry', str(exc))
    return success({'id': str(identity).strip(), 'name': properties['display_name'][:180],
                    'code': properties['display_name'].strip().upper()[:180],
                    'asset_type': str(properties.get('asset_type', 'sin clasificar'))[:80],
                    'geometry': geometry, 'metadata': metadata_text(properties.get('description', '')),
                    'source': source, 'consulted_at': timestamp(),
                    'synthetic': bool(properties.get('synthetic', False)),
                    'raw_response': copy.deepcopy(body)})


def public_result(value):
    """Never dump raw diagnostic JSON/HTML to the browser or a file."""
    if isinstance(value, dict): return {k: public_result(v) for k, v in value.items() if k != 'raw_response'}
    if isinstance(value, list): return [public_result(item) for item in value]
    return value


class DisconnectedAdapter:
    def get_connection_status(self):
        return {'state': 'disconnected', 'mode': 'disconnected', 'validated': False,
                'source': 'Configuración local', 'message': 'GNAT no disponible: contrato y autorización pendientes'}

    def search_assets(self, query, asset_types=None, pagination=None):
        return failure('disconnected', 'No hay una conexión GNAT validada')

    def get_asset_geometry(self, object_id):
        return failure('disconnected', 'No hay una conexión GNAT validada')

    def get_asset_metadata(self, object_id):
        return failure('disconnected', 'No hay una conexión GNAT validada')

    def get_asset_by_id(self, object_id):
        return failure('disconnected', 'No hay una conexión GNAT validada')

    def list_available_layers(self):
        return success([])


class FixtureAdapter(DisconnectedAdapter):
    """Explicit opt-in MOCK; known point plus synthetic lines, not a live service."""
    def __init__(self):
        examples = [
            ('8659987', 'F5353', 'poste', {'type': 'Point', 'coordinates': [-72.06376236, -37.780086409]}, False),
            ('SYN-LINE', 'SINTETICO_LINEA', 'tramo', {'type': 'LineString', 'coordinates': [[-72.064, -37.780], [-72.063, -37.781]]}, True),
            ('SYN-MULTI', 'SINTETICO_MULTILINEA', 'tramo', {'type': 'MultiLineString', 'coordinates': [[[-72.064, -37.780], [-72.063, -37.781]], [[-72.062, -37.779], [-72.061, -37.780]]]}, True)
        ]
        self.assets = []
        for identity, name, kind, geometry, synthetic in examples:
            raw = {'success': True, 'data': {'id': identity, 'type': 'Feature', 'geometry': geometry,
                   'properties': {'display_name': name, 'asset_type': kind, 'synthetic': synthetic,
                                  'description': '<b>MOCK</b>: geometría sintética' if synthetic else '<b>MOCK</b>: punto del informe aportado; sin consulta actual'}}}
            self.assets.append(normalize_response(raw, source='MOCK · fixture local; no es una consulta GNAT')['data'])

    def get_connection_status(self):
        return {**super().get_connection_status(), 'mode': 'MOCK', 'message': 'Solo fixtures MOCK; GNAT sigue desconectado'}

    def search_assets(self, query, asset_types=None, pagination=None):
        if not isinstance(query, str) or len(query) > 180: return failure('invalid_query', 'Código de hasta 180 caracteres requerido')
        if asset_types is not None and (not isinstance(asset_types, list) or any(not isinstance(t, str) for t in asset_types)):
            return failure('invalid_query', 'Tipos de activo no válidos')
        # No speculative server pagination: the local fixture set is deliberately finite.
        if pagination: return failure('unavailable', 'Paginación no validada')
        code = query.strip().upper()
        matches = [copy.deepcopy(a) for a in self.assets if a['code'] == code and (not asset_types or a['asset_type'] in asset_types)]
        return success({'state': 'found' if len(matches) == 1 else 'ambiguous' if matches else 'not_found', 'matches': matches})

    def get_asset_by_id(self, object_id):
        matches = [a for a in self.assets if a['id'] == str(object_id).strip()]
        return success(copy.deepcopy(matches[0])) if len(matches) == 1 else failure('not_found', 'ID ausente del conjunto MOCK')

    def get_asset_geometry(self, object_id):
        result = self.get_asset_by_id(object_id)
        return success(result['data']['geometry']) if result['ok'] else result

    def get_asset_metadata(self, object_id):
        result = self.get_asset_by_id(object_id)
        if result['ok']: result['data'].pop('geometry', None)
        return result
