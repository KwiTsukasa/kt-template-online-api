import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdminUser, vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('Admin - 用户管理')
@Controller('system/user')
@UseGuards(JwtAuthGuard)
export class AdminUserManageController {
  /**
   * 初始化 AdminUserManageController 实例。
   * @param userService - userService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly userService: AdminUserService) {}

  /**
   * 获取用户分页列表。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: '获取用户分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.userService.getUserList(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 新增用户。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Post()
  @ApiOperation({ summary: '新增用户' })
  async create(@Body() body: Record<string, any>) {
    return vbenSuccess(await this.userService.createUser(body));
  }

  /**
   * 编辑用户。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑用户' })
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return vbenSuccess(await this.userService.updateUser(id, body));
  }

  /**
   * 删除用户。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param currentUser - currentUser 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除用户' })
  async remove(
    @Param('id') id: string,
    @CurrentAdminUser() currentUser: AdminUser,
  ) {
    return vbenSuccess(await this.userService.deleteUser(id, currentUser?.id));
  }
}
