import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  normalizeVbenErrorText,
  TrustedCredentialTransportService,
  vbenPage,
  vbenSuccess,
} from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { LlmConfigService } from '../application/llm-config.service';
import {
  LlmConversationService,
  type LlmConversationStreamEvent,
} from '../application/llm-conversation.service';
import {
  LlmConfigCreateDto,
  LlmConfigEnabledDto,
  LlmConfigListQueryDto,
  LlmConfigTestDto,
  LlmConfigUpdateDto,
  LlmConversationCreateDto,
  LlmConversationListQueryDto,
  LlmConversationMessageStreamDto,
} from '../contract/llm.dto';

@ApiTags('Admin - 大模型')
@Controller('llm')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class LlmController {
  constructor(
    private readonly configs: LlmConfigService,
    private readonly conversations: LlmConversationService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
  ) {}

  /**
   * 把六类供应商协议、默认端点及凭据要求包装为禁止缓存的 Vben 响应。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 六类供应商目录。
   */
  @Get('providers')
  @ApiOperation({ summary: '获取大模型供应商目录' })
  providers(@Res({ passthrough: true }) response: Response) {
    this.disableCache(response);
    return vbenSuccess(this.configs.providerCatalog());
  }

  /**
   * 按卡片页筛选条件读取连接分页。
   * @param query - 关键词、供应商、状态和分页条件。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns Vben 分页连接列表。
   */
  @Get('configs')
  @ApiOperation({ summary: '分页查询大模型连接' })
  async configList(
    @Query() query: LlmConfigListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    const page = await this.configs.list(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 将连接状态分组计数包装为禁止缓存的 Vben 响应，供卡片看板顶部展示。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 总数、已连接、异常和已停用数量。
   */
  @Get('configs/summary')
  @ApiOperation({ summary: '汇总大模型连接状态' })
  async configSummary(@Res({ passthrough: true }) response: Response) {
    this.disableCache(response);
    return vbenSuccess(await this.configs.summary());
  }

  /**
   * 按 Snowflake ID 组合脱敏连接详情，并阻止浏览器或代理缓存可能变化的状态。
   * @param id - 连接 Snowflake ID。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 脱敏连接详情。
   */
  @Get('configs/:id')
  @ApiOperation({ summary: '获取大模型连接详情' })
  async configDetail(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    return vbenSuccess(await this.configs.detail(id));
  }

  /**
   * 使用已保存连接凭据实时读取供应商可用模型，不读取或写入静态模型配置。
   * @param id - 连接 Snowflake ID。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 获取时间、供应商和规范化模型项。
   */
  @Get('configs/:id/models')
  @ApiOperation({ summary: '实时获取大模型连接可用模型' })
  async configModels(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    return vbenSuccess(await this.configs.models(id));
  }

  /**
   * 在可信传输边界内创建连接并加密非空 API Key。
   * @param body - 新连接字段。
   * @param request - 用于校验 HTTPS 或显式本地例外的请求。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 新连接脱敏视图。
   */
  @Post('configs')
  @ApiOperation({ summary: '创建大模型连接' })
  async createConfig(
    @Body() body: LlmConfigCreateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.trustedCredentialTransportService.assertTrusted(request);
    this.disableCache(response);
    return vbenSuccess(await this.configs.create(body));
  }

  /**
   * 在可信传输边界内更新连接，空 API Key 保留旧值。
   * @param id - 连接 Snowflake ID。
   * @param body - 允许局部更新的连接字段。
   * @param request - 用于校验凭据传输安全的请求。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 更新后的脱敏连接视图。
   */
  @Put('configs/:id')
  @ApiOperation({ summary: '更新大模型连接' })
  async updateConfig(
    @Param('id') id: string,
    @Body() body: LlmConfigUpdateDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.trustedCredentialTransportService.assertTrusted(request);
    this.disableCache(response);
    return vbenSuccess(await this.configs.update(id, body));
  }

  /**
   * 仅在服务层确认连接可删除后返回软删除标识，并始终避免回传已保存凭据。
   * @param id - 连接 Snowflake ID。
   * @returns 被删除的连接标识。
   */
  @Delete('configs/:id')
  @ApiOperation({ summary: '删除大模型连接' })
  async removeConfig(@Param('id') id: string) {
    return vbenSuccess(await this.configs.remove(id));
  }

  /**
   * 把启停目标交给连接状态机，并返回同步后的脱敏卡片视图。
   * @param id - 连接 Snowflake ID。
   * @param body - 目标启用状态。
   * @returns 更新后的连接视图。
   */
  @Post('configs/:id/enabled')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启停大模型连接' })
  async setConfigEnabled(
    @Param('id') id: string,
    @Body() body: LlmConfigEnabledDto,
  ) {
    return vbenSuccess(await this.configs.setEnabled(id, body.enabled));
  }

  /**
   * 把指定启用连接设为唯一默认项。
   * @param id - 连接 Snowflake ID。
   * @returns 更新后的连接视图。
   */
  @Post('configs/:id/default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '设为默认大模型连接' })
  async setDefaultConfig(@Param('id') id: string) {
    return vbenSuccess(await this.configs.setDefault(id));
  }

  /**
   * 使用已保存凭据与指定模型验证真实流式首包。
   * @param id - 连接 Snowflake ID。
   * @param body - 可选测试模型。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 首 Token 延迟、总耗时与短预览。
   */
  @Post('configs/:id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '测试大模型连接' })
  async testConfig(
    @Param('id') id: string,
    @Body() body: LlmConfigTestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    return vbenSuccess(await this.configs.testConnection(id, body.model));
  }

  /**
   * 按 configId 和上限读取最近会话，并以禁止缓存的 Vben 响应供左栏导航。
   * @param query - 连接标识与返回上限。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 对话摘要数组。
   */
  @Get('conversations')
  @ApiOperation({ summary: '查询大模型对话' })
  async conversationList(
    @Query() query: LlmConversationListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    return vbenSuccess(await this.conversations.list(query));
  }

  /**
   * 在指定连接下建立不预选模型的普通会话，并为空标题提供稳定兜底。
   * @param body - 连接标识与可选标题。
   * @returns 新对话摘要。
   */
  @Post('conversations')
  @ApiOperation({ summary: '创建大模型对话' })
  async createConversation(@Body() body: LlmConversationCreateDto) {
    return vbenSuccess(await this.conversations.create(body));
  }

  /**
   * 组合对话、连接和按序消息历史，并禁止缓存持续变化的流式终态。
   * @param id - 对话 Snowflake ID。
   * @param response - 用于设置 no-store 的 HTTP 响应。
   * @returns 对话详情和消息数组。
   */
  @Get('conversations/:id')
  @ApiOperation({ summary: '获取大模型对话详情' })
  async conversationDetail(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.disableCache(response);
    return vbenSuccess(await this.conversations.detail(id));
  }

  /**
   * 仅软删除无活动回合的普通对话；业务绑定对话继续由所属任务管理。
   * @param id - 对话 Snowflake ID。
   * @returns 被删除的对话标识。
   */
  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除大模型对话' })
  async removeConversation(@Param('id') id: string) {
    return vbenSuccess(await this.conversations.remove(id));
  }

  /**
   * 以 POST SSE 发送用户消息，并在客户端断连时取消同一上游流。
   * @param id - 对话 Snowflake ID。
   * @param body - 用户消息、客户端幂等标识和当前模型。
   * @param request - 用于侦测客户端中止的请求。
   * @param response - 逐帧写入统一流事件的响应。
   */
  @Post('conversations/:id/messages/stream')
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOperation({ summary: '流式发送大模型消息' })
  async streamMessage(
    @Param('id') id: string,
    @Body() body: LlmConversationMessageStreamDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController();
    const stream = await this.conversations.prepareStream(
      id,
      body,
      abortController.signal,
    );
    let disconnected = false;
    let sequence = 0;
    const abort = () => {
      disconnected = true;
      abortController.abort();
    };
    request.once('aborted', abort);
    response.once('close', () => {
      if (!response.writableEnded) abort();
    });
    this.prepareStream(response);
    try {
      for await (const event of stream) {
        sequence += 1;
        await this.writeEvent(response, event.type, {
          ...event,
          sequence,
        });
      }
    } catch (error) {
      if (!disconnected && !abortController.signal.aborted) {
        sequence += 1;
        await this.writeEvent(response, 'error', {
          message: this.streamErrorMessage(error),
          sequence,
        });
      }
    } finally {
      request.removeListener('aborted', abort);
      if (!response.writableEnded) response.end();
    }
  }

  /**
   * 把 Express 响应切换为立即 flush 的无缓存 SSE 通道，并显式关闭代理缓冲。
   * @param response - 即将承载流事件的 Express 响应。
   */
  private prepareStream(response: Response) {
    response.status(HttpStatus.OK);
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  /**
   * 序列化单个统一事件并尊重 Node 响应背压。
   * @param response - 当前 SSE 响应。
   * @param event - 稳定事件名。
   * @param data - 不含凭据的事件数据。
   */
  private async writeEvent(
    response: Response,
    event: string,
    data: Record<string, unknown> | LlmConversationStreamEvent,
  ) {
    if (response.destroyed || response.writableEnded) return;
    const writable = response.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
    if (!writable) await this.waitForDrain(response);
  }

  /**
   * 在响应背压时等待 drain，并在连接关闭或报错时可靠结束等待。
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
   * 从 HttpException 或普通异常中提取安全短文本。
   * @param error - 流建立或消费阶段捕获的未知错误。
   * @returns 可放入 SSE error 事件的文本。
   */
  private streamErrorMessage(error: unknown) {
    if (error instanceof HttpException) {
      return normalizeVbenErrorText(error.getResponse(), '大模型流式请求失败');
    }
    return normalizeVbenErrorText(error, '大模型流式请求失败');
  }

  /**
   * 在普通 JSON 响应写入 no-store，避免连接状态与模型目录被浏览器或代理复用。
   * @param response - 当前 Express 响应。
   */
  private disableCache(response: Response) {
    response.setHeader('Cache-Control', 'no-store');
  }
}
