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
