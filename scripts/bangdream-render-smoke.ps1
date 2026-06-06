param(
  [string]$OperationKey = "bangdream.event.search",
  [string]$Text = "50",
  [string]$DisplayedServerList = "cn jp",
  [string]$OutFile = ".kt-workspace/bangdream-smoke/bangdream-smoke.jpg",
  [int]$TimeoutSeconds = 45,
  [switch]$UseEasyBg
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ResolvedOutFile = if ([System.IO.Path]::IsPathRooted($OutFile)) {
  $OutFile
} else {
  Join-Path $ProjectRoot $OutFile
}
$OutDir = Split-Path -Parent $ResolvedOutFile
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$LogDir = Join-Path $ProjectRoot ".kt-workspace/bangdream-smoke"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogName = [System.IO.Path]::GetFileNameWithoutExtension($ResolvedOutFile)
$StdoutLog = Join-Path $LogDir "$LogName.out.log"
$StderrLog = Join-Path $LogDir "$LogName.err.log"
Remove-Item -LiteralPath $StdoutLog,$StderrLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $ResolvedOutFile -Force -ErrorAction SilentlyContinue
$OutExtension = [System.IO.Path]::GetExtension($ResolvedOutFile)
Get-ChildItem -LiteralPath $OutDir -Filter "$LogName-*${OutExtension}" -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

$Payload = @{
  input = @{
    compress = $true
    displayedServerList = $DisplayedServerList
    text = $Text
    useEasyBG = [bool]$UseEasyBg
  }
  operationKey = $OperationKey
  outFile = $ResolvedOutFile
}
$PayloadJson = $Payload | ConvertTo-Json -Compress -Depth 5
$PayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PayloadJson))

$NodeCode = @"
const fs = require("fs");
const path = require("path");
const { ConfigService } = require("@nestjs/config");
const payload = JSON.parse(Buffer.from("$PayloadBase64", "base64").toString("utf8"));
const { ToolsService } = require("./src/common/services/tool.service");
const { QqbotBangDreamRendererService } = require("./src/qqbot/plugins/bangDream/renderer/qqbot-bangdream-renderer.service");
const { TsuguApplicationService } = require("./src/qqbot/plugins/bangDream/renderer/tsugu-application.service");

(async () => {
  const renderer = new QqbotBangDreamRendererService(new ConfigService({}), undefined);
  const service = new TsuguApplicationService(renderer, new ToolsService());
  await service.onApplicationBootstrap();
  const result = await service.execute(payload.operationKey, payload.input);
  const matches = [...result.replyText.matchAll(/base64:\/\/([A-Za-z0-9+/=]+)/g)];
  if (matches.length === 0) throw new Error("No image CQ payload");
  fs.mkdirSync(path.dirname(payload.outFile), { recursive: true });
  const parsed = path.parse(payload.outFile);
  const files = matches.map((match, index) => {
    const outFile =
      index === 0
        ? payload.outFile
        : path.join(
            parsed.dir,
            parsed.name + "-" + (index + 1) + (parsed.ext || ".jpg"),
          );
    fs.writeFileSync(outFile, Buffer.from(match[1], "base64"));
    return {
      bytes: fs.statSync(outFile).size,
      out: outFile,
    };
  });
  process.stdout.write(JSON.stringify({
    bytes: files[0].bytes,
    files,
    imageCount: result.imageCount,
    out: payload.outFile,
  }, null, 2) + "\n");
  process.exit(0);
})().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exit(1);
});
"@
$NodeCodeBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($NodeCode))
$EvalCode = "eval(Buffer.from('$NodeCodeBase64','base64').toString('utf8'))"

$env:TS_NODE_TRANSPILE_ONLY = "true"
$Process = Start-Process `
  -FilePath "node" `
  -ArgumentList @("-r", "ts-node/register", "-r", "tsconfig-paths/register", "-e", $EvalCode) `
  -WorkingDirectory $ProjectRoot `
  -RedirectStandardOutput $StdoutLog `
  -RedirectStandardError $StderrLog `
  -PassThru `
  -WindowStyle Hidden

function Test-SmokeCompleted {
  if (-not (Test-Path -LiteralPath $ResolvedOutFile)) { return $false }
  if ((Get-Item -LiteralPath $ResolvedOutFile).Length -le 0) { return $false }
  if (-not (Test-Path -LiteralPath $StdoutLog)) { return $false }
  return [bool](Select-String -Path $StdoutLog -Pattern '"bytes"' -Quiet)
}

$Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$CompletedByOutput = $false
while (-not $Process.HasExited) {
  if (Test-SmokeCompleted) {
    $CompletedByOutput = $true
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
    break
  }
  if ((Get-Date) -ge $Deadline) {
    break
  }
  Start-Sleep -Milliseconds 500
  $Process.Refresh()
}

if ((-not $Process.HasExited) -and (-not $CompletedByOutput)) {
  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  Write-Output "BangDream smoke timed out and process $($Process.Id) was killed."
  if (Test-Path $StdoutLog) { Get-Content $StdoutLog }
  if (Test-Path $StderrLog) { Get-Content $StderrLog }
  exit 124
}

if (Test-Path $StdoutLog) { Get-Content $StdoutLog }
if (Test-Path $StderrLog) { Get-Content $StderrLog }
if ($CompletedByOutput) {
  Write-Output "BangDream smoke output completed; lingering process $($Process.Id) was cleaned up."
  exit 0
}
if (-not (Test-SmokeCompleted)) {
  Write-Output "BangDream smoke did not produce an image file."
  exit 1
}
exit $Process.ExitCode
