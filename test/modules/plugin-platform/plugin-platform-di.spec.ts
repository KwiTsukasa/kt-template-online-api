import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { PluginPlatformService } from '../../../src/modules/plugin-platform/application/plugin-platform.service';
import { PluginPackagePathPolicyService } from '../../../src/modules/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service';
import { TaskExecutionService } from '@/modules/task-execution/application/task-execution.service';

describe('plugin platform DI tokens', () => {
  it('does not inject the removed built-in plugin loader into platform services', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/plugin-platform/plugin-platform.module.ts',
      ),
      'utf8',
    );

    expect(source).not.toContain(`Bot${'Builtin'}PluginPackageLoaderService`);
    expect(source).toContain('PluginPackageSourceService');
    expect(source).toMatch(
      /providers:\s*\[[\s\S]*PluginPlatformPermissionGuard/u,
    );
    expect(source).toContain('PluginWorkerRuntimeFactoryService');
  });

  it('keeps task execution independent from the plugin platform implementation', () => {
    const paramTypes =
      Reflect.getMetadata('design:paramtypes', TaskExecutionService) || [];

    expect(paramTypes).not.toContain(PluginPlatformService);
  });

  it('lets Nest instantiate the package path policy without a config-array provider', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PluginPackagePathPolicyService],
    }).compile();

    expect(moduleRef.get(PluginPackagePathPolicyService)).toBeInstanceOf(
      PluginPackagePathPolicyService,
    );
  });

  it('exports Bot config service for plugin host bridge dependencies', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/bot-adapter/core/bot-adapter-core.module.ts',
      ),
      'utf8',
    );
    const exportsBlock = source.match(
      /export const BOT_CORE_EXPORTS = \[([\s\S]*?)\];/,
    )?.[1];

    expect(exportsBlock).toContain('BotConfigService');
  });
});
