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
  MediaGovernanceAgentConversationEventDto,
  MediaGovernanceAgentEventDto,
  MediaGovernanceAgentToolCallDto,
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
   * 接收 Agent 生命周期事件并交由治理服务校验落库。
   * @param body - 用于接收 Agent 生命周期事件并交由治理服务校验落库的结构化输入。
   * @returns 接收 Agent 生命周期事件并交由治理服务校验落库。
   */
  @Post('events')
  async event(@Body() body: MediaGovernanceAgentEventDto) {
    return this.service.applyAgentEvent(body);
  }

  /**
   * 接收 Agent 对话增量事件并更新实时投影。
   * @param body - 用于接收 Agent 对话增量事件并更新实时的结构化输入。
   * @returns 接收 Agent 对话增量事件并更新实时。
   */
  @Post('conversation-events')
  async conversationEvent(
    @Body() body: MediaGovernanceAgentConversationEventDto,
  ) {
    return this.service.applyAgentConversationEvent(body);
  }
}
