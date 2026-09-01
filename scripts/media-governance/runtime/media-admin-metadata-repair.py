#!/usr/bin/env python3
"""按 Admin 密封计划检查或补齐一个 TV、movie 或 theatrical 任务的本地元数据。"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


MEDIA_DB = Path("/usr/local/apps/@appdata/trim.media/database/trimmedia.db")
MEDIA_ROOT = Path("/vol2/1000/Media")
STAGING_PARENT = Path("/vol2/1000/.kt-media-governance-staging")
EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
ROLLBACK_PARENT = Path("/vol2/1000/.kt-media-governance-rollback")
VIDEO_EXTENSIONS = {".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MOVIE_METADATA_TYPES = frozenset({"movie", "theatrical"})
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SUPPORTED_METADATA_TYPES = MOVIE_METADATA_TYPES | {"tv"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$")
USER_AGENT = "KT-Media-Governance/1.0"


def fail(message: str) -> None:
    raise RuntimeError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_resolve(path: Path, boundary: Path, label: str) -> Path:
    resolved = path.resolve(strict=False)
    root = boundary.resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"{label} is outside the allowed root") from error
    if resolved == root:
        fail(f"{label} cannot equal the allowed root")
    return resolved


def load_json(path: Path, label: str) -> dict:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        fail(f"{label} must be an existing absolute plain file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail(f"{label} must contain one object")
    return value


def load_module(path: Path, expected_sha256: str):
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or not SHA256_PATTERN.fullmatch(expected_sha256)
        or sha256_file(path) != expected_sha256
    ):
        fail("TMDB capture tool identity is invalid")
    spec = importlib.util.spec_from_file_location("kt_media_tmdb_capture", path)
    if spec is None or spec.loader is None:
        fail("TMDB capture tool cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in (
        "fetch_page",
        "parse_movie_page",
        "parse_series_page",
        "parse_season_page",
    ):
        if not callable(getattr(module, name, None)):
            fail(f"TMDB capture tool does not expose {name}()")
    return module


def plan_records(plan: dict) -> list[dict]:
    media_type = plan.get("identity", {}).get("mediaType")
    if (
        plan.get("schemaVersion") != "1.2.0"
        or plan.get("sealed") is not True
        or media_type not in SUPPORTED_METADATA_TYPES
    ):
        fail(
            "metadata repair accepts only a sealed Schema 1.2.0 TV, movie, or theatrical plan"
        )
    target_root_raw = (
        plan.get("execution", {}).get("allowlists", {}).get("localTargetRoot")
    )
    target_root = MEDIA_ROOT / "movie"
    if target_root_raw != os.fspath(target_root):
        fail("metadata repair local target root is invalid")
    operations = plan.get("manifests", {}).get("local", {}).get("forward")
    evidence_items = plan.get("sourceEvidence")
    if not isinstance(operations, list) or not isinstance(evidence_items, list):
        fail("metadata repair plan has no local manifest evidence")
    evidence = {
        item.get("evidenceId"): item
        for item in evidence_items
        if isinstance(item, dict) and isinstance(item.get("evidenceId"), str)
    }
    records = []
    seen = set()
    for operation in operations:
        if not isinstance(operation, dict):
            fail("metadata repair operation is invalid")
        file_kind = operation.get("fileKind")
        if file_kind not in {"asset", "subtitle", "video"}:
            fail("metadata repair file kind is invalid")
        target_raw = operation.get("targetPath")
        source_raw = operation.get("sourcePath")
        sealed = evidence.get(operation.get("evidenceId"))
        if (
            operation.get("operation") != "move"
            or not isinstance(target_raw, str)
            or not isinstance(source_raw, str)
            or not target_raw.startswith("/")
            or not source_raw.startswith("/")
            or not isinstance(sealed, dict)
            or sealed.get("scope") != "local"
            or sealed.get("fileKind") != file_kind
            or not SHA256_PATTERN.fullmatch(str(sealed.get("digest") or ""))
            or not isinstance(sealed.get("size"), int)
            or sealed["size"] < 0
        ):
            fail("metadata repair local record is invalid")
        target = safe_resolve(Path(target_raw), target_root, "metadata target")
        if os.fspath(target) in seen:
            fail("metadata repair target is duplicated")
        seen.add(os.fspath(target))
        records.append(
            {
                "fileKind": file_kind,
                "sealed": sealed,
                "sourcePath": source_raw,
                "target": target,
            }
        )
    videos = [record for record in records if record["fileKind"] == "video"]
    if not videos:
        fail("metadata repair plan contains no video")
    if media_type in MOVIE_METADATA_TYPES and len(videos) != 1:
        fail("metadata repair movie or theatrical plan requires exactly one video")
    for record in records:
        target = record["target"]
        if target.is_symlink() or not target.is_file():
            fail("metadata repair canonical target is missing or unsafe")
        if target.stat().st_size != record["sealed"]["size"]:
            fail("metadata repair canonical target size changed")
    return records


def parse_video_identity(path: Path) -> tuple[int, int]:
    season_match = re.search(r"/Season (\d{2})/", os.fspath(path))
    episode_match = re.search(r"- S(\d{2})E(\d{2,3})(?:\D|$)", path.stem)
    if not season_match or not episode_match:
        fail("metadata repair video path has no canonical season/episode identity")
    season = int(season_match.group(1))
    if season != int(episode_match.group(1)):
        fail("metadata repair video season identity is inconsistent")
    return season, int(episode_match.group(2))


def query_trim_identity(
    video_records: list[dict], database_path: Path | None = None
) -> dict:
    database_path = database_path or MEDIA_DB
    if not database_path.is_file() or database_path.is_symlink():
        fail("trim.media database is unavailable")
    paths = [os.fspath(record["target"]) for record in video_records]
    marks = ",".join("?" for _ in paths)
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT im.path, im.recognition_status,
                       i.type, i.title AS episode_title,
                       i.season_number, i.episode_number,
                       i.nfo_path AS episode_nfo,
                       i.posters AS episode_posters,
                       i.release_date AS episode_release_date,
                       p.nfo_path AS season_nfo, p.posters AS season_posters,
                       gp.title AS series_title, gp.original_title,
                       gp.release_date, gp.tmdb_id AS series_tmdb_id,
                       gp.nfo_path AS series_nfo, gp.posters AS series_posters
                  FROM item_media im
                  LEFT JOIN item i ON i.guid = im.item_guid
                  LEFT JOIN item p ON p.guid = i.parent_guid
                  LEFT JOIN item gp ON gp.guid = p.parent_guid
                 WHERE im.path IN ({marks})
                 ORDER BY im.path, im.guid
                """,
                paths,
            )
        ]
    finally:
        connection.close()
    rows_by_path: dict[str, list[dict]] = {}
    for row in rows:
        rows_by_path.setdefault(str(row["path"]), []).append(row)
    if set(rows_by_path) != set(paths) or any(len(items) != 1 for items in rows_by_path.values()):
        return {"identity": None, "reason": "trim-path-identity-not-unique", "rows": rows}
    provider_ids = {str(row.get("series_tmdb_id") or "") for row in rows}
    if len(provider_ids) != 1 or "" in provider_ids:
        return {"identity": None, "reason": "trim-provider-identity-not-unique", "rows": rows}
    for path_text, items in rows_by_path.items():
        row = items[0]
        season, episode = parse_video_identity(Path(path_text))
        if (
            row.get("type") != "Episode"
            or int(row.get("season_number") or -1) != season
            or int(row.get("episode_number") or -1) != episode
        ):
            return {"identity": None, "reason": "trim-episode-identity-mismatch", "rows": rows}
    first = rows[0]
    return {
        "identity": {
            "originalTitle": str(first.get("original_title") or ""),
            "provider": "tmdb",
            "providerId": next(iter(provider_ids)),
            "releaseDate": str(first.get("release_date") or ""),
            "seriesTitle": str(first.get("series_title") or ""),
        },
        "reason": None,
        "rows": rows,
    }


