import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComponentTypeEnum, ComponentEnum } from '@/utils/constant';


@Entity()
export class Component {
  constructor(component?: Component) {
    Object.assign(this, component);
  }

  @ApiPropertyOptional()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({
    default: '',
  })
  name: string;

  @ApiProperty({
    type: 'enum',
    enum: ComponentTypeEnum,
  })
  @Column({
    type: 'enum',
    enum: ComponentTypeEnum,
  })
  type: number;

  @ApiProperty({
    type: 'enum',
    enum: ComponentEnum,
  })
  @Column({
    name: 'component_type',
    type: 'enum',
    enum: ComponentEnum,
  })
  componentType: number;

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
}
