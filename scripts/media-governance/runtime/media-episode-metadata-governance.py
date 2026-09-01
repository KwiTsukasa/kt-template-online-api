#!/usr/bin/env python3
"""审计并返修已闭环 TV 作品的逐集 B 级元数据。"""

from __future__ import annotations

from argparse import Namespace
from collections import Counter
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


DATABASE_ROOT = Path("/usr/local/apps/@appdata/trim.media/database")
MEDIA_DB = DATABASE_ROOT / "trimmedia.db"
MEDIA_ROOT = Path("/vol2/1000/Media/movie")
EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
BACKUP_ROOT = Path("/vol1/docker/kt-media-governance/backups")
ROLLBACK_ROOT = Path("/vol2/1000/.kt-media-governance-rollback")
METADATA_STAGING_ROOT = Path("/vol2/1000/.kt-media-governance-staging")
OFFICIAL_API_HELPER = Path(
    "/vol1/docker/kt-media-governance/private/trim-official-api-helper.py"
)
LIBRARY_GUID = "64b94942a1244a4aabc56ef80678044b"
VIDEO_EXTENSIONS = {".avi", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4", ".ts", ".webm"}
SUBTITLE_EXTENSIONS = {".ass", ".ssa", ".srt", ".sub", ".vtt"}
IMAGE_EXTENSIONS = {".jpeg", ".jpg", ".png", ".webp"}
SERIES_ASSET_EXTENSIONS = {".7z", ".otf", ".rar", ".ttf", ".woff", ".woff2", ".zip"}
DIGEST = re.compile(r"^[a-f0-9]{64}$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,47}$")
WORK_ITEM = re.compile(r"^media-\d{3}$")
CHUNK_SIZE = 4 * 1024 * 1024
DEPENDENCIES = {
    "backup": "KT_BACKUP_SCRIPT",
    "readd": "KT_READD_SCRIPT",
    "repair": "KT_REPAIR_SCRIPT",
    "tmdb": "KT_TMDB_SCRIPT",
    "transaction": "KT_TRANSACTION_SCRIPT",
}
RESUME_READD_BATCH_SIZE = 100
TRIM_APPLICATION_ROOTS = (
    Path("/usr/trim/www/static"),
    Path("/usr/local/apps/@appcenter/trim.media"),
)
TRIM_ROUTE_PATTERN = re.compile(
    rb"(?:/v)?/api/v1/[A-Za-z0-9_./{}:-]{1,180}"
)
TRIM_MUTATION_ROUTE_PATTERN = re.compile(
    rb"/[A-Za-z0-9_{}:.-]{0,80}(?:edit|save|meta|detail)"
    rb"[A-Za-z0-9_./{}:-]{0,120}",
    re.IGNORECASE,
)
TRIM_ROUTE_LITERAL_PATTERN = re.compile(
    rb"[\"']((?:/v)?/(?:api/v1/)?[A-Za-z0-9_./{}:-]*"
    rb"(?:item|metadata|scrap)[A-Za-z0-9_./{}:-]{0,160})[\"']",
    re.IGNORECASE,
)
TRIM_ROUTE_KEYWORDS = (b"item", b"meta", b"nfo", b"recogn", b"scrap")
TRIM_NFO_TOKENS = (
    b"displayepisode",
    b"displayseason",
    b"episodedetails",
    b"uniqueid",
)
TRIM_UI_CONTRACT_TOKENS = {
    "episode-management": ("剧集管理".encode("utf-8"), b"\\u5267\\u96c6\\u7ba1\\u7406"),
    "metadata-edit": ("编辑元数据".encode("utf-8"), b"\\u7f16\\u8f91\\u5143\\u6570\\u636e"),
    "metadata-refresh": ("刷新元数据".encode("utf-8"), b"\\u5237\\u65b0\\u5143\\u6570\\u636e"),
}
TRIM_ROUTE_SCAN_BYTES = 128 * 1024 * 1024
TRIM_ROUTE_SCAN_FILES = 256


def fail(message: str) -> None:
    raise RuntimeError(message)


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_sha256(value: object) -> str:
    serialized = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def bounded_sha256(path: Path) -> str:
    size = path.stat().st_size
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        first_length = min(size, CHUNK_SIZE)
        digest.update(stream.read(first_length))
        if size > first_length:
            last_length = min(size - first_length, CHUNK_SIZE)
            stream.seek(size - last_length)
            digest.update(stream.read(last_length))
    return digest.hexdigest()


def verify_script_digest() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if not DIGEST.fullmatch(expected) or sha256_file(Path(__file__)) != expected:
        fail("episode metadata governance script SHA gate failed")


def load_module(path: Path, expected_sha256: str, name: str):
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or not DIGEST.fullmatch(expected_sha256)
        or sha256_file(path) != expected_sha256
    ):
        fail(f"{name} dependency SHA gate failed")
    spec = importlib.util.spec_from_file_location(f"kt_episode_metadata_{name}", path)
    if spec is None or spec.loader is None:
        fail(f"{name} dependency cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_dependencies() -> tuple[dict, dict[str, str]]:
    modules = {}
    digests = {}
    for name, variable in DEPENDENCIES.items():
        path_text = os.environ.get(variable, "")
        digest = os.environ.get(f"{variable}_SHA256", "")
        path = Path(path_text)
        modules[name] = load_module(path, digest, name)
        digests[name] = digest
    return modules, digests


def write_json_once(path: Path, value: dict) -> None:
    resolved = path.resolve(strict=False)
    try:
        resolved.relative_to(EVIDENCE_ROOT.resolve(strict=False))
    except ValueError as error:
        raise RuntimeError("episode metadata evidence escaped the fixed root") from error
    if not path.is_absolute() or path.exists() or path.is_symlink() or path.suffix != ".json":
        fail("episode metadata evidence output must be a new absolute JSON path")
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


def read_json(path: Path) -> dict:
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        fail("sealed episode metadata evidence is unavailable")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        fail("sealed episode metadata evidence is not an object")
    return value


def parse_request(value: object) -> dict:
    if not isinstance(value, dict):
        fail("episode metadata request must be an object")
    allowed = {
        "auditEvidenceSha256",
        "expectedEpisodeCount",
        "operation",
        "providerId",
        "repairEvidenceSha256",
        "runId",
        "seasons",
        "seriesReconciliation",
        "workItemId",
    }
    if set(value) - allowed:
        fail("episode metadata request contains unsupported fields")
    operation = value.get("operation")
    work_item_id = value.get("workItemId")
    run_id = value.get("runId")
    provider_id = str(value.get("providerId") or "")
    seasons = value.get("seasons")
    expected_count = value.get("expectedEpisodeCount")
    if (
        operation not in {"audit", "repair", "restore", "rollback", "status", "verify"}
        or not isinstance(work_item_id, str)
        or not WORK_ITEM.fullmatch(work_item_id)
        or not isinstance(run_id, str)
        or not RUN_ID.fullmatch(run_id)
        or not re.fullmatch(r"[1-9]\d*", provider_id)
        or not isinstance(seasons, list)
        or not seasons
        or len(seasons) > 100
        or any(not isinstance(season, int) or season < 0 or season > 99 for season in seasons)
        or len(set(seasons)) != len(seasons)
        or not isinstance(expected_count, int)
        or expected_count < 1
        or expected_count > 2_000
    ):
        fail("episode metadata request identity is invalid")
    audit_sha = value.get("auditEvidenceSha256")
    repair_sha = value.get("repairEvidenceSha256")
    series_reconciliation = value.get("seriesReconciliation")
    if operation in {"repair", "restore", "rollback", "verify"} and not (
        isinstance(audit_sha, str) and DIGEST.fullmatch(audit_sha)
    ):
        fail("episode metadata repair or verify requires the sealed audit SHA")
    if operation == "verify" and not (
        isinstance(repair_sha, str) and DIGEST.fullmatch(repair_sha)
    ):
        fail("episode metadata verify requires the sealed repair SHA")
    if operation in {"audit", "status"} and (
        audit_sha is not None or repair_sha is not None
    ):
        fail("episode metadata audit and status reject downstream evidence SHAs")
    normalized_reconciliation = None
    if series_reconciliation is not None:
        if (
            not isinstance(series_reconciliation, dict)
            or set(series_reconciliation)
            != {"canonicalTitle", "mappings", "releaseYear"}
        ):
            fail("episode metadata series reconciliation is invalid")
        canonical_title = str(series_reconciliation.get("canonicalTitle") or "").strip()
        canonical_year = series_reconciliation.get("releaseYear")
        mappings = series_reconciliation.get("mappings")
        if (
            not canonical_title
            or len(canonical_title) > 200
            or any(character in canonical_title for character in ("\0", "/", "\\"))
            or not isinstance(canonical_year, int)
            or canonical_year < 1888
            or canonical_year > 2100
            or not isinstance(mappings, list)
            or not mappings
            or len(mappings) > 100
        ):
            fail("episode metadata series reconciliation is invalid")
        normalized_mappings = []
        source_identities = set()
        target_identities = set()
        source_seasons = set()
        for mapping in mappings:
            if (
                not isinstance(mapping, dict)
                or set(mapping) != {"episodeNumbers", "sourceSeason", "targetSeason"}
            ):
                fail("episode metadata series reconciliation mapping is invalid")
            source_season = mapping.get("sourceSeason")
            target_season = mapping.get("targetSeason")
            episode_numbers = mapping.get("episodeNumbers")
            if (
                not isinstance(source_season, int)
                or source_season < 0
                or source_season > 99
                or not isinstance(target_season, int)
                or target_season < 0
                or target_season > 99
                or not isinstance(episode_numbers, list)
                or not episode_numbers
                or len(episode_numbers) > 1_000
                or any(
                    not isinstance(episode, int) or episode < 1 or episode > 999
                    for episode in episode_numbers
                )
                or len(set(episode_numbers)) != len(episode_numbers)
            ):
                fail("episode metadata series reconciliation mapping is invalid")
            source_seasons.add(source_season)
            for episode in episode_numbers:
                source_identity = (source_season, episode)
                target_identity = (target_season, episode)
                if (
                    source_identity in source_identities
                    or target_identity in target_identities
                ):
                    fail("episode metadata series reconciliation identity is duplicated")
                source_identities.add(source_identity)
                target_identities.add(target_identity)
            normalized_mappings.append(
                {
                    "episodeNumbers": sorted(episode_numbers),
                    "sourceSeason": source_season,
                    "targetSeason": target_season,
                }
            )
        if (
            source_seasons != set(seasons)
            or len(source_identities) != expected_count
        ):
            fail("episode metadata series reconciliation coverage is incomplete")
        normalized_reconciliation = {
            "canonicalTitle": canonical_title,
            "mappings": sorted(
                normalized_mappings,
                key=lambda item: (item["sourceSeason"], item["targetSeason"]),
            ),
            "releaseYear": canonical_year,
        }
    return {
        "auditEvidenceSha256": audit_sha,
        "expectedEpisodeCount": expected_count,
        "operation": operation,
        "providerId": provider_id,
        "repairEvidenceSha256": repair_sha,
        "runId": run_id,
        "seasons": sorted(seasons),
        "seriesReconciliation": normalized_reconciliation,
        "workItemId": work_item_id,
    }


def task_id(request: dict) -> str:
    return f"postmeta-{request['workItemId']}-{request['runId']}"


def series_episode_targets(request: dict) -> dict[tuple[int, int], tuple[int, int]]:
    """把密封系列纠正映射投影为唯一来源季集到目标季集字典。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        return {}
    targets = {}
    for mapping in reconciliation["mappings"]:
        source_season = mapping["sourceSeason"]
        target_season = mapping["targetSeason"]
        for episode in mapping["episodeNumbers"]:
            targets[(source_season, episode)] = (target_season, episode)
    if len(targets) != request["expectedEpisodeCount"]:
        fail("episode metadata series reconciliation coverage changed")
    return targets


def canonical_series_title_root(request: dict) -> Path | None:
    """从已校验 TMDB 系列标题、年份和编号派生唯一正式作品根。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        return None
    return (
        MEDIA_ROOT
        / "TV"
        / (
            f"{reconciliation['canonicalTitle']} "
            f"({reconciliation['releaseYear']}) "
            f"[tmdbid-{request['providerId']}]"
        )
    )


def reconciled_inventory_request(request: dict) -> dict:
    """把系列纠正请求转换为独立验收所需的目标季范围。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        return request
    target_seasons = sorted(
        {mapping["targetSeason"] for mapping in reconciliation["mappings"]}
    )
    return {
        **request,
        "seasons": target_seasons,
        "seriesReconciliation": None,
    }


def evidence_paths(request: dict) -> dict[str, Path]:
    root = EVIDENCE_ROOT / task_id(request) / request["runId"]
    return {
        "audit": root / "episode-metadata-audit.json",
        "backup": root / "metadata-backup.json",
        "failure": root / "episode-metadata-failure.json",
        "remapDelete": root / "episode-path-remap-delete.json",
        "remapPlan": root / "episode-path-remap-plan.json",
        "remapTransaction": root / "episode-path-remap-transaction.json",
        "sourceBackup": root / "episode-path-source-backup.json",
        "sourcePlan": root / "episode-path-source-plan.json",
        "plan": root / "plan.json",
        "repair": root / "metadata-repair.json",
        "rollback": root / "episode-metadata-rollback.json",
        "subtitleRestore": root / "episode-subtitle-restore.json",
        "transaction": root / "episode-metadata-repair.json",
        "verify": root / "episode-metadata-verify.json",
    }


def connect_readonly() -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{MEDIA_DB}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def inventory(request: dict) -> dict:
    if not MEDIA_DB.is_file() or MEDIA_DB.is_symlink():
        fail("trim.media database is unavailable")
    with connect_readonly() as connection:
        rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT im.path, im.recognition_status,
                       i.guid AS episode_guid, i.title AS episode_title,
                       i.season_number, i.episode_number,
                       p.guid AS season_guid, p.season_number AS parent_season,
                       gp.guid AS series_guid, gp.title AS series_title,
                       gp.original_title AS series_original_title,
                       gp.tmdb_id AS series_tmdb_id
                  FROM item_media im
                  JOIN item i ON i.guid = im.item_guid
                  JOIN item p ON p.guid = i.parent_guid
                  JOIN item gp ON gp.guid = p.parent_guid
                 WHERE i.type = 'Episode' AND p.type = 'Season'
                   AND gp.type = 'TV' AND gp.tmdb_id = ?
                 ORDER BY p.season_number, i.episode_number, im.path
                """,
                (int(request["providerId"]),),
            )
        ]
    video_rows = [
        row
        for row in rows
        if Path(str(row.get("path") or "")).suffix.lower() in VIDEO_EXTENSIONS
    ]
    if not video_rows or len({row["series_guid"] for row in video_rows}) != 1:
        fail("episode metadata provider root is missing or duplicated")
    selected = [
        row for row in video_rows if int(row.get("parent_season") or -1) in request["seasons"]
    ]
    if len(selected) != request["expectedEpisodeCount"]:
        fail("episode metadata expected episode count changed")
    if {int(row["parent_season"]) for row in selected} != set(request["seasons"]):
        fail("episode metadata requested season set is incomplete")
    if len(request["seasons"]) > 1 and len(selected) != len(video_rows):
        fail("episode metadata multi-season refresh must cover the complete title")
    reconciliation_targets = series_episode_targets(request)
    if reconciliation_targets:
        selected_identities = {
            (int(row.get("season_number") or -1), int(row.get("episode_number") or -1))
            for row in selected
        }
        if selected_identities != set(reconciliation_targets):
            fail("episode metadata series reconciliation source scope changed")
    paths = []
    identities = set()
    roots = set()
    for row in selected:
        path = Path(str(row.get("path") or ""))
        if path.is_symlink() or not path.is_file():
            fail("episode metadata canonical video is missing or unsafe")
        resolved = path.resolve(strict=True)
        try:
            resolved.relative_to(MEDIA_ROOT.resolve(strict=True))
        except ValueError as error:
            raise RuntimeError("episode metadata video escaped the canonical root") from error
        season_match = re.fullmatch(r"Season (\d{2})", path.parent.name)
        episode_match = re.search(r"- S(\d{2})E(\d{2,3})(?:\D|$)", path.stem)
        season = int(row.get("parent_season") or -1)
        episode = int(row.get("episode_number") or -1)
        if (
            not season_match
            or not episode_match
            or int(season_match.group(1)) != season
            or int(episode_match.group(1)) != season
            or int(episode_match.group(2)) != episode
            or int(row.get("season_number") or -1) != season
        ):
            fail("episode metadata canonical season/episode identity changed")
        identities.add((season, episode))
        roots.add(path.parent.parent.resolve(strict=True))
        paths.append(os.fspath(path))
    identity_or_path_duplicated = (
        len(paths) != len(set(paths)) or len(identities) != len(paths)
    )
    root_identity_invalid = len(roots) != 1 and not reconciliation_targets
    if identity_or_path_duplicated or root_identity_invalid:
        fail("episode metadata canonical path identity is duplicated")
    title_roots = sorted(os.fspath(root) for root in roots)
    title_root = None
    if len(title_roots) == 1:
        title_root = title_roots[0]
    return {
        "rows": selected,
        "scope": "complete-title" if len(selected) == len(video_rows) else "complete-season",
        "seriesTitle": str(
            selected[0].get("series_title")
            or selected[0].get("series_original_title")
            or ""
        ).strip(),
        "titleRoot": title_root,
        "titleRoots": title_roots,
    }


