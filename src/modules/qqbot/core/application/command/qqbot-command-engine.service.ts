import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolsService } from '@/common';
import {
  NapcatSessionBehaviorService,
  type NapcatAutoCapabilityStage,
} from '@/modules/qqbot/napcat/application/runtime/napcat-session-behavior.service';
import {
  QQBOT_PLUGIN_EXECUTION_PORT,
  type QqbotPluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { QqbotNormalizedMessage } from '../../contract/qqbot.types';
import { QqbotSendService } from '../send/qqbot-send.service';
import type { QqbotCommandTestDto } from '../../contract/command/qqbot-command.dto';
import type { QqbotCommand } from '../../infrastructure/persistence/command/qqbot-command.entity';
import { QqbotCommandParserService } from './qqbot-command-parser.service';
import { QqbotCommandService } from './qqbot-command.service';
import { QqbotReplyTemplateService } from './qqbot-reply-template.service';

@Injectable()
export class QqbotCommandEngineService {
  private readonly logger = new Logger(QqbotCommandEngineService.name);

  constructor(
    private readonly commandParser: QqbotCommandParserService,
    private readonly commandService: QqbotCommandService,
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: QqbotPluginExecutionPort,
    private readonly replyTemplate: QqbotReplyTemplateService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly sessionBehaviorService?: NapcatSessionBehaviorService,
  ) {}

  /**
   * 根据`message`处理消息；当 `!behaviorDecision.allowed` 成立时返回 `true`。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `channelId`、`rawEvent`、`selfId`、`targetId` 字段。
   * @returns 满足消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async handleMessage(message: QqbotNormalizedMessage) {
    const commands = await this.commandService.listEnabledForMessage(message);
    for (const command of commands) {
      const matched = await this.commandParser.match(command, message);
      if (!matched) continue;
      if (this.commandService.isInCooldown(command)) return true;
      const behaviorDecision = this.sessionBehaviorService?.decideAutomation({
        automationKind: 'command_reply',
        stage: this.getBehaviorStage(message),
      }) || { allowed: true };
      if (!behaviorDecision.allowed) {
        this.logger.warn(
          `QQBot 命令回复已按 NapCat 会话行为阶段跳过: ${behaviorDecision.reason}`,
        );
        return true;
      }

      await this.commandService.markHit(command);
      const input = this.mergeInput(command, matched.input);
      try {
        const output = await this.pluginExecution.executeOperation({
          context: {
            args: matched.input,
            command,
            message,
          },
          input,
          operationKey: command.operationKey,
          pluginKey: command.pluginKey,
        });
        const replyText = this.buildReplyText(command, input, output);
        if (replyText) {
          await this.sendService.sendText({
            channelId: message.channelId,
            guildId: (() => {
              if (message.rawEvent.guild_id) {
                return `${message.rawEvent.guild_id}`;
              }
              return undefined;
            })(),
            message: replyText,
            selfId: message.selfId,
            targetId: message.targetId,
            targetType: message.messageType,
          });
        }
        await this.commandService.logExecution({
          command,
          input,
          message,
          output,
          status: 'success',
        });
      } catch (err) {
        const errorMessage = this.toolsService.getErrorMessage(
          err,
          '命令执行失败',
        );
        await this.commandService.logExecution({
          command,
          errorMessage,
          input,
          message,
          status: 'failed',
        });
        await this.sendErrorReply(command, input, message, errorMessage);
        this.logger.warn(`QQBot 命令执行失败: ${errorMessage}`);
      }
      return true;
    }
    return false;
  }

  /**
   * 根据`body`处理预览；当 `!matched` 成立时返回 `{ matched: false, message: '未匹配到命令', }`。
   * @param body - 用于预览的结构化输入，包含 `commandId` 字段。
   * @returns 包含 `command`、`errorMessage`、`input`、`matched`、`output` 字段的预览。
   */
  async preview(body: QqbotCommandTestDto) {
    const message = this.buildPreviewMessage(body);
    const command = await (async () => {
      if (body.commandId) {
        return await this.commandService.findById(body.commandId);
      }
      return await this.findMatchedCommand(message);
    })();
    const matched = await this.commandParser.match(command, message);
    if (!matched) {
      return {
        matched: false,
        message: '未匹配到命令',
      };
    }

    const input = this.mergeInput(command, matched.input);
    try {
      const output = await this.pluginExecution.executeOperation({
        context: {
          args: matched.input,
          command,
          message,
        },
        input,
        operationKey: command.operationKey,
        pluginKey: command.pluginKey,
      });
      const replyText = this.buildReplyText(command, input, output);
      return {
        command: this.commandService.toResponse(command),
        input,
        matched: true,
        output,
        replyText,
        status: 'success',
      };
    } catch (err) {
      const errorMessage = this.toolsService.getErrorMessage(
        err,
        '命令执行失败',
      );
      return {
        command: this.commandService.toResponse(command),
        errorMessage,
        input,
        matched: true,
        output: null,
        replyText: this.buildErrorReplyText(command, input, errorMessage),
        status: 'failed',
      };
    }
  }

  /**
   * 按`message`读取Matched命令；当 `await this.commandParser.match(command, message)` 成立时返回 `command`。
   * @param message - 包含正文、发送目标与账号身份的待处理消息。
   * @returns Matched命令。
   * @throws 当前函数此前所有接受或成功分支均未返回时拒绝当前输入并抛出 `Error`。
   */
  private async findMatchedCommand(message: QqbotNormalizedMessage) {
    const commands = await this.commandService.listEnabledForMessage(message);
    for (const command of commands) {
      if (await this.commandParser.match(command, message)) {
        return command;
      }
    }
    throw new Error('未匹配到命令');
  }

  /**
   * 用命令回复模板渲染输入与执行输出，并在模板为空时回退为输出的稳定文本表示。
   * @param command - 用于Reply文本的领域对象，包含 `replyTemplate` 字段。
   * @param input - 用于Reply文本的结构化输入。
   * @param output - 决定Reply文本内容、边界或目标的 `output` 值。
   * @returns 规范化后的Reply文本；主值为空时采用 `this.replyTemplate.stringifyOutput(output)` 兜底。
   */
  private buildReplyText(
    command: QqbotCommand,
    input: Record<string, any>,
    output: any,
  ) {
    const data = { input, output, ...output };
    return (
      this.replyTemplate.render(command.replyTemplate, data) ||
      this.replyTemplate.stringifyOutput(output)
    );
  }

  /**
   * 按`command`、`input`、`message`投递错误Reply；向目标通道投递结果（`sendService.sendText`）。
   * @param command - 决定错误Reply内容、边界或目标的 `command` 值。
   * @param input - 用于错误Reply的结构化输入。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `channelId`、`rawEvent`、`selfId`、`targetId` 字段。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息。
   */
  private async sendErrorReply(
    command: QqbotCommand,
    input: Record<string, any>,
    message: QqbotNormalizedMessage,
    errorMessage: string,
  ) {
    const reply = this.buildErrorReplyText(command, input, errorMessage);
    try {
      await this.sendService.sendText({
        channelId: message.channelId,
        guildId: (() => {
          if (message.rawEvent.guild_id) {
            return `${message.rawEvent.guild_id}`;
          }
          return undefined;
        })(),
        message: reply,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      });
    } catch (err) {
      const sendErr = this.toolsService.getErrorMessage(
        err,
        '错误回复发送失败',
      );
      this.logger.warn(`QQBot 命令错误回复发送失败: ${sendErr}`);
    }
  }

  /**
   * 根据`command`、`input`、`errorMessage`构造错误Reply文本。
   * @param command - 用于错误Reply文本的领域对象，包含 `errorTemplate` 字段。
   * @param input - 用于错误Reply文本的结构化输入。
   * @param errorMessage - 包含正文、发送目标与账号身份的待处理消息。
   * @returns 规范化后的错误Reply文本；主值为空时采用 ``命令执行失败：${errorMessage}`` 兜底。
   */
  private buildErrorReplyText(
    command: QqbotCommand,
    input: Record<string, any>,
    errorMessage: string,
  ) {
    return (
      this.replyTemplate.render(command.errorTemplate, {
        error: errorMessage,
        input,
      }) || `命令执行失败：${errorMessage}`
    );
  }

  /**
   * 将命令默认参数与本次非空输入合并，并让本次输入覆盖同名默认值。
   * @param command - 决定输入内容、边界或目标的 `command` 值。
   * @param input - 用于输入的结构化输入。
   * @returns 输入。
   */
  private mergeInput(command: QqbotCommand, input: Record<string, any>) {
    return {
      ...this.commandService.parseDefaultParams(command),
      ...this.removeUndefined(input),
    };
  }

  /**
   * 按`input`移除未定义字段。
   * @param input - 用于未定义字段的结构化输入。
   * @returns 未定义字段。
   */
  private removeUndefined(input: Record<string, any>) {
    return Object.entries(input).reduce<Record<string, any>>(
      (result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      },
      {},
    );
  }

  /**
   * 根据`body`构造预览消息。
   * @param body - 用于预览消息的结构化输入，包含 `targetType`、`targetId`、`userId`、`text` 字段。
   * @returns 包含 `eventTime`、`groupId`、`messageId`、`messageText`、`messageType` 字段的预览消息。
   */
  private buildPreviewMessage(
    body: QqbotCommandTestDto,
  ): QqbotNormalizedMessage {
    const targetType = body.targetType || 'private';
    const targetId = body.targetId || body.userId || '10000';
    const userId = body.userId || targetId;
    return {
      eventTime: new Date(),
      groupId: (() => {
        if (targetType === 'group') {
          return targetId;
        }
        return undefined;
      })(),
      messageId: `preview-${Date.now()}`,
      messageText: body.text,
      messageType: targetType,
      rawEvent: {},
      rawMessage: body.text,
      selfId: body.selfId || 'preview',
      targetId,
      userId,
    };
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
