import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Component } from './component.entity';
import { ToolsService, type KtPage, type KtPageParams } from '@/common';
import { isNumber, omit, pick } from 'lodash';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';

@Injectable()
export class ComponentService {
  /**
   * 初始化 ComponentService 实例。
   * @param userRepository - 用户仓库依赖；影响 constructor 的返回值。
   * @param toolsService - ToolsService 依赖；影响 constructor 的返回值。
   * @param dictService - dictService 服务依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(Component)
    private readonly userRepository: Repository<Component>,
    private readonly toolsService: ToolsService,
    private readonly dictService: DictService,
  ) {}

  /**
   * 执行 Admin 平台配置流程。
   * @returns 异步完成后的 Admin 平台配置结果。
   */
  async all(): Promise<Component[]> {
    await this.dictService.refreshDecodeCache();

    const components = await this.userRepository
      .createQueryBuilder('component')
      .getMany();
    return components;
  }

  /**
   * 获取分页数据。
   * @param { pageNo, pageSize, ...args } - 解构的组件分页查询参数，用于拆出页码和页大小并把剩余筛选项传入查询条件。
   * @returns 异步完成后的 Admin 平台配置结果。
   */
  async page({
    pageNo,
    pageSize,
    ...args
  }: KtPageParams<Component>): Promise<KtPage<Component>> {
    await this.dictService.refreshDecodeCache();

    const hasOwnEntity = new Component();

    const [wheres, likes] = [['is_deleted'], ['name']] as Array<
      Array<keyof Component>
    >;

    const [likeWhereSql, likeWhereValue] =
      this.toolsService.getLikeWhere<Component>(
        'component',
        wheres,
        likes,
        pick({ ...args, is_deleted: false }, ...wheres, ...likes),
      );

    const [list, total] = await this.userRepository
      .createQueryBuilder('component')
      .select([
        'component.id',
        'component.name',
        'component.type',
        'component.componentType',
        'component.image',
        'component.createTime',
      ])
      .where(likeWhereSql, likeWhereValue)
      .andWhere(
        omit(
          pick(
            args,
            Object.keys(args).filter(
              (key) =>
                Object.hasOwn(hasOwnEntity, key) &&
                (isNumber(args[key]) ? true : !!args[key]),
            ),
          ),
          ...wheres,
          ...likes,
        ),
      )
      .skip((pageNo - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return this.toolsService.page<Component>(list, total);
  }

  /**
   * 保存数据。
   * @param component - component 输入；驱动 `userRepository.create()` 的 Admin步骤。
   * @returns 异步完成后的 Admin 平台配置结果。
   */
  async save(component: Component): Promise<Component> {
    const link = this.userRepository.create(component);
    const save = await this.userRepository.save(link);
    return save;
  }

  /**
   * 删除数据。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @returns Admin 平台配置清理后的状态。
   */
  async remove(id: string): Promise<boolean> {
    const link = await this.userRepository
      .createQueryBuilder('component')
      .update()
      .set({ is_deleted: true } as any)
      .where('id = :id', { id })
      .execute();

    return link.affected > 0;
  }

  /**
   * 更新数据。
   * @param component - component 输入；使用 `id` 字段生成结果。
   * @returns Admin 平台配置更新后的状态。
   */
  async update(component: Component): Promise<boolean> {
    const link = await this.userRepository
      .createQueryBuilder('component')
      .update()
      .set(component)
      .where('id = :id', { id: component.id })
      .execute();

    return link.affected > 0;
  }

  /**
   * 查找业务数据。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @returns Admin 平台配置查询结果。
   */
  async find(id: string): Promise<Component> {
    await this.dictService.refreshDecodeCache();

    const component = await this.userRepository
      .createQueryBuilder('component')
      .select([
        'component.id',
        'component.name',
        'component.type',
        'component.componentType',
        'component.image',
        'component.template',
        'component.createTime',
      ])
      .where('component.id = :id', {
        id,
      })
      .getOne();
    return component;
  }
}
