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
  /**
   * 初始化 AdminMenuController 实例。
   * @param menuService - menuService 服务依赖；影响 constructor 的返回值。
   */
  constructor(private readonly menuService: AdminMenuService) {}

  /**
   * 获取当前用户路由菜单。
   * @param user - user 输入；驱动 `vbenSuccess()` 的 Admin步骤。
   */
  @Get('menu/all')
  @ApiOperation({ summary: '获取当前用户路由菜单' })
  async all(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getRouteMenus(user));
  }

  /**
   * 获取系统菜单列表。
   */
  @Get('system/menu/list')
  @ApiOperation({ summary: '获取系统菜单列表' })
  async list() {
    return vbenSuccess(await this.menuService.getMenuList());
  }

  /**
   * 校验菜单名称是否存在。
   * @param name - 名称文本；驱动 `vbenSuccess()` 的 Admin步骤。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Get('system/menu/name-exists')
  @ApiOperation({ summary: '校验菜单名称是否存在' })
  async nameExists(@Query('name') name: string, @Query('id') id?: string) {
    return vbenSuccess(await this.menuService.isMenuNameExists(name, id));
  }

  /**
   * 校验菜单路径是否存在。
   * @param path - 路由或文件路径；驱动 `vbenSuccess()` 的 Admin步骤。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Get('system/menu/path-exists')
  @ApiOperation({ summary: '校验菜单路径是否存在' })
  async pathExists(@Query('path') path: string, @Query('id') id?: string) {
    return vbenSuccess(await this.menuService.isMenuPathExists(path, id));
  }

  /**
   * 新增系统菜单。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Post('system/menu')
  @ApiOperation({ summary: '新增系统菜单' })
  async create(@Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.createMenu(body));
  }

  /**
   * 编辑系统菜单。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param body - 请求体 DTO；承载 Admin新增、更新、导入或执行字段。
   */
  @Put('system/menu/:id')
  @ApiOperation({ summary: '编辑系统菜单' })
  async update(@Param('id') id: string, @Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.updateMenu(id, body));
  }

  /**
   * 删除系统菜单。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   */
  @Delete('system/menu/:id')
  @ApiOperation({ summary: '删除系统菜单' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.menuService.deleteMenu(id));
  }
}
