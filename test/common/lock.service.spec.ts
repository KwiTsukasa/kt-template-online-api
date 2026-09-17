import { Global, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { DataSource } from 'typeorm';
import type { Command, Redis } from 'ioredis';
import { LockModule } from '@/common/locks/lock.module';
import { LockService } from '@/common/locks/lock.service';

const fixture = () => {
  const commands: Command[] = [];
  const client = {
    status: 'wait',
    options: {
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    },
    on: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(async () => {
      client.status = 'ready';
    }),
    sendCommand: jest.fn((command: Command) => {
      commands.push(command);
      if (command.name === 'set') command.resolve('OK');
      else command.resolve(1);
      return command.promise;
    }),
  };
  const primary = { duplicate: jest.fn(() => client) } as unknown as Redis;
  return { client, primary, commands };
};

describe('API全局锁服务接入', () => {
  it('只创建一个专用连接，并保留普通Redis连接原配置', async () => {
    const { primary, client } = fixture();
    const service = new LockService({} as DataSource, primary);
    expect(client.connect).not.toHaveBeenCalled();
    expect(primary.duplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        lazyConnect: true,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
        maxRetriesPerRequest: 0,
        keyPrefix: 'kt:locks:',
      }),
    );
    await Promise.all([
      service.withRedis('one', {}, async () => 1),
      service.withRedis('two', {}, async () => 2),
    ]);
    expect(client.connect).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    await expect(service.withRedis('three', {}, jest.fn())).rejects.toThrow(
      '正在关闭',
    );
  });

  it('关闭时先通知在途操作并完成凭证释放，再关闭Redis连接', async () => {
    const { primary, client, commands } = fixture();
    const service = new LockService({} as DataSource, primary);
    let enter: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const operation = service
      .withRedis('active', {}, async (lease) => {
        enter();
        return new Promise<void>((_resolve, reject) =>
          lease.signal.addEventListener(
            'abort',
            () => reject(lease.signal.reason),
            { once: true },
          ),
        );
      })
      .catch((error: unknown) => error);
    await entered;
    await service.onModuleDestroy();
    expect(await operation).toBeInstanceOf(Error);
    expect(String(commands.at(-1)?.args[0])).toContain('DEL');
    expect(client.disconnect.mock.invocationCallOrder[0]).toBeGreaterThan(
      client.sendCommand.mock.invocationCallOrder.at(-1) ?? 0,
    );
  });

  it('独立功能模块可直接注入全局锁服务，编译模块不会提前建立Redis连接', async () => {
    const { primary, client } = fixture();
    const redisToken = getRedisConnectionToken();
    @Global()
    @Module({
      providers: [
        { provide: DataSource, useValue: {} },
        { provide: redisToken, useValue: primary },
      ],
      exports: [DataSource, redisToken],
    })
    class Connections {}
    @Injectable()
    class Consumer {
      constructor(readonly locks: LockService) {}
    }
    @Module({ providers: [Consumer] })
    class Feature {}
    const context = await Test.createTestingModule({
      imports: [Connections, LockModule, Feature],
    }).compile();
    expect(context.get(Consumer).locks).toBe(context.get(LockService));
    expect(client.connect).not.toHaveBeenCalled();
    await context.close();
  });
});
