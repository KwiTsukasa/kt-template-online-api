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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminDept } from './admin-dept.entity';
import { AdminDeptService } from './admin-dept.service';

@ApiTags('Admin - 部门管理')
@Controller('system/dept')
@UseGuards(JwtAuthGuard)
export class AdminDeptController {
  /**
   * 初始化 AdminDeptController 实例。
   * @param deptService - deptService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly deptService: AdminDeptService) {}

  /**
   * 获取部门列表。
   */
  @Get('list')
  @ApiOperation({ summary: '获取部门列表' })
  async list() {
    return vbenSuccess(await this.deptService.getDeptList());
  }

  /**
   * 新增部门。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Post()
  @ApiOperation({ summary: '新增部门' })
  async create(@Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.createDept(body));
  }

  /**
   * 编辑部门。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Put(':id')
  @ApiOperation({ summary: '编辑部门' })
  async update(@Param('id') id: string, @Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.updateDept(id, body));
  }

  /**
   * 删除部门。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除部门' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.deptService.deleteDept(id));
  }
}
