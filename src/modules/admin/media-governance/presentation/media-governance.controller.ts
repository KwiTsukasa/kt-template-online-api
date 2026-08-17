import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Param,
  Put,
  Query,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  MediaGovernanceMagnetSourceCreateDto,
  MediaGovernanceAgentMessageDto,
  MediaGovernanceAgentSessionQueryDto,
  MediaGovernanceOperatorDecisionDto,
  MediaGovernanceRevisionCommandDto,
  MediaGovernanceSourceClassificationDto,
  MediaGovernanceSourceSelectionDto,
  MediaGovernanceSubtitleContractDto,
  MediaGovernanceTaskCreateDto,
  MediaGovernanceTaskIdentityUpdateDto,
  MediaGovernanceTaskPageQueryDto,
} from '@/modules/admin/media-governance/contract/media-governance.dto';
import { MediaGovernanceService } from '@/modules/admin/media-governance/application/media-governance.service';
import { MediaGovernanceEventStreamService } from '@/modules/admin/media-governance/application/media-governance-event-stream.service';
import {
  MediaGovernancePermission,
  MediaGovernancePermissionGuard,
} from './media-governance-permission.guard';

@ApiTags('Admin - 媒体治理')
@Controller('media-governance/tasks')
@UseGuards(JwtAuthGuard, MediaGovernancePermissionGuard)
@MediaGovernancePermission('Media:Governance:List')
@UsePipes(
  new ValidationPipe({
    exceptionFactory: () =>
      new HttpException(
        {
          err: '请求参数不符合媒体治理合同',
          msg: '请求参数校验失败',
        },
        HttpStatus.BAD_REQUEST,
      ),
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class MediaGovernanceController {
  constructor(private readonly service: MediaGovernanceService) {}

  /** 分页返回媒体治理任务，并禁止客户端缓存动态状态。 */
  @Get('page')
  @ApiOperation({ summary: '分页查询媒体治理任务草稿' })
  page(
    @Query() query: MediaGovernanceTaskPageQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = this.service.page(query);
    return vbenPage(page.items, page.total);
  }

  /** 返回媒体治理全局语义统计，并禁止客户端缓存。 */
  @Get('summary')
  @ApiOperation({ summary: '查询媒体治理任务语义统计' })
  summary(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.service.summary());
  }

  /** 返回指定治理任务详情，并禁止客户端缓存。 */
  @Get(':taskId')
  @ApiOperation({ summary: '查询媒体治理任务详情' })
  detail(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(this.service.detail(taskId));
  }

  /** 创建媒体治理任务草稿并返回统一成功响应。 */
  @Post()
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '创建媒体治理任务草稿' })
  async create(
    @Body() body: MediaGovernanceTaskCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

  /** 在执行前修正任务的媒体身份和资料源引用。 */
  @Put(':taskId/identity')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '在下载前修正作品资料库身份' })
  async updateIdentity(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceTaskIdentityUpdateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.updateIdentity(taskId, body));
  }

  /** 按期望版本删除未执行草稿及其本地账本。 */
  @Delete(':taskId')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '删除未进入执行阶段的草稿并清除本地账本' })
  async discard(
    @Param('taskId') taskId: string,
    @Query() query: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.discardTask(taskId, query));
  }

  /** 添加磁力来源，并由服务层完成脱敏和描述符持久化。 */
  @Post(':taskId/sources/magnet')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '添加并脱敏保存磁链来源' })
  async addMagnetSource(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceMagnetSourceCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.addMagnetSource(taskId, body));
  }

  /** 接收有界种子文件并创建经安全解析的来源。 */
  @Post(':taskId/sources/torrent')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '上传并安全解析私有种子描述文件' })
  async addTorrentSource(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceSourceClassificationDto,
    @UploadedFile() file: { buffer: Buffer; size: number },
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.addTorrentSource(taskId, body, file));
  }

  /** 修订指定来源的内容角色和治理策略分类。 */
  @Put(':taskId/sources/:sourceId/classification')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '修订来源治理分类' })
  async updateSourceClassification(
    @Param('taskId') taskId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: MediaGovernanceSourceClassificationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.updateSourceClassification(taskId, sourceId, body),
    );
  }

  /** 按任务版本密封指定来源的文件选择与单元映射。 */
  @Put(':taskId/sources/:sourceId/selection')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '密封来源文件选择' })
  async updateSourceSelection(
    @Param('taskId') taskId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: MediaGovernanceSourceSelectionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.updateSourceSelection(taskId, sourceId, body),
    );
  }

  /** 请求精确清理指定来源后将其从任务移除。 */
  @Post(':taskId/sources/:sourceId/remove')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '精确清理并移除待更换来源' })
  async removeSource(
    @Param('taskId') taskId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.removeSource(taskId, sourceId, body));
  }

  /** 启动指定来源清单的受限检查。 */
  @Post(':taskId/sources/:sourceId/inspect')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '检查规范来源清单' })
  async inspectSource(
    @Param('taskId') taskId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.inspectSource(taskId, sourceId, body),
    );
  }

  /** 启动指定来源的有界运行时可用性探针。 */
  @Post(':taskId/sources/:sourceId/probe-runtime')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '执行有界运行时死种死链探针' })
  async probeRuntimeSource(
    @Param('taskId') taskId: string,
    @Param('sourceId') sourceId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.probeRuntimeSource(taskId, sourceId, body),
    );
  }

  /** 为治理单元绑定逐季单一发布组字幕合同。 */
  @Put(':taskId/units/:unitId/subtitle-contract')
  @MediaGovernancePermission('Media:Governance:SourceUpload')
  @ApiOperation({ summary: '绑定逐季单一发布组字幕合同' })
  async bindSubtitleContract(
    @Param('taskId') taskId: string,
    @Param('unitId') unitId: string,
    @Body() body: MediaGovernanceSubtitleContractDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.bindSubtitleContract(taskId, unitId, body),
    );
  }

  /** 启动或接管当前任务的隔离下载运行。 */
  @Post(':taskId/downloads/start')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '启动或接管失联的 NAS 任务隔离下载' })
  async startDownload(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.startDownload(taskId, body));
  }

  /** 暂停当前任务对应的下载运行。 */
  @Post(':taskId/downloads/pause')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '安全暂停当前 NAS 下载 Run' })
  async pauseDownload(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.pauseDownload(taskId, body));
  }

  /** 取消当前下载运行并保留后续精确清理所需载荷。 */
  @Post(':taskId/downloads/cancel')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '取消当前下载并保留待精确清理载荷' })
  async cancelDownload(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.cancelDownload(taskId, body));
  }

  /** 从同一运行身份恢复已暂停的下载。 */
  @Post(':taskId/downloads/resume')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '从同一 NAS 下载 Run 续传' })
  async resumeDownload(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.resumeDownload(taskId, body));
  }

  /** 启动密封计划约束下的本地治理事务。 */
  @Post(':taskId/governance/start')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '启动 Schema 1.2.0 本地治理事务' })
  async startGovernance(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.startGovernance(taskId, body));
  }

  /** 启动分档元数据核验运行。 */
  @Post(':taskId/metadata/verify')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '运行 A/B/C 分档元数据核验' })
  async startMetadataVerification(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.startMetadataVerification(taskId, body),
    );
  }

  /** 启动次数受限的确定性元数据修复运行。 */
  @Post(':taskId/metadata/repair')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '运行最多两次的确定性有界元数据修复' })
  async startMetadataRepair(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.startMetadataRepair(taskId, body));
  }

  /** 启动独立本地验收及残留检查运行。 */
  @Post(':taskId/acceptance/verify')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '运行独立本地验收与残留核验' })
  async startAcceptanceVerification(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.startAcceptanceVerification(taskId, body),
    );
  }

  /** 从当前未完成阶段启动受策略限制的 Codex Agent。 */
  @Post(':taskId/agent/start')
  @MediaGovernancePermission('Media:Governance:AgentStart')
  @ApiOperation({ summary: '从任意未完成阶段启动有界 CodexAgent 治理' })
  async startAgent(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.startAgent(taskId, body));
  }

  /** 拉取指定任务的 Agent 会话及对话增量投影。 */
  @Get(':taskId/agent/session')
  @ApiOperation({ summary: '查询 CodexAgent 语义会话投影' })
  async agentSession(
    @Param('taskId') taskId: string,
    @Query() query: MediaGovernanceAgentSessionQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.agentSession(taskId, query));
  }

  /** 在同一 Agent 线程中提交具备幂等标识的操作员消息。 */
  @Post(':taskId/agent/messages')
  @MediaGovernancePermission('Media:Governance:AgentOperate')
  @ApiOperation({ summary: '在同一 CodexAgent thread 继续发送操作员消息' })
  async agentMessage(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceAgentMessageDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.continueAgentConversation(taskId, body),
    );
  }

  /** 提交操作员对 Agent 候选方案的明确决策。 */
  @Post(':taskId/agent/operator-decision')
  @MediaGovernancePermission('Media:Governance:OperatorDecision')
  @ApiOperation({ summary: '提交 Agent 候选人工放行' })
  async operatorDecision(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceOperatorDecisionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.operatorDecision(taskId, body));
  }

  /** 返回指定任务的脱敏验收证据摘要。 */
  @Get(':taskId/evidence')
  @MediaGovernancePermission('Media:Governance:Evidence')
  @ApiOperation({ summary: '查询脱敏验收证据摘要' })
  evidence(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(this.service.evidence(taskId));
  }

  /** 为动态治理响应设置禁止缓存头。 */
  private noStore(response: Response) {
    response.setHeader('Cache-Control', 'no-store');
  }
}

@ApiTags('Admin - 媒体治理')
@Controller('media-governance/events')
@UseGuards(JwtAuthGuard, MediaGovernancePermissionGuard)
@MediaGovernancePermission('Media:Governance:List')
export class MediaGovernanceEventsController {
  constructor(
    private readonly eventStream: MediaGovernanceEventStreamService,
  ) {}

  /** 依据请求头或查询游标订阅可重放的治理事件流。 */
  @Sse('stream')
  @ApiOperation({ summary: '订阅媒体治理任务语义进度' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }
}
