from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "media-admin-metadata-repair.py"
SPEC = importlib.util.spec_from_file_location("media_admin_metadata_repair", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load media admin metadata repair script")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeTmdb:
    @staticmethod
    def fetch_page(url: str) -> dict:
        return {"body": url}

    @staticmethod
    def parse_series_page(_body: str) -> dict:
        return {
            "artworkUrls": ["https://image.tmdb.org/t/p/original/poster.jpg"],
            "description": "fixture plot",
            "seasonNumbers": [1],
            "title": "能干的猫今天也忧郁",
            "year": 2023,
        }

    @staticmethod
    def parse_season_page(_body: str, *, season_number: int) -> dict:
        return {
            "episodes": [
                {
                    "aired": f"2023-07-{episode:02d}",
                    "episode": episode,
                    "imageUrl": (
                        f"https://image.tmdb.org/t/p/original/episode-{episode}.jpg"
                    ),
                    "overview": f"episode {episode}",
                    "runtime": "24m",
                    "title": f"Episode {episode}",
                }
                for episode in (1, 2)
            ],
            "seasonArtworkUrl": "https://image.tmdb.org/t/p/original/season.jpg",
            "seasonNumber": season_number,
        }

    @staticmethod
    def parse_movie_page(_body: str) -> dict:
        return {
            "artworkUrls": [
                "https://image.tmdb.org/t/p/original/movie-poster.jpg"
            ],
            "description": "乙骨忧太与诅咒的故事。",
            "title": "咒术回战0",
            "year": 2021,
        }


class RenamedTmdb(FakeTmdb):
    @staticmethod
    def parse_series_page(body: str) -> dict:
        value = FakeTmdb.parse_series_page(body)
        return {**value, "title": "能干猫的新译名"}


class WrongMovieTmdb(FakeTmdb):
    @staticmethod
    def parse_movie_page(body: str) -> dict:
        value = FakeTmdb.parse_movie_page(body)
        return {**value, "title": "另一部电影", "year": 2019}


class LocalizedGapTmdb(FakeTmdb):
    @staticmethod
    def parse_season_page(body: str, *, season_number: int) -> dict:
        value = FakeTmdb.parse_season_page(body, season_number=season_number)
        if "language=en-US" in body:
            return value
        episodes = [dict(item) for item in value["episodes"]]
        episodes[0]["aired"] = None
        episodes[0]["overview"] = ""
        episodes[0]["runtime"] = None
        return {**value, "episodes": episodes}


class SpecialSeasonTmdb(FakeTmdb):
    class TmdbHttpError(RuntimeError):
        def __init__(self, status_code: int) -> None:
            super().__init__(f"HTTP {status_code}")
            self.status_code = status_code

    @classmethod
    def fetch_page(cls, url: str) -> dict:
        if "/season/0?" in url:
            raise cls.TmdbHttpError(404)
        return {"body": url}


class MismatchedSpecialSeasonTmdb(SpecialSeasonTmdb):
    @staticmethod
    def parse_season_page(body: str, *, season_number: int) -> dict:
        value = FakeTmdb.parse_season_page(body, season_number=season_number)
        return {
            **value,
            "episodes": [
                *value["episodes"],
                {
                    "aired": "2023-07-03",
                    "episode": 3,
                    "overview": "episode 3",
                    "runtime": "24m",
                    "title": "Episode 3",
                },
            ],
        }


class FlattenedSeasonTmdb(FakeTmdb):
    class TmdbHttpError(RuntimeError):
        def __init__(self, status_code: int) -> None:
            super().__init__(f"HTTP {status_code}")
            self.status_code = status_code

    @classmethod
    def fetch_page(cls, url: str) -> dict:
        if "/season/2?" in url:
            raise cls.TmdbHttpError(404)
        return {"body": url}

    @staticmethod
    def parse_season_page(_body: str, *, season_number: int) -> dict:
        return {
            "episodes": [
                {
                    "aired": f"2023-07-{episode:02d}",
                    "episode": episode,
                    "overview": f"episode {episode}",
                    "runtime": "24m",
                    "title": f"Episode {episode}",
                }
                for episode in range(1, 48)
            ],
            "seasonArtworkUrl": "https://image.tmdb.org/t/p/original/season.jpg",
            "seasonNumber": season_number,
        }


class CoverageMismatchTmdb(FlattenedSeasonTmdb):
    @staticmethod
    def fetch_page(url: str) -> dict:
        return {"body": url}

    @staticmethod
    def parse_season_page(body: str, *, season_number: int) -> dict:
        value = FlattenedSeasonTmdb.parse_season_page(
            body, season_number=season_number
        )
        if "/season/2?" not in body:
            return value
        return {**value, "episodes": value["episodes"][:22]}


class OrdinalSeasonTmdb(FakeTmdb):
    @staticmethod
    def parse_season_page(_body: str, *, season_number: int) -> dict:
        return {
            "episodes": [
                {
                    "aired": f"2007-03-{provider_episode - 32:02d}",
                    "episode": provider_episode,
                    "imageUrl": None,
                    "overview": f"provider episode {provider_episode}",
                    "runtime": "24m",
                    "title": f"Provider Episode {provider_episode}",
                }
                for provider_episode in range(33, 54)
            ],
            "seasonArtworkUrl": "https://image.tmdb.org/t/p/original/season.jpg",
            "seasonNumber": season_number,
        }


class OrdinalLocalizedGapTmdb(OrdinalSeasonTmdb):
    @staticmethod
    def parse_season_page(body: str, *, season_number: int) -> dict:
        value = OrdinalSeasonTmdb.parse_season_page(
            body, season_number=season_number
        )
        if "language=en-US" in body:
            return value
        episodes = [dict(item) for item in value["episodes"]]
        episodes[0]["aired"] = None
        episodes[0]["overview"] = ""
        episodes[0]["title"] = ""
        return {**value, "episodes": episodes}


class SeasonTitleTmdb(FakeTmdb):
    @staticmethod
    def parse_season_page(_body: str, *, season_number: int) -> dict:
        season_title = "本篇"
        episode_count = 366
        if season_number == 2:
            season_title = "千年血战篇"
            episode_count = 50
        return {
            "episodes": [
                {
                    "aired": f"2022-10-{episode:02d}",
                    "episode": episode,
                    "imageUrl": None,
                    "overview": f"episode {episode}",
                    "runtime": "24m",
                    "title": f"Season {season_number} Episode {episode}",
                }
                for episode in range(1, episode_count + 1)
            ],
            "seasonArtworkUrl": "https://image.tmdb.org/t/p/original/season.jpg",
            "seasonNumber": season_number,
            "seasonTitle": season_title,
        }


class BleachCatalogTmdb(SeasonTitleTmdb):
    @staticmethod
    def parse_series_page(_body: str) -> dict:
        return {
            "artworkUrls": ["https://image.tmdb.org/t/p/original/poster.jpg"],
            "description": "千年血战篇简介",
            "seasonNumbers": [1, 2],
            "title": "死神",
            "year": 2004,
        }


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write_nfo(path: Path, provider_id: str) -> None:
    path.write_text(
        f'<?xml version="1.0"?><item><uniqueid type="tmdb">{provider_id}</uniqueid></item>',
        encoding="utf-8",
    )


def create_database(
    path: Path,
    videos: list[Path],
    *,
    ready: bool,
    provider_id: int | None = 202821,
    season: int = 1,
    series_title: str = "能干的猫今天也忧郁",
) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE item (
          guid TEXT PRIMARY KEY,
          parent_guid TEXT,
          type TEXT,
          season_number INTEGER,
          episode_number INTEGER,
          nfo_path TEXT,
          posters TEXT,
          title TEXT,
          original_title TEXT,
          release_date TEXT,
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
        "INSERT INTO item VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            "series",
            None,
            "TV",
            None,
            None,
            "/tvshow.nfo" if ready else "",
            "/series.webp",
            series_title,
            "デキる猫は今日も憂鬱",
            "",
            provider_id,
        ),
    )
    connection.execute(
        "INSERT INTO item VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            "season",
            "series",
            "Season",
            season,
            None,
            "/season.nfo" if ready else "",
            "/season.webp",
            "第 1 季",
            "",
            "",
            provider_id,
        ),
    )
    for episode, video in enumerate(videos, start=1):
        connection.execute(
            "INSERT INTO item VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                f"episode-{episode}",
                "season",
                "Episode",
                season,
                episode,
                "",
                "/episode.webp" if ready else "",
                f"Episode {episode}",
                "",
                f"2023-07-{episode:02d}" if ready else "",
                provider_id,
            ),
        )
        connection.execute(
            "INSERT INTO item_media VALUES (?,?,?,?)",
            (
                f"media-{episode}",
                f"episode-{episode}",
                os.fspath(video),
                3 if ready else 2,
            ),
        )
    connection.commit()
    connection.close()


