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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import {
  MediaGovernanceMagnetSourceCreateDto,
  MediaGovernanceOperatorDecisionDto,
  MediaGovernanceRevisionCommandDto,
  MediaGovernanceSourceClassificationDto,
  MediaGovernanceSourceSelectionDto,
  MediaGovernanceSubtitleContractDto,
  MediaGovernanceTaskCreateDto,
  MediaGovernanceTaskIdentityUpdateDto,
  MediaGovernanceTaskPageQueryDto,
} from './media-governance.dto';
import { MediaGovernanceService } from './media-governance.service';
import { MediaGovernanceEventStreamService } from './media-governance-event-stream.service';
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

  @Get('summary')
  @ApiOperation({ summary: '查询媒体治理任务语义统计' })
  summary(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.service.summary());
  }

  @Get(':taskId')
  @ApiOperation({ summary: '查询媒体治理任务详情' })
  detail(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(this.service.detail(taskId));
  }

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

  @Delete(':taskId')
  @MediaGovernancePermission('Media:Governance:Create')
  @ApiOperation({ summary: '放弃尚未开始且没有来源的任务草稿' })
  async discard(
    @Param('taskId') taskId: string,
    @Query() query: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.discardTask(taskId, query));
  }

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

  @Post(':taskId/agent/start')
  @MediaGovernancePermission('Media:Governance:AgentStart')
  @ApiOperation({ summary: '启动有界 CodexAgent 人工治理' })
  async startAgent(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.startAgent(taskId, body));
  }

  @Get(':taskId/agent/session')
  @ApiOperation({ summary: '查询 CodexAgent 语义会话投影' })
  async agentSession(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.agentSession(taskId));
  }

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

  @Sse('stream')
  @ApiOperation({ summary: '订阅媒体治理任务语义进度' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }
}
