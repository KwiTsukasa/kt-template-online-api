param(
  [Parameter(Mandatory = $true)][string]$Database,
  [string]$HostName = "127.0.0.1",
  [int]$Port = 3306,
  [string]$User = "root"
)

$ErrorActionPreference = "Stop"
if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw "Database must match ^[A-Za-z0-9_]+$"
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$schema = Join-Path $root "sql\refactor-v3\00-full-schema.sql"
$seed = Join-Path $root "sql\refactor-v3\01-seed-core.sql"
$verify = Join-Path $root "sql\refactor-v3\99-verify.sql"

function Invoke-MysqlSource {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )

  $sourcePath = (Resolve-Path -LiteralPath $Path).Path.Replace("\", "/")
  mysql -h $HostName -P $Port -u $User $Database --execute="source $sourcePath"
}

mysql -h $HostName -P $Port -u $User -e "DROP DATABASE IF EXISTS ``$Database``; CREATE DATABASE ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
Invoke-MysqlSource -Path $schema
Invoke-MysqlSource -Path $seed
Invoke-MysqlSource -Path $verify
