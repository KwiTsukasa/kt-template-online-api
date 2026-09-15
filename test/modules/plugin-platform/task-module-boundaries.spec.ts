import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import * as ts from 'typescript';
import { Test } from '@nestjs/testing';
import { TaskHandlerRegistry } from '@/modules/task-execution/application/task-handler.registry';
import {
  TASK_HANDLERS,
} from '@/modules/task-execution/contract/task-handler.port';

const sourceRoot = resolve(__dirname, '../../../src');
const businessFiles = [
  'modules/bot-adapter/core/application/message/bot-reminder.service.ts',
  'modules/bot-adapter/core/application/message/bot-reminder.store.ts',
  'modules/message-management/application/system-message-delivery-coordinator.service.ts',
  'modules/admin/media-governance/application/media-governance-catalog.service.ts',
  'modules/admin/media-governance/application/media-governance.service.ts',
  'modules/admin/platform-config/network-management/application/network-ddns.service.ts',
  'modules/bot-adapter/napcat/application/login/napcat-watchdog.service.ts',
];

/**
 * 从实际语法树读取导入边界，避免仅凭文件名或注释判断模块依赖。
 * @param file - 待验证的源文件绝对路径。
 * @returns 静态导入使用的模块路径。
 */
function importsOf(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  return source.statements.flatMap((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      return [node.moduleSpecifier.text];
    return [];
  });
}

/**
 * 只遍历中立调度模块的源文件以检查反向依赖。
 * @param directory - 中立调度模块内的目录。
 * @returns 该目录中的全部类型脚本路径。
 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.name.endsWith('.ts')) return [path];
    return [];
  });
}

describe('task scheduling module boundaries', () => {
  it.each(businessFiles)(
    '%s exposes domain operations without importing scheduling',
    (file) => {
      const imports = importsOf(resolve(sourceRoot, file));
      expect(
        imports.filter((path) => path.includes('task-scheduling')),
      ).toEqual([]);
      expect(
        imports.filter((path) => path.includes('plugin-platform')),
      ).toEqual([]);
    },
  );

  it('scheduling owns its storage and has no dependency on plugin or business implementations', () => {
    const moduleRoot = resolve(sourceRoot, 'modules/task-scheduling');
    for (const file of sourceFiles(moduleRoot)) {
      for (const dependency of importsOf(file)) {
        if (dependency.startsWith('@/') || dependency.startsWith('.')) {
          let target = resolve(file, '..', dependency);
          if (dependency.startsWith('@/'))
            target = resolve(sourceRoot, dependency.slice(2));
          const shared =
            dependency.startsWith('@/common/') ||
            /^@\/modules\/(trigger-engine|rule-engine|task-execution|workflow-engine)\/contract\//.test(
              dependency,
            ) ||
            dependency === '@/common' ||
            dependency.startsWith('@/modules/admin/identity/auth/') ||
            dependency === '@/modules/admin/contract/admin.types';
          if (!shared)
            expect(relative(moduleRoot, target).startsWith('..')).toBe(false);
        }
        expect(dependency).not.toMatch(
          /plugin-platform|media-governance|napcat/,
        );
      }
    }
  });

  it('plugin platform does not import scheduling or execution modules', () => {
    for (const file of sourceFiles(
      resolve(sourceRoot, 'modules/plugin-platform'),
    )) {
      for (const dependency of importsOf(file)) {
        expect(dependency).not.toMatch(
          /modules\/(task-scheduling|task-execution|trigger-engine|workflow-engine|automation-monitor)\//,
        );
      }
    }
  });

  it('composes the registry through its token without loading business modules', async () => {
    const module = await Test.createTestingModule({
      providers: [
        { provide: TASK_HANDLERS, useClass: TaskHandlerRegistry },
      ],
    }).compile();
    const registry = module.get<TaskHandlerRegistry>(
      TASK_HANDLERS,
    );
    const execute = jest.fn().mockResolvedValue({});
    const definition = {
      key: 'test.boundary',
      version: 1,
      name: '边界测试',
      ownerKind: 'system',
      inputSchema: { fields: [] },
      outputSchema: { fields: [] },
      isAvailable: async () => true,
      timeoutMs: 1000,
      idempotent: true,
      execute,
    };
    const release = registry.register(definition);
    expect(() => registry.register(definition)).toThrow('重复注册');
    await registry.resolve({ key: definition.key, version: 1 })?.execute({
      input: {},
      runId: '1',
      attemptId: '2',
      executionKey: 'boundary',
      signal: new AbortController().signal,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    const releaseNew = registry.register(definition);
    release();
    expect(await registry.catalog()).toHaveLength(1);
    releaseNew();
    expect(await registry.catalog()).toEqual([]);
    await module.close();
  });
});
