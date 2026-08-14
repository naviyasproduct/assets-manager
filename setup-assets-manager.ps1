# =====================================================================
# Assets Manager - one-shot setup script for dad's laptop
#
# WHAT THIS DOES:
#   - Verifies Node.js v20+ and PostgreSQL are installed
#   - Creates the 'assets' DB role and 'assets_manager' database
#     (owned by 'assets', which is required on Postgres 15+)
#   - Runs npm install
#   - Builds .env from .env.example, filling in DATABASE_URL,
#     a fresh SESSION_SECRET, VIDEO_STORAGE_DIR (auto-picks the
#     biggest non-C: drive if one exists), and PUPPETEER_EXECUTABLE_PATH
#     (auto-detects installed Chrome)
#   - Runs migrations + seed
#
# WHAT YOU STILL DO MANUALLY, BEFORE RUNNING THIS:
#   1. Install Node.js LTS from https://nodejs.org/
#   2. Install PostgreSQL 16 from https://www.postgresql.org/download/windows/
#      - keep port 5432
#      - set and REMEMBER the 'postgres' superuser password
#   3. Clone the repo (e.g. via GitHub Desktop), then open PowerShell
#      in the repo folder (not Command Prompt) and run this script:
#         powershell -ExecutionPolicy Bypass -File .\setup-assets-manager.ps1
#
# It's safe to re-run this script - it skips steps that are already done.
# =====================================================================

$ErrorActionPreference = "Stop"

# On PowerShell 7.3+, any text a native program (psql, npm, npx, node...)
# writes to its warning/error stream is treated as a fatal script error,
# even if the program itself succeeded. psql on this machine prints a
# harmless "Console code page ... differs" warning on almost every call,
# which was aborting this script even when the command actually worked.
# This turns that behavior off so only real failures (non-zero exit codes,
# actual thrown errors) stop the script.
$PSNativeCommandUseErrorActionPreference = $false

function Section($msg) {
    Write-Host "`n=== $msg ===" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------
# 1. Check Node.js
# ---------------------------------------------------------------------
Section "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js not found." -ForegroundColor Red
    Write-Host "Install the LTS build from https://nodejs.org/ , then re-run this script."
    exit 1
}
$nodeVersion = (node -v)
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 20) {
    Write-Host "Found Node $nodeVersion, but v20 or higher is required." -ForegroundColor Red
    Write-Host "Install the LTS build from https://nodejs.org/ , then re-run this script."
    exit 1
}
Write-Host "Node $nodeVersion OK" -ForegroundColor Green

# ---------------------------------------------------------------------
# 2. Check PostgreSQL (psql on PATH)
# ---------------------------------------------------------------------
Section "Checking PostgreSQL"
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    Write-Host "psql not found on PATH." -ForegroundColor Red
    Write-Host "Install PostgreSQL 16 from https://www.postgresql.org/download/windows/"
    Write-Host "(keep port 5432, remember the postgres superuser password), then re-run this script."
    exit 1
}
Write-Host "PostgreSQL found" -ForegroundColor Green

# ---------------------------------------------------------------------
# 3. Confirm we're in the repo root
# ---------------------------------------------------------------------
if (-not (Test-Path ".env.example")) {
    Write-Host ".env.example not found in this folder - run this script from the repo root." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------
# 4. Create DB role + database
# ---------------------------------------------------------------------
Section "Setting up the database"

$pgSuperSecure = Read-Host "Enter the 'postgres' superuser password (set during Postgres install)" -AsSecureString
$pgSuperPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSuperSecure))

$assetsSecure = Read-Host "Choose a password for the new 'assets' database role" -AsSecureString
$assetsPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($assetsSecure))

$env:PGPASSWORD = $pgSuperPlain

$userExists = (psql -U postgres -h localhost -p 5432 -t -A -c "SELECT 1 FROM pg_roles WHERE rolname='assets';").Trim()
if ($userExists -ne "1") {
    psql -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c "CREATE USER assets WITH ENCRYPTED PASSWORD '$assetsPlain';" | Out-Null
    Write-Host "Created role 'assets'" -ForegroundColor Green
} else {
    Write-Host "Role 'assets' already exists - leaving it as is." -ForegroundColor Yellow
    Write-Host "(If you meant to set a NEW password just now, that password was NOT applied - the role already existed.)" -ForegroundColor Yellow
}

