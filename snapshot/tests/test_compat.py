import io
from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app import db, importers

ROUTE = "ID;Numero;Subestacion;Longitud;Latitud;SupervisorColor;BloqueID\nr-9;9;SED_9;-72,59;-38,735;Verde;B1\nr-21;21;SED_21;-72,60;-38,74;Sin asignar;B2\n"
OPENING = "ID;Numero;Codigo;Longitud;Latitud;SupervisorColor;Bloques\na-4;4;F5353;-72,59;-38,735;Azul;B1|B2\n"

class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'work.sqlite3'
        self.patch = patch.object(db, 'DB_PATH', self.path)
        self.patch.start()
        db.init_db()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def load(self, text):
        rows, coordinates = importers.from_csv(text.encode(), 'prueba.csv')
        self.assertTrue(coordinates)
        db.replace_points(rows)

    def test_route_and_shared_openings_coexist_with_gaps(self):
        self.load(ROUTE)
        route_ids = [p['id'] for p in db.list_points()]
        self.load(OPENING)
        points = db.list_points()
        self.assertEqual([p['numero'] for p in points], [4, 9, 21])
        self.assertEqual(points[0]['clase'], 'apertura')
        self.assertEqual(points[0]['bloques'], ['B1', 'B2'])
        self.assertEqual(points[1]['import_id'], 'r-9')
        self.assertEqual([p['id'] for p in points[1:]], route_ids)
        self.assertEqual(points[2]['supervisor'], '')
        self.assertAlmostEqual(points[1]['longitud'], -72.59)

    def test_replacing_one_kind_never_deletes_other(self):
        self.load(ROUTE)
        self.load(OPENING)
        opening = next(p for p in db.list_points() if p['clase'] == 'apertura')
        self.load(ROUTE.replace('SED_9', 'SED_NEW'))
        self.assertIn(opening, db.list_points())
        self.assertEqual(len(db.list_points()), 3)

    def test_csv_invalid_coordinates_are_atomic_and_locate_row_column(self):
        self.load(OPENING)
        before = db.list_points()
        for value in ('-72590000', 'NaN', 'Infinity', '-72.59.00', '', '1e999'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, r'Fila 2.*Longitud'):
                    self.load(ROUTE.replace('-72,59', value))
                self.assertEqual(db.list_points(), before)

    def test_duplicate_identity_number_and_invalid_supervisor_rejected(self):
        for text in (ROUTE.replace('r-21', 'r-9'), ROUTE.replace(';21;', ';9;'),
                     ROUTE.replace(';Verde;', ';Rojo;'), ROUTE.replace(';9;', ';0;'),
                     ROUTE.replace(';B1\n', ';B1|B2\n')):
            with self.subTest(text=text):
                with self.assertRaises(ValueError):
                    self.load(text)
        self.assertEqual(db.list_points(), [])

    def test_invalid_kmz_is_validation_error(self):
        with self.assertRaises(ValueError):
            importers.parse_kmz(b'not zip', 'mal.kmz')

    def test_legacy_schema_migrates_once_with_backup_and_no_loss(self):
        self.path.unlink()
        schema = """CREATE TABLE puntos (id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER NOT NULL, codigo TEXT NOT NULL, codigo_busqueda TEXT NOT NULL, tipo TEXT DEFAULT 'sin clasificar', categoria TEXT DEFAULT '', supervisor TEXT DEFAULT '', latitud REAL NOT NULL, longitud REAL NOT NULL, descripcion TEXT DEFAULT '', origen TEXT DEFAULT '', actualizado TEXT NOT NULL);"""
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.executescript(schema)
            conn.execute("INSERT INTO puntos (id,numero,codigo,codigo_busqueda,latitud,longitud,actualizado,supervisor) VALUES (83,91,'F_83','F_83',-38,-72,'old','Azul')")
        db.init_db()
        db.init_db()
        point = db.list_points()[0]
        self.assertEqual((point['id'], point['numero'], point['codigo'], point['supervisor']), (83, 91, 'F_83', 'Azul'))
        self.assertEqual(point['clase'], 'recorrido')
        backups = list(self.path.parent.glob('work.sqlite3.pre-*.bak'))
        self.assertEqual(len(backups), 1)
        with closing(sqlite3.connect(backups[0])) as conn:
            self.assertEqual(conn.execute('SELECT id,numero,codigo FROM puntos').fetchone(), (83,91,'F_83'))
            self.assertNotIn('clase', [r[1] for r in conn.execute('PRAGMA table_info(puntos)')])

    def test_legacy_attributes_preserve_added_fields(self):
        self.load(OPENING)
        db.merge_attributes([{'numero':4, 'codigo':'F5353', 'supervisor':'Naranjo'}])
        point = db.list_points()[0]
        self.assertEqual((point['clase'], point['bloques'], point['supervisor']), ('apertura',['B1','B2'],'Naranjo'))

    def test_malformed_kml_point_rejects_whole_import(self):
        from test_core import KML
        for bad in (b'not-number',b'-7259000'):
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(ValueError, 'Longitud'):
                    importers.from_kml(KML.replace(b'-72.590',bad),'bad.kml')

    def test_legacy_clase_header_remains_asset_type_not_point_kind(self):
        text='Numero;CodigoPoste;Clase;Bloque;Latitud;Longitud\n5;SED_LEGACY;subestacion;Verde;-38,74;-72,60\n'
        self.load(text)
        point=db.list_points()[0]
        self.assertEqual((point['tipo'],point['clase'],point['codigo']),('subestacion','recorrido','SED_LEGACY'))
