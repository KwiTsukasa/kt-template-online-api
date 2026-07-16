const fs = require('fs');
const path = require('path');
const { setTimeout: delay } = require('timers/promises');
const XLSX = require('xlsx');
const { loadImage } = require('skia-canvas');
const { createPlugin } = require('../src/modules/qqbot/plugins/bangdream/src');

const cases = [
  { name: 'song-search-detail', operationKey: 'bangdream.song.search', text: '136', expectedImageCount: 1 },
  { name: 'song-search-list', operationKey: 'bangdream.song.search', text: 'FIRE BIRD', expectedImageCount: 1 },
  { name: 'song-chart', operationKey: 'bangdream.song.chart', text: '136 expert', expectedImageCount: 1 },
  { name: 'song-random', operationKey: 'bangdream.song.random', text: 'FIRE BIRD', expectedImageCount: 1 },
  { name: 'song-meta', operationKey: 'bangdream.song.meta', text: 'cn', expectedImageCount: 1 },
  { name: 'card-search-detail', operationKey: 'bangdream.card.search', text: '472', expectedImageCount: 1 },
  { name: 'card-search-list', operationKey: 'bangdream.card.search', text: '香澄', expectedImageCount: 1 },
  { name: 'card-illustration', operationKey: 'bangdream.card.illustration', text: '472', expectedImageCountMin: 1 },
  { name: 'character-search-detail', operationKey: 'bangdream.character.search', text: '1', expectedImageCount: 1 },
  { name: 'character-search-list', operationKey: 'bangdream.character.search', text: '香澄', expectedImageCount: 1 },
  { name: 'event-search-detail', operationKey: 'bangdream.event.search', text: '50', expectedImageCount: 1 },
  { name: 'event-search-list', operationKey: 'bangdream.event.search', text: 'summer', expectedImageCount: 1 },
  { name: 'event-stage', operationKey: 'bangdream.event.stage', text: '310 cn -m', expectedImageCount: 5 },
  { name: 'player-search', operationKey: 'bangdream.player.search', text: '26591455 jp', expectedImageCount: 1, external: true },
  { name: 'gacha-search', operationKey: 'bangdream.gacha.search', text: '259', expectedImageCount: 1 },
  { name: 'gacha-simulate', operationKey: 'bangdream.gacha.simulate', text: '10 259', expectedImageCount: 1 },
  { name: 'cutoff-detail', operationKey: 'bangdream.cutoff.detail', text: 'ycx 1000 50 cn', expectedImageCount: 1 },
  { name: 'cutoff-detail-top10', operationKey: 'bangdream.cutoff.detail', text: 'ycx 10 100 cn', expectedImageCount: 1 },
  { name: 'cutoff-all', operationKey: 'bangdream.cutoff.all', text: '50 cn', expectedImageCount: 1 },
  { name: 'cutoff-recent', operationKey: 'bangdream.cutoff.recent', text: '1000 50 cn', expectedImageCount: 1 },
];

/**
 * Reads the Bash-validated matrix payload from environment variables.
 * @returns {{outDir: string, skipExternalPlayer: boolean}} Matrix payload.
 */
function readPayload() {
  const outDir = process.env.BANGDREAM_MATRIX_OUT_DIR || '';
  if (!outDir) {
    throw new Error('BANGDREAM_MATRIX_OUT_DIR is required');
  }
  return {
    outDir,
    skipExternalPlayer:
      process.env.BANGDREAM_MATRIX_SKIP_EXTERNAL_PLAYER === 'true',
  };
}

/**
 * Creates an HTTP-shaped error compatible with the BangDream adapters.
 * @param {string} message Error message.
 * @param {number} statusCode HTTP response status.
 * @returns {Error & {response: {status: number}, statusCode: number}} Compatible error.
 */
function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.response = { status: statusCode };
  return error;
}

