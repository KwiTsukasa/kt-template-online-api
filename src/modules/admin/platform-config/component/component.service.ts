import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Component } from './component.entity';
import { ToolsService, type KtPage, type KtPageParams } from '@/common';
import { isNumber, omit, pick } from 'lodash';
import { DictService } from '@/modules/admin/platform-config/dict/dict.service';

@Injectable()
export class ComponentService {
  constructor(
    @InjectRepository(Component)
    private readonly userRepository: Repository<Component>,
    private readonly toolsService: ToolsService,
    private readonly dictService: DictService,
  ) {}

  /**
   * 根据当前运行态处理`all` 对应结果；把变更持久化到当前存储（`userRepository.createQueryBuilder`）。
   * @returns 按输入顺序得到的`all` 对应列表；没有匹配项时为空数组。
   */
  async all(): Promise<Component[]> {
    await this.dictService.refreshDecodeCache();

    const components = await this.userRepository
      .createQueryBuilder('component')
      .getMany();
    return components;
  }

  /**
   * 按名称和未删除状态筛选组件，刷新字典解码缓存后返回指定页的数据。
   * @returns 返回组件列表及匹配记录总数；页码或页大小缺失时沿用分页工具默认值。
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
                ((() => {
                  if (isNumber(args[key])) {
                    return true;
                  }
                  return !!args[key];
                })()),
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
   * 根据`component`更新`save` 对应结果；把变更持久化到当前存储（`userRepository.create`）。
   * @param component - 决定`save` 对应结果内容、边界或目标的 `component` 值。
   * @returns `save` 对应。
   */
  async save(component: Component): Promise<Component> {
    const link = this.userRepository.create(component);
    const save = await this.userRepository.save(link);
    return save;
  }

  /**
   * 按`id`移除`remove` 对应结果；把变更持久化到当前存储（`userRepository.createQueryBuilder`）。
   * @param id - 决定`remove` 对应结果内容、边界或目标的 `id` 值。
   * @returns 满足`remove` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 根据`component`更新`update` 对应结果；把变更持久化到当前存储（`userRepository.createQueryBuilder`）。
   * @param component - 用于`update` 对应结果的领域对象，包含 `id` 字段。
   * @returns 满足`update` 对应约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
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
   * 按`id`读取`find` 对应结果；把变更持久化到当前存储（`userRepository.createQueryBuilder`）。
   * @param id - 决定`find` 对应结果内容、边界或目标的 `id` 值。
   * @returns `find` 对应。
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
