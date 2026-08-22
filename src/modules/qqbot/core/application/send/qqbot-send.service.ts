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
  QqbotOneBotActionResponse,
  QqbotReverseActionSender,
} from '../../contract/qqbot.types';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../../contract/qqbot.constants';
import { QqbotRateLimitService } from './qqbot-rate-limit.service';
import { QqbotSendAttemptError } from './qqbot-send.error';
import { QqbotSendLog } from '../../infrastructure/persistence/send/qqbot-send-log.entity';
import type { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import type {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from '../../contract/send/qqbot-send.dto';
import type { StrictPlainTextSendInput } from '../../contract/send/qqbot-send.types';

type SendPipelineInput = {
  action: string;
  actionParams: Record<string, any>;
  audit?: { attemptNumber: number; deliveryId: string };
  channelId?: string;
  guildId?: string;
  message: string;
  replyMessageId?: string;
  strict: boolean;
  targetId: string;
  targetType: QqbotMessageType;
};

@Injectable()
export class QqbotSendService {
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
   * 根据`query`处理日志分页结果；把变更持久化到当前存储（`sendLogRepository.createQueryBuilder`）。
   * @param query - 限定日志分页结果筛选、排序与分页范围的查询条件，包含 `selfId`、`targetType`、`targetId`、`status` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的日志分页。
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
   * 将私聊请求投影为文本发送参数，并以用户号作为私聊目标。
   * @param body - 用于私聊消息的结构化输入，包含 `message`、`selfId`、`userId` 字段。
   * @returns 私聊消息。
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
   * 将群聊请求投影为文本发送参数，并以群号作为群聊目标。
   * @param body - 用于Group的结构化输入，包含 `message`、`selfId`、`groupId` 字段。
   * @returns 以群号为目标完成文本投递后得到的发送结果。
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
   * 按`params`投递文本；从 `accountService.getDefaultAccount` 读取文本。
   * @param params - 用于文本的领域对象，包含 `selfId`、`message`、`targetId`、`targetType` 字段。
   * @returns 文本。
   */
  async sendText(params: {
    channelId?: string;
    guildId?: string;
    message: string;
    replyMessageId?: string;
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
      channelId: params.channelId,
      guildId: params.guildId,
      message: params.message,
      replyMessageId: params.replyMessageId,
      strict: false,
      targetId: params.targetId,
      targetType: params.targetType,
    });
  }

  /**
   * 按`input`投递严格的纯文本；从 `accountService.findBySelfId` 读取严格的纯文本。
   * @param input - 用于严格的纯文本的结构化输入，包含 `selfId`、`targetType`、`targetId`、`message` 字段。
   * @returns 严格的纯文本。
   * @throws 当 `!account || account.isDeleted || !account.enabled` 成立时拒绝当前输入并抛出 `QqbotSendAttemptError`；
   *   当 `input.targetType !== 'group' && input.targetType !== 'private'` 成立时拒绝当前输入并抛出 `QqbotSendAttemptError`。
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

    const action = (() => {
      if (input.targetType === 'group') {
        return 'send_group_msg';
      }
      return 'send_private_msg';
    })();
    const actionParams = (() => {
      if (input.targetType === 'group') {
        return {
          group_id: input.targetId,
          message: this.toTextSegment(input.message),
        };
      }
      return {
        message: this.toTextSegment(input.message),
        user_id: input.targetId,
      };
    })();
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
   * 按当前运行态读取ReverseWs服务；从 `moduleRef.get` 读取ReverseWs服务。
   * @returns ReverseWs服务。
   */
  private async getReverseWsService(): Promise<QqbotReverseActionSender> {
    const { QqbotReverseWsService } =
      await import('../../infrastructure/integration/connection/qqbot-reverse-ws.service');
    return this.moduleRef.get<QqbotReverseActionSender>(QqbotReverseWsService, {
      strict: false,
    });
  }

  /**
   * 从 Nest 运行时读取 QQ 官方双 transport 服务，避免发送应用层静态依赖 ESM SDK。
   * @returns 当前应用唯一的 QQ 官方服务实例。
   */
  private async getOfficialService() {
    const { QqbotOfficialService } =
      await import('../../infrastructure/integration/connection/qqbot-official.service');
    return this.moduleRef.get(QqbotOfficialService, { strict: false });
  }

  /**
   * 按`account`、`input`投递携带账号；把变更持久化到当前存储（`sendLogRepository.save`）。
   * @param account - 用于携带账号的领域对象，包含 `selfId` 字段。
   * @param input - 用于携带账号的结构化输入，包含 `targetId`、`strict`、`message`、`actionParams` 字段。
   * @returns 包含 `logId` 字段的携带账号。
   * @throws 当 `input.strict` 成立时重新抛出该入口捕获且决定公开的原异常；当 `input.strict && err instanceof QqbotSendAttemptError` 成立时重新抛出该入口捕获且决定公开的原异常。
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
      ...(() => {
        if (input.audit) {
          return { messagePush: input.audit };
        }
        return {};
      })(),
    };
    const transportAction = this.transportAction(account, input);
    let log: QqbotSendLog;
    try {
      log = await this.sendLogRepository.save(
        this.sendLogRepository.create({
          action: transportAction,
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
          action: transportAction,
          logId: log!.id,
          params: input.actionParams,
          selfId: account.selfId,
        },
      );
      let response: QqbotOneBotActionResponse & Record<string, any>;
      if (!this.isOfficialConnectionMode(account.connectionMode)) {
        const reverseWsService = await this.getReverseWsService();
        response = await reverseWsService.sendAction(
          account.selfId,
          input.action,
          input.actionParams,
        );
      } else {
        const officialService = await this.getOfficialService();
        const officialResponse = await officialService.sendText({
          channelId: input.channelId,
          guildId: input.guildId,
          message: input.message,
          replyMessageId: input.replyMessageId,
          selfId: account.selfId,
          targetId: input.targetId,
          targetType: input.targetType,
        });
        response = {
          data: { message_id: officialResponse.id },
          official: {
            extInfo: officialResponse.ext_info || null,
            timestamp: officialResponse.timestamp,
          },
          retcode: 0,
          status: 'ok',
        };
      }
      const success = (() => {
        if (input.strict) {
          return response.status === 'ok' && response.retcode === 0;
        }
        return response.status === 'ok' || response.retcode === 0;
      })();
      const messageId = (() => {
        if (response.data?.message_id) {
          return `${response.data.message_id}`;
        }
        return null;
      })();
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
        userId: (() => {
          if (input.targetType === 'private') {
            return input.targetId;
          }
          return account.selfId;
        })(),
      });
      return { ...response, logId: log!.id };
    } catch (err) {
      if (input.strict && err instanceof QqbotSendAttemptError) throw err;
      const message = this.toolsService.getErrorMessage(
        err,
        'QQBot send failed',
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
   * 按账号接入方式生成可审计发送动作；OneBot 保留原 action，官方模式使用稳定语义名。
   * @param account - 决定发送 transport 的 QQBot 账号。
   * @param input - 当前目标类型和 OneBot 兼容 action。
   * @returns 写入发送日志与事件总线的稳定动作名。
   */
  private transportAction(
    account: QqbotAccount,
    input: Pick<SendPipelineInput, 'action' | 'targetType'>,
  ) {
    if (!this.isOfficialConnectionMode(account.connectionMode)) {
      return input.action;
    }
    return `official_send_${input.targetType}`;
  }

  /**
   * 判断账号是否显式选择 QQ 官方 WebSocket 或 Webhook；缺失和未知旧值保持 OneBot 路由。
   * @param connectionMode - 账号持久化的接入方式。
   * @returns 两种官方 transport 之一时返回 true。
   */
  private isOfficialConnectionMode(
    connectionMode: QqbotAccount['connectionMode'],
  ) {
    return (
      connectionMode === 'official-websocket' ||
      connectionMode === 'official-webhook'
    );
  }

  /**
   * 将输入收敛并投影为文本分段。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 按输入顺序得到的文本分段列表；没有匹配项时为空数组。
   */
  private toTextSegment(message: string) {
    return [{ data: { text: message }, type: 'text' }];
  }

  /**
   * 根据`logId`、`message`处理标记失败日志；把变更持久化到当前存储（`sendLogRepository.update`）。
   * @param logId - 用于精确定位日志的标识。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
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
   * 将输入收敛并投影为严格的发送错误。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @param sendLogId - 用于精确定位日志的标识。
   * @returns 完成初始化并携带当前边界配置的严格的发送错误。
   */
  private toStrictSendError(err: unknown, sendLogId: null | string) {
    if (this.isReverseWsActionError(err)) {
      return new QqbotSendAttemptError({
        code: err.code,
        message: err.message,
        retryable: true,
        sendLogId,
      });
    }
    if (this.isOfficialActionError(err)) {
      return new QqbotSendAttemptError({
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        sendLogId,
      });
    }
    return new QqbotSendAttemptError({
      code: 'onebot_disconnected',
      message: 'QQBot send failed',
      retryable: true,
      sendLogId,
    });
  }

  /**
   * 判断异常是否来自 OneBot 反向 WebSocket 动作，避免静态加载运行时服务形成循环依赖。
   * @param err - 待识别的异常。
   * @returns 是否为受支持的反向 WebSocket 动作异常。
   */
  private isReverseWsActionError(err: unknown): err is Error & {
    code: 'onebot_disconnected' | 'onebot_timeout';
  } {
    if (!(err instanceof Error) || err.name !== 'QqbotReverseWsActionError') {
      return false;
    }
    const code = (err as Error & { code?: unknown }).code;
    return code === 'onebot_disconnected' || code === 'onebot_timeout';
  }

  /**
   * 判断异常是否由 QQ 官方发送服务产生，并读取其稳定代码与重试语义。
   * @param err - 待识别的未知异常。
   * @returns 是否为 QQ 官方结构化发送异常。
   */
  private isOfficialActionError(err: unknown): err is Error & {
    code: 'official_disconnected' | 'official_rejected' | 'official_timeout';
    retryable: boolean;
  } {
    if (!(err instanceof Error) || err.name !== 'QqbotOfficialActionError') {
      return false;
    }
    const value = err as Error & {
      code?: unknown;
      retryable?: unknown;
    };
    return (
      [
        'official_disconnected',
        'official_rejected',
        'official_timeout',
      ].includes(`${value.code || ''}`) && typeof value.retryable === 'boolean'
    );
  }

  /**
   * 以统一异常拒绝发送失败。
   * @param strict - 决定是否启用“strict”分支的布尔选项。
   * @param err - 待转换为稳定业务错误或日志文本的未知异常。
   * @param sendLogId - 用于精确定位日志的标识。
   * @throws 严格发送模式下抛出结构化发送异常；非严格模式把未知错误消息映射为普通业务错误。
   */
  private throwSendFailure(
    strict: boolean,
    err: unknown,
    sendLogId: null | string,
  ): never {
    if (strict) throw this.toStrictSendError(err, sendLogId);
    const message = this.toolsService.getErrorMessage(err, 'QQBot send failed');
    throwVbenError(message);
    throw new Error(message);
  }

  /**
   * 根据`params`构造包含 `action`、`actionParams` 字段的结果；当 `params.targetType === 'group'` 成立时返回 `{ action: 'send_group_msg', actionParams: {…`。
   * @param params - 用于包含 `action`、`actionParams` 字段的结果的领域对象，包含 `targetType`、`targetId`、`message`、`channelId` 字段。
   * @returns 包含 `action`、`actionParams` 字段的包含 `action`、`actionParams` 字段的。
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
   * 将`actionParams`、`storedMessageText`转换为持久化网关动作参数。
   * @param actionParams - 用于持久化网关动作参数的领域对象，包含 `message` 字段。
   * @param storedMessageText - 决定持久化网关动作参数内容、边界或目标的 `storedMessageText` 值。
   * @returns 持久化网关动作参数；没有可用结果或提前结束时为 `undefined`。
   */
  private toStoredActionParams(
    actionParams: Record<string, any>,
    storedMessageText: string,
  ) {
    const message = actionParams.message;
    return {
      ...actionParams,
      ...(() => {
        if (message === undefined) {
          return {};
        }
        return {
          message: (() => {
            if (Array.isArray(message)) {
              return this.toTextSegment(storedMessageText);
            }
            return storedMessageText;
          })(),
        };
      })(),
    };
  }
}
