# =====================================================================
# Assets Manager - setup script (v2)
#
# Run from the repo root (the folder containing package.json):
#   powershell -ExecutionPolicy Bypass -File .\setup-assets-manager-v2.ps1
#
# Safe to re-run: it skips anything already done.
# =====================================================================

function Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)      { Write-Host $msg -ForegroundColor Green }
function Warn($msg)    { Write-Host $msg -ForegroundColor Yellow }
function Fail($msg)    { Write-Host $msg -ForegroundColor Red }

# ---------------------------------------------------------------------
# 1. Node.js
# ---------------------------------------------------------------------
Section "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js not found. Install the LTS build from https://nodejs.org/ then re-run."
    exit 1
}
$nodeVersion = (node -v)
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 20) {
    Fail "Found Node $nodeVersion but v20+ is required."
    exit 1
}
Ok "Node $nodeVersion OK"

# ---------------------------------------------------------------------
# 2. PostgreSQL
# ---------------------------------------------------------------------
Section "Checking PostgreSQL"
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Fail "psql not found on PATH. Add C:\Program Files\PostgreSQL\16\bin to PATH, open a NEW terminal, re-run."
    exit 1
}
Ok "psql found"

# ---------------------------------------------------------------------
# 3. Repo root check
# ---------------------------------------------------------------------
if (-not (Test-Path ".env.example")) {
    Fail ".env.example not found - run this from the repo root folder."
    exit 1
}
if (-not (Test-Path "package.json")) {
    Fail "package.json not found - run this from the repo root folder."
    exit 1
}

# ---------------------------------------------------------------------
# 4. Passwords
# ---------------------------------------------------------------------
Section "Database setup"

$pgSuperSecure = Read-Host "Enter the 'postgres' superuser password" -AsSecureString
$pgSuperPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSuperSecure))

Write-Host ""
Write-Host "Now INVENT a new password for the app's own database role ('assets')." -ForegroundColor Yellow
Write-Host "Letters and numbers only. It gets written into .env automatically." -ForegroundColor Yellow
$assetsSecure = Read-Host "New password for the 'assets' role" -AsSecureString
$assetsPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($assetsSecure))

if ([string]::IsNullOrWhiteSpace($assetsPlain)) {
    Fail "The 'assets' password cannot be blank."
    exit 1
}
if ($assetsPlain -match "[`'`"\\@:/ ]") {
    Fail "Please use letters and numbers only for the 'assets' password (no quotes, backslash, @, :, / or spaces)."
    exit 1
}

$env:PGPASSWORD = $pgSuperPlain

# ---------------------------------------------------------------------
# 5. Verify the connection BEFORE doing anything else
# ---------------------------------------------------------------------
$null = psql -U postgres -h localhost -p 5432 -d postgres -t -A -c "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "Could not connect to PostgreSQL as 'postgres' with that password."
    Fail "Test it manually with:  psql -U postgres -h localhost -p 5432"
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    exit 1
}
Ok "Connected to PostgreSQL"

# ---------------------------------------------------------------------
# 6. Create role + database (idempotent, null-safe)
# ---------------------------------------------------------------------

# [string] cast makes empty psql output an empty string instead of null
$roleExists = ([string](psql -U postgres -h localhost -p 5432 -d postgres -t -A `
    -c "SELECT 1 FROM pg_roles WHERE rolname='assets';")).Trim()

if ($roleExists -ne "1") {
    $sqlFile = Join-Path $env:TEMP "create_assets_role.sql"
    "CREATE ROLE assets LOGIN ENCRYPTED PASSWORD '$assetsPlain';" |
        Set-Content -Path $sqlFile -Encoding ASCII
    psql -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1 -f $sqlFile | Out-Null
    $roleResult = $LASTEXITCODE
    Remove-Item $sqlFile -ErrorAction SilentlyContinue
    if ($roleResult -ne 0) {
        Fail "Failed to create the 'assets' role."
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        exit 1
    }
    Ok "Created role 'assets'"
} else {
    Warn "Role 'assets' already exists."
    Warn "Setting its password to what you just typed, so .env will match."
    $sqlFile = Join-Path $env:TEMP "alter_assets_role.sql"
    "ALTER ROLE assets WITH ENCRYPTED PASSWORD '$assetsPlain';" |
        Set-Content -Path $sqlFile -Encoding ASCII
    psql -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1 -f $sqlFile | Out-Null
    Remove-Item $sqlFile -ErrorAction SilentlyContinue
}

$dbExists = ([string](psql -U postgres -h localhost -p 5432 -d postgres -t -A `
    -c "SELECT 1 FROM pg_database WHERE datname='assets_manager';")).Trim()

