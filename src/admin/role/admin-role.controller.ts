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
  constructor(private readonly roleService: AdminRoleService) {}

  @Get('list')
  @ApiOperation({ summary: '获取角色分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.roleService.getRoleList(query);
    return vbenPage(page.items, page.total);
  }

  @Post()
  @ApiOperation({ summary: '新增角色' })
  async create(@Body() body: Record<string, any>) {
    return vbenSuccess(await this.roleService.createRole(body));
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑角色' })
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return vbenSuccess(await this.roleService.updateRole(id, body));
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.roleService.deleteRole(id));
  }
}
