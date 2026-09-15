import { Column, PrimaryColumn } from 'typeorm';
import {
  KtCreateDateColumn,
  KtUpdateDateColumn,
} from '../decorators/kt-date-time.decorator';

export abstract class DefinitionDraftRow {
  @Column({
    name: 'source_key',
    type: 'varchar',
    length: 191,
    nullable: true,
    unique: true,
    collation: 'utf8mb4_bin',
  })
  sourceKey: string | null;

  @PrimaryColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 2048, default: '' })
  description: string;

  @Column({ type: 'int', default: 1 })
  revision: number;

  @Column({ type: 'int', nullable: true, name: 'published_version' })
  publishedVersion: number | null;

  @Column({ type: 'json' })
  definition: unknown;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: Date;
}

export abstract class DefinitionRevisionRow {
  @PrimaryColumn({ type: 'bigint', name: 'definition_id' })
  definitionId: string;

  @PrimaryColumn({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 2048, default: '' })
  description: string;

  @Column({ type: 'json' })
  definition: unknown;

  @KtCreateDateColumn({ name: 'published_at' })
  publishedAt: Date;
}
