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
import { vbenPage, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminRoleService } from './admin-role.service';

@ApiTags('Admin - 角色管理')
@Controller('system/role')
@UseGuards(JwtAuthGuard)
export class AdminRoleController {
  constructor(private readonly roleService: AdminRoleService) {}

  /**
   * 根据参数 `query`，获取角色分页列表。
   * @param query - 限定根据参数 `query`，获取角色分页列表筛选、排序与分页范围的查询条件。
   * @returns 根据参数 `query`，获取角色分页列表。
   */
  @Get('list')
  @ApiOperation({ summary: '获取角色分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.roleService.getRoleList(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 根据`body`构造针对角色。
   * @param body - 用于针对角色的结构化输入。
   * @returns 针对角色。
   */
  @Post()
  @ApiOperation({ summary: '新增角色' })
  async create(@Body() body: Record<string, any>) {
    return vbenSuccess(await this.roleService.createRole(body));
  }

  /**
   * 根据`id`、`body`更新针对角色。
   * @param id - 决定针对角色内容、边界或目标的 `id` 值。
   * @param body - 用于针对角色的结构化输入。
   * @returns 针对角色。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑角色' })
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return vbenSuccess(await this.roleService.updateRole(id, body));
  }

  /**
   * 按`id`移除针对删除角色。
   * @param id - 决定针对删除角色内容、边界或目标的 `id` 值。
   * @returns 针对删除角色。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.roleService.deleteRole(id));
  }
}
