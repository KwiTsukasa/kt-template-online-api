import { Inject, Injectable, Logger } from '@nestjs/common';
import { ToolsService } from '@/common';
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

  /**
   * 初始化 QqbotCommandEngineService 实例。
   * @param commandParser - commandParser 输入；影响 constructor 的返回值。
   * @param commandService - commandService 服务依赖；影响 constructor 的返回值。
   * @param pluginExecution - pluginExecution 输入；影响 constructor 的返回值。
   * @param replyTemplate - replyTemplate 输入；影响 constructor 的返回值。
   * @param sendService - sendService 服务依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   */
  constructor(
    private readonly commandParser: QqbotCommandParserService,
    private readonly commandService: QqbotCommandService,
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: QqbotPluginExecutionPort,
    private readonly replyTemplate: QqbotReplyTemplateService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * 处理Message。
   * @param message - message 输入；使用 `channelId`、`rawEvent`、`selfId`、`targetId` 字段生成结果。
   */
  async handleMessage(message: QqbotNormalizedMessage) {
    const commands = await this.commandService.listEnabledForMessage(message);
    for (const command of commands) {
      const matched = await this.commandParser.match(command, message);
      if (!matched) continue;
      if (this.commandService.isInCooldown(command)) return true;

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
            guildId: message.rawEvent.guild_id
              ? `${message.rawEvent.guild_id}`
              : undefined,
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
   * 执行 QQBot 核心流程。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   */
  async preview(body: QqbotCommandTestDto) {
    const message = this.buildPreviewMessage(body);
    const command = body.commandId
      ? await this.commandService.findById(body.commandId)
      : await this.findMatchedCommand(message);
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
   * 查询 QQBot 核心数据。
   * @param message - message 输入；驱动 `commandService.listEnabledForMessage()` 的 QQBot步骤。
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
   * 创建 QQBot 核心对象或配置。
   * @param command - command 输入；使用 `replyTemplate` 字段生成结果。
   * @param input - input 输入；生成 QQBot对象。
   * @param output - output 输入；生成 QQBot对象。
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
   * 投递 QQBot 核心消息或任务。
   * @param command - command 输入；驱动 `this.buildErrorReplyText()` 的 QQBot步骤。
   * @param input - input 输入；驱动 `this.buildErrorReplyText()` 的 QQBot步骤。
   * @param message - message 输入；使用 `channelId`、`rawEvent`、`selfId`、`targetId` 字段生成结果。
   * @param errorMessage - errorMessage 输入；驱动 `this.buildErrorReplyText()` 的 QQBot步骤。
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
        guildId: message.rawEvent.guild_id
          ? `${message.rawEvent.guild_id}`
          : undefined,
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
   * 创建 QQBot 核心对象或配置。
   * @param command - command 输入；使用 `errorTemplate` 字段生成结果。
   * @param input - input 输入；生成 QQBot对象。
   * @param errorMessage - errorMessage 输入；生成 QQBot对象。
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
   * 合并Input。
   * @param command - command 输入；驱动 `commandService.parseDefaultParams()` 的 QQBot步骤。
   * @param input - input 输入；驱动 `commandService.parseDefaultParams()` 的 QQBot步骤。
   */
  private mergeInput(command: QqbotCommand, input: Record<string, any>) {
    return {
      ...this.commandService.parseDefaultParams(command),
      ...this.removeUndefined(input),
    };
  }

  /**
   * 清理 QQBot 核心状态。
   * @param input - input 输入；驱动 `Object.entries()` 的 QQBot步骤。
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
   * 创建 QQBot 核心对象或配置。
   * @param body - 请求体 DTO；承载 QQBot新增、更新、导入或执行字段。
   * @returns 创建后的 QQBot 核心对象或配置。
   */
  private buildPreviewMessage(
    body: QqbotCommandTestDto,
  ): QqbotNormalizedMessage {
    const targetType = body.targetType || 'private';
    const targetId = body.targetId || body.userId || '10000';
    const userId = body.userId || targetId;
    return {
      eventTime: new Date(),
      groupId: targetType === 'group' ? targetId : undefined,
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
}
