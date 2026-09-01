#!/usr/bin/env python3
"""内嵌字幕 TV 本地计划器的纯函数回归测试。"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-tv-embedded-plan.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_local_tv_embedded_plan", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load embedded TV plan script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLocalTvEmbeddedPlanTest(unittest.TestCase):
    def test_stable_sha256_matches_executor_empty_manifest_digest(self):
        module = load_module()

        self.assertEqual(
            module.stable_sha256([]),
            "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        )

    def test_sanitizes_cross_platform_forbidden_title_characters(self):
        module = load_module()

        self.assertEqual(
            module.sanitize_component('第 1 集 / A:B? "C"'),
            "第 1 集 ／ A：B？ ＂C＂",
        )

    def test_maps_video_paths_from_database_rows_without_filename_hints(self):
        module = load_module()
        inventory = {
            "files": {
                "videos": [
                    {
                        "boundedSha256": "a" * 64,
                        "mtimeMs": 1,
                        "path": "/vol2/1000/Media/movie/Title/[Group] Show - 01.mkv",
                        "size": 10,
                        "streams": [
                            {
                                "codec": "ass",
                                "default": 1,
                                "forced": 0,
                                "language": "chi",
                                "title": "简体中文",
                                "type": "subtitle",
                            }
                        ],
                    }
                ]
            },
            "database": {
                "rows": [
                    {
                        "episode_number": 1,
                        "grandparent_tmdb_id": 123,
                        "parent_season": 1,
                        "path": "/vol2/1000/Media/movie/Title/[Group] Show - 01.mkv",
                        "type": "Episode",
                    }
                ]
            },
        }

        mapped = module.map_videos(inventory, provider_id=123, season_number=1)

        self.assertEqual(mapped[0]["episode"], 1)
        self.assertEqual(mapped[0]["video"]["path"], inventory["files"]["videos"][0]["path"])

    def test_filters_a_multi_season_inventory_to_the_requested_season(self):
        module = load_module()
        videos = []
        rows = []
        for season, episode in ((1, 1), (1, 2), (2, 1)):
            path = f"/vol2/1000/Media/movie/Title/S{season:02d}E{episode:02d}.mkv"
            videos.append({"path": path, "streams": []})
            rows.append(
                {
                    "episode_number": episode,
                    "grandparent_tmdb_id": 123,
                    "parent_season": season,
                    "path": path,
                    "type": "Episode",
                }
            )
        inventory = {"database": {"rows": rows}, "files": {"videos": videos}}

        mapped = module.map_videos(inventory, provider_id=123, season_number=2)

        self.assertEqual([entry["episode"] for entry in mapped], [1])
        self.assertEqual(mapped[0]["video"]["path"], videos[2]["path"])

    def test_selects_target_provider_and_collapses_identical_official_rows(self):
        module = load_module()
        target_path = "/vol2/1000/Media/movie/Collection/target.mkv"
        other_path = "/vol2/1000/Media/movie/Collection/movie.mkv"
        inventory = {
            "database": {
                "rows": [
                    {
                        "episode_number": 1,
                        "grandparent_tmdb_id": 123,
                        "parent_season": 1,
                        "path": target_path,
                        "type": "Episode",
                    },
                    {
                        "episode_number": 1,
                        "season_number": 1,
                        "tmdb_id": 123,
                        "path": target_path,
                        "type": "Episode",
                    },
                    {"path": other_path, "tmdb_id": 456, "type": "Movie"},
                ]
            },
            "files": {
                "videos": [
                    {"path": target_path, "streams": []},
                    {"path": other_path, "streams": []},
                ]
            },
        }

        mapped = module.map_videos(inventory, provider_id=123, season_number=1)

        self.assertEqual([entry["episode"] for entry in mapped], [1])
        self.assertEqual(mapped[0]["video"]["path"], target_path)

        inventory["database"]["rows"].append(
            {"path": target_path, "tmdb_id": 456, "type": "Movie"}
        )
        with self.assertRaisesRegex(RuntimeError, "conflicting provider rows"):
            module.map_videos(inventory, provider_id=123, season_number=1)
        inventory["database"]["rows"].pop()
        inventory["database"]["rows"][1]["episode_number"] = 2
        with self.assertRaisesRegex(RuntimeError, "conflicting provider episode rows"):
            module.map_videos(inventory, provider_id=123, season_number=1)

    def test_rejects_inconsistent_embedded_subtitle_signatures(self):
        module = load_module()
        videos = [
            {
                "streams": [
                    {
                        "codec": "ass",
                        "default": 1,
                        "forced": 0,
                        "language": "chi",
                        "title": "简体中文",
                        "type": "subtitle",
                    }
                ]
            },
            {
                "streams": [
                    {
                        "codec": "subrip",
                        "default": 1,
                        "forced": 0,
                        "language": "chi",
                        "title": None,
                        "type": "subtitle",
                    }
                ]
            },
        ]

        with self.assertRaisesRegex(RuntimeError, "subtitle signature"):
            module.embedded_subtitle_signature(videos)

    def test_allows_official_explicit_chinese_selection_without_changing_stream_order(self):
        module = load_module()
        videos = [
            {
                "streams": [
                    {
                        "codec": "pgs",
                        "default": 0,
                        "forced": 0,
                        "language": "chi",
                        "title": "Simplified",
                        "type": "subtitle",
                    },
                    {
                        "codec": "pgs",
                        "default": 1,
                        "forced": 0,
                        "language": "eng",
                        "title": "English",
                        "type": "subtitle",
                    },
                ]
            }
        ]

        with self.assertRaisesRegex(RuntimeError, "default Chinese"):
            module.embedded_subtitle_signature(videos)

        signature = module.embedded_subtitle_signature(
            videos,
            allow_explicit_chinese_selection=True,
        )

        self.assertEqual(signature[0]["language"], "chi")
        self.assertEqual(signature[0]["default"], 0)

    def test_merges_non_overlapping_season_components_into_one_title_plan(self):
        module = load_module()
        common = pathlib.Path(
            "/vol2/1000/.kt-media-governance-staging/media-048-multi-v1"
        )

        def component(season):
            source = f"/vol2/1000/Media/movie/source/S{season:02d}E01.mkv"
            target = (
                "/vol2/1000/Media/movie/TV/Title (2020) [tmdbid-1]/"
                f"Season {season:02d}/Title - S{season:02d}E01.mkv"
            )
            evidence_id = f"video-s{season:02d}e01"
            source_id = f"source-s{season:02d}"
            operation = {
                "evidenceId": evidence_id,
                "fileKind": "video",
                "operation": "move",
                "sourcePath": source,
                "targetPath": target,
            }
            return {
                "execution": {
                    "allowlists": {
                        "localSourceRoot": "/vol2/1000/Media/movie/source",
                        "localStagingRoot": str(common / f"s{season:02d}"),
                        "localTargetRoot": "/vol2/1000/Media/movie/TV/Title (2020) [tmdbid-1]",
                    },
                    "manifestSha256": {},
                    "phase": "local-only",
                    "replayKey": f"media-048-s{season:02d}-local-v1",
                },
                "identity": {
                    "canonicalTitle": "Title",
                    "mediaType": "tv",
                    "provider": "tmdb",
                    "providerId": "1",
                    "year": 2020,
                },
                "manifests": {
                    "cloudSidecarQuarantine": {"forward": [], "inverse": []},
                    "cloudVideo": {"forward": [], "inverse": []},
                    "local": {
                        "forward": [operation],
                        "inverse": [module.inverse_operation(operation)],
                    },
                },
                "schemaVersion": "1.2.0",
                "sealed": True,
                "sealedAt": "2026-08-09T00:00:00Z",
                "sourceEvidence": [
                    {
                        "digest": "a" * 64,
                        "evidenceId": evidence_id,
                        "evidenceMethod": "bounded-sha256-first-last-4mib-v1",
                        "fileKind": "video",
                        "mtimeMs": 1,
                        "path": source,
                        "scope": "local",
                        "size": 10,
                    }
                ],
                "subtitleDecision": {
                    "assignments": [
                        {
                            "episode": 1,
                            "preferredLanguage": "zh-CN",
                            "season": season,
                            "sourceId": source_id,
                        }
                    ],
                    "gapSeasons": [],
                    "mode": "per-season-sources",
                },
                "subtitleEvidence": [
                    {
                        "episodes": [1],
                        "evidenceId": f"{source_id}-evidence",
                        "evidenceMethod": "embedded-stream-manifest-sha256-v1",
                        "fileCount": 1,
                        "languages": ["zh-CN"],
                        "manifestPath": f"/vol1/evidence/s{season:02d}.json",
                        "manifestSha256": "b" * 64,
                        "observedAt": "2026-08-09T00:00:00Z",
                        "preferredLanguage": "zh-CN",
                        "releaseGroup": "Group",
                        "season": season,
                        "sourceId": source_id,
                        "streamCount": 1,
                    }
                ],
                "targetAbsenceEvidence": [],
                "workItemId": "media-048",
            }

        merged = module.merge_component_plans(
            [component(1), component(2)],
            common_staging_root=common,
            sealed_at="2026-08-09T01:00:00Z",
        )

        self.assertEqual(
            merged["execution"]["allowlists"]["localStagingRoot"], str(common)
        )
        self.assertEqual(len(merged["manifests"]["local"]["forward"]), 2)
        self.assertEqual(
            [row["season"] for row in merged["subtitleEvidence"]], [1, 2]
        )
        self.assertEqual(
            {row["season"] for row in merged["subtitleDecision"]["assignments"]},
            {1, 2},
        )

    def test_requires_explicit_provider_superset_and_keeps_downloads_closed(self):
        module = load_module()
        mapped = [
            {
                "episode": episode,
                "video": {"durationSeconds": 24 * 60},
            }
            for episode in (1, 2)
        ]
        provider = {
            1: {"episode": 1, "runtime": "24m"},
            2: {"episode": 2, "runtime": "24m"},
            3: {"episode": 3, "runtime": "24m"},
        }

        with self.assertRaisesRegex(RuntimeError, "provider superset"):
            module.assess_provider_coverage(
                mapped,
                provider,
                allow_provider_superset=False,
            )

        result = module.assess_provider_coverage(
            mapped,
            provider,
            allow_provider_superset=True,
        )

        self.assertEqual(result["mode"], "explicit-local-episode-subset")
        self.assertEqual(result["localEpisodes"], [1, 2])
        self.assertEqual(result["providerOnlyEpisodes"], [3])
        self.assertEqual(result["videoDownloadCount"], 0)

    def test_rejects_provider_subset_and_runtime_mismatch(self):
        module = load_module()
        mapped = [
            {
                "episode": 1,
                "video": {"durationSeconds": 24 * 60},
            },
            {
                "episode": 2,
                "video": {"durationSeconds": 24 * 60},
            },
        ]

        with self.assertRaisesRegex(RuntimeError, "missing local episode"):
            module.assess_provider_coverage(
                mapped,
                {1: {"episode": 1, "runtime": "24m"}},
                allow_provider_superset=True,
            )

        with self.assertRaisesRegex(RuntimeError, "runtime"):
            module.assess_provider_coverage(
                mapped[:1],
                {1: {"episode": 1, "runtime": "12m"}},
                allow_provider_superset=False,
            )

    def test_builds_schema_compatible_embedded_subtitle_evidence(self):
        module = load_module()

        result = module.embedded_subtitle_evidence(
            episodes=[1, 2],
            inventory_path="/vol1/docker/kt-media-governance/evidence/batch/inventory.json",
            inventory_sha256="a" * 64,
            observed_at="2026-08-08T00:00:00Z",
            release_group="Group",
            season=1,
            source_id="source-id",
            stream_count=4,
        )

        self.assertEqual(result["evidenceMethod"], "embedded-stream-manifest-sha256-v1")
        self.assertEqual(result["manifestSha256"], "a" * 64)
        self.assertEqual(result["preferredLanguage"], "zh-CN")
        self.assertNotIn("inventoryPath", result)
        self.assertNotIn("streamSignature", result)

    def test_validates_a_sealed_complete_season_subtitle_gap(self):
        module = load_module()
        mapped = [{"episode": 1}, {"episode": 2}]
        evidence = {
            "candidates": [
                {
                    "availabilityEvidenceSha256": "a" * 64,
                    "outcome": "no-data-timeout-180s",
                }
            ],
            "capturedAt": "2026-08-09T00:00:00Z",
            "decision": "manual-governance-required-until-one-complete-season-source-is-live",
            "fallbackSearch": {"bangumiMoeValidCandidateCount": 0},
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "mediaVideoDownloads": 0,
                "uiWrites": 0,
            },
            "requiredEpisodeCount": 2,
            "schemaVersion": "media-subtitle-source-resolution-v1",
            "seasonNumber": 1,
            "selectedSource": None,
            "status": "source-blocked",
            "videoDownloadCeiling": 0,
            "workItemId": "media-035",
        }

        sealed = module.validate_subtitle_gap_evidence(
            evidence,
            mapped=mapped,
            season=1,
            work_item="media-035",
        )

        self.assertEqual(sealed["observedAt"], "2026-08-09T00:00:00Z")
        self.assertEqual(sealed["episodeCount"], 2)
        evidence["selectedSource"] = {"releaseGroup": "wrong"}
        with self.assertRaisesRegex(RuntimeError, "selected source"):
            module.validate_subtitle_gap_evidence(
                evidence,
                mapped=mapped,
                season=1,
                work_item="media-035",
            )

    def test_validates_complete_burned_in_review_and_builds_schema_evidence(self):
        module = load_module()
        inventory_path = pathlib.Path(
            "/vol1/docker/kt-media-governance/evidence/batch/inventory.json"
        )
        review_path = pathlib.Path(
            "/vol1/docker/kt-media-governance/evidence/batch/burned-in.json"
        )
        mapped = [
            {
                "episode": episode,
                "video": {
                    "boundedSha256": character * 64,
                    "mtimeMs": episode,
                    "path": f"/vol2/1000/Media/movie/Title/episode-{episode}.mp4",
                    "size": episode * 100,
                },
            }
            for episode, character in ((1, "a"), (2, "b"))
        ]
        review = {
            "capturedAt": "2026-08-09T00:00:00Z",
            "commandContract": {
                "frameBytesPersisted": 0,
                "publicSshResourcePayloadBytes": 0,
            },
            "episodes": [
                {
                    "boundedSha256": entry["video"]["boundedSha256"],
                    "bytes": entry["video"]["size"],
                    "episode": entry["episode"],
                    "matchedSimplifiedChinese": [
                        {"second": 100, "text": "这是字幕"},
                        {"second": 200, "text": "这里也是字幕"},
                    ],
                    "mtimeMs": entry["video"]["mtimeMs"],
                    "path": entry["video"]["path"],
                    "sealedBurnedIn": True,
                    "season": 1,
                }
                for entry in mapped
            ],
            "inventoryPath": str(inventory_path),
            "inventorySha256": "c" * 64,
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "mediaFileWrites": 0,
                "mechanicalScanTriggered": False,
                "serviceMutation": False,
                "uiWrites": 0,
            },
            "providerRef": "tmdb:123",
            "schemaVersion": "burned-in-frame-manifest-sha256-v1",
            "seasonRoutes": [
                {
                    "episodeCount": 2,
                    "gapEpisodes": [],
                    "route": "burned-in-sealed",
                    "sealedEpisodeCount": 2,
                    "season": 1,
                }
            ],
            "sourceGroup": "QHstudIo",
            "summary": {
                "allEpisodesSealed": True,
                "episodeCount": 2,
                "missingSimplifiedChineseEpisodes": [],
                "sealedEpisodeCount": 2,
            },
            "workItemId": "media-031",
        }

        sealed = module.validate_burned_in_review(
            review,
            inventory_path=inventory_path,
            inventory_sha256="c" * 64,
            mapped=mapped,
            provider_id=123,
            release_group="QHstudIo",
            season=1,
            work_item="media-031",
        )
        evidence = module.burned_in_subtitle_evidence(
            episodes=sealed["episodes"],
            frame_observation_count=sealed["frameObservationCount"],
            observed_at=sealed["observedAt"],
            release_group="QHstudIo",
            review_path=str(review_path),
            review_sha256="d" * 64,
            season=1,
            source_id="source-id",
        )

        self.assertEqual(evidence["evidenceMethod"], "burned-in-frame-manifest-sha256-v1")
        self.assertEqual(evidence["reviewedEpisodeCount"], 2)
        self.assertEqual(evidence["frameObservationCount"], 4)
        self.assertEqual(evidence["manifestSha256"], "d" * 64)

    def test_rejects_burned_in_review_with_an_unsealed_episode(self):
        module = load_module()
        inventory_path = pathlib.Path(
            "/vol1/docker/kt-media-governance/evidence/batch/inventory.json"
        )
        mapped = [
            {
                "episode": 1,
                "video": {
                    "boundedSha256": "a" * 64,
                    "mtimeMs": 1,
                    "path": "/vol2/1000/Media/movie/Title/episode-1.mp4",
                    "size": 100,
                },
            }
        ]
        review = {
            "capturedAt": "2026-08-09T00:00:00Z",
            "commandContract": {
                "frameBytesPersisted": 0,
                "publicSshResourcePayloadBytes": 0,
            },
            "episodes": [
                {
                    "boundedSha256": "a" * 64,
                    "bytes": 100,
                    "episode": 1,
                    "matchedSimplifiedChinese": [],
                    "mtimeMs": 1,
                    "path": mapped[0]["video"]["path"],
                    "sealedBurnedIn": False,
                    "season": 1,
                }
            ],
            "inventoryPath": str(inventory_path),
            "inventorySha256": "c" * 64,
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "mediaFileWrites": 0,
                "mechanicalScanTriggered": False,
                "serviceMutation": False,
                "uiWrites": 0,
            },
            "providerRef": "tmdb:123",
            "schemaVersion": "burned-in-frame-manifest-sha256-v1",
            "seasonRoutes": [],
            "sourceGroup": "QHstudIo",
            "summary": {
                "allEpisodesSealed": False,
                "episodeCount": 1,
                "missingSimplifiedChineseEpisodes": [{"episode": 1, "season": 1}],
                "sealedEpisodeCount": 0,
            },
            "workItemId": "media-031",
        }

        with self.assertRaisesRegex(RuntimeError, "not sealed"):
            module.validate_burned_in_review(
                review,
                inventory_path=inventory_path,
                inventory_sha256="c" * 64,
                mapped=mapped,
                provider_id=123,
                release_group="QHstudIo",
                season=1,
                work_item="media-031",
            )

    def test_selects_the_exact_season_from_a_multi_season_burned_in_review(self):
        module = load_module()
        inventory_path = pathlib.Path(
            "/vol1/docker/kt-media-governance/evidence/batch/inventory.json"
        )
        mapped = [
            {
                "episode": episode,
                "video": {
                    "boundedSha256": character * 64,
                    "mtimeMs": episode,
                    "path": f"/vol2/1000/Media/movie/Title/s1-episode-{episode}.mp4",
                    "size": episode * 100,
                },
            }
            for episode, character in ((1, "a"), (2, "b"))
        ]
        rows = [
            {
                "boundedSha256": entry["video"]["boundedSha256"],
                "bytes": entry["video"]["size"],
                "episode": entry["episode"],
                "matchedSimplifiedChinese": [
                    {"second": 100, "text": "这是字幕"},
                    {"second": 200, "text": "这里也是字幕"},
                ],
                "mtimeMs": entry["video"]["mtimeMs"],
                "path": entry["video"]["path"],
                "sealedBurnedIn": True,
                "season": 1,
            }
            for entry in mapped
        ]
        rows.append(
            {
                "boundedSha256": "c" * 64,
                "bytes": 300,
                "episode": 1,
                "matchedSimplifiedChinese": [
                    {"second": 101, "text": "这是第二季字幕"},
                    {"second": 201, "text": "这里仍有字幕"},
                ],
                "mtimeMs": 3,
                "path": "/vol2/1000/Media/movie/Title/s2-episode-1.mp4",
                "sealedBurnedIn": True,
                "season": 2,
            }
        )
        review = {
            "capturedAt": "2026-08-09T00:00:00Z",
            "commandContract": {
                "frameBytesPersisted": 0,
                "publicSshResourcePayloadBytes": 0,
            },
            "episodes": rows,
            "inventoryPath": str(inventory_path),
            "inventorySha256": "d" * 64,
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "mediaFileWrites": 0,
                "mechanicalScanTriggered": False,
                "serviceMutation": False,
                "uiWrites": 0,
            },
            "providerRef": "tmdb:123",
            "schemaVersion": "burned-in-frame-manifest-sha256-v1",
            "seasonRoutes": [
                {
                    "episodeCount": 2,
                    "gapEpisodes": [],
                    "route": "burned-in-sealed",
                    "sealedEpisodeCount": 2,
                    "season": 1,
                },
                {
                    "episodeCount": 1,
                    "gapEpisodes": [],
                    "route": "burned-in-sealed",
                    "sealedEpisodeCount": 1,
                    "season": 2,
                },
            ],
            "seasonSourceGroups": {"1": "Local-S1", "2": "Local-S2"},
            "seasonSourceMarkers": {"1": "S01.CHS", "2": "S02.CHS-JPN"},
            "sourceGroup": None,
            "summary": {
                "allEpisodesSealed": True,
                "episodeCount": 3,
                "missingSimplifiedChineseEpisodes": [],
                "sealedEpisodeCount": 3,
            },
            "workItemId": "media-033",
        }

        sealed = module.validate_burned_in_review(
            review,
            inventory_path=inventory_path,
            inventory_sha256="d" * 64,
            mapped=mapped,
            provider_id=123,
            release_group="Local-S1",
            season=1,
            work_item="media-033",
        )

        self.assertEqual(sealed["episodes"], [1, 2])
        self.assertEqual(sealed["frameObservationCount"], 4)

    def test_merged_summary_keeps_burned_in_evidence_semantics(self):
        module = load_module()

        self.assertEqual(
            module.subtitle_evidence_mode(
                "burned-in-frame-manifest-sha256-v1"
            ),
            "burned-in",
        )
        with self.assertRaisesRegex(RuntimeError, "unsupported"):
            module.subtitle_evidence_mode("unknown")

    def test_parses_sidecar_episode_group_and_timing(self):
        module = load_module()
        payload = """[Script Info]
