import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotBusService } from '../../infrastructure/integration/bus/qqbot-bus.service';
import { QqbotReverseWsService } from '../../infrastructure/integration/connection/qqbot-reverse-ws.service';
import { QqbotAccount } from '../../infrastructure/persistence/account/qqbot-account.entity';
import { QqbotConversation } from '../../infrastructure/persistence/message/qqbot-conversation.entity';
import { QqbotMessage } from '../../infrastructure/persistence/message/qqbot-message.entity';
import { QqbotRule } from '../../infrastructure/persistence/rule/qqbot-rule.entity';
import { QqbotSendLog } from '../../infrastructure/persistence/send/qqbot-send-log.entity';

@Injectable()
export class QqbotDashboardService {
  constructor(
    @InjectRepository(QqbotAccount)
    private readonly accountRepository: Repository<QqbotAccount>,
    @InjectRepository(QqbotConversation)
    private readonly conversationRepository: Repository<QqbotConversation>,
    @InjectRepository(QqbotMessage)
    private readonly messageRepository: Repository<QqbotMessage>,
    @InjectRepository(QqbotRule)
    private readonly ruleRepository: Repository<QqbotRule>,
    @InjectRepository(QqbotSendLog)
    private readonly sendLogRepository: Repository<QqbotSendLog>,
    private readonly busService: QqbotBusService,
    private readonly reverseWsService: QqbotReverseWsService,
  ) {}

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
      runtime: this.reverseWsService.getRuntimeStatus(),
      sendFailedTotal,
      sendSuccessTotal,
    };
  }
}
