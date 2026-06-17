import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

import { QqbotPluginPackagePathPolicyService } from './plugin-package-path-policy.service';
import type { QqbotPluginPackageDescriptor } from './plugin-package.types';

/**
 * Discovers QQBot plugin packages by reading package manifests without importing package code.
 */
@Injectable()
export class QqbotPluginPackageSourceService {
  /**
   * Creates a manifest-only package descriptor source.
   * @param pathPolicy - Root and entry policy that keeps package discovery inside controlled directories.
   */
  constructor(private readonly pathPolicy: QqbotPluginPackagePathPolicyService) {}

  /**
   * Discovers package descriptors from one-level package directories under controlled roots.
   * @returns Parsed descriptors sorted by plugin key for deterministic plugin-platform startup.
   */
  async discoverPackages(): Promise<QqbotPluginPackageDescriptor[]> {
    const descriptors: QqbotPluginPackageDescriptor[] = [];

    for (const root of this.pathPolicy.listExistingRoots()) {
      for (const packageRoot of this.listPackageRoots(root)) {
        const descriptor = this.readDescriptor(packageRoot);
        if (descriptor) {
          descriptors.push(descriptor);
        }
      }
    }

    return descriptors.sort((left, right) =>
      left.pluginKey.localeCompare(right.pluginKey),
    );
  }

  /**
   * Reads one package descriptor from `plugin.json` without loading the package entry module.
   * @param packageRoot - Candidate QQBot plugin package directory that may contain `plugin.json`.
   * @returns Descriptor when a manifest exists, otherwise `null`.
   */
  readDescriptor(packageRoot: string): QqbotPluginPackageDescriptor | null {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifestFile = join(controlledPackageRoot, 'plugin.json');

    if (!existsSync(manifestFile)) {
      return null;
    }

    const manifestLike = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const manifest = parseQqbotPluginManifest(manifestLike, {
      pluginRoot: controlledPackageRoot,
    });
    const entryFile = this.pathPolicy.resolveEntryFile(
      controlledPackageRoot,
      manifest.entry,
    );
    const pluginKey = manifest.key;

    return {
      entry: manifest.entry,
      entryFile,
      manifest,
      packageRoot: controlledPackageRoot,
      pluginKey,
    };
  }

  /**
   * Lists first-level child directories that may represent QQBot plugin packages.
   * @param root - Existing controlled root that contains package directories.
   * @returns Absolute candidate package directories under the root.
   */
  private listPackageRoots(root: string): string[] {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  }
}
