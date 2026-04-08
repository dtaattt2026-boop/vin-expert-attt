# ============================================================
#  ATTT · VIN Expert — Serveur local (Python HTTP)
# ============================================================
param([string]$page = "app")

$AppFolder = $PSScriptRoot
$pageFichier = if ($page -eq "panneau") { "panneau.html" } else { "index.html" }

# Auto-sync : récupérer la dernière version depuis GitHub
try {
    Push-Location $AppFolder
    $gitStatus = git status --porcelain 2>$null
    if (-not $gitStatus) {
        git pull origin main --ff-only 2>$null | Out-Null
        Write-Host "  [GIT] Synchronisation OK" -ForegroundColor Green
    } else {
        Write-Host "  [GIT] Fichiers modifiés localement, sync ignorée" -ForegroundColor Yellow
    }
    Pop-Location
} catch {
    Write-Host "  [GIT] Sync non disponible" -ForegroundColor Yellow
}

# Trouver un port libre
$port = 8082
foreach ($p in @(8082, 8083, 9080, 9090, 7070, 5000)) {
    $test = Test-NetConnection -ComputerName localhost -Port $p -WarningAction SilentlyContinue -InformationLevel Quiet 2>$null
    if (-not $test) { $port = $p; break }
}

$url = "http://localhost:$port"

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  ══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   ATTT · VIN Expert" -ForegroundColor Yellow
Write-Host "  ══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Application  : $url/$pageFichier" -ForegroundColor Green
if ($ip -and $page -ne "panneau") {
    Write-Host "  Smartphone   : http://$ip`:$port/index.html" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Ctrl+C pour arreter le serveur" -ForegroundColor Red
Write-Host ""

Start-Sleep -Milliseconds 800
Start-Process "$url/$pageFichier"

Set-Location $AppFolder

# Serveur Python custom : 0.0.0.0 (accessible depuis smartphone) + no-cache pour sw.js
$pyServer = @"
import http.server, socketserver, sys

class NoCacheSWHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path and ('sw.js' in self.path or 'manifest.json' in self.path):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
with socketserver.TCPServer(('0.0.0.0', port), NoCacheSWHandler) as httpd:
    print(f'Serveur sur 0.0.0.0:{port}')
    httpd.serve_forever()
"@

$pyFile = Join-Path $AppFolder "_server_tmp.py"
$pyServer | Set-Content -Path $pyFile -Encoding UTF8

if (Get-Command python -ErrorAction SilentlyContinue) {
    python $pyFile $port
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    py $pyFile $port
} else {
    Write-Host "Python introuvable. Installez Python ou ajoutez-le au PATH." -ForegroundColor Red
    exit 1
}
