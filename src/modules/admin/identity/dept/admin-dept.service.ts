import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError, toTree } from '@/common';
import { AdminDept } from './admin-dept.entity';

@Injectable()
export class AdminDeptService {
  /**
   * 初始化 AdminDeptService 实例。
   * @param deptRepository - Admin仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(AdminDept)
    private readonly deptRepository: Repository<AdminDept>,
  ) {}

  /**
   * 查询 Admin 身份权限数据。
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
   * 创建 Admin 身份权限对象或配置。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
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
   * 更新Dept。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
   * @param data - 业务数据；承载 Admin新增、更新、导入或执行字段。
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
   * 删除Dept。
   * @param id - Admin记录 ID；定位本次读取、更新、删除或关联的Admin记录。
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
   * 创建 Admin 身份权限对象或配置。
   * @param depts - Admin列表；转换 Admin列表项。
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
