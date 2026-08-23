import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import {
  KtCreateDateColumn,
  KtDateTime,
  KtDateTimeColumn,
  KtUpdateDateColumn,
} from '@/common';

@Entity('media_governance_series')
@Index(['canonicalProvider', 'canonicalProviderId'], { unique: true })
export class MediaGovernanceSeriesEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Column({ length: 16, name: 'canonical_provider', type: 'varchar' })
  canonicalProvider: string;

  @Column({ length: 64, name: 'canonical_provider_id', type: 'varchar' })
  canonicalProviderId: string;

  @Column({ length: 200, type: 'varchar' })
  title: string;

  @Column({
    length: 200,
    name: 'original_title',
    nullable: true,
    type: 'varchar',
  })
  originalTitle: null | string;

  @Column({ name: 'release_year', type: 'int' })
  releaseYear: number;

  @Column({ length: 24, name: 'media_type', type: 'varchar' })
  mediaType: string;

  @Column({ default: 1, type: 'int' })
  revision: number;

  @Column({ default: 'active', length: 24, type: 'varchar' })
  status: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_series_external_ref')
@Index(['provider', 'providerId'], { unique: true })
export class MediaGovernanceSeriesExternalRefEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'series_id', type: 'varchar' })
  seriesId: string;

  @Column({ length: 16, type: 'varchar' })
  provider: string;

  @Column({ length: 64, name: 'provider_id', type: 'varchar' })
  providerId: string;

  @Column({ length: 32, name: 'reference_role', type: 'varchar' })
  referenceRole: string;

  @Column({ length: 200, nullable: true, type: 'varchar' })
  title: null | string;

  @Column({ name: 'release_year', nullable: true, type: 'int' })
  releaseYear: null | number;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_season')
@Index(['seriesId', 'seasonNumber'], { unique: true })
export class MediaGovernanceSeasonEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Column({ length: 96, name: 'series_id', type: 'varchar' })
  seriesId: string;

  @Column({ name: 'season_number', type: 'int' })
  seasonNumber: number;

  @Column({ name: 'episode_count', type: 'int' })
  episodeCount: number;

  @Column({ length: 200, type: 'varchar' })
  title: string;

  @Column({ name: 'release_year', nullable: true, type: 'int' })
  releaseYear: null | number;

  @Column({ default: 'known', length: 24, type: 'varchar' })
  status: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_episode')
@Index(['seasonId', 'episodeNumber'], { unique: true })
export class MediaGovernanceEpisodeEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'series_id', type: 'varchar' })
  seriesId: string;

  @Column({ length: 96, name: 'season_id', type: 'varchar' })
  seasonId: string;

  @Column({ name: 'season_number', type: 'int' })
  seasonNumber: number;

  @Column({ name: 'episode_number', type: 'int' })
  episodeNumber: number;

  @Column({ length: 200, nullable: true, type: 'varchar' })
  title: null | string;

  @Column({ default: 'known', length: 24, type: 'varchar' })
  status: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_task_episode_binding')
@Index(['taskId', 'episodeId'], { unique: true })
export class MediaGovernanceTaskEpisodeBindingEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'series_id', type: 'varchar' })
  seriesId: string;

  @Column({ length: 96, name: 'season_id', type: 'varchar' })
  seasonId: string;

  @Column({ length: 96, name: 'episode_id', type: 'varchar' })
  episodeId: string;

  @Index()
  @Column({ length: 96, name: 'task_id', type: 'varchar' })
  taskId: string;

  @Column({ length: 96, name: 'source_id', nullable: true, type: 'varchar' })
  sourceId: null | string;

  @Column({ length: 32, name: 'binding_role', type: 'varchar' })
  bindingRole: string;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_rss_subscription')
@Index(['seriesId', 'feedUrlSha256'], { unique: true })
export class MediaGovernanceRssSubscriptionEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Index()
  @Column({ length: 96, name: 'series_id', type: 'varchar' })
  seriesId: string;

  @Column({ length: 96, name: 'season_id', type: 'varchar' })
  seasonId: string;

  @Column({ length: 120, type: 'varchar' })
  name: string;

  @Column({ length: 2048, name: 'feed_url', type: 'varchar' })
  feedUrl: string;

  @Column({ length: 64, name: 'feed_url_sha256', type: 'varchar' })
  feedUrlSha256: string;

  @Column({ default: true, type: 'boolean' })
  enabled: boolean;

  @Column({ length: 32, name: 'content_kind', type: 'varchar' })
  contentKind: string;

  @Column({
    length: 160,
    name: 'release_group',
    nullable: true,
    type: 'varchar',
  })
  releaseGroup: null | string;

  @Column({
    length: 500,
    name: 'include_pattern',
    nullable: true,
    type: 'varchar',
  })
  includePattern: null | string;

  @Column({
    length: 500,
    name: 'episode_pattern',
    nullable: true,
    type: 'varchar',
  })
  episodePattern: null | string;

  @Column({ default: 15, name: 'poll_interval_minutes', type: 'int' })
  pollIntervalMinutes: number;

  @Column({ default: 1, type: 'int' })
  revision: number;

  @Column({ default: 'idle', length: 24, type: 'varchar' })
  status: string;

  @Column({ length: 500, name: 'last_error', nullable: true, type: 'varchar' })
  lastError: null | string;

  @KtDateTimeColumn({ name: 'last_polled_at', nullable: true })
  lastPolledAt: KtDateTime | null;

  @KtDateTimeColumn({ name: 'next_poll_at', nullable: true })
  nextPollAt: KtDateTime | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

@Entity('media_governance_rss_item')
@Index(['subscriptionId', 'itemKeySha256'], { unique: true })
export class MediaGovernanceRssItemEntity {
  @PrimaryColumn({ length: 96, type: 'varchar' })
  id: string;

  @Column({ length: 96, name: 'subscription_id', type: 'varchar' })
  subscriptionId: string;

  @Column({ length: 64, name: 'item_key_sha256', type: 'varchar' })
  itemKeySha256: string;

  @Column({ length: 512, nullable: true, type: 'varchar' })
  guid: null | string;

  @Column({ length: 512, type: 'varchar' })
  title: string;

  @Column({ length: 40, name: 'info_hash', nullable: true, type: 'varchar' })
  infoHash: null | string;

  @Column({ name: 'episode_number', nullable: true, type: 'int' })
  episodeNumber: null | number;

  @Column({ default: 'discovered', length: 24, type: 'varchar' })
  state: string;

  @Column({
    length: 500,
    name: 'state_reason',
    nullable: true,
    type: 'varchar',
  })
  stateReason: null | string;

  @Column({ length: 96, name: 'task_id', nullable: true, type: 'varchar' })
  taskId: null | string;

  @Column({ length: 96, name: 'source_id', nullable: true, type: 'varchar' })
  sourceId: null | string;

  @KtDateTimeColumn({ name: 'published_at', nullable: true })
  publishedAt: KtDateTime | null;

  @KtCreateDateColumn({ name: 'create_time' })
  createTime: KtDateTime;

  @KtUpdateDateColumn({ name: 'update_time' })
  updateTime: KtDateTime;
}

export const MEDIA_GOVERNANCE_CATALOG_ENTITIES = [
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceEpisodeEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
  MediaGovernanceRssSubscriptionEntity,
  MediaGovernanceRssItemEntity,
];
