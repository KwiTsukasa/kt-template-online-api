import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, toTree } from '@/common';
import { AdminDept } from './admin-dept.entity';

@Injectable()
export class AdminDeptService {
  constructor(
    @InjectRepository(AdminDept)
    private readonly deptRepository: Repository<AdminDept>,
  ) {}

  /**
   * 按当前运行态读取部门。
   * @returns 部门。
   */
  async getDeptList() {
    const depts = await this.deptRepository.find({
      where: {
        isDeleted: false,
      },
      order: {
        createTime: 'ASC',
      },
    });
    return this.buildDeptTree(depts);
  }

  /**
   * 根据`data`构造部门；把变更持久化到当前存储（`deptRepository.create`）。
   * @param data - 用于部门的领域对象，包含 `name`、`pid`、`remark`、`status` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生部门。
   */
  async createDept(data: Partial<AdminDept>) {
    const entity = this.deptRepository.create({
      name: data.name,
      pid: data.pid || '0',
      remark: data.remark || '',
      status: data.status ?? 1,
    });
    await this.deptRepository.save(entity);
    return null;
  }

  /**
   * 按部门标识更新名称、父级、备注和状态；缺失的父级、备注或状态分别使用根部门、空文本和启用值。
   * @param id - 决定按部门标识更新名称、父级、备注和状态内容、边界或目标的 `id` 值。
   * @param data - 用于按部门标识更新名称、父级、备注和状态的领域对象，包含 `name`、`pid`、`remark`、`status` 字段。
   * @returns 固定为 `null`，表示当前入口不会产生按部门标识更新名称、父级、备注和状态。
   */
  async updateDept(id: string, data: Partial<AdminDept>) {
    await this.deptRepository.update(
      { id },
      {
        name: data.name,
        pid: data.pid || '0',
        remark: data.remark || '',
        status: data.status ?? 1,
      },
    );
    return null;
  }

  /**
   * 按`id`移除部门；把变更持久化到当前存储（`deptRepository.update`）。
   * @param id - 决定部门内容、边界或目标的 `id` 值。
   * @returns 固定为 `null`，表示当前入口不会产生部门。
   */
  async deleteDept(id: string) {
    const hasChildren = await this.deptRepository.exist({
      where: {
        isDeleted: false,
        pid: id,
      },
    });
    if (hasChildren) {
      throwVbenError('请先删除子部门', HttpStatus.BAD_REQUEST);
    }

    await this.deptRepository.update(
      { id },
      {
        isDeleted: true,
      },
    );
    return null;
  }

  /**
   * 根据`depts`构造部门树形层级。
   * @param depts - 决定部门树形层级内容、边界或目标的 `depts` 值。
   * @returns 部门树形层级。
   */
  private buildDeptTree(depts: AdminDept[]) {
    const nodes = depts.map((dept) => ({
      createTime: dept.createTime,
      id: dept.id,
      name: dept.name,
      pid: dept.pid || '0',
      remark: dept.remark,
      status: dept.status,
    }));
    return toTree(nodes);
  }
}
