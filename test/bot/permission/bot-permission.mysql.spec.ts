jest.mock(
  '@/modules/bot-adapter/core/application/command/bot-command.service',
  () => ({ BotCommandService: class {} }),
);
jest.mock(
  '@/modules/bot-adapter/core/application/send/bot-send.service',
  () => ({ BotSendService: class {} }),
);
jest.mock(
  '@/modules/bot-adapter/core/application/account/bot-account.service',
  () => ({ BotAccountService: class {} }),
);
jest.mock(
  '@/modules/bot-adapter/core/infrastructure/integration/connection/bot-reverse-ws.service',
  () => ({ BotReverseWsService: class {} }),
);

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { createConnection, type Connection } from 'mysql2/promise';
import { DataSource } from 'typeorm';
import { ToolsService } from '@/common';
import { parseMysqlScript } from '@/commands/migrate-bot-adapter-protocol';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { BotPermissionController } from '@/modules/bot-adapter/core/contract/permission/bot-permission.controller';
import { BotPermissionService } from '@/modules/bot-adapter/core/application/permission/bot-permission.service';
import { BotPermissionOptionsService } from '@/modules/bot-adapter/core/application/permission/bot-permission-options.service';
import { BotConfigService } from '@/modules/bot-adapter/core/application/config/bot-config.service';
import { BotRuleEngineService } from '@/modules/bot-adapter/core/application/send/bot-rule-engine.service';
import { BotAllowlist } from '@/modules/bot-adapter/core/infrastructure/persistence/permission/bot-allowlist.entity';
import { BotBlocklist } from '@/modules/bot-adapter/core/infrastructure/persistence/permission/bot-blocklist.entity';

let mysqlDescribe = describe.skip;
if (process.env.KT_PERMISSION_MYSQL_TEST === '1') mysqlDescribe = describe;

