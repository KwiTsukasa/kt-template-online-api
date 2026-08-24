import { getMetadataArgsStorage } from 'typeorm';
import {
  MEDIA_GOVERNANCE_CATALOG_ENTITIES,
  MediaGovernanceEpisodeEntity,
  MediaGovernanceRssItemEntity,
  MediaGovernanceRssSubscriptionEntity,
  MediaGovernanceSeasonEntity,
  MediaGovernanceSeriesEntity,
  MediaGovernanceSeriesExternalRefEntity,
  MediaGovernanceTaskEpisodeBindingEntity,
  MediaGovernanceWorkEntity,
  MediaGovernanceWorkExternalRefEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance-catalog.entities';

describe('media governance catalog entity schema', () => {
  const entities = [
    [MediaGovernanceSeriesEntity, 'media_governance_series'],
    [MediaGovernanceWorkEntity, 'media_governance_work'],
    [
      MediaGovernanceWorkExternalRefEntity,
      'media_governance_work_external_ref',
    ],
    [
      MediaGovernanceSeriesExternalRefEntity,
      'media_governance_series_external_ref',
    ],
    [MediaGovernanceSeasonEntity, 'media_governance_season'],
    [MediaGovernanceEpisodeEntity, 'media_governance_episode'],
    [
      MediaGovernanceTaskEpisodeBindingEntity,
      'media_governance_task_episode_binding',
    ],
    [MediaGovernanceRssSubscriptionEntity, 'media_governance_rss_subscription'],
    [MediaGovernanceRssItemEntity, 'media_governance_rss_item'],
  ] as const;

  it('registers the complete Series Work Season Episode RSS table set', () => {
    expect(MEDIA_GOVERNANCE_CATALOG_ENTITIES).toEqual(
      entities.map(([entity]) => entity),
    );
    expect(
      entities.map(
        ([entity]) =>
          getMetadataArgsStorage().tables.find(
            (table) => table.target === entity,
          )?.name,
      ),
    ).toEqual(entities.map(([, tableName]) => tableName));
  });

  it('keeps canonical provider, season, episode, task and RSS identities unique', () => {
    const indices = getMetadataArgsStorage().indices;
    expect(
      indices.find(
        (index) =>
          index.target === MediaGovernanceSeriesEntity &&
          index.unique &&
          Array.isArray(index.columns) &&
          index.columns.includes('canonicalNamespace'),
      )?.columns,
    ).toEqual([
      'canonicalProvider',
      'canonicalNamespace',
      'canonicalProviderId',
    ]);
    expect(
      indices.find(
        (index) => index.target === MediaGovernanceWorkEntity && index.unique,
      )?.columns,
    ).toEqual([
      'canonicalProvider',
      'canonicalNamespace',
      'canonicalProviderId',
    ]);
    expect(
      indices.find(
        (index) => index.target === MediaGovernanceSeasonEntity && index.unique,
      )?.columns,
    ).toEqual(['workId', 'seasonNumber']);
    expect(
      indices.find(
        (index) =>
          index.target === MediaGovernanceEpisodeEntity && index.unique,
      )?.columns,
    ).toEqual(['seasonId', 'episodeNumber']);
    expect(
      indices.find(
        (index) =>
          index.target === MediaGovernanceTaskEpisodeBindingEntity &&
          index.unique,
      )?.columns,
    ).toEqual(['taskId', 'episodeId']);
    expect(
      indices.find(
        (index) =>
          index.target === MediaGovernanceRssItemEntity && index.unique,
      )?.columns,
    ).toEqual(['subscriptionId', 'itemKeySha256']);
  });

  it('persists a non-null episode start for seasons with continuous numbering', () => {
    const episodeStart = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === MediaGovernanceSeasonEntity &&
        column.propertyName === 'episodeStart',
    );

    expect(episodeStart?.options).toMatchObject({
      default: 1,
      name: 'episode_start',
      type: 'int',
    });
  });
});
