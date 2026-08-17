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
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { AdminUser } from '../user/admin-user.entity';
import { AdminMenu } from './admin-menu.entity';
import { AdminMenuService } from './admin-menu.service';

@ApiTags('Admin - 菜单管理')
@Controller()
@UseGuards(JwtAuthGuard)
export class AdminMenuController {
  constructor(private readonly menuService: AdminMenuService) {}

  /**
   * 获取当前用户路由菜单。
   * @param user - 决定是否启用“用户”分支的布尔选项。
   * @returns 当前用户路由菜单。
   */
  @Get('menu/all')
  @ApiOperation({ summary: '获取当前用户路由菜单' })
  async all(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getRouteMenus(user));
  }

  /**
   * 根据当前领域状态，获取系统菜单列表。
   * @returns 根据当前领域状态，获取系统菜单列表。
   */
  @Get('system/menu/list')
  @ApiOperation({ summary: '获取系统菜单列表' })
  async list() {
    return vbenSuccess(await this.menuService.getMenuList());
  }

  /**
   * 按参数 `name`，校验菜单名称是否存在。
   * @param name - 决定按参数 `name`，校验菜单名称是否存在内容、边界或目标的 `name` 值。
   * @param id - 决定按参数 `name`，校验菜单名称是否存在内容、边界或目标的 `id` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按参数 `name`，校验菜单名称是否存在。
   */
  @Get('system/menu/name-exists')
  @ApiOperation({ summary: '校验菜单名称是否存在' })
  async nameExists(@Query('name') name: string, @Query('id') id?: string) {
    return vbenSuccess(await this.menuService.isMenuNameExists(name, id));
  }

  /**
   * 按参数 `path`，校验菜单路径是否存在。
   * @param path - 必须保持在受控根目录内的路径。
   * @param id - 决定按参数 `path`，校验菜单路径是否存在内容、边界或目标的 `id` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 按参数 `path`，校验菜单路径是否存在。
   */
  @Get('system/menu/path-exists')
  @ApiOperation({ summary: '校验菜单路径是否存在' })
  async pathExists(@Query('path') path: string, @Query('id') id?: string) {
    return vbenSuccess(await this.menuService.isMenuPathExists(path, id));
  }

  /**
   * 根据`body`构造针对系统菜单。
   * @param body - 用于针对系统菜单的结构化输入。
   * @returns 针对系统菜单。
   */
  @Post('system/menu')
  @ApiOperation({ summary: '新增系统菜单' })
  async create(@Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.createMenu(body));
  }

  /**
   * 根据`id`、`body`更新针对系统菜单。
   * @param id - 决定针对系统菜单内容、边界或目标的 `id` 值。
   * @param body - 用于针对系统菜单的结构化输入。
   * @returns 针对系统菜单。
   */
  @Put('system/menu/:id')
  @ApiOperation({ summary: '编辑系统菜单' })
  async update(@Param('id') id: string, @Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.updateMenu(id, body));
  }

  /**
   * 按`id`移除针对删除系统菜单。
   * @param id - 决定针对删除系统菜单内容、边界或目标的 `id` 值。
   * @returns 针对删除系统菜单。
   */
  @Delete('system/menu/:id')
  @ApiOperation({ summary: '删除系统菜单' })
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.menuService.deleteMenu(id));
  }
}
