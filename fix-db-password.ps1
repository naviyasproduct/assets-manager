# =====================================================================
# Forces the 'assets' role password and the DATABASE_URL in .env
# to be the same value, then verifies the app can actually log in.
#
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File .\fix-db-password.ps1
# =====================================================================

function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Fail($m) { Write-Host $m -ForegroundColor Red }

if (-not (Test-Path ".env")) {
    Fail ".env not found - run this from the repo root folder."
    exit 1
}

Write-Host ""
Write-Host "Passwords are shown as you type here, on purpose - so typos are visible." -ForegroundColor Cyan
Write-Host ""

$pgSuper = Read-Host "postgres superuser password"
$newPass = Read-Host "Password to set for the 'assets' role (letters+numbers only)"

if ([string]::IsNullOrWhiteSpace($newPass)) { Fail "Password cannot be blank."; exit 1 }
if ($newPass -match "[`'`"\\@:/ ]") {
    Fail "Use letters and numbers only (no quotes, backslash, @, :, / or spaces)."
    exit 1
}

$env:PGPASSWORD = $pgSuper

# --- 1. Confirm superuser login works -------------------------------
$null = psql -U postgres -h localhost -p 5432 -d postgres -t -A -c "SELECT 1;" 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "Cannot connect as 'postgres' with that password. Nothing was changed."
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    exit 1
}
Ok "postgres login OK"

# --- 2. Set the assets role password --------------------------------
$sqlFile = Join-Path $env:TEMP "fix_assets_pw.sql"
"ALTER ROLE assets WITH LOGIN ENCRYPTED PASSWORD '$newPass';" |
    Set-Content -Path $sqlFile -Encoding ASCII
psql -U postgres -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1 -f $sqlFile | Out-Null
$rc = $LASTEXITCODE
Remove-Item $sqlFile -ErrorAction SilentlyContinue

if ($rc -ne 0) {
    Fail "Failed to set the 'assets' password."
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    exit 1
}
Ok "'assets' role password set"

# --- 3. Make sure assets owns the schema ----------------------------
psql -U postgres -h localhost -p 5432 -d assets_manager `
    -c "ALTER SCHEMA public OWNER TO assets;" | Out-Null
psql -U postgres -h localhost -p 5432 -d assets_manager `
    -c "GRANT ALL ON SCHEMA public TO assets;" | Out-Null
Ok "Schema ownership confirmed"

Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# --- 4. Rewrite DATABASE_URL in .env --------------------------------
$url = "postgresql://assets:$newPass@localhost:5432/assets_manager?schema=public"

$lines = @(Get-Content ".env")
$found = $false
$new = New-Object System.Collections.Generic.List[string]

foreach ($line in $lines) {
    if ($line.StartsWith("DATABASE_URL=")) {
        $new.Add("DATABASE_URL=`"$url`"")
        $found = $true
    } else {
        $new.Add($line)
    }
}
if (-not $found) { $new.Add("DATABASE_URL=`"$url`"") }

$new | Set-Content ".env" -Encoding UTF8
Ok ".env updated"

# --- 5. Verify the app's own credentials actually work --------------
$env:PGPASSWORD = $newPass
$null = psql -U assets -h localhost -p 5432 -d assets_manager -t -A -c "SELECT 1;" 2>&1
$verifyRc = $LASTEXITCODE
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($verifyRc -ne 0) {
    Fail "The 'assets' role still cannot log in. This usually means pg_hba.conf"
    Fail "is not allowing password auth for local connections."
    exit 1
}

Ok "Verified: 'assets' can log in to assets_manager"
Write-Host ""
Write-Host "Now run:" -ForegroundColor Cyan
Write-Host "  npx prisma migrate deploy"
Write-Host "  npm run seed"
Write-Host "  npm run dev"