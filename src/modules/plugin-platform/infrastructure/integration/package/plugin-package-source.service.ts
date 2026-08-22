import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePluginManifest } from '@/modules/plugin-platform/domain/manifest';

import { PluginPackagePathPolicyService } from './plugin-package-path-policy.service';
import type { PluginPackageDescriptor } from './plugin-package.types';

@Injectable()
export class PluginPackageSourceService {
  constructor(
    private readonly pathPolicy: PluginPackagePathPolicyService,
  ) {}

  /**
   * 根据当前运行态处理发现包；从 `pathPolicy.listExistingRoots` 读取发现包。
   * @returns 按输入顺序得到的发现包列表；没有匹配项时为空数组。
   */
  async discoverPackages(): Promise<PluginPackageDescriptor[]> {
    const descriptors: PluginPackageDescriptor[] = [];

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
   * 按`packageRoot`读取描述文件；当 `!existsSync(manifestFile)` 成立时返回 `null`。
   * @param packageRoot - 必须保持在受控根目录内的插件包根目录路径。
   * @returns 描述文件；无法解析或未命中时为 `null`。
   */
  readDescriptor(packageRoot: string): PluginPackageDescriptor | null {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifestFile = join(controlledPackageRoot, 'plugin.json');

    if (!existsSync(manifestFile)) {
      return null;
    }

    const manifestLike = JSON.parse(readFileSync(manifestFile, 'utf8'));
    return this.resolveDescriptor(controlledPackageRoot, manifestLike);
  }

  /**
   * 从`packageRoot`、`manifestLike`解析描述文件；先通过 `pathPolicy.assertControlledPackageRoot` 校验输入边界。
   * @param packageRoot - 必须保持在受控根目录内的插件包根目录路径。
   * @param manifestLike - 决定描述文件内容、边界或目标的 `manifestLike` 值。
   * @returns 包含 `entry`、`entryFile`、`manifest`、`packageRoot`、`pluginKey` 字段的描述文件。
   */
  resolveDescriptor(
    packageRoot: string,
    manifestLike: unknown,
  ): PluginPackageDescriptor {
    const controlledPackageRoot =
      this.pathPolicy.assertControlledPackageRoot(packageRoot);
    const manifest = parsePluginManifest(manifestLike, {
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

  /**
   * 按`root`读取包根目录；从 `readdirSync` 读取包根目录。
   * @param root - 决定包根目录内容、边界或目标的 `root` 值。
   * @returns 按输入顺序得到的包根目录列表；没有匹配项时为空数组。
   */
  private listPackageRoots(root: string): string[] {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  }
}