def create_movie_database(
    path: Path,
    video: Path,
    *,
    ready: bool,
    provider_id: int | None = 810693,
) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE item (
          guid TEXT PRIMARY KEY,
          parent_guid TEXT,
          type TEXT,
          season_number INTEGER,
          episode_number INTEGER,
          nfo_path TEXT,
          posters TEXT,
          title TEXT,
          original_title TEXT,
          release_date TEXT,
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
        "INSERT INTO item VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            "movie",
            None,
            "Movie",
            None,
            None,
            os.fspath(video.with_suffix(".nfo")) if ready else "",
            os.fspath(video.parent / "poster.jpg") if ready else "",
            "咒术回战0",
            "劇場版 呪術廻戦 0",
            "2022-05-19",
            provider_id,
        ),
    )
    connection.execute(
        "INSERT INTO item_media VALUES (?,?,?,?)",
        ("movie-media", "movie", os.fspath(video), 3 if ready else 2),
    )
    connection.commit()
    connection.close()


def fixture(
    tmp_path: Path, *, season: int = 1
) -> tuple[dict, list[dict], Path, Path, list[Path]]:
    media_root = tmp_path / "Media"
    staging_parent = tmp_path / "staging"
    evidence_root = tmp_path / "evidence"
    rollback_parent = tmp_path / "rollback"
    title_root = media_root / "movie" / "TV" / "能干的猫今天也忧郁"
    season_root = title_root / f"Season {season:02d}"
    season_root.mkdir(parents=True)
    staging_parent.mkdir()
    evidence_root.mkdir()
    rollback_parent.mkdir()
    operations = []
    evidence = []
    videos = []
    for episode in (1, 2):
        for suffix, file_kind in ((".mkv", "video"), (".zh-CN.ass", "subtitle")):
            name = f"能干的猫今天也忧郁 - S{season:02d}E{episode:02d}{suffix}"
            target = season_root / name
            payload = f"fixture-{episode}-{file_kind}".encode()
            target.write_bytes(payload)
            evidence_id = f"evidence-{episode}-{file_kind}"
            operations.append(
                {
                    "evidenceId": evidence_id,
                    "fileKind": file_kind,
                    "operation": "move",
                    "sourcePath": os.fspath(staging_parent / "source" / name),
                    "targetPath": os.fspath(target),
                }
            )
            evidence.append(
                {
                    "digest": sha256(payload),
                    "evidenceId": evidence_id,
                    "evidenceMethod": "sha256-full-v1",
                    "fileKind": file_kind,
                    "scope": "local",
                    "size": len(payload),
                }
            )
            if file_kind == "video":
                videos.append(target)
    plan = {
        "execution": {"allowlists": {"localTargetRoot": os.fspath(media_root / "movie")}},
        "identity": {
            "mediaType": "tv",
            "providerRef": None,
            "releaseYear": None,
            "title": "能干的猫今天也忧郁",
        },
        "manifests": {"local": {"forward": operations}},
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sourceEvidence": evidence,
        "strategy": "sidecar-bundled",
        "workItemId": "media-063",
    }
    MODULE.MEDIA_ROOT = media_root
    MODULE.STAGING_PARENT = staging_parent
    MODULE.EVIDENCE_ROOT = evidence_root
    MODULE.ROLLBACK_PARENT = rollback_parent
    return plan, MODULE.plan_records(plan), title_root, staging_parent, videos


