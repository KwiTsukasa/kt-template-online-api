import 'reflect-metadata';
import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';

type DependencyMetadata = {
  index: number;
  param: unknown;
};

const unwrapForwardRef = (token: unknown) => {
  if (
    token &&
    typeof token === 'object' &&
    'forwardRef' in token &&
    typeof token.forwardRef === 'function'
  ) {
    return token.forwardRef();
  }
  return token;
};

const resolveConstructorToken = (target: unknown, index: number) => {
  const explicitDependencies = (Reflect.getMetadata(
    SELF_DECLARED_DEPS_METADATA,
    target,
  ) || []) as DependencyMetadata[];
  const explicitToken = explicitDependencies.find(
    (dependency) => dependency.index === index,
  )?.param;
  if (explicitToken) return unwrapForwardRef(explicitToken);

  const designTypes =
    (Reflect.getMetadata('design:paramtypes', target) as unknown[]) || [];
  return unwrapForwardRef(designTypes[index]);
};

describe('QQBot plugin platform DI tokens', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('keeps the built-in plugin loader injection token stable across require order', async () => {
    const { QqbotBuiltinPluginPackageLoaderService } = await import(
      '../../../../src/modules/qqbot/plugin-platform/infrastructure/integration/package/builtin-plugin-package-loader.service'
    );
    const { QqbotPluginRegistryService } = await import(
      '../../../../src/modules/qqbot/plugin-platform/application/registry/qqbot-plugin-registry.service'
    );
    const { QqbotPluginPlatformService } = await import(
      '../../../../src/modules/qqbot/plugin-platform/application/plugin-platform.service'
    );

    expect(resolveConstructorToken(QqbotPluginRegistryService, 0)).toBe(
      QqbotBuiltinPluginPackageLoaderService,
    );
    expect(resolveConstructorToken(QqbotPluginPlatformService, 14)).toBe(
      QqbotBuiltinPluginPackageLoaderService,
    );
  });
});
