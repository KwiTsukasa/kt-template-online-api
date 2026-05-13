import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@Entity('dict')
export class DictEntity {
  @ApiPropertyOptional()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: 'CHART',
  })
  @Column({
    name: 'dict_key',
  })
  dictKey: string;

  @ApiProperty({
    example: '折线图',
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
    name: 'children_key',
    nullable: true,
  })
  childrenKey: string;

  @ApiPropertyOptional({
    example: 1,
  })
  @Column({
    default: 0,
  })
  sort: number;

  @Column({
    default: 0,
  })
  is_deleted: boolean;

  @CreateDateColumn({
    name: 'create_time',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
  })
  updateTime: Date;
}
