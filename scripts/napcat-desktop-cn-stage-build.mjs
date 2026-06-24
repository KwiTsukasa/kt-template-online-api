import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = '.kt-workspace/napcat-desktop-cn-build';
const DEFAULT_UPSTREAM_BASE = '5c18a62530d87dbadf53d267002894faa6ca7e90';

/**
 * Reads a named CLI argument in `--key value` form.
 * @param {string} name - Argument name without the leading dashes.
 * @param {string} fallback - Value used when the argument is absent.
 * @returns {string} Parsed argument value.
 */
function readArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/**
 * Computes a SHA256 digest for a file.
 * @param {string} filePath - Absolute path to the file being fingerprinted.
 * @returns {string} Lowercase hex SHA256 digest.
 */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * Lists directory entries in stable order.
 * @param {string} directory - Directory to list.
 * @returns {string[]} Sorted child names.
 */
function listDirectory(directory) {
  return readdirSync(directory).sort();
}

/**
 * Recursively computes a stable digest for a directory from relative paths and file contents.
 * @param {string} directory - Absolute directory path.
 * @returns {string} Lowercase hex SHA256 digest.
 */
function sha256Directory(directory) {
  const hash = createHash('sha256');
  const stack = [directory];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of listDirectory(current)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) {
        stack.push(absolute);
      } else {
        files.push(absolute);
      }
    }
  }
  files.sort();
  for (const file of files) {
    hash.update(relative(directory, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Reads the current git commit for the NapCat fork.
 * @param {string} repoRoot - Absolute repository path.
 * @returns {string} Current commit hash.
 */
function gitCommit(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Copies one file or directory into the staged Docker context.
 * @param {string} source - Source path.
 * @param {string} target - Target path.
 */
function copyIntoContext(source, target) {
  cpSync(source, target, { recursive: true });
}

/**
 * Checks whether a candidate path is inside an expected parent directory.
 * @param {string} parent - Absolute parent directory that owns the allowed subtree.
 * @param {string} candidate - Absolute path requested by the caller.
 * @returns {boolean} Whether candidate is inside parent and is not parent itself.
 */
function isInsideDirectory(parent, candidate) {
  const relativePath = relative(parent, candidate);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

/**
 * Rejects recursive-delete targets outside the API `.kt-workspace` staging area.
 * @param {string} outputRootToCheck - Absolute output path that will be cleaned and regenerated.
 * @param {string} apiRoot - Absolute API repository root.
 * @param {string} napcatRootToCheck - Absolute NapCatQQ fork path passed as source input.
 */
function assertSafeOutputRoot(outputRootToCheck, apiRoot, napcatRootToCheck) {
  const workspaceRoot = resolve(apiRoot, '.kt-workspace');
  const forbiddenRoots = new Set([
    parse(outputRootToCheck).root,
    resolve(apiRoot),
    resolve(apiRoot, '..', '..'),
    workspaceRoot,
    resolve(napcatRootToCheck),
    dirname(resolve(napcatRootToCheck)),
  ]);

  if (forbiddenRoots.has(resolve(outputRootToCheck))) {
    throw new Error(`Refusing to delete unsafe output root: ${outputRootToCheck}`);
  }
  if (!isInsideDirectory(workspaceRoot, outputRootToCheck)) {
    throw new Error(`Output root must stay inside ${workspaceRoot}`);
  }
}

const apiRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const napcatRootArg = readArg('napcat-root');
const napcatRoot = resolve(napcatRootArg);
const outputRoot = resolve(apiRoot, readArg('out', DEFAULT_OUTPUT));
const upstreamBaseCommit = readArg('upstream-base-commit', DEFAULT_UPSTREAM_BASE);
const upstreamReleaseTag = readArg('upstream-release-tag', 'unknown');
const upstreamReleaseCommit = readArg('upstream-release-commit', upstreamBaseCommit);
const napcatBaseImageDigest = readArg('napcat-base-image-digest', '');
const jenkinsBuildUrl = readArg('jenkins-build-url', '');
const shellDist = resolve(napcatRoot, 'packages/napcat-shell/dist');
const napcatMjs = resolve(shellDist, 'napcat.mjs');

if (!napcatRootArg || !existsSync(napcatRoot)) {
  throw new Error('--napcat-root must point to the NapCatQQ fork repository');
}
if (!existsSync(napcatMjs)) {
  throw new Error(`NapCat shell build output is missing: ${napcatMjs}`);
}
assertSafeOutputRoot(outputRoot, apiRoot, napcatRoot);

rmSync(outputRoot, { force: true, recursive: true });
mkdirSync(resolve(outputRoot, 'ci/napcat-desktop-cn'), { recursive: true });
copyIntoContext(
  resolve(apiRoot, 'ci/napcat-desktop-cn/Dockerfile'),
  resolve(outputRoot, 'ci/napcat-desktop-cn/Dockerfile'),
);
copyIntoContext(
  resolve(apiRoot, 'ci/napcat-desktop-cn/verify.sh'),
  resolve(outputRoot, 'ci/napcat-desktop-cn/verify.sh'),
);
copyIntoContext(shellDist, resolve(outputRoot, 'NapCat.Shell'));

const marker = {
  builtAt: new Date().toISOString(),
  distSha256: sha256Directory(shellDist),
  forkCommit: gitCommit(napcatRoot),
  jenkinsBuildUrl,
  napcatBaseImageDigest,
  napcatMjsSha256: sha256File(napcatMjs),
  upstreamBaseCommit,
  upstreamReleaseCommit,
  upstreamReleaseTag,
};

writeFileSync(
  resolve(outputRoot, 'ci/napcat-desktop-cn/fork-artifact.json'),
  `${JSON.stringify(marker, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${JSON.stringify({
  marker,
  outputRoot,
}, null, 2)}\n`);