/**
 * Fetches one resource with an adapter-level timeout.
 * @param {string | URL} url Resource URL.
 * @param {{headers?: object, timeoutMs?: number}} [options] Request options.
 * @returns {Promise<Response>} Fetch response.
 */
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

/**
 * Reads and parses a JSON file synchronously.
 * @param {string} filePath JSON file path.
 * @returns {unknown} Parsed JSON value.
 */
function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Reads the first worksheet from an Excel file as row objects.
 * @param {string} filePath Excel file path.
 * @returns {object[]} Worksheet rows.
 */
function readExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
}

/**
 * Requests a binary resource for the BangDream plugin.
 * @param {string | URL} url Resource URL.
 * @param {{headers?: object, timeoutMs?: number}} [options] Request options.
 * @returns {Promise<{body: Buffer, statusCode: number}>} Binary response body and status.
 */
async function requestBuffer(url, options) {
  const response = await fetchWithTimeout(url, options);
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw createHttpError(
      `BangDream resource request failed: ${response.status}`,
      response.status,
    );
  }
  return { body, statusCode: response.status };
}

/**
 * Requests and parses a JSON resource for the BangDream plugin.
 * @param {string | URL} url Resource URL.
 * @param {{headers?: object, timeoutMs?: number}} [options] Request options.
 * @returns {Promise<{body: unknown, statusCode: number}>} Parsed response body and status.
 */
async function requestJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const responseText = await response.text();
  if (!response.ok) {
    throw createHttpError(
      `BangDream JSON request failed: ${response.status}`,
      response.status,
    );
  }
  return { body: JSON.parse(responseText), statusCode: response.status };
}

/**
 * Creates the filesystem and network adapter expected by the BangDream plugin.
 * @returns {object} Plugin IO adapter.
 */
function createIoAdapter() {
  return {
    /** @param {string} key Environment key. @returns {string | undefined} Config value. */
    getConfig(key) {
      return process.env[key];
    },
    /** @param {string} filePath Asset path. @returns {Promise<Buffer>} Asset bytes. */
    async readAssetFile(filePath) {
      return fs.promises.readFile(filePath);
    },
    /** @param {string} filePath Excel path. @returns {Promise<object[]>} Worksheet rows. */
    async readExcelRows(filePath) {
      return readExcelRows(filePath);
    },
    /** @param {string} filePath JSON path. @returns {Promise<unknown>} Parsed value. */
    async readJsonFile(filePath) {
      return readJsonFile(filePath);
    },
    /** @param {string} filePath JSON path. @returns {unknown} Parsed value. */
    readJsonFileSync(filePath) {
      return readJsonFile(filePath);
    },
    requestArrayBuffer: requestBuffer,
    requestJson,
    /** @param {number} milliseconds Delay length. @returns {Promise<void>} Delay completion. */
    async sleep(milliseconds) {
      await delay(milliseconds);
    },
    /** @param {string} filePath Output path. @param {unknown} data JSON value. @returns {Promise<void>} Write completion. */
    async writeJsonFile(filePath, data) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data));
    },
  };
}

/**
 * Converts plugin errors to their stable human-readable representation.
 * @param {unknown} error Error-like value.
 * @returns {string} Normalized message.
 */
function normalizeError(error) {
  return String(error?.message || error || 'BangDream command failed');
}

/**
 * Converts a case name into a safe output filename component.
 * @param {string} name Matrix case name.
 * @returns {string} Filesystem-safe name.
 */
function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * Writes and decodes all images returned by one matrix case.
 * @param {object} testCase Matrix case contract.
 * @param {object} result Plugin operation result.
 * @param {string} outDir Matrix output directory.
 * @returns {Promise<object[]>} Image file metadata.
 */
