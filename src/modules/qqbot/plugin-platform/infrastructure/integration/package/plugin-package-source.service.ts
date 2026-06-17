import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseQqbotPluginManifest,
  type QqbotPluginManifest,
} from '@/modules/qqbot/plugin-platform/domain/manifest';

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
    const entry = this.readManifestEntry(manifestLike);
    const entryFile = this.pathPolicy.resolveEntryFile(
      controlledPackageRoot,
      entry,
    );
    const manifest = parseQqbotPluginManifest(
      this.normalizeManifestForCurrentParser(manifestLike),
      { pluginRoot: controlledPackageRoot },
    );
    const pluginKey = manifest.pluginKey;

    return {
      entry: manifest.entry,
      entryFile,
      manifest: this.attachPackageKeyAlias(manifest, pluginKey),
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

  /**
   * Reads the raw entry string before parser normalization so path policy errors stay explicit.
   * @param manifestLike - Parsed `plugin.json` content whose entry path belongs to the package.
   * @returns Raw entry path or an empty value that the manifest parser will reject.
   */
  private readManifestEntry(manifestLike: unknown): string {
    if (!this.isRecord(manifestLike)) return '';
    return typeof manifestLike.entry === 'string' ? manifestLike.entry : '';
  }

  /**
   * Adapts planned package manifest aliases to the parser contract currently used by the repo.
   * @param manifestLike - Parsed `plugin.json` content from a QQBot plugin package.
   * @returns Parser input with the package key and worker type normalized for this codebase.
   */
  private normalizeManifestForCurrentParser(manifestLike: unknown): unknown {
    if (!this.isRecord(manifestLike)) return manifestLike;

    const normalized: Record<string, unknown> = {
      minApiSdkVersion: '1.0.0',
      ...manifestLike,
    };
    const packageKey = this.readPackageKey(manifestLike);

    if (!this.readString(normalized.pluginKey) && packageKey) {
      normalized.pluginKey = packageKey;
    }
    if (this.isRecord(manifestLike.runtime)) {
      normalized.runtime = {
        ...manifestLike.runtime,
        workerType:
          manifestLike.runtime.workerType === 'thread'
            ? 'node-worker'
            : manifestLike.runtime.workerType,
      };
    }

    return normalized;
  }

  /**
   * Adds the planned `manifest.key` alias while preserving the current manifest parser type.
   * @param manifest - Parsed manifest whose `pluginKey` identifies the package.
   * @param pluginKey - Package key exposed to descriptor consumers and future generic workers.
   * @returns Manifest object with a runtime `key` alias for descriptor compatibility.
   */
  private attachPackageKeyAlias(
    manifest: QqbotPluginManifest,
    pluginKey: string,
  ): QqbotPluginManifest {
    return {
      ...manifest,
      key: pluginKey,
    } as QqbotPluginManifest;
  }

  /**
   * Reads the package key from either the planned `key` field or the current `pluginKey` field.
   * @param manifestLike - Parsed `plugin.json` object that declares the package identity.
   * @returns Non-empty package key when declared.
   */
  private readPackageKey(manifestLike: Record<string, unknown>): string {
    return (
      this.readString(manifestLike.key) ||
      this.readString(manifestLike.pluginKey) ||
      ''
    );
  }

  /**
   * Narrows JSON values to object records before reading manifest fields.
   * @param value - Parsed JSON value from a QQBot plugin package manifest.
   * @returns Whether the value is a non-array object record.
   */
  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Normalizes string manifest fields used by package discovery.
   * @param value - Raw JSON field value read from `plugin.json`.
   * @returns Trimmed string when the field is non-empty.
   */
  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : undefined;
  }
}