def remapped_video_path(
    path: Path,
    *,
    source_season: int,
    source_episode: int,
    target_season: int,
    target_episode: int,
    target_title: str | None = None,
    target_title_root: Path | None = None,
) -> Path:
    match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", path.stem)
    if (
        match is None
        or int(match.group(1)) != source_season
        or int(match.group(2)) != source_episode
        or path.parent.name != f"Season {source_season:02d}"
        or target_episode < 0
        or target_episode > 999
    ):
        fail("episode metadata canonical remap identity is invalid")
    if (target_title_root is None and target_season != source_season):
        fail("episode metadata cross-season remap requires one canonical series root")
    width = max(2, len(str(target_episode)))
    replacement = f"- S{target_season:02d}E{target_episode:0{width}d}"
    prefix = path.stem[: match.start()]
    if target_title is not None:
        prefix = f"{target_title} "
    new_stem = f"{prefix}{replacement}{path.stem[match.end():]}"
    target_parent = path.parent
    if target_title_root is not None:
        target_parent = target_title_root / f"Season {target_season:02d}"
    return target_parent / f"{new_stem}{path.suffix}"


def build_plan(
    request: dict,
    observed: dict,
    *,
    episode_targets: dict[tuple[int, int], tuple[int, int]] | None = None,
    provider_identity: dict | None = None,
    seal_video_digests: bool = True,
) -> dict:
    episode_targets = episode_targets or {}
    target_title_root = None
    target_title = None
    if episode_targets and request.get("seriesReconciliation") is not None:
        target_title_root = canonical_series_title_root(request)
        target_title = request["seriesReconciliation"]["canonicalTitle"]
    operations = []
    evidence = []
    for index, row in enumerate(observed["rows"], start=1):
        source = Path(row["path"])
        season = int(row["season_number"])
        episode = int(row["episode_number"])
        target_season, target_episode = episode_targets.get(
            (season, episode), (season, episode)
        )
        target = remapped_video_path(
            source,
            source_season=season,
            source_episode=episode,
            target_season=target_season,
            target_episode=target_episode,
            target_title=target_title,
            target_title_root=target_title_root,
        )
        stat = source.stat()
        evidence_id = f"canonical-video-{index:04d}"
        operations.append(
            {
                "evidenceId": evidence_id,
                "fileKind": "video",
                "operation": "move",
                "sourcePath": os.fspath(target),
                "targetPath": os.fspath(target),
            }
        )
        evidence.append(
            {
                "digest": bounded_sha256(source) if seal_video_digests else "0" * 64,
                "evidenceId": evidence_id,
                "evidenceMethod": (
                    "bounded-sha256-first-last-4mib-v1"
                    if seal_video_digests
                    else "inspection-size-only-v1"
                ),
                "fileKind": "video",
                "mtimeMs": stat.st_mtime_ns // 1_000_000,
                "path": os.fspath(source),
                "scope": "local",
                "size": stat.st_size,
            }
        )
    if not observed["seriesTitle"]:
        fail("episode metadata canonical title is empty")
    provider_title = (
        str(provider_identity.get("providerTitle") or "").strip()
        if isinstance(provider_identity, dict)
        else ""
    ) or observed["seriesTitle"]
    plan_title = observed["seriesTitle"]
    plan_release_year = None
    if isinstance(provider_identity, dict) and isinstance(
        provider_identity.get("releaseYear"), int
    ):
        plan_release_year = int(provider_identity["releaseYear"])
    if request.get("seriesReconciliation") is not None and episode_targets:
        plan_title = request["seriesReconciliation"]["canonicalTitle"]
        plan_release_year = request["seriesReconciliation"]["releaseYear"]
        provider_title = plan_title
    identity = {
        "mediaType": "tv",
        "providerRef": {"provider": "tmdb", "providerId": request["providerId"]},
        "providerTitle": provider_title,
        "releaseYear": plan_release_year,
        "title": plan_title,
    }
    plan = {
        "execution": {
            "allowlists": {
                "localSourceRoot": os.fspath(MEDIA_ROOT),
                "localTargetRoot": os.fspath(MEDIA_ROOT),
            },
            "phase": "local-only",
        },
        "identity": identity,
        "manifests": {"local": {"forward": operations}},
        "metadataOnlyRefresh": True,
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sealedAt": utc_now(),
        "sourceEvidence": evidence,
        "strategy": "post-acceptance-metadata",
        "workItemId": request["workItemId"],
    }
    if request.get("seriesReconciliation") is not None:
        plan["seriesReconciliation"] = {
            **request["seriesReconciliation"],
            "sourceTitleRoots": observed.get("titleRoots") or [],
            "targetTitleRoot": os.fspath(canonical_series_title_root(request)),
        }
    if identity["releaseYear"] is not None:
        plan["agentAmendments"] = [
            {
                "kind": "identity",
                "planSha256": "0" * 64,
                "provider": "tmdb",
                "providerId": request["providerId"],
                "providerTitle": provider_title,
                "releaseYear": identity["releaseYear"],
            }
        ]
    return plan


def ordinal_episode_targets(inspection: dict) -> dict[tuple[int, int], tuple[int, int]]:
    targets: dict[tuple[int, int], tuple[int, int]] = {}
    for unit in inspection.get("units") or []:
        season = int(unit.get("season") or -1)
        mapping = unit.get("providerMapping") or {}
        if mapping.get("mode") != "ordinal-season":
            continue
        provider_season = int(mapping.get("providerSeason") or -1)
        episode_map = mapping.get("episodeMap")
        if (
            season < 0
            or provider_season != season
            or not isinstance(episode_map, dict)
            or len(episode_map) != int(unit.get("episodeCount") or 0)
        ):
            fail("episode metadata ordinal provider mapping is incomplete")
        provider_episodes = set()
        for local_text, provider_value in episode_map.items():
            if not str(local_text).isdigit() or not isinstance(provider_value, int):
                fail("episode metadata ordinal episode map is invalid")
            local_episode = int(local_text)
            if provider_value < 0 or provider_value > 999 or provider_value in provider_episodes:
                fail("episode metadata ordinal provider episodes are invalid")
            provider_episodes.add(provider_value)
            targets[(season, local_episode)] = (provider_season, provider_value)
    return targets