async function writeCaseImages(testCase, result, outDir) {
  const matches = [...result.replyText.matchAll(/base64:\/\/([A-Za-z0-9+/=]+)/g)];
  if (matches.length === 0) {
    throw new Error(`${testCase.name}: no CQ image payload`);
  }
  if (
    testCase.expectedImageCount &&
    matches.length !== testCase.expectedImageCount
  ) {
    throw new Error(
      `${testCase.name}: expected imageCount=${testCase.expectedImageCount}, got ${matches.length}`,
    );
  }
  if (
    testCase.expectedImageCountMin &&
    matches.length < testCase.expectedImageCountMin
  ) {
    throw new Error(
      `${testCase.name}: expected imageCount>=${testCase.expectedImageCountMin}, got ${matches.length}`,
    );
  }

  const files = [];
  for (let index = 0; index < matches.length; index += 1) {
    const output = path.join(
      outDir,
      `${safeName(testCase.name)}${index === 0 ? '' : `-${index + 1}`}.jpg`,
    );
    const buffer = Buffer.from(matches[index][1], 'base64');
    fs.writeFileSync(output, buffer);
    const image = await loadImage(output);
    files.push({
      bytes: buffer.length,
      height: image.height,
      out: output,
      width: image.width,
    });
  }
  return files;
}

/**
 * Executes the full render matrix and writes its machine-readable summary.
 * @returns {Promise<void>} Resolves after the summary has been written.
 */
async function main() {
  const payload = readPayload();
  fs.mkdirSync(payload.outDir, { recursive: true });
  const manifest = readJsonFile(
    path.join(process.cwd(), 'src/modules/qqbot/plugins/bangdream/plugin.json'),
  );
  const operations = manifest.operations.map((operation) => ({
    handlerName: operation.handlerName,
    key: operation.key,
  }));
  const plugin = createPlugin({
    io: createIoAdapter(),
    normalizeError,
    operations,
  });
  await plugin.activate();

  const summaries = [];
  const executedKeys = new Set();
  for (const testCase of cases) {
    if (testCase.external && payload.skipExternalPlayer) {
      summaries.push({
        name: testCase.name,
        operationKey: testCase.operationKey,
        reason: 'external-player',
        skipped: true,
      });
      continue;
    }

    const startedAt = Date.now();
    const result = await plugin.executeOperation(testCase.operationKey, {
      compress: true,
      displayedServerList: '',
      text: testCase.text,
    });
    const files = await writeCaseImages(testCase, result, payload.outDir);
    executedKeys.add(testCase.operationKey);
    summaries.push({
      durationMs: Date.now() - startedAt,
      files,
      imageCount: result.imageCount,
      name: testCase.name,
      operationKey: testCase.operationKey,
      query: result.query,
    });
    process.stdout.write(
      `[matrix] ${testCase.name} imageCount=${result.imageCount} first=${files[0].width}x${files[0].height}\n`,
    );
  }

  const manifestKeys = manifest.operations
    .map((operation) => operation.key)
    .sort();
  const missingKeys = manifestKeys.filter(
    (key) => !cases.some((item) => item.operationKey === key),
  );
  if (missingKeys.length > 0) {
    throw new Error(`Smoke matrix missing operation keys: ${missingKeys.join(', ')}`);
  }

  const summary = {
    caseCount: cases.length,
    executedOperationKeys: [...executedKeys].sort(),
    manifestOperationKeys: manifestKeys,
    outDir: payload.outDir,
    skipped: summaries.filter((item) => item.skipped),
    summaries,
  };
  const summaryFile = path.join(payload.outDir, 'matrix-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  process.stdout.write(
    `${JSON.stringify(
      {
        caseCount: summary.caseCount,
        executedOperationKeyCount: summary.executedOperationKeys.length,
        skippedCount: summary.skipped.length,
        summaryFile,
      },
      null,
      2,
    )}\n`,
  );
}

/**
 * Writes an uncaught matrix error to stderr and fails the process.
 * @param {unknown} error Error-like value.
 * @returns {void}
 */
function handleFatalError(error) {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
}

main().catch(handleFatalError);
