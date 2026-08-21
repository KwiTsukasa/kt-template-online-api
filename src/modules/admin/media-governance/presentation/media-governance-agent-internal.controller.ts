import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  MediaGovernanceAgentToolCallDto,
  MediaGovernanceLlmConversationContextDto,
  MediaGovernanceLlmConversationResultDto,
  MediaGovernanceLlmProviderThreadBindDto,
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import { MediaGovernanceAgentInternalGuard } from './media-governance-agent-internal.guard';
import { MediaGovernanceService } from '@/modules/admin/media-governance/application/media-governance.service';

@Controller('internal/media-governance/agent')
@UseGuards(MediaGovernanceAgentInternalGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class MediaGovernanceAgentInternalController {
  constructor(private readonly service: MediaGovernanceService) {}

  /**
   * 返回 Agent 回调入口的健康状态及固定零写边界。
   * @returns 包含 `writeBoundaries` 字段的Agent 回调入口的健康状态及固定零写边界。
   */
  @Get('health')
  health() {
    return {
      ...this.service.agentCallbackHealth(),
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    };
  }

  /**
   * 接收并执行通过内部鉴权的 Agent 工具调用。
   * @param body - 用于接收并执行通过内部鉴权的 Agent 工具调用的结构化输入。
   * @returns 接收并执行通过内部鉴权的 Agent 工具调用。
   */
  @Post('tool-calls')
  async toolCall(@Body() body: MediaGovernanceAgentToolCallDto) {
    return this.service.agentToolCall(body);
  }

  /**
   * 为已绑定的 LLM 对话生成当前媒体任务回合上下文。
   * @param body - 对话、任务、模型和本轮用户消息。
   * @returns 可交给 App Server 的任务边界请求。
   */
  @Post('llm-conversations/context')
  async llmConversationContext(
    @Body() body: MediaGovernanceLlmConversationContextDto,
  ) {
    return this.service.llmConversationContext(body);
  }

  /**
   * 在活动 LLM 回合启动前把 App Server thread 通过数据库 CAS 绑定到唯一标准对话。
   * @param body - 对话、任务、旧线程比较值与 App Server 实际线程。
   * @returns 绑定完成后的权威对话身份。
   */
  @Post('llm-conversations/provider-thread')
  async bindLlmProviderThread(
    @Body() body: MediaGovernanceLlmProviderThreadBindDto,
  ) {
    return this.service.bindLlmConversationProviderThread(body);
  }

  /**
   * 接收 LLM 对话最终结构化治理结果并更新媒体任务投影。
   * @param body - 对话、任务及严格结构化结果。
   * @returns 结果应用状态。
   */
  @Post('llm-conversations/result')
  async llmConversationResult(
    @Body() body: MediaGovernanceLlmConversationResultDto,
  ) {
    return this.service.applyLlmConversationResult(body);
  }
}