def movie_fixture(tmp_path: Path) -> tuple[dict, list[dict], Path, Path, Path]:
    media_root = tmp_path / "Media"
    staging_parent = tmp_path / "staging"
    evidence_root = tmp_path / "evidence"
    rollback_parent = tmp_path / "rollback"
    title_root = media_root / "movie" / "Movies" / "咒术回战0"
    title_root.mkdir(parents=True)
    staging_parent.mkdir()
    evidence_root.mkdir()
    rollback_parent.mkdir()
    video = title_root / "咒术回战0.mkv"
    video.write_bytes(b"movie-video")
    payload = video.read_bytes()
    plan = {
        "agentAmendments": [
            {
                "kind": "identity",
                "planSha256": "a" * 64,
                "provider": "tmdb",
                "providerId": "810693",
                "providerTitle": "咒术回战0",
                "releaseYear": 2022,
            }
        ],
        "execution": {
            "allowlists": {"localTargetRoot": os.fspath(media_root / "movie")}
        },
        "identity": {
            "mediaType": "movie",
            "providerRef": {"provider": "tmdb", "providerId": "810693"},
            "providerTitle": "咒术回战0",
            "releaseYear": 2022,
            "title": "咒术回战0",
        },
        "manifests": {
            "local": {
                "forward": [
                    {
                        "evidenceId": "movie-video",
                        "fileKind": "video",
                        "operation": "move",
                        "sourcePath": os.fspath(staging_parent / "source" / video.name),
                        "targetPath": os.fspath(video),
                    }
                ]
            }
        },
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sourceEvidence": [
            {
                "digest": sha256(payload),
                "evidenceId": "movie-video",
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "video",
                "scope": "local",
                "size": len(payload),
            }
        ],
        "strategy": "embedded",
        "workItemId": "media-063",
    }
    MODULE.MEDIA_ROOT = media_root
    MODULE.STAGING_PARENT = staging_parent
    MODULE.EVIDENCE_ROOT = evidence_root
    MODULE.ROLLBACK_PARENT = rollback_parent
    return plan, MODULE.plan_records(plan), title_root, staging_parent, video