def validate_series_reconciliation_inspection(
    request: dict,
    inspection: dict,
) -> None:
    """要求官方元数据身份与每个来源季的目标季集映射完全一致。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        return
    identity = inspection.get("identity")
    units = inspection.get("units")
    if (
        not isinstance(identity, dict)
        or identity.get("provider") != "tmdb"
        or str(identity.get("providerId") or "") != request["providerId"]
        or identity.get("providerTitle") != reconciliation["canonicalTitle"]
        or identity.get("releaseYear") != reconciliation["releaseYear"]
        or not isinstance(units, list)
    ):
        fail("episode metadata series provider identity is inconsistent")
    units_by_season = {}
    for unit in units:
        if not isinstance(unit, dict) or not isinstance(unit.get("season"), int):
            fail("episode metadata series provider mapping is incomplete")
        units_by_season[int(unit["season"])] = unit
    if len(units_by_season) != len(reconciliation["mappings"]):
        fail("episode metadata series provider mapping is incomplete")
    for mapping in reconciliation["mappings"]:
        unit = units_by_season.get(mapping["sourceSeason"])
        provider_mapping = unit.get("providerMapping") if isinstance(unit, dict) else None
        episode_map = (
            provider_mapping.get("episodeMap")
            if isinstance(provider_mapping, dict)
            else None
        )
        if (
            not isinstance(provider_mapping, dict)
            or provider_mapping.get("providerSeason") != mapping["targetSeason"]
            or not isinstance(episode_map, dict)
            or {
                int(local): int(provider)
                for local, provider in episode_map.items()
                if str(local).isdigit() and isinstance(provider, int)
            }
            != {episode: episode for episode in mapping["episodeNumbers"]}
        ):
            fail("episode metadata series provider mapping is inconsistent")


def inspect_series_reconciliation_provider(
    request: dict,
    tmdb_module,
) -> dict:
    """直接读取当前 TMDB 系列与目标季页，生成跨物理根审计所需映射。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        fail("episode metadata series reconciliation is unavailable")
    series_result = tmdb_module.fetch_page(
        f"https://www.themoviedb.org/tv/{request['providerId']}?language=zh-CN"
    )
    series = tmdb_module.parse_series_page(series_result["body"])
    if (
        series.get("title") != reconciliation["canonicalTitle"]
        or series.get("year") != reconciliation["releaseYear"]
    ):
        fail("episode metadata series provider identity is inconsistent")
    target_seasons = sorted(
        {mapping["targetSeason"] for mapping in reconciliation["mappings"]}
    )
    provider_seasons = {}
    provider_evidence = {
        "series": tmdb_module.page_evidence(series_result),
        "seasons": {},
    }
    for season_number in target_seasons:
        result = tmdb_module.fetch_page(
            f"https://www.themoviedb.org/tv/{request['providerId']}/season/"
            f"{season_number}?language=zh-CN"
        )
        season = tmdb_module.parse_season_page(
            result["body"], season_number=season_number
        )
        provider_seasons[season_number] = {
            episode["episode"]: episode for episode in season["episodes"]
        }
        provider_evidence["seasons"][f"S{season_number:02d}"] = {
            **tmdb_module.page_evidence(result),
            "episodeCount": len(season["episodes"]),
            "seasonTitle": season.get("seasonTitle"),
        }
    units = []
    for mapping in reconciliation["mappings"]:
        provider_episodes = provider_seasons[mapping["targetSeason"]]
        if any(
            episode not in provider_episodes for episode in mapping["episodeNumbers"]
        ):
            fail("episode metadata series provider episode coverage is incomplete")
        units.append(
            {
                "accepted": True,
                "episodeCount": len(mapping["episodeNumbers"]),
                "episodeGapCount": 0,
                "episodeGaps": [],
                "missingA": [],
                "missingB": [],
                "missingC": [],
                "providerFallbacks": [],
                "providerMapping": {
                    "episodeMap": {
                        str(episode): episode
                        for episode in mapping["episodeNumbers"]
                    },
                    "mode": "series-season-reconciliation",
                    "providerSeason": mapping["targetSeason"],
                },
                "season": mapping["sourceSeason"],
            }
        )
    return {
        "identity": {
            "provider": "tmdb",
            "providerId": request["providerId"],
            "providerTitle": reconciliation["canonicalTitle"],
            "releaseYear": reconciliation["releaseYear"],
        },
        "providerEvidence": provider_evidence,
        "titleRoot": None,
        "trimIdentityReason": "series-reconciliation-source-roots",
        "units": units,
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def inverse_operation(operation: dict) -> dict:
    return {
        "evidenceId": operation["evidenceId"],
        "fileKind": operation["fileKind"],
        "operation": "move",
        "sourcePath": operation["targetPath"],
        "targetPath": operation["sourcePath"],
    }


def build_remap_plan(
    request: dict,
    observed: dict,
    targets: dict[tuple[int, int], tuple[int, int]],
) -> dict | None:
    series_reconciliation = request.get("seriesReconciliation")
    changed = {
        identity: target
        for identity, target in targets.items()
        if identity != target
    }
    if series_reconciliation is not None:
        changed = dict(targets)
    if not changed:
        return None
    title_roots = [Path(value) for value in observed.get("titleRoots") or []]
    target_title_root = None
    target_title = None
    title_root = None
    target_root = None
    if series_reconciliation is not None:
        if (
            observed.get("scope") != "complete-title"
            or set(changed) != {
                (int(row["season_number"]), int(row["episode_number"]))
                for row in observed["rows"]
            }
            or not title_roots
            or any(not root.is_dir() or root.is_symlink() for root in title_roots)
        ):
            fail("episode metadata series reconciliation scope is incomplete")
        target_title_root = canonical_series_title_root(request)
        target_title = series_reconciliation["canonicalTitle"]
        if (
            target_title_root is None
            or target_title_root in title_roots
            or target_title_root.exists()
            or target_title_root.is_symlink()
        ):
            fail("episode metadata canonical series root is unavailable")
    else:
        if len(request["seasons"]) != 1 or observed.get("scope") not in {
            "complete-season",
            "complete-title",
        }:
            fail("episode metadata ordinal remap must execute one complete season at a time")
        season = request["seasons"][0]
        if {identity[0] for identity in changed} != {season}:
            fail("episode metadata ordinal remap escaped the requested season")
        title_root = Path(observed["titleRoot"])
        target_root = title_root / f"Season {season:02d}"
        if not title_root.is_dir() or not target_root.is_dir():
            fail("episode metadata ordinal remap root is unavailable")
    operations = []
    evidence = []
    source_paths = set()
    target_paths = set()
    video_count = 0
    for row in observed["rows"]:
        source_video = Path(row["path"])
        identity = (int(row["season_number"]), int(row["episode_number"]))
        if identity not in changed:
            continue
        target_season, target_episode = changed[identity]
        target_video = remapped_video_path(
            source_video,
            source_season=identity[0],
            source_episode=identity[1],
            target_season=target_season,
            target_episode=target_episode,
            target_title=target_title,
            target_title_root=target_title_root,
        )
        candidates = sorted(
            (
                candidate
                for candidate in source_video.parent.iterdir()
                if candidate.name == source_video.name
                or candidate.name.startswith(f"{source_video.stem}.")
            ),
            key=os.fspath,
        )
        if source_video not in candidates:
            fail("episode metadata ordinal remap lost its source video")
        for candidate in candidates:
            if candidate.is_symlink() or not candidate.is_file():
                fail("episode metadata ordinal remap source is unsafe")
            suffix = candidate.name[len(source_video.stem) :]
            target = target_video.with_name(f"{target_video.stem}{suffix}")
            if target.exists() or target.is_symlink() or os.fspath(target) in target_paths:
                fail("episode metadata ordinal remap target collides")
            target_paths.add(os.fspath(target))
            source_paths.add(os.fspath(candidate))
            if candidate == source_video:
                file_kind = "video"
                method = "bounded-sha256-first-last-4mib-v1"
                digest = bounded_sha256(candidate)
                video_count += 1
            elif candidate.suffix.lower() in SUBTITLE_EXTENSIONS:
                file_kind = "subtitle"
                method = "sha256-full-v1"
                digest = sha256_file(candidate)
            else:
                file_kind = "asset"
                method = "sha256-full-v1"
                digest = sha256_file(candidate)
            stat = candidate.stat()
            evidence_id = f"ordinal-remap-{len(operations) + 1:04d}"
            operations.append(
                {
                    "evidenceId": evidence_id,
                    "fileKind": file_kind,
                    "operation": "move",
                    "sourcePath": os.fspath(candidate),
                    "targetPath": os.fspath(target),
                }
            )
            evidence.append(
                {
                    "digest": digest,
                    "evidenceId": evidence_id,
                    "evidenceMethod": method,
                    "fileKind": file_kind,
                    "mtimeMs": stat.st_mtime_ns // 1_000_000,
                    "path": os.fspath(candidate),
                    "scope": "local",
                    "size": stat.st_size,
                }
            )
    source_season_directories = {
        Path(row["path"]).parent for row in observed["rows"]
    }
    for source_directory in sorted(source_season_directories, key=os.fspath):
        for candidate in sorted(source_directory.iterdir(), key=os.fspath):
            if (
                candidate.suffix.lower() not in SUBTITLE_EXTENSIONS
                or os.fspath(candidate) in source_paths
            ):
                continue
            if candidate.is_symlink() or not candidate.is_file():
                fail("episode metadata ordinal subtitle source is unsafe")
            match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", candidate.stem)
            if match is None:
                fail("episode metadata ordinal subtitle has no season/episode identity")
            identity = (int(match.group(1)), int(match.group(2)))
            if identity not in changed:
                continue
            target_season, target_episode = changed[identity]
            target = remapped_video_path(
                candidate,
                source_season=identity[0],
                source_episode=identity[1],
                target_season=target_season,
                target_episode=target_episode,
                target_title=target_title,
                target_title_root=target_title_root,
            )
            if (
                target.exists()
                or target.is_symlink()
                or os.fspath(target) in target_paths
            ):
                fail("episode metadata ordinal subtitle target collides")
            target_paths.add(os.fspath(target))
            stat = candidate.stat()
            evidence_id = f"ordinal-remap-{len(operations) + 1:04d}"
            operations.append(
                {
                    "evidenceId": evidence_id,
                    "fileKind": "subtitle",
                    "operation": "move",
                    "sourcePath": os.fspath(candidate),
                    "targetPath": os.fspath(target),
                }
            )
            evidence.append(
                {
                    "digest": sha256_file(candidate),
                    "evidenceId": evidence_id,
                    "evidenceMethod": "sha256-full-v1",
                    "fileKind": "subtitle",
                    "mtimeMs": stat.st_mtime_ns // 1_000_000,
                    "path": os.fspath(candidate),
                    "scope": "local",
                    "size": stat.st_size,
                }
            )
    if series_reconciliation is not None:
        for root_index, source_root in enumerate(title_roots, start=1):
            root_target_seasons = {
                changed[(int(row["season_number"]), int(row["episode_number"]))][0]
                for row in observed["rows"]
                if Path(row["path"]).parent.parent == source_root
            }
            if len(root_target_seasons) != 1:
                fail("episode metadata series asset target season is ambiguous")
            target_season = next(iter(root_target_seasons))
            for candidate in sorted(source_root.rglob("*"), key=os.fspath):
                candidate_path = os.fspath(candidate)
                if candidate.is_dir() and not candidate.is_symlink():
                    continue
                if candidate_path in source_paths:
                    continue
                if candidate.is_symlink() or not candidate.is_file():
                    fail("episode metadata series residual source is unsafe")
                suffix = candidate.suffix.lower()
                if suffix == ".nfo" or suffix in IMAGE_EXTENSIONS:
                    continue
                if suffix not in SERIES_ASSET_EXTENSIONS or "extras" not in {
                    part.casefold() for part in candidate.relative_to(source_root).parts
                }:
                    fail("episode metadata series residual source is unsupported")
                target = (
                    target_title_root
                    / f"Season {target_season:02d}"
                    / "extras"
                    / "Fonts"
                    / f"source-{root_index:02d}"
                    / candidate.name
                )
                if (
                    target.exists()
                    or target.is_symlink()
                    or os.fspath(target) in target_paths
                ):
                    fail("episode metadata series asset target collides")
                target_paths.add(os.fspath(target))
                source_paths.add(candidate_path)
                stat = candidate.stat()
                evidence_id = f"ordinal-remap-{len(operations) + 1:04d}"
                operations.append(
                    {
                        "evidenceId": evidence_id,
                        "fileKind": "asset",
                        "operation": "move",
                        "sourcePath": candidate_path,
                        "targetPath": os.fspath(target),
                    }
                )
                evidence.append(
                    {
                        "digest": sha256_file(candidate),
                        "evidenceId": evidence_id,
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": "asset",
                        "mtimeMs": stat.st_mtime_ns // 1_000_000,
                        "path": candidate_path,
                        "scope": "local",
                        "size": stat.st_size,
                    }
                )
    if video_count != len(changed) or video_count != request["expectedEpisodeCount"]:
        fail("episode metadata ordinal remap video coverage is incomplete")
    operations.sort(key=lambda item: (item["targetPath"], item["fileKind"]))
    inverse = [inverse_operation(item) for item in reversed(operations)]
    manifests = {
        "cloudSidecarQuarantine": {"forward": [], "inverse": []},
        "cloudVideo": {"forward": [], "inverse": []},
        "local": {"forward": operations, "inverse": inverse},
    }
    plan_source_root = title_root
    plan_target_root = target_root
    plan_title = observed["seriesTitle"]
    if series_reconciliation is not None:
        plan_source_root = MEDIA_ROOT
        plan_target_root = MEDIA_ROOT
        plan_title = series_reconciliation["canonicalTitle"]
    plan = {
        "execution": {
            "allowlists": {
                "localSourceRoot": os.fspath(plan_source_root),
                "localTargetRoot": os.fspath(plan_target_root),
            },
            "manifestSha256": {
                "cloudSidecarForward": stable_sha256([]),
                "cloudSidecarInverse": stable_sha256([]),
                "cloudVideoForward": stable_sha256([]),
                "cloudVideoInverse": stable_sha256([]),
                "localForward": stable_sha256(operations),
                "localInverse": stable_sha256(inverse),
            },
            "phase": "local-only",
            "replayKey": f"{request['workItemId']}-{request['runId']}-ordinal-remap-v1",
        },
        "identity": {
            "mediaType": "tv",
            "providerRef": {"provider": "tmdb", "providerId": request["providerId"]},
            "title": plan_title,
        },
        "manifests": manifests,
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sealedAt": utc_now(),
        "sourceEvidence": sorted(evidence, key=lambda item: item["path"]),
        "workItemId": request["workItemId"],
    }
    if series_reconciliation is not None:
        plan["identity"]["providerTitle"] = series_reconciliation["canonicalTitle"]
        plan["identity"]["releaseYear"] = series_reconciliation["releaseYear"]
        plan["seriesReconciliation"] = {
            **series_reconciliation,
            "sourceTitleRoots": [os.fspath(root) for root in title_roots],
            "targetTitleRoot": os.fspath(target_title_root),
        }
    return plan


def write_plan(path: Path, plan: dict) -> str:
    write_json_once(path, plan)
    return sha256_file(path)


def inspection_projection(inspection: dict) -> dict:
    def compact_ranges(values: list[int]) -> list[str]:
        if not values:
            return []
        ordered = sorted(set(values))
        width = max(2, len(str(ordered[-1])))
        ranges = []
        start = previous = ordered[0]
        for value in ordered[1:]:
            if value == previous + 1:
                previous = value
                continue
            ranges.append(
                f"E{start:0{width}d}"
                if start == previous
                else f"E{start:0{width}d}-E{previous:0{width}d}"
            )
            start = previous = value
        ranges.append(
            f"E{start:0{width}d}"
            if start == previous
            else f"E{start:0{width}d}-E{previous:0{width}d}"
        )
        return ranges

    seasons = []
    total_gaps = 0
    for unit in inspection.get("units") or []:
        field_counts = Counter(
            field
            for gap in unit.get("episodeGaps") or []
            for field in gap.get("missingFields") or []
        )
        fallback_counts = Counter(
            field
            for fallback in unit.get("providerFallbacks") or []
            for field in fallback.get("fields") or []
        )
        gap_ranges = {
            field: compact_ranges(
                [
                    int(gap["episode"])
                    for gap in unit.get("episodeGaps") or []
                    if field in (gap.get("missingFields") or [])
                ]
            )
            for field in sorted(field_counts)
        }
        gap_count = int(unit.get("episodeGapCount") or 0)
        total_gaps += gap_count
        database_advisory_episodes = unit.get(
            "databaseProjectionAdvisoryEpisodes"
        ) or {}
        provider_mapping = unit.get("providerMapping") or {}
        episode_map = provider_mapping.get("episodeMap") or {}
        seasons.append(
            {
                "accepted": bool(unit.get("accepted")),
                "databaseProjectionAdvisoryCounts": {
                    field: len(episodes)
                    for field, episodes in sorted(database_advisory_episodes.items())
                },
                "databaseProjectionAdvisoryRanges": {
                    field: compact_ranges([int(episode) for episode in episodes])
                    for field, episodes in sorted(database_advisory_episodes.items())
                },
                "episodeCount": int(unit.get("episodeCount") or 0),
                "episodeGapCount": gap_count,
                "fallbackFieldCounts": dict(sorted(fallback_counts.items())),
                "gapEpisodeRangesByField": gap_ranges,
                "missingFieldCounts": dict(sorted(field_counts.items())),
                "providerMapping": {
                    "mode": provider_mapping.get("mode"),
                    "providerSeason": provider_mapping.get("providerSeason"),
                    "remappedEpisodeCount": sum(
                        str(local_episode) != str(provider_episode)
                        for local_episode, provider_episode in episode_map.items()
                    ),
                }
                if provider_mapping
                else None,
                "season": int(unit["season"]),
            }
        )
    return {"episodeGapCount": total_gaps, "seasons": seasons}


def audit_request_identity(request: dict) -> dict:
    identity = {
        "expectedEpisodeCount": request["expectedEpisodeCount"],
        "providerId": request["providerId"],
        "runId": request["runId"],
        "seasons": request["seasons"],
        "workItemId": request["workItemId"],
    }
    if request.get("seriesReconciliation") is not None:
        identity["seriesReconciliation"] = request["seriesReconciliation"]
    return identity


def metadata_runner_count() -> int:
    excluded = {os.getpid()}
    current = os.getpid()
    while current > 1:
        try:
            stat = (Path("/proc") / str(current) / "stat").read_text(
                encoding="utf-8"
            )
            parent = int(stat[stat.rfind(")") + 2 :].split()[1])
        except (OSError, ValueError, IndexError):
            break
        if parent <= 0 or parent in excluded:
            break
        excluded.add(parent)
        current = parent
    count = 0
    for process in Path("/proc").iterdir():
        if not process.name.isdigit() or int(process.name) in excluded:
            continue
        try:
            command = (process / "cmdline").read_bytes()
        except OSError:
            continue
        if (
            b"/vol1/docker/kt-media-governance/releases/mcp/" in command
            and b"/media-episode-metadata-governance.py" in command
        ):
            count += 1
    return count


def artifact_status(path: Path) -> dict:
    if not path.exists():
        return {"exists": False}
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(EVIDENCE_ROOT.resolve(strict=True))
    except ValueError as error:
        raise RuntimeError(
            "episode metadata status artifact escaped evidence root"
        ) from error
    if path.is_symlink() or not path.is_file():
        fail("episode metadata status artifact is unsafe")
    value = read_json(path)
    result = {
        "exists": True,
        "schemaVersion": value.get("schemaVersion"),
        "sha256": sha256_file(path),
        "state": value.get("state"),
    }
    if value.get("schemaVersion") == "media-episode-metadata-failure-v1":
        result["operation"] = value.get("operation")
        result["reason"] = " ".join(str(value.get("reason") or "").split())[:500]
    return result


def canonical_plan_projection(plan_path: Path) -> dict | None:
    if not plan_path.exists():
        return None
    plan = read_json(plan_path)
    operations = plan.get("manifests", {}).get("local", {}).get("forward")
    if not isinstance(operations, list):
        fail("episode metadata status plan manifest is invalid")
    paths = [
        item.get("targetPath")
        for item in operations
        if isinstance(item, dict) and item.get("fileKind") == "video"
    ]
    if (
        not paths
        or any(not isinstance(path, str) or not path.startswith("/") for path in paths)
        or len(paths) != len(set(paths))
    ):
        fail("episode metadata status plan paths are invalid")
    counts: dict[str, int] = {}
    with connect_readonly() as connection:
        for offset in range(0, len(paths), 800):
            chunk = paths[offset : offset + 800]
            marks = ",".join("?" for _ in chunk)
            for row in connection.execute(
                f"SELECT path, COUNT(*) AS row_count FROM item_media "
                f"WHERE path IN ({marks}) GROUP BY path",
                chunk,
            ):
                counts[str(row[0])] = int(row[1])
    return {
        "duplicatePathCount": sum(count - 1 for count in counts.values() if count > 1),
        "expectedPathCount": len(paths),
        "missingPathCount": len(set(paths) - set(counts)),
        "presentPathCount": len(counts),
    }


def canonical_title_projection(plan_path: Path) -> dict | None:
    if not plan_path.exists():
        return None
    plan = read_json(plan_path)
    operations = plan.get("manifests", {}).get("local", {}).get("forward")
    paths = [
        item.get("targetPath")
        for item in operations or []
        if isinstance(item, dict) and item.get("fileKind") == "video"
    ]
    if not paths or any(not isinstance(path, str) for path in paths):
        fail("episode metadata title projection plan is invalid")
    rows = {}
    with connect_readonly() as connection:
        for offset in range(0, len(paths), 800):
            chunk = paths[offset : offset + 800]
            marks = ",".join("?" for _ in chunk)
            for row in connection.execute(
                f"SELECT im.path, i.title, i.season_number, i.episode_number, i.guid "
                f"FROM item_media im JOIN item i ON i.guid = im.item_guid "
                f"WHERE im.path IN ({marks})",
                chunk,
            ):
                rows[str(row[0])] = {
                    "databaseTitle": " ".join(str(row[1] or "").split())[:200],
                    "episode": int(row[3] or 0),
                    "episodeGuid": str(row[4] or ""),
                    "season": int(row[2] or 0),
                }
    mismatches = []
    mismatch_count = 0
    sampled_seasons = set()
    for path_text in paths:
        row = rows.get(path_text)
        if row is None:
            continue
        nfo_path = Path(path_text).with_suffix(".nfo")
        try:
            nfo_title = " ".join(
                str(ET.parse(nfo_path).getroot().findtext("title") or "").split()
            )[:200]
        except (ET.ParseError, OSError):
            nfo_title = ""
        if nfo_title == row["databaseTitle"]:
            continue
        mismatch_count += 1
        if row["season"] not in sampled_seasons:
            sampled_seasons.add(row["season"])
            mismatches.append(
                {
                    **row,
                    "nfoTitle": nfo_title,
                }
            )
    return {
        "databaseRowCount": len(rows),
        "mismatchCount": mismatch_count,
        "samples": sorted(mismatches, key=lambda item: item["season"]),
    }


def subtitle_layout_projection(plan_path: Path) -> dict | None:
    if not plan_path.is_file() or plan_path.is_symlink():
        return None
    plan = read_json(plan_path)
    videos = [
        Path(operation["targetPath"])
        for operation in plan.get("manifests", {}).get("local", {}).get("forward", [])
        if operation.get("fileKind") == "video"
    ]
    season_roots = sorted({video.parent for video in videos}, key=os.fspath)
    if not season_roots:
        return None
    title_roots = {root.parent for root in season_roots}
    series_reconciliation = plan.get("seriesReconciliation")
    multiple_roots_allowed = (
        isinstance(series_reconciliation, dict)
        and series_reconciliation.get("sourceTitleRoots")
        == sorted(os.fspath(root) for root in title_roots)
    )
    if len(title_roots) != 1 and not multiple_roots_allowed:
        fail("episode metadata subtitle projection spans title roots")
    projection_root = MEDIA_ROOT
    if len(title_roots) == 1:
        projection_root = next(iter(title_roots))
    subtitles = []
    for season_root in season_roots:
        for candidate in season_root.rglob("*"):
            if candidate.suffix.lower() not in SUBTITLE_EXTENSIONS:
                continue
            if candidate.is_symlink() or not candidate.is_file():
                fail("episode metadata subtitle projection found an unsafe path")
            match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", candidate.stem)
            subtitles.append(
                {
                    "identity": (
                        f"S{int(match.group(1)):02d}E{int(match.group(2)):03d}"
                        if match
                        else None
                    ),
                    "path": candidate.relative_to(projection_root).as_posix(),
                }
            )
            if len(subtitles) > 2_000:
                fail("episode metadata subtitle projection exceeded its bound")
    return {
        "count": len(subtitles),
        "identityCount": sum(item["identity"] is not None for item in subtitles),
        "samples": subtitles[:20],
    }


def official_subtitle_projection(plan_path: Path) -> dict | None:
    if not plan_path.is_file() or plan_path.is_symlink() or not OFFICIAL_API_HELPER.is_file():
        return None
    plan = read_json(plan_path)
    paths = [
        operation["targetPath"]
        for operation in plan.get("manifests", {}).get("local", {}).get("forward", [])
        if operation.get("fileKind") == "video"
    ]
    if not paths:
        fail("episode metadata official subtitle scope is invalid")
    if len(paths) > 100:
        return {
            "available": False,
            "expectedPathCount": len(paths),
            "queryLimit": 100,
            "reason": "scope-exceeds-bounded-query",
        }
    marks = ",".join("?" for _ in paths)
    with connect_readonly() as connection:
        rows = [
            dict(row)
            for row in connection.execute(
                f"SELECT im.path, im.guid AS media_guid, i.guid AS item_guid "
                f"FROM item_media im JOIN item i ON i.guid = im.item_guid "
                f"WHERE im.path IN ({marks}) ORDER BY im.path",
                paths,
            )
        ]
    if len(rows) != len(paths):
        return {"available": False, "databaseRowCount": len(rows)}
    readd_path = Path(os.environ.get("KT_READD_SCRIPT", ""))
    readd_sha = os.environ.get("KT_READD_SCRIPT_SHA256", "")
    readd = load_module(readd_path, readd_sha, "episode_metadata_subtitle_readd")
    helper = readd.load_official_api_helper(OFFICIAL_API_HELPER)
    samples = []
    stream_count = 0
    external_count = 0
    episode_count = 0
    for row in rows:
        result = helper.require_ok(
            helper.request(f"/v/api/v1/stream/list/{row['item_guid']}"),
            "official episode subtitle stream query",
        ) or {}
        streams = [
            item
            for item in result.get("subtitle_streams", [])
            if item.get("media_guid") == row["media_guid"]
        ]
        stream_count += len(streams)
        external = sum(item.get("is_external") in {1, True} for item in streams)
        external_count += external
        if streams:
            episode_count += 1
        if len(samples) < 5:
            samples.append(
                {
                    "externalCount": external,
                    "streamCount": len(streams),
                    "titles": [
                        " ".join(str(item.get("title") or "").split())[:80]
                        for item in streams
                    ],
                }
            )
    return {
        "available": True,
        "episodeCount": episode_count,
        "externalCount": external_count,
        "samples": samples,
        "streamCount": stream_count,
        "videoCount": len(rows),
    }


def official_item_projection(title_projection: dict | None) -> dict:
    samples = (title_projection or {}).get("samples") or []
    if not samples or not OFFICIAL_API_HELPER.is_file():
        return {"available": False}
    episode_guid = str(samples[0].get("episodeGuid") or "")
    readd_path = Path(os.environ.get("KT_READD_SCRIPT", ""))
    readd_sha = os.environ.get("KT_READD_SCRIPT_SHA256", "")
    if not episode_guid or not readd_path.is_absolute() or not DIGEST.fullmatch(readd_sha):
        fail("episode metadata official item probe identity is invalid")
    readd = load_module(readd_path, readd_sha, "episode_metadata_status_readd")
    helper = readd.load_official_api_helper(OFFICIAL_API_HELPER)
    value = helper.require_ok(
        helper.request(f"/v/api/v1/item/{episode_guid}"),
        "official episode item query",
    )
    if not isinstance(value, dict):
        fail("official episode item query returned a non-object")
    fields = {}
    for name in (
        "air_date",
        "alternative_titles",
        "episode_number",
        "nfo_path",
        "original_title",
        "overview",
        "release_date",
        "season_number",
        "sort_title",
        "title",
        "tmdb_id",
    ):
        if name not in value:
            continue
        field_value = value[name]
        if isinstance(field_value, str):
            field_value = " ".join(field_value.split())[:500]
        elif not isinstance(field_value, (bool, int, float, type(None), list, dict)):
            field_value = str(field_value)[:500]
        fields[name] = field_value
    route_probes = {}
    for method, route in (
        ("GET", "/v/api/v1/episode"),
        ("GET", "/v/api/v1/item/media/batch"),
        ("GET", f"/v/api/v1/item/{episode_guid}/detail/tv"),
        ("GET", f"/v/api/v1/item/{episode_guid}/meta/diff"),
        ("GET", f"/v/api/v1/mediadb/itemfile/{episode_guid}"),
        ("GET", "/v/api/v1/saveEditDetail"),
        ("GET", "/v/api/v1/kt-nonexistent-readonly-probe"),
        ("OPTIONS", f"/v/api/v1/item/{episode_guid}"),
        ("OPTIONS", "/v/api/v1/saveEditDetail"),
    ):
        probe_key = f"{method} {route}"
        try:
            response = helper.request(route, method=method)
        except Exception as error:
            route_probes[probe_key] = {"errorType": type(error).__name__}
            continue
        if not isinstance(response, dict):
            route_probes[probe_key] = {"responseType": type(response).__name__}
            continue
        data = response.get("data")
        body = response.get("body")
        route_probes[probe_key] = {
            "code": response.get("code"),
            "body": " ".join(str(body or "").split())[:300],
            "dataKeys": sorted(str(key) for key in data) if isinstance(data, dict) else [],
            "dataType": type(data).__name__,
            "httpStatus": response.get("httpStatus"),
            "message": " ".join(str(response.get("msg") or "").split())[:300],
            "responseKeys": sorted(str(key) for key in response),
        }
    return {
        "available": True,
        "fields": fields,
        "responseKeys": sorted(str(key) for key in value),
        "routeProbes": route_probes,
    }


def item_metadata_schema_projection() -> dict:
    with connect_readonly() as connection:
        columns = [
            str(row[1])
            for row in connection.execute("PRAGMA table_info(item)")
            if isinstance(row[1], str)
        ]
    metadata_columns = sorted(
        column
        for column in columns
        if re.search(
            r"(?:title|name|summary|overview|plot|date|episode|season|tmdb|nfo)",
            column,
            re.IGNORECASE,
        )
    )
    return {
        "columnCount": len(columns),
        "metadataColumns": metadata_columns,
    }


def provider_season_count_projection(request: dict) -> dict:
    marks = ",".join("?" for _ in request["seasons"])
    with connect_readonly() as connection:
        rows = [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT p.season_number, im.path
                  FROM item_media im
                  JOIN item i ON i.guid = im.item_guid
                  JOIN item p ON p.guid = i.parent_guid
                  JOIN item gp ON gp.guid = p.parent_guid
                 WHERE i.type = 'Episode' AND p.type = 'Season'
                   AND gp.type = 'TV' AND gp.tmdb_id = ?
                   AND p.season_number IN ({marks})
                 ORDER BY p.season_number, i.episode_number, im.path
                """,
                (int(request["providerId"]), *request["seasons"]),
            )
        ]
    counts = Counter(
        int(row["season_number"])
        for row in rows
        if Path(str(row.get("path") or "")).suffix.lower() in VIDEO_EXTENSIONS
    )
    if sum(counts.values()) > 2_000:
        fail("episode metadata season count projection exceeded its bound")
    return {
        "counts": {
            f"S{season:02d}": counts.get(season, 0)
            for season in request["seasons"]
        },
        "total": sum(counts.values()),
    }


def backup_subtitle_schema_projection(backup_path: Path, request: dict) -> dict | None:
    if not backup_path.is_file() or backup_path.is_symlink():
        return None
    evidence = read_json(backup_path)
    database_root = Path(str(evidence.get("databaseBackupRoot") or ""))
    database = database_root / "trimmedia.db"
    if (
        evidence.get("schemaVersion") != "media-post-governance-metadata-backup-v2"
        or not database.is_file()
        or database.is_symlink()
    ):
        fail("episode metadata backup subtitle schema source is invalid")
    try:
        database.resolve(strict=True).relative_to(BACKUP_ROOT.resolve(strict=True))
    except (FileNotFoundError, ValueError) as error:
        raise RuntimeError(
            "episode metadata backup database escaped the fixed backup root"
        ) from error
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        names = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        }
        if len(names) > 300:
            fail("episode metadata backup database table bound changed")
        required = {"item", "item_media", "media_stream"}
        if not required.issubset(names):
            return {
                "available": False,
                "missingTables": sorted(required - names),
            }
        marks = ",".join("?" for _ in request["seasons"])
        episode_rows = [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT im.guid AS media_guid, im.path AS video_path,
                       i.guid AS item_guid, i.episode_number,
                       p.season_number
                  FROM item_media im
                  JOIN item i ON i.guid = im.item_guid
                  JOIN item p ON p.guid = i.parent_guid
                  JOIN item gp ON gp.guid = p.parent_guid
                 WHERE i.type = 'Episode' AND p.type = 'Season'
                   AND gp.type = 'TV' AND gp.tmdb_id = ?
                   AND p.season_number IN ({marks})
                 ORDER BY p.season_number, i.episode_number, im.path
                """,
                (int(request["providerId"]), *request["seasons"]),
            )
        ]
        media_guids = [str(row["media_guid"]) for row in episode_rows]
        item_guids = [str(row["item_guid"]) for row in episode_rows]
        scoped_guids = [*media_guids, *item_guids]
        if scoped_guids:
            media_marks = ",".join("?" for _ in scoped_guids)
            stream_rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT guid, media_guid, title, codec_name, codec_type, language,
                           is_external, origin_filename, filepath,
                           source_id, source, trim_id, status
                      FROM media_stream
                     WHERE media_guid IN ({media_marks})
                     ORDER BY media_guid, codec_type, is_external DESC, guid
                    """,
                    scoped_guids,
                )
            ]
        else:
            stream_rows = []
        streams_by_media: dict[str, list[dict]] = {}
        for row in stream_rows:
            if str(row.get("codec_type") or "").lower() != "subtitle":
                continue
            streams_by_media.setdefault(str(row["media_guid"]), []).append(
                {
                    key: row.get(key)
                    for key in (
                        "codec_name",
                        "filepath",
                        "guid",
                        "is_external",
                        "language",
                        "origin_filename",
                        "source",
                        "source_id",
                        "status",
                        "title",
                        "trim_id",
                    )
                }
            )
        episodes = [
            {
                "episode": int(row["episode_number"]),
                "itemGuid": str(row["item_guid"]),
                "mediaGuid": str(row["media_guid"]),
                "season": int(row["season_number"]),
                "streams": [
                    *streams_by_media.get(str(row["media_guid"]), []),
                    *streams_by_media.get(str(row["item_guid"]), []),
                ],
                "videoPath": str(row["video_path"]),
            }
            for row in episode_rows
        ]
        codec_type_counts = dict(
            sorted(
                Counter(
                    str(row.get("codec_type") or "<empty>") for row in stream_rows
                ).items()
            )
        )
        subtitle_stream_count = sum(len(item["streams"]) for item in episodes)
    return {
        "available": True,
        "codecTypeCounts": codec_type_counts,
        "episodeCount": len(episodes),
        "episodes": episodes,
        "expectedEpisodeCount": request["expectedEpisodeCount"],
        "scopeChanged": len(episodes) != request["expectedEpisodeCount"],
        "scopedStreamCount": len(stream_rows),
        "streamCount": subtitle_stream_count,
        "subtitleEpisodeCount": sum(bool(item["streams"]) for item in episodes),
    }


def trim_official_route_projection(
    roots: tuple[Path, ...] = TRIM_APPLICATION_ROOTS,
) -> dict:
    routes = set()
    route_literals = set()
    nfo_tokens = set()
    mutation_routes = set()
    route_contexts = []
    ui_contracts = {}
    scanned_bytes = 0
    scanned_files = 0
    for root in roots:
        if not root.exists() or root.is_symlink():
            continue
        candidates = [root] if root.is_file() else sorted(root.rglob("*"))
        for path in candidates:
            if scanned_files >= TRIM_ROUTE_SCAN_FILES:
                break
            if path.is_symlink() or not path.is_file():
                continue
            if path.name != "trim-media" and path.suffix.lower() not in {
                ".html",
                ".js",
                ".map",
                ".mjs",
            }:
                continue
            remaining = TRIM_ROUTE_SCAN_BYTES - scanned_bytes
            if remaining <= 0:
                break
            scanned_files += 1
            overlap = b""
            try:
                with path.open("rb") as stream:
                    while remaining > 0:
                        block = stream.read(min(1024 * 1024, remaining))
                        if not block:
                            break
                        scanned_bytes += len(block)
                        remaining -= len(block)
                        window = overlap + block
                        lowered_window = window.lower()
                        nfo_tokens.update(
                            token.decode("ascii")
                            for token in TRIM_NFO_TOKENS
                            if token in lowered_window
                        )
                        for match in TRIM_ROUTE_PATTERN.findall(window):
                            lowered = match.lower()
                            segments = lowered.split(b"/")
                            if any(
                                segment.startswith(keyword)
                                for segment in segments
                                for keyword in TRIM_ROUTE_KEYWORDS
                            ):
                                routes.add(match.decode("ascii"))
                                if len(route_contexts) < 4:
                                    position = window.find(match)
                                    start = max(0, position - 500)
                                    end = min(len(window), position + len(match) + 900)
                                    context = window[start:end].decode(
                                        "ascii", errors="replace"
                                    )
                                    context = " ".join(context.split())[:1_600]
                                    if context and context not in route_contexts:
                                        route_contexts.append(context)
                        mutation_routes.update(
                            match.decode("ascii")
                            for match in TRIM_MUTATION_ROUTE_PATTERN.findall(window)
                        )
                        if path.suffix.lower() in {".html", ".js", ".mjs"}:
                            for match in TRIM_ROUTE_LITERAL_PATTERN.findall(window):
                                route_literals.add(match.decode("ascii"))
                        if path.suffix.lower() in {".html", ".js", ".map", ".mjs"}:
                            for label, tokens in TRIM_UI_CONTRACT_TOKENS.items():
                                if label in ui_contracts:
                                    continue
                                positions = [window.find(token) for token in tokens]
                                positions = [position for position in positions if position >= 0]
                                if not positions:
                                    continue
                                position = min(positions)
                                start = max(0, position - 600)
                                end = min(len(window), position + 1_200)
                                snippet = window[start:end].decode("utf-8", errors="replace")
                                ui_contracts[label] = " ".join(snippet.split())[:1_800]
                        overlap = window[-256:]
            except OSError:
                continue
        if scanned_files >= TRIM_ROUTE_SCAN_FILES or scanned_bytes >= TRIM_ROUTE_SCAN_BYTES:
            break
    return {
        "candidateCount": len(routes),
        "literalCount": len(route_literals),
        "literals": sorted(route_literals),
        "nfoTokenPresence": {
            token.decode("ascii"): token.decode("ascii") in nfo_tokens
            for token in TRIM_NFO_TOKENS
        },
        "mutationRoutes": sorted(mutation_routes),
        "routeContexts": route_contexts,
        "routes": sorted(routes),
        "scannedBytes": scanned_bytes,
        "scannedFileCount": scanned_files,
        "uiContractContexts": ui_contracts,
    }


def sealed_audit_acceptance_projection(
    request: dict,
    paths: dict[str, Path],
    canonical_paths: dict | None,
    canonical_titles: dict | None,
) -> dict | None:
    if not paths["audit"].is_file() or not paths["plan"].is_file():
        return None
    try:
        audit = read_json(paths["audit"])
        plan = read_json(paths["plan"])
        _modules, current_digests = load_dependencies()
        if (
            audit.get("schemaVersion") == "media-episode-metadata-audit-v1"
            and audit.get("state") == "episode-metadata-audited"
            and audit.get("request") == audit_request_identity(request)
            and audit.get("planSha256") == sha256_file(paths["plan"])
            and audit.get("dependencySha256") == current_digests
            and audit.get("canonicalRemap") is not None
        ):
            return {
                "accepted": False,
                "reason": "canonical-remap-required",
            }
        if (
            audit.get("schemaVersion") != "media-episode-metadata-audit-v1"
            or audit.get("state") != "episode-metadata-audited"
            or audit.get("request") != audit_request_identity(request)
            or audit.get("planSha256") != sha256_file(paths["plan"])
            or audit.get("dependencySha256") != current_digests
            or not isinstance(audit.get("inspection"), dict)
        ):
            return {
                "accepted": False,
                "reason": "sealed-audit-identity-changed",
            }
        inspection = apply_episode_acceptance_contract(plan, audit["inspection"])
        projection = inspection_projection(inspection)
        units = inspection.get("units") or []
        episode_count = sum(int(unit.get("episodeCount") or 0) for unit in units)
        rejected_seasons = sorted(
            int(unit.get("season") or 0)
            for unit in units
            if not unit.get("accepted")
        )
        current_paths_ready = bool(canonical_paths) and (
            canonical_paths.get("expectedPathCount")
            == request["expectedEpisodeCount"]
            and canonical_paths.get("presentPathCount")
            == request["expectedEpisodeCount"]
            and canonical_paths.get("missingPathCount") == 0
            and canonical_paths.get("duplicatePathCount") == 0
        )
        current_titles_ready = bool(canonical_titles) and (
            canonical_titles.get("databaseRowCount")
            == request["expectedEpisodeCount"]
            and canonical_titles.get("mismatchCount") == 0
        )
        return {
            "accepted": (
                episode_count == request["expectedEpisodeCount"]
                and projection["episodeGapCount"] == 0
                and not rejected_seasons
                and current_paths_ready
                and current_titles_ready
            ),
            "acceptedSeasonCount": len(units) - len(rejected_seasons),
            "auditEvidenceSha256": sha256_file(paths["audit"]),
            "currentPathsReady": current_paths_ready,
            "currentTitlesReady": current_titles_ready,
            "episodeCount": episode_count,
            "episodeGapCount": projection["episodeGapCount"],
            "rejectedSeasons": rejected_seasons,
            "seasonCount": len(units),
            "sourceAccepted": bool(audit.get("accepted")),
        }
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        return {
            "accepted": False,
            "reason": " ".join(str(error).split())[:240],
        }


def status_subtitle_plan(paths: dict[str, Path]) -> Path:
    """在文件事务提交后投影 canonical 字幕，提交前仍投影来源字幕。"""
    subtitle_plan = paths["plan"]
    if not paths["transaction"].is_file() and paths["sourcePlan"].is_file():
        subtitle_plan = paths["sourcePlan"]
    return subtitle_plan


def run_status(request: dict) -> dict:
    paths = evidence_paths(request)
    artifacts = {
        name: artifact_status(path)
        for name, path in paths.items()
        if name != "plan"
    }
    runner_count = metadata_runner_count()
    if artifacts["transaction"].get("exists"):
        phase = "transaction-committed"
    elif runner_count > 0:
        phase = "runner-active"
    elif artifacts["repair"].get("exists"):
        phase = "interrupted-after-metadata-commit"
    elif artifacts["backup"].get("exists"):
        phase = "interrupted-after-backup"
    elif artifacts["subtitleRestore"].get("exists"):
        phase = "subtitles-restored"
    elif artifacts["rollback"].get("exists"):
        phase = "rolled-back"
    elif artifacts["failure"].get("exists"):
        phase = "failed"
    elif artifacts["audit"].get("exists"):
        phase = "audited"
    else:
        phase = "not-started"
    staging = METADATA_STAGING_ROOT / task_id(request)
    canonical_titles = canonical_title_projection(paths["plan"])
    canonical_paths = canonical_plan_projection(paths["plan"])
    subtitle_plan = status_subtitle_plan(paths)
    return {
        "artifacts": artifacts,
        "auditAcceptance": sealed_audit_acceptance_projection(
            request,
            paths,
            canonical_paths,
            canonical_titles,
        ),
        "canonicalPaths": canonical_paths,
        "canonicalTitles": canonical_titles,
        "itemMetadataSchema": item_metadata_schema_projection(),
        "providerSeasonCounts": provider_season_count_projection(request),
        "backupSubtitleSchema": backup_subtitle_schema_projection(
            paths["backup"], request
        ),
        "metadataRunnerCount": runner_count,
        "phase": phase,
        "request": audit_request_identity(request),
        "schemaVersion": "media-episode-metadata-status-v1",
        "stagingExists": staging.exists(),
        "officialItem": official_item_projection(canonical_titles),
        "subtitleLayout": subtitle_layout_projection(subtitle_plan),
        "subtitleStreams": official_subtitle_projection(subtitle_plan),
        "trimOfficialRoutes": trim_official_route_projection(),
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "evidence": 0,
            "localMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
            "videoOrSubtitle": 0,
        },
    }


def run_audit(request: dict) -> dict:
    modules, digests = load_dependencies()
    observed = inventory(request)
    inspection_plan = build_plan(request, observed, seal_video_digests=False)
    if request.get("seriesReconciliation") is not None:
        inspection = inspect_series_reconciliation_provider(
            request,
            modules["tmdb"],
        )
    else:
        records = modules["repair"].plan_records(inspection_plan)
        inspection = modules["repair"].inspect_metadata(
            inspection_plan, records, modules["tmdb"]
        )
    validate_series_reconciliation_inspection(request, inspection)
    paths = evidence_paths(request)
    episode_targets = series_episode_targets(request)
    if not episode_targets:
        episode_targets = ordinal_episode_targets(inspection)
    remap_plan = build_remap_plan(request, observed, episode_targets)
    source_plan = build_plan(
        request,
        observed,
        provider_identity=inspection.get("identity"),
    )
    plan = build_plan(
        request,
        observed,
        episode_targets=episode_targets,
        provider_identity=inspection.get("identity"),
    )
    inspection = apply_episode_acceptance_contract(plan, inspection)
    projection = inspection_projection(inspection)
    accepted = (
        projection["episodeGapCount"] == 0
        and all(unit.get("accepted") for unit in inspection.get("units") or [])
        and remap_plan is None
    )
    remap = None
    if remap_plan is not None:
        source_plan_sha = write_plan(paths["sourcePlan"], source_plan)
        remap_plan_sha = write_plan(paths["remapPlan"], remap_plan)
        remap = {
            "fileKindCounts": dict(
                sorted(
                    Counter(
                        item["fileKind"]
                        for item in remap_plan["manifests"]["local"]["forward"]
                    ).items()
                )
            ),
            "operationCount": len(remap_plan["manifests"]["local"]["forward"]),
            "path": os.fspath(paths["remapPlan"]),
            "sha256": remap_plan_sha,
            "sourcePlanPath": os.fspath(paths["sourcePlan"]),
            "sourcePlanSha256": source_plan_sha,
            "videoCount": sum(
                item["fileKind"] == "video"
                for item in remap_plan["manifests"]["local"]["forward"]
            ),
        }
    plan_sha = write_plan(paths["plan"], plan)
    helper_sha = sha256_file(OFFICIAL_API_HELPER)
    payload = {
        "capturedAt": utc_now(),
        "accepted": accepted,
        "dependencySha256": digests,
        "inspection": inspection,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMetadataWrites": 0,
            "mechanicalScanTriggered": False,
            "uiWrites": 0,
            "videoOrSubtitleWrites": 0,
        },
        "officialApiHelperSha256": helper_sha,
        "planPath": os.fspath(paths["plan"]),
        "planSha256": plan_sha,
        "canonicalRemap": remap,
        "request": audit_request_identity(request),
        "schemaVersion": "media-episode-metadata-audit-v1",
        "scope": observed["scope"],
        "state": "episode-metadata-audited",
    }
    write_json_once(paths["audit"], payload)
    return {
        "accepted": accepted,
        "evidencePath": os.fspath(paths["audit"]),
        "evidenceSha256": sha256_file(paths["audit"]),
        "planSha256": plan_sha,
        "projection": projection,
        "canonicalRemap": remap,
        "scope": observed["scope"],
        "state": payload["state"],
        "writeBoundaries": inspection["writeBoundaries"],
    }


def verified_repair_dependency_amendment(
    audit: dict,
    current_digests: dict[str, str],
    paths: dict[str, Path],
) -> dict | None:
    recorded = audit.get("dependencySha256")
    if recorded == current_digests:
        return None
    changed_dependencies = set()
    if isinstance(recorded, dict):
        changed_dependencies = {
            name
            for name in recorded
            if recorded.get(name) != current_digests.get(name)
        }
    if (
        not isinstance(recorded, dict)
        or set(recorded) != set(current_digests)
        or changed_dependencies not in ({"manifest"}, {"repair"})
        or not all(
            isinstance(value, str) and DIGEST.fullmatch(value)
            for value in (*recorded.values(), *current_digests.values())
        )
        or audit.get("canonicalRemap") is None
    ):
        fail("episode metadata audit dependency identity changed")
    failure = read_json(paths["failure"])
    source_backup = read_json(paths["sourceBackup"])
    remap_delete = read_json(paths["remapDelete"])
    if changed_dependencies == {"manifest"}:
        remap_plan = read_json(paths["remapPlan"])
        if (
            failure.get("schemaVersion") != "media-episode-metadata-failure-v1"
            or failure.get("state") != "failed"
            or failure.get("operation") != "repair"
            or failure.get("reason")
            != "command failed (1): Local source and target allowlists must be distinct."
            or source_backup.get("schemaVersion")
            != "media-post-governance-metadata-backup-v2"
            or source_backup.get("state") != "database-backup-complete"
            or remap_delete.get("schemaVersion")
            != "media-episode-path-remap-delete-v1"
            or remap_delete.get("state") != "source-scope-detached"
            or paths["remapTransaction"].exists()
            or paths["backup"].exists()
            or paths["repair"].exists()
            or not isinstance(remap_plan.get("seriesReconciliation"), dict)
        ):
            fail("episode metadata manifest amendment is not resumable")
        return {
            "failureEvidenceSha256": sha256_file(paths["failure"]),
            "newManifestSha256": current_digests["manifest"],
            "previousManifestSha256": recorded["manifest"],
            "reasonCode": "series-reconciliation-shared-root-allowlist",
            "sourceBackupSha256": sha256_file(paths["sourceBackup"]),
            "sourceDetachSha256": sha256_file(paths["remapDelete"]),
        }
    canonical_backup = read_json(paths["backup"])
    remap_transaction = read_json(paths["remapTransaction"])
    if (
        failure.get("schemaVersion") != "media-episode-metadata-failure-v1"
        or failure.get("state") != "failed"
        or failure.get("operation") != "repair"
        or failure.get("reason")
        != "metadata repair requires one verified provider identity"
        or source_backup.get("schemaVersion")
        != "media-post-governance-metadata-backup-v2"
        or source_backup.get("state") != "database-backup-complete"
        or canonical_backup.get("schemaVersion")
        != "media-post-governance-metadata-backup-v2"
        or canonical_backup.get("state") != "database-backup-complete"
        or remap_delete.get("schemaVersion")
        != "media-episode-path-remap-delete-v1"
        or remap_delete.get("state") != "source-scope-detached"
        or remap_transaction.get("schemaVersion")
        != "media-episode-path-remap-v1"
        or remap_transaction.get("state") != "canonical-paths-remapped"
    ):
        fail("episode metadata repair dependency amendment is not resumable")
    return {
        "failureEvidenceSha256": sha256_file(paths["failure"]),
        "newRepairSha256": current_digests["repair"],
        "previousRepairSha256": recorded["repair"],
        "reasonCode": "provider-title-normalization-after-canonical-remap",
    }


def load_audit(request: dict, digests: dict[str, str]) -> tuple[dict, dict, Path]:
    paths = evidence_paths(request)
    audit = read_json(paths["audit"])
    dependency_amendment = verified_repair_dependency_amendment(
        audit, digests, paths
    )
    if (
        sha256_file(paths["audit"]) != request["auditEvidenceSha256"]
        or audit.get("schemaVersion") != "media-episode-metadata-audit-v1"
        or audit.get("state") != "episode-metadata-audited"
        or audit.get("request") != audit_request_identity(request)
        or (
            audit.get("dependencySha256") != digests
            and dependency_amendment is None
        )
        or audit.get("officialApiHelperSha256") != sha256_file(OFFICIAL_API_HELPER)
        or audit.get("planPath") != os.fspath(paths["plan"])
        or audit.get("planSha256") != sha256_file(paths["plan"])
    ):
        fail("episode metadata audit evidence identity changed")
    audit["_dependencyAmendment"] = dependency_amendment
    remap = audit.get("canonicalRemap")
    remap_kind_counts = remap.get("fileKindCounts") if isinstance(remap, dict) else None
    if remap is not None and (
        not isinstance(remap, dict)
        or remap.get("path") != os.fspath(paths["remapPlan"])
        or remap.get("sourcePlanPath") != os.fspath(paths["sourcePlan"])
        or remap.get("sha256") != sha256_file(paths["remapPlan"])
        or remap.get("sourcePlanSha256") != sha256_file(paths["sourcePlan"])
        or not isinstance(remap.get("operationCount"), int)
        or remap["operationCount"] < 1
        or not isinstance(remap_kind_counts, dict)
        or any(
            not isinstance(value, int) or value < 0
            for value in remap_kind_counts.values()
        )
        or sum(remap_kind_counts.values()) != remap["operationCount"]
        or remap_kind_counts.get("video") != request["expectedEpisodeCount"]
        or remap.get("videoCount") != request["expectedEpisodeCount"]
    ):
        fail("episode metadata canonical remap evidence identity changed")
    plan = read_json(paths["plan"])
    return audit, plan, paths["plan"]


def existing_backup_summary(path: Path) -> dict:
    evidence = read_json(path)
    if (
        evidence.get("schemaVersion")
        != "media-post-governance-metadata-backup-v2"
        or evidence.get("state") != "database-backup-complete"
    ):
        fail("episode metadata existing backup evidence is invalid")
    return {
        "evidenceSha256": sha256_file(path),
        "metadataAssetCount": int(
            evidence.get("metadataAssetHardlinkCount") or 0
        ),
        "output": os.fspath(path),
        "state": evidence["state"],
    }


def cleanup_series_source_roots(
    request: dict,
    source_backup_path: Path,
    remap_plan_path: Path,
) -> dict:
    """在规范重入库完成后按硬链接备份删除旧系列根的精确元数据残留。"""
    reconciliation = request.get("seriesReconciliation")
    if not isinstance(reconciliation, dict):
        return {"metadataAssetCount": 0, "removedRootCount": 0, "state": "not-needed"}
    source_backup = read_json(source_backup_path)
    remap_plan = read_json(remap_plan_path)
    plan_reconciliation = remap_plan.get("seriesReconciliation")
    if not isinstance(plan_reconciliation, dict):
        fail("episode metadata series cleanup evidence is invalid")
    source_roots = [Path(value) for value in plan_reconciliation.get("sourceTitleRoots") or []]
    target_root = Path(str(plan_reconciliation.get("targetTitleRoot") or ""))
    roots_are_safe = (
        len({os.fspath(root) for root in source_roots}) == len(source_roots)
        and all(root.is_absolute() for root in source_roots)
        and target_root.is_absolute()
    )
    if roots_are_safe:
        try:
            for root in (*source_roots, target_root):
                root.resolve(strict=False).relative_to(MEDIA_ROOT.resolve(strict=True))
        except ValueError:
            roots_are_safe = False
    if (
        source_backup.get("schemaVersion")
        != "media-post-governance-metadata-backup-v2"
        or source_backup.get("state") != "database-backup-complete"
        or plan_reconciliation.get("canonicalTitle")
        != reconciliation["canonicalTitle"]
        or plan_reconciliation.get("releaseYear") != reconciliation["releaseYear"]
        or not source_roots
        or target_root in source_roots
        or not roots_are_safe
    ):
        fail("episode metadata series cleanup evidence is invalid")
    source_root_values = {root.resolve(strict=False) for root in source_roots}
    moved_sources = {
        Path(operation["sourcePath"]).resolve(strict=False)
        for operation in remap_plan.get("manifests", {})
        .get("local", {})
        .get("forward", [])
    }
    residuals = []
    for entry in source_backup.get("replaceableMetadataAssets") or []:
        source = Path(str(entry.get("targetPath") or ""))
        rollback = Path(str(entry.get("rollbackPath") or ""))
        source_resolved = source.resolve(strict=False)
        if source_resolved in moved_sources:
            continue
        if not any(
            source_resolved == root or root in source_resolved.parents
            for root in source_root_values
        ):
            fail("episode metadata series cleanup source escaped old roots")
        if (
            not rollback.is_file()
            or rollback.is_symlink()
            or rollback.stat().st_size != entry.get("size")
            or sha256_file(rollback) != entry.get("digest")
        ):
            fail("episode metadata series cleanup rollback evidence changed")
        try:
            rollback.resolve(strict=True).relative_to(ROLLBACK_ROOT.resolve(strict=True))
        except ValueError as error:
            raise RuntimeError(
                "episode metadata series cleanup rollback escaped fixed root"
            ) from error
        if source.exists() or source.is_symlink():
            if (
                not source.is_file()
                or source.is_symlink()
                or source.stat().st_size != entry.get("size")
                or sha256_file(source) != entry.get("digest")
            ):
                fail("episode metadata series cleanup source changed")
            residuals.append(source)
    remaining_files = []
    for source_root in source_roots:
        if source_root.is_symlink():
            fail("episode metadata series cleanup root is unsafe")
        if not source_root.exists():
            continue
        if not source_root.is_dir():
            fail("episode metadata series cleanup root is unsafe")
        for candidate in source_root.rglob("*"):
            if candidate.is_symlink():
                fail("episode metadata series cleanup found an unsafe residual")
            if candidate.is_file():
                remaining_files.append(candidate.resolve(strict=False))
                continue
            if not candidate.is_dir():
                fail("episode metadata series cleanup found an unsafe residual")
    if set(remaining_files) != {path.resolve(strict=False) for path in residuals}:
        fail("episode metadata series cleanup found unsealed residual files")
    for source in residuals:
        source.unlink()
    removed_roots = 0
    for source_root in source_roots:
        if not source_root.exists():
            removed_roots += 1
            continue
        directories = sorted(
            (path for path in source_root.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for directory in directories:
            directory.rmdir()
        source_root.rmdir()
        removed_roots += 1
    return {
        "metadataAssetCount": len(residuals),
        "removedRootCount": removed_roots,
        "state": "series-source-roots-cleaned",
    }


def existing_metadata_repair_summary(path: Path, repair_task_id: str) -> dict:
    evidence = read_json(path)
    assets = evidence.get("assets")
    inspection = evidence.get("inspection")
    if (
        evidence.get("schemaVersion") != "media-admin-metadata-repair-v1"
        or evidence.get("state") != "metadata-assets-committed"
        or evidence.get("taskId") != repair_task_id
        or not isinstance(assets, list)
        or not isinstance(inspection, dict)
        or not isinstance(inspection.get("identity"), dict)
    ):
        fail("episode metadata existing repair evidence is invalid")
    mutation = evidence.get("mutationBoundaries") or {}
    return {
        "evidenceSha256": sha256_file(path),
        "identity": inspection["identity"],
        "metadataAssetCount": len(assets),
        "newMetadataAssetCount": int(mutation.get("formalMetadataWrites") or 0),
        "repairAttempt": int(evidence.get("repairAttempt") or 0),
        "state": evidence["state"],
        "writeBoundaries": inspection.get("writeBoundaries") or {},
    }


def committed_transaction_result(
    request: dict, audit: dict, path: Path
) -> dict | None:
    if not path.exists():
        return None
    transaction = read_json(path)
    readd = transaction.get("readd")
    metadata_repair = transaction.get("metadataRepair")
    series_cleanup = transaction.get("seriesCleanup")
    if (
        transaction.get("schemaVersion") != "media-episode-metadata-repair-v1"
        or transaction.get("state") != "episode-metadata-repair-committed"
        or transaction.get("auditEvidenceSha256")
        != request["auditEvidenceSha256"]
        or transaction.get("request") != audit_request_identity(request)
        or transaction.get("planSha256") != audit.get("planSha256")
        or transaction.get("dependencyAmendment")
        != audit.get("_dependencyAmendment")
        or not isinstance(readd, dict)
        or not isinstance(metadata_repair, dict)
    ):
        fail("episode metadata committed transaction identity changed")
    if request.get("seriesReconciliation") is not None and (
        not isinstance(series_cleanup, dict)
        or series_cleanup.get("state") != "series-source-roots-cleaned"
        or not isinstance(series_cleanup.get("metadataAssetCount"), int)
        or not isinstance(series_cleanup.get("removedRootCount"), int)
    ):
        fail("episode metadata series cleanup receipt is invalid")
    return {
        "evidencePath": os.fspath(path),
        "evidenceSha256": sha256_file(path),
        "metadataAssetCount": int(metadata_repair.get("metadataAssetCount") or 0),
        "officialDeleteCount": int(readd.get("officialDeleteCount") or 0),
        "officialDeleteFileValue": readd.get("officialDeleteFileValue"),
        "readdCount": int(readd.get("operationCount") or 0),
        "resumed": False,
        "seriesCleanup": series_cleanup,
        "state": transaction["state"],
        "writeBoundaries": audit["inspection"]["writeBoundaries"],
    }


def wait_for_present_path_count(
    readd_module,
    paths: list[str],
    minimum_count: int,
    *,
    timeout: float = 180,
) -> dict[str, int]:
    deadline = time.monotonic() + timeout
    counts: dict[str, int] = {}
    while time.monotonic() < deadline:
        counts = {}
        for row in readd_module.canonical_rows(paths):
            counts[row["path"]] = counts.get(row["path"], 0) + 1
        if any(count > 1 for count in counts.values()):
            fail("resumed metadata refresh created duplicate canonical paths")
        if len(counts) >= minimum_count:
            return counts
        time.sleep(0.5)
    fail(
        "resumed metadata refresh path count did not converge: "
        f"expected at least {minimum_count}, observed {len(counts)}"
    )


def execute_resumed_exact_path_readd(
    readd_module,
    plan: dict,
    helper,
    *,
    refresh_identity: dict[str, str],
    refresh_receipt: dict[str, dict],
    refresh_sidecars: list[dict],
) -> dict:
    records = readd_module.target_records(plan)
    readd_module.verify_records(records, refresh_receipt)
    if not readd_module.trim_process_running():
        fail("trim.media must be running before resumed exact-path re-add")
    readd_module.wait_for_running_tasks(helper, timeout=180)
    rows = readd_module.canonical_rows(
        [record["pathText"] for record in records]
    )
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["path"]] = counts.get(row["path"], 0) + 1
    if any(count > 1 for count in counts.values()):
        fail("resumed metadata refresh found duplicate canonical paths")
    missing = [record for record in records if record["pathText"] not in counts]
    sidecar_restored, sidecar_preserved = readd_module.restore_refresh_sidecars(
        plan, refresh_sidecars
    )
    batch = missing[:RESUME_READD_BATCH_SIZE]
    for record in batch:
        helper.require_ok(
            helper.request(
                readd_module.RE_ADD_ROUTE,
                method="POST",
                payload={"mdb_guid": LIBRARY_GUID, "path": record["pathText"]},
            ),
            "official resumed exact-path re-add",
        )
    record_paths = [record["pathText"] for record in records]
    counts = wait_for_present_path_count(
        readd_module,
        record_paths,
        len(counts) + len(batch),
        timeout=180,
    )
    readd_module.wait_for_running_tasks(helper, timeout=180)
    remaining = len(records) - len(counts)
    if remaining > 0:
        return {
            "databaseDirectWrite": False,
            "mechanicalScanTriggered": False,
            "officialDeleteCount": 0,
            "officialDeleteFileValue": 0,
            "operationCount": len(batch),
            "presentPathCount": len(counts),
            "remainingPathCount": remaining,
            "sidecarPreservedCount": sidecar_preserved,
            "sidecarRestoreCount": sidecar_restored,
            "state": "pending",
            "workItemId": plan["workItemId"],
        }
    new_scope = readd_module.wait_for_refresh_scope(
        plan, records, refresh_identity, timeout=180
    )
    readd_module.wait_for_running_tasks(helper, timeout=180)
    new_scope = readd_module.refresh_scope(plan, records, refresh_identity)
    if new_scope is None:
        fail("resumed metadata refresh canonical scope disappeared")
    return {
        "databaseDirectWrite": False,
        "discardedItemUserCount": 0,
        "discardedPlaybackCount": 0,
        "favoriteRestoreCount": 0,
        "mechanicalScanTriggered": False,
        "officialDeleteCount": 0,
        "officialDeleteFileValue": 0,
        "operationCount": len(batch),
        "presentPathCount": len(counts),
        "remainingPathCount": 0,
        "sidecarPreservedCount": sidecar_preserved,
        "sidecarRestoreCount": sidecar_restored,
        "state": "committed",
        "workItemId": plan["workItemId"],
    }


def load_manifest_executor() -> Path:
    path = Path(os.environ.get("KT_MANIFEST_EXECUTOR", ""))
    digest = os.environ.get("KT_MANIFEST_EXECUTOR_SHA256", "")
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or not DIGEST.fullmatch(digest)
        or sha256_file(path) != digest
    ):
        fail("episode metadata manifest executor SHA gate failed")
    return path


def existing_remap_summary(path: Path, request: dict, audit: dict) -> dict:
    value = read_json(path)
    if (
        value.get("schemaVersion") != "media-episode-path-remap-v1"
        or value.get("state") != "canonical-paths-remapped"
        or value.get("request") != audit_request_identity(request)
        or value.get("planSha256")
        != (audit.get("canonicalRemap") or {}).get("sha256")
    ):
        fail("episode metadata remap transaction identity changed")
    return {
        "evidencePath": os.fspath(path),
        "evidenceSha256": sha256_file(path),
        "operationCount": int(value.get("operationCount") or 0),
        "state": value["state"],
    }


def run_canonical_remap_repair(
    request: dict,
    audit: dict,
    plan: dict,
    plan_path: Path,
    paths: dict[str, Path],
    modules: dict,
    digests: dict[str, str],
) -> dict:
    remap = audit["canonicalRemap"]
    resumed_at_start = any(
        path.exists()
        for path in (
            paths["sourceBackup"],
            paths["remapDelete"],
            paths["remapTransaction"],
            paths["backup"],
            paths["repair"],
        )
    )
    source_plan = read_json(paths["sourcePlan"])
    remap_plan = read_json(paths["remapPlan"])
    repair_task_id = task_id(request)
    source_records = modules["readd"].target_records(source_plan)
    canonical_records = modules["readd"].target_records(plan)
    identity = {"provider": "tmdb", "providerId": request["providerId"]}
    helper = modules["readd"].load_official_api_helper(OFFICIAL_API_HELPER)

    if paths["sourceBackup"].exists():
        source_backup = existing_backup_summary(paths["sourceBackup"])
    else:
        source_backup = modules["backup"].run(
            Namespace(
                database_backup_root=os.fspath(
                    BACKUP_ROOT / f"{repair_task_id}-path-source" / request["runId"]
                ),
                execute=True,
                output=os.fspath(paths["sourceBackup"]),
                plan=[os.fspath(paths["sourcePlan"])],
                post_governance_metadata=True,
                rollback_root=os.fspath(
                    ROLLBACK_ROOT / f"{repair_task_id}-path-source" / request["runId"]
                ),
            )
        )

    # 飞牛 delete_file=0 仍可能删除外挂字幕，必须先把密封载荷移出旧路径。
    if paths["remapTransaction"].exists():
        remap_summary = existing_remap_summary(
            paths["remapTransaction"], request, audit
        )
    else:
        executor = load_manifest_executor()
        specs = modules["transaction"].load_plan_specs(
            [os.fspath(paths["remapPlan"])],
            [remap["sha256"]],
            root=EVIDENCE_ROOT,
        )
        transaction = modules["transaction"].execute_batch(
            specs, modules["transaction"].ProductionRuntime(executor)
        )
        if transaction.get("state") != "committed":
            fail("episode metadata ordinal path transaction did not commit")
        payload = {
            "completedAt": utc_now(),
            "operationCount": remap["operationCount"],
            "planSha256": remap["sha256"],
            "request": audit_request_identity(request),
            "schemaVersion": "media-episode-path-remap-v1",
            "state": "canonical-paths-remapped",
            "transaction": transaction,
        }
        write_json_once(paths["remapTransaction"], payload)
        remap_summary = existing_remap_summary(
            paths["remapTransaction"], request, audit
        )

    if paths["remapDelete"].exists():
        delete_receipt = read_json(paths["remapDelete"])
        if (
            delete_receipt.get("schemaVersion")
            != "media-episode-path-remap-delete-v1"
            or delete_receipt.get("state") != "source-scope-detached"
            or delete_receipt.get("request") != audit_request_identity(request)
            or delete_receipt.get("sourceBackupSha256")
            != source_backup["evidenceSha256"]
        ):
            fail("episode metadata remap delete receipt identity changed")
    else:
        modules["readd"].wait_for_running_tasks(helper, timeout=180)
        source_scope = modules["readd"].refresh_scope(
            source_plan, source_records, identity
        )
        if source_scope is None:
            fail("episode metadata remap source scope disappeared")
        helper.require_ok(
            helper.request(
                f"/v/api/v1/item/{source_scope['rootGuid']}",
                method="DELETE",
                payload={
                    "delete_file": 0,
                    "guid": source_scope["rootGuid"],
                    "media_guids": source_scope["mediaGuids"],
                },
            ),
            "official ordinal source detach",
        )
        modules["readd"].wait_for_paths_absent(
            [record["pathText"] for record in source_records]
        )
        delete_receipt = {
            "completedAt": utc_now(),
            "favoriteOwners": source_scope["favoriteOwners"],
            "itemUserCount": source_scope["itemUserCount"],
            "officialDeleteFileValue": 0,
            "playCount": source_scope["playCount"],
            "request": audit_request_identity(request),
            "schemaVersion": "media-episode-path-remap-delete-v1",
            "sourceBackupSha256": source_backup["evidenceSha256"],
            "state": "source-scope-detached",
        }
        write_json_once(paths["remapDelete"], delete_receipt)

    if modules["readd"].canonical_rows(
        [record["pathText"] for record in source_records]
    ):
        fail("episode metadata remap left active source paths")

    rollback_root = ROLLBACK_ROOT / repair_task_id / request["runId"]
    if paths["backup"].exists():
        backup = existing_backup_summary(paths["backup"])
    else:
        backup = modules["backup"].run(
            Namespace(
                database_backup_root=os.fspath(
                    BACKUP_ROOT / repair_task_id / request["runId"]
                ),
                execute=True,
                output=os.fspath(paths["backup"]),
                plan=[os.fspath(plan_path)],
                post_governance_metadata=True,
                rollback_root=os.fspath(rollback_root),
            )
        )
    if paths["repair"].exists():
        repair_summary = existing_metadata_repair_summary(
            paths["repair"], repair_task_id
        )
    else:
        repair_summary = modules["repair"].run(
            Namespace(
                metadata_backup_evidence=os.fspath(paths["backup"]),
                metadata_backup_evidence_sha256=backup["evidenceSha256"],
                mode="repair",
                output=os.fspath(paths["repair"]),
                plan=os.fspath(plan_path),
                repair_attempt=1,
                run_id=request["runId"],
                task_id=repair_task_id,
                tmdb_script=os.environ["KT_TMDB_SCRIPT"],
                tmdb_script_sha256=digests["tmdb"],
            )
        )
    present = {
        row["path"]
        for row in modules["readd"].canonical_rows(
            [record["pathText"] for record in canonical_records]
        )
    }
    missing = [
        record for record in canonical_records if record["pathText"] not in present
    ]
    if missing:
        modules["readd"].wait_for_running_tasks(helper, timeout=180)
        for record in missing:
            helper.require_ok(
                helper.request(
                    modules["readd"].RE_ADD_ROUTE,
                    method="POST",
                    payload={"mdb_guid": LIBRARY_GUID, "path": record["pathText"]},
                ),
                "official ordinal exact-path re-add",
            )
        wait_for_present_path_count(
            modules["readd"],
            [record["pathText"] for record in canonical_records],
            len(canonical_records),
            timeout=180,
        )
    modules["readd"].wait_for_running_tasks(helper, timeout=180)
    canonical_scope = modules["readd"].refresh_scope(
        plan, canonical_records, identity
    )
    if canonical_scope is None:
        fail("episode metadata remap canonical scope did not converge")
    favorite_restored = modules["readd"].restore_refresh_favorites(
        delete_receipt.get("favoriteOwners") or [],
        canonical_scope["rootGuid"],
        OFFICIAL_API_HELPER,
    )
    series_cleanup = cleanup_series_source_roots(
        request,
        paths["sourceBackup"],
        paths["remapPlan"],
    )
    readd = {
        "favoriteRestoreCount": favorite_restored,
        "officialDeleteCount": 1,
        "officialDeleteFileValue": 0,
        "operationCount": len(missing),
        "pathRemapCount": remap_summary["operationCount"],
        "state": "committed",
        "workItemId": plan["workItemId"],
    }
    payload = {
        "auditEvidenceSha256": request["auditEvidenceSha256"],
        "backup": backup,
        "completedAt": utc_now(),
        "dependencyAmendment": audit.get("_dependencyAmendment"),
        "metadataRepair": repair_summary,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "mechanicalScanTriggered": False,
            "officialDeleteFileValue": 0,
            "uiWrites": 0,
            "videoOrSubtitleContentWrites": 0,
        },
        "pathRemap": remap_summary,
        "planSha256": audit["planSha256"],
        "readd": readd,
        "request": audit_request_identity(request),
        "resumed": resumed_at_start,
        "schemaVersion": "media-episode-metadata-repair-v1",
        "seriesCleanup": series_cleanup,
        "state": "episode-metadata-repair-committed",
    }
    write_json_once(paths["transaction"], payload)
    return committed_transaction_result(request, audit, paths["transaction"])


def run_repair(request: dict) -> dict:
    modules, digests = load_dependencies()
    audit, plan, plan_path = load_audit(request, digests)
    paths = evidence_paths(request)
    committed = committed_transaction_result(request, audit, paths["transaction"])
    if committed is not None:
        return committed
    if audit.get("canonicalRemap") is not None:
        return run_canonical_remap_repair(
            request, audit, plan, plan_path, paths, modules, digests
        )
    resumed = paths["backup"].exists() or paths["repair"].exists()
    if resumed:
        projection = canonical_plan_projection(plan_path)
        if (
            projection is None
            or projection["expectedPathCount"] != request["expectedEpisodeCount"]
            or projection["duplicatePathCount"] != 0
        ):
            fail("episode metadata resumed canonical scope is invalid")
    else:
        current = inventory(request)
        if current["scope"] != audit.get("scope"):
            fail("episode metadata repair scope changed after audit")
    repair_task_id = task_id(request)
    rollback_root = ROLLBACK_ROOT / repair_task_id / request["runId"]
    if paths["backup"].exists():
        backup = existing_backup_summary(paths["backup"])
    else:
        backup = modules["backup"].run(
            Namespace(
                database_backup_root=os.fspath(
                    BACKUP_ROOT / repair_task_id / request["runId"]
                ),
                execute=True,
                output=os.fspath(paths["backup"]),
                plan=[os.fspath(plan_path)],
                post_governance_metadata=True,
                rollback_root=os.fspath(rollback_root),
            )
        )
    if paths["repair"].exists():
        repair_summary = existing_metadata_repair_summary(
            paths["repair"], repair_task_id
        )
    else:
        repair_summary = modules["repair"].run(
            Namespace(
                metadata_backup_evidence=os.fspath(paths["backup"]),
                metadata_backup_evidence_sha256=backup["evidenceSha256"],
                mode="repair",
                output=os.fspath(paths["repair"]),
                plan=os.fspath(plan_path),
                repair_attempt=1,
                run_id=request["runId"],
                task_id=repair_task_id,
                tmdb_script=os.environ["KT_TMDB_SCRIPT"],
                tmdb_script_sha256=digests["tmdb"],
            )
        )
    records = modules["readd"].target_records(plan)
    receipt, sidecars = modules["readd"].load_refresh_receipt(
        plan_path,
        plan,
        records,
        paths["backup"],
        backup["evidenceSha256"],
    )
    refresh_identity = modules["readd"].load_refresh_identity(
        plan,
        records,
        paths["repair"],
        repair_summary["evidenceSha256"],
        repair_task_id,
    )
    preflight = modules["readd"].preflight(plan, receipt, sidecars)
    helper = modules["readd"].load_official_api_helper(OFFICIAL_API_HELPER)

    def emit_progress(completed: int, total: int) -> None:
        print(
            json.dumps(
                {"completed": completed, "phase": "exact-path-readd", "total": total},
                sort_keys=True,
            ),
            file=sys.stderr,
        )

    if resumed:
        readd = execute_resumed_exact_path_readd(
            modules["readd"],
            plan,
            helper,
            refresh_identity=refresh_identity,
            refresh_receipt=receipt,
            refresh_sidecars=sidecars,
        )
    else:
        readd = modules["readd"].execute_exact_path_readd(
            plan,
            LIBRARY_GUID,
            helper,
            official_helper_path=OFFICIAL_API_HELPER,
            progress=emit_progress,
            refresh_existing=True,
            refresh_identity=refresh_identity,
            refresh_receipt=receipt,
            refresh_sidecars=sidecars,
        )
    if readd["state"] == "pending":
        return {
            "evidencePath": os.fspath(paths["repair"]),
            "evidenceSha256": repair_summary["evidenceSha256"],
            "metadataAssetCount": repair_summary["metadataAssetCount"],
            "presentPathCount": readd["presentPathCount"],
            "readdCount": readd["operationCount"],
            "remainingPathCount": readd["remainingPathCount"],
            "resumed": True,
            "state": "episode-metadata-repair-resume-pending",
            "writeBoundaries": audit["inspection"]["writeBoundaries"],
        }
    payload = {
        "auditEvidenceSha256": request["auditEvidenceSha256"],
        "backup": backup,
        "completedAt": utc_now(),
        "metadataRepair": repair_summary,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "mechanicalScanTriggered": False,
            "officialDeleteFileValue": readd["officialDeleteFileValue"],
            "uiWrites": 0,
            "videoOrSubtitleWrites": 0,
        },
        "planSha256": audit["planSha256"],
        "preflight": preflight,
        "readd": readd,
        "request": audit_request_identity(request),
        "resumed": resumed,
        "schemaVersion": "media-episode-metadata-repair-v1",
        "state": "episode-metadata-repair-committed",
    }
    write_json_once(paths["transaction"], payload)
    return {
        "evidencePath": os.fspath(paths["transaction"]),
        "evidenceSha256": sha256_file(paths["transaction"]),
        "metadataAssetCount": repair_summary["metadataAssetCount"],
        "officialDeleteCount": readd["officialDeleteCount"],
        "officialDeleteFileValue": readd["officialDeleteFileValue"],
        "readdCount": readd["operationCount"],
        "resumed": resumed,
        "state": payload["state"],
        "writeBoundaries": audit["inspection"]["writeBoundaries"],
    }


def episode_path_identity(path: Path) -> tuple[int, int]:
    """从已密封媒体文件名提取唯一季号与集号。"""
    match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", path.stem)
    if match is None:
        fail("episode subtitle restore path identity is invalid")
    return int(match.group(1)), int(match.group(2))


def subtitle_path_locale(path: Path) -> str:
    """把已密封外挂字幕文件名末尾规范为简体或繁体语言标识。"""
    match = re.search(r"\.(zh-CN|zh-TW)\.ass$", path.name, re.IGNORECASE)
    if match is None:
        fail("episode subtitle restore locale is invalid")
    normalized = match.group(1).lower()
    if normalized == "zh-cn":
        return "zh-CN"
    return "zh-TW"


def resolved_scoped_path(path_text: object, roots: list[Path]) -> Path:
    """把密封绝对路径约束到既有非符号链接作品根，拒绝穿越与别名。"""
    if not isinstance(path_text, str):
        fail("episode subtitle restore path is invalid")
    path = Path(path_text)
    if not path.is_absolute() or path.name in {"", ".", ".."}:
        fail("episode subtitle restore path is invalid")
    parent = path.parent.resolve(strict=True)
    resolved = parent / path.name
    if path != resolved:
        fail("episode subtitle restore path is not canonical")
    scoped = False
    for root in roots:
        try:
            resolved.relative_to(root)
        except ValueError:
            continue
        scoped = True
        break
    if not scoped:
        fail("episode subtitle restore path escaped sealed title roots")
    return resolved


def sealed_subtitle_restore_scope(request: dict, remap_plan: dict) -> list[dict]:
    """从系列纠正清单派生每集视频、语言与缺失外挂路径的完整密封集合。"""
    reconciliation = remap_plan.get("seriesReconciliation")
    root_values = None
    if isinstance(reconciliation, dict):
        root_values = reconciliation.get("sourceTitleRoots")
    if (
        not isinstance(root_values, list)
        or not root_values
        or len(root_values) > 100
        or any(not isinstance(value, str) for value in root_values)
    ):
        fail("episode subtitle restore title roots are invalid")
    roots = [Path(value).resolve(strict=True) for value in root_values]
    if any(not root.is_dir() or root.is_symlink() for root in roots):
        fail("episode subtitle restore title root is unsafe")
    operations = (
        remap_plan.get("manifests", {}).get("local", {}).get("forward")
    )
    if not isinstance(operations, list):
        fail("episode subtitle restore manifest is invalid")
    videos: dict[tuple[int, int], Path] = {}
    subtitles = []
    for operation in operations:
        if not isinstance(operation, dict) or operation.get("operation") != "move":
            fail("episode subtitle restore manifest operation is invalid")
        file_kind = operation.get("fileKind")
        if file_kind not in {"asset", "subtitle", "video"}:
            fail("episode subtitle restore manifest file kind is invalid")
        if file_kind == "asset":
            continue
        source = resolved_scoped_path(operation.get("sourcePath"), roots)
        identity = episode_path_identity(source)
        if file_kind == "video":
            if identity in videos or source.suffix.lower() not in VIDEO_EXTENSIONS:
                fail("episode subtitle restore video identity is duplicated")
            videos[identity] = source
            continue
        if source.suffix.lower() != ".ass":
            fail("episode subtitle restore accepts only ASS sidecars")
        subtitles.append(
            {
                "identity": identity,
                "locale": subtitle_path_locale(source),
                "path": source,
            }
        )
    expected_count = request["expectedEpisodeCount"]
    if len(videos) != expected_count or len(subtitles) != expected_count * 2:
        fail("episode subtitle restore coverage is incomplete")
    locale_identities = {
        (item["identity"], item["locale"])
        for item in subtitles
    }
    if len(locale_identities) != len(subtitles):
        fail("episode subtitle restore locale identity is duplicated")
    expected_locale_identities = {
        (identity, locale)
        for identity in videos
        for locale in ("zh-CN", "zh-TW")
    }
    if locale_identities != expected_locale_identities:
        fail("episode subtitle restore locale coverage is incomplete")
    scope = []
    for item in sorted(
        subtitles,
        key=lambda value: (
            value["identity"][0],
            value["identity"][1],
            value["locale"],
        ),
    ):
        video = videos[item["identity"]]
        if item["path"].parent != video.parent:
            fail("episode subtitle restore video and sidecar roots differ")
        scope.append({**item, "video": video})
    return scope


def probe_embedded_ass_streams(video: Path) -> dict[str, dict]:
    """只读探测同一视频内唯一简繁 ASS 流并返回安全流索引。"""
    result = subprocess.run(
        [
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-select_streams",
            "s",
            "-show_entries",
            "stream=index,codec_name:stream_tags=language,title",
            "-of",
            "json",
            os.fspath(video),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        fail("episode subtitle restore ffprobe failed")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("episode subtitle restore ffprobe output is invalid") from error
    streams = {}
    title_locales = {
        "简体中文": "zh-CN",
        "繁体中文": "zh-TW",
        "繁體中文": "zh-TW",
    }
    for stream in payload.get("streams") or []:
        if not isinstance(stream, dict) or stream.get("codec_name") != "ass":
            continue
        title = " ".join(str((stream.get("tags") or {}).get("title") or "").split())
        locale = title_locales.get(title)
        index = stream.get("index")
        if locale is None:
            continue
        if not isinstance(index, int) or index < 0 or locale in streams:
            fail("episode subtitle restore embedded stream identity is invalid")
        streams[locale] = {"index": index, "title": title}
    if set(streams) != {"zh-CN", "zh-TW"}:
        fail("episode subtitle restore embedded ASS coverage is incomplete")
    return streams


def extract_embedded_ass(video: Path, stream_index: int, output: Path) -> None:
    """用固定 ffmpeg 参数把一个已验证内嵌 ASS 流复制到同目录临时文件。"""
    result = subprocess.run(
        [
            "/usr/bin/ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            os.fspath(video),
            "-map",
            f"0:{stream_index}",
            "-c:s",
            "copy",
            "-f",
            "ass",
            os.fspath(output),
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        fail("episode subtitle restore ffmpeg extraction failed")


def validate_extracted_ass(path: Path) -> dict:
    """校验新提取字幕为有界 ASS 文本并计算完整 SHA-256。"""
    if path.is_symlink() or not path.is_file():
        fail("episode subtitle restore extracted file is unavailable")
    size = path.stat().st_size
    if size < 64 or size > 20 * 1024 * 1024:
        fail("episode subtitle restore extracted file size is invalid")
    preview = path.read_bytes()[: 256 * 1024]
    if b"[Script Info]" not in preview or b"Dialogue:" not in preview:
        fail("episode subtitle restore extracted ASS structure is invalid")
    return {"sha256": sha256_file(path), "size": size}


def existing_subtitle_restore_summary(
    request: dict,
    receipt_path: Path,
    remap_plan_sha256: str,
    scope: list[dict],
) -> dict:
    """验证既有字幕恢复回执和全部文件摘要，提供可幂等复用的成功结果。"""
    value = read_json(receipt_path)
    files = value.get("files")
    expected_paths = {os.fspath(item["path"]) for item in scope}
    actual_paths = {
        str(item.get("path") or "")
        for item in files or []
        if isinstance(item, dict)
    }
    if (
        value.get("schemaVersion") != "media-episode-subtitle-restore-v1"
        or value.get("state") != "episode-subtitle-sidecars-restored"
        or value.get("request") != audit_request_identity(request)
        or value.get("auditEvidenceSha256") != request["auditEvidenceSha256"]
        or value.get("remapPlanSha256") != remap_plan_sha256
        or not isinstance(files, list)
        or actual_paths != expected_paths
        or len(files) != len(scope)
    ):
        fail("episode subtitle restore receipt identity changed")
    for item in files:
        path = Path(item["path"])
        if (
            path.is_symlink()
            or not path.is_file()
            or path.stat().st_size != item.get("size")
            or sha256_file(path) != item.get("sha256")
        ):
            fail("episode subtitle restored sidecar changed")
    return {
        "evidencePath": os.fspath(receipt_path),
        "evidenceSha256": sha256_file(receipt_path),
        "fileCount": len(files),
        "resumed": True,
        "state": value["state"],
        "writeBoundaries": value["writeBoundaries"],
    }


def restore_subtitle_sidecars(
    request: dict,
    remap_plan: dict,
    remap_plan_sha256: str,
    receipt_path: Path,
) -> dict:
    """从每集既有视频的简繁内嵌 ASS 流原子补回密封清单中缺失的外挂副本。"""
    scope = sealed_subtitle_restore_scope(request, remap_plan)
    if receipt_path.exists():
        return existing_subtitle_restore_summary(
            request,
            receipt_path,
            remap_plan_sha256,
            scope,
        )
    videos = {item["video"] for item in scope}
    if any(video.is_symlink() or not video.is_file() for video in videos):
        fail("episode subtitle restore source video is unavailable")
    if any(item["path"].exists() or item["path"].is_symlink() for item in scope):
        fail("episode subtitle restore refuses a partial or existing sidecar set")
    stream_cache = {
        video: probe_embedded_ass_streams(video)
        for video in sorted(videos, key=os.fspath)
    }
    staged = []
    created = []
    try:
        for item in scope:
            destination = item["path"]
            temporary = destination.with_name(
                f".{destination.name}.kt-restore-{request['runId']}.part"
            )
            if temporary.exists() or temporary.is_symlink():
                fail("episode subtitle restore temporary path already exists")
            stream = stream_cache[item["video"]][item["locale"]]
            extract_embedded_ass(item["video"], stream["index"], temporary)
            integrity = validate_extracted_ass(temporary)
            staged.append(
                {
                    **item,
                    **integrity,
                    "streamIndex": stream["index"],
                    "streamTitle": stream["title"],
                    "temporary": temporary,
                }
            )
        for item in staged:
            os.link(item["temporary"], item["path"])
            item["temporary"].unlink()
            created.append(item["path"])
        files = [
            {
                "locale": item["locale"],
                "path": os.fspath(item["path"]),
                "sha256": item["sha256"],
                "size": item["size"],
                "streamIndex": item["streamIndex"],
                "streamTitle": item["streamTitle"],
                "videoPath": os.fspath(item["video"]),
            }
            for item in staged
        ]
        payload = {
            "auditEvidenceSha256": request["auditEvidenceSha256"],
            "completedAt": utc_now(),
            "episodeCount": request["expectedEpisodeCount"],
            "files": files,
            "remapPlanSha256": remap_plan_sha256,
            "request": audit_request_identity(request),
            "schemaVersion": "media-episode-subtitle-restore-v1",
            "state": "episode-subtitle-sidecars-restored",
            "writeBoundaries": {
                "cloud": 0,
                "databaseDirect": 0,
                "formalMediaCreated": len(files),
                "mechanicalScan": 0,
                "source": "same-video-embedded-ass",
                "ui": 0,
                "videoModified": 0,
            },
        }
        write_json_once(receipt_path, payload)
    except Exception:
        for item in staged:
            item["temporary"].unlink(missing_ok=True)
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return {
        "evidencePath": os.fspath(receipt_path),
        "evidenceSha256": sha256_file(receipt_path),
        "fileCount": len(staged),
        "resumed": False,
        "state": "episode-subtitle-sidecars-restored",
        "writeBoundaries": payload["writeBoundaries"],
    }


def run_subtitle_restore(request: dict) -> dict:
    """只在来源路径已官方回滚且文件事务未开始时执行密封字幕副本恢复。"""
    _modules, digests = load_dependencies()
    audit, _plan, _plan_path = load_audit(request, digests)
    paths = evidence_paths(request)
    if (
        audit.get("canonicalRemap") is None
        or paths["remapTransaction"].exists()
        or paths["backup"].exists()
        or paths["repair"].exists()
        or paths["transaction"].exists()
    ):
        fail("episode subtitle restore boundary is closed")
    rollback = read_json(paths["rollback"])
    if (
        rollback.get("schemaVersion") != "media-episode-metadata-rollback-v1"
        or rollback.get("state") != "source-scope-restored"
        or rollback.get("request") != audit_request_identity(request)
        or rollback.get("auditEvidenceSha256") != request["auditEvidenceSha256"]
    ):
        fail("episode subtitle restore requires the sealed source rollback")
    remap_plan = read_json(paths["remapPlan"])
    remap_sha256 = sha256_file(paths["remapPlan"])
    if remap_sha256 != audit["canonicalRemap"].get("sha256"):
        fail("episode subtitle restore remap identity changed")
    return restore_subtitle_sidecars(
        request,
        remap_plan,
        remap_sha256,
        paths["subtitleRestore"],
    )


def run_rollback(request: dict) -> dict:
    """在文件事务尚未开始时用原密封路径官方重挂已摘除的来源层级。"""
    modules, digests = load_dependencies()
    audit, _plan, _plan_path = load_audit(request, digests)
    paths = evidence_paths(request)
    if (
        audit.get("canonicalRemap") is None
        or paths["remapTransaction"].exists()
        or paths["backup"].exists()
        or paths["repair"].exists()
        or paths["transaction"].exists()
    ):
        fail("episode metadata rollback boundary is closed")
    source_plan = read_json(paths["sourcePlan"])
    records = modules["readd"].target_records(source_plan)
    modules["readd"].verify_records(records, None)
    rollback_receipt = paths["rollback"]
    if rollback_receipt.exists():
        value = read_json(rollback_receipt)
        if (
            value.get("schemaVersion") != "media-episode-metadata-rollback-v1"
            or value.get("state") != "source-scope-restored"
            or value.get("request") != audit_request_identity(request)
            or value.get("auditEvidenceSha256") != request["auditEvidenceSha256"]
            or value.get("sourcePlanSha256") != sha256_file(paths["sourcePlan"])
        ):
            fail("episode metadata rollback receipt identity changed")
        return {
            "evidencePath": os.fspath(rollback_receipt),
            "evidenceSha256": sha256_file(rollback_receipt),
            "operationCount": int(value.get("operationCount") or 0),
            "state": value["state"],
            "writeBoundaries": value["writeBoundaries"],
        }
    delete_receipt = read_json(paths["remapDelete"])
    if (
        delete_receipt.get("schemaVersion")
        != "media-episode-path-remap-delete-v1"
        or delete_receipt.get("state") != "source-scope-detached"
        or delete_receipt.get("request") != audit_request_identity(request)
    ):
        fail("episode metadata rollback source detach receipt changed")
    helper = modules["readd"].load_official_api_helper(OFFICIAL_API_HELPER)
    modules["readd"].wait_for_running_tasks(helper, timeout=180)
    source_paths = [record["pathText"] for record in records]
    if modules["readd"].canonical_rows(source_paths):
        fail("episode metadata rollback source paths already partially exist")
    for record in records:
        helper.require_ok(
            helper.request(
                modules["readd"].RE_ADD_ROUTE,
                method="POST",
                payload={"mdb_guid": LIBRARY_GUID, "path": record["pathText"]},
            ),
            "official series source rollback re-add",
        )
    wait_for_present_path_count(
        modules["readd"], source_paths, len(records), timeout=180
    )
    modules["readd"].wait_for_running_tasks(helper, timeout=180)
    identity = {"provider": "tmdb", "providerId": request["providerId"]}
    source_scope = modules["readd"].refresh_scope(source_plan, records, identity)
    if source_scope is None:
        fail("episode metadata rollback source scope did not converge")
    favorite_restored = modules["readd"].restore_refresh_favorites(
        delete_receipt.get("favoriteOwners") or [],
        source_scope["rootGuid"],
        OFFICIAL_API_HELPER,
    )
    payload = {
        "auditEvidenceSha256": request["auditEvidenceSha256"],
        "completedAt": utc_now(),
        "favoriteRestoreCount": favorite_restored,
        "operationCount": len(records),
        "request": audit_request_identity(request),
        "schemaVersion": "media-episode-metadata-rollback-v1",
        "sourcePlanSha256": sha256_file(paths["sourcePlan"]),
        "state": "source-scope-restored",
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "formalMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }
    write_json_once(rollback_receipt, payload)
    return {
        "evidencePath": os.fspath(rollback_receipt),
        "evidenceSha256": sha256_file(rollback_receipt),
        "operationCount": len(records),
        "state": payload["state"],
        "writeBoundaries": payload["writeBoundaries"],
    }


def verify_canonical_remap(
    audit: dict, paths: dict[str, Path], canonical_plan: dict
) -> dict | None:
    if audit.get("canonicalRemap") is None:
        return None
    remap_plan = read_json(paths["remapPlan"])
    evidence = {
        item["evidenceId"]: item
        for item in remap_plan.get("sourceEvidence") or []
        if isinstance(item, dict) and isinstance(item.get("evidenceId"), str)
    }
    counts = Counter()
    for operation in remap_plan["manifests"]["local"]["forward"]:
        source = Path(operation["sourcePath"])
        target = Path(operation["targetPath"])
        sealed = evidence.get(operation["evidenceId"])
        if (
            source.exists()
            or source.is_symlink()
            or target.is_symlink()
            or not target.is_file()
            or not isinstance(sealed, dict)
        ):
            fail("episode metadata canonical remap filesystem state changed")
        immutable_asset = (
            operation["fileKind"] == "asset"
            and "/extras/Fonts/" in os.fspath(target)
        )
        if operation["fileKind"] in {"subtitle", "video"} or immutable_asset:
            if target.stat().st_size != sealed.get("size"):
                fail("episode metadata canonical remap payload size changed")
            actual_digest = (
                bounded_sha256(target)
                if sealed.get("evidenceMethod")
                == "bounded-sha256-first-last-4mib-v1"
                else sha256_file(target)
            )
            if actual_digest != sealed.get("digest"):
                fail("episode metadata canonical remap payload digest changed")
        counts[operation["fileKind"]] += 1
    canonical_videos = [
        Path(operation["targetPath"])
        for operation in canonical_plan["manifests"]["local"]["forward"]
        if operation.get("fileKind") == "video"
    ]
    identities = set()
    season_roots = set()
    for video in canonical_videos:
        match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", video.stem)
        if match is None:
            fail("episode metadata remap canonical video identity is invalid")
        identities.add((int(match.group(1)), int(match.group(2))))
        season_roots.add(video.parent)
    subtitle_count = 0
    for season_root in season_roots:
        for subtitle in season_root.iterdir():
            if subtitle.suffix.lower() not in SUBTITLE_EXTENSIONS:
                continue
            match = re.search(r"- S(\d{2})E(\d{2,3})(?=\D|$)", subtitle.stem)
            if match is None or (
                int(match.group(1)), int(match.group(2))
            ) not in identities:
                fail("episode metadata remap left an unassociated subtitle")
            subtitle_count += 1
    return {
        "fileKindCounts": dict(sorted(counts.items())),
        "subtitleCount": subtitle_count,
        "videoCount": len(canonical_videos),
    }


def apply_episode_acceptance_contract(
    plan: dict,
    inspection: dict,
) -> dict:
    if plan.get("metadataOnlyRefresh") is not True:
        return inspection
    adjusted = json.loads(json.dumps(inspection, ensure_ascii=False))
    parent_projection_fields = {"artwork.poster", "metadata.local-nfo"}
    for unit in adjusted.get("units") or []:
        missing_b = set(unit.get("missingB") or [])
        if (
            int(unit.get("episodeGapCount") or 0) == 0
            and not unit.get("missingA")
            and not unit.get("missingC")
            and missing_b
            and missing_b.issubset(parent_projection_fields)
        ):
            unit["acceptanceAdvisories"] = {
                "fnosParentProjection": sorted(missing_b)
            }
            unit["accepted"] = True
            unit["missingB"] = []
    return adjusted


def run_verify(request: dict) -> dict:
    modules, digests = load_dependencies()
    audit, plan, _plan_path = load_audit(request, digests)
    paths = evidence_paths(request)
    transaction = read_json(paths["transaction"])
    if (
        sha256_file(paths["transaction"]) != request["repairEvidenceSha256"]
        or transaction.get("schemaVersion") != "media-episode-metadata-repair-v1"
        or transaction.get("state") != "episode-metadata-repair-committed"
        or transaction.get("auditEvidenceSha256") != request["auditEvidenceSha256"]
        or transaction.get("request") != audit_request_identity(request)
        or transaction.get("dependencyAmendment")
        != audit.get("_dependencyAmendment")
    ):
        fail("episode metadata repair evidence identity changed")
    current = inventory(reconciled_inventory_request(request))
    series_cleanup_verification = None
    if request.get("seriesReconciliation") is not None:
        cleanup = transaction.get("seriesCleanup")
        canonical_root = canonical_series_title_root(request)
        source_roots = [
            Path(value)
            for value in (plan.get("seriesReconciliation") or {}).get(
                "sourceTitleRoots", []
            )
        ]
        if (
            not isinstance(cleanup, dict)
            or cleanup.get("state") != "series-source-roots-cleaned"
            or canonical_root is None
            or current.get("titleRoots") != [os.fspath(canonical_root)]
            or any(root.exists() or root.is_symlink() for root in source_roots)
        ):
            fail("episode metadata series cleanup verification failed")
        series_cleanup_verification = {
            "canonicalTitleRoot": os.fspath(canonical_root),
            "removedRootCount": cleanup.get("removedRootCount"),
            "state": "verified",
        }
    remap_verification = verify_canonical_remap(audit, paths, plan)
    records = modules["repair"].plan_records(plan)
    inspection = modules["repair"].inspect_metadata(plan, records, modules["tmdb"])
    inspection = apply_episode_acceptance_contract(plan, inspection)
    projection = inspection_projection(inspection)
    if (
        current["scope"] != audit.get("scope")
        or projection["episodeGapCount"] != 0
        or any(not unit.get("accepted") for unit in inspection.get("units") or [])
    ):
        fail(
            "episode metadata independent verification still has gaps: "
            + json.dumps(
                {
                    "actualScope": current["scope"],
                    "expectedScope": audit.get("scope"),
                    "projection": projection,
                    "unitGates": [
                        {
                            "missingA": unit.get("missingA") or [],
                            "missingB": unit.get("missingB") or [],
                            "missingC": unit.get("missingC") or [],
                            "season": unit.get("season"),
                        }
                        for unit in inspection.get("units") or []
                    ],
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        )
    payload = {
        "acceptedAt": utc_now(),
        "auditEvidenceSha256": request["auditEvidenceSha256"],
        "dependencyAmendment": audit.get("_dependencyAmendment"),
        "inspection": inspection,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMetadataWrites": 0,
            "mechanicalScanTriggered": False,
            "uiWrites": 0,
            "videoOrSubtitleWrites": 0,
        },
        "projection": projection,
        "canonicalRemap": remap_verification,
        "repairEvidenceSha256": request["repairEvidenceSha256"],
        "request": audit_request_identity(request),
        "schemaVersion": "media-episode-metadata-verify-v1",
        "seriesCleanup": series_cleanup_verification,
        "state": "episode-metadata-accepted",
    }
    write_json_once(paths["verify"], payload)
    return {
        "evidencePath": os.fspath(paths["verify"]),
        "evidenceSha256": sha256_file(paths["verify"]),
        "projection": projection,
        "canonicalRemap": remap_verification,
        "state": payload["state"],
        "writeBoundaries": inspection["writeBoundaries"],
    }


def run(request: dict) -> dict:
    if request["operation"] == "status":
        return run_status(request)
    if request["operation"] == "audit":
        return run_audit(request)
    if request["operation"] == "repair":
        return run_repair(request)
    if request["operation"] == "restore":
        return run_subtitle_restore(request)
    if request["operation"] == "rollback":
        return run_rollback(request)
    return run_verify(request)


def main() -> None:
    verify_script_digest()
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        fail("episode metadata request exceeds one MiB")
    request = parse_request(json.loads(raw.decode("utf-8")))
    try:
        result = run(request)
    except Exception as error:
        paths = evidence_paths(request)
        if request["operation"] != "status" and not paths["failure"].exists():
            write_json_once(
                paths["failure"],
                {
                    "failedAt": utc_now(),
                    "operation": request["operation"],
                    "reason": " ".join(str(error).split())[:500],
                    "request": audit_request_identity(request),
                    "schemaVersion": "media-episode-metadata-failure-v1",
                    "state": "failed",
                },
            )
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
