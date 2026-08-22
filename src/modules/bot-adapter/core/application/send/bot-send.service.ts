import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { BotAdapterRegistry } from '@/modules/bot';
import { BotAccountService } from '../account/bot-account.service';
import { BOT_MQTT_TOPICS } from '../../contract/bot.constants';
import { BotBusService } from '../../infrastructure/integration/bus/bot-bus.service';
import { BotMessageService } from '../message/bot-message.service';
import type { BotMessageType } from '../../contract/bot.types';
import {
  BOT_DEFAULT_PAGE_NO,
  BOT_DEFAULT_PAGE_SIZE,
} from '../../contract/bot.constants';
import { BotRateLimitService } from './bot-rate-limit.service';
import { BotSendAttemptError } from './bot-send.error';
import { BotSendLog } from '../../infrastructure/persistence/send/bot-send-log.entity';
import type { BotAccount } from '../../infrastructure/persistence/account/bot-account.entity';
import type {
  BotSendGroupDto,
  BotSendLogQueryDto,
  BotSendPrivateDto,
} from '../../contract/send/bot-send.dto';
import type { StrictPlainTextSendInput } from '../../contract/send/bot-send.types';

type SendPipelineInput = {
  action: string;
  actionParams: Record<string, any>;
  audit?: { attemptNumber: number; deliveryId: string };
  channelId?: string;
  guildId?: string;
  message: string;
  adapterReplyContext?: unknown;
  replyMessageId?: string;
  strict: boolean;
  targetId: string;
  targetType: BotMessageType;
};

