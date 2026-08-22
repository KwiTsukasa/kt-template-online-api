import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolsService } from '@/common';
import {
  NapcatSessionBehaviorService,
  type NapcatAutomationKind,
  type NapcatAutoCapabilityStage,
} from '@/modules/bot-adapter/napcat/application/runtime/napcat-session-behavior.service';
import {
  PLUGIN_EXECUTION_PORT,
  type PluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import type { BotAdapterExecutionContext } from '../../domain/bot-adapter-execution-context';
import { BotAccountService } from '../account/bot-account.service';
import { BotCommandEngineService } from '../command/bot-command-engine.service';
import { toBotPluginMessageEvent } from '../event/plugin-event.mapper';
import { BotPermissionService } from '../permission/bot-permission.service';
import { BotSendService } from './bot-send.service';
import { BotRuleService } from '../rule/bot-rule.service';

@Injectable()
export class BotRuleEngineService {
  private readonly logger = new Logger(BotRuleEngineService.name);

  constructor(
    private readonly accountService: BotAccountService,
    private readonly commandEngineService: BotCommandEngineService,
    private readonly permissionService: BotPermissionService,
    @Inject(PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: PluginExecutionPort,
    private readonly ruleService: BotRuleService,
    private readonly sendService: BotSendService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly sessionBehaviorService?: NapcatSessionBehaviorService,
  ) {}

  /**
   * 通过 `permissionService.isBlocked` 判断输入是否满足函数约束。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `channelId`、`rawEvent`、`selfId`、`targetId` 字段。
   * @param adapterContext - 当前 transport 已授权的插件键；传入后约束命令和插件执行范围。
   */
  async handleMessage(
    message: BotNormalizedMessage,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    if (await this.permissionService.isBlocked(message)) return;
    if (!(await this.permissionService.isAllowed(message))) return;
    if (
      await this.commandEngineService.handleMessage(message, adapterContext)
    ) {
      return;
    }

    const rules = await this.ruleService.listEnabledForMessage(message);
    for (const rule of rules) {
      if (this.ruleService.isInCooldown(rule)) continue;
      if (!this.ruleService.isMatched(rule, message)) continue;

      const ruleDecision = this.decideAutomation('rule_reply', message);
      if (!ruleDecision.allowed) {
        this.logger.warn(
          `Bot 自动回复已按 NapCat 会话行为阶段跳过: ${ruleDecision.reason}`,
        );
        return;
      }

      await this.ruleService.markHit(rule);
      try {
        await this.sendService.sendText({
          channelId: message.channelId,
          guildId: message.guildId,
          message: rule.replyContent,
          adapterReplyContext: message.adapterReplyContext,
          replyMessageId: message.replyMessageId,
          selfId: message.selfId,
          targetId: message.targetId,
          targetType: message.messageType,
        });
      } catch (err) {
        const errMsg = this.toolsService.getErrorMessage(err, '自动回复失败');
        this.logger.warn(`Bot 自动回复失败: ${errMsg}`);
      }
      return;
    }

    const eventDecision = this.decideAutomation('event_plugin', message);
    if (!eventDecision.allowed) {
      this.logger.warn(
        `Bot 事件插件已按 NapCat 会话行为阶段跳过: ${eventDecision.reason}`,
      );
      return;
    }

    let pluginKeys: string[];
    if (adapterContext) {
      pluginKeys = adapterContext.pluginKeys;
    } else {
      pluginKeys = await this.accountService.getBoundEventPluginKeys(
        message.selfId,
      );
    }
    if (pluginKeys.length === 0) return;
    try {
      const result = await this.pluginExecution.dispatchEvent({
        event: toBotPluginMessageEvent(message),
        eventKey: 'message',
        pluginKeys,
      });
      for (const reply of result.replies) {
        await this.sendService.sendText({
          channelId: message.channelId,
          guildId: message.guildId,
          message: reply.content,
          adapterReplyContext: message.adapterReplyContext,
          replyMessageId: message.replyMessageId,
          selfId: message.selfId,
          targetId: message.targetId,
          targetType: message.messageType,
        });
      }
    } catch (error) {
      const errorMessage = this.toolsService.getErrorMessage(
        error,
        'Bot 插件事件处理失败',
      );
      this.logger.warn(`Bot 插件事件处理失败: ${errorMessage}`);
    }
  }

  /**
   * 根据`automationKind`、`message`处理决定自动化；从 `getBehaviorStage` 读取决定自动化。
   * @param automationKind - 决定自动化内容、边界或目标的 `automationKind` 值。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 规范化后的决定自动化；主值为空时采用 `{ allowed: true }` 兜底。
   */
  private decideAutomation(
    automationKind: NapcatAutomationKind,
    message: BotNormalizedMessage,
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
    message: BotNormalizedMessage,
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