Dialogue: 0,0:00:11.47,0:00:15.00,Default,,0,0,0,,本字幕由{\\c&HFFFFFF&}桜{\\c&H000000&}都字幕组制作
Dialogue: 0,0:00:15.00,0:00:15.00,FX,,0,0,0,,瞬时卡拉 OK 特效
Dialogue: 0,0:00:16.00,0:00:15.50,FX,,0,0,0,,反向特效控制行
Dialogue: 0,0:23:40.00,0:23:52.76,Default,,0,0,0,,结束
"""
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "[Sakurato] Chainsaw Man [02][CHS].ass"
            path.write_text(payload, encoding="utf-8")

            self.assertEqual(module.subtitle_episode_hint(path), 2)
            self.assertEqual(module.subtitle_release_group(path), "Sakurato")
            self.assertEqual(
                module.ass_timing_summary(path),
                {
                    "cueCount": 4,
                    "firstCueSeconds": 11.47,
                    "lastCueSeconds": 1432.76,
                    "nonPositiveCueCount": 2,
                },
            )

    def test_parses_dbd_raws_episode_and_release_group_from_package_path(self):
        module = load_module()
        payload = """[Script Info]
[Events]
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,简体字幕
"""
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / "[DBD-Raws][赌博默示录][01-26TV全集]"
            root.mkdir()
            path = root / "[DBD-Raws][赌博默示录][02][1080P][FLAC].ass"
            path.write_text(payload, encoding="utf-8")

            self.assertEqual(module.subtitle_episode_hint(path), 2)
            self.assertEqual(module.subtitle_release_group(path), "DBD-Raws")

    def test_parses_hakugetsu_release_group_from_signed_ass(self):
        module = load_module()
        payload = """[Script Info]
