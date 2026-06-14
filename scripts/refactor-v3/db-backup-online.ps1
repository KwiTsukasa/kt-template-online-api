param(
  [Parameter(Mandatory = $true)][string]$Database,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDirectory "$Database-refactor-v3-$stamp.sql"
mysqldump --set-gtid-purged=OFF --single-transaction --routines --triggers --default-character-set=utf8mb4 "--result-file=$target" $Database
Write-Output $target
