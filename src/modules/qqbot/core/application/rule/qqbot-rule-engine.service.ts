import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolsService } from '@/common';
import {
  NapcatSessionBehaviorService,
  type NapcatAutomationKind,
  type NapcatAutoCapabilityStage,
} from '@/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service';
import {
  QQBOT_PLUGIN_EXECUTION_PORT,
  type QqbotPluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { QqbotNormalizedMessage } from '../../contract/qqbot.types';
import { QqbotCommandEngineService } from '../command/qqbot-command-engine.service';
import { QqbotPermissionService } from '../permission/qqbot-permission.service';
import { QqbotSendService } from '../send/qqbot-send.service';
import { QqbotRuleService } from './qqbot-rule.service';

@Injectable()
export class QqbotRuleEngineService {
  private readonly logger = new Logger(QqbotRuleEngineService.name);

  constructor(
    private readonly commandEngineService: QqbotCommandEngineService,
    private readonly permissionService: QqbotPermissionService,
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: QqbotPluginExecutionPort,
    private readonly ruleService: QqbotRuleService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly sessionBehaviorService?: NapcatSessionBehaviorService,
  ) {}

  /**
   * 通过 `permissionService.isBlocked` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `channelId`、`rawEvent`、`selfId`、`targetId` 字段。
   */
  async handleMessage(message: QqbotNormalizedMessage) {
    if (await this.permissionService.isBlocked(message)) return;
    if (!(await this.permissionService.isAllowed(message))) return;
    if (await this.commandEngineService.handleMessage(message)) return;

    const rules = await this.ruleService.listEnabledForMessage(message);
    for (const rule of rules) {
      if (this.ruleService.isInCooldown(rule)) continue;
      if (!this.ruleService.isMatched(rule, message)) continue;

      const ruleDecision = this.decideAutomation('rule_reply', message);
      if (!ruleDecision.allowed) {
        this.logger.warn(
          `QQBot 自动回复已按 NapCat 会话行为阶段跳过: ${ruleDecision.reason}`,
        );
        return;
      }

      await this.ruleService.markHit(rule);
      try {
        await this.sendService.sendText({
          channelId: message.channelId,
          guildId: message.guildId,
          message: rule.replyContent,
          replyMessageId: message.replyMessageId,
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

    const eventDecision = this.decideAutomation('event_plugin', message);
    if (!eventDecision.allowed) {
      this.logger.warn(
        `QQBot 事件插件已按 NapCat 会话行为阶段跳过: ${eventDecision.reason}`,
      );
      return;
    }

    await this.pluginExecution.dispatchEvent({
      eventKey: 'message',
      message,
    });
  }

  /**
   * 根据`automationKind`、`message`处理决定自动化；从 `getBehaviorStage` 读取决定自动化。
   * @param automationKind - 决定自动化内容、边界或目标的 `automationKind` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 规范化后的决定自动化；主值为空时采用 `{ allowed: true }` 兜底。
   */
  private decideAutomation(
    automationKind: NapcatAutomationKind,
    message: QqbotNormalizedMessage,
  ) {
    return (
      this.sessionBehaviorService?.decideAutomation({
        automationKind,
        stage: this.getBehaviorStage(message),
      }) || { allowed: true }
    );
  }

  /**
   * 按`message`读取行为阶段；当 `this.isBehaviorStage(stage)` 成立时返回 `stage`。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `rawEvent` 字段。
   * @returns 行为阶段；没有可用结果或提前结束时为 `undefined`。
   */
  private getBehaviorStage(
    message: QqbotNormalizedMessage,
  ): NapcatAutoCapabilityStage | undefined {
    const stage =
      message.rawEvent.napcatBehaviorStage ||
      message.rawEvent.napcat_behavior_stage;
    if (this.isBehaviorStage(stage)) {
      return stage;
    }
    return undefined;
  }

  /**
   * 根据`stage`与当前约束判定行为阶段。
   * @param stage - 决定行为阶段内容、边界或目标的 `stage` 值。
   * @returns 满足行为阶段约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  private isBehaviorStage(stage: unknown): stage is NapcatAutoCapabilityStage {
    return (
      stage === 'automation' ||
      stage === 'image_and_large_message' ||
      stage === 'low_risk_text' ||
      stage === 'manual_command'
    );
  }
}