$dbExists = (psql -U postgres -h localhost -p 5432 -t -A -c "SELECT 1 FROM pg_database WHERE datname='assets_manager';").Trim()
if ($dbExists -ne "1") {
    psql -U postgres -h localhost -p 5432 -v ON_ERROR_STOP=1 -c "CREATE DATABASE assets_manager OWNER assets;" | Out-Null
    Write-Host "Created database 'assets_manager' (owner: assets)" -ForegroundColor Green
} else {
    Write-Host "Database 'assets_manager' already exists - leaving it as is." -ForegroundColor Yellow
}

Remove-Item Env:\PGPASSWORD

# ---------------------------------------------------------------------
# 5. npm install
# ---------------------------------------------------------------------
Section "Installing dependencies (npm install)"
npm install

# ---------------------------------------------------------------------
# 6. Build .env
# ---------------------------------------------------------------------
Section "Creating .env"

if (Test-Path ".env") {
    Write-Host ".env already exists - leaving it alone. Delete it first if you want this script to regenerate it." -ForegroundColor Yellow
} else {
    Copy-Item ".env.example" ".env"

    $sessionSecret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

    # Prefer the biggest non-C: drive with real free space; fall back to C:
    $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 5GB }
    $targetDrive = $drives | Where-Object { $_.Name -ne 'C' } | Sort-Object -Property Free -Descending | Select-Object -First 1
    if ($targetDrive) {
        $videoDir = "$($targetDrive.Name):\assets-manager-videos"
    } else {
        $videoDir = "C:\assets-manager-videos"
    }
    New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

    $chromeCandidates = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    )
    $chromePath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    $envContent = Get-Content ".env"
    $envContent = $envContent -replace '^DATABASE_URL=.*', ('DATABASE_URL="postgresql://assets:' + $assetsPlain + '@localhost:5432/assets_manager?schema=public"')
    $envContent = $envContent -replace '^SESSION_SECRET=.*', ('SESSION_SECRET="' + $sessionSecret + '"')
    $escapedVideoDir = $videoDir -replace '\\', '\\\\'
    $envContent = $envContent -replace '^VIDEO_STORAGE_DIR=.*', ('VIDEO_STORAGE_DIR="' + $escapedVideoDir + '"')

    if ($chromePath) {
        $envContent = $envContent -replace '^PUPPETEER_EXECUTABLE_PATH=.*', ('PUPPETEER_EXECUTABLE_PATH="' + $chromePath + '"')
        Write-Host "Chrome found at $chromePath" -ForegroundColor Green
    } else {
        $envContent = $envContent -replace '^PUPPETEER_EXECUTABLE_PATH=.*', 'PUPPETEER_EXECUTABLE_PATH=""'
        Write-Host "Chrome not found - cleared PUPPETEER_EXECUTABLE_PATH. Install Chrome, or video thumbnails may fail." -ForegroundColor Yellow
    }

    $envContent | Set-Content ".env"
    Write-Host ".env created. Video storage dir: $videoDir" -ForegroundColor Green
    Write-Host "Company name / logo / currency fields in .env are left as placeholders - edit those by hand if you care about branding." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------
# 7. Migrate + seed
# ---------------------------------------------------------------------
Section "Creating tables and seeding"
npx prisma migrate deploy
npm run seed

# Clean up plaintext password variables
Remove-Variable pgSuperPlain, assetsPlain -ErrorAction SilentlyContinue

Section "Done"
Write-Host "Run:  npm run dev"
Write-Host "Open: http://localhost:3000"
Write-Host "Login: admin@company.local / ChangeMe!2024  (you'll be forced to change it on first sign-in)"
Write-Host ""
Write-Host "When you're happy with it, switch to production mode with:"
Write-Host "  npm run build"
Write-Host "  npm start"