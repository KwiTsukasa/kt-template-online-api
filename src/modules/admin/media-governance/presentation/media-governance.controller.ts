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
  MediaGovernanceRevisionCommandDto,
  MediaGovernanceSourceClassificationDto,
  MediaGovernanceSourceSelectionDto,
  MediaGovernanceSubtitleContractDto,
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

  /**
   * 分页返回媒体治理任务，并禁止客户端缓存动态状态。
   * @param query - 限定分页结果筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 分页。
   */
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

  /**
   * 返回媒体治理全局语义统计，并禁止客户端缓存。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 摘要。
   */
  @Get('summary')
  @ApiOperation({ summary: '查询媒体治理任务语义统计' })
  summary(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.service.summary());
  }

  /**
   * 返回指定治理任务详情，并禁止客户端缓存。
   * @param taskId - 用于精确定位任务的标识。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 详情。
   */
  @Get(':taskId')
  @ApiOperation({ summary: '查询媒体治理任务详情' })
  detail(
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(this.service.detail(taskId));
  }

  /**
   * 按期望版本删除未执行草稿及其本地账本。
   * @param taskId - 用于精确定位任务的标识。
   * @param query - 限定按期望版本删除未执行草稿及其本地账本筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 按期望版本删除未执行草稿及其本地账本。
   */
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

  /**
   * 添加磁力来源，并由服务层完成脱敏和描述符持久化。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于Magnet来源的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns Magnet来源。
   */
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

  /**
   * 接收有界种子文件并创建经安全解析的来源。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于接收有界种子文件并创建经安全解析的来源的结构化输入。
   * @param file - 决定接收有界种子文件并创建经安全解析的来源内容、边界或目标的 `file` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 接收有界种子文件并创建经安全解析的来源。
   */
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

  /**
   * 根据参数 `taskId`，修订指定来源的内容角色和治理策略分类。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param body - 用于根据参数 `taskId`，修订指定来源的内容角色和治理策略分类的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 根据参数 `taskId`，修订指定来源的内容角色和治理策略分类。
   */
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

  /**
   * 按任务版本密封指定来源的文件选择与单元映射。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param body - 用于按任务版本密封指定来源的文件选择与单元映射的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 按任务版本密封指定来源的文件选择与单元映射。
   */
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

  /**
   * 按`taskId`、`sourceId`、`body`移除精确清理指定来源后将其从任务移除。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param body - 用于精确清理指定来源后将其从任务移除的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 精确清理指定来源后将其从任务移除。
   */
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

  /**
   * 根据`taskId`、`sourceId`、`body`处理指定来源清单的受限检查。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param body - 用于指定来源清单的受限检查的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 指定来源清单的受限检查。
   */
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

  /**
   * 根据`taskId`、`sourceId`、`body`处理指定来源的有界运行时可用性探针。
   * @param taskId - 用于精确定位任务的标识。
   * @param sourceId - 用于精确定位来源的标识。
   * @param body - 用于指定来源的有界运行时可用性探针的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 指定来源的有界运行时可用性探针。
   */
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

  /**
   * 为治理单元绑定逐季单一发布组字幕合同。
   * @param taskId - 用于精确定位任务的标识。
   * @param unitId - 用于精确定位unit的标识。
   * @param body - 用于为治理单元绑定逐季单一发布组字幕合同的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 为治理单元绑定逐季单一发布组字幕合同。
   */
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

  /**
   * 禁止响应缓存后提交隔离下载启动或接管请求，并封装服务返回的运行状态。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于下载任务的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 下载任务。
   */
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

  /**
   * 暂停当前任务对应的下载运行。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于暂停当前任务对应的下载运行的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 暂停当前任务对应的下载运行。
   */
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

  /**
   * 取消当前下载运行并保留后续精确清理所需载荷。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于当前下载运行并保留后续精确清理所需载荷的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 满足当前下载运行并保留后续精确清理所需载荷约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
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

  /**
   * 将同一入口映射为存活 runner 的继续控制，或失联 closeout 后复用原载荷的新恢复信封。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 携带当前 Task revision 的下载继续或失联恢复命令。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 已接受同 Run 继续控制或已派发新恢复 Run 的任务状态。
   */
  @Post(':taskId/downloads/resume')
  @MediaGovernancePermission('Media:Governance:Download')
  @ApiOperation({ summary: '继续 NAS 下载或从失联 Run 恢复' })
  async resumeDownload(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.resumeDownload(taskId, body));
  }

  /**
   * 把客户端读取的任务版本交给服务层，原子派发旧目录到当前 TMDB 规范根的事务。
   * @param taskId - 用于精确定位待恢复任务的标识。
   * @param body - 携带调用方已读取任务版本的并发控制输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 已派发规范身份重排运行的最新任务状态。
   */
  @Post(':taskId/governance/identity-rebase')
  @MediaGovernancePermission('Media:Governance:Run')
  @ApiOperation({ summary: '重排已提交文件到当前规范身份目录' })
  async startCanonicalIdentityRebase(
    @Param('taskId') taskId: string,
    @Body() body: MediaGovernanceRevisionCommandDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.startCanonicalIdentityRebase(taskId, body),
    );
  }

  /**
   * 禁止响应缓存后提交密封计划约束下的本地治理事务，并封装运行状态。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于治理任务的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 治理任务。
   */
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

  /**
   * 禁止响应缓存后提交独立本地验收与残留检查，并封装运行状态。
   * @param taskId - 用于精确定位任务的标识。
   * @param body - 用于验收验证状态的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 验收验证状态。
   */
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

  /**
   * 按规范字段顺序计算指定任务的脱敏验收证据摘要。
   * @param taskId - 用于精确定位任务的标识。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 按规范字段顺序计算指定任务的脱敏验收证据摘要。
   */
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

  /**
   * 向动态治理响应写入禁止缓存头，确保浏览器或中间代理不复用状态。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   */
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

  /**
   * 建立媒体治理 SSE 订阅，并禁止浏览器和 Nginx 缓冲实时事件。
   *
   * @param response - 当前 SSE 响应，用于写入禁止缓存与代理缓冲头。
   * @param lastEventIdHeader - 浏览器重连时通过 `Last-Event-ID` 发送的续传游标。
   * @param lastEventIdQuery - 无法设置请求头时通过查询参数发送的续传游标。
   * @returns 合并历史重放、实时任务增量与定时心跳的事件流。
   */
  @Sse('stream')
  @ApiOperation({ summary: '订阅媒体治理任务与系列目录语义事件' })
  stream(
    @Res({ passthrough: true }) response: Response,
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Accel-Buffering', 'no');
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }
}
