from __future__ import annotations

import importlib.util
import inspect
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "media-episode-metadata-governance.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_episode_metadata_governance", SCRIPT
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load episode metadata governance script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_inventory(module, root: Path, seasons: dict[int, list[int]]) -> None:
    module.MEDIA_ROOT = root / "Media" / "movie"
    module.DATABASE_ROOT = root / "database"
    module.MEDIA_DB = module.DATABASE_ROOT / "trimmedia.db"
    module.MEDIA_ROOT.mkdir(parents=True)
    module.DATABASE_ROOT.mkdir()
    with sqlite3.connect(module.MEDIA_DB) as connection:
        connection.executescript(
            """
            CREATE TABLE item (
              guid TEXT PRIMARY KEY,
              parent_guid TEXT,
              type TEXT,
              title TEXT,
              original_title TEXT,
              season_number INTEGER,
              episode_number INTEGER,
              tmdb_id INTEGER
            );
            CREATE TABLE item_media (
              guid TEXT PRIMARY KEY,
              item_guid TEXT,
              path TEXT,
              recognition_status INTEGER
            );
            """
        )
        connection.execute(
            "INSERT INTO item VALUES (?,?,?,?,?,?,?,?)",
            ("series", None, "TV", "咒术回战", "呪術廻戦", None, None, 95479),
        )
        for season, episodes in seasons.items():
            season_guid = f"season-{season}"
            connection.execute(
                "INSERT INTO item VALUES (?,?,?,?,?,?,?,?)",
                (
                    season_guid,
                    "series",
                    "Season",
                    f"第 {season} 季",
                    "",
                    season,
                    None,
                    95479,
                ),
            )
            for episode in episodes:
                episode_guid = f"episode-{season}-{episode}"
                connection.execute(
                    "INSERT INTO item VALUES (?,?,?,?,?,?,?,?)",
                    (
                        episode_guid,
                        season_guid,
                        "Episode",
                        f"第 {episode} 集",
                        "",
                        season,
                        episode,
                        95479,
                    ),
                )
                video = (
                    module.MEDIA_ROOT
                    / "TV"
                    / "咒术回战"
                    / f"Season {season:02d}"
                    / f"咒术回战 - S{season:02d}E{episode:02d}.mkv"
                )
                video.parent.mkdir(parents=True, exist_ok=True)
                video.write_bytes(f"video-{season}-{episode}".encode())
                connection.execute(
                    "INSERT INTO item_media VALUES (?,?,?,?)",
                    (f"media-{season}-{episode}", episode_guid, str(video), 3),
                )


def request(*, seasons: list[int], count: int) -> dict:
    return {
        "auditEvidenceSha256": None,
        "expectedEpisodeCount": count,
        "operation": "audit",
        "providerId": "95479",
        "repairEvidenceSha256": None,
        "runId": "jjk-s03-20260816-v1",
        "seasons": seasons,
        "workItemId": "media-073",
    }


