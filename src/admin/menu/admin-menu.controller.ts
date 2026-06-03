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
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminUser } from '../user/admin-user.entity';
import { AdminMenu } from './admin-menu.entity';
import { AdminMenuService } from './admin-menu.service';

@ApiTags('Admin - 菜单管理')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminMenuController {
  constructor(private readonly menuService: AdminMenuService) {}

  @Get('menu/all')
  @ApiOperation({ summary: '获取当前用户路由菜单' })
  async all(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getRouteMenus(user));
  }

  @Get('system/menu/list')
  @ApiOperation({ summary: '获取系统菜单列表' })
  async list() {
    return vbenSuccess(await this.menuService.getMenuList());
  }

  @Get('system/menu/name-exists')
  @ApiOperation({ summary: '校验菜单名称是否存在' })
  async nameExists(
    @Query('name') name: string,
    @Query('id') id?: string,
  ) {
    return vbenSuccess(await this.menuService.isMenuNameExists(name, id));
  }

  @Get('system/menu/path-exists')
  @ApiOperation({ summary: '校验菜单路径是否存在' })
  async pathExists(
    @Query('path') path: string,
    @Query('id') id?: string,
  ) {
    return vbenSuccess(await this.menuService.isMenuPathExists(path, id));
  }

  @Post('system/menu')
  @ApiOperation({ summary: '新增系统菜单' })
  async create(@Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.createMenu(body));
  }

  @Put('system/menu/:id')
  @ApiOperation({ summary: '编辑系统菜单' })
  async update(
    @Param('id') id: string,
    @Body() body: Partial<AdminMenu>,
  ) {
    return vbenSuccess(await this.menuService.updateMenu(id, body));
  }

  @Delete('system/menu/:id')
  @ApiOperation({ summary: '删除系统菜单' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.menuService.deleteMenu(id));
  }
}
