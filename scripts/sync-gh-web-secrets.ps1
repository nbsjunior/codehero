# Re-grava secrets NEXT_PUBLIC_* do CodeHero a partir de apps/web/.env.local
# (valores limpos — uma linha, sem PREFIXO=).
#
# Uso (PowerShell), a partir da raiz do repo:
#   powershell -File scripts/sync-gh-web-secrets.ps1
param(
  [string]$EnvFile = "$PSScriptRoot/../apps/web/.env.local",
  [string]$Repo = "nbsjunior/codehero"
)

if (-not (Test-Path $EnvFile)) {
  Write-Error "Não achei $EnvFile"
  exit 1
}

function Get-EnvVal([string]$key) {
  $line = Get-Content -LiteralPath $EnvFile |
    Where-Object { $_ -match "^$([regex]::Escape($key))=" } |
    Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^$([regex]::Escape($key))=", "").Trim()
}

$keys = @(
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIRESTORE_DATABASE_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID"
)

foreach ($k in $keys) {
  $v = Get-EnvVal $k
  if (-not $v) {
    Write-Warning "skip $k (ausente em .env.local)"
    continue
  }
  if ($v -match "[\r\n]" -or $v -match "=" -or $v -match "VITE_|NEXT_PUBLIC_") {
    Write-Error "$k parece poluído: '$v'"
    exit 1
  }
  # Pipe ONLY the raw value string (never an array) into gh.
  $v | gh secret set $k --repo $Repo
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao setar $k"
    exit $LASTEXITCODE
  }
  Write-Host "ok $k (len=$($v.Length))"
}

Write-Host "Pronto. Dispare o workflow firebase-deploy para republicar o hosting."
