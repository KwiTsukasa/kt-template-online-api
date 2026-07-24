import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QQBOT_MQTT_TOPICS } from '../../contract/qqbot.constants';
import { QqbotBusService } from '../../infrastructure/integration/bus/qqbot-bus.service';
import { QqbotMessageService } from '../message/qqbot-message.service';
import type {
  QqbotMessageType,
  QqbotReverseActionSender,
} from '../../contract/qqbot.types';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import { QqbotRateLimitService } from './qqbot-rate-limit.service';
import { QqbotSendAttemptError } from './qqbot-send.error';
import { QqbotSendLog } from '../../infrastructure/persistence/send/qqbot-send-log.entity';
import { QqbotReverseWsActionError } from '../../infrastructure/integration/connection/qqbot-reverse-ws.service';
import type { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import type {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from '../../contract/send/qqbot-send.dto';
import type { StrictPlainTextSendInput } from '../../contract/message-push/qqbot-message-push.types';

type SendPipelineInput = {
  action: string;
  actionParams: Record<string, any>;
  audit?: { attemptNumber: number; deliveryId: string };
  message: string;
  strict: boolean;
  targetId: string;
  targetType: QqbotMessageType;
};

@Injectable()
export class QqbotSendService {
  /**
   * 初始化 QqbotSendService 实例。
   * @param sendLogRepository - QQBot仓库依赖；影响 constructor 的返回值。
   * @param accountService - accountService 服务依赖；影响 constructor 的返回值。
   * @param busService - busService 服务依赖；影响 constructor 的返回值。
   * @param messageService - messageService 服务依赖；影响 constructor 的返回值。
   * @param moduleRef - moduleRef 输入；影响 constructor 的返回值。
   * @param rateLimitService - rateLimitService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotSendLog)
    private readonly sendLogRepository: Repository<QqbotSendLog>,
    private readonly accountService: QqbotAccountService,
    private readonly busService: QqbotBusService,
    private readonly messageService: QqbotMessageService,
    private readonly moduleRef: ModuleRef,
    private readonly rateLimitService: QqbotRateLimitService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 执行 QQBot 核心流程。
   * @param query - 查询参数 DTO；限定 QQBot分页、搜索或详情查询条件。
   */
  async logPage(query: QqbotSendLogQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      QQBOT_DEFAULT_PAGE_NO,
      QQBOT_DEFAULT_PAGE_SIZE,
    );
    const builder = this.sendLogRepository.createQueryBuilder('log');

    if (query.selfId) {
      builder.andWhere('log.selfId = :selfId', { selfId: query.selfId });
    }
    if (query.targetType) {
      builder.andWhere('log.targetType = :targetType', {
        targetType: query.targetType,
      });
    }
    if (query.targetId) {
      builder.andWhere('log.targetId LIKE :targetId', {
        targetId: `%${query.targetId}%`,
      });
    }
    if (query.status) {
      builder.andWhere('log.status = :status', { status: query.status });
    }

    const [list, total] = await builder
      .orderBy('log.createTime', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();
    return { list, pageNo, pageSize, total };
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async sendPrivate(body: QqbotSendPrivateDto) {
    return this.sendText({
      message: body.message,
      selfId: body.selfId,
      targetId: body.userId,
      targetType: 'private',
    });
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async sendGroup(body: QqbotSendGroupDto) {
    return this.sendText({
      message: body.message,
      selfId: body.selfId,
      targetId: body.groupId,
      targetType: 'group',
    });
  }

  /**
   * 投递 QQBot 核心消息或任务。
   * @param params - QQBot列表；使用 `selfId`、`targetId`、`message`、`targetType` 字段生成结果。
   */
  async sendText(params: {
    channelId?: string;
    guildId?: string;
    message: string;
    selfId?: string;
    targetId: string;
    targetType: QqbotMessageType;
  }) {
    const account = await this.accountService.getDefaultAccount(params.selfId);
    if (!account) {
      throwVbenError('没有可用 QQBot 账号');
    }

    const { action, actionParams } = this.buildAction(params);
    return this.sendWithAccount(account, {
      action,
      actionParams,
      message: params.message,
      strict: false,
      targetId: params.targetId,
      targetType: params.targetType,
    });
  }

  /**
   * Sends a single text segment through exactly the configured enabled QQBot account.
   * @param input - A durable delivery attempt whose account and target must not fall back.
   * @returns The OneBot response together with the created send-log ID.
   */
  async sendStrictPlainText(input: StrictPlainTextSendInput) {
    const account = await this.accountService.findBySelfId(input.selfId);
    if (!account || account.isDeleted || !account.enabled) {
      throw new QqbotSendAttemptError({
        code: 'account_unavailable',
        message: 'Configured QQBot account is unavailable',
        retryable: true,
        sendLogId: null,
      });
    }
    if (input.targetType !== 'group' && input.targetType !== 'private') {
      throw new QqbotSendAttemptError({
        code: 'invalid_target_type',
        message: 'Strict QQBot delivery only supports group or private targets',
        retryable: false,
        sendLogId: null,
      });
    }

    const action =
      input.targetType === 'group' ? 'send_group_msg' : 'send_private_msg';
    const actionParams =
      input.targetType === 'group'
        ? {
            group_id: input.targetId,
            message: this.toTextSegment(input.message),
          }
        : {
            message: this.toTextSegment(input.message),
            user_id: input.targetId,
          };
    return this.sendWithAccount(account, {
      action,
      actionParams,
      audit: {
        attemptNumber: input.attemptNumber,
        deliveryId: input.deliveryId,
      },
      message: input.message,
      strict: true,
      targetId: input.targetId,
      targetType: input.targetType,
    });
  }

  /**
   * 查询 QQBot 核心数据。
   * @returns QQBot 核心查询结果。
   */
  private async getReverseWsService(): Promise<QqbotReverseActionSender> {
    const { QqbotReverseWsService } =
      await import('../../infrastructure/integration/connection/qqbot-reverse-ws.service');
    return this.moduleRef.get<QqbotReverseActionSender>(QqbotReverseWsService, {
      strict: false,
    });
  }

  /**
   * Runs the common QQBot send lifecycle for legacy and strict callers.
   * @param account - The already selected QQBot account.
   * @param input - The wire action and storage-safe delivery metadata.
   * @returns The OneBot response together with the created send-log ID.
   */
  private async sendWithAccount(
    account: QqbotAccount,
    input: SendPipelineInput,
  ) {
    try {
      await this.rateLimitService.waitForSendSlot(
        account.selfId,
        input.targetId,
      );
    } catch (err) {
      this.throwSendFailure(input.strict, err, null);
    }

    const storedMessageText = this.toolsService.toStoredMessageText(
      input.message,
    );
    const storedActionParams = {
      ...this.toStoredActionParams(input.actionParams, storedMessageText),
      ...(input.audit ? { messagePush: input.audit } : {}),
    };
    let log: QqbotSendLog;
    try {
      log = await this.sendLogRepository.save(
        this.sendLogRepository.create({
          action: input.action,
          messageText: storedMessageText,
          params: storedActionParams,
          selfId: account.selfId,
          status: 'pending',
          targetId: input.targetId,
          targetType: input.targetType,
        }),
      );
    } catch (err) {
      this.throwSendFailure(input.strict, err, null);
    }

    try {
      await this.busService.publish(
        QQBOT_MQTT_TOPICS.commandSend(account.selfId),
        {
          action: input.action,
          logId: log!.id,
          params: input.actionParams,
          selfId: account.selfId,
        },
      );
      const reverseWsService = await this.getReverseWsService();
      const response = await reverseWsService.sendAction(
        account.selfId,
        input.action,
        input.actionParams,
      );
      const success = input.strict
        ? response.status === 'ok' && response.retcode === 0
        : response.status === 'ok' || response.retcode === 0;
      const messageId = response.data?.message_id
        ? `${response.data.message_id}`
        : null;
      if (!success) {
        const message = response.message || 'OneBot rejected the send action';
        if (input.strict) {
          const error = new QqbotSendAttemptError({
            code: 'onebot_rejected',
            message,
            retryable: false,
            sendLogId: log!.id,
          });
          await this.markFailedLog(log!.id, error.message);
          throw error;
        }
        await this.sendLogRepository.update(
          { id: log!.id },
          {
            echo: response.echo || null,
            errorMessage: message,
            messageId,
            response: response as any,
            status: 'failed',
          },
        );
        throwVbenError(message);
      }

      await this.sendLogRepository.update(
        { id: log!.id },
        {
          echo: response.echo || null,
          errorMessage: null,
          messageId,
          response: response as any,
          status: 'success',
        },
      );
      await this.messageService.saveOutgoing({
        messageId,
        messageText: storedMessageText,
        messageType: input.targetType,
        selfId: account.selfId,
        targetId: input.targetId,
        userId:
          input.targetType === 'private' ? input.targetId : account.selfId,
      });
      return { ...response, logId: log!.id };
    } catch (err) {
      if (input.strict && err instanceof QqbotSendAttemptError) throw err;
      const message = this.toolsService.getErrorMessage(
        err,
        'OneBot send failed',
      );
      if (input.strict) {
        const error = this.toStrictSendError(err, log!.id);
        await this.markFailedLog(log!.id, error.message);
        throw error;
      }
      await this.sendLogRepository.update(
        { id: log!.id },
        { errorMessage: message, status: 'failed' },
      );
      throwVbenError(message);
    }
  }

  /**
   * Converts an arbitrary string into the sole strict OneBot text segment.
   * @param message - The literal text that must not be interpreted as CQ code.
   * @returns A single OneBot text segment.
   */
  private toTextSegment(message: string) {
    return [{ data: { text: message }, type: 'text' }];
  }

  /**
   * Marks a pending strict send log as failed without masking the original failure.
   * @param logId - The pending send-log ID.
   * @param message - A non-sensitive failure summary.
   */
  private async markFailedLog(logId: string, message: string) {
    try {
      await this.sendLogRepository.update(
        { id: logId },
        { errorMessage: message, status: 'failed' },
      );
    } catch {
      // The typed delivery failure is more important than a secondary log-update failure.
    }
  }

  /**
   * Converts strict transport and infrastructure failures to stable delivery classifications.
   * @param err - The original failure.
   * @param sendLogId - The pending log ID, if creation succeeded.
   * @returns A stable strict delivery error.
   */
  private toStrictSendError(err: unknown, sendLogId: null | string) {
    if (err instanceof QqbotReverseWsActionError) {
      return new QqbotSendAttemptError({
        code: err.code,
        message: err.message,
        retryable: true,
        sendLogId,
      });
    }
    return new QqbotSendAttemptError({
      code: 'onebot_disconnected',
      message: 'OneBot send failed',
      retryable: true,
      sendLogId,
    });
  }

  /**
   * Throws either the strict typed error or the legacy Vben-compatible error.
   * @param strict - Whether the caller requires stable delivery retry metadata.
   * @param err - The original failure.
   * @param sendLogId - The pending log ID, if creation succeeded.
   */
  private throwSendFailure(
    strict: boolean,
    err: unknown,
    sendLogId: null | string,
  ): never {
    if (strict) throw this.toStrictSendError(err, sendLogId);
    const message = this.toolsService.getErrorMessage(
      err,
      'OneBot send failed',
    );
    throwVbenError(message);
    throw new Error(message);
  }

  /**
   * 创建 QQBot 核心对象或配置。
   * @param params - QQBot列表；使用 `targetType`、`targetId`、`message`、`channelId` 字段生成结果。
   */
  private buildAction(params: {
    channelId?: string;
    guildId?: string;
    message: string;
    targetId: string;
    targetType: QqbotMessageType;
  }) {
    if (params.targetType === 'group') {
      return {
        action: 'send_group_msg',
        actionParams: { group_id: params.targetId, message: params.message },
      };
    }
    if (params.targetType === 'channel') {
      const actionParams: Record<string, any> = {
        channel_id: params.channelId || params.targetId,
        message: params.message,
      };
      if (params.guildId) actionParams.guild_id = params.guildId;
      return {
        action: 'send_guild_channel_msg',
        actionParams,
      };
    }
    return {
      action: 'send_private_msg',
      actionParams: { message: params.message, user_id: params.targetId },
    };
  }

  /**
   * 执行 QQBot 核心流程。
   * @param actionParams - QQBot列表；使用 `message` 字段生成结果。
   * @param storedMessageText - storedMessageText 输入；影响 toStoredActionParams 的返回值。
   */
  private toStoredActionParams(
    actionParams: Record<string, any>,
    storedMessageText: string,
  ) {
    const message = actionParams.message;
    return {
      ...actionParams,
      ...(message === undefined
        ? {}
        : {
            message: Array.isArray(message)
              ? this.toTextSegment(storedMessageText)
              : storedMessageText,
          }),
    };
  }
}
