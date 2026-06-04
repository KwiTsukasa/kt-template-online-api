import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Component } from './component.entity';
import { ToolsService, type KtPage, type KtPageParams } from '@/common';
import { isNumber, omit, pick } from 'lodash';
import { DictService } from '@/admin/dict/dict.service';

@Injectable()
export class ComponentService {
  constructor(
    @InjectRepository(Component)
    private readonly userRepository: Repository<Component>,
    private readonly toolsService: ToolsService,
    private readonly dictService: DictService,
  ) {}

  async all(): Promise<Component[]> {
    await this.dictService.refreshDecodeCache();

    const components = await this.userRepository
      .createQueryBuilder('component')
      .getMany();
    return components;
  }

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

  async save(component: Component): Promise<Component> {
    const link = this.userRepository.create(component);
    const save = await this.userRepository.save(link);
    return save;
  }

  async remove(id: string): Promise<boolean> {
    const link = await this.userRepository
      .createQueryBuilder('component')
      .update()
      .set({ is_deleted: true } as any)
      .where('id = :id', { id })
      .execute();

    return link.affected > 0;
  }

  async update(component: Component): Promise<boolean> {
    const link = await this.userRepository
      .createQueryBuilder('component')
      .update()
      .set(component)
      .where('id = :id', { id: component.id })
      .execute();

    return link.affected > 0;
  }

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
