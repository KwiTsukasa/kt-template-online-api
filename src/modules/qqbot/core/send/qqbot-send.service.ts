import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, ToolsService } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import { QQBOT_MQTT_TOPICS } from '../contract/qqbot.constants';
import { QqbotBusService } from '../mqtt/qqbot-bus.service';
import { QqbotMessageService } from '../message/qqbot-message.service';
import type {
  QqbotMessageType,
  QqbotReverseActionSender,
} from '../contract/qqbot.types';
import {
  QQBOT_DEFAULT_PAGE_NO,
  QQBOT_DEFAULT_PAGE_SIZE,
} from '../contract/qqbot.constants';
import { QqbotRateLimitService } from './qqbot-rate-limit.service';
import { QqbotSendLog } from './qqbot-send-log.entity';
import type {
  QqbotSendGroupDto,
  QqbotSendLogQueryDto,
  QqbotSendPrivateDto,
} from './qqbot-send.dto';

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

  async sendPrivate(body: QqbotSendPrivateDto) {
    return this.sendText({
      message: body.message,
      selfId: body.selfId,
      targetId: body.userId,
      targetType: 'private',
    });
  }

  async sendGroup(body: QqbotSendGroupDto) {
    return this.sendText({
      message: body.message,
      selfId: body.selfId,
      targetId: body.groupId,
      targetType: 'group',
    });
  }

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

  private async getReverseWsService(): Promise<QqbotReverseActionSender> {
    const { QqbotReverseWsService } =
      await import('../connection/qqbot-reverse-ws.service');
    return this.moduleRef.get<QqbotReverseActionSender>(QqbotReverseWsService, {
      strict: false,
    });
  }

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