@Injectable()
export class BotSendService {
  constructor(
    @InjectRepository(BotSendLog)
    private readonly sendLogRepository: Repository<BotSendLog>,
    private readonly accountService: BotAccountService,
    private readonly adapterRegistry: BotAdapterRegistry,
    private readonly busService: BotBusService,
    private readonly messageService: BotMessageService,
    private readonly rateLimitService: BotRateLimitService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 根据`query`处理日志分页结果；把变更持久化到当前存储（`sendLogRepository.createQueryBuilder`）。
   * @param query - 限定日志分页结果筛选、排序与分页范围的查询条件，包含 `selfId`、`targetType`、`targetId`、`status` 字段。
   * @returns 包含 `list`、`pageNo`、`pageSize`、`total` 字段的日志分页。
   */
  async logPage(query: BotSendLogQueryDto) {
    const { pageNo, pageSize, skip } = this.toolsService.getPageParams(
      query,
      BOT_DEFAULT_PAGE_NO,
      BOT_DEFAULT_PAGE_SIZE,
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
  async sendPrivate(body: BotSendPrivateDto) {
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
  async sendGroup(body: BotSendGroupDto) {
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
    adapterReplyContext?: unknown;
    replyMessageId?: string;
    selfId?: string;
    targetId: string;
    targetType: BotMessageType;
  }) {
    const account = await this.accountService.getDefaultAccount(params.selfId);
    if (!account) {
      throwVbenError('没有可用 Bot 账号');
    }

    const { action, actionParams } = this.buildAction(params);
    return this.sendWithAccount(account, {
      action,
      actionParams,
      channelId: params.channelId,
      guildId: params.guildId,
      message: params.message,
      adapterReplyContext: params.adapterReplyContext,
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
   * @throws 当 `!account || account.isDeleted || !account.enabled` 成立时拒绝当前输入并抛出 `BotSendAttemptError`；
   *   当 `input.targetType !== 'group' && input.targetType !== 'private'` 成立时拒绝当前输入并抛出 `BotSendAttemptError`。
   */
  async sendStrictPlainText(input: StrictPlainTextSendInput) {
    const account = await this.accountService.findBySelfId(input.selfId);
    if (!account || account.isDeleted || !account.enabled) {
      throw new BotSendAttemptError({
        code: 'account_unavailable',
        message: 'Configured Bot account is unavailable',
        retryable: true,
        sendLogId: null,
      });
    }
    if (input.targetType !== 'group' && input.targetType !== 'private') {
      throw new BotSendAttemptError({
        code: 'invalid_target_type',
        message: 'Strict Bot delivery only supports group or private targets',
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
   * 按`account`、`input`投递携带账号；把变更持久化到当前存储（`sendLogRepository.save`）。
   * @param account - 用于携带账号的领域对象，包含 `selfId` 字段。
   * @param input - 用于携带账号的结构化输入，包含 `targetId`、`strict`、`message`、`actionParams` 字段。
   * @returns 包含 `logId` 字段的携带账号。
   * @throws 当 `input.strict` 成立时重新抛出该入口捕获且决定公开的原异常；当 `input.strict && err instanceof BotSendAttemptError` 成立时重新抛出该入口捕获且决定公开的原异常。
   */
  private async sendWithAccount(account: BotAccount, input: SendPipelineInput) {
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
    let log: BotSendLog;
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
        BOT_MQTT_TOPICS.commandSend(account.selfId),
        {
          action: transportAction,
          logId: log!.id,
          params: input.actionParams,
          selfId: account.selfId,
        },
      );
      const adapter = this.adapterRegistry.require(
        this.resolveAdapterKey(account.connectionMode),
      );
      const delivery = await adapter.deliver({
        adapterContext: {
          action: input.action,
          actionParams: input.actionParams,
          channelId: input.channelId,
          guildId: input.guildId,
          replyMessageId: input.replyMessageId,
        },
        connectionKey: account.selfId,
        conversationKey: `${input.targetType}:${input.targetId}`,
        intent: { content: input.message, kind: 'text' },
        replyContext: input.adapterReplyContext,
        scope: this.toBotScope(input.targetType),
        targetKey: input.targetId,
      });
      const response = {
        data: { message_id: delivery.deliveryKey },
        raw: delivery.raw,
        retcode: 0,
        status: 'ok',
      } as Record<string, any>;
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
          const error = new BotSendAttemptError({
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
      if (input.strict && err instanceof BotSendAttemptError) throw err;
      const message = this.toolsService.getErrorMessage(err, 'Bot send failed');
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
   * 按账号连接模式生成平台无关且可审计的适配器动作名。
   * @param account - 决定发送 transport 的 Bot 账号。
   * @param input - 当前目标类型和旧动作语义。
   * @returns 写入发送日志与事件总线的稳定动作名。
   */
  private transportAction(
    account: BotAccount,
    input: Pick<SendPipelineInput, 'action' | 'targetType'>,
  ) {
    return `${this.resolveAdapterKey(account.connectionMode)}_send_${input.targetType}`;
  }

  /**
   * 将持久化连接模式映射为无状态 BotAdapter 注册键。
   * @param connectionMode - 账号持久化连接模式。
   * @returns napcat 或 tencent 适配器键。
   */
  private resolveAdapterKey(connectionMode: BotAccount['connectionMode']) {
    if (connectionMode === 'reverse-ws') return 'napcat';
    return 'tencent';
  }

  /**
   * 将适配器核心目标类型映射为无状态 Bot 作用域。
   * @param targetType - 适配器核心目标类型。
   * @returns direct、group 或 channel 作用域。
   */
  private toBotScope(targetType: BotMessageType) {
    if (targetType === 'private') return 'direct' as const;
    if (targetType === 'group') return 'group' as const;
    return 'channel' as const;
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
      let retryable = true;
      if (err.code === 'onebot_rejected') {
        retryable = false;
      }
      return new BotSendAttemptError({
        code: err.code,
        message: err.message,
        retryable,
        sendLogId,
      });
    }
    if (this.isOfficialActionError(err)) {
      return new BotSendAttemptError({
        code: err.code,
        message: err.message,
        retryable: err.retryable,
        sendLogId,
      });
    }
    return new BotSendAttemptError({
      code: 'onebot_disconnected',
      message: 'Bot send failed',
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
    code: 'onebot_disconnected' | 'onebot_rejected' | 'onebot_timeout';
  } {
    if (!(err instanceof Error) || err.name !== 'BotReverseWsActionError') {
      return false;
    }
    const code = (err as Error & { code?: unknown }).code;
    return (
      code === 'onebot_disconnected' ||
      code === 'onebot_rejected' ||
      code === 'onebot_timeout'
    );
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
    if (!(err instanceof Error) || err.name !== 'TencentBotActionError') {
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
    const message = this.toolsService.getErrorMessage(err, 'Bot send failed');
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
    targetType: BotMessageType;
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