[Events]
Dialogue: 0,0:03:31.05,0:03:38.81,Staff,,0,0,0,,本字幕由「白月字幕组」制作 仅供内部交流学习
"""
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "[Hakugetsu&VCB-Studio] No Game No Life [01][SC].ass"
            path.write_text(payload, encoding="utf-8")

            self.assertEqual(
                module.subtitle_release_group(path),
                "白月字幕组&VCB-Studio",
            )

    def test_decodes_bom_marked_utf16_ass_without_rewriting_source(self):
        module = load_module()
        payload = "[Script Info]\nTitle: 简体字幕\n"
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "subtitle.ass"
            path.write_text(payload, encoding="utf-16")

            self.assertEqual(module.decode_subtitle(path), payload)

    def test_builds_schema_compatible_sidecar_subtitle_evidence(self):
        module = load_module()

        result = module.sidecar_subtitle_evidence(
            episodes=[1, 2],
            manifest_path="/vol1/docker/kt-media-governance/evidence/batch/package.json",
            manifest_sha256="b" * 64,
            observed_at="2026-08-08T00:00:00Z",
            release_group="Sakurato",
            season=1,
            source_id="source-id",
        )

        self.assertEqual(result["evidenceMethod"], "subtitle-package-manifest-sha256-v1")
        self.assertEqual(result["fileCount"], 2)
        self.assertEqual(result["manifestSha256"], "b" * 64)
        self.assertNotIn("preferredLanguage", result)

    def test_parses_srt_timing_and_preserves_canonical_extension(self):
        module = load_module()
        payload = """1
