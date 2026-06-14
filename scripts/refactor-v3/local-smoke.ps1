param(
  [string]$BaseUrl = "http://127.0.0.1:48085"
)

$ErrorActionPreference = "Stop"
$runtime = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health/runtime" -TimeoutSec 10
if (-not $runtime.service) {
  throw "Runtime health response did not include service"
}
Write-Output "runtime.service=$($runtime.service)"
