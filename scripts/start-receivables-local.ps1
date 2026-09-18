param([switch]$Check)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root ".env.local"
$databaseName = "receivables_e2e_test"

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $name. Install it or add it to PATH."
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $script:corepackPath = (Get-Command corepack -ErrorAction SilentlyContinue).Source
  if (-not $script:corepackPath) { throw "Missing pnpm and corepack. Install Node.js 22 with Corepack." }
  function global:pnpm { & $script:corepackPath pnpm @args }
}

function Read-DatabaseUrl {
  if (Test-Path -LiteralPath $configPath) {
    $line = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if ($line) { return $line.Substring(("DATABASE_URL=").Length).Trim() }
  }

  Write-Host "First run: enter the local PostgreSQL postgres password. It is stored only in the Git-ignored .env.local file."
  $securePassword = Read-Host "PostgreSQL postgres password" -AsSecureString
  $password = [System.Net.NetworkCredential]::new("", $securePassword).Password
  if (-not $password) { throw "PostgreSQL password cannot be empty." }
  $encodedPassword = [Uri]::EscapeDataString($password)
  $url = "postgresql://postgres:$encodedPassword@127.0.0.1:5432/$databaseName"
  [IO.File]::WriteAllLines($configPath, @("# Local only. Never commit.", "DATABASE_URL=$url"))
  return $url
}

function Assert-SafeDatabaseUrl([string]$url) {
  $parsed = [Uri]$url
  $user = $parsed.UserInfo.Split(':')[0]
  if ($parsed.Scheme -ne "postgresql" -or $parsed.Host -ne "127.0.0.1" -or $parsed.Port -notin @(5432, 55432) -or $user -ne "postgres" -or $parsed.AbsolutePath.Trim('/') -ne $databaseName) {
    throw "DATABASE_URL must use postgres@127.0.0.1:5432/55432 and the receivables_e2e_test database."
  }
  return $parsed
}

Require-Command node
Require-Command pnpm
Require-Command psql
Require-Command createdb

if ($Check) {
  Write-Output "LOCAL_RECEIVABLES_SCRIPT_OK"
  exit 0
}

Set-Location $root
$databaseUrl = Read-DatabaseUrl
$parsed = Assert-SafeDatabaseUrl $databaseUrl
$adminBuilder = [UriBuilder]$parsed
$adminBuilder.Path = "/postgres"
$adminUrl = $adminBuilder.Uri.AbsoluteUri
$exists = (& psql $adminUrl -Atc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'").Trim()
if ($LASTEXITCODE -ne 0) { throw "Cannot connect to local PostgreSQL. Check the postgres password and service status." }
if ($exists -ne "1") {
  & createdb "--maintenance-db=$adminUrl" $databaseName
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the local test database." }
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -ne 22) { Write-Warning "Release runtime is Node 22; local Node $nodeMajor is only used for UI testing." }
$env:DATABASE_URL = $databaseUrl

Write-Host "Preparing the local database and building the current UI..."
& pnpm prisma:generate
if ($LASTEXITCODE -ne 0) { throw "Failed to generate Prisma Client." }
& pnpm db:deploy
if ($LASTEXITCODE -ne 0) { throw "Failed to deploy local database migrations." }
& pnpm --filter "@safety/admin" build
if ($LASTEXITCODE -ne 0) { throw "Failed to build the admin UI." }

Write-Host ""
Write-Host "Local test is starting. The terminal will print role URLs. Press Ctrl+C or Enter to stop and clean test data." -ForegroundColor Green
Write-Host "Owner URL: http://127.0.0.1:55451/role/owner"
& pnpm smoke:receivables-e2e -- --browser-fixture
