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
  constructor(private readonly deptService: AdminDeptService) {}

  @Get('list')
  @ApiOperation({ summary: '获取部门列表' })
  async list() {
    return vbenSuccess(await this.deptService.getDeptList());
  }

  @Post()
  @ApiOperation({ summary: '新增部门' })
  async create(@Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.createDept(body));
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑部门' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<AdminDept>,
  ) {
    return vbenSuccess(await this.deptService.updateDept(id, body));
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除部门' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.deptService.deleteDept(id));
  }
}
