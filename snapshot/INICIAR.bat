@echo off
setlocal
cd /d "%~dp0"
title Centrality Local
where py >nul 2>nul
if not errorlevel 1 (
  py -3 iniciar.py
) else (
  where python >nul 2>nul
  if not errorlevel 1 (
    python iniciar.py
  ) else (
    echo No se encontro Python. Instala Python 3.11 o posterior.
  )
)
echo.
echo Servidor detenido. Pulsa una tecla para cerrar.
pause >nul
