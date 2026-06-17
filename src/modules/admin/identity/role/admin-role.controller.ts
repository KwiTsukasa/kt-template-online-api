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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleService } from './admin-role.service';

@ApiTags('Admin - 角色管理')
@Controller('system/role')
@UseGuards(JwtAuthGuard)
export class AdminRoleController {
  /**
   * 初始化 AdminRoleController 实例。
   * @param roleService - roleService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly roleService: AdminRoleService) {}

  /**
   * 获取角色分页列表。
   * @param query - 查询参数 DTO；限定 Admin分页、搜索或详情查询条件。
   */
  @Get('list')
  @ApiOperation({ summary: '获取角色分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.roleService.getRoleList(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 新增角色。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Post()
  @ApiOperation({ summary: '新增角色' })
  async create(@Body() body: Record<string, any>) {
    return vbenSuccess(await this.roleService.createRole(body));
  }

  /**
   * 编辑角色。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑角色' })
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return vbenSuccess(await this.roleService.updateRole(id, body));
  }

  /**
   * 删除角色。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.roleService.deleteRole(id));
  }
}
