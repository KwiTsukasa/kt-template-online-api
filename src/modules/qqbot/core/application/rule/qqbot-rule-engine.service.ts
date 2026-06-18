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

  /**
   * 初始化 QqbotRuleEngineService 实例。
   * @param commandEngineService - commandEngineService 服务依赖；影响 constructor 的返回值。
   * @param permissionService - permissionService 服务依赖；影响 constructor 的返回值。
   * @param pluginExecution - pluginExecution 输入；影响 constructor 的返回值。
   * @param ruleService - ruleService 服务依赖；影响 constructor 的返回值。
   * @param sendService - sendService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param sessionBehaviorService - Optional staged automation gate supplied by NapCat runtime profile.
   */
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
   * 处理Message。
   * @param message - message 输入；使用 `channelId`、`rawEvent`、`selfId`、`targetId` 字段生成结果。
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
   * Applies optional NapCat behavior-stage gating to automatic rule and event-plugin paths.
   * @param automationKind - Automatic behavior category being considered for the current inbound message.
   * @param message - Normalized OneBot message whose raw event may carry a staged behavior profile hint.
   * @returns Allow/skip decision; missing NapCat profile data keeps current behavior unchanged.
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
   * Reads a behavior stage hint from raw event metadata when the runtime profile has provided one.
   * @param message - Normalized OneBot message with raw event metadata from the connection boundary.
   * @returns Valid behavior stage or `undefined` when no runtime profile hint is present.
   */
  private getBehaviorStage(
    message: QqbotNormalizedMessage,
  ): NapcatAutoCapabilityStage | undefined {
    const stage =
      message.rawEvent.napcatBehaviorStage ||
      message.rawEvent.napcat_behavior_stage;
    return this.isBehaviorStage(stage) ? stage : undefined;
  }

  /**
   * Validates raw stage metadata before passing it to the behavior decision service.
   * @param stage - Raw event metadata that may name a NapCat automation capability stage.
   * @returns Whether the value belongs to the NapCat behavior-stage vocabulary.
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