if ($dbExists -ne "1") {
    psql -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1 `
        -c "CREATE DATABASE assets_manager OWNER assets;" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail "Failed to create database 'assets_manager'."
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        exit 1
    }
    Ok "Created database 'assets_manager' (owner: assets)"
} else {
    Warn "Database 'assets_manager' already exists - leaving it alone."
}

# Belt and braces: make sure the role really owns the public schema.
# This is what prevents Prisma's "permission denied for schema public" on PG 15+.
psql -U postgres -h localhost -p 5432 -d assets_manager `
    -c "ALTER SCHEMA public OWNER TO assets;" | Out-Null

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------
# 7. npm install
# ---------------------------------------------------------------------
Section "Installing dependencies"
npm install
if ($LASTEXITCODE -ne 0) {
    Fail "npm install failed - see the errors above."
    exit 1
}
Ok "Dependencies installed"

# ---------------------------------------------------------------------
# 8. Build .env
# ---------------------------------------------------------------------
Section "Creating .env"

if (Test-Path ".env") {
    Warn ".env already exists - leaving it alone."
    Warn "Delete it and re-run this script if you want it regenerated."
} else {
    $sessionSecret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

    # Prefer a large non-C: drive for video storage if one exists
    $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 5GB }
    $target = $drives | Where-Object { $_.Name -ne 'C' } |
              Sort-Object -Property Free -Descending | Select-Object -First 1
    if ($target) { $videoDir = "$($target.Name):\assets-manager-videos" }
    else         { $videoDir = "C:\assets-manager-videos" }
    New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

    $chromePath = @(
        "C:\Program Files\Google\Chrome\Application\chrome.exe",
        "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($chromePath) { Ok "Chrome found at $chromePath" }
    else { Warn "Chrome not found - PUPPETEER_EXECUTABLE_PATH left blank (PDF export may fail)." }

    # Values we manage. Everything else in .env.example is passed through untouched.
    $managed = @{
        'DATABASE_URL'              = 'postgresql://assets:' + $assetsPlain + '@localhost:5432/assets_manager?schema=public'
        'SESSION_SECRET'            = $sessionSecret
        'VIDEO_STORAGE_DIR'         = $videoDir -replace '\\', '\\'
        'PUPPETEER_EXECUTABLE_PATH' = if ($chromePath) { $chromePath } else { '' }
    }

    $out = New-Object System.Collections.Generic.List[string]
    $seen = @{}

    foreach ($line in (Get-Content ".env.example")) {
        $handled = $false
        foreach ($key in $managed.Keys) {
            if ($line.StartsWith("$key=")) {
                $out.Add("$key=`"$($managed[$key])`"")
                $seen[$key] = $true
                $handled = $true
                break
            }
        }
        if (-not $handled) { $out.Add($line) }
    }

    # Append any managed key that wasn't present in .env.example
    foreach ($key in $managed.Keys) {
        if (-not $seen.ContainsKey($key)) {
            $out.Add("$key=`"$($managed[$key])`"")
        }
    }

    $out | Set-Content ".env" -Encoding UTF8
    Ok ".env created (video storage: $videoDir)"
    Warn "COMPANY_NAME / logo / currency are still placeholders - edit .env by hand if you care."
}

# ---------------------------------------------------------------------
# 9. Migrate + seed
# ---------------------------------------------------------------------
Section "Creating tables"
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Fail "Migrations failed - see the errors above."
    exit 1
}

Section "Seeding"
npm run seed
if ($LASTEXITCODE -ne 0) {
    Warn "Seeding reported a problem - check above. The tables were still created."
}

Remove-Variable pgSuperPlain, assetsPlain -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------
Section "Done"
Write-Host "Start the app with:   npm run dev"
Write-Host "Then open:            http://localhost:3000"
Write-Host ""
Write-Host "Login:  admin@company.local  /  ChangeMe!2024"
Write-Host "(You'll be forced to change the password on first sign-in.)"
Write-Host ""
Write-Host "For the real thing later:  npm run build   then   npm start"