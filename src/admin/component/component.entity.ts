import {
  AfterLoad,
  BeforeInsert,
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DecodeDictKey, decodeDictKeys, ensureSnowflakeId } from '@/common';

@Entity('admin_component')
export class Component {
  @ApiPropertyOptional()
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @ApiProperty()
  @Column({
    default: '',
  })
  name: string;

  @ApiProperty()
  @Column({
    type: 'int',
  })
  @DecodeDictKey('COMPONENT_TYPE', {
    targetKey: 'typeMsg',
  })
  type: number;

  @ApiProperty()
  @Column({
    name: 'component_type',
    type: 'int',
  })
  // 二级类型值由数据库字典维护；未指定 dictKey 时会在全部字典缓存中匹配。
  @DecodeDictKey(undefined, {
    targetKey: 'componentTypeMsg',
  })
  componentType: number;

  @ApiPropertyOptional()
  typeMsg: string;

  @ApiPropertyOptional()
  componentTypeMsg: string;

  @ApiProperty()
  @Column({
    type: 'mediumtext',
    nullable: false,
  })
  image: string;

  @ApiProperty()
  @Column({
    type: 'mediumtext',
    nullable: false,
  })
  template: string;

  @CreateDateColumn({
    name: 'create_time',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  updateTime: Date;

  @Column({
    default: 0,
  })
  is_deleted: boolean;

  @AfterLoad()
  decodeDictKeys() {
    // 查询结果初始化完成后再翻译，避免构造/赋值阶段覆盖派生字段。
    decodeDictKeys(this);
  }

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
