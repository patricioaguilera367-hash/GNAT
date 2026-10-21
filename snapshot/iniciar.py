"""Iniciar visor local. No instala paquetes, no pide credenciales."""
import threading
import time
import webbrowser
from app.server import serve, PORT

def open_later():
    time.sleep(0.8)
    webbrowser.open(f'http://127.0.0.1:{PORT}')

if __name__=='__main__':
    threading.Thread(target=open_later,daemon=True).start()
    serve()
