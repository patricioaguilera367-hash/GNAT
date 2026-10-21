"""python -m unittest discover -s tests -v"""
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from app import importers,db,captures

KML=b'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>1 - F697480</name><description>Postes c.a. 10 m</description><Point><coordinates>-72.590,-38.735,0</coordinates></Point></Placemark>
<Placemark><name>2 - SED_113</name><description>Subestaci&#243;n</description><Point><coordinates>-72.600,-38.740,0</coordinates></Point></Placemark>
<Placemark><name>Ruta no punto</name><LineString><coordinates>-72.5,-38.1 -72.4,-38.2</coordinates></LineString></Placemark>
</Document></kml>'''

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.override=patch.object(db,'DB_PATH',Path(self.temp.name)/'puntos.sqlite3')
        self.override.start()
        self.override_capdir=patch.object(captures,'CAPTURE_DIR',Path(self.temp.name)/'capturas')
        self.override_capdir.start()
        captures.CAPTURE_DIR.mkdir(parents=True,exist_ok=True)
        self.override_manifest=patch.object(captures,'MANIFEST',captures.CAPTURE_DIR/'indice.json')
        self.override_manifest.start()
        db.init_db()
    def tearDown(self):
        self.override_manifest.stop();self.override_capdir.stop();self.override.stop();self.temp.cleanup()
    def test_kml_points_only(self):
        result=importers.from_kml(KML,'test.kml')
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['codigo'],'F697480')
        self.assertEqual(result[0]['tipo'],'poste')
        self.assertEqual(result[1]['tipo'],'subestacion')
        self.assertAlmostEqual(result[0]['longitud'],-72.59)
    def test_kmz(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:archive.writestr('doc.kml',KML)
        self.assertEqual(len(importers.parse_kmz(stream.getvalue(),'prueba.kmz')),2)
    def test_csv_v2_and_exact_search(self):
        db.replace_points(importers.from_kml(KML,'test'))
        csv_data='Numero;CodigoPoste;Bloque;Longitud;Latitud\n1;F697480;Verde;-72.590;-38.735\n2;SED_113;Naranjo;-72.600;-38.740\n'
        rows,with_coords=importers.from_csv(csv_data.encode(),'reparto.csv')
        self.assertTrue(with_coords)
        # Existing V2 CSV has coordinates and can stand alone as a fresh import.
        self.assertEqual(len(rows),2)
        db.replace_points(rows)
        self.assertEqual(db.list_points()[0]['supervisor'],'Verde')
        result=db.search_exact(['F697480','F6974800','SED_113'],[])
        self.assertEqual([r['estado'] for r in result],['encontrado','no encontrado','encontrado'])
    def test_merge_preserves_type_when_not_provided(self):
        db.replace_points(importers.from_kml(KML,'test'))
        report=db.merge_attributes([{'numero':'1','codigo':'F697480','supervisor':'Azul'}])
        self.assertEqual(report['actualizados'],1)
        self.assertEqual(db.list_points()[0]['tipo'],'poste')
        self.assertEqual(db.list_points()[0]['supervisor'],'Azul')
    def test_duplicate_exact_is_ambiguous(self):
        a=importers.from_kml(KML,'test')
        a.append({**a[0],'numero':3})
        db.replace_points(a)
        self.assertEqual(db.search_exact(['F697480'],['poste'])[0]['estado'],'ambiguo')
    def test_csv_semicolon_and_code_exact(self):
        raw='Numero;CodigoPoste;Tipo;Categoria;Bloque;Latitud;Longitud\n1;F697480;poste;MT;Azul;-38.735;-72.590\n'
        rows,hascoords=importers.from_csv(raw.encode(),'a.csv')
        self.assertEqual(rows[0]['codigo'],'F697480');self.assertTrue(hascoords)
    def test_bad_kmz(self):
        with self.assertRaises(Exception):importers.parse_kmz(b'bad data','a.kmz')

if __name__=='__main__':unittest.main()
