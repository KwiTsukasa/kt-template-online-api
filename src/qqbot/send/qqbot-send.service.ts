import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { QqbotAccountService } from '../account/qqbot-account.service';
import type { QqbotReverseWsService } from '../connection/qqbot-reverse-ws.service';
import { QQBOT_MQTT_TOPICS } from '../qqbot.constants';
import { QqbotBusService } from '../mqtt/qqbot-bus.service';
import { QqbotMessageService } from '../message/qqbot-message.service';
import type { QqbotMessageType } from '../qqbot.types';
import { getPageParams } from '../qqbot.utils';
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
  ) {}

  async logPage(query: QqbotSendLogQueryDto) {
    const { pageNo, pageSize, skip } = getPageParams(query);
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
    message: string;
    selfId?: string;
    targetId: string;
    targetType: QqbotMessageType;
  }) {
    const account = await this.accountService.getDefaultAccount(params.selfId);
    if (!account) {
      throwVbenError('没有可用 QQBot 账号');
    }

    this.rateLimitService.assertCanSend(account.selfId, params.targetId);

    const action =
      params.targetType === 'group' ? 'send_group_msg' : 'send_private_msg';
    const actionParams =
      params.targetType === 'group'
        ? { group_id: params.targetId, message: params.message }
        : { message: params.message, user_id: params.targetId };

    const log = await this.sendLogRepository.save(
      this.sendLogRepository.create({
        action,
        messageText: params.message,
        params: actionParams,
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
          messageText: params.message,
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
      const message = err instanceof Error ? err.message : 'OneBot 发送失败';
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

  private async getReverseWsService() {
    const { QqbotReverseWsService } = await import(
      '../connection/qqbot-reverse-ws.service'
    );
    return this.moduleRef.get<QqbotReverseWsService>(QqbotReverseWsService, {
      strict: false,
    });
  }
}
