param(
  [Parameter(Mandatory = $true)][string]$Database,
  [Parameter(Mandatory = $true)][string]$BackupFile
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
  throw "BackupFile does not exist"
}

$sourcePath = (Resolve-Path -LiteralPath $BackupFile).Path.Replace("\", "/")
mysql -e "DROP DATABASE IF EXISTS ``$Database``; CREATE DATABASE ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql --default-character-set=utf8mb4 $Database --execute="source $sourcePath"
