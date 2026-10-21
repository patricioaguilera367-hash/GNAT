import os
import subprocess
import tempfile
import unittest
from pathlib import Path

@unittest.skipUnless(os.name=='nt','Windows CMD launcher')
class LauncherTests(unittest.TestCase):
    def run_launcher(self,with_py):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            log=root/'called.txt'
            for name in (('python','py') if with_py else ('python',)):
                (root/(name+'.cmd')).write_text('@echo off\necho '+name+' %* > "'+str(log)+'"\nexit /b 0\n')
            env={**os.environ,'PATH':str(root)+';'+os.environ['SystemRoot']+'\\System32'}
            subprocess.run([os.environ['COMSPEC'],'/d','/c',str(Path('INICIAR.bat').resolve())],input='\n',text=True,capture_output=True,env=env,timeout=10)
            return log.read_text().strip() if log.exists() else ''
    def test_python_fallback_when_py_missing(self):
        self.assertEqual(self.run_launcher(False),'python iniciar.py')
    def test_py_launcher_when_available(self):
        self.assertEqual(self.run_launcher(True),'py -3 iniciar.py')
