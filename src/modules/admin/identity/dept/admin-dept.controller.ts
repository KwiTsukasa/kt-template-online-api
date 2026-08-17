import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminDept } from './admin-dept.entity';
import { AdminDeptService } from './admin-dept.service';

@ApiTags('Admin - 部门管理')
@Controller('system/dept')
@UseGuards(JwtAuthGuard)
export class AdminDeptController {
  constructor(private readonly deptService: AdminDeptService) {}

  /**
   * 从部门服务读取系统部门列表，并封装为 Vben 成功响应。
   * @returns `list` 对应。
   */
  @Get('list')
  @ApiOperation({ summary: '获取部门列表' })
  async list() {
    return vbenSuccess(await this.deptService.getDeptList());
  }

  /**
   * 根据`body`构造针对部门。
   * @param body - 用于针对部门的结构化输入。
   * @returns 针对部门。
   */
  @Post()
  @ApiOperation({ summary: '新增部门' })
  async create(@Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.createDept(body));
  }

  /**
   * 根据`id`、`body`更新针对部门。
   * @param id - 决定针对部门内容、边界或目标的 `id` 值。
   * @param body - 用于针对部门的结构化输入。
   * @returns 针对部门。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑部门' })
  async update(@Param('id') id: string, @Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.updateDept(id, body));
  }

  /**
   * 按`id`移除针对删除部门。
   * @param id - 决定针对删除部门内容、边界或目标的 `id` 值。
   * @returns 针对删除部门。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除部门' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.deptService.deleteDept(id));
  }
}
