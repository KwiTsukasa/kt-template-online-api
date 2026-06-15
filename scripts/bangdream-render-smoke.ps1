param(
  [string]$OperationKey = "bangdream.event.search",
  [string]$Text = "50",
  [string]$DisplayedServerList = "cn jp",
  [string]$OutFile = ".kt-workspace/bangdream-smoke/bangdream-smoke.jpg",
  [int]$TimeoutSeconds = 45,
  [int]$ExpectedImageCount = 0,
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
  expectedImageCount = $ExpectedImageCount
}
$PayloadJson = $Payload | ConvertTo-Json -Compress -Depth 5
$PayloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PayloadJson))

$NodeCode = @"
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const payload = JSON.parse(Buffer.from("$PayloadBase64", "base64").toString("utf8"));
const { createPlugin } = require("./src/modules/qqbot/plugins/bangdream/src");

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.response = { status: statusCode };
  return error;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
}

async function requestBuffer(url, options) {
  const response = await fetchWithTimeout(url, options);
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw createHttpError("BangDream resource request failed: " + response.status, response.status);
  }
  return {
    body,
    statusCode: response.status,
  };
}

async function requestJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw createHttpError("BangDream JSON request failed: " + response.status, response.status);
  }
  return {
    body: JSON.parse(text),
    statusCode: response.status,
  };
}

(async () => {
  const manifest = readJsonFile(path.join(process.cwd(), "src/modules/qqbot/plugins/bangdream/plugin.json"));
  const operations = manifest.operations.map((operation) => ({
    handlerName: operation.handlerName,
    key: operation.key,
  }));
  const plugin = createPlugin({
    io: {
      getConfig: (key) => process.env[key],
      readAssetFile: async (filePath) => fs.promises.readFile(filePath),
      readExcelRows: async (filePath) => readExcelRows(filePath),
      readJsonFile: async (filePath) => readJsonFile(filePath),
      readJsonFileSync: (filePath) => readJsonFile(filePath),
      requestArrayBuffer: requestBuffer,
      requestJson,
      sleep: async (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      writeJsonFile: async (filePath, data) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data));
      },
    },
    normalizeError: (error) => String(error?.message || error || "BangDream command failed"),
    operations,
  });
  await plugin.activate();
  const result = await plugin.executeOperation(payload.operationKey, payload.input);
  if (payload.expectedImageCount > 0 && result.imageCount !== payload.expectedImageCount) {
    throw new Error(
      "Expected imageCount=" + payload.expectedImageCount + ", got " + result.imageCount,
    );
  }
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