00:00:01,500 --> 00:00:03,000
这是第一句字幕。

2
00:23:40.000 --> 00:23:52.760
这是结束字幕。
"""
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "S01E02.quark.srt"
            path.write_text(payload, encoding="utf-8")

            self.assertEqual(module.subtitle_episode_hint(path), 2)
            self.assertEqual(
                module.srt_timing_summary(path),
                {
                    "cueCount": 2,
                    "firstCueSeconds": 1.5,
                    "lastCueSeconds": 1432.76,
                    "nonPositiveCueCount": 0,
                },
            )
            self.assertEqual(
                module.canonical_subtitle_target(
                    pathlib.Path("/media/Show - S01E02.mkv"), path
                ),
                pathlib.Path("/media/Show - S01E02.zh-CN.srt"),
            )

    def test_collects_srt_only_when_bound_to_sealed_single_source_evidence(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            paths = []
            for episode in (1, 2):
                path = root / f"S01E{episode:02d}.quark.srt"
                path.write_text(
                    f"1\n00:00:01,000 --> 00:00:03,000\n第 {episode} 集字幕。\n",
                    encoding="utf-8",
                )
                paths.append(path)
            mapped = [
                {"episode": episode, "video": {"durationSeconds": 100.0}}
                for episode in (1, 2)
            ]
            evidence = {
                "schemaVersion": "media-quark-subtitle-package-v1",
                "status": "accepted",
                "workItemId": "media-040",
                "season": 1,
                "sourceReleaseGroup": "quark-share-s01",
                "shareUrl": "https://pan.quark.cn/s/example",
                "localStagingRoot": str(root),
                "subtitleCount": 2,
                "episodeCoverage": [1, 2],
                "files": [
                    {
                        "episode": episode,
                        "targetPath": str(path),
                        "size": path.stat().st_size,
                        "sha256": module.sha256_file(path),
                        "cueCount": 1,
                        "lastCueSeconds": 3.0,
                        "nonPositiveCueCount": 0,
                        "simplifiedMarkerCount": 2,
                        "traditionalMarkerCount": 0,
                        "serverCrc64Matches": True,
                    }
                    for episode, path in zip((1, 2), paths, strict=True)
                ],
                "videoIdentity": [
                    {
                        "episode": episode,
                        "exactNameAndSizeMatch": True,
                        "durationDeltaSeconds": 0.01,
                    }
                    for episode in (1, 2)
                ],
                "mutationBoundaries": {
                    "cloudWrites": 0,
                    "databaseDirectWrite": False,
                    "mechanicalScanTriggered": False,
                    "mediaVideoDownloads": 0,
                    "serviceMutation": False,
                    "subtitlePayloadDownloads": 2,
                    "uiWrites": 0,
                },
                "secretRedaction": {
                    "downloadUrlsPersisted": False,
                    "fidTokensPersisted": False,
                    "shareTokenPersisted": False,
                },
            }

            sealed = module.validate_sealed_sidecar_source(
                evidence,
                inventory_sha256="a" * 64,
                mapped=mapped,
                release_group="quark-share-s01",
                root=root,
                season=1,
                source_url="https://pan.quark.cn/s/example",
                work_item="media-040",
            )
            collected = module.collect_sidecar_package(
                root,
                mapped,
                release_group="quark-share-s01",
                sealed_source_files=sealed,
            )

            self.assertEqual([entry["episode"] for entry in collected], [1, 2])
            self.assertTrue(all(entry["subtitleFormat"] == "srt" for entry in collected))
            with self.assertRaisesRegex(RuntimeError, "sealed source evidence"):
                module.collect_sidecar_package(
                    root,
                    mapped,
                    release_group="quark-share-s01",
                )

    def test_accepts_locally_acquired_complete_season_subtitle_evidence(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            paths = []
            for episode in (1, 2):
                path = root / (
                    f"[Group] Title - {episode:02d} "
                    "[1080p HEVC-10bit].SC.srt"
                )
                path.write_text(
                    f"1\n00:00:01,000 --> 00:00:03,000\n这是第 {episode} 集字幕。\n",
                    encoding="utf-8",
                )
                paths.append(path)
            mapped = [
                {"episode": episode, "video": {"durationSeconds": 100.0}}
                for episode in (1, 2)
            ]
            evidence = {
                "schemaVersion": "media-local-subtitle-package-v1",
                "status": "accepted",
                "workItemId": "media-057",
                "season": 2,
                "sourceReleaseGroup": "UHA-WINGS&VCB-Studio",
                "sourceReference": "urn:btih:0123456789abcdef0123456789abcdef01234567",
                "localStagingRoot": str(root),
                "inventorySha256": "b" * 64,
                "subtitleCount": 2,
                "episodeCoverage": [1, 2],
                "files": [
                    {
                        "episode": episode,
                        "targetPath": str(path),
                        "size": path.stat().st_size,
                        "sha256": module.sha256_file(path),
                        "cueCount": 1,
                        "lastCueSeconds": 3.0,
                        "nonPositiveCueCount": 0,
                        "simplifiedMarkerCount": 2,
                        "traditionalMarkerCount": 0,
                    }
                    for episode, path in zip((1, 2), paths, strict=True)
                ],
                "mutationBoundaries": {
                    "cloudWrites": 0,
                    "databaseDirectWrite": False,
                    "mechanicalScanTriggered": False,
                    "mediaVideoDownloads": 0,
                    "serviceMutation": True,
                    "subtitlePayloadDownloads": 2,
                    "uiWrites": 0,
                },
            }

            sealed = module.validate_sealed_sidecar_source(
                evidence,
                inventory_sha256="b" * 64,
                mapped=mapped,
                release_group="UHA-WINGS&VCB-Studio",
                root=root,
                season=2,
                source_url="urn:btih:0123456789abcdef0123456789abcdef01234567",
                work_item="media-057",
            )
            collected = module.collect_sidecar_package(
                root,
                mapped,
                release_group="UHA-WINGS&VCB-Studio",
                sealed_source_files=sealed,
            )

            self.assertEqual([entry["episode"] for entry in collected], [1, 2])


if __name__ == "__main__":
    unittest.main()
