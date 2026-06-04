import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ensureSnowflakeId, FormatDateTime } from '@/common';

@Entity('admin_dict')
export class AdminDict {
  @ApiPropertyOptional()
  @PrimaryColumn({
    type: 'bigint',
  })
  id: string;

  @ApiProperty({
    example: 'COMPONENT_TYPE',
  })
  @Column({
    name: 'dict_code',
  })
  dictCode: string;

  @ApiProperty({
    example: '图表',
  })
  @Column()
  label: string;

  @ApiProperty({
    example: 1,
  })
  @Column()
  value: string;

  @ApiPropertyOptional({
    example: 'CHART',
  })
  @Column({
    name: 'children_code',
    nullable: true,
  })
  childrenCode: string;

  @ApiPropertyOptional({
    example: 1,
  })
  @Column({
    default: 0,
  })
  sort: number;

  @Column({
    default: 1,
  })
  status: number;

  @Column({
    default: false,
    name: 'is_deleted',
  })
  isDeleted: boolean;

  @CreateDateColumn({
    name: 'create_time',
  })
  @FormatDateTime()
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  @FormatDateTime()
  updateTime: Date;

  @BeforeInsert()
  createId() {
    ensureSnowflakeId(this);
  }
}
