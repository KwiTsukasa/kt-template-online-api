import { assertMediaGovernanceSeriesWorkMigrationVerification } from '../../src/commands/migrate-media-governance-series-work';

describe('Media Governance Series-first migration command', () => {
  const valid = {
    duplicate_work_canonical_count: 0,
    invalid_series_namespace_count: 0,
    legacy_series_reference_without_work_ref_count: 0,
    non_tv_work_with_season_count: 0,
    rss_context_column_count: 4,
    rss_context_index_count: 2,
    rss_context_missing_identity_count: 0,
    rss_context_work_ref_mismatch_count: 0,
    season_work_mismatch_count: 0,
    schema_contract_mismatch_count: 0,
    series_without_primary_work_count: 0,
    task_work_series_mismatch_count: 0,
    work_table_count: 2,
  };

  it('accepts the complete ownership and reference verification matrix', () => {
    expect(assertMediaGovernanceSeriesWorkMigrationVerification(valid)).toEqual(
      valid,
    );
  });

  it('rejects a missing legacy Work reference', () => {
    expect(() =>
      assertMediaGovernanceSeriesWorkMigrationVerification({
        ...valid,
        legacy_series_reference_without_work_ref_count: 1,
      }),
    ).toThrow('legacy_series_reference_without_work_ref_count=1');
  });

  it('rejects an RSS identity that is not registered on the bound Work', () => {
    expect(() =>
      assertMediaGovernanceSeriesWorkMigrationVerification({
        ...valid,
        rss_context_work_ref_mismatch_count: 1,
      }),
    ).toThrow('rss_context_work_ref_mismatch_count=1');
  });
});
