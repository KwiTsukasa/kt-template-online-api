jest.mock('@/modules/admin/identity/auth/jwt-auth.guard', () => ({
  JwtAuthGuard: class {
    /**
     * 判断 QQBot 核心条件。
     */
    canActivate() {
      return true;
    }
  },
}));

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DictService } from '../../../../src/modules/admin/platform-config/dict/dict.service';
import { ToolsService } from '../../../../src/common';
import { QqbotAccountService } from '../../../../src/modules/qqbot/core/application/account/qqbot-account.service';
import { QqbotCommandController } from '../../../../src/modules/qqbot/core/contract/command/qqbot-command.controller';
import { QqbotCommand } from '../../../../src/modules/qqbot/core/infrastructure/persistence/command/qqbot-command.entity';
import { QqbotCommandEngineService } from '../../../../src/modules/qqbot/core/application/command/qqbot-command-engine.service';
import { QqbotCommandLog } from '../../../../src/modules/qqbot/core/infrastructure/persistence/command/qqbot-command-log.entity';
import { QqbotCommandParserService } from '../../../../src/modules/qqbot/core/application/command/qqbot-command-parser.service';
import { QqbotCommandService } from '../../../../src/modules/qqbot/core/application/command/qqbot-command.service';
import { QqbotReplyTemplateService } from '../../../../src/modules/qqbot/core/application/command/qqbot-reply-template.service';
import { QQBOT_PLUGIN_EXECUTION_PORT } from '../../../../src/modules/qqbot/core/domain/plugin-execution.port';
import { QqbotSendService } from '../../../../src/modules/qqbot/core/application/send/qqbot-send.service';

describe('QQBot core command local smoke', () => {
  let app: INestApplication;

  const command = {
    aliases: '[]',
    code: 'bd',
    cooldownMs: 5000,
    defaultParams: null,
    enabled: true,
    errorTemplate: null,
    id: 'cmd-bangdream-song-search',
    isDeleted: false,
    lastHitAt: null,
    name: '',
    operationKey: 'bangdream.song.search',
    parserKey: 'plain',
    pluginKey: 'bangdream',
    prefixes: '["/"]',
    priority: 100,
    replyTemplate: '找到歌曲：{{output.title}}',
    targetType: 'all',
  } as QqbotCommand;

  const queryBuilder = {
    addOrderBy: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[command], 1]),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  const commandRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    findOne: jest.fn().mockResolvedValue(command),
  };

  const commandLogRepository = {
    create: jest.fn((payload) => payload),
    save: jest.fn(),
  };

  const pluginExecution = {
    executeOperation: jest.fn().mockResolvedValue({
      title: 'FIRE BIRD',
      type: 'text',
    }),
    getOperationByCommand: jest.fn().mockResolvedValue({
      aliases: ['查歌', 'bd', 'bangdream', 'bandori', '邦邦', '邦邦查歌'],
      key: command.operationKey,
      name: '查曲',
      pluginKey: command.pluginKey,
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QqbotCommandController],
      providers: [
        ToolsService,
        QqbotCommandEngineService,
        QqbotCommandParserService,
        QqbotCommandService,
        QqbotReplyTemplateService,
        {
          provide: getRepositoryToken(QqbotCommand),
          useValue: commandRepository,
        },
        {
          provide: getRepositoryToken(QqbotCommandLog),
          useValue: commandLogRepository,
        },
        {
          provide: QqbotAccountService,
          useValue: {
            getBoundCommandIds: jest.fn().mockResolvedValue([command.id]),
          },
        },
        {
          provide: QQBOT_PLUGIN_EXECUTION_PORT,
          useValue: pluginExecution,
        },
        {
          provide: QqbotSendService,
          useValue: {
            sendText: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('5000'),
          },
        },
        {
          provide: DictService,
          useValue: {
            getDictItemsByKey: jest.fn().mockResolvedValue([]),
            relationTree: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries enabled command by operationKey before previewing a full command text with commandId', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/qqbot/command/list')
      .query({
        enabled: true,
        operationKey: command.operationKey,
        pageNo: 1,
        pageSize: 10,
      })
      .expect(200);

    const commandId = listResponse.body.data.list[0].id;

    const previewResponse = await request(app.getHttpServer())
      .post('/qqbot/command/test')
      .send({
        commandId,
        selfId: 'preview',
        targetId: '10000',
        targetType: 'group',
        text: '/查歌 FIRE BIRD',
        userId: '10000',
      })
      .expect(200);

    const sanitizedPreview = { ...previewResponse.body.data };
    delete sanitizedPreview.replyText;

    expect(sanitizedPreview).toMatchObject({
      command: {
        id: command.id,
        operationKey: command.operationKey,
      },
      input: {
        text: 'FIRE BIRD',
      },
      matched: true,
      status: 'success',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'command.operationKey = :operationKey',
      { operationKey: command.operationKey },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'command.enabled = :enabled',
      { enabled: true },
    );
    expect(commandRepository.findOne).toHaveBeenCalledWith({
      where: { id: command.id, isDeleted: false },
    });
    expect(pluginExecution.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          command,
        }),
        input: expect.objectContaining({
          text: 'FIRE BIRD',
        }),
        operationKey: command.operationKey,
        pluginKey: command.pluginKey,
      }),
    );
  });
});
