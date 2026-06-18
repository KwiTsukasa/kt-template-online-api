import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { QqbotPluginPlatformService } from '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service';
import { QqbotPluginPackagePathPolicyService } from '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/plugin-package-path-policy.service';
import { QqbotPluginTaskWorkerProcessor } from '../../../../src/modules/qqbot/plugin-platform/application/task/qqbot-plugin-task-worker.processor';

describe('QQBot plugin platform DI tokens', () => {
  it('does not inject the removed built-in plugin loader into platform services', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/modules/qqbot/plugin-platform/plugin-platform.module.ts',
      ),
      'utf8',
    );

    expect(source).not.toContain(
      `Qqbot${'Builtin'}PluginPackageLoaderService`,
    );
    expect(source).toContain('QqbotPluginPackageSourceService');
    expect(source).toContain('QqbotPluginWorkerRuntimeFactoryService');
  });

  it('keeps the task worker platform service dependency available at runtime', () => {
    const paramTypes =
      Reflect.getMetadata('design:paramtypes', QqbotPluginTaskWorkerProcessor) ||
      [];

    expect(paramTypes[1]).toBe(QqbotPluginPlatformService);
  });

  it('lets Nest instantiate the package path policy without a config-array provider', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [QqbotPluginPackagePathPolicyService],
    }).compile();

    expect(moduleRef.get(QqbotPluginPackagePathPolicyService)).toBeInstanceOf(
      QqbotPluginPackagePathPolicyService,
    );
  });
});
