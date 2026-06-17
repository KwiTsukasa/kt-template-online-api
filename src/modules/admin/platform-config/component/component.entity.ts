import {
  AfterLoad,
  BeforeInsert,
  Column,
  Entity,
  PrimaryColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DecodeDictKey,
  decodeDictKeys,
  ensureSnowflakeId,
  KtCreateDateColumn,
  KtDateTime,
  KtUpdateDateColumn,
} from '@/common';
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

  @KtCreateDateColumn({
    name: 'create_time',
  })
  createTime: KtDateTime;

  @KtUpdateDateColumn({
    name: 'update_time',
  })
  updateTime: KtDateTime;

  @Column({
    default: 0,
  })
  is_deleted: boolean;

  /**
   * 转换 Admin 平台配置输入。
   */
  @AfterLoad()
  decodeDictKeys() {
    // 查询结果初始化完成后再翻译，避免构造/赋值阶段覆盖派生字段。
    decodeDictKeys(this);
  }

  /**
   * 创建 Admin 平台配置对象或配置。
   */
  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
