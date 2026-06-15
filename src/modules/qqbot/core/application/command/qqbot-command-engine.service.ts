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

  constructor(
    private readonly commandParser: QqbotCommandParserService,
    private readonly commandService: QqbotCommandService,
    @Inject(QQBOT_PLUGIN_EXECUTION_PORT)
    private readonly pluginExecution: QqbotPluginExecutionPort,
    private readonly replyTemplate: QqbotReplyTemplateService,
    private readonly sendService: QqbotSendService,
    private readonly toolsService: ToolsService,
  ) {}

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

  private async findMatchedCommand(message: QqbotNormalizedMessage) {
    const commands = await this.commandService.listEnabledForMessage(message);
    for (const command of commands) {
      if (await this.commandParser.match(command, message)) {
        return command;
      }
    }
    throw new Error('未匹配到命令');
  }

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

  private mergeInput(command: QqbotCommand, input: Record<string, any>) {
    return {
      ...this.commandService.parseDefaultParams(command),
      ...this.removeUndefined(input),
    };
  }

  private removeUndefined(input: Record<string, any>) {
    return Object.entries(input).reduce<Record<string, any>>(
      (result, [key, value]) => {
        if (value !== undefined && value !== '') result[key] = value;
        return result;
      },
      {},
    );
  }

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
