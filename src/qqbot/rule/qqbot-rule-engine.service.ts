import { Injectable, Logger } from '@nestjs/common';
import { ToolsService } from '@/common';
import type { QqbotNormalizedMessage } from '../qqbot.types';
import { QqbotCommandEngineService } from '../command/qqbot-command-engine.service';
import { QqbotPermissionService } from '../permission/qqbot-permission.service';
import { QqbotRepeaterPluginService } from '@/modules/qqbot/plugins/repeater/qqbot-repeater.plugin';
import { QqbotSendService } from '../send/qqbot-send.service';
import { QqbotRuleService } from './qqbot-rule.service';

@Injectable()
export class QqbotRuleEngineService {
  private readonly logger = new Logger(QqbotRuleEngineService.name);

  constructor(
    private readonly commandEngineService: QqbotCommandEngineService,
    private readonly permissionService: QqbotPermissionService,
    private readonly repeaterPluginService: QqbotRepeaterPluginService,
    private readonly ruleService: QqbotRuleService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
  ) {}

  async handleMessage(message: QqbotNormalizedMessage) {
    if (await this.permissionService.isBlocked(message)) return;
    if (!(await this.permissionService.isAllowed(message))) return;
    if (await this.commandEngineService.handleMessage(message)) return;

    const rules = await this.ruleService.listEnabledForMessage(message);
    for (const rule of rules) {
      if (this.ruleService.isInCooldown(rule)) continue;
      if (!this.ruleService.isMatched(rule, message)) continue;

      await this.ruleService.markHit(rule);
      try {
        await this.sendService.sendText({
          channelId: message.channelId,
          guildId: message.rawEvent.guild_id
            ? `${message.rawEvent.guild_id}`
            : undefined,
          message: rule.replyContent,
          selfId: message.selfId,
          targetId: message.targetId,
          targetType: message.messageType,
        });
      } catch (err) {
        const errMsg = this.toolsService.getErrorMessage(err, '自动回复失败');
        this.logger.warn(`QQBot 自动回复失败: ${errMsg}`);
      }
      return;
    }

    await this.repeaterPluginService.handleMessage(message);
  }
}
