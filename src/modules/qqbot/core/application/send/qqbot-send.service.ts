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
import { QqbotSendLog } from '../../infrastructure/persistence/send/qqbot-send-log.entity';
import type {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from '../../contract/send/qqbot-send.dto';

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

    await this.rateLimitService.waitForSendSlot(
      account.selfId,
      params.targetId,
    );

    const { action, actionParams } = this.buildAction(params);
    const storedMessageText = this.toolsService.toStoredMessageText(
      params.message,
    );
    const storedActionParams = this.toStoredActionParams(
      actionParams,
      storedMessageText,
    );

    const log = await this.sendLogRepository.save(
      this.sendLogRepository.create({
        action,
        messageText: storedMessageText,
        params: storedActionParams,
        selfId: account.selfId,
        status: 'pending',
        targetId: params.targetId,
        targetType: params.targetType,
      }),
    );

    await this.busService.publish(
      QQBOT_MQTT_TOPICS.commandSend(account.selfId),
      {
        action,
        logId: log.id,
        params: actionParams,
        selfId: account.selfId,
      },
    );

    try {
      const reverseWsService = await this.getReverseWsService();
      const response = await reverseWsService.sendAction(
        account.selfId,
        action,
        actionParams,
      );
      const success = response.status === 'ok' || response.retcode === 0;
      const messageId = response.data?.message_id
        ? `${response.data.message_id}`
        : null;
      await this.sendLogRepository.update(
        { id: log.id },
        {
          echo: response.echo || null,
          errorMessage: success ? null : response.message || 'OneBot 发送失败',
          messageId,
          response: response as any,
          status: success ? 'success' : 'failed',
        },
      );

      if (success) {
        await this.messageService.saveOutgoing({
          messageId,
          messageText: storedMessageText,
          messageType: params.targetType,
          selfId: account.selfId,
          targetId: params.targetId,
          userId:
            params.targetType === 'private' ? params.targetId : account.selfId,
        });
      }
      if (!success) throwVbenError(response.message || 'OneBot 发送失败');
      return { ...response, logId: log.id };
    } catch (err) {
      const message = this.toolsService.getErrorMessage(err, 'OneBot 发送失败');
      await this.sendLogRepository.update(
        { id: log.id },
        {
          errorMessage: message,
          status: 'failed',
        },
      );
      throwVbenError(message);
    }
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
    return {
      ...actionParams,
      ...(actionParams.message === undefined
        ? {}
        : { message: storedMessageText }),
    };
  }
}
