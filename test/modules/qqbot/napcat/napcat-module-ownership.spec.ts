import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { AdminAuthGuardModule } from '../../../../src/modules/admin/identity/auth/admin-auth-guard.module';
import { AppModule } from '../../../../src/app.module';
import { QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT } from '../../../../src/modules/qqbot/core/application/account/qqbot-account-napcat-runtime.port';
import { QqbotCoreModule } from '../../../../src/modules/qqbot/core/qqbot-core.module';
import {
  QQBOT_NAPCAT_CONTROLLERS,
  QQBOT_NAPCAT_ENTITIES,
  QQBOT_NAPCAT_EXPORTS,
  QQBOT_NAPCAT_PROVIDERS,
  QqbotNapcatModule,
} from '../../../../src/modules/qqbot/napcat/qqbot-napcat.module';
import { QqbotNapcatAccountRuntimeService } from '../../../../src/modules/qqbot/napcat/application/account-runtime/qqbot-napcat-account-runtime.service';
import { QqbotNapcatLoginController } from '../../../../src/modules/qqbot/napcat/contract/qqbot-napcat-login.controller';
import { QqbotNapcatContainerService } from '../../../../src/modules/qqbot/napcat/infrastructure/integration/container/qqbot-napcat-container.service';
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
    const routes = collectControllerRoutes(QQBOT_NAPCAT_CONTROLLERS);

    expect(QQBOT_NAPCAT_CONTROLLERS).toEqual(
      expect.arrayContaining([QqbotNapcatLoginController]),
    );
    expect(routes.map(routeKey)).toEqual(
      expect.arrayContaining([
        'POST /qqbot/account/scan/create',
        'POST /qqbot/account/scan/refresh',
        'GET /qqbot/account/scan/status',
        'GET /qqbot/account/scan/events',
        'POST /qqbot/account/scan/qrcode/refresh',
        'POST /qqbot/account/scan/captcha/submit',
        'POST /qqbot/account/scan/cancel',
      ]),
    );
  });

  it('is imported as its own Nest module and keeps contract files in napcat/contract', () => {
    const contractControllerPath = join(
      process.cwd(),
      'src',
      'modules',
      'qqbot',
      'napcat',
      'contract',
      'qqbot-napcat-login.controller.ts',
    );
    const appImports = getModuleMetadata(AppModule, MODULE_METADATA.IMPORTS);
    const napcatImports = getModuleMetadata(
      QqbotNapcatModule,
      MODULE_METADATA.IMPORTS,
    ).map(unwrapForwardRef);

    expect(existsSync(contractControllerPath)).toBe(true);
    expect(appImports).toEqual(expect.arrayContaining([QqbotNapcatModule]));
    expect(napcatImports).toEqual(
      expect.arrayContaining([
        ConfigModule,
        AdminAuthGuardModule,
        QqbotCoreModule,
      ]),
    );
    expect(
      napcatImports.some(
        (item) => (item as { module?: unknown }).module === TypeOrmModule,
      ),
    ).toBe(true);
  });

  it('registers NapCat runtime providers and entities outside QQBot core', () => {
    expect(getNames(QQBOT_NAPCAT_PROVIDERS)).toEqual(
      expect.arrayContaining([
        'NapcatDeviceIdentityService',
        'NapcatLoginStateStoreService',
        'QqbotNapcatAccountRuntimeService',
        'QqbotNapcatContainerService',
        'QqbotNapcatLoginService',
        'QqbotNapcatWatchdogService',
      ]),
    );
    expect(getNames(QQBOT_NAPCAT_ENTITIES)).toEqual(
      expect.arrayContaining([
        'NapcatAccountBinding',
        'NapcatContainer',
        'NapcatDeviceIdentity',
        'NapcatLoginChallengeEntity',
        'NapcatLoginSession',
        'NapcatRuntimeCleanup',
      ]),
    );
    expect(getNames(QQBOT_NAPCAT_ENTITIES)).not.toEqual(
      expect.arrayContaining(['QqbotAccountNapcat', 'QqbotNapcatContainer']),
    );
    expect(getNames(QQBOT_NAPCAT_EXPORTS)).toEqual(
      expect.arrayContaining([
        'NapcatDeviceIdentityService',
        'NapcatLoginStateStoreService',
        'QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT',
        'QqbotNapcatLoginService',
      ]),
    );
    expect(QQBOT_NAPCAT_EXPORTS).not.toContain(QqbotNapcatContainerService);
    expect(QQBOT_NAPCAT_PROVIDERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: QQBOT_ACCOUNT_NAPCAT_RUNTIME_PORT,
          useExisting: QqbotNapcatAccountRuntimeService,
        }),
      ]),
    );
  });

  it('keeps every registered NapCat entity mapped to the refactor-v3 schema', () => {
    for (const entity of QQBOT_NAPCAT_ENTITIES) {
      const tableName = getEntityTableName(entity);

      expect(tableName).toBeTruthy();
      expect(schema.hasTable(tableName || '')).toBe(true);
    }
  });

  it('does not keep legacy qqbot_napcat tables as executable schema truth', () => {
    const schemaSql = readFileSync(
      join(process.cwd(), 'sql', 'refactor-v3', '00-full-schema.sql'),
      'utf8',
    );
    const qqbotInitSql = readFileSync(
      join(process.cwd(), 'sql', 'qqbot-init.sql'),
      'utf8',
    );

    expect(schemaSql).not.toContain('CREATE TABLE IF NOT EXISTS qqbot_account_napcat');
    expect(schemaSql).not.toContain('CREATE TABLE IF NOT EXISTS qqbot_napcat_container');
    expect(qqbotInitSql).not.toContain('qqbot_account_napcat');
    expect(qqbotInitSql).not.toContain('qqbot_napcat_container');
    expect(qqbotInitSql).toContain('CREATE TABLE IF NOT EXISTS `napcat_account_binding`');
    expect(qqbotInitSql).toContain('CREATE TABLE IF NOT EXISTS `napcat_container`');
    expect(
      getNames(QQBOT_NAPCAT_ENTITIES).filter((name) =>
        name.startsWith('Qqbot'),
      ),
    ).toEqual([]);
  });
});
