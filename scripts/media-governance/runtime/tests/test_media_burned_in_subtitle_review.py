#!/usr/bin/env python3
"""通用烧录字幕只读复核器的身份、采样和识别边界测试。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-burned-in-subtitle-review.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_burned_in_subtitle_review", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load burned-in subtitle review script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaBurnedInSubtitleReviewTest(unittest.TestCase):
    def test_builds_distinct_bounded_timestamps(self):
        module = load_module()

        self.assertEqual(
            module.sample_seconds(100.0, (0.0, 0.12, 0.12, 0.5, 0.99, 1.0)),
            [12, 50, 95],
        )

    def test_requires_readable_simplified_chinese_in_lower_band(self):
        module = load_module()
        lines = [
            {
                "hanCount": 4,
                "hasKana": False,
                "score": 0.99,
                "simplifiedMarkerCount": 0,
                "text": "繁體字幕",
                "yCenter": 900,
            },
            {
                "hanCount": 5,
                "hasKana": False,
                "score": 0.97,
                "simplifiedMarkerCount": 2,
                "text": "这里没有问题",
                "yCenter": 820,
            },
            {
                "hanCount": 5,
                "hasKana": True,
                "score": 0.99,
                "simplifiedMarkerCount": 2,
                "text": "这里かな文字",
                "yCenter": 840,
            },
        ]

        selected = module.select_simplified_chinese(lines, 1000)

        self.assertEqual(selected["text"], "这里没有问题")

    def test_seals_unique_episode_identity_and_release_group(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = Path(temporary) / "movie"
            source_root = media_root / "title"
            source_root.mkdir(parents=True)
            videos = []
            rows = []
            for episode in (1, 2):
                path = source_root / f"[Group] Title [{episode:02d}].mkv"
                path.write_bytes((f"episode-{episode}" * 1024).encode())
                stat = path.stat()
                videos.append(
                    {
                        "boundedSha256": module.bounded_digest(path),
                        "durationSeconds": 1200.0,
                        "mtimeMs": stat.st_mtime_ns // 1_000_000,
                        "path": str(path),
                        "relativePath": path.name,
                        "size": stat.st_size,
                        "streams": [
                            {"codec": "hevc", "type": "video"},
                            {"codec": "flac", "type": "audio"},
                        ],
                    }
                )
                rows.append(
                    {
                        "episode_number": episode,
                        "grandparent_tmdb_id": 123,
                        "path": str(path),
                        "season_number": 1,
                        "type": "Episode",
                    }
                )
            inventory = {
                "database": {"rows": rows},
                "files": {"subtitles": [], "videos": videos},
                "schemaVersion": "1.0.0",
                "sourceRoot": str(source_root),
                "summary": {
                    "embeddedSubtitleStreamCount": 0,
                    "subtitleCount": 0,
                    "videoCount": 2,
                },
                "workItemId": "media-999",
            }
            original_media_root = module.MEDIA_ROOT
            module.MEDIA_ROOT = media_root
            try:
                episodes, provider_ref, season_sources = module.seal_episode_sources(
                    inventory, "Group"
                )
            finally:
                module.MEDIA_ROOT = original_media_root

        self.assertEqual(provider_ref, "tmdb:123")
        self.assertEqual(
            season_sources, {1: {"group": "Group", "marker": "Group"}}
        )
        self.assertEqual(
            [(row["season"], row["episode"]) for row in episodes],
            [(1, 1), (1, 2)],
        )

    def test_rejects_mixed_or_missing_release_group(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = Path(temporary) / "movie"
            source_root = media_root / "title"
            source_root.mkdir(parents=True)
            path = source_root / "[Other] Title [01].mkv"
            path.write_bytes(b"episode")
            stat = path.stat()
            inventory = {
                "database": {
                    "rows": [
                        {
                            "episode_number": 1,
                            "grandparent_tmdb_id": 123,
                            "path": str(path),
                            "season_number": 1,
                            "type": "Episode",
                        }
                    ]
                },
                "files": {
                    "subtitles": [],
                    "videos": [
                        {
                            "boundedSha256": module.bounded_digest(path),
                            "durationSeconds": 1200.0,
                            "mtimeMs": stat.st_mtime_ns // 1_000_000,
                            "path": str(path),
                            "relativePath": path.name,
                            "size": stat.st_size,
                            "streams": [
                                {"codec": "hevc", "type": "video"},
                                {"codec": "flac", "type": "audio"},
                            ],
                        }
                    ],
                },
                "schemaVersion": "1.0.0",
                "sourceRoot": str(source_root),
                "summary": {
                    "embeddedSubtitleStreamCount": 0,
                    "subtitleCount": 0,
                    "videoCount": 1,
                },
                "workItemId": "media-999",
            }
            original_media_root = module.MEDIA_ROOT
            module.MEDIA_ROOT = media_root
            try:
                with self.assertRaisesRegex(RuntimeError, "release group"):
                    module.seal_episode_sources(inventory, "Group")
            finally:
                module.MEDIA_ROOT = original_media_root

    def test_allows_sealed_embedded_streams_only_for_explicit_burned_in_review(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = Path(temporary) / "movie"
            source_root = media_root / "title"
            source_root.mkdir(parents=True)
            path = source_root / "[Group] Title [01].mkv"
            path.write_bytes(b"episode" * 1024)
            stat = path.stat()
            inventory = {
                "database": {
                    "rows": [
                        {
                            "episode_number": 1,
                            "grandparent_tmdb_id": 123,
                            "path": str(path),
                            "season_number": 1,
                            "type": "Episode",
                        }
                    ]
                },
                "files": {
                    "subtitles": [],
                    "videos": [
                        {
                            "boundedSha256": module.bounded_digest(path),
                            "durationSeconds": 1200.0,
                            "mtimeMs": stat.st_mtime_ns // 1_000_000,
                            "path": str(path),
                            "relativePath": path.name,
                            "size": stat.st_size,
                            "streams": [
                                {"codec": "hevc", "type": "video"},
                                {
                                    "codec": "ass",
                                    "default": 1,
                                    "language": "chi",
                                    "type": "subtitle",
                                },
                            ],
                        }
                    ],
                },
                "schemaVersion": "1.0.0",
                "sourceRoot": str(source_root),
                "summary": {
                    "embeddedSubtitleStreamCount": 1,
                    "subtitleCount": 0,
                    "videoCount": 1,
                },
                "workItemId": "media-999",
            }
            original_media_root = module.MEDIA_ROOT
            module.MEDIA_ROOT = media_root
            try:
                with self.assertRaisesRegex(RuntimeError, "embedded subtitle"):
                    module.seal_episode_sources(
                        inventory,
                        "Group",
                        target_provider_id=123,
                    )
                episodes, provider_ref, _season_sources = (
                    module.seal_episode_sources(
                        inventory,
                        "Group",
                        allow_existing_embedded=True,
                        target_provider_id=123,
                    )
                )
            finally:
                module.MEDIA_ROOT = original_media_root

        self.assertEqual(provider_ref, "tmdb:123")
        self.assertEqual(episodes[0]["embeddedSubtitleStreamCount"], 1)

    def test_seals_distinct_source_group_and_marker_for_each_season(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = Path(temporary) / "movie"
            source_root = media_root / "title"
            source_root.mkdir(parents=True)
            videos = []
            rows = []
            for season, marker in ((1, "S01.CHS"), (2, "S02.CHS-JPN")):
                path = source_root / f"Title.{marker}.E01.mp4"
                path.write_bytes((f"season-{season}" * 1024).encode())
                stat = path.stat()
                videos.append(
                    {
                        "boundedSha256": module.bounded_digest(path),
                        "durationSeconds": 1200.0,
                        "mtimeMs": stat.st_mtime_ns // 1_000_000,
                        "path": str(path),
                        "relativePath": path.name,
                        "size": stat.st_size,
                        "streams": [
                            {"codec": "hevc", "type": "video"},
                            {"codec": "aac", "type": "audio"},
                        ],
                    }
                )
                rows.append(
                    {
                        "episode_number": 1,
                        "grandparent_tmdb_id": 123,
                        "path": str(path),
                        "season_number": season,
                        "type": "Episode",
                    }
                )
            inventory = {
                "database": {"rows": rows},
                "files": {"subtitles": [], "videos": videos},
                "schemaVersion": "1.0.0",
                "sourceRoot": str(source_root),
                "summary": {
                    "embeddedSubtitleStreamCount": 0,
                    "subtitleCount": 0,
                    "videoCount": 2,
                },
                "workItemId": "media-999",
            }
            original_media_root = module.MEDIA_ROOT
            module.MEDIA_ROOT = media_root
            try:
                episodes, provider_ref, season_sources = module.seal_episode_sources(
                    inventory,
                    season_source_groups={1: "Local-S1", 2: "Local-S2"},
                    season_source_markers={
                        1: "S01.CHS",
                        2: "S02.CHS-JPN",
                    },
                )
            finally:
                module.MEDIA_ROOT = original_media_root

        self.assertEqual(provider_ref, "tmdb:123")
        self.assertEqual(
            [(row["season"], row["episode"]) for row in episodes],
            [(1, 1), (2, 1)],
        )
        self.assertEqual(
            season_sources,
            {
                1: {"group": "Local-S1", "marker": "S01.CHS"},
                2: {"group": "Local-S2", "marker": "S02.CHS-JPN"},
            },
        )

    def test_parses_unique_non_negative_season_values(self):
        module = load_module()

        self.assertEqual(
            module.parse_season_map(["1=Group A", "2=Group B"], "source group"),
            {1: "Group A", 2: "Group B"},
        )
        with self.assertRaisesRegex(RuntimeError, "unique non-negative"):
            module.parse_season_map(["1=Group A", "1=Group B"], "source group")

    def test_selects_target_provider_and_collapses_identical_official_rows(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = Path(temporary) / "movie"
            source_root = media_root / "collection"
            source_root.mkdir(parents=True)
            target = source_root / "[Group] Title [01].mkv"
            other = source_root / "[Other] Movie.mkv"
            target.write_bytes(b"target" * 1024)
            other.write_bytes(b"other" * 1024)

            def video(path):
                stat = path.stat()
                return {
                    "boundedSha256": module.bounded_digest(path),
                    "durationSeconds": 1200.0,
                    "mtimeMs": stat.st_mtime_ns // 1_000_000,
                    "path": str(path),
                    "relativePath": path.name,
                    "size": stat.st_size,
                    "streams": [
                        {"codec": "hevc", "type": "video"},
                        {"codec": "flac", "type": "audio"},
                    ],
                }

            inventory = {
                "database": {
                    "rows": [
                        {
                            "episode_number": 1,
                            "grandparent_tmdb_id": 123,
                            "parent_season": 1,
                            "path": str(target),
                            "type": "Episode",
                        },
                        {
                            "episode_number": 1,
                            "season_number": 1,
                            "tmdb_id": 123,
                            "path": str(target),
                            "type": "Episode",
                        },
                        {"path": str(other), "tmdb_id": 456, "type": "Movie"},
                    ]
                },
                "files": {"subtitles": [], "videos": [video(target), video(other)]},
                "schemaVersion": "1.0.0",
                "sourceRoot": str(source_root),
                "summary": {
                    "embeddedSubtitleStreamCount": 0,
                    "subtitleCount": 0,
                    "videoCount": 2,
                },
                "workItemId": "media-999",
            }
            original_media_root = module.MEDIA_ROOT
            module.MEDIA_ROOT = media_root
            try:
                episodes, provider_ref, _season_sources = module.seal_episode_sources(
                    inventory,
                    "Group",
                    target_provider_id=123,
                )
                self.assertEqual(provider_ref, "tmdb:123")
                self.assertEqual([(row["season"], row["episode"]) for row in episodes], [(1, 1)])

                inventory["database"]["rows"].append(
                    {"path": str(target), "tmdb_id": 456, "type": "Movie"}
                )
                with self.assertRaisesRegex(RuntimeError, "conflicting provider rows"):
                    module.seal_episode_sources(
                        inventory,
                        "Group",
                        target_provider_id=123,
                    )
                inventory["database"]["rows"].pop()
                inventory["database"]["rows"][1]["episode_number"] = 2
                with self.assertRaisesRegex(RuntimeError, "conflicting provider episode rows"):
                    module.seal_episode_sources(
                        inventory,
                        "Group",
                        target_provider_id=123,
                    )
            finally:
                module.MEDIA_ROOT = original_media_root

    def test_resume_review_preserves_prior_matches_and_skips_attempted_seconds(self):
        module = load_module()
        source = {
            "boundedSha256": "a" * 64,
            "bytes": 10,
            "durationSeconds": 100.0,
            "episode": 1,
            "mtimeMs": 1,
            "path": "/tmp/episode.mkv",
            "relativePath": "episode.mkv",
            "season": 1,
        }
        existing = {
            **source,
            "attemptCount": 1,
            "attempts": [{"second": 22}],
            "matchedSimplifiedChinese": [
                {"second": 22, "text": "这里没有问题"}
            ],
            "sealedBurnedIn": False,
            "sourceTags": {},
        }
        extracted = []
        original_extract = module.extract_frame
        original_projection = module.projection
        original_source_tags = module.source_tags
        try:
            module.extract_frame = lambda _path, second, *_args: (
                extracted.append(second) or type("Frame", (), {"shape": (720, 1280, 3)})()
            )
            module.projection = lambda _result: [
                {
                    "hanCount": 6,
                    "hasKana": False,
                    "score": 0.99,
                    "simplifiedMarkerCount": 2,
                    "text": "这里继续播放",
                    "yCenter": 600,
                }
            ]
            module.source_tags = lambda _path: {}
            result = module.review_episode(
                source,
                lambda _frame: object(),
                None,
                None,
                existing=existing,
                passes=(
                    {
                        "fractions": (0.22, 0.32),
                        "lowerBand": 0.5,
                        "name": "resume",
                        "width": 1920,
                    },
                ),
            )
        finally:
            module.extract_frame = original_extract
            module.projection = original_projection
            module.source_tags = original_source_tags

        self.assertEqual(extracted, [32])
        self.assertTrue(result["sealedBurnedIn"])
        self.assertEqual(
            [row["second"] for row in result["matchedSimplifiedChinese"]],
            [22, 32],
        )

    def test_validates_resume_review_identity_and_source_chain(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            module.EVIDENCE_ROOT = root
            inventory_path = root / "inventory.json"
            inventory_path.write_text("{}", encoding="utf-8")
            sources = [
                {
                    "boundedSha256": character * 64,
                    "bytes": 10,
                    "durationSeconds": 100.0,
                    "episode": episode,
                    "mtimeMs": episode,
                    "path": f"/media/e{episode}.mkv",
                    "relativePath": f"e{episode}.mkv",
                    "season": 1,
                }
                for episode, character in ((1, "a"), (2, "b"))
            ]
            episodes = []
            for source in sources:
                sealed = source["episode"] == 1
                episodes.append(
                    {
                        **source,
                        "attempts": [{"second": 22}, {"second": 32}],
                        "matchedSimplifiedChinese": (
                            [
                                {"second": 22, "text": "这里"},
                                {"second": 32, "text": "继续"},
                            ]
                            if sealed
                            else [{"second": 22, "text": "这里"}]
                        ),
                        "sealedBurnedIn": sealed,
                    }
                )
            review = {
                "episodes": episodes,
                "inventoryPath": str(inventory_path),
                "inventorySha256": "c" * 64,
                "mutationBoundaries": {
                    "cloudWrites": 0,
                    "databaseDirectWrite": False,
                    "mechanicalScanTriggered": False,
                    "mediaFileWrites": 0,
                    "serviceMutation": False,
                    "uiWrites": 0,
                },
                "providerRef": "tmdb:123",
                "schemaVersion": "burned-in-frame-manifest-sha256-v1",
                "seasonSourceGroups": {"1": "Group"},
                "seasonSourceMarkers": {"1": "S01"},
                "sourceGroup": None,
                "workItemId": "media-999",
            }
            review_path = root / "review.json"
            review_path.write_text(json.dumps(review), encoding="utf-8")
            resume = module.load_resume_review(
                str(review_path),
                module.sha256(review_path),
                inventory_path=inventory_path,
                inventory_sha256="c" * 64,
                provider_ref="tmdb:123",
                season_sources={"1": {"group": "Group", "marker": "S01"}},
                source_group=None,
                sources=sources,
                work_item="media-999",
            )
            self.assertEqual(set(resume), {(1, 1), (1, 2)})

            review["episodes"][1]["boundedSha256"] = "d" * 64
            review_path.write_text(json.dumps(review), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "source changed"):
                module.load_resume_review(
                    str(review_path),
                    module.sha256(review_path),
                    inventory_path=inventory_path,
                    inventory_sha256="c" * 64,
                    provider_ref="tmdb:123",
                    season_sources={"1": {"group": "Group", "marker": "S01"}},
                    source_group=None,
                    sources=sources,
                    work_item="media-999",
                )


if __name__ == "__main__":
    unittest.main()
