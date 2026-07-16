const fs = require('fs');
const path = require('path');
const { setTimeout: delay } = require('timers/promises');
const XLSX = require('xlsx');
const { createPlugin } = require('../src/modules/qqbot/plugins/bangdream/src');

/**
 * Reads the Bash-validated render payload from environment variables.
 * @returns {{expectedImageCount: number, input: object, operationKey: string, outFile: string}} Render payload.
 */
function readPayload() {
  const expectedImageCount = Number.parseInt(
    process.env.BANGDREAM_EXPECTED_IMAGE_COUNT || '0',
    10,
  );
  if (!Number.isInteger(expectedImageCount) || expectedImageCount < 0) {
    throw new Error('BANGDREAM_EXPECTED_IMAGE_COUNT must be a non-negative integer');
  }

  const operationKey = process.env.BANGDREAM_OPERATION_KEY || '';
  const outFile = process.env.BANGDREAM_OUT_FILE || '';
  if (!operationKey || !outFile) {
    throw new Error('BANGDREAM_OPERATION_KEY and BANGDREAM_OUT_FILE are required');
  }

  return {
    expectedImageCount,
    input: {
      compress: true,
      displayedServerList: process.env.BANGDREAM_DISPLAYED_SERVER_LIST || '',
      text: process.env.BANGDREAM_TEXT || '',
      useEasyBG: process.env.BANGDREAM_USE_EASY_BG === 'true',
    },
    operationKey,
    outFile,
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
 * Executes the requested operation and writes every CQ base64 image to disk.
 * @returns {Promise<void>} Resolves after output metadata has been written to stdout.
 */
async function main() {
  const payload = readPayload();
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
  const result = await plugin.executeOperation(payload.operationKey, payload.input);
  if (
    payload.expectedImageCount > 0 &&
    result.imageCount !== payload.expectedImageCount
  ) {
    throw new Error(
      `Expected imageCount=${payload.expectedImageCount}, got ${result.imageCount}`,
    );
  }

  const matches = [...result.replyText.matchAll(/base64:\/\/([A-Za-z0-9+/=]+)/g)];
  if (matches.length === 0) {
    throw new Error('No image CQ payload');
  }

  fs.mkdirSync(path.dirname(payload.outFile), { recursive: true });
  const parsedOutput = path.parse(payload.outFile);
  const files = matches.map((match, index) => {
    const outputFile =
      index === 0
        ? payload.outFile
        : path.join(
            parsedOutput.dir,
            `${parsedOutput.name}-${index + 1}${parsedOutput.ext || '.jpg'}`,
          );
    fs.writeFileSync(outputFile, Buffer.from(match[1], 'base64'));
    return {
      bytes: fs.statSync(outputFile).size,
      out: outputFile,
    };
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        bytes: files[0].bytes,
        files,
        imageCount: result.imageCount,
        out: payload.outFile,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

/**
 * Writes an uncaught render error to stderr and fails the process.
 * @param {unknown} error Error-like value.
 * @returns {void}
 */
function handleFatalError(error) {
  process.stderr.write(`${String(error?.stack || error)}\n`);
  process.exit(1);
}

main().catch(handleFatalError);