class MediaAdminMetadataRepairTest(unittest.TestCase):
    def test_repairs_and_verifies_one_sealed_movie_without_tv_episode_identity(self):
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-movie-metadata-"
        ) as temporary:
            root = Path(temporary)
            plan, records, title_root, _staging, video = movie_fixture(root)
            database = root / "trimmedia.db"
            create_movie_database(database, video, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database

            before = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(before["identity"]["providerId"], "810693")
            self.assertEqual(before["titleRoot"], os.fspath(title_root))
            self.assertEqual(before["units"][0]["missingA"], [])
            self.assertEqual(
                before["units"][0]["missingB"],
                ["metadata.local-nfo", "artwork.poster"],
            )

            image = b"\xff\xd8\xff" + b"x" * 2048
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (image, ".jpg")
            try:
                assets = MODULE.build_assets(plan, records, before, FakeTmdb)
            finally:
                MODULE.fetch_artwork = original_fetch

            self.assertEqual(set(assets), {video.with_suffix(".nfo"), title_root / "poster.jpg"})
            movie_nfo = assets[video.with_suffix(".nfo")].decode("utf-8")
            self.assertIn("<movie>", movie_nfo)
            self.assertIn("<tmdbid>810693</tmdbid>", movie_nfo)
            self.assertIn("<year>2022</year>", movie_nfo)
            video.with_suffix(".nfo").write_bytes(assets[video.with_suffix(".nfo")])
            (title_root / "poster.jpg").write_bytes(assets[title_root / "poster.jpg"])
            database.unlink()
            create_movie_database(database, video, ready=True)

            after = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertTrue(after["units"][0]["accepted"])
            self.assertEqual(after["units"][0]["missingB"], [])

    def test_inspects_a_sealed_theatrical_plan_with_movie_metadata_semantics(self):
        """确认 theatrical 密封身份不变，但检查单元稳定投影为 movie。"""
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-theatrical-inspect-"
        ) as temporary:
            root = Path(temporary)
            plan, _records, title_root, _staging, video = movie_fixture(root)
            plan["identity"]["mediaType"] = "theatrical"
            plan["identity"]["providerRef"] = {
                "provider": "bangumi",
                "providerId": "604826",
            }
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "810693",
                "providerTitle": "咒术回战0",
                "releaseYear": 2022,
            }
            records = MODULE.plan_records(plan)
            database = root / "trimmedia.db"
            create_movie_database(database, video, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(plan["identity"]["mediaType"], "theatrical")
            self.assertEqual(plan["identity"]["providerRef"]["provider"], "bangumi")
            self.assertEqual(inspected["titleRoot"], os.fspath(title_root))
            self.assertEqual(inspected["units"][0]["mediaType"], "movie")
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_builds_theatrical_repair_assets_with_movie_nfo_semantics(self):
        """确认 theatrical 修复分派只生成 movie NFO 与海报资产。"""
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-theatrical-repair-"
        ) as temporary:
            root = Path(temporary)
            plan, _records, title_root, _staging, video = movie_fixture(root)
            plan["identity"]["mediaType"] = "theatrical"
            plan["identity"]["providerRef"] = {
                "provider": "bangumi",
                "providerId": "604826",
            }
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "810693",
                "providerTitle": "咒术回战0",
                "releaseYear": 2022,
            }
            records = MODULE.plan_records(plan)
            database = root / "trimmedia.db"
            create_movie_database(database, video, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database
            inspection = MODULE.inspect_metadata(plan, records, FakeTmdb)
            image = b"\xff\xd8\xff" + b"x" * 2048
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (image, ".jpg")
            try:
                assets = MODULE.build_assets(plan, records, inspection, FakeTmdb)
            finally:
                MODULE.fetch_artwork = original_fetch

            self.assertEqual(
                set(assets),
                {video.with_suffix(".nfo"), title_root / "poster.jpg"},
            )
            self.assertIn(
                "<movie>", assets[video.with_suffix(".nfo")].decode("utf-8")
            )
            self.assertEqual(plan["identity"]["mediaType"], "theatrical")
            self.assertEqual(plan["identity"]["providerRef"]["provider"], "bangumi")

    def test_rejects_a_movie_or_theatrical_plan_with_more_than_one_video(self):
        """确认 movie 与 theatrical 计划都保持严格单视频约束。"""
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-movie-ambiguous-"
        ) as temporary:
            plan, _records, title_root, _staging, _video = movie_fixture(Path(temporary))
            second = title_root / "咒术回战0-cd2.mkv"
            second.write_bytes(b"second-video")
            plan["manifests"]["local"]["forward"].append(
                {
                    "evidenceId": "movie-video-2",
                    "fileKind": "video",
                    "operation": "move",
                    "sourcePath": os.fspath(Path(temporary) / "missing" / second.name),
                    "targetPath": os.fspath(second),
                }
            )
            plan["sourceEvidence"].append(
                {
                    "digest": sha256(second.read_bytes()),
                    "evidenceId": "movie-video-2",
                    "evidenceMethod": "sha256-full-v1",
                    "fileKind": "video",
                    "scope": "local",
                    "size": second.stat().st_size,
                }
            )

            for media_type in ("movie", "theatrical"):
                with self.subTest(media_type=media_type):
                    plan["identity"]["mediaType"] = media_type
                    with self.assertRaisesRegex(RuntimeError, "exactly one video"):
                        MODULE.plan_records(plan)

    def test_rejects_a_movie_provider_page_that_does_not_match_the_sealed_identity(self):
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-movie-provider-mismatch-"
        ) as temporary:
            root = Path(temporary)
            plan, records, _title_root, _staging, video = movie_fixture(root)
            database = root / "trimmedia.db"
            create_movie_database(database, video, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, WrongMovieTmdb)

            self.assertIsNone(inspected["identity"])
            self.assertEqual(
                inspected["units"][0]["missingA"],
                ["identity.provider", "identity.providerId"],
            )

    def test_maps_reset_local_episode_numbers_to_same_season_provider_order(self) -> None:
        metadata, provider_season = MODULE.fetch_provider_season_metadata(
            OrdinalSeasonTmdb,
            provider_id="31910",
            local_season=2,
            expected_episodes=set(range(1, 22)),
            provider_season_numbers=list(range(1, 21)),
        )

        self.assertEqual(provider_season, 2)
        self.assertEqual(metadata["episodeMappingMode"], "ordinal-season")
        self.assertEqual(
            [item["episode"] for item in metadata["episodes"]], list(range(1, 22))
        )
        self.assertEqual(
            [item["providerEpisode"] for item in metadata["episodes"]],
            list(range(33, 54)),
        )

    def test_uses_the_sealed_title_suffix_to_select_the_matching_provider_season(
        self,
    ) -> None:
        metadata, provider_season = MODULE.fetch_provider_season_metadata(
            SeasonTitleTmdb,
            provider_id="30984",
            local_season=1,
            expected_episodes=set(range(1, 14)),
            provider_season_numbers=[1, 2],
            season_title_hint="千年血战篇",
        )

        self.assertEqual(provider_season, 2)
        self.assertEqual(metadata["episodeMappingMode"], "season-title")
        self.assertEqual(metadata["episodes"][0]["title"], "Season 2 Episode 1")

    def test_derives_a_provider_season_hint_only_from_a_sealed_title_suffix(
        self,
    ) -> None:
        self.assertEqual(
            MODULE.provider_season_title_hint(
                {
                    "identity": {
                        "providerTitle": "死神",
                        "title": "死神 千年血战篇",
                    }
                }
            ),
            "千年血战篇",
        )
        self.assertIsNone(
            MODULE.provider_season_title_hint(
                {"identity": {"providerTitle": "死神", "title": "死神"}}
            )
        )

    def test_keeps_bangumi_catalog_display_fields_with_tmdb_season_metadata(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-bleach-catalog-"
        ) as temporary:
            MODULE.MEDIA_ROOT = Path(temporary)
            title_root = Path(temporary) / "TV" / "死神 千年血战篇"
            season_root = title_root / "Season 01"
            season_root.mkdir(parents=True)
            records = []
            videos = []
            for episode in range(1, 14):
                video = season_root / f"死神 千年血战篇 - S01E{episode:02d}.mkv"
                video.write_bytes(f"video-{episode}".encode())
                videos.append(video)
                records.append({"fileKind": "video", "target": video})
            plan = {
                "agentAmendments": [
                    {
                        "kind": "identity",
                        "planSha256": "a" * 64,
                        "provider": "tmdb",
                        "providerId": "30984",
                        "providerTitle": "死神",
                        "releaseYear": 2004,
                    }
                ],
                "catalogIdentity": {
                    "mediaType": "tv",
                    "providerRef": {
                        "provider": "bangumi",
                        "providerId": "302286",
                    },
                    "releaseYear": 2022,
                    "title": "死神 千年血战篇",
                },
                "identity": {
                    "mediaType": "tv",
                    "providerRef": {"provider": "tmdb", "providerId": "30984"},
                    "providerTitle": "死神",
                    "releaseYear": 2004,
                    "title": "死神 千年血战篇",
                },
                "metadataIdentity": {
                    "provider": "tmdb",
                    "providerId": "30984",
                    "providerTitle": "死神",
                    "releaseYear": 2004,
                },
            }
            inspection = {
                "identity": MODULE.sealed_plan_identity(plan, BleachCatalogTmdb),
                "titleRoot": os.fspath(title_root),
            }
            image = b"\xff\xd8\xff" + b"x" * 2048
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (image, ".jpg")
            try:
                assets = MODULE.build_assets(
                    plan, records, inspection, BleachCatalogTmdb
                )
            finally:
                MODULE.fetch_artwork = original_fetch

            tvshow_path = title_root / "tvshow.nfo"
            tvshow_path.write_bytes(assets[tvshow_path])
            self.assertTrue(
                MODULE.tvshow_nfo_matches(
                    tvshow_path,
                    provider_id="30984",
                    title="死神 千年血战篇",
                    year=2022,
                )
            )
            tvshow = tvshow_path.read_text(encoding="utf-8")
            self.assertIn("<title>死神 千年血战篇</title>", tvshow)
            self.assertIn("<year>2022</year>", tvshow)
            self.assertIn("<tmdbid>30984</tmdbid>", tvshow)

            first_nfo_path = videos[0].with_suffix(".nfo")
            first_nfo_path.write_bytes(assets[first_nfo_path])
            first_nfo = first_nfo_path.read_text(encoding="utf-8")
            self.assertIn("<showtitle>死神 千年血战篇</showtitle>", first_nfo)
            self.assertIn("<season>2</season>", first_nfo)
            self.assertIn("<displayseason>1</displayseason>", first_nfo)
            self.assertTrue(
                MODULE.episode_nfo_matches_display_identity(
                    first_nfo_path,
                    1,
                    1,
                    display_title="死神 千年血战篇",
                    provider_season=2,
                    provider_episode=1,
                )
            )
            first_nfo_path.write_text(
                first_nfo.replace("死神 千年血战篇", "死神"),
                encoding="utf-8",
            )
            self.assertFalse(
                MODULE.episode_nfo_matches_display_identity(
                    first_nfo_path,
                    1,
                    1,
                    display_title="死神 千年血战篇",
                    provider_season=2,
                    provider_episode=1,
                )
            )
            for target, payload in assets.items():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
            plan["strategy"] = "embedded"
            database = Path(temporary) / "trimmedia.db"
            create_database(
                database,
                videos,
                provider_id=30984,
                ready=True,
                series_title="死神",
            )
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "UPDATE item SET nfo_path = '' WHERE type IN ('TV', 'Season')"
                )
                connection.commit()
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, BleachCatalogTmdb)

            self.assertTrue(MODULE.series_first_parent_nfo_binding_optional(plan))
            self.assertNotIn(
                "metadata.local-nfo",
                inspected["units"][0]["missingB"],
            )

    def test_writes_provider_identity_and_local_display_identity_for_ordinal_season(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-provider-identity-"
        ) as temporary:
            title_root = Path(temporary) / "TV" / "火影忍者疾风传"
            season_root = title_root / "Season 02"
            season_root.mkdir(parents=True)
            records = []
            videos = []
            for episode in range(1, 22):
                video = season_root / f"火影忍者疾风传 - S02E{episode:02d}.mkv"
                video.write_bytes(b"video")
                videos.append(video)
                records.append({"fileKind": "video", "target": video})
            plan = {
                "identity": {
                    "providerTitle": "火影忍者疾风传",
                    "title": "火影忍者疾风传",
                },
                "metadataOnlyRefresh": True,
            }
            inspection = {
                "identity": {"providerId": "31910", "releaseYear": 2007},
                "titleRoot": os.fspath(title_root),
            }

            assets = MODULE.build_assets(
                plan, records, inspection, OrdinalSeasonTmdb
            )

            first = assets[videos[0].with_suffix(".nfo")].decode("utf-8")
            last = assets[videos[-1].with_suffix(".nfo")].decode("utf-8")
            self.assertIn("<season>2</season>", first)
            self.assertIn("<episode>33</episode>", first)
            self.assertIn("<displayseason>2</displayseason>", first)
            self.assertIn("<displayepisode>1</displayepisode>", first)
            self.assertIn("<episode>53</episode>", last)
            self.assertIn("<displayepisode>21</displayepisode>", last)

    def test_validates_provider_and_display_episode_identity_together(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-display-identity-"
        ) as temporary:
            nfo = Path(temporary) / "episode.nfo"
            nfo.write_text(
                "<episodedetails><title>归乡</title><season>2</season>"
                "<episode>33</episode><displayseason>2</displayseason>"
                "<displayepisode>1</displayepisode><aired>2007-11-08</aired>"
                "<plot>剧情简介</plot></episodedetails>",
                encoding="utf-8",
            )

            status = MODULE.episode_nfo_status(
                nfo,
                2,
                1,
                provider_season=2,
                provider_episode=33,
            )

            self.assertTrue(status["validIdentity"])
            self.assertFalse(MODULE.episode_nfo_status(nfo, 2, 1)["validIdentity"])

    def test_ordinal_mapping_uses_the_provider_episode_for_language_fallback(self) -> None:
        metadata, _provider_season = MODULE.fetch_provider_season_metadata(
            OrdinalLocalizedGapTmdb,
            provider_id="31910",
            local_season=2,
            expected_episodes=set(range(1, 22)),
            provider_season_numbers=list(range(1, 21)),
        )

        first = metadata["episodes"][0]
        self.assertEqual(first["episode"], 1)
        self.assertEqual(first["providerEpisode"], 33)
        self.assertEqual(first["title"], "Provider Episode 33")
        self.assertEqual(
            first["fallbackFields"], ["aired", "overview", "title"]
        )

    def test_uses_the_unique_covering_provider_season_when_direct_page_exists(self) -> None:
        metadata, provider_season = MODULE.fetch_provider_season_metadata(
            CoverageMismatchTmdb,
            provider_id="95479",
            local_season=2,
            expected_episodes=set(range(25, 48)),
            provider_season_numbers=[1, 2],
        )

        self.assertEqual(provider_season, 1)
        self.assertTrue(
            set(range(25, 48)).issubset(
                {episode["episode"] for episode in metadata["episodes"]}
            )
        )

    def test_records_an_en_us_fallback_for_missing_localized_episode_fields(self) -> None:
        metadata, provider_season = MODULE.fetch_provider_season_metadata(
            LocalizedGapTmdb,
            provider_id="202821",
            local_season=1,
            expected_episodes={1, 2},
            provider_season_numbers=[1],
        )

        self.assertEqual(provider_season, 1)
        self.assertEqual(
            metadata["episodes"][0]["fallbackFields"],
            ["aired", "overview", "runtime"],
        )
        self.assertEqual(metadata["episodes"][0]["overview"], "episode 1")

    def test_maps_an_absolute_numbered_local_s02_to_one_flattened_provider_season(self) -> None:
        metadata, provider_season = MODULE.fetch_provider_season_metadata(
            FlattenedSeasonTmdb,
            provider_id="95479",
            local_season=2,
            expected_episodes=set(range(25, 48)),
            provider_season_numbers=[1],
        )

        self.assertEqual(provider_season, 1)
        self.assertTrue(
            set(range(25, 48)).issubset(
                {episode["episode"] for episode in metadata["episodes"]}
            )
        )

    def test_maps_a_local_only_s00_to_an_exact_two_episode_tmdb_season_one(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-special-season-") as temporary:
            tmp_path = Path(temporary)
            plan, records, title_root, _staging_parent, _videos = fixture(
                tmp_path, season=0
            )
            inspection = {
                "identity": {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "releaseYear": 2023,
                },
                "titleRoot": os.fspath(title_root),
            }
            image = b"\xff\xd8\xff" + b"x" * 2048
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (image, ".jpg")
            try:
                assets = MODULE.build_assets(
                    plan, records, inspection, SpecialSeasonTmdb
                )
                with self.assertRaisesRegex(RuntimeError, "coverage is not unique"):
                    MODULE.build_assets(
                        plan, records, inspection, MismatchedSpecialSeasonTmdb
                    )
            finally:
                MODULE.fetch_artwork = original_fetch

            self.assertIn(title_root / "season00-poster.jpg", assets)
            season_nfo = assets[title_root / "Season 00" / "season.nfo"]
            self.assertIn(b"<seasonnumber>0</seasonnumber>", season_nfo)
            self.assertIn("特别篇".encode(), season_nfo)
            episode_nfo = assets[
                title_root / "Season 00" / "能干的猫今天也忧郁 - S00E01.nfo"
            ]
            self.assertIn(b"<season>1</season>", episode_nfo)
            self.assertIn(b"<displayseason>0</displayseason>", episode_nfo)
            self.assertIn(b"<displayepisode>1</displayepisode>", episode_nfo)

    def test_bootstraps_missing_trim_identity_from_a_sealed_agent_amendment(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-agent-identity-") as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["identity"].update(
                {
                    "providerRef": {"provider": "tmdb", "providerId": "202821"},
                    "providerTitle": "能干的猫：今天也忧郁",
                    "releaseYear": 2023,
                }
            )
            plan["agentAmendments"] = [
                {
                    "kind": "identity",
                    "planSha256": "a" * 64,
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干的猫：今天也忧郁",
                    "releaseYear": 2023,
                }
            ]
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(
                inspected["identity"],
                {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干的猫今天也忧郁",
                    "releaseYear": 2023,
                },
            )
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_bootstraps_missing_trim_identity_from_a_sealed_work_identity(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-work-identity-") as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["catalogIdentity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "bangumi", "providerId": "457326"},
                "releaseYear": 2024,
                "title": "能干的猫今天也忧郁",
            }
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "202821",
                "releaseYear": 2023,
            }
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False, provider_id=None)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(
                inspected["identity"],
                {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干的猫今天也忧郁",
                    "releaseYear": 2023,
                },
            )
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_accepts_tmdb_identity_when_fnos_uses_a_localized_alias(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-metadata-alias-") as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            database = tmp_path / "trimmedia.db"
            create_database(
                database,
                videos,
                ready=False,
                series_title="飞牛本地别名",
            )
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(
                inspected["identity"],
                {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干的猫今天也忧郁",
                    "releaseYear": 2023,
                },
            )
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_uses_secondary_tmdb_identity_when_catalog_title_is_one_series_arc(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-secondary-identity-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "bangumi", "providerId": "457326"},
                "releaseYear": 2024,
                "title": "死神 千年血战篇-相克谭-",
            }
            plan["catalogIdentity"] = dict(plan["identity"])
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "202821",
                "providerTitle": "能干的猫今天也忧郁",
                "releaseYear": 2023,
            }
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(inspected["identity"]["provider"], "tmdb")
            self.assertEqual(inspected["identity"]["providerId"], "202821")
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_discovers_secondary_identity_for_a_series_first_catalog_arc(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-secondary-discovery-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "bangumi", "providerId": "457326"},
                "releaseYear": 2024,
                "title": "死神 千年血战篇-相克谭-",
            }
            plan["catalogIdentity"] = dict(plan["identity"])
            plan["metadataIdentity"] = None
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(inspected["identity"]["provider"], "tmdb")
            self.assertEqual(inspected["identity"]["providerId"], "202821")
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_rejects_secondary_tmdb_identity_that_differs_from_fnos(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-secondary-mismatch-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "30984",
                "providerTitle": "死神",
                "releaseYear": 2004,
            }
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertIsNone(inspected["identity"])
            self.assertEqual(
                inspected["units"][0]["missingA"],
                ["identity.provider", "identity.providerId"],
            )

    def test_accepts_multiple_language_sidecars_when_every_episode_is_covered(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-multilingual-sidecar-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            for video in videos:
                subtitle = video.with_name(f"{video.stem}.zh-TW.ass")
                subtitle.write_bytes(b"traditional subtitle")
                records.append({"fileKind": "subtitle", "target": subtitle})
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_rejects_sidecar_coverage_when_one_video_episode_has_no_subtitle(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-missing-sidecar-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            records = [
                record
                for record in records
                if not (
                    record["fileKind"] == "subtitle"
                    and "S01E02" in record["target"].name
                )
            ]
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, FakeTmdb)

            self.assertEqual(
                inspected["units"][0]["missingA"], ["subtitle.coverage"]
            )

    def test_accepts_unique_fnos_identity_when_tmdb_localized_title_changed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-metadata-renamed-") as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, RenamedTmdb)

            self.assertEqual(
                inspected["identity"],
                {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干猫的新译名",
                    "releaseYear": 2023,
                },
            )
            self.assertEqual(inspected["units"][0]["missingA"], [])

    def test_rejects_unique_provider_when_no_bound_title_matches(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-metadata-mismatch-") as temporary:
            tmp_path = Path(temporary)
            plan, records, _title_root, _staging_parent, videos = fixture(tmp_path)
            plan["identity"]["title"] = "完全不同的作品"
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database

            inspected = MODULE.inspect_metadata(plan, records, RenamedTmdb)

            self.assertIsNone(inspected["identity"])
            self.assertEqual(
                inspected["units"][0]["missingA"],
                ["identity.provider", "identity.providerId"],
            )

    def test_repairs_only_metadata_assets_and_keeps_exact_media_payloads(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kt-media-admin-metadata-") as temporary:
            tmp_path = Path(temporary)
            plan, records, title_root, staging_parent, videos = fixture(tmp_path)
            database = tmp_path / "trimmedia.db"
            create_database(database, videos, ready=False)
            MODULE.MEDIA_DB = database
            original = {
                record["target"]: sha256(record["target"].read_bytes())
                for record in records
            }

            before = MODULE.inspect_metadata(plan, records, FakeTmdb)
            self.assertEqual(
                before["identity"],
                {
                    "provider": "tmdb",
                    "providerId": "202821",
                    "providerTitle": "能干的猫今天也忧郁",
                    "releaseYear": 2023,
                },
            )
            self.assertEqual(
                before["units"],
                [
                    {
                        "accepted": False,
                        "databaseProjectionAdvisoryEpisodes": {
                            "date.episode": [1, 2],
                        },
                        "episodeCount": 2,
                        "episodeGapCount": 2,
                        "episodeGaps": [
                            {
                                "episode": episode,
                                "missingFields": [
                                    "date.episode",
                                    "metadata.local-nfo",
                                    "summary.episode",
                                    "title.episode",
                                ],
                            }
                            for episode in (1, 2)
                        ],
                        "missingA": [],
                        "missingB": [
                            "metadata.local-nfo",
                            "artwork.poster",
                            "title.episode",
                            "summary.episode",
                            "date.episode",
                        ],
                        "missingC": [],
                        "providerFallbacks": [],
                        "providerMapping": {
                            "episodeMap": {"1": 1, "2": 2},
                            "mode": "exact-number",
                            "providerSeason": 1,
                        },
                        "season": 1,
                    }
                ],
            )
            self.assertEqual(before["units"][0]["episodeGapCount"], 2)

            image = b"\xff\xd8\xff" + b"x" * 2048
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (image, ".jpg")
            try:
                assets = MODULE.build_assets(plan, records, before, FakeTmdb)
                committed = MODULE.commit_assets(
                    assets,
                    run_id="media-run-fixture",
                    staging_root=staging_parent / "media-task-fixture",
                    owner=videos[0].stat(),
                )
            finally:
                MODULE.fetch_artwork = original_fetch

            self.assertEqual(len(committed), 8)
            self.assertTrue((title_root / "tvshow.nfo").is_file())
            self.assertTrue((title_root / "poster.jpg").is_file())
            self.assertTrue((title_root / "season01-poster.jpg").is_file())
            self.assertTrue((title_root / "Season 01" / "season.nfo").is_file())
            self.assertTrue(
                MODULE.nfo_has_season(
                    title_root / "Season 01" / "season.nfo", 1
                )
            )
            self.assertTrue(
                MODULE.nfo_has_episode(videos[0].with_suffix(".nfo"), 1, 1)
            )
            self.assertTrue(videos[0].with_suffix(".jpg").is_file())
            episode_nfo = videos[0].with_suffix(".nfo").read_text(encoding="utf-8")
            self.assertIn(f"<thumb>{videos[0].stem}.jpg</thumb>", episode_nfo)
            self.assertFalse(
                MODULE.tvshow_nfo_matches(
                    videos[0].with_suffix(".nfo"),
                    provider_id="202821",
                    title="能干的猫今天也忧郁",
                    year=2023,
                )
            )
            self.assertTrue(
                all(
                    sha256(path.read_bytes()) == digest
                    for path, digest in original.items()
                )
            )

            database.unlink()
            create_database(database, videos, ready=True)
            after = MODULE.inspect_metadata(plan, records, FakeTmdb)
            self.assertTrue(after["units"][0]["accepted"])
            self.assertEqual(after["units"][0]["episodeGapCount"], 0)
            self.assertEqual(after["units"][0]["missingA"], [])
            self.assertEqual(after["units"][0]["missingB"], [])

            with sqlite3.connect(MODULE.MEDIA_DB) as connection:
                connection.execute(
                    "UPDATE item SET release_date = '' WHERE type = 'Episode'"
                )
            projected = MODULE.inspect_metadata(plan, records, FakeTmdb)
            self.assertTrue(projected["units"][0]["accepted"])
            self.assertEqual(projected["units"][0]["episodeGapCount"], 0)
            self.assertEqual(
                projected["units"][0]["databaseProjectionAdvisoryEpisodes"],
                {"date.episode": [1, 2]},
            )

    def test_rejects_an_episode_nfo_with_only_season_and_episode_numbers(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-incomplete-nfo-"
        ) as temporary:
            root = Path(temporary)
            video = root / "Title - S01E01.mkv"
            video.write_bytes(b"video")
            video.with_suffix(".nfo").write_text(
                "<episodedetails><season>1</season><episode>1</episode></episodedetails>",
                encoding="utf-8",
            )

            self.assertFalse(MODULE.nfo_has_episode(video.with_suffix(".nfo"), 1, 1))

    def test_metadata_only_refresh_does_not_rewrite_title_or_season_assets(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-only-assets-"
        ) as temporary:
            plan, records, title_root, _staging, videos = fixture(Path(temporary))
            plan["metadataOnlyRefresh"] = True
            inspection = {
                "identity": {"providerId": "202821", "releaseYear": 2023},
                "titleRoot": os.fspath(title_root),
            }
            original_fetch = MODULE.fetch_artwork
            MODULE.fetch_artwork = lambda _url: (b"\xff\xd8\xff" + b"x" * 2048, ".jpg")
            try:
                assets = MODULE.build_assets(plan, records, inspection, FakeTmdb)
            finally:
                MODULE.fetch_artwork = original_fetch

            self.assertEqual(
                set(assets),
                {
                    *(video.with_suffix(".jpg") for video in videos),
                    *(video.with_suffix(".nfo") for video in videos),
                },
            )
            self.assertNotIn(title_root / "tvshow.nfo", assets)
            self.assertNotIn(title_root / "season01-poster.jpg", assets)
            self.assertNotIn(title_root / "Season 01" / "season.nfo", assets)

    def test_atomically_replaces_only_a_backup_protected_metadata_asset(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-replace-"
        ) as temporary:
            tmp_path = Path(temporary)
            plan, _records, title_root, staging_parent, videos = fixture(tmp_path)
            target = title_root / "tvshow.nfo"
            target.write_bytes(b"old-metadata")
            task_id = "media-task-fixture"
            run_id = "media-run-replace"
            plan_path = MODULE.EVIDENCE_ROOT / task_id / run_id / "plan.json"
            plan_path.parent.mkdir(parents=True)
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            relative = target.relative_to(
                Path(plan["execution"]["allowlists"]["localTargetRoot"])
            )
            rollback = (
                MODULE.ROLLBACK_PARENT
                / task_id
                / run_id
                / plan["workItemId"]
                / ".metadata-originals"
                / relative
            )
            rollback.parent.mkdir(parents=True)
            os.link(target, rollback)
            original_stat = target.stat()
            receipt = {
                "device": original_stat.st_dev,
                "digest": sha256(b"old-metadata"),
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "metadata",
                "inode": original_stat.st_ino,
                "mtimeNs": original_stat.st_mtime_ns,
                "rollbackPath": os.fspath(rollback),
                "size": original_stat.st_size,
                "targetPath": os.fspath(target),
                "workItemId": plan["workItemId"],
            }
            backup_evidence = plan_path.parent / "metadata-backup.json"
            backup_evidence.write_text(
                json.dumps(
                    {
                        "metadataAssetHardlinkCount": 1,
                        "plans": [
                            {
                                "path": os.fspath(plan_path),
                                "sha256": sha256(plan_path.read_bytes()),
                                "workItemId": plan["workItemId"],
                            }
                        ],
                        "replaceableMetadataAssets": [receipt],
                        "rollbackRoot": os.fspath(
                            MODULE.ROLLBACK_PARENT / task_id / run_id
                        ),
                        "schemaVersion": "media-post-governance-metadata-backup-v2",
                        "state": "database-backup-complete",
                    }
                ),
                encoding="utf-8",
            )
            protection = MODULE.load_protected_replacements(
                backup_evidence,
                sha256(backup_evidence.read_bytes()),
                plan=plan,
                plan_path=plan_path,
                task_id=task_id,
                run_id=run_id,
            )

            committed = MODULE.commit_assets(
                {target: b"new-metadata"},
                protected_replacements=protection,
                run_id=run_id,
                staging_root=staging_parent / "media-task-fixture",
                owner=videos[0].stat(),
            )

            self.assertEqual(target.read_bytes(), b"new-metadata")
            self.assertEqual(rollback.read_bytes(), b"old-metadata")
            self.assertTrue(committed[0]["replaced"])
            self.assertEqual(committed[0]["rollbackPath"], os.fspath(rollback))

    def test_rejects_an_unprotected_existing_metadata_asset(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="kt-media-admin-metadata-collision-"
        ) as temporary:
            tmp_path = Path(temporary)
            _plan, _records, title_root, staging_parent, videos = fixture(tmp_path)
            target = title_root / "tvshow.nfo"
            target.write_bytes(b"old-metadata")

            with self.assertRaisesRegex(RuntimeError, "target collision"):
                MODULE.commit_assets(
                    {target: b"new-metadata"},
                    protected_replacements={},
                    run_id="media-run-collision",
                    staging_root=staging_parent / "media-task-fixture",
                    owner=videos[0].stat(),
                )

            self.assertEqual(target.read_bytes(), b"old-metadata")


if __name__ == "__main__":
    unittest.main()
