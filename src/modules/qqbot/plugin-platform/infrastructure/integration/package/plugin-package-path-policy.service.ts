import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DEFAULT_BUILTIN_PACKAGE_ROOT = resolve(
  process.cwd(),
  'src',
  'modules',
  'qqbot',
  'plugins',
);
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
      controlledRoots?.length ? controlledRoots : [DEFAULT_BUILTIN_PACKAGE_ROOT]
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

    return entryFile;
  }

  /**
   * Ensures a package directory belongs to a configured controlled root.
   * @param packageRoot - Candidate QQBot plugin package directory discovered from a root scan.
   * @returns Normalized absolute package directory when it is inside a controlled root.
   */
  assertControlledPackageRoot(packageRoot: string): string {
    const normalizedPackageRoot = resolve(packageRoot);
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
}
