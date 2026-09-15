import { Body, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { vbenSuccess } from '@/common';
import { AutomationAction } from './automation-permission.guard';
import {
  validateDefinitionInput,
  type DefinitionRepository,
} from './definition.repository';
import type { DefinitionWrite } from './definition.types';
import { publishedReference } from './definition.types';

export abstract class DefinitionController<T> {
  constructor(
    protected readonly definitions: DefinitionRepository<T>,
    private readonly checkReferences: (definition: T) => Promise<void>,
  ) {}

  /**
   * 返回当前控制器绑定资源的草稿分页，供其独立管理列表读取。
   * @param query - 名称搜索与分页条件。
   * @returns Vben 分页响应。
   */
  @Get('page')
  @AutomationAction('List')
  async page(@Query() query: Record<string, unknown>) {
    return vbenSuccess(await this.definitions.page(query));
  }

  /**
   * 新建当前资源的基本信息和初始草稿，为二级设计页面提供稳定身份。
   * @param body - 资源名称、说明和初始定义。
   * @returns 新草稿的身份与编辑版本。
   */
  @Post()
  @HttpCode(200)
  @AutomationAction('Edit')
  async create(@Body() body: DefinitionWrite) {
    return vbenSuccess(await this.definitions.create(body));
  }

  /**
   * 按 URL 中的资源身份恢复草稿与编辑版本，支持设计页面直接访问。
   * @param id - 当前资源的稳定标识。
   * @returns 草稿详情。
   */
  @Get(':id')
  @AutomationAction('List')
  async detail(@Param('id') id: string) {
    return vbenSuccess(await this.definitions.detail(id));
  }

  /**
   * 使用请求中的编辑版本更新草稿，版本冲突由存储边界统一拒绝。
   * @param id - 正在编辑的资源。
   * @param body - 完整草稿及 expectedRevision。
   * @returns 保存后的草稿与新编辑版本。
   */
  @Post(':id/draft')
  @HttpCode(200)
  @AutomationAction('Edit')
  async update(@Param('id') id: string, @Body() body: DefinitionWrite) {
    return vbenSuccess(await this.definitions.update(id, body));
  }

  /**
   * 经拥有者检查依赖后发布不可变版本，后续修改仍保存到草稿。
   * @param id - 当前资源标识。
   * @param body - 发布者最后读取的草稿版本。
   * @returns 发布版本和更新后的编辑版本。
   */
  @Post(':id/publish')
  @HttpCode(200)
  @AutomationAction('Publish')
  async publish(
    @Param('id') id: string,
    @Body() body: { expectedRevision: number },
  ) {
    return vbenSuccess(
      await this.definitions.publish(
        id,
        body?.expectedRevision,
        this.checkReferences,
      ),
    );
  }

  /**
   * 读取当前资源的发布历史，使消费者明确选择固定版本。
   * @param id - 当前资源标识。
   * @returns 已发布版本记录。
   */
  @Get(':id/versions')
  @AutomationAction('List')
  async versions(@Param('id') id: string) {
    return vbenSuccess(await this.definitions.versions(id));
  }

  /**
   * 直接读取指定发布版本，历史实例不会受版本目录分页范围影响。
   * @param id - 当前资源的稳定身份。
   * @param version - 已发布版本编号。
   * @returns 不可变的资源定义。
   */
  @Get(':id/versions/:version')
  @AutomationAction('List')
  async published(@Param('id') id: string, @Param('version') version: string) {
    const reference = validateDefinitionInput(() =>
      publishedReference({ id, version: Number(version) }),
    );
    return vbenSuccess(await this.definitions.published(reference));
  }
}
