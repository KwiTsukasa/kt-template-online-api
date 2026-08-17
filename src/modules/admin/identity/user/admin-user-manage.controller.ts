import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentAdminUser,
  TrustedCredentialTransportService,
  vbenPage,
  vbenSuccess,
} from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminUser } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@ApiTags('Admin - 用户管理')
@Controller('system/user')
@UseGuards(JwtAuthGuard)
export class AdminUserManageController {
  constructor(
    private readonly userService: AdminUserService,
    private readonly trustedCredentialTransportService: TrustedCredentialTransportService,
  ) {}

  /**
   * 根据参数 `query`，获取用户分页列表。
   * @param query - 限定根据参数 `query`，获取用户分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取用户分页列表。
   */
  @Get('list')
  @ApiOperation({ summary: '获取用户分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.userService.getUserList(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 根据`body`、`request`构造针对用户；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param body - 用于针对用户的结构化输入。
   * @param request - 用于针对用户的当前 HTTP 请求。
   * @returns 针对用户。
   */
  @Post()
  @ApiOperation({ summary: '新增用户' })
  async create(@Body() body: Record<string, any>, @Req() request: Request) {
    this.trustedCredentialTransportService.assertTrusted(request);
    return vbenSuccess(await this.userService.createUser(body));
  }

  /**
   * 根据`id`、`body`、`request`处理重置密码；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param id - 决定重置密码内容、边界或目标的 `id` 值。
   * @param body - 用于重置密码的结构化输入，包含 `password` 字段。
   * @param request - 用于重置密码的当前 HTTP 请求。
   * @returns 重置密码。
   */
  @Put(':id/password')
  @ApiOperation({ summary: '重置用户密码' })
  async resetPassword(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() request: Request,
  ) {
    this.trustedCredentialTransportService.assertTrusted(request);
    return vbenSuccess(
      await this.userService.resetUserPassword(id, body.password),
    );
  }

  /**
   * 根据`id`、`body`、`request`更新针对用户；先通过 `trustedCredentialTransportService.assertTrusted` 校验输入边界。
   * @param id - 决定针对用户内容、边界或目标的 `id` 值。
   * @param body - 用于针对用户的结构化输入。
   * @param request - 用于针对用户的当前 HTTP 请求。
   * @returns 针对用户。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑用户' })
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @Req() request: Request,
  ) {
    this.trustedCredentialTransportService.assertTrusted(request);
    return vbenSuccess(await this.userService.updateUser(id, body));
  }

  /**
   * 按`id`、`currentUser`移除针对删除用户。
   * @param id - 决定针对删除用户内容、边界或目标的 `id` 值。
   * @param currentUser - 用于针对删除用户的领域对象，包含 `id` 字段。
   * @returns 针对删除用户。
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
