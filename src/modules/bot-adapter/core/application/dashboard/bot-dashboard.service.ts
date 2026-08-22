import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotBusService } from '../../infrastructure/integration/bus/bot-bus.service';
import { BotReverseWsService } from '../../infrastructure/integration/connection/bot-reverse-ws.service';
import { BotAccount } from '../../infrastructure/persistence/account/bot-account.entity';
import { BotConversation } from '../../infrastructure/persistence/message/bot-conversation.entity';
import { BotMessage } from '../../infrastructure/persistence/message/bot-message.entity';
import { BotRule } from '../../infrastructure/persistence/rule/bot-rule.entity';
import { BotSendLog } from '../../infrastructure/persistence/send/bot-send-log.entity';

@Injectable()
export class BotDashboardService {
  constructor(
    @InjectRepository(BotAccount)
    private readonly accountRepository: Repository<BotAccount>,
    @InjectRepository(BotConversation)
    private readonly conversationRepository: Repository<BotConversation>,
    @InjectRepository(BotMessage)
    private readonly messageRepository: Repository<BotMessage>,
    @InjectRepository(BotRule)
    private readonly ruleRepository: Repository<BotRule>,
    @InjectRepository(BotSendLog)
    private readonly sendLogRepository: Repository<BotSendLog>,
    private readonly busService: BotBusService,
    private readonly reverseWsService: BotReverseWsService,
  ) {}

  /**
   * 通过 `accountRepository.count` 统计匹配记录。
   * @returns 包含 `accountTotal`、`bus`、`conversationTotal`、`enabledRuleTotal`、`messageTotal` 字段的摘要。
   */
  async summary() {
    const [
      accountTotal,
      onlineTotal,
      enabledRuleTotal,
      conversationTotal,
      messageTotal,
      sendSuccessTotal,
      sendFailedTotal,
    ] = await Promise.all([
      this.accountRepository.count({ where: { isDeleted: false } }),
      this.accountRepository.count({
        where: { connectStatus: 'online', isDeleted: false },
      }),
      this.ruleRepository.count({
        where: { enabled: true, isDeleted: false },
      }),
      this.conversationRepository.count({ where: { isDeleted: false } }),
      this.messageRepository.count(),
      this.sendLogRepository.count({ where: { status: 'success' } }),
      this.sendLogRepository.count({ where: { status: 'failed' } }),
    ]);

    return {
      accountTotal,
      bus: this.busService.getStatus(),
      conversationTotal,
      enabledRuleTotal,
      messageTotal,
      onlineTotal,
      napcatRuntime: this.reverseWsService.getRuntimeStatus(),
      sendFailedTotal,
      sendSuccessTotal,
    };
  }
}