class MediaEpisodeMetadataGovernanceTest(unittest.TestCase):
    def test_moves_sealed_payload_before_official_source_detach(self) -> None:
        module = load_module()
        source = inspect.getsource(module.run_canonical_remap_repair)

        transaction_index = source.index('if paths["remapTransaction"].exists()')
        detach_index = source.index('if paths["remapDelete"].exists()')

        self.assertLess(transaction_index, detach_index)

    def test_parses_only_a_bounded_exact_scope(self) -> None:
        module = load_module()
        parsed = module.parse_request(
            {
                "expectedEpisodeCount": 12,
                "operation": "audit",
                "providerId": "95479",
                "runId": "jjk-s03-20260816-v1",
                "seasons": [3],
                "workItemId": "media-073",
            }
        )

        self.assertEqual(parsed["seasons"], [3])
        status = module.parse_request(
            {
                **{
                    key: value
                    for key, value in parsed.items()
                    if key not in {"auditEvidenceSha256", "repairEvidenceSha256"}
                },
                "operation": "status",
            }
        )
        self.assertEqual(status["operation"], "status")
        with self.assertRaisesRegex(RuntimeError, "unsupported fields"):
            module.parse_request({**parsed, "path": "/tmp/escape"})
        with self.assertRaisesRegex(RuntimeError, "sealed audit SHA"):
            module.parse_request({**parsed, "operation": "repair"})

        series = module.parse_request(
            {
                "expectedEpisodeCount": 4,
                "operation": "audit",
                "providerId": "30984",
                "runId": "bleach-series-20260823-v1",
                "seasons": [1, 2],
                "seriesReconciliation": {
                    "canonicalTitle": "死神",
                    "mappings": [
                        {
                            "episodeNumbers": [1, 2],
                            "sourceSeason": 1,
                            "targetSeason": 2,
                        },
                        {
                            "episodeNumbers": [3, 4],
                            "sourceSeason": 2,
                            "targetSeason": 2,
                        },
                    ],
                    "releaseYear": 2004,
                },
                "workItemId": "media-077",
            }
        )
        self.assertEqual(
            module.series_episode_targets(series),
            {(1, 1): (2, 1), (1, 2): (2, 2), (2, 3): (2, 3), (2, 4): (2, 4)},
        )
        rollback = module.parse_request(
            {
                **series,
                "auditEvidenceSha256": "a" * 64,
                "operation": "rollback",
            }
        )
        self.assertEqual(rollback["operation"], "rollback")
        restore = module.parse_request(
            {
                **series,
                "auditEvidenceSha256": "a" * 64,
                "operation": "restore",
            }
        )
        self.assertEqual(restore["operation"], "restore")
        inspection = {
            "identity": {
                "provider": "tmdb",
                "providerId": "30984",
                "providerTitle": "死神",
                "releaseYear": 2004,
            },
            "units": [
                {
                    "providerMapping": {
                        "episodeMap": {"1": 1, "2": 2},
                        "providerSeason": 2,
                    },
                    "season": 1,
                },
                {
                    "providerMapping": {
                        "episodeMap": {"3": 3, "4": 4},
                        "providerSeason": 2,
                    },
                    "season": 2,
                },
            ],
        }
        module.validate_series_reconciliation_inspection(series, inspection)
        with self.assertRaisesRegex(RuntimeError, "provider mapping is inconsistent"):
            module.validate_series_reconciliation_inspection(
                series,
                {
                    **inspection,
                    "units": [
                        inspection["units"][0],
                        {
                            **inspection["units"][1],
                            "providerMapping": {
                                "episodeMap": {"3": 3, "4": 4},
                                "providerSeason": 1,
                            },
                        },
                    ],
                },
            )
        with self.assertRaisesRegex(RuntimeError, "identity is duplicated"):
            module.parse_request(
                {
                    **series,
                    "seriesReconciliation": {
                        **series["seriesReconciliation"],
                        "mappings": [
                            {
                                "episodeNumbers": [1],
                                "sourceSeason": 1,
                                "targetSeason": 2,
                            },
                            {
                                "episodeNumbers": [1, 2, 3],
                                "sourceSeason": 2,
                                "targetSeason": 2,
                            },
                        ],
                    },
                }
            )

    def test_rejects_a_partial_multi_season_refresh(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            create_inventory(module, Path(directory), {1: [1], 2: [1], 3: [1]})

            with self.assertRaisesRegex(RuntimeError, "complete title"):
                module.inventory(request(seasons=[1, 2], count=2))

    def test_reads_series_reconciliation_provider_facts_without_local_root(self) -> None:
        module = load_module()
        scoped_request = module.parse_request(
            {
                "expectedEpisodeCount": 4,
                "operation": "audit",
                "providerId": "30984",
                "runId": "bleach-series-20260823-v1",
                "seasons": [1, 2],
                "seriesReconciliation": {
                    "canonicalTitle": "死神",
                    "mappings": [
                        {
                            "episodeNumbers": [1, 2],
                            "sourceSeason": 1,
                            "targetSeason": 2,
                        },
                        {
                            "episodeNumbers": [3, 4],
                            "sourceSeason": 2,
                            "targetSeason": 2,
                        },
                    ],
                    "releaseYear": 2004,
                },
                "workItemId": "media-077",
            }
        )

        class FakeTmdb:
            @staticmethod
            def fetch_page(url):
                return {"body": url, "url": url}

            @staticmethod
            def page_evidence(result):
                return {"sha256": f"sha:{result['url']}"}

            @staticmethod
            def parse_series_page(_body):
                return {"title": "死神", "year": 2004}

            @staticmethod
            def parse_season_page(_body, *, season_number):
                return {
                    "episodes": [
                        {"episode": episode} for episode in range(1, 51)
                    ],
                    "seasonTitle": "千年血战篇",
                }

        inspection = module.inspect_series_reconciliation_provider(
            scoped_request,
            FakeTmdb,
        )

        self.assertEqual(inspection["identity"]["providerTitle"], "死神")
        self.assertEqual(
            [unit["providerMapping"]["providerSeason"] for unit in inspection["units"]],
            [2, 2],
        )
        self.assertEqual(
            inspection["providerEvidence"]["seasons"]["S02"]["episodeCount"],
            50,
        )

    def test_seals_one_complete_season_without_video_mutation(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            create_inventory(module, Path(directory), {2: [25], 3: [48, 49]})
            observed = module.inventory(request(seasons=[3], count=2))

            plan = module.build_plan(
                request(seasons=[3], count=2),
                observed,
                provider_identity={
                    "providerTitle": "呪術廻戦",
                    "releaseYear": 2020,
                },
            )

        self.assertEqual(observed["scope"], "complete-season")
        self.assertEqual(plan["schemaVersion"], "1.2.0")
        self.assertTrue(plan["sealed"])
        self.assertTrue(plan["metadataOnlyRefresh"])
        self.assertEqual(plan["identity"]["providerTitle"], "呪術廻戦")
        self.assertEqual(len(plan["sourceEvidence"]), 2)
        self.assertEqual(
            {
                item["evidenceMethod"] for item in plan["sourceEvidence"]
            },
            {"bounded-sha256-first-last-4mib-v1"},
        )
        for operation in plan["manifests"]["local"]["forward"]:
            self.assertEqual(operation["sourcePath"], operation["targetPath"])

    def test_inspection_plan_skips_video_digest_reads(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            create_inventory(module, Path(directory), {3: [48, 49]})
            scoped_request = request(seasons=[3], count=2)
            observed = module.inventory(scoped_request)
            original_hash = module.bounded_sha256
            module.bounded_sha256 = lambda _path: self.fail(
                "inspection plan must not hash video payloads"
            )
            try:
                plan = module.build_plan(
                    scoped_request, observed, seal_video_digests=False
                )
            finally:
                module.bounded_sha256 = original_hash

        self.assertEqual(
            {item["digest"] for item in plan["sourceEvidence"]}, {"0" * 64}
        )
        self.assertEqual(
            {item["evidenceMethod"] for item in plan["sourceEvidence"]},
            {"inspection-size-only-v1"},
        )

    def test_seals_one_complete_ordinal_season_path_remap_with_all_sidecars(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            create_inventory(module, Path(directory), {2: [1, 2]})
            scoped_request = request(seasons=[2], count=2)
            observed = module.inventory(scoped_request)
            for row in observed["rows"]:
                video = Path(row["path"])
                video.with_suffix(".nfo").write_text("<episodedetails/>")
                video.with_suffix(".jpg").write_bytes(b"poster")
                video.with_name(f"{video.stem}.zh-CN.ass").write_text("subtitle")
            inspection = {
                "units": [
                    {
                        "episodeCount": 2,
                        "providerMapping": {
                            "episodeMap": {"1": 33, "2": 34},
                            "mode": "ordinal-season",
                            "providerSeason": 2,
                        },
                        "season": 2,
                    }
                ]
            }

            targets = module.ordinal_episode_targets(inspection)
            remap = module.build_remap_plan(scoped_request, observed, targets)
            canonical = module.build_plan(
                scoped_request, observed, episode_targets=targets
            )

        self.assertIsNotNone(remap)
        forward = remap["manifests"]["local"]["forward"]
        self.assertEqual(len(forward), 8)
        self.assertEqual(
            sum(operation["fileKind"] == "video" for operation in forward), 2
        )
        self.assertTrue(
            all(
                "S02E33" in operation["targetPath"]
                or "S02E34" in operation["targetPath"]
                for operation in forward
            )
        )
        self.assertEqual(
            remap["execution"]["manifestSha256"]["localForward"],
            module.stable_sha256(forward),
        )
        self.assertEqual(
            {
                Path(operation["targetPath"]).stem
                for operation in canonical["manifests"]["local"]["forward"]
            },
            {"咒术回战 - S02E33", "咒术回战 - S02E34"},
        )

    def test_seals_multi_root_series_reconciliation_into_one_canonical_season(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_inventory(module, root, {1: [1, 2], 2: [3, 4]})
            first_root = module.MEDIA_ROOT / "TV" / "咒术回战"
            second_root = module.MEDIA_ROOT / "TV" / "咒术回战 第二部分"
            second_root.mkdir()
            original_second_season = first_root / "Season 02"
            moved_second_season = second_root / "Season 02"
            original_second_season.rename(moved_second_season)
            with sqlite3.connect(module.MEDIA_DB) as connection:
                rows = connection.execute(
                    "SELECT guid, path FROM item_media WHERE guid LIKE 'media-2-%'"
                ).fetchall()
                for guid, path_text in rows:
                    path = Path(path_text)
                    connection.execute(
                        "UPDATE item_media SET path = ? WHERE guid = ?",
                        (str(moved_second_season / path.name), guid),
                    )
            for title_root, season_number in ((first_root, 1), (second_root, 2)):
                (title_root / "tvshow.nfo").write_text("<tvshow/>")
                (title_root / "poster.jpg").write_bytes(b"poster")
                season_root = title_root / f"Season {season_number:02d}"
                (season_root / "season.nfo").write_text("<season/>")
                (title_root / f"season{season_number:02d}-poster.jpg").write_bytes(
                    b"season-poster"
                )
                font = season_root / "extras" / "Fonts" / "Fonts.zip"
                font.parent.mkdir(parents=True)
                font.write_bytes(f"font-{season_number}".encode())
            for video in sorted(module.MEDIA_ROOT.rglob("*.mkv")):
                video.with_suffix(".nfo").write_text("<episodedetails/>")
                video.with_suffix(".jpg").write_bytes(b"episode-poster")
                video.with_name(f"{video.stem}.zh-CN.ass").write_text("subtitle")
            scoped_request = module.parse_request(
                {
                    "expectedEpisodeCount": 4,
                    "operation": "audit",
                    "providerId": "95479",
                    "runId": "bleach-series-20260823-v1",
                    "seasons": [1, 2],
                    "seriesReconciliation": {
                        "canonicalTitle": "死神",
                        "mappings": [
                            {
                                "episodeNumbers": [1, 2],
                                "sourceSeason": 1,
                                "targetSeason": 2,
                            },
                            {
                                "episodeNumbers": [3, 4],
                                "sourceSeason": 2,
                                "targetSeason": 2,
                            },
                        ],
                        "releaseYear": 2004,
                    },
                    "workItemId": "media-077",
                }
            )
            observed = module.inventory(scoped_request)
            targets = module.series_episode_targets(scoped_request)
            remap = module.build_remap_plan(scoped_request, observed, targets)
            canonical = module.build_plan(
                scoped_request,
                observed,
                episode_targets=targets,
                provider_identity={"providerTitle": "死神", "releaseYear": 2004},
            )
            source_plan = module.build_plan(scoped_request, observed)
            source_plan_path = root / "source-plan.json"
            source_plan_path.write_text(json.dumps(source_plan))
            subtitle_projection = module.subtitle_layout_projection(source_plan_path)

        self.assertEqual(len(observed["titleRoots"]), 2)
        self.assertEqual(remap["seriesReconciliation"]["canonicalTitle"], "死神")
        self.assertEqual(
            remap["seriesReconciliation"]["targetTitleRoot"],
            str(module.MEDIA_ROOT / "TV" / "死神 (2004) [tmdbid-95479]"),
        )
        forward = remap["manifests"]["local"]["forward"]
        canonical_root = module.MEDIA_ROOT / "TV" / "死神 (2004) [tmdbid-95479]"
        self.assertTrue(
            all(
                canonical_root in Path(item["targetPath"]).parents
                for item in forward
            )
        )
        self.assertEqual(sum(item["fileKind"] == "video" for item in forward), 4)
        self.assertEqual(sum(item["fileKind"] == "subtitle" for item in forward), 4)
        self.assertEqual(sum(item["fileKind"] == "asset" for item in forward), 10)
        self.assertEqual(
            {
                Path(item["targetPath"]).parent.name
                for item in canonical["manifests"]["local"]["forward"]
            },
            {"Season 02"},
        )
        self.assertTrue(
            all(
                "/死神 (2004) [tmdbid-95479]/Season 02/死神 - S02E"
                in item["targetPath"]
                for item in canonical["manifests"]["local"]["forward"]
            )
        )
        self.assertEqual(subtitle_projection["count"], 4)

    def test_restores_only_missing_sealed_sidecars_from_same_video_streams(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.EVIDENCE_ROOT = root / "evidence"
            module.EVIDENCE_ROOT.mkdir()
            title_root = root / "Media" / "movie" / "TV" / "死神 千年血战篇"
            season_root = title_root / "Season 01"
            season_root.mkdir(parents=True)
            operations = []
            sidecars = []
            for episode in (1, 2):
                video = season_root / f"死神 千年血战篇 - S01E{episode:02d}.mkv"
                video.write_bytes(f"video-{episode}".encode())
                operations.append(
                    {
                        "fileKind": "video",
                        "operation": "move",
                        "sourcePath": str(video),
                        "targetPath": str(video),
                    }
                )
                for locale in ("zh-CN", "zh-TW"):
                    sidecar = season_root / (
                        f"死神 千年血战篇 - S01E{episode:02d}.{locale}.ass"
                    )
                    sidecars.append(sidecar)
                    operations.append(
                        {
                            "fileKind": "subtitle",
                            "operation": "move",
                            "sourcePath": str(sidecar),
                            "targetPath": str(sidecar),
                        }
                    )
            remap_plan = {
                "manifests": {"local": {"forward": operations}},
                "seriesReconciliation": {
                    "sourceTitleRoots": [str(title_root)],
                },
            }
            scoped_request = {
                **request(seasons=[1], count=2),
                "auditEvidenceSha256": "a" * 64,
                "seriesReconciliation": None,
            }
            receipt = module.EVIDENCE_ROOT / "episode-subtitle-restore.json"
            original_probe = module.probe_embedded_ass_streams
            original_extract = module.extract_embedded_ass
            module.probe_embedded_ass_streams = lambda _video: {
                "zh-CN": {"index": 2, "title": "简体中文"},
                "zh-TW": {"index": 3, "title": "繁體中文"},
            }

            def fake_extract(_video: Path, stream_index: int, output: Path) -> None:
                output.write_bytes(
                    (
                        "[Script Info]\nTitle: restored\n[V4+ Styles]\n"
                        f"[Events]\nDialogue: 0,{stream_index},restored subtitle text\n"
                    ).encode()
                )

            module.extract_embedded_ass = fake_extract
            try:
                result = module.restore_subtitle_sidecars(
                    scoped_request,
                    remap_plan,
                    "b" * 64,
                    receipt,
                )
                resumed = module.restore_subtitle_sidecars(
                    scoped_request,
                    remap_plan,
                    "b" * 64,
                    receipt,
                )
            finally:
                module.probe_embedded_ass_streams = original_probe
                module.extract_embedded_ass = original_extract

            self.assertTrue(all(path.is_file() for path in sidecars))
            self.assertEqual(result["fileCount"], 4)
            self.assertFalse(result["resumed"])
            self.assertTrue(resumed["resumed"])
            self.assertEqual(
                json.loads(receipt.read_text())["writeBoundaries"]["videoModified"],
                0,
            )

    def test_remap_verification_allows_only_metadata_assets_to_change(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_inventory(module, root, {2: [1, 2]})
            scoped_request = request(seasons=[2], count=2)
            observed = module.inventory(scoped_request)
            for row in observed["rows"]:
                video = Path(row["path"])
                video.with_suffix(".nfo").write_text("<episodedetails/>")
                video.with_suffix(".jpg").write_bytes(b"old-poster")
                video.with_name(f"{video.stem}.zh-CN.ass").write_text("subtitle")
            targets = {(2, 1): (2, 33), (2, 2): (2, 34)}
            remap = module.build_remap_plan(scoped_request, observed, targets)
            canonical = module.build_plan(
                scoped_request,
                observed,
                episode_targets=targets,
            )
            remap_path = root / "remap.json"
            remap_path.write_text(json.dumps(remap), encoding="utf-8")
            for operation in remap["manifests"]["local"]["forward"]:
                Path(operation["sourcePath"]).rename(operation["targetPath"])
                if operation["fileKind"] == "asset":
                    Path(operation["targetPath"]).write_bytes(b"new-metadata")

            result = module.verify_canonical_remap(
                {"canonicalRemap": {"sha256": "a" * 64}},
                {"remapPlan": remap_path},
                canonical,
            )

        self.assertEqual(
            result["fileKindCounts"],
            {"asset": 4, "subtitle": 2, "video": 2},
        )
        self.assertEqual(result["subtitleCount"], 2)

    def test_series_cleanup_removes_only_sealed_metadata_residuals_after_backup(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.MEDIA_ROOT = root / "Media" / "movie"
            module.ROLLBACK_ROOT = root / "rollback"
            source_roots = [
                module.MEDIA_ROOT / "TV" / "旧根一",
                module.MEDIA_ROOT / "TV" / "旧根二",
            ]
            rollback_root = module.ROLLBACK_ROOT / "sealed"
            entries = []
            for index, source_root in enumerate(source_roots, start=1):
                source_root.mkdir(parents=True)
                source = source_root / "tvshow.nfo"
                source.write_text(f"old-{index}")
                rollback = rollback_root / f"source-{index}" / "tvshow.nfo"
                rollback.parent.mkdir(parents=True)
                os.link(source, rollback)
                entries.append(
                    {
                        "digest": module.sha256_file(source),
                        "rollbackPath": str(rollback),
                        "size": source.stat().st_size,
                        "targetPath": str(source),
                    }
                )
            source_backup_path = root / "source-backup.json"
            source_backup_path.write_text(
                json.dumps(
                    {
                        "replaceableMetadataAssets": entries,
                        "schemaVersion": "media-post-governance-metadata-backup-v2",
                        "state": "database-backup-complete",
                    }
                )
            )
            target_root = module.MEDIA_ROOT / "TV" / "死神 (2004) [tmdbid-30984]"
            remap_plan_path = root / "remap-plan.json"
            remap_plan_path.write_text(
                json.dumps(
                    {
                        "manifests": {"local": {"forward": []}},
                        "seriesReconciliation": {
                            "canonicalTitle": "死神",
                            "releaseYear": 2004,
                            "sourceTitleRoots": [str(path) for path in source_roots],
                            "targetTitleRoot": str(target_root),
                        },
                    }
                )
            )
            scoped_request = {
                "seriesReconciliation": {
                    "canonicalTitle": "死神",
                    "releaseYear": 2004,
                }
            }

            result = module.cleanup_series_source_roots(
                scoped_request,
                source_backup_path,
                remap_plan_path,
            )

            self.assertEqual(result["metadataAssetCount"], 2)
            self.assertEqual(result["removedRootCount"], 2)
            self.assertTrue(all(not path.exists() for path in source_roots))
            self.assertTrue(
                all(Path(entry["rollbackPath"]).is_file() for entry in entries)
            )

    def test_episode_contract_keeps_parent_projection_as_advisory(self) -> None:
        module = load_module()
        inspection = {
            "identity": {"provider": "tmdb", "providerId": "31910"},
            "units": [
                {
                    "accepted": False,
                    "episodeGapCount": 0,
                    "missingA": [],
                    "missingB": ["metadata.local-nfo", "artwork.poster"],
                    "missingC": [],
                    "season": 2,
                }
            ],
        }

        adjusted = module.apply_episode_acceptance_contract(
            {"metadataOnlyRefresh": True},
            inspection,
        )
        blocked = module.apply_episode_acceptance_contract(
            {"metadataOnlyRefresh": True},
            {
                **inspection,
                "units": [
                    {
                        **inspection["units"][0],
                        "episodeGapCount": 1,
                    }
                ],
            },
        )

        self.assertTrue(adjusted["units"][0]["accepted"])
        self.assertEqual(adjusted["units"][0]["missingB"], [])
        self.assertEqual(
            adjusted["units"][0]["acceptanceAdvisories"],
            {
                "fnosParentProjection": [
                    "artwork.poster",
                    "metadata.local-nfo",
                ]
            },
        )
        self.assertFalse(blocked["units"][0]["accepted"])

    def test_audit_accepts_complete_title_when_only_parent_projection_is_missing(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_inventory(module, root, {1: [1]})
            module.EVIDENCE_ROOT = root / "evidence"
            helper = root / "official-api-helper.mjs"
            helper.write_text("export {};\n", encoding="utf-8")
            module.OFFICIAL_API_HELPER = helper
            inspection = {
                "identity": {
                    "provider": "tmdb",
                    "providerId": "95479",
                    "providerTitle": "呪術廻戦",
                    "releaseYear": 2020,
                },
                "units": [
                    {
                        "accepted": False,
                        "databaseProjectionAdvisoryEpisodes": {
                            "date.episode": [1]
                        },
                        "episodeCount": 1,
                        "episodeGapCount": 0,
                        "episodeGaps": [],
                        "missingA": [],
                        "missingB": ["metadata.local-nfo", "artwork.poster"],
                        "missingC": [],
                        "providerMapping": {
                            "episodeMap": {"1": 1},
                            "mode": "exact-number",
                            "providerSeason": 1,
                        },
                        "season": 1,
                    }
                ],
                "writeBoundaries": {
                    "cloud": 0,
                    "databaseDirect": 0,
                    "mechanicalScan": 0,
                    "ui": 0,
                },
            }

            class Repair:
                @staticmethod
                def plan_records(_plan):
                    return []

                @staticmethod
                def inspect_metadata(_plan, _records, _tmdb):
                    return inspection

            module.load_dependencies = lambda: (
                {"repair": Repair, "tmdb": object()},
                {"repair": "a" * 64, "tmdb": "b" * 64},
            )

            result = module.run_audit(request(seasons=[1], count=1))
            evidence = json.loads(
                Path(result["evidencePath"]).read_text(encoding="utf-8")
            )
            acceptance = module.sealed_audit_acceptance_projection(
                request(seasons=[1], count=1),
                module.evidence_paths(request(seasons=[1], count=1)),
                {
                    "duplicatePathCount": 0,
                    "expectedPathCount": 1,
                    "missingPathCount": 0,
                    "presentPathCount": 1,
                },
                {"databaseRowCount": 1, "mismatchCount": 0},
            )

        self.assertTrue(result["accepted"])
        self.assertIsNone(result["canonicalRemap"])
        self.assertEqual(
            acceptance,
            {
                "accepted": True,
                "acceptedSeasonCount": 1,
                "auditEvidenceSha256": result["evidenceSha256"],
                "currentPathsReady": True,
                "currentTitlesReady": True,
                "episodeCount": 1,
                "episodeGapCount": 0,
                "rejectedSeasons": [],
                "seasonCount": 1,
                "sourceAccepted": True,
            },
        )
        self.assertTrue(evidence["inspection"]["units"][0]["accepted"])
        self.assertEqual(
            evidence["inspection"]["units"][0]["acceptanceAdvisories"],
            {
                "fnosParentProjection": [
                    "artwork.poster",
                    "metadata.local-nfo",
                ]
            },
        )

    def test_projects_500_episode_gaps_as_three_aggregated_fields(self) -> None:
        module = load_module()
        inspection = {
            "units": [
                {
                    "accepted": False,
                    "episodeCount": 500,
                    "episodeGapCount": 500,
                    "episodeGaps": [
                        {
                            "episode": episode,
                            "missingFields": [
                                "date.episode",
                                "summary.episode",
                                "title.episode",
                            ],
                        }
                        for episode in range(1, 501)
                    ],
                    "season": 1,
                }
            ]
        }

        result = module.inspection_projection(inspection)

        self.assertEqual(result["episodeGapCount"], 500)
        self.assertEqual(
            result["seasons"][0]["missingFieldCounts"],
            {
                "date.episode": 500,
                "summary.episode": 500,
                "title.episode": 500,
            },
        )
        self.assertEqual(
            result["seasons"][0]["gapEpisodeRangesByField"],
            {
                "date.episode": ["E001-E500"],
                "summary.episode": ["E001-E500"],
                "title.episode": ["E001-E500"],
            },
        )
        self.assertEqual(
            result["seasons"][0]["databaseProjectionAdvisoryCounts"], {}
        )

    def test_status_reports_exact_artifacts_without_writing_evidence(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            create_inventory(module, root, {3: [48]})
            module.EVIDENCE_ROOT = root / "evidence"
            module.METADATA_STAGING_ROOT = root / "staging"
            scoped_request = module.parse_request(
                {
                    "expectedEpisodeCount": 12,
                    "operation": "status",
                    "providerId": "95479",
                    "runId": "jjk-s03-20260816-v1",
                    "seasons": [3],
                    "workItemId": "media-073",
                }
            )
            paths = module.evidence_paths(scoped_request)
            module.write_json_once(
                paths["audit"],
                {
                    "schemaVersion": "media-episode-metadata-audit-v1",
                    "state": "episode-metadata-audited",
                },
            )
            original_runner_count = module.metadata_runner_count
            original_application_roots = module.TRIM_APPLICATION_ROOTS
            module.metadata_runner_count = lambda: 0
            module.TRIM_APPLICATION_ROOTS = ()
            try:
                result = module.run_status(scoped_request)
            finally:
                module.metadata_runner_count = original_runner_count
                module.TRIM_APPLICATION_ROOTS = original_application_roots

        self.assertEqual(result["phase"], "audited")
        self.assertTrue(result["artifacts"]["audit"]["exists"])
        self.assertFalse(result["artifacts"]["transaction"]["exists"])
        self.assertIn("title", result["itemMetadataSchema"]["metadataColumns"])
        self.assertEqual(
            result["providerSeasonCounts"],
            {"counts": {"S03": 1}, "total": 1},
        )
        self.assertFalse(result["officialItem"]["available"])
        self.assertEqual(result["trimOfficialRoutes"]["candidateCount"], 0)
        self.assertEqual(result["writeBoundaries"]["evidence"], 0)

    def test_status_switches_to_canonical_subtitles_after_transaction(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                "plan": root / "canonical-plan.json",
                "sourcePlan": root / "source-plan.json",
                "transaction": root / "transaction.json",
            }
            paths["plan"].write_text("{}", encoding="utf-8")
            paths["sourcePlan"].write_text("{}", encoding="utf-8")

            before = module.status_subtitle_plan(paths)
            paths["transaction"].write_text("{}", encoding="utf-8")
            after = module.status_subtitle_plan(paths)

        self.assertEqual(before, paths["sourcePlan"])
        self.assertEqual(after, paths["plan"])

    def test_projects_only_scoped_backup_subtitle_associations(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.BACKUP_ROOT = root / "backups"
            database_root = module.BACKUP_ROOT / "media-008" / "database"
            database_root.mkdir(parents=True)
            database = database_root / "trimmedia.db"
            with sqlite3.connect(database) as connection:
                connection.executescript(
                    """
                    CREATE TABLE item (
                      guid TEXT PRIMARY KEY,
                      parent_guid TEXT,
                      type TEXT,
                      tmdb_id INTEGER,
                      season_number INTEGER,
                      episode_number INTEGER
                    );
                    CREATE TABLE item_media (
                      guid TEXT PRIMARY KEY,
                      item_guid TEXT,
                      path TEXT
                    );
                    CREATE TABLE media_stream (
                      guid TEXT PRIMARY KEY,
                      media_guid TEXT,
                      title TEXT,
                      codec_name TEXT,
                      codec_type TEXT,
                      language TEXT,
                      is_external INTEGER,
                      origin_filename TEXT,
                      filepath TEXT,
                      source_id TEXT,
                      source TEXT,
                      trim_id TEXT,
                      status INTEGER
                    );
                    """
                )
                connection.executemany(
                    "INSERT INTO item VALUES (?,?,?,?,?,?)",
                    [
                        ("series", None, "TV", 95479, None, None),
                        ("season-2", "series", "Season", 95479, 2, None),
                        ("episode-1", "season-2", "Episode", 95479, 2, 1),
                        ("episode-2", "season-2", "Episode", 95479, 2, 2),
                    ],
                )
                connection.executemany(
                    "INSERT INTO item_media VALUES (?,?,?)",
                    [
                        ("media-1", "episode-1", "/media/S02E01.mkv"),
                        ("media-2", "episode-2", "/media/S02E02.mkv"),
                    ],
                )
                connection.execute(
                    "INSERT INTO media_stream VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        "subtitle-1",
                        "media-1",
                        "简体中文",
                        "ass",
                        "subtitle",
                        "chi",
                        1,
                        "S02E01.ass",
                        "/subtitle/S02E01.ass",
                        "source-1",
                        "external",
                        "trim-1",
                        1,
                    ),
                )
            backup_path = root / "metadata-backup.json"
            backup_path.write_text(
                json.dumps(
                    {
                        "databaseBackupRoot": str(database_root),
                        "schemaVersion": "media-post-governance-metadata-backup-v2",
                    }
                ),
                encoding="utf-8",
            )

            result = module.backup_subtitle_schema_projection(
                backup_path,
                request(seasons=[2], count=2),
            )
            changed = module.backup_subtitle_schema_projection(
                backup_path,
                request(seasons=[2], count=3),
            )

        self.assertTrue(result["available"])
        self.assertEqual(result["codecTypeCounts"], {"subtitle": 1})
        self.assertEqual(result["episodeCount"], 2)
        self.assertEqual(result["scopedStreamCount"], 1)
        self.assertEqual(result["streamCount"], 1)
        self.assertEqual(result["subtitleEpisodeCount"], 1)
        self.assertEqual(result["episodes"][0]["streams"][0]["filepath"], "/subtitle/S02E01.ass")
        self.assertEqual(result["episodes"][1]["streams"], [])

        self.assertTrue(changed["scopeChanged"])
        self.assertEqual(changed["episodeCount"], 2)

    def test_projects_only_bounded_official_metadata_route_candidates(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "app.js").write_bytes(
                b'"/v/api/v1/item/metadata" "/v/api/v1/play/info" '
                b'"/api/v1/scrap/removeFromBlackByPath" displayepisode uniqueid '
                b' /saveEditDetail '
                + "编辑元数据".encode("utf-8")
            )
            (root / "secret.txt").write_text(
                "/v/api/v1/item/must-not-be-read", encoding="utf-8"
            )

            result = module.trim_official_route_projection((root,))

        self.assertEqual(
            result["routes"],
            [
                "/api/v1/scrap/removeFromBlackByPath",
                "/v/api/v1/item/metadata",
            ],
        )
        self.assertEqual(
            result["nfoTokenPresence"],
            {
                "displayepisode": True,
                "displayseason": False,
                "episodedetails": False,
                "uniqueid": True,
            },
        )
        self.assertEqual(
            result["literals"],
            [
                "/api/v1/scrap/removeFromBlackByPath",
                "/v/api/v1/item/metadata",
            ],
        )
        self.assertEqual(result["scannedFileCount"], 1)
        self.assertIn("/saveEditDetail", result["mutationRoutes"])
        self.assertIn("metadata-edit", result["uiContractContexts"])
        self.assertTrue(
            any("/v/api/v1/item/metadata" in item for item in result["routeContexts"])
        )

    def test_reuses_only_identity_bound_metadata_and_transaction_evidence(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repair_path = root / "metadata-repair.json"
            repair_path.write_text(
                json.dumps(
                    {
                        "assets": [{"path": "one"}, {"path": "two"}],
                        "inspection": {
                            "identity": {"providerId": "95479"},
                            "writeBoundaries": {"databaseDirect": 0},
                        },
                        "mutationBoundaries": {"formalMetadataWrites": 2},
                        "repairAttempt": 1,
                        "schemaVersion": "media-admin-metadata-repair-v1",
                        "state": "metadata-assets-committed",
                        "taskId": "postmeta-media-073-jjk-s03-20260816-v1",
                    }
                ),
                encoding="utf-8",
            )
            repair = module.existing_metadata_repair_summary(
                repair_path, "postmeta-media-073-jjk-s03-20260816-v1"
            )
            self.assertEqual(repair["metadataAssetCount"], 2)

            scoped_request = module.parse_request(
                {
                    "auditEvidenceSha256": "a" * 64,
                    "expectedEpisodeCount": 12,
                    "operation": "repair",
                    "providerId": "95479",
                    "runId": "jjk-s03-20260816-v1",
                    "seasons": [3],
                    "workItemId": "media-073",
                }
            )
            transaction_path = root / "transaction.json"
            transaction_path.write_text(
                json.dumps(
                    {
                        "auditEvidenceSha256": "a" * 64,
                        "metadataRepair": repair,
                        "planSha256": "plan-sha",
                        "readd": {
                            "officialDeleteCount": 1,
                            "officialDeleteFileValue": 0,
                            "operationCount": 12,
                        },
                        "request": module.audit_request_identity(scoped_request),
                        "schemaVersion": "media-episode-metadata-repair-v1",
                        "state": "episode-metadata-repair-committed",
                    }
                ),
                encoding="utf-8",
            )
            transaction = module.committed_transaction_result(
                scoped_request,
                {
                    "inspection": {"writeBoundaries": {"databaseDirect": 0}},
                    "planSha256": "plan-sha",
                },
                transaction_path,
            )

        self.assertEqual(transaction["readdCount"], 12)
        self.assertEqual(transaction["officialDeleteFileValue"], 0)

    def test_allows_only_the_sealed_provider_identity_repair_resume(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                name: root / f"{name}.json"
                for name in (
                    "backup",
                    "failure",
                    "remapDelete",
                    "remapTransaction",
                    "sourceBackup",
                )
            }
            payloads = {
                "backup": {
                    "schemaVersion": "media-post-governance-metadata-backup-v2",
                    "state": "database-backup-complete",
                },
                "sourceBackup": {
                    "schemaVersion": "media-post-governance-metadata-backup-v2",
                    "state": "database-backup-complete",
                },
                "failure": {
                    "operation": "repair",
                    "reason": "metadata repair requires one verified provider identity",
                    "schemaVersion": "media-episode-metadata-failure-v1",
                    "state": "failed",
                },
                "remapDelete": {
                    "schemaVersion": "media-episode-path-remap-delete-v1",
                    "state": "source-scope-detached",
                },
                "remapTransaction": {
                    "schemaVersion": "media-episode-path-remap-v1",
                    "state": "canonical-paths-remapped",
                },
            }
            for name, payload in payloads.items():
                paths[name].write_text(json.dumps(payload), encoding="utf-8")
            recorded = {
                "backup": "a" * 64,
                "manifest": "b" * 64,
                "readd": "c" * 64,
                "repair": "d" * 64,
                "tmdb": "e" * 64,
                "transaction": "f" * 64,
            }
            current = {**recorded, "repair": "0" * 64}
            audit = {
                "canonicalRemap": {"sha256": "1" * 64},
                "dependencySha256": recorded,
            }

            amendment = module.verified_repair_dependency_amendment(
                audit, current, paths
            )
            with self.assertRaisesRegex(RuntimeError, "dependency identity changed"):
                module.verified_repair_dependency_amendment(
                    audit,
                    {**current, "tmdb": "1" * 64},
                    paths,
                )

        self.assertEqual(amendment["previousRepairSha256"], "d" * 64)
        self.assertEqual(amendment["newRepairSha256"], "0" * 64)
        self.assertEqual(
            amendment["reasonCode"],
            "provider-title-normalization-after-canonical-remap",
        )

    def test_allows_only_the_failed_shared_root_manifest_resume(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {
                name: root / f"{name}.json"
                for name in (
                    "backup",
                    "failure",
                    "remapDelete",
                    "remapPlan",
                    "remapTransaction",
                    "repair",
                    "sourceBackup",
                )
            }
            for name, payload in {
                "failure": {
                    "operation": "repair",
                    "reason": "command failed (1): Local source and target allowlists must be distinct.",
                    "schemaVersion": "media-episode-metadata-failure-v1",
                    "state": "failed",
                },
                "remapDelete": {
                    "schemaVersion": "media-episode-path-remap-delete-v1",
                    "state": "source-scope-detached",
                },
                "remapPlan": {
                    "seriesReconciliation": {
                        "canonicalTitle": "死神",
                    }
                },
                "sourceBackup": {
                    "schemaVersion": "media-post-governance-metadata-backup-v2",
                    "state": "database-backup-complete",
                },
            }.items():
                paths[name].write_text(json.dumps(payload), encoding="utf-8")
            recorded = {
                "backup": "a" * 64,
                "manifest": "b" * 64,
                "readd": "c" * 64,
                "repair": "d" * 64,
                "tmdb": "e" * 64,
                "transaction": "f" * 64,
            }
            current = {**recorded, "manifest": "0" * 64}
            audit = {
                "canonicalRemap": {"sha256": "1" * 64},
                "dependencySha256": recorded,
            }

            amendment = module.verified_repair_dependency_amendment(
                audit,
                current,
                paths,
            )
            paths["remapTransaction"].write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "not resumable"):
                module.verified_repair_dependency_amendment(
                    audit,
                    current,
                    paths,
                )

        self.assertEqual(amendment["previousManifestSha256"], "b" * 64)
        self.assertEqual(amendment["newManifestSha256"], "0" * 64)
        self.assertEqual(
            amendment["reasonCode"],
            "series-reconciliation-shared-root-allowlist",
        )

    def test_resumed_readd_adds_only_missing_paths_in_bounded_batches(self) -> None:
        module = load_module()
        present = {"/media/one.mkv"}
        records = [
            {"pathText": path}
            for path in (
                "/media/one.mkv",
                "/media/two.mkv",
                "/media/three.mkv",
            )
        ]

        class FakeReadd:
            RE_ADD_ROUTE = "/readd"

            @staticmethod
            def target_records(_plan):
                return records

            @staticmethod
            def verify_records(_records, _receipt):
                return None

            @staticmethod
            def trim_process_running():
                return True

            @staticmethod
            def wait_for_running_tasks(_helper, timeout):
                self.assertEqual(timeout, 180)

            @staticmethod
            def canonical_rows(_paths):
                return [{"path": path} for path in sorted(present)]

            @staticmethod
            def restore_refresh_sidecars(_plan, _sidecars):
                return (0, 0)

            @staticmethod
            def wait_for_refresh_scope(_plan, _records, _identity, timeout):
                self.assertEqual(timeout, 180)
                return {"rootGuid": "root"}

            @staticmethod
            def refresh_scope(_plan, _records, _identity):
                return {"rootGuid": "root"}

        class FakeHelper:
            @staticmethod
            def request(_route, *, method, payload):
                self.assertEqual(method, "POST")
                present.add(payload["path"])
                return {"code": 0}

            @staticmethod
            def require_ok(response, _label):
                return response

        original_batch_size = module.RESUME_READD_BATCH_SIZE
        module.RESUME_READD_BATCH_SIZE = 1
        try:
            first = module.execute_resumed_exact_path_readd(
                FakeReadd,
                {"workItemId": "media-008"},
                FakeHelper,
                refresh_identity={"provider": "tmdb", "providerId": "31910"},
                refresh_receipt={},
                refresh_sidecars=[],
            )
            second = module.execute_resumed_exact_path_readd(
                FakeReadd,
                {"workItemId": "media-008"},
                FakeHelper,
                refresh_identity={"provider": "tmdb", "providerId": "31910"},
                refresh_receipt={},
                refresh_sidecars=[],
            )
        finally:
            module.RESUME_READD_BATCH_SIZE = original_batch_size

        self.assertEqual(first["state"], "pending")
        self.assertEqual(first["remainingPathCount"], 1)
        self.assertEqual(second["state"], "committed")
        self.assertEqual(second["remainingPathCount"], 0)
        self.assertEqual(present, {record["pathText"] for record in records})

    def test_official_subtitle_projection_skips_an_oversized_title_scope(
        self,
    ) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            helper = root / "official-api-helper.mjs"
            helper.write_text("export {};\n", encoding="utf-8")
            module.OFFICIAL_API_HELPER = helper
            plan_path = root / "plan.json"
            plan_path.write_text(
                json.dumps(
                    {
                        "manifests": {
                            "local": {
                                "forward": [
                                    {
                                        "fileKind": "video",
                                        "targetPath": f"/Media/TV/Title/Season 01/Title - S01E{episode:03d}.mkv",
                                    }
                                    for episode in range(1, 102)
                                ]
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = module.official_subtitle_projection(plan_path)

        self.assertEqual(
            result,
            {
                "available": False,
                "expectedPathCount": 101,
                "queryLimit": 100,
                "reason": "scope-exceeds-bounded-query",
            },
        )


if __name__ == "__main__":
    unittest.main()
