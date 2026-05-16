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
import { ApiTags } from '@nestjs/swagger';
import { vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminDept } from './admin-dept.entity';
import { AdminDeptService } from './admin-dept.service';

@ApiTags('admin-dept')
@Controller('system/dept')
@UseGuards(JwtAuthGuard)
export class AdminDeptController {
  constructor(private readonly deptService: AdminDeptService) {}

  @Get('list')
  async list() {
    return vbenSuccess(await this.deptService.getDeptList());
  }

  @Post()
  async create(@Body() body: Partial<AdminDept>) {
    return vbenSuccess(await this.deptService.createDept(body));
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<AdminDept>,
  ) {
    return vbenSuccess(await this.deptService.updateDept(id, body));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.deptService.deleteDept(id));
  }
}
