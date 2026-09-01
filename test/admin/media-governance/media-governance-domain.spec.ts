import {
  MediaGovernanceContractError,
  assertSourceClassification,
  buildDescriptorObjectKey,
  validateDescriptorManifestEntry,
  validateSubtitleContracts,
} from '../../../src/modules/admin/media-governance/domain/media-governance-domain';

describe('media governance mechanical domain', () => {
  it('maps primary media content to one mechanical governance profile', () => {
    expect(
      assertSourceClassification({
        contentKind: 'embedded_subtitle_media',
        linkedTask: null,
        sourceRole: 'primary_media',
      }),
    ).toBe('embedded');
  });

  it('requires subtitle-only sources to bind an open subtitleless task', () => {
    expect(() =>
      assertSourceClassification({
        contentKind: 'sidecar_subtitle_package',
        linkedTask: null,
        sourceRole: 'supplemental_subtitle',
      }),
    ).toThrow(MediaGovernanceContractError);
    expect(
      assertSourceClassification({
        contentKind: 'sidecar_subtitle_package',
        linkedTask: {
          contentKind: 'subtitleless_media',
          runState: 'draft',
          stage: 'intake',
        },
        sourceRole: 'supplemental_subtitle',
      }),
    ).toBeNull();
  });

  it('sorts complete subtitle mappings and rejects mixed release groups', () => {
    expect(
      validateSubtitleContracts([
        {
          expectedEpisodeNumbers: [2, 1],
          mappings: [
            { episodeNumber: 2, releaseGroup: 'LoliHouse' },
            { episodeNumber: 1, releaseGroup: 'LoliHouse' },
          ],
          seasonNumber: 'S01',
          sourceId: 'media-source-subtitle-0001',
        },
      ])[0],
    ).toMatchObject({
      expectedEpisodeNumbers: [1, 2],
      releaseGroup: 'LoliHouse',
    });
    expect(() =>
      validateSubtitleContracts([
        {
          expectedEpisodeNumbers: [1, 2],
          mappings: [
            { episodeNumber: 1, releaseGroup: 'A' },
            { episodeNumber: 2, releaseGroup: 'B' },
          ],
          seasonNumber: 'S01',
          sourceId: 'media-source-subtitle-0001',
        },
      ]),
    ).toThrow(MediaGovernanceContractError);
  });

  it('keeps descriptors under their task namespace and rejects unsafe paths', () => {
    expect(
      buildDescriptorObjectKey({
        descriptorRevision: 2,
        descriptorSha256: 'a'.repeat(64),
        sourceId: 'media-source-0001',
        taskId: 'media-task-0001',
        transportKind: 'torrent',
      }),
    ).toBe(
      `tasks/media-task-0001/sources/media-source-0001/revisions/2-${'a'.repeat(64)}.torrent`,
    );
    expect(
      validateDescriptorManifestEntry({
        entryType: 'file',
        executable: false,
        relativePath: 'Season 01/Episode 01.mkv',
      }),
    ).toBe('Season 01/Episode 01.mkv');
    expect(() =>
      validateDescriptorManifestEntry({
        entryType: 'file',
        executable: false,
        relativePath: '../escape.mkv',
      }),
    ).toThrow(MediaGovernanceContractError);
  });
});
