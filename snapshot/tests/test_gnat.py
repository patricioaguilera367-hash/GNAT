import importlib
import json
import unittest
from unittest.mock import patch

try:
    gnat=importlib.import_module('app.integrations.gnat')
except ModuleNotFoundError:
    gnat=None

POINT={"success":True,"data":{"type":"Feature","geometry":{"type":"Point","coordinates":[-72.06376236,-37.780086409]},"id":8659987,"properties":{"display_name":"F5353"}}}

class GNATTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(gnat,'Falta el adaptador GNAT aislado')
    def test_disconnected_adapter_truthful_no_network(self):
        with patch('socket.create_connection',side_effect=AssertionError('No network')):
            adapter=gnat.DisconnectedAdapter()
            self.assertFalse(adapter.get_connection_status()['validated'])
            for value in (adapter.search_assets('F5353'),adapter.get_asset_geometry('8659987'),
                          adapter.get_asset_metadata('8659987'),adapter.get_asset_by_id('8659987')):
                self.assertFalse(value['ok']);self.assertEqual(value['error']['code'],'disconnected')
            self.assertEqual(adapter.list_available_layers()['data'],[])
    def test_mock_exact_search_types_and_ambiguity(self):
        adapter=gnat.FixtureAdapter()
        self.assertEqual(adapter.search_assets(' f5353 ')['data']['state'],'found')
        self.assertEqual(adapter.search_assets('F535')['data']['state'],'not_found')
        self.assertEqual(adapter.search_assets('F5353', ['subestacion'])['data']['state'],'not_found')
        row=adapter.assets[0]
        duplicate={**row,'id':'another-id'}
        adapter.assets.append(duplicate)
        self.assertEqual(adapter.search_assets('F5353')['data']['state'],'ambiguous')
        self.assertEqual(adapter.get_connection_status()['mode'],'MOCK')
        self.assertFalse(adapter.get_connection_status()['validated'])
    def test_point_normalized_wgs84_provenance_and_raw_in_memory_only(self):
        out=gnat.normalize_response(json.dumps(POINT),source='diagnostico autorizado')
        self.assertTrue(out['ok'])
        asset=out['data'];self.assertEqual(asset['id'],'8659987')
        self.assertEqual(asset['geometry']['coordinates'],[-72.06376236,-37.780086409])
        self.assertEqual(asset['source'],'diagnostico autorizado')
        self.assertTrue(asset['consulted_at'].endswith('+00:00'))
        self.assertEqual(asset['raw_response'],POINT)
        public=gnat.public_result(out)
        self.assertNotIn('raw_response',public['data'])
        self.assertEqual(out['data']['raw_response'],POINT)
    def test_mock_line_and_multiline_are_synthetic(self):
        adapter=gnat.FixtureAdapter()
        for identity,kind in [('SYN-LINE','LineString'),('SYN-MULTI','MultiLineString')]:
            result=adapter.get_asset_by_id(identity)
            self.assertTrue(result['ok']);self.assertEqual(result['data']['geometry']['type'],kind)
            self.assertTrue(result['data']['synthetic']);self.assertIn('MOCK',result['data']['source'])
        self.assertFalse(adapter.get_asset_geometry('8659985')['ok'])
    def test_malformed_geojson_is_rejected_not_guessed(self):
        for geometry in ({'type':'Point','coordinates':[-181,0]}, {'type':'Point','coordinates':[True,1]},
                         {'type':'Point','coordinates':[1,float('nan')]}, {'type':'LineString','coordinates':[[1,2]]},
                         {'type':'MultiLineString','coordinates':[]}, {'type':'Polygon','coordinates':[]},
                         {'type':'Point','coordinates':['-72','-38']}):
            with self.subTest(geometry=geometry):
                response={**POINT,'data':{**POINT['data'],'geometry':geometry}}
                self.assertEqual(gnat.normalize_response(response)['error']['code'],'invalid_geometry')
    def test_errors_http_timeout_and_invalid_payloads(self):
        for status in (401,403):
            self.assertEqual(gnat.normalize_response(POINT,http_status=status)['error']['code'],'not_authorized')
        self.assertEqual(gnat.normalize_response(POINT,transport_error=TimeoutError())['error']['code'],'timeout')
        self.assertEqual(gnat.normalize_response(POINT,transport_error=ConnectionError())['error']['code'],'connection_error')
        for body,code in [('', 'empty_response'),('{','invalid_json'),({},'invalid_response'),
                          ({'success':False},'service_error'),({'success':True},'invalid_response'),
                          ({'success':True,'data':None},'invalid_response')]:
            with self.subTest(body=body):self.assertEqual(gnat.normalize_response(body)['error']['code'],code)
    def test_metadata_html_scripts_widgets_never_become_executable(self):
        raw='<div><b>Cable:</b> 6 AWG</div><script>alert(1)</script><img src=x onerror=alert(2)><style>body{}</style>'
        text=gnat.metadata_text(raw)
        self.assertIn('Cable:',text);self.assertIn('6 AWG',text)
        self.assertNotIn('<',text);self.assertNotIn('alert',text);self.assertNotIn('body{}',text)
        self.assertEqual(gnat.metadata_text([{'widget_id':3,'content':'<b>Dato</b>'}]),'Dato')
    def test_mock_api_does_not_modify_points(self):
        adapter=gnat.FixtureAdapter()
        with patch('app.db.replace_points',side_effect=AssertionError('No point mutations')):
            self.assertTrue(adapter.get_asset_metadata('8659987')['ok'])
            self.assertTrue(adapter.get_asset_geometry('8659987')['ok'])
