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

@Injectable()
export class QqbotPluginPackagePathPolicyService {
  private readonly controlledRoots: string[];

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

  /** 列出现有的根目录。 */
  listExistingRoots(): string[] {
    return this.controlledRoots.filter(
      (root) => existsSync(root) && statSync(root).isDirectory(),
    );
  }

  /** 解析条目文件。 */
  resolveEntryFile(packageRoot: string, entry: string): string {
    const normalizedPackageRoot = resolve(packageRoot);
    const entryFile = resolve(normalizedPackageRoot, entry);

    if (isAbsolute(entry) || this.isOutside(normalizedPackageRoot, entryFile)) {
      throw new Error('Plugin entry must stay inside the package root');
    }

    return this.resolveCompiledEntryFile(entryFile);
  }

  /** 断言受控的包根目录。 */
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

  /** 解析已持久化的内置的包根目录。 */
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

  /** 判断外部是否成立。 */
  private isOutside(root: string, candidate: string): boolean {
    const relation = relative(root, candidate);
    return (
      relation === '..' ||
      relation.startsWith(`..${sep}`) ||
      isAbsolute(relation)
    );
  }

  /** 返回到路径分段。 */
  private toPathSegments(pathValue: string): string[] {
    return pathValue
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment && segment !== '.');
  }

  /** 返回开始携带分段。 */
  private startsWithSegments(candidate: string[], expected: string[]): boolean {
    return expected.every((segment, index) => candidate[index] === segment);
  }

  /** 返回结束位置携带分段。 */
  private endsWithSegments(candidate: string[], expected: string[]): boolean {
    const offset = candidate.length - expected.length;
    if (offset < 0) return false;
    return expected.every(
      (segment, index) => candidate[offset + index] === segment,
    );
  }

  /** 解析已编译的条目文件。 */
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

/** 解析默认内置的包根目录。 */
function resolveDefaultBuiltinPackageRoots(): string[] {
  const candidates = DEFAULT_BUILTIN_PACKAGE_ROOT_SEGMENTS.map((segments) =>
    resolve(process.cwd(), ...segments),
  );
  return [candidates.find((candidate) => existsSync(candidate)) || candidates[0]];
}
