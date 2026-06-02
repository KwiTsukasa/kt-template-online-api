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
import { ApiTags } from '@nestjs/swagger';
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
  async all(@CurrentAdminUser() user: AdminUser) {
    return vbenSuccess(await this.menuService.getRouteMenus(user));
  }

  @Get('system/menu/list')
  async list() {
    return vbenSuccess(await this.menuService.getMenuList());
  }

  @Get('system/menu/name-exists')
  async nameExists(
    @Query('name') name: string,
    @Query('id') id?: string,
  ) {
    return vbenSuccess(await this.menuService.isMenuNameExists(name, id));
  }

  @Get('system/menu/path-exists')
  async pathExists(
    @Query('path') path: string,
    @Query('id') id?: string,
  ) {
    return vbenSuccess(await this.menuService.isMenuPathExists(path, id));
  }

  @Post('system/menu')
  async create(@Body() body: Partial<AdminMenu>) {
    return vbenSuccess(await this.menuService.createMenu(body));
  }

  @Put('system/menu/:id')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<AdminMenu>,
  ) {
    return vbenSuccess(await this.menuService.updateMenu(id, body));
  }

  @Delete('system/menu/:id')
  async remove(@Param('id') id: string) {
    return vbenSuccess(await this.menuService.deleteMenu(id));
  }
}
