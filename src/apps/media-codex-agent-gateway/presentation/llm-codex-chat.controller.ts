import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LlmCodexChatService } from '../application/llm-codex-chat.service';
import { LLM_CODEX_GATEWAY_CONTROLLER_PATH } from '../domain/llm-codex-runtime.contract';
import { LlmCodexInternalGuard } from './llm-codex-internal.guard';
import { LlmCodexChatStreamDto } from './llm-codex-chat.dto';

@Controller(LLM_CODEX_GATEWAY_CONTROLLER_PATH)
@UseGuards(LlmCodexInternalGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class LlmCodexChatController {
  constructor(private readonly service: LlmCodexChatService) {}

  /**
   * 返回统一 Codex App Server 与媒体回调健康状态。
   * @returns 网关、权限档、网络和 API 回调状态。
   * @throws 依赖未就绪时返回 503。
   */
  @Get('health')
  async health() {
    try {
      return await this.service.health();
    } catch {
      throw new ServiceUnavailableException('llm-codex-dependency-unavailable');
    }
  }

  /**
   * 实时返回当前 Codex App Server 允许发送的模型列表。
   * @returns 仅包含稳定发送标识与用户可见名称的模型列表。
   * @throws App Server 握手或模型协议不可用时返回 503。
   */
  @Get('models')
  async models() {
    try {
      return await this.service.models();
    } catch {
      throw new ServiceUnavailableException('llm-codex-models-unavailable');
    }
  }

  /**
   * 通过私有网关启动或续接 Codex turn，并以 SSE 转发可见增量。
   * @param body - 模型、正文、客户端消息标识和可选线程。
   * @param request - 用于侦测 API 调用方断连的请求。
   * @param response - 写入 start、增量、done 或 error 的响应。
   */
  @Post('chat/stream')
  @HttpCode(HttpStatus.OK)
  async stream(
    @Body() body: LlmCodexChatStreamDto,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const abortController = new AbortController();
    let disconnected = false;
    const abort = () => {
      disconnected = true;
      abortController.abort();
    };
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    this.prepare(response);
    try {
      for await (const event of this.service.stream(
        body,
        abortController.signal,
      )) {
        await this.write(response, event.type, event);
      }
    } catch (error) {
      if (!disconnected && !abortController.signal.aborted) {
        await this.write(response, 'error', {
          message: this.safeError(error),
        });
      }
    } finally {
      request.removeListener('aborted', abort);
      if (!response.writableEnded) response.end();
    }
  }

  /**
   * 把 Express 响应切换为立即 flush 的无缓存 SSE 通道，并显式关闭代理缓冲。
   * @param response - 当前 Express 响应。
   */
  private prepare(response: Response) {
    response.status(HttpStatus.OK);
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  /**
   * 将统一事件编码为 SSE 帧；当内核写缓冲已满时等待 drain 再继续。
   * @param response - 当前 Express 响应。
   * @param event - 稳定事件名。
   * @param data - 不含 App Server 原始协议和凭据的事件数据。
   */
  private async write(response: Response, event: string, data: unknown) {
    if (response.destroyed || response.writableEnded) return;
    const writable = response.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
    if (!writable) await this.waitForDrain(response);
  }

  /**
   * 在网关响应背压时等待 drain，并在连接关闭或报错时结束等待。
   * @param response - 当前 SSE 响应。
   * @returns drain 或 close 到达时完成的 Promise。
   */
  private waitForDrain(response: Response): Promise<void> {
    if (response.destroyed || response.writableEnded) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        response.removeListener('close', complete);
        response.removeListener('drain', complete);
        response.removeListener('error', fail);
      };
      const complete = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      response.once('close', complete);
      response.once('drain', complete);
      response.once('error', fail);
    });
  }

  /**
   * 将未知错误收敛为单行短文本。
   * @param error - 网关流阶段捕获的未知错误。
   * @returns 最长 300 字符的安全错误。
   */
  private safeError(error: unknown) {
    if (error instanceof Error && error.message) {
      return error.message
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 300);
    }
    return '本地 Codex 流式请求失败';
  }
}
