@echo off
chcp 65001 >nul
title ATTT · VIN Expert

:MENU
cls
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║        ATTT · VIN Expert                     ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo     1.  Lancer l'application (agents)
echo.
echo     2.  Panneau d'administration
echo         (gestion agents, deploiement, mises a jour)
echo.
echo     3.  Deployer sur GitHub Pages
echo         (premiere fois uniquement)
echo.
echo     0.  Quitter
echo.
set /p CHOIX="  Votre choix : "

if "%CHOIX%"=="1" goto LANCER_APP
if "%CHOIX%"=="2" goto LANCER_PANNEAU
if "%CHOIX%"=="3" goto DEPLOYER
if "%CHOIX%"=="0" exit
goto MENU

:LANCER_APP
cls
echo  Demarrage du serveur...
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0_serveur.ps1" app
goto MENU

:LANCER_PANNEAU
cls
echo  Demarrage du serveur admin...
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0_serveur.ps1" panneau
goto MENU

:DEPLOYER
cls
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0_deployer.ps1"
goto MENU
