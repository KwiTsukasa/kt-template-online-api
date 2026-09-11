import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ToolsService } from '@/common';
import {
  NapcatSessionBehaviorService,
  type NapcatAutoCapabilityStage,
} from '@/modules/bot-adapter/napcat/application/runtime/napcat-session-behavior.service';
import {
  PLUGIN_EXECUTION_PORT,
  type PluginExecutionPort,
} from '../../domain/plugin-execution.port';
import type { BotNormalizedMessage } from '../../contract/bot.types';
import type { BotAdapterExecutionContext } from '../../domain/bot-adapter-execution-context';
import { BotSendService } from '../send/bot-send.service';
import type { BotCommandTestDto } from '../../contract/command/bot-command.dto';
import type { BotCommand } from '../../infrastructure/persistence/command/bot-command.entity';
import { BotCommandParserService } from './bot-command-parser.service';
import { BotCommandService } from './bot-command.service';
import { BotReplyTemplateService } from './bot-reply-template.service';

@Injectable()
export class BotCommandEngineService {
  private readonly logger = new Logger(BotCommandEngineService.name);

  constructor(
    private readonly commandParser: BotCommandParserService,
    private readonly commandService: BotCommandService,
    @Inject(PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: PluginExecutionPort,
    private readonly replyTemplate: BotReplyTemplateService,
    private readonly sendService: BotSendService,
    private readonly toolsService: ToolsService,
    @Optional()
    private readonly sessionBehaviorService?: NapcatSessionBehaviorService,
  ) {}

  /**
   * 返回当前会话实际启用的命令及输入说明，排除已停用的插件能力。
   * @param message - 由入站链绑定的真实身份与会话。
   * @param adapterContext - 已重新读取的适配器授权目录。
   * @returns 模型可检索和调用的命令摘要。
   */
  async listForTools(
    message: BotNormalizedMessage,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    const commands = await this.commandService.listEnabledForMessage(
      message,
      adapterContext,
    );
    const result: Record<string, unknown>[] = [];
    for (const command of commands) {
      const operation =
        await this.pluginExecution.getOperationByCommand(command);
      if (!operation || operation.inputSchema?.['x-agent-invocable'] === false)
        continue;
      result.push({
        commandId: command.id,
        name: command.name,
        aliases: await this.commandParser.getAliases(command),
        prefixes: this.commandParser.getPrefixes(command),
        description: operation.description || command.remark,
        argumentFormat:
          '使用返回的前缀与别名组成完整命令，后接空格及原始参数。inputSchema描述业务字段，不表示聊天命令接受JSON。',
        defaults: command.defaultParams,
        inputSchema: operation.inputSchema,
      });
    }
    return result;
  }

  /**
   * 通过原命令解析、冷却、插件运行与审计入口执行工具请求，结果交给当前对话汇总。
   * @param message - 已绑定的真实消息身份及原始附件。
   * @param adapterContext - 调用时重新取得的插件授权。
   * @param commandId - 本次查询目录中的命令标识。
   * @param text - 包含命令前缀和参数的完整文本。
   * @returns 原命令的执行结果及渲染后的回复文本。
   * @throws 命令不可用、参数不匹配、冷却中或执行失败时拒绝调用。
   */
  async executeForTools(
    message: BotNormalizedMessage,
    adapterContext: BotAdapterExecutionContext | undefined,
    commandId: string,
    text: string,
  ) {
    const commands = await this.commandService.listEnabledForMessage(
      message,
      adapterContext,
    );
    const command = commands.find((item) => item.id === commandId);
    if (!command) throw new Error('命令未启用或当前账号未获授权');
    const operation = await this.pluginExecution.getOperationByCommand(command);
    if (!operation) throw new Error('命令未启用或当前账号未获授权');
    if (operation.inputSchema?.['x-agent-invocable'] === false)
      throw new Error('该操作仅接受用户直接发送命令，不能由模型代为执行');
    const toolMessage = { ...message, messageText: text, rawMessage: text };
    const matched = await this.commandParser.match(command, toolMessage);
    if (!matched) throw new Error('完整命令文本与所选命令不匹配');
    if (this.commandService.isInCooldown(command))
      throw new Error('命令冷却中，请稍后再试');
    const decision = this.sessionBehaviorService?.decideAutomation({
      automationKind: 'command_reply',
      stage: this.getBehaviorStage(message),
    });
    if (decision && !decision.allowed)
      throw new Error('当前会话阶段不允许自动执行命令');
    const input = this.mergeInput(command, matched.input);
    await this.commandService.markHit(command);
    try {
      const output = await this.pluginExecution.executeOperation({
        context: { arguments: matched.input, bot: { selfId: message.selfId } },
        input,
        operationKey: command.operationKey,
        pluginKey: command.pluginKey,
      });
      await this.commandService.logExecution({
        command,
        input,
        message,
        output,
        status: 'success',
      });
      return {
        status: 'success',
        output,
        replyText: this.buildReplyText(command, input, output),
      };
    } catch (error) {
      const errorMessage = this.toolsService.getErrorMessage(
        error,
        '命令执行失败',
      );
      await this.commandService.logExecution({
        command,
        input,
        message,
        errorMessage,
        status: 'failed',
      });
      throw new Error(errorMessage);
    }
  }

  /**
   * 根据`message`处理消息；当 `!behaviorDecision.allowed` 成立时返回 `true`。
   * @param message - 包含正文、发送目标与账号身份的待处理消息，包含 `channelId`、`rawEvent`、`selfId`、`targetId` 字段。
   * @param adapterContext - 当前 transport 已授权的插件键；缺省时沿用非插件限定的命令目录。
   * @returns 满足消息约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async handleMessage(
    message: BotNormalizedMessage,
    adapterContext?: BotAdapterExecutionContext,
  ) {
    const commands = await this.commandService.listEnabledForMessage(
      message,
      adapterContext,
    );
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
          `Bot 命令回复已按 NapCat 会话行为阶段跳过: ${behaviorDecision.reason}`,
        );
        return true;
      }

      await this.commandService.markHit(command);
      const input = this.mergeInput(command, matched.input);
      try {
        const output = await this.pluginExecution.executeOperation({
          context: {
            arguments: matched.input,
            bot: { selfId: message.selfId },
          },
          input,
          operationKey: command.operationKey,
          pluginKey: command.pluginKey,
        });
        const replyText = this.buildReplyText(command, input, output);
        if (replyText) {
          await this.sendService.sendText({
            channelId: message.channelId,
            guildId: message.guildId,
            message: replyText,
            adapterReplyContext: message.adapterReplyContext,
            replyMessageId: message.replyMessageId,
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
        this.logger.warn(`Bot 命令执行失败: ${errorMessage}`);
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
  async preview(body: BotCommandTestDto) {
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
          arguments: matched.input,
          bot: { selfId: message.selfId },
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
  private async findMatchedCommand(message: BotNormalizedMessage) {
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
    command: BotCommand,
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
    command: BotCommand,
    input: Record<string, any>,
    message: BotNormalizedMessage,
    errorMessage: string,
  ) {
    const reply = this.buildErrorReplyText(command, input, errorMessage);
    try {
      await this.sendService.sendText({
        channelId: message.channelId,
        guildId: message.guildId,
        message: reply,
        adapterReplyContext: message.adapterReplyContext,
        replyMessageId: message.replyMessageId,
        selfId: message.selfId,
        targetId: message.targetId,
        targetType: message.messageType,
      });
    } catch (err) {
      const sendErr = this.toolsService.getErrorMessage(
        err,
        '错误回复发送失败',
      );
      this.logger.warn(`Bot 命令错误回复发送失败: ${sendErr}`);
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
    command: BotCommand,
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
  private mergeInput(command: BotCommand, input: Record<string, any>) {
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
  private buildPreviewMessage(body: BotCommandTestDto): BotNormalizedMessage {
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
