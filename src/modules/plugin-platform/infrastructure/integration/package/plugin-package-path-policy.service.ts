import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS = [
  ['src', 'modules', 'plugins'],
  ['dist', 'modules', 'plugins'],
];
export const PLUGIN_PACKAGE_CONTROLLED_ROOTS = Symbol(
  'PLUGIN_PACKAGE_CONTROLLED_ROOTS',
);

@Injectable()
export class PluginPackagePathPolicyService {
  private readonly controlledRoots: string[];

  constructor(
    @Optional()
    @Inject(PLUGIN_PACKAGE_CONTROLLED_ROOTS)
    controlledRoots?: string[],
  ) {
    this.controlledRoots = (
      (() => {
        if (controlledRoots?.length) {
          return controlledRoots;
        }
        return resolveDefaultBuiltinPackageRoots();
      })()
    ).map((root) => resolve(root));
  }

  /**
   * 按当前运行态读取现有的根目录。
   * @returns 按输入顺序得到的现有的根目录列表；没有匹配项时为空数组。
   */
  listExistingRoots(): string[] {
    return this.controlledRoots.filter(
      (root) => existsSync(root) && statSync(root).isDirectory(),
    );
  }

  /**
   * 将插件清单入口解析到包内，并优先返回对应的已编译文件，禁止入口逃逸受控包根目录。
   * @param packageRoot - 用作入口解析边界的插件包根目录。
   * @param entry - 插件清单声明的包内相对入口路径。
   * @returns 位于包根目录内的源码入口或其已编译入口。
   * @throws 入口是绝对路径或解析后位于包根目录外时抛出 `Error`。
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
   * 恢复并规范化插件包路径，只允许受控根目录本身或其后代目录进入插件加载流程。
   * @param packageRoot - 待验证的当前路径或历史内置插件持久化路径。
   * @returns 映射到当前布局后、确认位于受控范围内的绝对包根目录。
   * @throws 规范化后的包路径不属于任何受控根目录时抛出 `Error`。
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
   * 仅把“内置根目录加一级包名”的相对持久化路径恢复到当前受控内置目录；其他路径返回 `null`。
   * @param packageRoot - 必须保持在受控根目录内的插件包根目录路径。
   * @returns 返回恢复后的受控内置包目录；路径结构不符合约束时为 `null`。
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
    if (controlledRoot) {
      return resolve(controlledRoot, packageName);
    }
    return null;
  }

  /**
   * 根据`root`、`candidate`与当前约束判定外部。
   * @param root - 决定外部内容、边界或目标的 `root` 值。
   * @param candidate - 决定是否启用“candidate”分支的布尔选项。
   * @returns 满足外部约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 将输入收敛并投影为路径分段。
   * @param pathValue - 决定路径分段内容、边界或目标的 `pathValue` 值。
   * @returns 按输入顺序得到的路径分段列表；没有匹配项时为空数组。
   */
  private toPathSegments(pathValue: string): string[] {
    return pathValue
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment && segment !== '.');
  }

  /**
   * 按当前约束判定分段。
   * @param candidate - 决定是否启用“candidate”分支的布尔选项。
   * @param expected - 决定分段内容、边界或目标的 `expected` 值。
   * @returns 满足分段约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private startsWithSegments(candidate: string[], expected: string[]): boolean {
    return expected.every((segment, index) => candidate[index] === segment);
  }

  /**
   * 按当前约束判定分段。
   * @param candidate - 决定是否启用“candidate”分支的布尔选项。
   * @param expected - 用于分段的领域对象，包含 `length` 字段。
   * @returns 满足分段约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private endsWithSegments(candidate: string[], expected: string[]): boolean {
    const offset = candidate.length - expected.length;
    if (offset < 0) return false;
    return expected.every(
      (segment, index) => candidate[offset + index] === segment,
    );
  }

  /**
   * 从`entryFile`解析已编译的条目文件；当 `entryFile.endsWith('.ts')` 成立时返回 `compiledEntryFile`。
   * @param entryFile - 决定已编译的条目文件内容、边界或目标的 `entryFile` 值。
   * @returns 已编译的条目文件。
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
 * 解析默认内置的包根目录；通过 `DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.map` 转换默认内置的包根目录的输出结构，通过 `candidates.find` 查询匹配的持久化记录。
 * @returns 返回按当前输入生成的默认内置的包根目录列表；没有元素时为空数组。
 */
function resolveDefaultBuiltinPackageRoots(): string[] {
  const candidates = DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.map((segments) =>
    resolve(process.cwd(), ...segments),
  );
  return [candidates.find((candidate) => existsSync(candidate)) || candidates[0]];
}
