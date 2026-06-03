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
  constructor(private readonly userService: AdminUserService) {}

  @Get('list')
  @ApiOperation({ summary: '获取用户分页列表' })
  async list(@Query() query: Record<string, any>) {
    const page = await this.userService.getUserList(query);
    return vbenPage(page.items, page.total);
  }

  @Post()
  @ApiOperation({ summary: '新增用户' })
  async create(@Body() body: Record<string, any>) {
    return vbenSuccess(await this.userService.createUser(body));
  }

  @Put(':id')
  @ApiOperation({ summary: '编辑用户' })
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return vbenSuccess(await this.userService.updateUser(id, body));
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除用户' })
  async remove(
    @Param('id') id: string,
    @CurrentAdminUser() currentUser: AdminUser,
  ) {
    return vbenSuccess(await this.userService.deleteUser(id, currentUser?.id));
  }
}
