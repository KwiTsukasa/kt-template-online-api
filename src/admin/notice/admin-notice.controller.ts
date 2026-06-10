import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  CurrentAdminUser,
  vbenPage,
  vbenSuccess,
} from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from '../user/admin-user.entity';
import {
  AdminNoticeBodyDto,
  AdminNoticeQueryDto,
  AdminNoticeUpdateDto,
} from './admin-notice.dto';
import { AdminNoticeService } from './admin-notice.service';

@ApiTags('Admin - 站内信管理')
@Controller('system/notice')
@UseGuards(JwtAuthGuard)
export class AdminNoticeController {
  constructor(private readonly noticeService: AdminNoticeService) {}

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

  @Get('detail/:id')
  @ApiOperation({ summary: '查询站内信详情' })
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.noticeService.get(id));
  }

  @Post('save')
  @ApiOperation({ summary: '新增站内信' })
  async save(
    @Body() body: AdminNoticeBodyDto,
    @CurrentAdminUser() currentUser: AdminUser,
  ) {
    return vbenSuccess(
      await this.noticeService.create(body, currentUser?.id),
    );
  }

  @Post('update')
  @ApiOperation({ summary: '编辑站内信' })
  async update(@Body() body: AdminNoticeUpdateDto) {
    return vbenSuccess(await this.noticeService.update(body));
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除站内信' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.noticeService.remove(id));
  }

  @Post('toggle')
  @ApiOperation({ summary: '启停站内信' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'status', type: Number })
  async toggleStatus(@Query('id') id: string, @Query('status') status: string) {
    return vbenSuccess(await this.noticeService.toggleStatus(id, status));
  }

  @Post('top')
  @ApiOperation({ summary: '置顶/取消站内信' })
  @ApiQuery({ name: 'id', type: String })
  @ApiQuery({ name: 'isTop', type: Number })
  async toggleTop(@Query('id') id: string, @Query('isTop') isTop: string) {
    return vbenSuccess(await this.noticeService.toggleTop(id, isTop));
  }
}
