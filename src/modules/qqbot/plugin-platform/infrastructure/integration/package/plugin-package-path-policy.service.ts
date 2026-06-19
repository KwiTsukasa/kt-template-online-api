import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS = [
  ['src', 'modules', 'qqbot', 'plugins'],
  ['dist', 'modules', 'qqbot', 'plugins'],
];
export const QQBOT_PLUGIN_PACKAGE_CONTROLLED_ROOTS = Symbol(
  'QQBOT_PLUGIN_PACKAGE_CONTROLLED_ROOTS',
);

/**
 * Restricts QQBot plugin package discovery and entry resolution to controlled package roots.
 */
@Injectable()
export class QqbotPluginPackagePathPolicyService {
  private readonly controlledRoots: string[];

  /**
   * Creates a path policy for package roots that the plugin platform may scan.
   * @param controlledRoots - Optional DI-provided package roots; production omits this token so the platform scans the standard built-in plugin root.
   */
  constructor(
    @Optional()
    @Inject(QQBOT_PLUGIN_PACKAGE_CONTROLLED_ROOTS)
    controlledRoots?: string[],
  ) {
    this.controlledRoots = (
      controlledRoots?.length
        ? controlledRoots
        : resolveDefaultBuiltinPackageRoots()
    ).map((root) => resolve(root));
  }

  /**
   * Lists controlled roots that currently exist as directories on disk.
   * @returns Absolute root directories that may be scanned for package manifests.
   */
  listExistingRoots(): string[] {
    return this.controlledRoots.filter(
      (root) => existsSync(root) && statSync(root).isDirectory(),
    );
  }

  /**
   * Resolves a manifest entry to an absolute file path inside its owning package root.
   * @param packageRoot - Package directory that owns the `plugin.json` declaring the entry.
   * @param entry - Manifest entry path that must be relative to the package root.
   * @returns Absolute entry file path safe for later worker import.
   */
  resolveEntryFile(packageRoot: string, entry: string): string {
    const normalizedPackageRoot = resolve(packageRoot);
    const entryFile = resolve(normalizedPackageRoot, entry);

    if (isAbsolute(entry) || this.isOutside(normalizedPackageRoot, entryFile)) {
      throw new Error('Plugin entry must stay inside the package root');
    }

    return this.resolveCompiledEntryFile(entryFile);
  }

  /**
   * Ensures a package directory belongs to a configured controlled root.
   * @param packageRoot - Candidate QQBot plugin package directory discovered from a root scan.
   * @returns Normalized absolute package directory when it is inside a controlled root.
   */
  assertControlledPackageRoot(packageRoot: string): string {
    const normalizedPackageRoot =
      this.resolvePersistedBuiltinPackageRoot(packageRoot) ||
      resolve(packageRoot);
    const isControlled = this.controlledRoots.some(
      (root) =>
        normalizedPackageRoot === root ||
        !this.isOutside(root, normalizedPackageRoot),
    );

    if (!isControlled) {
      throw new Error('Plugin package root is outside controlled roots');
    }

    return normalizedPackageRoot;
  }

  /**
   * Maps persisted built-in source package paths to the controlled root used by the current runtime.
   * @param packageRoot - Package root persisted by seed SQL or install records; built-ins may store source-relative paths.
   * @returns Runtime package directory under the active controlled root, or null for ordinary paths.
   */
  private resolvePersistedBuiltinPackageRoot(
    packageRoot: string,
  ): string | null {
    if (isAbsolute(packageRoot)) return null;

    const packageSegments = this.toPathSegments(packageRoot);
    const builtinPrefix = DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.find(
      (segments) => this.startsWithSegments(packageSegments, segments),
    );
    if (!builtinPrefix || packageSegments.length !== builtinPrefix.length + 1) {
      return null;
    }

    const packageName = packageSegments[packageSegments.length - 1];
    if (!packageName || packageName === '..') return null;

    const controlledRoot = this.controlledRoots.find((root) =>
      DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.some((segments) =>
        this.endsWithSegments(this.toPathSegments(root), segments),
      ),
    );
    return controlledRoot ? resolve(controlledRoot, packageName) : null;
  }

  /**
   * Checks whether a candidate package path escapes a controlled root.
   * @param root - Absolute controlled root that bounds package discovery.
   * @param candidate - Absolute package directory or entry file being validated.
   * @returns Whether the candidate is outside the root.
   */
  private isOutside(root: string, candidate: string): boolean {
    const relation = relative(root, candidate);
    return (
      relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    );
  }

  /**
   * Splits a path with either Windows or POSIX separators for suffix/prefix policy checks.
   * @param pathValue - Raw absolute or relative filesystem path.
   * @returns Non-empty path segments excluding current-directory markers.
   */
  private toPathSegments(pathValue: string): string[] {
    return pathValue
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment && segment !== '.');
  }

  /**
   * Checks whether a path segment list starts with an expected built-in root prefix.
   * @param candidate - Candidate package root split into path segments.
   * @param expected - Built-in source or dist root segment sequence.
   * @returns Whether candidate begins with the expected sequence.
   */
  private startsWithSegments(candidate: string[], expected: string[]): boolean {
    return expected.every((segment, index) => candidate[index] === segment);
  }

  /**
   * Checks whether a controlled root ends with an expected built-in root segment sequence.
   * @param candidate - Controlled root split into path segments.
   * @param expected - Built-in source or dist root segment sequence.
   * @returns Whether candidate ends with the expected sequence.
   */
  private endsWithSegments(candidate: string[], expected: string[]): boolean {
    const offset = candidate.length - expected.length;
    if (offset < 0) return false;
    return expected.every(
      (segment, index) => candidate[offset + index] === segment,
    );
  }

  /**
   * Resolves a manifest entry to the file Node can import in the current runtime.
   * @param entryFile - Policy-checked entry path declared by `plugin.json`.
   * @returns The declared file when it exists, otherwise the compiled `.js` sibling for TypeScript entries.
   */
  private resolveCompiledEntryFile(entryFile: string): string {
    if (existsSync(entryFile)) return entryFile;

    if (entryFile.endsWith('.ts')) {
      const compiledEntryFile = `${entryFile.slice(0, -3)}.js`;
      if (existsSync(compiledEntryFile)) {
        return compiledEntryFile;
      }
    }

    return entryFile;
  }
}

/**
 * Resolves the default built-in package root for source development or production `dist` output.
 * @returns A single preferred controlled root so package discovery does not duplicate source and dist manifests.
 */
function resolveDefaultBuiltinPackageRoots(): string[] {
  const candidates = DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.map((segments) =>
    resolve(process.cwd(), ...segments),
  );
  return [candidates.find((candidate) => existsSync(candidate)) || candidates[0]];
}
