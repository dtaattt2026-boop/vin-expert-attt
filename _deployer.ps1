# ============================================================
#  ATTT · VIN Expert — Déploiement GitHub Pages automatique
# ============================================================
$AppFolder = $PSScriptRoot
$GH_USER   = "dtaattt2026-boop"
$REPO_NAME = "vin-expert-attt"
$REPO_URL  = "https://github.com/$GH_USER/$REPO_NAME.git"
$PAGES_URL = "https://$GH_USER.github.io/$REPO_NAME/"

function Write-Step($n, $msg) { Write-Host "`n  [$n] $msg" -ForegroundColor Cyan }
function Write-OK($m)         { Write-Host "      OK  $m" -ForegroundColor Green }
function Write-ERR($m)        { Write-Host "      ERR $m" -ForegroundColor Red }
function Write-INFO($m)       { Write-Host "      ->  $m" -ForegroundColor Yellow }

Clear-Host
Write-Host ""
Write-Host "  ATTT · VIN Expert — Deploiement GitHub Pages" -ForegroundColor Cyan
Write-Host ""

Set-Location $AppFolder

# ── 1. Git ───────────────────────────────────────────────────
Write-Step 1 "Verification Git..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-INFO "Installation de Git..."
    winget install --id Git.Git -e --source winget --silent
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + $env:PATH
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-ERR "Git introuvable. Installez depuis https://git-scm.com"
        Read-Host "Entree pour quitter"; exit 1
    }
}
Write-OK (git --version)

# ── 2. GitHub CLI ────────────────────────────────────────────
Write-Step 2 "Verification GitHub CLI..."
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-INFO "Installation de GitHub CLI..."
    winget install --id GitHub.cli -e --source winget --silent
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")    + ";" + $env:PATH
    foreach ($p in @("$env:ProgramFiles\GitHub CLI\gh.exe",
                      "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe")) {
        if (Test-Path $p) { $env:PATH += ";" + (Split-Path $p); break }
    }
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-ERR "GitHub CLI introuvable. Telechargez : https://cli.github.com"
    Read-Host "Entree pour quitter"; exit 1
}
Write-OK (gh --version | Select-Object -First 1)

# ── 3. Authentification ──────────────────────────────────────
Write-Step 3 "Authentification GitHub..."
$authStatus = gh auth status 2>&1
if ($authStatus -match "Logged in") {
    Write-OK "Deja connecte"
} else {
    Write-INFO "Connexion via navigateur (une seule fois)..."
    gh auth login --web --git-protocol https
    if ($LASTEXITCODE -ne 0) { Write-ERR "Echec authentification"; Read-Host; exit 1 }
    Write-OK "Connecte"
}

# ── 4. Init dépôt local ──────────────────────────────────────
Write-Step 4 "Initialisation depot local..."
if (-not (Test-Path ".git")) {
    git init -q
    git branch -M main
}
git config user.name  "ATTT DTA"
git config user.email "dta.attt.2026@gmail.com"
Write-OK "OK"

# ── 5. Créer dépôt GitHub ────────────────────────────────────
Write-Step 5 "Creation depot GitHub '$REPO_NAME'..."
gh repo view "$GH_USER/$REPO_NAME" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    gh repo create $REPO_NAME --public --description "ATTT VIN Expert - Identification chassis VIN" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-ERR "Impossible de creer le depot"; Read-Host; exit 1 }
    Write-OK "Depot cree : $REPO_URL"
} else {
    Write-OK "Depot existant"
}

# ── 6. Fichiers + commit ─────────────────────────────────────
Write-Step 6 "Ajout des fichiers..."
git remote remove origin 2>$null
git remote add origin $REPO_URL

$files = @("ATTT.bat", "index.html", "panneau.html", "manifest.json", "sw.js", "gas-drive.js")
foreach ($f in $files) {
    if (Test-Path $f) { git add $f 2>$null }
}
git add -f "icons/" 2>$null

git diff --cached --quiet 2>$null
if ($LASTEXITCODE -ne 0) {
    git commit -m "VIN Expert ATTT - $(Get-Date -Format 'yyyy-MM-dd')" -q
    Write-OK "Commit effectue"
} else {
    Write-OK "Aucun changement a commiter"
}

# ── 7. Push ──────────────────────────────────────────────────
Write-Step 7 "Envoi vers GitHub..."
git push -u origin main --force 2>&1 | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
if ($LASTEXITCODE -ne 0) { Write-ERR "Push echoue"; Read-Host; exit 1 }
Write-OK "Push reussi"

# ── 8. GitHub Pages ──────────────────────────────────────────
Write-Step 8 "Activation GitHub Pages..."
Start-Sleep -Seconds 3
gh api "repos/$GH_USER/$REPO_NAME/pages" --method POST `
    -f "source[branch]=main" -f "source[path]=/" 2>&1 | Out-Null
Write-OK "GitHub Pages active"

# ── Résultat ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  ══════════════════════════════════════════" -ForegroundColor Green
Write-Host "   DEPLOIEMENT REUSSI !" -ForegroundColor Green
Write-Host "  ══════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  URL : $PAGES_URL" -ForegroundColor Cyan
Write-Host "  (disponible dans 2-5 minutes)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Android : Chrome → menu ⋮ → Ajouter a l'ecran d'accueil"
Write-Host "  iPhone  : Safari → Partager → Sur l'ecran d'accueil"
Write-Host "  PC      : icone + dans la barre d'adresse Chrome"
Write-Host ""
Start-Sleep -Seconds 5
Start-Process $PAGES_URL
Read-Host "Appuyez sur Entree pour fermer"