def query_trim_movie_identity(
    video_records: list[dict], database_path: Path | None = None
) -> dict:
    database_path = database_path or MEDIA_DB
    if len(video_records) != 1:
        fail("movie metadata identity requires exactly one video")
    if not database_path.is_file() or database_path.is_symlink():
        fail("trim.media database is unavailable")
    path_text = os.fspath(video_records[0]["target"])
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT im.path, im.recognition_status,
                       i.type, i.title, i.original_title, i.release_date,
                       i.tmdb_id, i.nfo_path, i.posters
                  FROM item_media im
                  LEFT JOIN item i ON i.guid = im.item_guid
                 WHERE im.path = ?
                 ORDER BY im.path, im.guid
                """,
                (path_text,),
            )
        ]
    finally:
        connection.close()
    if len(rows) != 1 or rows[0].get("path") != path_text:
        return {
            "identity": None,
            "reason": "trim-path-identity-not-unique",
            "rows": rows,
        }
    row = rows[0]
    provider_id = str(row.get("tmdb_id") or "")
    if row.get("type") != "Movie" or not re.fullmatch(r"[1-9]\d*", provider_id):
        return {
            "identity": None,
            "reason": "trim-provider-identity-not-unique",
            "rows": rows,
        }
    return {
        "identity": {
            "originalTitle": str(row.get("original_title") or ""),
            "provider": "tmdb",
            "providerId": provider_id,
            "releaseDate": str(row.get("release_date") or ""),
            "title": str(row.get("title") or ""),
        },
        "reason": None,
        "rows": rows,
    }


def title_root(video_records: list[dict], media_type: str = "tv") -> Path:
    if media_type in MOVIE_METADATA_TYPES:
        if len(video_records) != 1:
            fail("movie metadata title root requires exactly one video")
        video = video_records[0]["target"]
        root = safe_resolve(video.parent, MEDIA_ROOT, "metadata movie title root")
        relative = video.resolve(strict=True).relative_to(
            MEDIA_ROOT.resolve(strict=False)
        )
        if len(relative.parts) != 4 or relative.parts[:2] != ("movie", "Movies"):
            fail("metadata repair movie is outside one canonical Movies title root")
        return root
    roots = set()
    for record in video_records:
        path = record["target"]
        season, _ = parse_video_identity(path)
        expected = f"Season {season:02d}"
        if path.parent.name != expected:
            fail("metadata repair video is outside its canonical season directory")
        roots.add(path.parent.parent)
    if len(roots) != 1:
        fail("metadata repair plan spans more than one title root")
    return safe_resolve(next(iter(roots)), MEDIA_ROOT, "metadata title root")


def tvshow_nfo_matches(
    path: Path, *, provider_id: str, title: str, year: int
) -> bool:
    """核对 TV LocalNFO 的 TMDB 播放身份与主资料库标题、年份展示身份。"""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        return False
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return False
    values = {
        (element.text or "").strip()
        for element in root.findall(".//uniqueid") + root.findall(".//tmdbid")
    }
    return (
        root.tag == "tvshow"
        and provider_id in values
        and normalized_identity_title(root.findtext("title"))
        == normalized_identity_title(title)
        and str(root.findtext("year") or "").strip() == str(year)
    )


def movie_nfo_status(
    path: Path,
    *,
    provider_id: str,
    title: str,
    year: int,
) -> dict:
    field_names = ("plot", "title", "year")
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        return {
            "missingFields": list(field_names),
            "validIdentity": False,
            "values": {},
        }
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return {
            "missingFields": list(field_names),
            "validIdentity": False,
            "values": {},
        }
    values = {
        field: (root.findtext(field) or "").strip()
        for field in ("plot", "title", "year")
    }
    provider_values = {
        (element.text or "").strip()
        for element in root.findall(".//uniqueid") + root.findall(".//tmdbid")
    }
    missing = [field for field in field_names if not values[field]]
    return {
        "missingFields": missing,
        "validIdentity": (
            root.tag == "movie"
            and provider_id in provider_values
            and normalized_identity_title(values["title"])
            == normalized_identity_title(title)
            and values["year"] == str(year)
        ),
        "values": values,
    }


def nfo_has_season(path: Path, season: int) -> bool:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        return False
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return False
    return root.tag == "season" and (root.findtext("seasonnumber") or "").strip() == str(season)


def episode_nfo_status(
    path: Path,
    season: int,
    episode: int,
    *,
    provider_season: int | None = None,
    provider_episode: int | None = None,
) -> dict:
    field_names = ("title", "aired", "plot")
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        return {
            "missingFields": list(field_names),
            "validIdentity": False,
            "values": {},
        }
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return {
            "missingFields": list(field_names),
            "validIdentity": False,
            "values": {},
        }
    missing = [
        field for field in field_names if not (root.findtext(field) or "").strip()
    ]
    provider_season = season if provider_season is None else provider_season
    provider_episode = episode if provider_episode is None else provider_episode
    remapped = provider_season != season or provider_episode != episode
    valid_provider_identity = (
        root.tag == "episodedetails"
        and (root.findtext("season") or "").strip() == str(provider_season)
        and (root.findtext("episode") or "").strip() == str(provider_episode)
    )
    valid_display_identity = (
        not remapped
        or (
            (root.findtext("displayseason") or "").strip() == str(season)
            and (root.findtext("displayepisode") or "").strip() == str(episode)
        )
    )
    return {
        "missingFields": sorted(set(missing)),
        "validIdentity": valid_provider_identity and valid_display_identity,
        "values": {
            field: (root.findtext(field) or "").strip()
            for field in ("aired", "plot", "runtime", "showtitle", "thumb", "title")
        },
    }


def episode_nfo_matches_display_identity(
    path: Path,
    season: int,
    episode: int,
    *,
    display_title: str,
    provider_season: int,
    provider_episode: int,
) -> bool:
    """同时核对单集 NFO 的 provider 季集映射与主资料库作品标题。"""
    status = episode_nfo_status(
        path,
        season,
        episode,
        provider_season=provider_season,
        provider_episode=provider_episode,
    )
    return status["validIdentity"] and normalized_identity_title(
        status["values"].get("showtitle")
    ) == normalized_identity_title(display_title)


def nfo_has_episode(path: Path, season: int, episode: int) -> bool:
    status = episode_nfo_status(path, season, episode)
    return status["validIdentity"] and not status["missingFields"]


def image_is_supported(path: Path) -> bool:
    if (
        path.suffix.lower() not in IMAGE_EXTENSIONS
        or path.is_symlink()
        or not path.is_file()
        or path.stat().st_size < 1024
        or path.stat().st_size > 25 * 1024 * 1024
    ):
        return False
    with path.open("rb") as stream:
        header = stream.read(12)
    return (
        header.startswith(b"\xff\xd8\xff")
        or header.startswith(b"\x89PNG\r\n\x1a\n")
        or (header.startswith(b"RIFF") and header[8:12] == b"WEBP")
    )


def matching_images(root: Path, stem: str) -> list[Path]:
    return [
        candidate
        for extension in sorted(IMAGE_EXTENSIONS)
        for candidate in [root / f"{stem}{extension}"]
        if image_is_supported(candidate)
    ]


def normalized_identity_title(value: object) -> str:
    return "".join(
        character.casefold()
        for character in unicodedata.normalize("NFKC", str(value or ""))
        if character.isalnum()
    )


def plan_metadata_identity(plan: dict) -> dict | None:
    """从密封计划读取二级 TMDB 元数据身份，并兼容旧计划的顶层 TMDB 身份。"""
    root_identity = plan.get("metadataIdentity")
    if isinstance(root_identity, dict):
        return root_identity
    declared = plan.get("identity")
    if not isinstance(declared, dict):
        return None
    secondary = declared.get("metadataIdentity")
    if isinstance(secondary, dict):
        return secondary
    provider_ref = declared.get("providerRef")
    if not isinstance(provider_ref, dict):
        return None
    if provider_ref.get("provider") != "tmdb":
        return None
    return {
        "provider": provider_ref.get("provider"),
        "providerId": provider_ref.get("providerId"),
        "providerTitle": declared.get("providerTitle"),
        "releaseYear": declared.get("releaseYear"),
    }


def plan_catalog_identity(plan: dict) -> dict:
    """返回用于作品标题、年份与管理端资料库展示的主身份。"""
    catalog = plan.get("catalogIdentity")
    if isinstance(catalog, dict):
        return catalog
    declared = plan.get("identity")
    if isinstance(declared, dict):
        return declared
    return {}


def series_first_parent_nfo_binding_optional(plan: dict) -> bool:
    """判断 catalog 作品根与 TMDB 二级身份分离时父级 NFO 数据库绑定是否不适用。"""
    catalog = plan.get("catalogIdentity")
    metadata = plan_metadata_identity(plan)
    if not isinstance(catalog, dict) or not isinstance(metadata, dict):
        return False
    catalog_ref = catalog.get("providerRef")
    if not isinstance(catalog_ref, dict):
        return False
    provider_differs = (
        catalog_ref.get("provider") != metadata.get("provider")
        or str(catalog_ref.get("providerId") or "")
        != str(metadata.get("providerId") or "")
    )
    return metadata.get("provider") == "tmdb" and provider_differs


def sealed_plan_identity(plan: dict, tmdb_module) -> dict | None:
    """从密封计划读取 TMDB 二级身份，并用官方标题与年份重新确认后返回。"""
    declared = plan.get("identity")
    if not isinstance(declared, dict):
        return None
    metadata_identity = plan_metadata_identity(plan)
    if not isinstance(metadata_identity, dict):
        return None
    provider = metadata_identity.get("provider")
    provider_id = str(metadata_identity.get("providerId") or "")
    provider_title = metadata_identity.get("providerTitle")
    release_year = metadata_identity.get("releaseYear")
    if (
        provider != "tmdb"
        or not re.fullmatch(r"[1-9]\d*", provider_id)
        or not isinstance(release_year, int)
    ):
        return None
    if provider_title is not None and not isinstance(provider_title, str):
        return None
    media_type = declared.get("mediaType")
    if media_type in MOVIE_METADATA_TYPES:
        provider_url = (
            f"https://www.themoviedb.org/movie/{provider_id}?language=zh-CN"
        )
        provider_page = tmdb_module.fetch_page(provider_url)
        provider_item = tmdb_module.parse_movie_page(provider_page["body"])
    elif media_type == "tv":
        provider_url = f"https://www.themoviedb.org/tv/{provider_id}?language=zh-CN"
        provider_page = tmdb_module.fetch_page(provider_url)
        provider_item = tmdb_module.parse_series_page(provider_page["body"])
    else:
        return None
    provider_year = provider_item.get("year")
    official_title = normalized_identity_title(provider_item.get("title"))
    title_matches = True
    if isinstance(provider_title, str) and provider_title.strip():
        title_matches = (
            official_title == normalized_identity_title(provider_title)
        )
    release_year_matches = provider_year == release_year or (
        media_type in MOVIE_METADATA_TYPES
        and isinstance(provider_year, int)
        and abs(provider_year - release_year) <= 1
    )
    if (
        not official_title
        or not title_matches
        or not release_year_matches
    ):
        return None
    return {
        "provider": "tmdb",
        "providerId": provider_id,
        "providerTitle": str(provider_item["title"]),
        "releaseYear": release_year,
    }


def inspect_movie_metadata(plan: dict, records: list[dict], tmdb_module) -> dict:
    media_type = plan.get("identity", {}).get("mediaType")
    if media_type not in MOVIE_METADATA_TYPES:
        fail("movie metadata inspection requires a movie or theatrical plan")
    videos = [record for record in records if record["fileKind"] == "video"]
    trim = query_trim_movie_identity(videos)
    identity = trim["identity"]
    provider_movie = None
    if identity:
        provider_url = (
            f"https://www.themoviedb.org/movie/{identity['providerId']}?language=zh-CN"
        )
        provider_page = tmdb_module.fetch_page(provider_url)
        provider_movie = tmdb_module.parse_movie_page(provider_page["body"])
        declared = plan.get("identity") or {}
        declared_titles = {
            normalized_identity_title(declared.get("title")),
            normalized_identity_title(declared.get("providerTitle")),
        }
        recognized_titles = {
            normalized_identity_title(identity.get("originalTitle")),
            normalized_identity_title(identity.get("title")),
            normalized_identity_title(provider_movie.get("title")),
        }
        declared_year = declared.get("releaseYear")
        provider_year = provider_movie.get("year")
        release_year = (
            declared_year if isinstance(declared_year, int) else provider_year
        )
        if (
            not any(title and title in recognized_titles for title in declared_titles)
            or not isinstance(provider_year, int)
            or (
                isinstance(declared_year, int)
                and abs(provider_year - declared_year) > 1
            )
        ):
            identity = None
        else:
            identity = {
                "provider": "tmdb",
                "providerId": identity["providerId"],
                "providerTitle": str(provider_movie["title"]),
                "releaseYear": int(release_year),
            }
    if identity is None:
        identity = sealed_plan_identity(plan, tmdb_module)
    root = title_root(videos, media_type)
    video = videos[0]["target"]
    missing_a = []
    if identity is None:
        missing_a.extend(["identity.provider", "identity.providerId"])
    nfo_ready = False
    if identity:
        nfo = movie_nfo_status(
            video.with_suffix(".nfo"),
            provider_id=identity["providerId"],
            title=identity["providerTitle"],
            year=identity["releaseYear"],
        )
        nfo_ready = nfo["validIdentity"] and not nfo["missingFields"]
    row = trim["rows"][0] if len(trim["rows"]) == 1 else {}
    row_identity_ready = bool(identity) and (
        row.get("type") == "Movie"
        and str(row.get("tmdb_id") or "") == identity["providerId"]
        and int(row.get("recognition_status") or 0) == 3
    )
    row_poster_ready = row_identity_ready and bool(row.get("posters"))
    poster_ready = len(matching_images(root, "poster")) == 1
    missing_b = []
    if not (nfo_ready and row_identity_ready):
        missing_b.append("metadata.local-nfo")
    if not (poster_ready and row_poster_ready):
        missing_b.append("artwork.poster")
    unit = {
        "accepted": not missing_a and not missing_b,
        "mediaType": "movie",
        "missingA": missing_a,
        "missingB": missing_b,
        "missingC": [],
    }
    return {
        "identity": identity,
        "titleRoot": os.fspath(root),
        "trimIdentityReason": trim["reason"],
        "units": [unit],
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def inspect_metadata(plan: dict, records: list[dict], tmdb_module) -> dict:
    if plan.get("identity", {}).get("mediaType") in MOVIE_METADATA_TYPES:
        return inspect_movie_metadata(plan, records, tmdb_module)
    videos = [record for record in records if record["fileKind"] == "video"]
    subtitles = [record for record in records if record["fileKind"] == "subtitle"]
    trim = query_trim_identity(videos)
    identity = trim["identity"]
    provider_series = None
    release_year = None
    if identity:
        series_url = f"https://www.themoviedb.org/tv/{identity['providerId']}?language=zh-CN"
        series_page = tmdb_module.fetch_page(series_url)
        series = tmdb_module.parse_series_page(series_page["body"])
        provider_series = series
        release_year = series.get("year")
        metadata_identity = plan_metadata_identity(plan)
        declared_title = str(plan.get("identity", {}).get("title") or "")
        recognized_titles = {
            str(identity.get("originalTitle") or ""),
            str(identity.get("seriesTitle") or ""),
            str(series.get("title") or ""),
        }
        recognized_title_tokens = {
            normalized_identity_title(title)
            for title in recognized_titles
            if normalized_identity_title(title)
        }
        discovers_secondary_identity = (
            isinstance(plan.get("catalogIdentity"), dict)
            and "metadataIdentity" in plan
            and plan.get("metadataIdentity") is None
        )
        identity_mismatch = not isinstance(release_year, int)
        if isinstance(metadata_identity, dict):
            expected_title = str(metadata_identity.get("providerTitle") or "")
            identity_mismatch = identity_mismatch or (
                metadata_identity.get("provider") != "tmdb"
                or str(metadata_identity.get("providerId") or "")
                != identity["providerId"]
                or metadata_identity.get("releaseYear") != release_year
                or normalized_identity_title(expected_title)
                not in recognized_title_tokens
            )
        elif not discovers_secondary_identity:
            identity_mismatch = (
                identity_mismatch or declared_title not in recognized_titles
            )
        if identity_mismatch:
            identity = None
        else:
            identity = {
                "provider": "tmdb",
                "providerId": identity["providerId"],
                "providerTitle": str(series["title"]),
                "releaseYear": release_year,
            }
    if identity is None:
        identity = sealed_plan_identity(plan, tmdb_module)
    if identity and provider_series is None:
        series_url = f"https://www.themoviedb.org/tv/{identity['providerId']}?language=zh-CN"
        series_page = tmdb_module.fetch_page(series_url)
        provider_series = tmdb_module.parse_series_page(series_page["body"])
    catalog_identity = plan_catalog_identity(plan)
    display_title = str(catalog_identity.get("title") or "").strip()
    display_year = catalog_identity.get("releaseYear")
    if not display_title:
        fail("metadata repair catalog title is missing")
    if not isinstance(display_year, int):
        display_year = (identity or {}).get("releaseYear")
    root = title_root(videos)
    by_season: dict[int, dict[str, list[dict]]] = {}
    for record in videos:
        season, episode = parse_video_identity(record["target"])
        by_season.setdefault(season, {"subtitles": [], "videos": []})["videos"].append(
            {"episode": episode, "record": record}
        )
    for record in subtitles:
        season, episode = parse_video_identity(record["target"])
        by_season.setdefault(season, {"subtitles": [], "videos": []})[
            "subtitles"
        ].append({"episode": episode, "record": record})
    units = []
    trim_rows_by_path = {
        str(row.get("path")): row
        for row in trim["rows"]
        if isinstance(row.get("path"), str)
    }
    provider_metadata_cache: dict[tuple[int, str], dict] = {}
    for season, scoped in sorted(by_season.items()):
        video_episodes = sorted(item["episode"] for item in scoped["videos"])
        subtitle_episodes = sorted(
            {item["episode"] for item in scoped["subtitles"]}
        )
        missing_a = []
        if not video_episodes:
            missing_a.append("file.playable")
        if (
            not plan.get("metadataOnlyRefresh")
            and plan.get("strategy") != "embedded"
            and subtitle_episodes != video_episodes
        ):
            missing_a.append("subtitle.coverage")
        if identity is None:
            missing_a.extend(["identity.provider", "identity.providerId"])
        provider_episodes = {}
        provider_mapping = None
        if identity and provider_series:
            provider_metadata, provider_season = fetch_provider_season_metadata(
                tmdb_module,
                provider_id=identity["providerId"],
                local_season=season,
                expected_episodes=set(video_episodes),
                provider_season_numbers=provider_series.get("seasonNumbers") or [],
                season_title_hint=provider_season_title_hint(plan),
                cache=provider_metadata_cache,
            )
            provider_episodes = {
                int(item["episode"]): item for item in provider_metadata["episodes"]
            }
            provider_mapping = {
                "episodeMap": {
                    str(local_episode): int(
                        item.get("providerEpisode") or local_episode
                    )
                    for local_episode, item in sorted(provider_episodes.items())
                },
                "mode": provider_metadata.get("episodeMappingMode"),
                "providerSeason": provider_season,
            }
        provider_fallbacks = [
            {
                "episode": episode,
                "fallbackLanguage": "en-US",
                "fields": list(item.get("fallbackFields") or []),
                "reason": "localized_value_unavailable",
            }
            for episode, item in sorted(provider_episodes.items())
            if item.get("fallbackFields")
        ]
        episode_gaps = []
        database_projection_advisory_episodes = {"date.episode": []}
        for item in scoped["videos"]:
            path = item["record"]["target"]
            expected = provider_episodes.get(item["episode"]) or {}
            provider_season = int(
                (provider_mapping or {}).get("providerSeason") or season
            )
            provider_episode = int(
                expected.get("providerEpisode") or item["episode"]
            )
            status = episode_nfo_status(
                path.with_suffix(".nfo"),
                season,
                item["episode"],
                provider_season=provider_season,
                provider_episode=provider_episode,
            )
            missing_fields = []
            if not status["validIdentity"]:
                missing_fields.append("metadata.local-nfo")
            values = status["values"]
            if normalized_identity_title(values.get("showtitle")) != (
                normalized_identity_title(display_title)
            ):
                missing_fields.append("metadata.local-nfo")
            comparisons = (
                ("title.episode", values.get("title"), expected.get("title")),
                ("summary.episode", values.get("plot"), expected.get("overview")),
                ("date.episode", values.get("aired"), expected.get("aired")),
            )
            for field, actual, expected_value in comparisons:
                normalized_actual = " ".join(str(actual or "").split())
                normalized_expected = " ".join(str(expected_value or "").split())
                if not normalized_expected or normalized_actual != normalized_expected:
                    missing_fields.append(field)
            row = trim_rows_by_path.get(os.fspath(path)) or {}
            if " ".join(str(row.get("episode_title") or "").split()) != " ".join(
                str(expected.get("title") or "").split()
            ):
                missing_fields.append("title.episode")
            if str(row.get("episode_release_date") or "").strip() != str(
                expected.get("aired") or ""
            ).strip():
                database_projection_advisory_episodes["date.episode"].append(
                    item["episode"]
                )
            if missing_fields:
                episode_gaps.append(
                    {
                        "episode": item["episode"],
                        "missingFields": sorted(set(missing_fields)),
                    }
                )
        local_nfo_ready = (
            bool(identity)
            and isinstance(display_year, int)
            and tvshow_nfo_matches(
                root / "tvshow.nfo",
                provider_id=identity["providerId"],
                title=display_title,
                year=display_year,
            )
            and nfo_has_season(root / f"Season {season:02d}" / "season.nfo", season)
            and all(
                episode_nfo_matches_display_identity(
                    item["record"]["target"].with_suffix(".nfo"),
                    season,
                    item["episode"],
                    display_title=display_title,
                    provider_season=int(
                        (provider_mapping or {}).get("providerSeason") or season
                    ),
                    provider_episode=int(
                        provider_episodes.get(item["episode"], {}).get(
                            "providerEpisode"
                        )
                        or item["episode"]
                    ),
                )
                for item in scoped["videos"]
            )
        )
        # fnOS 的 TV Episode 行即使已读取同名 LocalNFO，也可能不回填 nfo_path；
        # 单集身份由上面的文件证据校验，数据库只要求剧集/季 NFO 绑定与识别完成。
        season_rows = [
            row
            for row in trim["rows"]
            if int(row.get("season_number") or -1) == season
        ]
        row_recognition_ready = bool(season_rows) and all(
            int(row.get("recognition_status") or 0) == 3 for row in season_rows
        )
        parent_nfo_bound = bool(season_rows) and all(
            row.get("season_nfo") and row.get("series_nfo")
            for row in season_rows
        )
        parent_nfo_binding_optional = series_first_parent_nfo_binding_optional(plan)
        row_metadata_ready = row_recognition_ready and (
            parent_nfo_bound or parent_nfo_binding_optional
        )
        artwork_ready = (
            len(matching_images(root, "poster")) == 1
            and len(matching_images(root, f"season{season:02d}-poster")) == 1
            and bool(trim["rows"])
            and all(
                row.get("series_posters") and row.get("season_posters")
                for row in trim["rows"]
                if int(row.get("season_number") or -1) == season
            )
        )
        missing_b = []
        if not (local_nfo_ready and row_metadata_ready):
            missing_b.append("metadata.local-nfo")
        if not artwork_ready:
            missing_b.append("artwork.poster")
        missing_b.extend(
            field
            for field in ("title.episode", "summary.episode", "date.episode")
            if any(field in gap["missingFields"] for gap in episode_gaps)
        )
        units.append(
            {
                "accepted": not missing_a and not missing_b,
                "databaseProjectionAdvisoryEpisodes": {
                    field: episodes
                    for field, episodes in database_projection_advisory_episodes.items()
                    if episodes
                },
                "episodeCount": len(video_episodes),
                "episodeGapCount": len(episode_gaps),
                "episodeGaps": episode_gaps,
                "missingA": missing_a,
                "missingB": missing_b,
                "missingC": [],
                "providerFallbacks": provider_fallbacks,
                "providerMapping": provider_mapping,
                "season": season,
            }
        )
    return {
        "identity": identity,
        "titleRoot": os.fspath(root),
        "trimIdentityReason": trim["reason"],
        "units": units,
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def add_text(parent: ET.Element, name: str, value) -> ET.Element | None:
    if value is None or str(value) == "":
        return None
    element = ET.SubElement(parent, name)
    element.text = str(value)
    return element


def xml_bytes(root: ET.Element) -> bytes:
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"


def fetch_artwork(url: str) -> tuple[bytes, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "image.tmdb.org":
        fail("metadata artwork URL must use the fixed TMDB image host")
    context = ssl.create_default_context()
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=45, context=context) as response:
                data = response.read(25 * 1024 * 1024 + 1)
            if response.status != 200 or len(data) < 1024 or len(data) > 25 * 1024 * 1024:
                fail("metadata artwork response size or status is invalid")
            if data.startswith(b"\xff\xd8\xff"):
                return data, ".jpg"
            if data.startswith(b"\x89PNG\r\n\x1a\n"):
                return data, ".png"
            if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
                return data, ".webp"
            fail("metadata artwork format is unsupported")
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    fail(f"metadata artwork request failed after three attempts: {last_error}")


def reuse_or_fetch_artwork(root: Path, stem: str, url: str) -> tuple[Path, bytes]:
    candidates = matching_images(root, stem)
    if len(candidates) > 1:
        fail(f"metadata artwork target is ambiguous: {root / stem}")
    if candidates:
        candidate = candidates[0]
        return candidate, candidate.read_bytes()
    payload, extension = fetch_artwork(url)
    return root / f"{stem}{extension}", payload


def fetch_provider_season_metadata(
    tmdb_module,
    *,
    provider_id: str,
    local_season: int,
    expected_episodes: set[int],
    provider_season_numbers: list[int],
    season_title_hint: str | None = None,
    cache: dict[tuple[int, str], dict] | None = None,
) -> tuple[dict, int]:
    cache = cache if cache is not None else {}

    def fetch(provider_season: int, language: str = "zh-CN") -> dict:
        key = (provider_season, language)
        if key in cache:
            return cache[key]
        url = (
            f"https://www.themoviedb.org/tv/{provider_id}/season/"
            f"{provider_season}?language={language}"
        )
        page = tmdb_module.fetch_page(url)
        result = tmdb_module.parse_season_page(
            page["body"], season_number=provider_season
        )
        cache[key] = result
        return result

    def covers(candidate: dict) -> bool:
        numbers = {
            int(item["episode"])
            for item in candidate.get("episodes", [])
            if isinstance(item, dict) and isinstance(item.get("episode"), int)
        }
        return (
            numbers == expected_episodes
            if local_season == 0
            else expected_episodes.issubset(numbers)
        )

    normalized_title_hint = normalize_title_token(season_title_hint)

    def title_matches(candidate: dict) -> bool:
        """仅在候选季名包含密封标题后缀时接受该季。"""
        if not normalized_title_hint:
            return True
        candidate_title = normalize_title_token(candidate.get("seasonTitle"))
        return bool(
            candidate_title
            and (
                normalized_title_hint in candidate_title
                or candidate_title in normalized_title_hint
            )
        )

    try:
        metadata = fetch(local_season)
        provider_season = local_season
    except Exception as error:
        http_error = getattr(tmdb_module, "TmdbHttpError", None)
        if (
            not isinstance(http_error, type)
            or not isinstance(error, http_error)
            or getattr(error, "status_code", None) != 404
        ):
            raise
        metadata = None
        provider_season = -1
    if metadata is not None and covers(metadata) and title_matches(metadata):
        metadata = {**metadata, "episodeMappingMode": "exact-number"}
    elif metadata is not None and local_season != 0 and len(
        metadata.get("episodes", [])
    ) == len(expected_episodes) and title_matches(metadata):
        local_numbers = sorted(expected_episodes)
        provider_items = sorted(
            metadata["episodes"], key=lambda item: int(item["episode"])
        )
        metadata = {
            **metadata,
            "episodeMappingMode": "ordinal-season",
            "episodes": [
                {
                    **item,
                    "episode": local_episode,
                    "providerEpisode": int(item["episode"]),
                }
                for local_episode, item in zip(
                    local_numbers, provider_items, strict=True
                )
            ],
        }
    else:
        candidates = []
        observed_ranges = []
        for season in sorted(
            {
                season
                for season in provider_season_numbers
                if isinstance(season, int) and season >= 0 and season != local_season
            }
        ):
            try:
                candidate = fetch(season)
            except Exception as error:
                http_error = getattr(tmdb_module, "TmdbHttpError", None)
                if (
                    isinstance(http_error, type)
                    and isinstance(error, http_error)
                    and getattr(error, "status_code", None) == 404
                ):
                    continue
                raise
            numbers = sorted(
                int(item["episode"])
                for item in candidate.get("episodes", [])
                if isinstance(item, dict) and isinstance(item.get("episode"), int)
            )
            observed_ranges.append(
                f"S{season:02d}:"
                + (
                    f"{numbers[0]}-{numbers[-1]}/{len(numbers)}"
                    if numbers
                    else "empty"
                )
            )
            if covers(candidate) and title_matches(candidate):
                candidates.append((season, candidate))
        if len(candidates) != 1:
            expected_range = (
                f"{min(expected_episodes)}-{max(expected_episodes)}"
                if expected_episodes
                else "empty"
            )
            fail(
                "TMDB season coverage is not unique for "
                f"local S{local_season:02d} episodes {expected_range}: "
                f"{len(candidates)} candidates; observed={','.join(observed_ranges)}"
            )
        provider_season, metadata = candidates[0]
        mapping_mode = "flattened-number"
        if normalized_title_hint:
            mapping_mode = "season-title"
        metadata = {**metadata, "episodeMappingMode": mapping_mode}
    primary_by_episode = {
        int(item["episode"]): item for item in metadata.get("episodes", [])
    }
    required_fields = ("aired", "overview", "title")
    needs_fallback = not metadata.get("seasonArtworkUrl") or any(
        not str(primary_by_episode.get(episode, {}).get(field) or "").strip()
        for episode in expected_episodes
        for field in required_fields
    )
    if needs_fallback:
        try:
            fallback = fetch(provider_season, "en-US")
        except Exception:
            fallback = None
        if fallback:
            fallback_by_episode = {
                int(item["episode"]): item
                for item in fallback.get("episodes", [])
            }
            merged_episodes = []
            for episode, item in sorted(primary_by_episode.items()):
                provider_episode = int(item.get("providerEpisode") or episode)
                fallback_item = fallback_by_episode.get(provider_episode) or {}
                merged = dict(item)
                fallback_fields = []
                for field in ("aired", "imageUrl", "overview", "runtime", "title"):
                    if not str(merged.get(field) or "").strip() and str(
                        fallback_item.get(field) or ""
                    ).strip():
                        merged[field] = fallback_item[field]
                        fallback_fields.append(field)
                if fallback_fields:
                    merged["fallbackFields"] = fallback_fields
                merged_episodes.append(merged)
            metadata = {
                **metadata,
                "episodes": merged_episodes,
                "seasonArtworkUrl": metadata.get("seasonArtworkUrl")
                or fallback.get("seasonArtworkUrl"),
            }
    return metadata, provider_season


def normalize_title_token(value: object) -> str:
    """把季名提示压缩为仅含字母数字与中日韩文字的大小写无关比较键。"""
    return "".join(
        character.casefold()
        for character in str(value or "")
        if character.isalnum()
    )


def provider_season_title_hint(plan: dict) -> str | None:
    """从本地作品标题移除已核验系列标题，保留可唯一选择 TMDB 季的附加名称。"""
    catalog_identity = plan_catalog_identity(plan)
    metadata_identity = plan_metadata_identity(plan)
    if not isinstance(metadata_identity, dict):
        metadata_identity = plan.get("identity") or {}
    title = str(catalog_identity.get("title") or "").strip()
    provider_title = str(metadata_identity.get("providerTitle") or "").strip()
    if not title or not provider_title:
        return None
    if not title.casefold().startswith(provider_title.casefold()):
        return None
    hint = title[len(provider_title) :].strip(" \t-—:：·")
    if not normalize_title_token(hint):
        return None
    return hint


def build_movie_assets(
    plan: dict, records: list[dict], inspection: dict, tmdb_module
) -> dict[Path, bytes]:
    identity = inspection.get("identity")
    if not identity:
        fail("movie metadata repair requires one verified provider identity")
    videos = [record for record in records if record["fileKind"] == "video"]
    if len(videos) != 1:
        fail("movie metadata repair requires exactly one canonical video")
    video = videos[0]["target"]
    root = Path(inspection["titleRoot"])
    if video.parent != root:
        fail("movie metadata repair video escaped its title root")
    provider_id = identity["providerId"]
    provider_url = (
        f"https://www.themoviedb.org/movie/{provider_id}?language=zh-CN"
    )
    provider_page = tmdb_module.fetch_page(provider_url)
    movie = tmdb_module.parse_movie_page(provider_page["body"])
    identity_year = identity.get("releaseYear")
    if (
        normalized_identity_title(movie.get("title"))
        != normalized_identity_title(identity.get("providerTitle"))
        or not isinstance(movie.get("year"), int)
        or not isinstance(identity_year, int)
        or abs(movie["year"] - identity_year) > 1
    ):
        fail("movie metadata provider identity changed before repair")
    artwork_urls = movie.get("artworkUrls") or []
    if not artwork_urls:
        fail("TMDB movie poster is missing")
    poster_path, poster_bytes = reuse_or_fetch_artwork(
        root, "poster", artwork_urls[0]
    )
    title = str(identity["providerTitle"])
    movie_nfo = ET.Element("movie")
    add_text(movie_nfo, "title", title)
    add_text(movie_nfo, "sorttitle", title)
    add_text(movie_nfo, "plot", movie.get("description"))
    add_text(movie_nfo, "year", identity["releaseYear"])
    add_text(movie_nfo, "tmdbid", provider_id)
    add_text(movie_nfo, "thumb", poster_path.name)
    unique = add_text(movie_nfo, "uniqueid", provider_id)
    if unique is not None:
        unique.set("type", "tmdb")
        unique.set("default", "true")
    return {
        poster_path: poster_bytes,
        video.with_suffix(".nfo"): xml_bytes(movie_nfo),
    }


def build_assets(
    plan: dict, records: list[dict], inspection: dict, tmdb_module
) -> dict[Path, bytes]:
    if plan.get("identity", {}).get("mediaType") in MOVIE_METADATA_TYPES:
        return build_movie_assets(plan, records, inspection, tmdb_module)
    identity = inspection.get("identity")
    if not identity:
        fail("metadata repair requires one verified provider identity")
    root = Path(inspection["titleRoot"])
    catalog_identity = plan_catalog_identity(plan)
    title = str(catalog_identity.get("title") or "").strip()
    display_year = catalog_identity.get("releaseYear")
    if not title:
        fail("metadata repair catalog title is missing")
    if not isinstance(display_year, int):
        display_year = identity.get("releaseYear")
    if not isinstance(display_year, int):
        fail("metadata repair catalog release year is missing")
    provider_id = identity["providerId"]
    series_url = f"https://www.themoviedb.org/tv/{provider_id}?language=zh-CN"
    series_page = tmdb_module.fetch_page(series_url)
    series = tmdb_module.parse_series_page(series_page["body"])
    metadata_only = plan.get("metadataOnlyRefresh") is True
    assets: dict[Path, bytes] = {}
    videos = [record for record in records if record["fileKind"] == "video"]
    seasons = sorted({parse_video_identity(record["target"])[0] for record in videos})
    provider_metadata_cache: dict[tuple[int, str], dict] = {}
    if not metadata_only:
        artwork_urls = series.get("artworkUrls") or []
        if not artwork_urls:
            fail("TMDB series poster is missing")
        poster_path, poster_bytes = reuse_or_fetch_artwork(
            root, "poster", artwork_urls[0]
        )
        assets[poster_path] = poster_bytes
        tvshow = ET.Element("tvshow")
        add_text(tvshow, "title", title)
        add_text(tvshow, "sorttitle", title)
        add_text(tvshow, "plot", series.get("description"))
        add_text(tvshow, "year", display_year)
        add_text(tvshow, "tmdbid", provider_id)
        add_text(tvshow, "numberofseasons", len(seasons))
        add_text(tvshow, "numberofepisodes", len(videos))
        add_text(tvshow, "thumb", poster_path.name)
        unique = add_text(tvshow, "uniqueid", provider_id)
        if unique is not None:
            unique.set("type", "tmdb")
            unique.set("default", "true")
        assets[root / "tvshow.nfo"] = xml_bytes(tvshow)
    for season in seasons:
        scoped_videos = [
            record
            for record in videos
            if parse_video_identity(record["target"])[0] == season
        ]
        expected = {parse_video_identity(record["target"])[1] for record in scoped_videos}
        metadata, provider_season = fetch_provider_season_metadata(
            tmdb_module,
            provider_id=provider_id,
            local_season=season,
            expected_episodes=expected,
            provider_season_numbers=series.get("seasonNumbers") or [],
            season_title_hint=provider_season_title_hint(plan),
            cache=provider_metadata_cache,
        )
        episodes = {int(item["episode"]): item for item in metadata["episodes"]}
        if not expected or not expected.issubset(episodes):
            fail("TMDB season metadata does not cover every local episode")
        if not metadata_only:
            season_artwork = metadata.get("seasonArtworkUrl")
            if not season_artwork:
                fail("TMDB season poster is missing")
            season_poster_path, season_poster = reuse_or_fetch_artwork(
                root, f"season{season:02d}-poster", season_artwork
            )
            assets[season_poster_path] = season_poster
            season_nfo = ET.Element("season")
            add_text(
                season_nfo,
                "title",
                "特别篇" if season == 0 else f"第 {season} 季",
            )
            add_text(season_nfo, "seasonnumber", season)
            add_text(season_nfo, "plot", series.get("description"))
            assets[root / f"Season {season:02d}" / "season.nfo"] = xml_bytes(
                season_nfo
            )
        for record in scoped_videos:
            _, episode = parse_video_identity(record["target"])
            item = episodes[episode]
            for field in ("title", "overview", "aired"):
                if not str(item.get(field) or "").strip():
                    fail(f"TMDB episode {episode} {field} is missing")
            episode_poster_path = None
            if item.get("imageUrl"):
                episode_poster_path, episode_poster = reuse_or_fetch_artwork(
                    record["target"].parent,
                    record["target"].stem,
                    item["imageUrl"],
                )
                assets[episode_poster_path] = episode_poster
            episode_nfo = ET.Element("episodedetails")
            provider_episode = int(item.get("providerEpisode") or episode)
            add_text(episode_nfo, "title", item.get("title") or f"第 {episode} 集")
            add_text(episode_nfo, "showtitle", title)
            add_text(episode_nfo, "season", provider_season)
            add_text(episode_nfo, "episode", provider_episode)
            if provider_season != season or provider_episode != episode:
                add_text(episode_nfo, "displayseason", season)
                add_text(episode_nfo, "displayepisode", episode)
            add_text(episode_nfo, "aired", item.get("aired"))
            add_text(episode_nfo, "runtime", item.get("runtime"))
            add_text(episode_nfo, "plot", item.get("overview"))
            if episode_poster_path is not None:
                add_text(episode_nfo, "thumb", episode_poster_path.name)
            assets[record["target"].with_suffix(".nfo")] = xml_bytes(episode_nfo)
    return assets


def load_protected_replacements(
    evidence_path: Path,
    expected_sha256: str,
    *,
    plan: dict,
    plan_path: Path,
    task_id: str,
    run_id: str,
) -> dict[Path, dict]:
    if (
        not evidence_path.is_absolute()
        or not evidence_path.is_file()
        or evidence_path.is_symlink()
        or safe_resolve(evidence_path, EVIDENCE_ROOT, "metadata backup evidence")
        != evidence_path.resolve(strict=True)
        or not SHA256_PATTERN.fullmatch(expected_sha256)
        or sha256_file(evidence_path) != expected_sha256
    ):
        fail("metadata backup evidence identity is invalid")
    evidence = load_json(evidence_path, "metadata backup evidence")
    rollback_root = ROLLBACK_PARENT / task_id / run_id
    recorded_rollback_root = Path(str(evidence.get("rollbackRoot") or ""))
    plans = evidence.get("plans")
    plan_sha256 = sha256_file(plan_path)
    work_item_id = str(plan.get("workItemId") or "")
    target_root = Path(
        str(plan.get("execution", {}).get("allowlists", {}).get("localTargetRoot") or "")
    )
    if (
        evidence.get("schemaVersion") != "media-post-governance-metadata-backup-v2"
        or evidence.get("state") != "database-backup-complete"
        or recorded_rollback_root != rollback_root
        or not rollback_root.is_dir()
        or rollback_root.is_symlink()
        or not isinstance(plans, list)
        or not any(
            isinstance(item, dict)
            and item.get("path") == os.fspath(plan_path)
            and item.get("sha256") == plan_sha256
            and item.get("workItemId") == work_item_id
            for item in plans
        )
        or not re.fullmatch(r"media-\d{3}", work_item_id)
        or not target_root.is_dir()
        or target_root.is_symlink()
    ):
        fail("metadata backup evidence contract is invalid")
    entries = evidence.get("replaceableMetadataAssets")
    if (
        not isinstance(entries, list)
        or evidence.get("metadataAssetHardlinkCount") != len(entries)
    ):
        fail("metadata backup replacement receipt is incomplete")
    protected: dict[Path, dict] = {}
    for entry in entries:
        target = (
            Path(str(entry.get("targetPath") or ""))
            if isinstance(entry, dict)
            else Path()
        )
        if (
            not isinstance(entry, dict)
            or entry.get("workItemId") != work_item_id
            or entry.get("fileKind") != "metadata"
            or entry.get("evidenceMethod") != "sha256-full-v1"
            or not SHA256_PATTERN.fullmatch(str(entry.get("digest") or ""))
            or not all(
                isinstance(entry.get(key), int)
                for key in ("device", "inode", "mtimeNs", "size")
            )
            or target in protected
            or not target.is_absolute()
            or not target.is_file()
            or target.is_symlink()
        ):
            fail("metadata backup replacement receipt identity is invalid")
        try:
            relative = target.resolve(strict=True).relative_to(
                target_root.resolve(strict=True)
            )
        except ValueError as error:
            raise RuntimeError("metadata replacement target escaped the plan root") from error
        rollback = rollback_root / work_item_id / ".metadata-originals" / relative
        if (
            entry.get("rollbackPath") != os.fspath(rollback)
            or not rollback.is_file()
            or rollback.is_symlink()
        ):
            fail("metadata replacement rollback path is invalid")
        target_stat = target.stat()
        rollback_stat = rollback.stat()
        if any(
            stat_value != entry[key]
            for key, stat_value in (
                ("device", target_stat.st_dev),
                ("inode", target_stat.st_ino),
                ("mtimeNs", target_stat.st_mtime_ns),
                ("size", target_stat.st_size),
                ("device", rollback_stat.st_dev),
                ("inode", rollback_stat.st_ino),
                ("mtimeNs", rollback_stat.st_mtime_ns),
                ("size", rollback_stat.st_size),
            )
        ) or sha256_file(rollback) != entry["digest"]:
            fail("metadata replacement rollback identity changed")
        protected[target] = entry
    return protected


def commit_assets(
    assets: dict[Path, bytes],
    *,
    run_id: str,
    staging_root: Path,
    owner: os.stat_result,
    protected_replacements: dict[Path, dict] | None = None,
) -> list[dict]:
    work_root = staging_root / "work" / run_id
    safe_resolve(work_root, STAGING_PARENT, "metadata repair work root")
    work_root.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chown(work_root, owner.st_uid, owner.st_gid)
    protected_replacements = protected_replacements or {}
    staged: list[tuple[Path, Path, str, dict | None]] = []
    created: list[Path] = []
    replaced: list[tuple[Path, Path]] = []
    try:
        for index, (target, payload) in enumerate(
            sorted(assets.items(), key=lambda item: os.fspath(item[0]))
        ):
            if target.exists() or target.is_symlink():
                if target.is_file() and not target.is_symlink():
                    actual = hashlib.sha256(target.read_bytes()).hexdigest()
                    expected = hashlib.sha256(payload).hexdigest()
                    if actual == expected:
                        continue
                protection = protected_replacements.get(target)
                if protection is None:
                    fail(f"metadata repair target collision: {target}")
            else:
                protection = None
            if not target.parent.is_dir() or target.parent.is_symlink():
                fail("metadata repair target parent is missing or unsafe")
            stage = work_root / f"asset-{index:04d}"
            stage.write_bytes(payload)
            os.chown(stage, owner.st_uid, owner.st_gid)
            stage.chmod(0o644)
            staged.append(
                (stage, target, hashlib.sha256(payload).hexdigest(), protection)
            )
        for stage, target, _, protection in staged:
            if protection is None:
                os.link(stage, target)
                created.append(target)
                stage.unlink()
                continue
            rollback = Path(protection["rollbackPath"])
            target_stat = target.stat()
            rollback_stat = rollback.stat()
            if (
                target.is_symlink()
                or rollback.is_symlink()
                or not target.is_file()
                or not rollback.is_file()
                or target_stat.st_dev != protection["device"]
                or target_stat.st_ino != protection["inode"]
                or target_stat.st_mtime_ns != protection["mtimeNs"]
                or target_stat.st_size != protection["size"]
                or rollback_stat.st_dev != protection["device"]
                or rollback_stat.st_ino != protection["inode"]
                or sha256_file(rollback) != protection["digest"]
            ):
                fail(f"metadata repair replacement protection changed: {target}")
            os.replace(stage, target)
            replaced.append((target, rollback))
        replacement_by_target = dict(replaced)
        result = []
        for target, payload in sorted(assets.items(), key=lambda item: os.fspath(item[0])):
            stat = target.stat()
            replacement = replacement_by_target.get(target)
            result.append(
                {
                    "path": os.fspath(target),
                    "replaced": replacement is not None,
                    "reused": target not in created and replacement is None,
                    **(
                        {"rollbackPath": os.fspath(replacement)}
                        if replacement is not None
                        else {}
                    ),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "sizeBytes": stat.st_size,
                }
            )
        return result
    except Exception:
        for target in reversed(created):
            target.unlink(missing_ok=True)
        for target, rollback in reversed(replaced):
            target.unlink(missing_ok=True)
            os.link(rollback, target)
        raise
    finally:
        shutil.rmtree(work_root, ignore_errors=True)
        for parent in (work_root.parent, staging_root):
            try:
                parent.rmdir()
            except OSError:
                pass


def write_json_once(path: Path, value: dict) -> None:
    if (
        not path.is_absolute()
        or path.exists()
        or path.is_symlink()
        or safe_resolve(path, EVIDENCE_ROOT, "metadata repair evidence")
        != path.resolve(strict=False)
    ):
        fail("metadata repair evidence output must be a new absolute path")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def run(args: argparse.Namespace) -> dict:
    if not ID_PATTERN.fullmatch(args.task_id) or not ID_PATTERN.fullmatch(args.run_id):
        fail("metadata repair task or run identity is invalid")
    if args.repair_attempt not in {0, 1, 2}:
        fail("metadata repair attempt is invalid")
    if args.mode == "repair" and args.repair_attempt not in {1, 2}:
        fail("metadata repair execution requires attempt 1 or 2")
    if args.mode == "inspect" and args.repair_attempt != 0:
        fail("metadata inspection cannot carry a repair attempt")
    plan_path = Path(args.plan)
    plan = load_json(plan_path, "sealed plan")
    records = plan_records(plan)
    tmdb_module = load_module(Path(args.tmdb_script), args.tmdb_script_sha256)
    inspection = inspect_metadata(plan, records, tmdb_module)
    result = {
        "inspection": inspection,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMetadataWrites": 0,
            "mechanicalScanTriggered": False,
            "uiWrites": 0,
            "videoOrSubtitleWrites": 0,
        },
        "repairAttempt": args.repair_attempt,
        "schemaVersion": "media-admin-metadata-repair-v1",
        "state": "inspected",
        "taskId": args.task_id,
    }
    if args.mode == "inspect":
        return result
    video_records = [record for record in records if record["fileKind"] == "video"]
    staging_root = STAGING_PARENT / args.task_id
    assets = build_assets(plan, records, inspection, tmdb_module)
    protected_replacements = load_protected_replacements(
        Path(args.metadata_backup_evidence),
        args.metadata_backup_evidence_sha256,
        plan=plan,
        plan_path=plan_path,
        task_id=args.task_id,
        run_id=args.run_id,
    )
    committed = commit_assets(
        assets,
        run_id=args.run_id,
        staging_root=staging_root,
        owner=video_records[0]["target"].stat(),
        protected_replacements=protected_replacements,
    )
    result["assets"] = committed
    result["mutationBoundaries"]["formalMetadataWrites"] = len(
        [item for item in committed if not item["reused"]]
    )
    result["state"] = "metadata-assets-committed"
    output = Path(args.output)
    write_json_once(output, result)
    return {
        "evidenceSha256": sha256_file(output),
        "identity": inspection["identity"],
        "metadataAssetCount": len(committed),
        "newMetadataAssetCount": result["mutationBoundaries"]["formalMetadataWrites"],
        "repairAttempt": args.repair_attempt,
        "state": result["state"],
        "writeBoundaries": inspection["writeBoundaries"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect or repair one sealed Admin media metadata task."
    )
    parser.add_argument("--mode", choices=("inspect", "repair"), required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--repair-attempt", required=True, type=int)
    parser.add_argument("--tmdb-script", required=True)
    parser.add_argument("--tmdb-script-sha256", required=True)
    parser.add_argument("--metadata-backup-evidence")
    parser.add_argument("--metadata-backup-evidence-sha256")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.mode == "repair" and not args.output:
        parser.error("--output is required for repair")
    if args.mode == "repair" and (
        not args.metadata_backup_evidence
        or not args.metadata_backup_evidence_sha256
    ):
        parser.error("metadata backup evidence is required for repair")
    if args.mode == "inspect" and args.output:
        parser.error("--output is not accepted for inspect")
    if args.mode == "inspect" and (
        args.metadata_backup_evidence or args.metadata_backup_evidence_sha256
    ):
        parser.error("metadata backup evidence is not accepted for inspect")
    return args


def main() -> None:
    result = run(parse_args())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
