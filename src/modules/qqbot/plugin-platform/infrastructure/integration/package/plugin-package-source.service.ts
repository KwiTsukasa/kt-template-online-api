import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseQqbotPluginManifest } from '@/modules/qqbot/plugin-platform/domain/manifest';

import { QqbotPluginPackagePathPolicyService } from './plugin-package-path-policy.service';
import type { QqbotPluginPackageDescriptor } from './plugin-package.types';

@Injectable()
export class QqbotPluginPackageSourceService {
  constructor(
    private readonly pathPolicy: QqbotPluginPackagePathPolicyService,
  ) {}

  /** 发现包。 */
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

  /** 读取描述文件。 */
  readDescriptor(packageRoot: string): QqbotPluginPackageDescriptor | null {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifestFile = join(controlledPackageRoot, 'plugin.json');

    if (!existsSync(manifestFile)) {
      return null;
    }

    const manifestLike = JSON.parse(readFileSync(manifestFile, 'utf8'));
    return this.resolveDescriptor(controlledPackageRoot, manifestLike);
  }

  /** 解析描述文件。 */
  resolveDescriptor(
    packageRoot: string,
    manifestLike: unknown,
  ): QqbotPluginPackageDescriptor {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifest = parseQqbotPluginManifest(manifestLike, {
      pluginRoot: controlledPackageRoot,
    });
    const entryFile = this.pathPolicy.resolveEntryFile(
      controlledPackageRoot,
      manifest.entry,
    );

    return {
      entry: manifest.entry,
      entryFile,
      manifest,
      packageRoot: controlledPackageRoot,
      pluginKey: manifest.key,
    };
  }

  /** 列出包根目录。 */
  private listPackageRoots(root: string): string[] {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  }
}
