import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { AdminAuthGuardModule } from '../../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { AppModule } from '../../../../src/app.module';
import { BOT_ACCOUNT_NAPCAT_RUNTIME_PORT } from '../../../../src/modules/bot-adapter/core/application/account/bot-account-napcat-runtime.port';
import { BotAdapterCoreModule } from '../../../../src/modules/bot-adapter/core/bot-adapter-core.module';
import {
  NAPCAT_CONTROLLERS,
  NAPCAT_ENTITIES,
  NAPCAT_EXPORTS,
  NAPCAT_PROVIDERS,
  NapcatModule,
} from '../../../../src/modules/bot-adapter/napcat/napcat.module';
import { NapcatAccountRuntimeService } from '../../../../src/modules/bot-adapter/napcat/application/account-runtime/napcat-account-runtime.service';
import { NapcatLoginController } from '../../../../src/modules/bot-adapter/napcat/contract/napcat-login.controller';
import { NapcatContainerService } from '../../../../src/modules/bot-adapter/napcat/infrastructure/integration/container/napcat-container.service';
import {
  collectControllerRoutes,
  routeKey,
} from '../../../helpers/controller-route.helper';
import { readRefactorV3SqlSchema } from '../../../helpers/sql-schema.helper';

const getModuleMetadata = <T>(moduleClass: unknown, key: string): T[] => {
  return Reflect.getMetadata(key, moduleClass) || [];
};

const getNames = (items: unknown[]) =>
  items.map((item) => {
    if (typeof item === 'symbol') return item.description || item.toString();
    return (item as { name?: string }).name || `${item}`;
  });

const unwrapForwardRef = (item: unknown) => {
  const maybeForwardRef = item as { forwardRef?: () => unknown };
  return typeof maybeForwardRef.forwardRef === 'function'
    ? maybeForwardRef.forwardRef()
    : item;
};

type EntityClass = new (...args: never[]) => unknown;

const getEntityTableName = (entity: EntityClass) => {
  return getMetadataArgsStorage().tables.find(
    (table) => table.target === entity,
  )?.name;
};

describe('QQBot NapCat module ownership', () => {
  const schema = readRefactorV3SqlSchema();

  it('owns scan, captcha, QR refresh and SSE routes under the NapCat boundary', () => {
    const routes = collectControllerRoutes(NAPCAT_CONTROLLERS);

    expect(NAPCAT_CONTROLLERS).toEqual(
      expect.arrayContaining([NapcatLoginController]),
    );
    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'POST /bot-adapter/napcat/account/scan/create',
        'POST /bot-adapter/napcat/account/scan/refresh',
        'GET /bot-adapter/napcat/account/scan/status',
        'GET /bot-adapter/napcat/account/scan/events',
        'POST /bot-adapter/napcat/account/scan/qrcode/refresh',
        'POST /bot-adapter/napcat/account/scan/captcha/submit',
        'POST /bot-adapter/napcat/account/scan/cancel',
      ]),
    );
  });

  it('is imported as its own Nest module and keeps contract files in napcat/contract', () => {
    const contractControllerPath = join(
      process.cwd(),
      'src',
      'modules',
      'bot-adapter',
      'napcat',
      'contract',
      'napcat-login.controller.ts',
    );
    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);
    const napcatImports = getModuleMetadata(
      NapcatModule,
      MODULE_METADATA.IMPORTS,
    ).map(unwrapForwardRef);

    expect(existsSync(contractControllerPath)).toBe(true);
    expect(appImports).toEqual(expect.arrayContaining([NapcatModule]));
    expect(napcatImports).toEqual(
      expect.arrayContaining([
        ConfigModule,
        AdminAuthGuardModule,
        BotAdapterCoreModule,
      ]),
    );
    expect(
      napcatImports.some(
        (item) => (item as { module?: unknown }).module === TypeOrmModule,
      ),
    ).toBe(true);
  });

  it('registers NapCat runtime providers and entities outside QQBot core', () => {
    expect(getNames(NAPCAT_PROVIDERS)).toEqual(
      expect.arrayContaining([
        'NapcatDeviceIdentityService',
        'NapcatLoginStateStoreService',
        'NapcatAccountRuntimeService',
        'NapcatContainerService',
        'NapcatLoginService',
        'NapcatWatchdogService',
      ]),
    );
    expect(getNames(NAPCAT_ENTITIES)).toEqual(
      expect.arrayContaining([
        'NapcatAccountBinding',
        'NapcatContainer',
        'NapcatDeviceIdentity',
        'NapcatLoginChallengeEntity',
        'NapcatLoginSession',
        'NapcatRuntimeCleanup',
      ]),
    );
    expect(getNames(NAPCAT_ENTITIES)).not.toEqual(
      expect.arrayContaining(['BotAccountNapcat', 'NapcatContainer']),
    );
    expect(getNames(NAPCAT_EXPORTS)).toEqual(
      expect.arrayContaining([
        'NapcatDeviceIdentityService',
        'NapcatLoginStateStoreService',
        'BOT_ACCOUNT_NAPCAT_RUNTIME_PORT',
        'NapcatLoginService',
      ]),
    );
    expect(NAPCAT_EXPORTS).not.toContain(NapcatContainerService);
    expect(NAPCAT_PROVIDERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: BOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
          useExisting: NapcatAccountRuntimeService,
        }),
      ]),
    );
  });

  it('keeps every registered NapCat entity mapped to the refactor-v3 schema', () => {
    for (const entity of NAPCAT_ENTITIES) {
      const tableName = getEntityTableName(entity);

      expect(tableName).toBeTruthy();
      expect(schema.hasTable(tableName || '')).toBe(true);
    }
  });

  it('does not keep legacy bot_napcat tables as executable schema truth', () => {
    const schemaSql = readFileSync(
      join(process.cwd(), 'sql', 'refactor-v3', '00-full-schema.sql'),
      'utf8',
    );
    const qqbotInitSql = readFileSync(
      join(process.cwd(), 'sql', 'bot-init.sql'),
      'utf8',
    );

    expect(schemaSql).not.toContain(
      'CREATE TABLE IF NOT EXISTS bot_account_napcat',
    );
    expect(schemaSql).not.toContain(
      'CREATE TABLE IF NOT EXISTS bot_napcat_container',
    );
    expect(qqbotInitSql).not.toContain('bot_account_napcat');
    expect(qqbotInitSql).not.toContain('bot_napcat_container');
    expect(qqbotInitSql).toContain(
      'CREATE TABLE IF NOT EXISTS `napcat_account_binding`',
    );
    expect(qqbotInitSql).toContain(
      'CREATE TABLE IF NOT EXISTS `napcat_container`',
    );
    expect(
      getNames(NAPCAT_ENTITIES).filter((name) =>
        name.startsWith('Bot'),
      ),
    ).toEqual([]);
  });
});
