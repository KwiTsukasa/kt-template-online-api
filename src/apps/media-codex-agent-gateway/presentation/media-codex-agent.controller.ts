import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { MediaCodexAgentGatewayService } from '../application/media-codex-agent-gateway.service';
import { MEDIA_CODEX_AGENT_POLICY_VERSION } from '../domain/media-codex-agent.contract';
import { MediaCodexAgentInternalGuard } from './media-codex-agent-internal.guard';
import {
  MediaCodexAgentSessionQueryDto,
  MediaCodexAgentTurnRequestDto,
} from './media-codex-agent.dto';

@Controller('internal/media-codex-agent')
@UseGuards(MediaCodexAgentInternalGuard)
export class MediaCodexAgentController {
  constructor(private readonly service: MediaCodexAgentGatewayService) {}

  /**
   * 汇总网关及依赖就绪状态，并公开固定的安全边界声明。
   * @returns 包含 `appServerReady`、`appServerTransport`、`loginStateExposed`、`policyVersion`、`rawProtocolExposed` 字段的健康状态。
   * @throws 当 `service.health` 调用失败时拒绝当前输入并抛出 `ServiceUnavailableException`。
   */
  @Get('health')
  async health() {
    let readiness;
    try {
      readiness = await this.service.health();
    } catch {
      throw new ServiceUnavailableException(
        'media-codex-agent-dependency-unavailable',
      );
    }
    return {
      ...readiness,
      appServerReady: true,
      appServerTransport: 'unix',
      loginStateExposed: false,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      rawProtocolExposed: false,
      status: 'ready',
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    };
  }

  /**
   * 根据路径与请求体的任务身份一致性校验结果启动受管 Agent 回合。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于回合的结构化输入，包含 `taskId` 字段。
   * @returns 回合。
   * @throws 当 `taskId !== body.taskId` 成立时拒绝当前输入并抛出 `ConflictException`。
   */
  @Post('tasks/:taskId/turns')
  async startTurn(
    @Param('taskId') taskId: string,
    @Body() body: MediaCodexAgentTurnRequestDto,
  ) {
    if (taskId !== body.taskId) {
      throw new ConflictException('media-codex-agent-task-identity-mismatch');
    }
    return this.service.startTurn(body);
  }

  /**
   * 查询指定任务的安全会话投影，并在不存在时返回明确错误。
   * @param taskId - 用于精确定位任务的标识。
   * @param query - 限定媒体 Codex Agent 回合会话筛选、排序与分页范围的查询条件，包含 `afterSequence`、`limit` 字段。
   * @returns 媒体 Codex Agent 回合会话。
   * @throws 当 `!session` 成立时拒绝当前输入并抛出 `NotFoundException`。
   */
  @Get('tasks/:taskId/session')
  async session(
    @Param('taskId') taskId: string,
    @Query() query: MediaCodexAgentSessionQueryDto,
  ) {
    const session = await this.service.session(
      taskId,
      query.afterSequence,
      query.limit,
    );
    if (!session) {
      throw new NotFoundException('media-codex-agent-session-not-found');
    }
    return session;
  }
}