mysqlDescribe('Bot permission real local MySQL and HTTP', () => {
  const database = `kt_template_local_permission_${randomUUID().replaceAll('-', '')}`;
  let connection: Connection;
  let source: DataSource;
  let service: BotPermissionService;
  let databaseOwned = false;
  let migratedRows: any[];
  let migratedAgainRows: any[];
  let verification: Record<string, unknown>;
  const group = {
    selfId: 'bot-a',
    targetType: 'group' as const,
    targetId: 'group-a',
    preciseUser: true,
    userIds: ['user-a', 'user-b'],
  };
  const runMigration = async () => {
    for (const sql of parseMysqlScript(
      readFileSync('sql/bot-permission-user-sets-v1.sql', 'utf8'),
    ))
      await connection.query(sql);
  };

  beforeAll(async () => {
    // 固定回环地址，绝不采用环境文件的远端 DB_HOST/DB_DATABASE。
    const options = {
      host: '127.0.0.1',
      port: 3306,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      connectTimeout: 5000,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    connection = await createConnection(options);
    await connection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    databaseOwned = true;
    await connection.query(`USE \`${database}\``);
    const schema = readFileSync('sql/refactor-v3/00-full-schema.sql', 'utf8');
    for (const table of ['bot_allowlist', 'bot_blocklist']) {
      const legacy = schema
        .match(
          new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]+?;`),
        )![0]
        .replace('  user_ids JSON NULL,\n', '')
        .replace('  user_ids JSON NULL,\r\n', '');
      await connection.query(legacy);
      await connection.query(
        `INSERT INTO ${table} (id, self_id, target_type, target_id, precise_user, user_id, update_time) VALUES (1, 'bot-a', 'group', 'legacy-group', 1, 'legacy-user', '2026-01-01 00:00:00')`,
      );
    }
    await runMigration();
    [migratedRows] = await connection.query<any[]>(
      'SELECT id, user_id, user_ids, update_time FROM bot_allowlist',
    );
    await connection.query(
      'UPDATE bot_allowlist SET user_ids = JSON_ARRAY(?, ?) WHERE id = 1',
      ['replacement-a', 'replacement-b'],
    );
    await runMigration();
    [migratedAgainRows] = await connection.query<any[]>(
      'SELECT id, user_id, user_ids FROM bot_allowlist',
    );
    verification = {};
    for (const sql of parseMysqlScript(
      readFileSync('sql/bot-permission-user-sets-v1-verify.sql', 'utf8'),
    )) {
      const [rows] = await connection.query<any[]>(sql);
      Object.assign(verification, rows[0]);
    }
    source = await new DataSource({
      type: 'mysql',
      host: options.host,
      port: options.port,
      username: options.user,
      password: options.password,
      database,
      entities: [BotAllowlist, BotBlocklist],
      synchronize: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    }).initialize();
    service = new BotPermissionService(
      new BotConfigService({} as any),
      source.getRepository(BotAllowlist),
      source.getRepository(BotBlocklist),
      new ToolsService(),
    );
  }, 30_000);

  beforeEach(async () => {
    await source.query('DELETE FROM bot_allowlist');
    await source.query('DELETE FROM bot_blocklist');
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (connection) {
      if (
        databaseOwned &&
        /^kt_template_local_permission_[a-f0-9]{32}$/u.test(database)
      )
        await connection.query(`DROP DATABASE \`${database}\``);
      await connection.end();
    }
  });

  it('migrates legacy users without changing row identity and preserves later arrays on rerun', () => {
    expect(migratedRows).toHaveLength(1);
    expect(migratedRows[0]).toMatchObject({
      id: '1',
      user_id: 'legacy-user',
      user_ids: ['legacy-user'],
    });
    expect(migratedRows[0].update_time.getFullYear()).toBe(2026);
    expect(migratedAgainRows).toEqual([
      {
        id: '1',
        user_id: 'legacy-user',
        user_ids: ['replacement-a', 'replacement-b'],
      },
    ]);
    expect(Number(verification.permission_user_set_column_count)).toBe(2);
    expect(Number(verification.permission_user_set_invalid_count)).toBe(0);
  });

  it('stores two members in one group record and replaces the selection on that same id', async () => {
    const id = await service.save('blocklist', {
      ...group,
      userIds: ['user-a', 'user-b', 'user-a'],
    });
    let page = await service.page('blocklist', {
      targetType: 'group',
      view: 'tree',
    });
    expect(page.total).toBe(1);
    await expect(service.save('blocklist', group)).rejects.toBeDefined();
    expect(page.list[0]).toMatchObject({
      id,
      targetId: 'group-a',
      userIds: ['user-a', 'user-b'],
    });
    await service.update('blocklist', {
      ...group,
      id,
      userIds: ['user-b', 'user-c'],
    });
    page = await service.page('blocklist', { userId: 'user-c', view: 'tree' });
    expect(page.total).toBe(1);
    expect(page.list[0]).toMatchObject({ id, userIds: ['user-b', 'user-c'] });
    expect((await service.page('blocklist', { userId: 'user-a' })).total).toBe(
      0,
    );
    await service.save('blocklist', {
      ...group,
      targetId: 'group-b',
      userIds: ['user-z'],
    });
    expect(
      (await service.page('blocklist', { view: 'tree', pageSize: 1 })).total,
    ).toBe(2);
    expect(
      (await service.page('blocklist', { view: 'tree', pageSize: 1 })).list,
    ).toHaveLength(2);
    expect(
      (await service.page('blocklist', { pageSize: 1 })).list,
    ).toHaveLength(1);
    await service.update('blocklist', { ...group, id, preciseUser: false });
    expect(
      (await source.getRepository(BotBlocklist).findOneByOrFail({ id }))
        .userIds,
    ).toEqual([]);
  });

  it('blocks selected group members before group allowlist, preserving other groups, accounts and global scope', async () => {
    await service.save('allowlist', { ...group, preciseUser: false });
    await service.save('blocklist', group);
    const command = { handleMessage: jest.fn().mockResolvedValue(true) };
    const engine = new BotRuleEngineService(
      {} as any,
      command as any,
      service,
      {} as any,
      {} as any,
      {} as any,
      new ToolsService(),
    );
    const message = {
      selfId: 'bot-a',
      targetId: 'group-a',
      messageType: 'group',
      userId: 'user-a',
      rawEvent: {},
    } as any;
    await engine.handleMessage(message);
    await engine.handleMessage({ ...message, userId: 'user-b' });
    expect(command.handleMessage).not.toHaveBeenCalled();
    await engine.handleMessage({ ...message, userId: 'user-c' });
    expect(command.handleMessage).toHaveBeenCalledTimes(1);
    expect(await service.isBlocked({ ...message, targetId: 'group-b' })).toBe(
      false,
    );
    expect(await service.isBlocked({ ...message, selfId: 'bot-b' })).toBe(
      false,
    );
    expect(await service.isAllowed({ ...message, selfId: 'bot-b' })).toBe(
      false,
    );
    expect(
      await service.isBlocked({ ...message, messageType: 'private' }),
    ).toBe(false);
    await service.save('blocklist', {
      ...group,
      selfId: '',
      targetId: 'global-group',
    });
    expect(
      await service.isBlocked({
        ...message,
        selfId: 'bot-b',
        targetId: 'global-group',
      }),
    ).toBe(true);
    const repository = source.getRepository(BotBlocklist);
    const legacy = await repository.save(
      repository.create({
        ...group,
        targetId: 'legacy-group',
        userIds: null,
        userId: 'legacy-user',
      }),
    );
    expect(
      await service.isBlocked({
        ...message,
        targetId: 'legacy-group',
        userId: 'legacy-user',
      }),
    ).toBe(true);
    await service.update('blocklist', {
      ...group,
      id: legacy.id,
      targetId: 'legacy-group',
      userIds: ['replacement'],
    });
    expect(
      await service.isBlocked({
        ...message,
        targetId: 'legacy-group',
        userId: 'legacy-user',
      }),
    ).toBe(false);
  });

  it('rejects empty or invalid exact members and serves one-record create, update and read over HTTP', async () => {
    for (const userIds of [[], [''], ['bad value'], Array(101).fill('user-a')])
      await expect(
        service.save('blocklist', { ...group, userIds }),
      ).rejects.toBeDefined();
    const module = await Test.createTestingModule({
      controllers: [BotPermissionController],
      providers: [
        { provide: BotPermissionService, useValue: service },
        { provide: BotPermissionOptionsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const post = async (path: string, body: unknown) => {
        const result = await fetch(`${base}/bot/permission/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
        expect(result.status).toBe(200);
        return (await result.json()).data;
      };
      const id = await post('blocklist/save', group);
      await post('blocklist/update', {
        ...group,
        id,
        userIds: ['user-b', 'user-c'],
      });
      const result = await fetch(
        `${base}/bot/permission/blocklist?view=tree&targetType=group`,
        { signal: AbortSignal.timeout(5000) },
      );
      expect(result.status).toBe(200);
      const { data } = await result.json();
      expect(data.total).toBe(1);
      expect(data.list).toHaveLength(1);
      expect(data.list[0]).toMatchObject({
        id,
        selfId: 'bot-a',
        targetId: 'group-a',
        userIds: ['user-b', 'user-c'],
      });
    } finally {
      await app.close();
    }
  });
});
