import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { vbenPage, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminNoticeBatchReadDto } from './admin-notice-batch-read.dto';
import { AdminNoticeQueryDto } from './admin-notice.dto';
import { AdminNoticeEventStreamService } from './admin-notice-event-stream.service';
import { AdminNoticeService } from './admin-notice.service';

@ApiTags('Admin - 站内信管理')
@Controller([
  'message-management/subscribers/station-notice/notices',
  'system/notice',
])
@UseGuards(JwtAuthGuard, AdminSuperGuard)
export class AdminNoticeController {
  constructor(
    private readonly noticeService: AdminNoticeService,
    private readonly eventStream: AdminNoticeEventStreamService,
  ) {}

  /**
   * 按请求头优先、查询参数兜底选择客户端游标，返回只广播事务提交后变化的鉴权 SSE。
   * @param lastEventIdHeader - 浏览器最后处理的站内信变更事件标识；首次连接时可省略。
   * @param lastEventIdQuery - 不能发送游标请求头时使用的查询参数兜底。
   * @returns 含首次快照提示、有限重放和心跳的站内信事件 Observable。
   */
  @Sse('events/stream')
  @ApiOperation({ summary: '订阅站内信实时变化' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }

  /**
   * 查询消息中心当前未读数量，供顶部铃铛初始化或事件后校准 Badge。
   * @returns 包含当前未读站内信数量的 Vben 成功响应。
   */
  @Get('unread-count')
  @ApiOperation({ summary: '查询站内信未读数量' })
  async unreadCount() {
    return vbenSuccess({ count: await this.noticeService.getUnreadCount() });
  }

  /**
   * 按分页、级别、类型与文本条件查询管理通知，并返回 Vben 分页结构。
   * @param query - 限定列表数据筛选、排序与分页范围的查询条件。
   * @returns 列表数据。
   */
  @Get('list')
  @ApiOperation({
    description:
      '查询站内信列表：分页、标题/内容模糊检索、级别、状态、置顶状态、通知用户过滤',
    summary: '查询站内信列表',
  })
  @ApiQuery({ name: 'pageNo', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  async list(@Query() query: AdminNoticeQueryDto) {
    const page = await this.noticeService.page(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 按站内信标识查询详情，并封装为 Vben 成功响应。
   * @param id - 决定详情内容、边界或目标的 `id` 值。
   * @returns 详情。
   */
  @Get('detail/:id')
  @ApiOperation({ summary: '查询站内信详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.noticeService.get(id));
  }

  /**
   * 按`id`移除针对删除站内信。
   * @param id - 决定针对删除站内信内容、边界或目标的 `id` 值。
   * @returns 针对删除站内信。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除站内信' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.noticeService.remove(id));
  }

  /**
   * 根据`id`、`status`处理启停站内信。
   * @param id - 决定启停站内信内容、边界或目标的 `id` 值。
   * @param status - 决定启停站内信内容、边界或目标的 `status` 值。
   * @returns 启停站内信。
   */
  @Post('toggle')
  @ApiOperation({ summary: '启停站内信' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'status', type: Number })
  async toggleStatus(@Query('id') id: string, @Query('status') status: string) {
    return vbenSuccess(await this.noticeService.toggleStatus(id, status));
  }

  /**
   * 把所选未读站内信一次更新为已读，并返回实际发生状态变化的数量。
   * @param body - 包含 1–100 个唯一站内信标识的批量已读请求。
   * @returns 实际从未读更新为已读的站内信数量。
   */
  @Post('read/batch')
  @ApiOperation({ summary: '批量标记站内信为已读' })
  @ApiBody({ type: AdminNoticeBatchReadDto })
  async markReadBatch(@Body() body: AdminNoticeBatchReadDto) {
    return vbenSuccess(await this.noticeService.markReadBatch(body.ids));
  }

  /**
   * 根据`id`、`isTop`处理置顶/取消站内信。
   * @param id - 决定置顶/取消站内信内容、边界或目标的 `id` 值。
   * @param isTop - 决定是否启用“Top”分支的布尔选项。
   * @returns 置顶/取消站内信。
   */
  @Post('top')
  @ApiOperation({ summary: '置顶/取消站内信' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'isTop', type: Number })
  async toggleTop(@Query('id') id: string, @Query('isTop') isTop: string) {
    return vbenSuccess(await this.noticeService.toggleTop(id, isTop));
  }
}
