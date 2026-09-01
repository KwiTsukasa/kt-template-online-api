#!/usr/bin/env python3
"""为一季一集一文件且具备完整中文字幕证据的 TV 条目生成本地密封计划。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


MEDIA_ROOT = pathlib.Path("/vol2/1000/Media/movie")
TV_ROOT = MEDIA_ROOT / "TV"
STAGING_PARENT = pathlib.Path("/vol2/1000/.kt-media-governance-staging")
EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
USER_AGENT = "Mozilla/5.0 (compatible; KT media metadata governance/1.0)"
CHINESE_LANGUAGE_CODES = {"chi", "chs", "cht", "zh", "zho", "zh-cn", "zh-tw"}
SUPPORTED_SIDECAR_SUFFIXES = {".ass", ".ssa", ".srt"}
SRT_TIME_PATTERN = re.compile(
    r"^(?P<sh>\d{2}):(?P<sm>\d{2}):(?P<ss>\d{2})[,.](?P<sms>\d{3})\s*-->\s*"
    r"(?P<eh>\d{2}):(?P<em>\d{2}):(?P<es>\d{2})[,.](?P<ems>\d{3})(?:\s+.*)?$"
)
FORBIDDEN_COMPONENTS = str.maketrans(
    {
        "<": "＜",
        ">": "＞",
        ":": "：",
        '"': "＂",
        "/": "／",
        "\\": "＼",
        "|": "｜",
        "?": "？",
        "*": "＊",
    }
)


def fail(message: str) -> None:
    raise RuntimeError(message)


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def is_descendant(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return path != root


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stable_sha256(value) -> str:
    serialized = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def sanitize_component(value: str) -> str:
    cleaned = "".join(" " if ord(character) < 32 else character for character in value)
    cleaned = re.sub(r"\s+", " ", cleaned.translate(FORBIDDEN_COMPONENTS)).strip(" .")
    if not cleaned or cleaned in {".", ".."}:
        fail("canonical path component is empty")
    while len(cleaned.encode("utf-8")) > 180:
        cleaned = cleaned[:-1].rstrip(" .")
    if not cleaned:
        fail("canonical path component exceeds the safe byte limit")
    return cleaned


def validate_evidence_file(path: pathlib.Path, label: str) -> None:
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or path.suffix != ".json"
        or not is_descendant(path.resolve(strict=True), EVIDENCE_ROOT)
    ):
        fail(f"{label} must be an existing regular JSON file below the evidence root")


def validate_new_evidence_path(path: pathlib.Path, label: str) -> None:
    if (
        not path.is_absolute()
        or path.suffix != ".json"
        or path.exists()
        or path.is_symlink()
        or not is_descendant(path.resolve(strict=False), EVIDENCE_ROOT)
    ):
        fail(f"{label} must be a new JSON path below the evidence root")


def validate_staging_root(path: pathlib.Path) -> None:
    if (
        not path.is_absolute()
        or path.exists()
        or path.is_symlink()
        or not is_descendant(path.resolve(strict=False), STAGING_PARENT)
    ):
        fail("staging root must be a new path below the governance staging parent")


def validate_staging_source(path: pathlib.Path, *, directory: bool, label: str) -> None:
    expected_type = path.is_dir() if directory else path.is_file()
    if (
        not path.is_absolute()
        or not expected_type
        or path.is_symlink()
        or not is_descendant(path.resolve(strict=True), STAGING_PARENT)
    ):
        kind = "directory" if directory else "file"
        fail(f"{label} must be an existing regular {kind} below the staging parent")


def provider_id_from_row(row: dict) -> int | None:
    value = row.get("grandparent_tmdb_id") or row.get("parent_tmdb_id") or row.get("tmdb_id")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def select_provider_episode_row(rows: list[dict], provider_id: int) -> dict | None:
    matching = [
        row
        for row in rows
        if row.get("type") == "Episode" and provider_id_from_row(row) == provider_id
    ]
    if not matching:
        identifiable = [
            row
            for row in rows
            if row.get("type") in {"Episode", "Movie"}
            and provider_id_from_row(row) is not None
        ]
        if rows and len(identifiable) == len(rows):
            return None
        fail("video has no complete provider identity")
    if len(matching) != len(rows):
        fail("video has conflicting provider rows")
    identities = {
        (
            row.get("parent_season")
            if row.get("parent_season") is not None
            else row.get("season_number"),
            row.get("episode_number"),
        )
        for row in matching
    }
    if len(identities) != 1:
        fail("conflicting provider episode rows")
    return matching[0]


def map_videos(inventory: dict, *, provider_id: int, season_number: int) -> list[dict]:
    rows_by_path: dict[str, list[dict]] = {}
    for row in inventory.get("database", {}).get("rows", []):
        rows_by_path.setdefault(str(row.get("path") or ""), []).append(row)
    mapped = []
    for video in inventory.get("files", {}).get("videos", []):
        rows = rows_by_path.get(str(video.get("path") or ""), [])
        row = select_provider_episode_row(rows, provider_id)
        if row is None:
            continue
        season = row.get("parent_season")
        if season is None:
            season = row.get("season_number")
        episode = row.get("episode_number")
        if row.get("type") != "Episode" or provider_id_from_row(row) != provider_id:
            fail(f"database episode identity is outside the sealed season: {video.get('path')}")
        if season != season_number:
            continue
        if not isinstance(episode, int) or episode < 1:
            fail(f"database episode identity is outside the sealed season: {video.get('path')}")
        mapped.append({"episode": episode, "row": row, "video": video})
    mapped.sort(key=lambda entry: entry["episode"])
    if not mapped:
        fail("inventory contains no video for the sealed season")
    if len({entry["episode"] for entry in mapped}) != len(mapped):
        fail("database episode mapping contains duplicates")
    return mapped


def normalized_subtitle_stream(stream: dict) -> dict:
    return {
        "codec": stream.get("codec"),
        "default": int(stream.get("default") or 0),
        "forced": int(stream.get("forced") or 0),
        "language": stream.get("language"),
        "title": stream.get("title"),
    }


def is_chinese_subtitle(stream: dict) -> bool:
    language = str(stream.get("language") or "").lower()
    title = str(stream.get("title") or "").lower()
    return language in CHINESE_LANGUAGE_CODES or any(
        marker in title for marker in ("中", "简", "繁", "chi", "chs", "cht")
    )


def embedded_subtitle_signature(
    videos: list[dict], *, allow_explicit_chinese_selection: bool = False
) -> list[dict]:
    signatures = []
    for video in videos:
        subtitle_streams = [
            normalized_subtitle_stream(stream)
            for stream in video.get("streams", [])
            if stream.get("type") == "subtitle"
        ]
        if not subtitle_streams:
            fail("embedded subtitle stream is missing")
        chinese_streams = [
            stream for stream in subtitle_streams if is_chinese_subtitle(stream)
        ]
        if not chinese_streams:
            fail("a Chinese embedded subtitle stream is required")
        if not allow_explicit_chinese_selection and not any(
            stream["default"] == 1 for stream in chinese_streams
        ):
            fail("a default Chinese embedded subtitle stream is required")
        signatures.append(subtitle_streams)
    if not signatures or any(signature != signatures[0] for signature in signatures[1:]):
        fail("embedded subtitle signature differs inside the season")
    return signatures[0]


def embedded_subtitle_evidence(
    *,
    episodes: list[int],
    inventory_path: str,
    inventory_sha256: str,
    observed_at: str,
    release_group: str,
    season: int,
    source_id: str,
    stream_count: int,
) -> dict:
    return {
        "episodes": episodes,
        "evidenceId": f"{source_id}-evidence",
        "evidenceMethod": "embedded-stream-manifest-sha256-v1",
        "fileCount": len(episodes),
        "languages": ["zh-CN"],
        "manifestPath": inventory_path,
        "manifestSha256": inventory_sha256,
        "observedAt": observed_at,
        "preferredLanguage": "zh-CN",
        "releaseGroup": release_group,
        "season": season,
        "sourceId": source_id,
        "streamCount": stream_count,
    }


def validate_burned_in_review(
    review: dict,
    *,
    inventory_path: pathlib.Path,
    inventory_sha256: str,
    mapped: list[dict],
    provider_id: int,
    release_group: str,
    season: int,
    work_item: str,
) -> dict:
    if (
        review.get("schemaVersion") != "burned-in-frame-manifest-sha256-v1"
        or review.get("workItemId") != work_item
        or review.get("inventoryPath") != os.fspath(inventory_path)
        or review.get("inventorySha256") != inventory_sha256
        or review.get("providerRef") != f"tmdb:{provider_id}"
    ):
        fail("burned-in review identity changed")
    season_source_groups = review.get("seasonSourceGroups")
    if season_source_groups is None:
        selected_source_group = review.get("sourceGroup")
    elif isinstance(season_source_groups, dict):
        selected_source_group = season_source_groups.get(str(season))
    else:
        fail("burned-in review season source groups are invalid")
    if selected_source_group != release_group:
        fail("burned-in review identity changed")
    rows = review.get("episodes") or []
    summary = review.get("summary") or {}
    if (
        summary.get("allEpisodesSealed") is not True
        or summary.get("missingSimplifiedChineseEpisodes") != []
        or summary.get("episodeCount") != len(rows)
        or summary.get("sealedEpisodeCount") != len(rows)
    ):
        fail("burned-in review is not sealed for every local episode")
    mutation = review.get("mutationBoundaries") or {}
    expected_mutation = {
        "cloudWrites": 0,
        "databaseDirectWrite": False,
        "mediaFileWrites": 0,
        "mechanicalScanTriggered": False,
        "serviceMutation": False,
        "uiWrites": 0,
    }
    if any(mutation.get(key) != value for key, value in expected_mutation.items()):
        fail("burned-in review crossed a read-only boundary")
    command = review.get("commandContract") or {}
    if (
        command.get("frameBytesPersisted") != 0
        or command.get("publicSshResourcePayloadBytes") != 0
    ):
        fail("burned-in review persisted frame or public SSH payload bytes")
    observed_at = str(review.get("capturedAt") or "")
    try:
        parsed_at = datetime.datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        fail("burned-in review capturedAt is invalid")
    if parsed_at.tzinfo is None:
        fail("burned-in review capturedAt has no timezone")

    rows_by_episode = {}
    for row in rows:
        key = (row.get("season"), row.get("episode"))
        if key in rows_by_episode:
            fail("burned-in review contains duplicate episode identities")
        rows_by_episode[key] = row
    seasons = {key[0] for key in rows_by_episode}
    if not seasons or any(not isinstance(value, int) or value < 0 for value in seasons):
        fail("burned-in review contains an invalid season identity")
    if season_source_groups is not None and set(season_source_groups) != {
        str(value) for value in seasons
    }:
        fail("burned-in review season source groups changed")
    season_source_markers = review.get("seasonSourceMarkers")
    if season_source_markers is not None and (
        not isinstance(season_source_markers, dict)
        or set(season_source_markers) != {str(value) for value in seasons}
        or any(not str(value).strip() for value in season_source_markers.values())
    ):
        fail("burned-in review season source markers changed")
    routes_by_season = {}
    for route in review.get("seasonRoutes") or []:
        route_season = route.get("season")
        if route_season in routes_by_season:
            fail("burned-in review contains duplicate season routes")
        routes_by_season[route_season] = route
    expected_routes = {}
    for route_season in seasons:
        episode_count = sum(key[0] == route_season for key in rows_by_episode)
        expected_routes[route_season] = {
            "episodeCount": episode_count,
            "gapEpisodes": [],
            "route": "burned-in-sealed",
            "sealedEpisodeCount": episode_count,
            "season": route_season,
        }
    if routes_by_season != expected_routes:
        fail("burned-in review season route is not sealed")
    if sum(key[0] == season for key in rows_by_episode) != len(mapped):
        fail("burned-in review target season episode count changed")
    frame_observation_count = 0
    episodes = []
    for entry in mapped:
        episode = entry["episode"]
        video = entry["video"]
        row = rows_by_episode.get((season, episode))
        if row is None or row.get("sealedBurnedIn") is not True:
            fail(f"burned-in review episode S{season:02d}E{episode:02d} is not sealed")
        if (
            row.get("path") != video.get("path")
            or row.get("boundedSha256") != video.get("boundedSha256")
            or row.get("bytes") != video.get("size")
            or row.get("mtimeMs") != video.get("mtimeMs")
        ):
            fail(f"burned-in review source changed for S{season:02d}E{episode:02d}")
        matches = row.get("matchedSimplifiedChinese") or []
        seconds = {
            match.get("second")
            for match in matches
            if isinstance(match, dict)
            and isinstance(match.get("second"), (int, float))
            and str(match.get("text") or "").strip()
        }
        if len(matches) < 2 or len(seconds) < 2:
            fail(
                f"burned-in review episode S{season:02d}E{episode:02d} lacks two distinct observations"
            )
        frame_observation_count += len(matches)
        episodes.append(episode)
    return {
        "episodes": sorted(episodes),
        "frameObservationCount": frame_observation_count,
        "observedAt": observed_at,
    }


def validate_subtitle_gap_evidence(
    evidence: dict,
    *,
    mapped: list[dict],
    season: int,
    work_item: str,
) -> dict:
    if (
        evidence.get("schemaVersion") != "media-subtitle-source-resolution-v1"
        or evidence.get("workItemId") != work_item
        or evidence.get("seasonNumber") != season
        or evidence.get("requiredEpisodeCount") != len(mapped)
        or evidence.get("videoDownloadCeiling") != 0
        or evidence.get("status") != "source-blocked"
    ):
        fail("subtitle gap evidence identity changed")
    if evidence.get("selectedSource") is not None:
        fail("subtitle gap evidence unexpectedly has a selected source")
    decision = evidence.get("decision")
    candidates = evidence.get("candidates")
    fallback_search = evidence.get("fallbackSearch")
    if (
        not isinstance(decision, str)
        or not decision.strip()
        or not isinstance(candidates, list)
        or not isinstance(fallback_search, dict)
        or (not candidates and not fallback_search)
    ):
        fail("subtitle gap source-resolution evidence is incomplete")
    for candidate in candidates:
        if (
            not isinstance(candidate, dict)
            or not re.fullmatch(
                r"[a-f0-9]{64}",
                str(candidate.get("availabilityEvidenceSha256") or ""),
            )
            or not str(candidate.get("outcome") or "").strip()
        ):
            fail("subtitle gap candidate evidence is incomplete")
    mutation = evidence.get("mutationBoundaries") or {}
    expected_mutation = {
        "cloudWrites": 0,
        "databaseDirectWrite": False,
        "mediaVideoDownloads": 0,
        "uiWrites": 0,
    }
    if any(mutation.get(key) != value for key, value in expected_mutation.items()):
        fail("subtitle gap evidence crossed a read-only boundary")
    observed_at = str(evidence.get("capturedAt") or "")
    try:
        parsed_at = datetime.datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
    except ValueError:
        fail("subtitle gap evidence capturedAt is invalid")
    if parsed_at.tzinfo is None:
        fail("subtitle gap evidence capturedAt has no timezone")
    return {
        "episodeCount": len(mapped),
        "observedAt": observed_at,
        "reason": decision,
    }


def burned_in_subtitle_evidence(
    *,
    episodes: list[int],
    frame_observation_count: int,
    observed_at: str,
    release_group: str,
    review_path: str,
    review_sha256: str,
    season: int,
    source_id: str,
) -> dict:
    return {
        "episodes": episodes,
        "evidenceId": f"{source_id}-evidence",
        "evidenceMethod": "burned-in-frame-manifest-sha256-v1",
        "fileCount": len(episodes),
        "frameObservationCount": frame_observation_count,
        "languages": ["zh-CN"],
        "manifestPath": review_path,
        "manifestSha256": review_sha256,
        "observedAt": observed_at,
        "preferredLanguage": "zh-CN",
        "releaseGroup": release_group,
        "reviewedEpisodeCount": len(episodes),
        "season": season,
        "sourceId": source_id,
    }


def decode_subtitle(path: pathlib.Path) -> str:
    raw = path.read_bytes()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            fail(f"subtitle UTF-16 payload is invalid: {path}")
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    fail(f"subtitle encoding is unsupported: {path}")


def subtitle_episode_hint(path: pathlib.Path) -> int:
    name = path.name
    match = re.search(r"S\d{1,2}E(\d{1,3})", name, flags=re.IGNORECASE)
    if not match:
        match = re.search(
            r"\[(\d{1,3})\]\[(?:CHS|CHT|GB|BIG5|SC|TC)\]",
            name,
            flags=re.IGNORECASE,
        )
    if not match and "dbd-raws" in os.fspath(path).lower():
        match = re.search(r"\[(\d{1,3})\]", name)
    if not match:
        fail(f"subtitle filename has no unambiguous episode number: {path}")
    return int(match.group(1))


def subtitle_release_group(path: pathlib.Path) -> str:
    if "dbd-raws" in os.fspath(path).lower():
        return "DBD-Raws"
    text = re.sub(r"\{[^}]*\}", "", decode_subtitle(path)).lower()
    if "白月字幕组" in text:
        return "白月字幕组&VCB-Studio"
    if any(marker in text for marker in ("桜都", "樱都", "sakurato")):
        return "Sakurato"
    if any(marker in text for marker in ("beansub", "fzsd", "豌豆", "风之圣殿")):
        return "BeanSub&FZSD"
    return "unknown"


def ass_seconds(value: str) -> float:
    match = re.fullmatch(r"(\d+):(\d{2}):(\d{2}(?:\.\d+)?)", value.strip())
    if not match:
        fail(f"invalid ASS timestamp: {value}")
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))


def ass_timing_summary(path: pathlib.Path) -> dict:
    cues = []
    non_positive = 0
    for line in decode_subtitle(path).splitlines():
        if not line.startswith("Dialogue:"):
            continue
        fields = line.split(",", 3)
        if len(fields) < 4:
            fail(f"invalid ASS dialogue line: {path}")
        start, end = ass_seconds(fields[1]), ass_seconds(fields[2])
        if start < 0 or end < 0:
            fail(f"invalid ASS cue timing: {path}")
        if end <= start:
            non_positive += 1
        cues.append((start, end))
    if not cues:
        fail(f"subtitle contains no dialogue cues: {path}")
    return {
        "cueCount": len(cues),
        "firstCueSeconds": min(min(start, end) for start, end in cues),
        "lastCueSeconds": max(max(start, end) for start, end in cues),
        "nonPositiveCueCount": non_positive,
    }


def srt_seconds(match: re.Match[str], prefix: str) -> float:
    return (
        int(match.group(f"{prefix}h")) * 3600
        + int(match.group(f"{prefix}m")) * 60
        + int(match.group(f"{prefix}s"))
        + int(match.group(f"{prefix}ms")) / 1000
    )


def srt_timing_summary(path: pathlib.Path) -> dict:
    cues = []
    non_positive = 0
    for line in decode_subtitle(path).splitlines():
        if "-->" not in line:
            continue
        match = SRT_TIME_PATTERN.fullmatch(line.strip())
        if match is None:
            fail(f"invalid SRT timing line: {path}")
        start, end = srt_seconds(match, "s"), srt_seconds(match, "e")
        if start < 0 or end < 0:
            fail(f"invalid SRT cue timing: {path}")
        if end <= start:
            non_positive += 1
        cues.append((start, end))
    if not cues:
        fail(f"subtitle contains no dialogue cues: {path}")
    return {
        "cueCount": len(cues),
        "firstCueSeconds": min(min(start, end) for start, end in cues),
        "lastCueSeconds": max(max(start, end) for start, end in cues),
        "nonPositiveCueCount": non_positive,
    }


def subtitle_timing_summary(path: pathlib.Path) -> dict:
    suffix = path.suffix.lower()
    if suffix in {".ass", ".ssa"}:
        return ass_timing_summary(path)
    if suffix == ".srt":
        return srt_timing_summary(path)
    fail(f"subtitle format is unsupported: {path}")


def canonical_subtitle_target(
    video_target: pathlib.Path, subtitle_source: pathlib.Path
) -> pathlib.Path:
    suffix = subtitle_source.suffix.lower()
    if suffix not in SUPPORTED_SIDECAR_SUFFIXES:
        fail(f"subtitle format is unsupported: {subtitle_source}")
    return video_target.with_suffix(f".zh-CN{suffix}")


def validate_sealed_sidecar_source(
    evidence: dict,
    *,
    inventory_sha256: str,
    mapped: list[dict],
    release_group: str,
    root: pathlib.Path,
    season: int,
    source_url: str,
    work_item: str,
) -> dict[pathlib.Path, dict]:
    schema_version = evidence.get("schemaVersion")
    local_torrent_source = schema_version == "media-local-subtitle-package-v1"
    quark_source = schema_version == "media-quark-subtitle-package-v1"
    expected_episodes = {entry["episode"] for entry in mapped}
    videos_by_episode = {entry["episode"]: entry["video"] for entry in mapped}
    try:
        evidence_root = pathlib.Path(evidence["localStagingRoot"])
    except (KeyError, TypeError, ValueError) as error:
        fail(f"sealed subtitle source evidence identity changed: {error}")
    if (
        not (local_torrent_source or quark_source)
        or evidence.get("status") != "accepted"
        or evidence.get("workItemId") != work_item
        or evidence.get("season") != season
        or evidence.get("sourceReleaseGroup") != release_group
        or (
            evidence.get("sourceReference") if local_torrent_source else evidence.get("shareUrl")
        )
        != source_url
        or evidence_root.resolve(strict=True) != root.resolve(strict=True)
        or evidence.get("subtitleCount") != len(expected_episodes)
        or evidence.get("episodeCoverage") != sorted(expected_episodes)
        or (
            local_torrent_source
            and evidence.get("inventorySha256") != inventory_sha256
        )
        or (
            quark_source
            and evidence.get("secretRedaction")
            != {
                "downloadUrlsPersisted": False,
                "fidTokensPersisted": False,
                "shareTokenPersisted": False,
            }
        )
    ):
        fail("sealed subtitle source evidence identity changed")
    expected_boundaries = {
        "cloudWrites": 0,
        "databaseDirectWrite": False,
        "mechanicalScanTriggered": False,
        "mediaVideoDownloads": 0,
        "serviceMutation": local_torrent_source,
        "subtitlePayloadDownloads": len(expected_episodes),
        "uiWrites": 0,
    }
    if evidence.get("mutationBoundaries") != expected_boundaries:
        fail("sealed subtitle source evidence crossed a write boundary")
    files = evidence.get("files")
    video_identity = evidence.get("videoIdentity") if quark_source else []
    if (
        not isinstance(files, list)
        or len(files) != len(expected_episodes)
        or (
            quark_source
            and (
                not isinstance(video_identity, list)
                or len(video_identity) != len(expected_episodes)
            )
        )
    ):
        fail("sealed subtitle source evidence coverage changed")
    sealed: dict[pathlib.Path, dict] = {}
    observed_episodes = set()
    for item in files:
        if not isinstance(item, dict):
            fail("sealed subtitle source file evidence changed")
        episode = item.get("episode")
        try:
            path = pathlib.Path(item["targetPath"])
            size = int(item["size"])
        except (KeyError, TypeError, ValueError) as error:
            fail(f"sealed subtitle source file evidence changed: {error}")
        try:
            last_cue = float(item["lastCueSeconds"])
        except (KeyError, TypeError, ValueError) as error:
            fail(f"sealed subtitle source file evidence changed: {error}")
        duration = videos_by_episode.get(episode, {}).get("durationSeconds")
        resolved = path.resolve(strict=True)
        if (
            episode not in expected_episodes
            or episode in observed_episodes
            or not path.is_absolute()
            or not path.is_file()
            or path.is_symlink()
            or not is_descendant(resolved, root.resolve(strict=True))
            or path.suffix.lower() not in SUPPORTED_SIDECAR_SUFFIXES
            or size != path.stat().st_size
            or item.get("sha256") != sha256_file(path)
            or not isinstance(duration, (int, float))
            or last_cue > float(duration) + 2
            or not isinstance(item.get("cueCount"), int)
            or item["cueCount"] <= 0
            or item.get("nonPositiveCueCount") != 0
            or (quark_source and item.get("serverCrc64Matches") is not True)
            or not isinstance(item.get("simplifiedMarkerCount"), int)
            or not isinstance(item.get("traditionalMarkerCount"), int)
            or item["simplifiedMarkerCount"] <= item["traditionalMarkerCount"]
        ):
            fail("sealed subtitle source file evidence changed")
        observed_episodes.add(episode)
        sealed[resolved] = {
            "episode": episode,
            "releaseGroup": release_group,
            "sha256": item["sha256"],
        }
    identities = {}
    for item in video_identity:
        if not isinstance(item, dict):
            fail("sealed subtitle source video identity changed")
        episode = item.get("episode")
        if (
            episode not in expected_episodes
            or episode in identities
            or item.get("exactNameAndSizeMatch") is not True
            or not isinstance(item.get("durationDeltaSeconds"), (int, float))
            or float(item["durationDeltaSeconds"]) > 0.1
        ):
            fail("sealed subtitle source video identity changed")
        identities[episode] = item
    if observed_episodes != expected_episodes or (
        quark_source and set(identities) != expected_episodes
    ):
        fail("sealed subtitle source evidence coverage changed")
    return sealed


def collect_sidecar_package(
    root: pathlib.Path,
    mapped: list[dict],
    *,
    release_group: str,
    sealed_source_files: dict[pathlib.Path, dict] | None = None,
) -> list[dict]:
    expected_episodes = {entry["episode"] for entry in mapped}
    videos_by_episode = {entry["episode"]: entry["video"] for entry in mapped}
    collected = {}
    observed_paths = set()
    subtitle_paths = sorted(
        path
        for path in root.rglob("*")
        if path.suffix.lower() in SUPPORTED_SIDECAR_SUFFIXES
    )
    for path in subtitle_paths:
        if not path.is_file() or path.is_symlink():
            fail(f"subtitle package contains a non-regular file: {path}")
        resolved = path.resolve(strict=True)
        binding = sealed_source_files.get(resolved) if sealed_source_files else None
        episode = (
            binding["episode"]
            if binding is not None
            else subtitle_episode_hint(path)
        )
        if episode not in expected_episodes or episode in collected:
            fail(f"subtitle package episode coverage is invalid: {path}")
        if path.suffix.lower() == ".srt" and binding is None:
            fail("SRT subtitle package requires sealed source evidence")
        observed_group = (
            binding["releaseGroup"] if binding is not None else subtitle_release_group(path)
        )
        if observed_group != release_group:
            fail(
                f"subtitle package release group mismatch for episode {episode}: {observed_group}"
            )
        if binding is not None and binding.get("episode") != episode:
            fail(f"sealed subtitle source episode mismatch: {path}")
        timing = subtitle_timing_summary(path)
        video_duration = videos_by_episode[episode].get("durationSeconds")
        if (
            not isinstance(video_duration, (int, float))
            or timing["lastCueSeconds"] > float(video_duration) + 2
        ):
            fail(f"subtitle timing exceeds local video duration for episode {episode}")
        collected[episode] = {
            "episode": episode,
            "path": path,
            "releaseGroup": observed_group,
            "subtitleFormat": path.suffix.lower().removeprefix("."),
            "timing": timing,
            "videoDurationSeconds": float(video_duration),
        }
        observed_paths.add(resolved)
    if set(collected) != expected_episodes:
        fail("subtitle package does not cover every local episode exactly once")
    if sealed_source_files is not None and observed_paths != set(sealed_source_files):
        fail("sealed subtitle source file set changed")
    return [collected[episode] for episode in sorted(collected)]


def sidecar_subtitle_evidence(
    *,
    episodes: list[int],
    manifest_path: str,
    manifest_sha256: str,
    observed_at: str,
    release_group: str,
    season: int,
    source_id: str,
) -> dict:
    return {
        "episodes": episodes,
        "evidenceId": f"{source_id}-evidence",
        "evidenceMethod": "subtitle-package-manifest-sha256-v1",
        "fileCount": len(episodes),
        "manifestPath": manifest_path,
        "manifestSha256": manifest_sha256,
        "observedAt": observed_at,
        "releaseGroup": release_group,
        "season": season,
        "sourceId": source_id,
    }


def fetch_artwork(url: str) -> tuple[bytes, str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "image.tmdb.org":
        fail("artwork URL must use the fixed TMDB image host")
    context = ssl.create_default_context()
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=45, context=context) as response:
                data = response.read(25 * 1024 * 1024 + 1)
                if response.status != 200 or len(data) < 1024 or len(data) > 25 * 1024 * 1024:
                    fail("TMDB artwork response size or status is invalid")
                if data.startswith(b"\xff\xd8\xff"):
                    return data, ".jpg"
                if data.startswith(b"\x89PNG\r\n\x1a\n"):
                    return data, ".png"
                if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
                    return data, ".webp"
                fail("TMDB artwork format is unsupported")
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    fail(f"TMDB artwork request failed after three attempts: {last_error}")


def chown_mode(path: pathlib.Path, uid: int, gid: int, mode: int) -> None:
    os.chown(path, uid, gid)
    path.chmod(mode)


def ensure_directory(path: pathlib.Path, uid: int, gid: int) -> None:
    path.mkdir(mode=0o755, parents=True, exist_ok=True)
    current = path
    while is_descendant(current.resolve(strict=False), STAGING_PARENT) and current != STAGING_PARENT:
        chown_mode(current, uid, gid, 0o755)
        current = current.parent


def write_bytes(path: pathlib.Path, data: bytes, uid: int, gid: int) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_bytes(data)
        chown_mode(temporary, uid, gid, 0o644)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_xml(path: pathlib.Path, root: ET.Element, uid: int, gid: int) -> None:
    ET.indent(root, space="  ")
    payload = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    write_bytes(path, payload + b"\n", uid, gid)


def add_text(parent: ET.Element, name: str, value) -> ET.Element | None:
    if value is None or str(value) == "":
        return None
    element = ET.SubElement(parent, name)
    element.text = str(value)
    return element


def runtime_minutes(value: str | None) -> int | None:
    match = re.search(r"(\d+)", value or "")
    return int(match.group(1)) if match else None


def assess_provider_coverage(
    mapped: list[dict],
    provider_episodes: dict[int, dict],
    *,
    allow_provider_superset: bool,
) -> dict:
    local_episodes = {entry["episode"] for entry in mapped}
    provider_episode_numbers = set(provider_episodes)
    missing_from_provider = sorted(local_episodes - provider_episode_numbers)
    if missing_from_provider:
        fail(f"provider metadata is missing local episode numbers: {missing_from_provider}")
    provider_only = sorted(provider_episode_numbers - local_episodes)
    if provider_only and not allow_provider_superset:
        fail("provider superset requires --allow-provider-superset")
    for entry in mapped:
        provider_runtime = runtime_minutes(
            provider_episodes[entry["episode"]].get("runtime")
        )
        local_duration = entry["video"].get("durationSeconds")
        if (
            provider_runtime is None
            or not isinstance(local_duration, (int, float))
            or abs(float(local_duration) - provider_runtime * 60) > 180
        ):
            fail(f"local/provider runtime mismatch for episode {entry['episode']}")
    return {
        "localEpisodes": sorted(local_episodes),
        "mode": (
            "explicit-local-episode-subset" if provider_only else "exact-provider-season"
        ),
        "providerEpisodeCount": len(provider_episode_numbers),
        "providerOnlyEpisodes": provider_only,
        "videoDownloadCount": 0,
    }


def stage_artwork(
    url: str, directory: pathlib.Path, stem: str, uid: int, gid: int
) -> pathlib.Path:
    data, extension = fetch_artwork(url)
    path = directory / f"{stem}{extension}"
    if path.exists():
        fail(f"staged artwork collision: {path}")
    write_bytes(path, data, uid, gid)
    return path


def evidence_for_asset(path: pathlib.Path, evidence_id: str) -> dict:
    stat = path.stat()
    return {
        "digest": sha256_file(path),
        "evidenceId": evidence_id,
        "evidenceMethod": "sha256-full-v1",
        "fileKind": "asset",
        "mtimeMs": stat.st_mtime_ns // 1_000_000,
        "path": os.fspath(path),
        "scope": "local",
        "size": stat.st_size,
    }


def evidence_for_subtitle(path: pathlib.Path, evidence_id: str) -> dict:
    evidence = evidence_for_asset(path, evidence_id)
    evidence["fileKind"] = "subtitle"
    return evidence


def evidence_for_video(video: dict, evidence_id: str) -> dict:
    path = pathlib.Path(video["path"])
    stat = path.stat()
    if (
        not path.is_file()
        or path.is_symlink()
        or stat.st_size != video.get("size")
        or stat.st_mtime_ns // 1_000_000 != video.get("mtimeMs")
        or not re.fullmatch(r"[a-f0-9]{64}", str(video.get("boundedSha256") or ""))
    ):
        fail(f"video evidence changed before plan sealing: {path}")
    return {
        "digest": video["boundedSha256"],
        "evidenceId": evidence_id,
        "evidenceMethod": "bounded-sha256-first-last-4mib-v1",
        "fileKind": "video",
        "mtimeMs": video["mtimeMs"],
        "path": video["path"],
        "scope": "local",
        "size": video["size"],
    }


def evidence_id_for_asset(path: pathlib.Path) -> str:
    digest = hashlib.sha256(os.fspath(path).encode("utf-8")).hexdigest()[:16]
    return f"local-asset-{digest}"


def operation(
    evidence: dict, target_path: pathlib.Path, subtitle: dict | None = None
) -> dict:
    result = {
        "evidenceId": evidence["evidenceId"],
        "fileKind": evidence["fileKind"],
        "operation": "move",
        "sourcePath": evidence["path"],
        "targetPath": os.fspath(target_path),
    }
    if subtitle is not None:
        result["subtitle"] = subtitle
    return result


def inverse_operation(forward: dict) -> dict:
    return {
        **forward,
        "sourcePath": forward["targetPath"],
        "targetPath": forward["sourcePath"],
    }


def merge_component_plans(
    plans: list[dict], *, common_staging_root: pathlib.Path, sealed_at: str
) -> dict:
    if len(plans) < 2:
        fail("multi-season merge requires at least two component plans")
    first = plans[0]
    identity = first.get("identity")
    work_item = first.get("workItemId")
    execution = first.get("execution", {})
    allowlists = execution.get("allowlists", {})
    source_root = allowlists.get("localSourceRoot")
    target_root = allowlists.get("localTargetRoot")
    if not isinstance(identity, dict) or identity.get("mediaType") != "tv":
        fail("multi-season components must share one TV identity")
    if not re.fullmatch(r"media-\d{3}", str(work_item or "")):
        fail("multi-season component work item is invalid")
    if not common_staging_root.is_absolute():
        fail("multi-season staging root must be absolute")

    forward = []
    evidence_by_id = {}
    assignments = []
    subtitle_evidence = []
    target_keys = set()
    source_keys = set()
    season_sources = set()
    for plan in plans:
        component_execution = plan.get("execution", {})
        component_allowlists = component_execution.get("allowlists", {})
        component_staging = pathlib.Path(
            str(component_allowlists.get("localStagingRoot") or "")
        )
        if (
            plan.get("schemaVersion") != "1.2.0"
            or plan.get("sealed") is not True
            or component_execution.get("phase") != "local-only"
            or plan.get("workItemId") != work_item
            or plan.get("identity") != identity
            or component_allowlists.get("localSourceRoot") != source_root
            or component_allowlists.get("localTargetRoot") != target_root
            or not is_descendant(component_staging, common_staging_root)
        ):
            fail("multi-season component boundary changed")
        if any(
            plan.get("manifests", {}).get(name, {}).get(direction)
            for name in ("cloudVideo", "cloudSidecarQuarantine")
            for direction in ("forward", "inverse")
        ):
            fail("multi-season local components cannot carry cloud operations")
        component_evidence = {
            row.get("evidenceId"): row for row in plan.get("sourceEvidence", [])
        }
        component_forward = plan.get("manifests", {}).get("local", {}).get("forward")
        if not isinstance(component_forward, list) or not component_forward:
            fail("multi-season component has no local operations")
        if set(component_evidence) != {
            operation.get("evidenceId") for operation in component_forward
        }:
            fail("multi-season component evidence set is not exact")
        for operation_row in component_forward:
            target_key = str(operation_row.get("targetPath") or "").casefold()
            source_key = str(operation_row.get("sourcePath") or "").casefold()
            evidence_id = operation_row.get("evidenceId")
            if target_key in target_keys:
                fail("multi-season component target collision")
            if source_key in source_keys:
                fail("multi-season component source collision")
            if evidence_id in evidence_by_id:
                fail("multi-season component evidence ID collision")
            target_keys.add(target_key)
            source_keys.add(source_key)
            forward.append(operation_row)
            evidence_by_id[evidence_id] = component_evidence[evidence_id]
        decision = plan.get("subtitleDecision", {})
        if decision.get("mode") != "per-season-sources" or decision.get("gapSeasons"):
            fail("multi-season components require complete per-season subtitle decisions")
        assignments.extend(decision.get("assignments", []))
        for evidence in plan.get("subtitleEvidence", []):
            source_key = (evidence.get("season"), evidence.get("sourceId"))
            if source_key in season_sources:
                fail("multi-season subtitle source collision")
            season_sources.add(source_key)
            subtitle_evidence.append(evidence)

    forward.sort(key=lambda entry: (entry["targetPath"], entry["fileKind"]))
    inverse = [inverse_operation(entry) for entry in reversed(forward)]
    empty = {"forward": [], "inverse": []}
    manifests = {
        "cloudSidecarQuarantine": empty,
        "cloudVideo": {"forward": [], "inverse": []},
        "local": {"forward": forward, "inverse": inverse},
    }
    manifest_sha = {
        "cloudSidecarForward": stable_sha256([]),
        "cloudSidecarInverse": stable_sha256([]),
        "cloudVideoForward": stable_sha256([]),
        "cloudVideoInverse": stable_sha256([]),
        "localForward": stable_sha256(forward),
        "localInverse": stable_sha256(inverse),
    }
    assignments.sort(key=lambda row: (row["season"], row["episode"]))
    subtitle_evidence.sort(key=lambda row: (row["season"], row["sourceId"]))
    return {
        "execution": {
            "allowlists": {
                "localSourceRoot": source_root,
                "localStagingRoot": os.fspath(common_staging_root),
                "localTargetRoot": target_root,
            },
            "manifestSha256": manifest_sha,
            "phase": "local-only",
            "replayKey": f"{work_item}-multi-season-local-v1",
        },
        "identity": identity,
        "manifests": manifests,
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sealedAt": sealed_at,
        "sourceEvidence": sorted(evidence_by_id.values(), key=lambda row: row["path"]),
        "subtitleDecision": {
            "assignments": assignments,
            "gapSeasons": [],
            "mode": "per-season-sources",
        },
        "subtitleEvidence": subtitle_evidence,
        "targetAbsenceEvidence": [],
        "workItemId": work_item,
    }


def write_atomic_json(path: pathlib.Path, payload: dict) -> None:
    if path.exists():
        fail(f"evidence output already exists: {path}")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def load_json(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_inputs(inventory: dict, tmdb: dict) -> tuple[str, int, int, str, int]:
    work_item = inventory.get("workItemId")
    if (
        not re.fullmatch(r"media-\d{3}", str(work_item or ""))
        or tmdb.get("workItemId") != work_item
        or inventory.get("mode") != "local-only-readonly"
        or tmdb.get("schemaVersion") != "tmdb-tv-season-readonly-v1"
        or tmdb.get("status") != "tmdb-season-captured"
        or tmdb.get("mapping", {}).get("route")
        not in {
            "explicit-local-episode-subset",
            "one-video-per-provider-episode",
            "requires-provider-coverage-review",
        }
    ):
        fail("inventory and TMDB evidence are not a sealed one-to-one local TV season")
    identity = tmdb.get("identity", {})
    provider_id = int(identity.get("providerId") or 0)
    season = int(identity.get("season") if identity.get("season") is not None else -1)
    year = int(identity.get("year") or 0)
    canonical_title = sanitize_component(str(identity.get("canonicalTitle") or ""))
    source_root = pathlib.Path(str(inventory.get("sourceRoot") or ""))
    if (
        provider_id < 1
        or season < 0
        or year < 1900
        or not source_root.is_absolute()
        or not source_root.is_dir()
        or source_root.is_symlink()
        or not is_descendant(source_root.resolve(strict=True), MEDIA_ROOT)
    ):
        fail("identity or source root is outside the local TV boundary")
    return str(work_item), provider_id, season, canonical_title, year


def build(args: argparse.Namespace) -> tuple[dict, dict]:
    inventory_path = pathlib.Path(args.inventory)
    tmdb_path = pathlib.Path(args.tmdb)
    staging_root = pathlib.Path(args.staging_root)
    plan_output = pathlib.Path(args.plan_output)
    summary_output = pathlib.Path(args.summary_output)
    validate_evidence_file(inventory_path, "inventory")
    validate_evidence_file(tmdb_path, "TMDB capture")
    validate_staging_root(staging_root)
    validate_new_evidence_path(plan_output, "plan output")
    validate_new_evidence_path(summary_output, "summary output")
    sidecar_mode = args.sidecar_root is not None
    burned_in_mode = args.burned_in_review is not None
    gap_mode = args.subtitle_gap_evidence is not None
    if sum((sidecar_mode, burned_in_mode, gap_mode)) > 1:
        fail("sidecar, burned-in, and season-gap modes are mutually exclusive")
    if gap_mode and args.release_group is not None:
        fail("season-gap mode cannot carry a release group")
    sidecar_root = pathlib.Path(args.sidecar_root) if sidecar_mode else None
    burned_in_review_path = (
        pathlib.Path(args.burned_in_review) if burned_in_mode else None
    )
    subtitle_gap_evidence_path = (
        pathlib.Path(args.subtitle_gap_evidence) if gap_mode else None
    )
    subtitle_archive = None
    subtitle_source_evidence_path = None
    subtitle_source_evidence = None
    subtitle_manifest_output = None
    if sidecar_mode:
        if not args.subtitle_package_manifest_output or not args.subtitle_source_url:
            fail("sidecar mode requires manifest output and source URL")
        subtitle_manifest_output = pathlib.Path(args.subtitle_package_manifest_output)
        if not (
            re.fullmatch(r"https://[^\s]+", args.subtitle_source_url)
            or re.fullmatch(r"urn:btih:[0-9a-f]{40}", args.subtitle_source_url)
        ):
            fail("subtitle source reference must use HTTPS or a lowercase BTIH URN")
        validate_staging_source(sidecar_root, directory=True, label="sidecar root")
        archive_mode = any((args.subtitle_archive, args.subtitle_archive_sha256))
        source_evidence_mode = any(
            (
                args.subtitle_source_evidence,
                args.subtitle_source_evidence_sha256,
            )
        )
        if archive_mode == source_evidence_mode:
            fail("sidecar mode requires exactly one archive or sealed source evidence")
        if archive_mode:
            if not all((args.subtitle_archive, args.subtitle_archive_sha256)):
                fail("sidecar archive mode requires archive and archive SHA")
            subtitle_archive = pathlib.Path(args.subtitle_archive)
            if not re.fullmatch(r"[a-f0-9]{64}", args.subtitle_archive_sha256):
                fail("subtitle archive SHA-256 is invalid")
            validate_staging_source(
                subtitle_archive, directory=False, label="subtitle archive"
            )
            if sha256_file(subtitle_archive) != args.subtitle_archive_sha256:
                fail("subtitle archive SHA-256 changed")
        else:
            if not all(
                (
                    args.subtitle_source_evidence,
                    args.subtitle_source_evidence_sha256,
                )
            ):
                fail("sidecar evidence mode requires source evidence and SHA")
            subtitle_source_evidence_path = pathlib.Path(
                args.subtitle_source_evidence
            )
            if not re.fullmatch(
                r"[a-f0-9]{64}", args.subtitle_source_evidence_sha256
            ):
                fail("subtitle source evidence SHA-256 is invalid")
            validate_evidence_file(
                subtitle_source_evidence_path, "subtitle source evidence"
            )
            if (
                sha256_file(subtitle_source_evidence_path)
                != args.subtitle_source_evidence_sha256
            ):
                fail("subtitle source evidence SHA-256 changed")
            subtitle_source_evidence = load_json(subtitle_source_evidence_path)
        validate_new_evidence_path(subtitle_manifest_output, "subtitle package manifest")
    elif any(
        (
            args.subtitle_archive,
            args.subtitle_archive_sha256,
            args.subtitle_package_manifest_output,
            args.subtitle_source_evidence,
            args.subtitle_source_evidence_sha256,
            args.subtitle_source_url,
        )
    ):
        fail("sidecar-only arguments require --sidecar-root")
    if burned_in_mode:
        validate_evidence_file(burned_in_review_path, "burned-in review")
    if gap_mode:
        validate_evidence_file(subtitle_gap_evidence_path, "subtitle gap evidence")
    if args.allow_explicit_chinese_selection and (
        sidecar_mode or burned_in_mode or gap_mode
    ):
        fail("explicit embedded subtitle selection requires embedded mode")
    inventory = load_json(inventory_path)
    tmdb = load_json(tmdb_path)
    work_item, provider_id, season, canonical_title, year = validate_inputs(inventory, tmdb)
    mapped = map_videos(inventory, provider_id=provider_id, season_number=season)
    provider_episodes = {entry["episode"]: entry for entry in tmdb.get("episodes", [])}
    coverage = assess_provider_coverage(
        mapped,
        provider_episodes,
        allow_provider_superset=args.allow_provider_superset,
    )
    burned_in_review = None
    subtitle_gap = None
    if sidecar_mode:
        sealed_source_files = (
            validate_sealed_sidecar_source(
                subtitle_source_evidence,
                inventory_sha256=sha256_file(inventory_path),
                mapped=mapped,
                release_group=args.release_group,
                root=sidecar_root,
                season=season,
                source_url=args.subtitle_source_url,
                work_item=work_item,
            )
            if subtitle_source_evidence is not None
            else None
        )
        sidecar_package = collect_sidecar_package(
            sidecar_root,
            mapped,
            release_group=args.release_group,
            sealed_source_files=sealed_source_files,
        )
        signature = None
    elif burned_in_mode:
        if len(inventory.get("files", {}).get("subtitles", [])) != 0 or any(
            stream.get("type") == "subtitle"
            for entry in mapped
            for stream in entry["video"].get("streams", [])
        ):
            fail("burned-in TV plan requires no sidecar or embedded subtitle streams")
        sidecar_package = []
        signature = None
        burned_in_review = validate_burned_in_review(
            load_json(burned_in_review_path),
            inventory_path=inventory_path,
            inventory_sha256=sha256_file(inventory_path),
            mapped=mapped,
            provider_id=provider_id,
            release_group=args.release_group,
            season=season,
            work_item=work_item,
        )
    elif gap_mode:
        if len(inventory.get("files", {}).get("subtitles", [])) != 0 or any(
            stream.get("type") == "subtitle"
            for entry in mapped
            for stream in entry["video"].get("streams", [])
        ):
            fail("season-gap TV plan requires no sidecar or embedded subtitle streams")
        sidecar_package = []
        signature = None
        subtitle_gap = validate_subtitle_gap_evidence(
            load_json(subtitle_gap_evidence_path),
            mapped=mapped,
            season=season,
            work_item=work_item,
        )
    else:
        if len(inventory.get("files", {}).get("subtitles", [])) != 0:
            fail("embedded TV plan requires no sidecars")
        sidecar_package = []
        signature = embedded_subtitle_signature(
            [entry["video"] for entry in mapped],
            allow_explicit_chinese_selection=args.allow_explicit_chinese_selection,
        )
    source_root = pathlib.Path(inventory["sourceRoot"])
    target_root = TV_ROOT / f"{canonical_title} ({year}) [tmdbid-{provider_id}]"
    if target_root.exists() or target_root.is_symlink():
        fail("canonical target root already exists")
    owner = pathlib.Path(mapped[0]["video"]["path"]).stat()
    uid, gid = owner.st_uid, owner.st_gid
    created_staging = False
    created_outputs = []
    mode_name = (
        "sidecar"
        if sidecar_mode
        else "burned-in"
        if burned_in_mode
        else "season-gap"
        if gap_mode
        else "embedded"
    )
    source_id = (
        None
        if gap_mode
        else f"{work_item}-season-{season:02d}-{mode_name}-{hashlib.sha256(args.release_group.encode()).hexdigest()[:10]}"
    )
    try:
        ensure_directory(staging_root, uid, gid)
        created_staging = True
        season_root = staging_root / f"Season {season:02d}"
        ensure_directory(season_root, uid, gid)
        include_series_assets = not args.omit_series_assets
        series_artwork = tmdb.get("series", {}).get("artworkUrls", [])
        season_artwork_url = tmdb.get("seasonArtworkUrl")
        if not season_artwork_url or (include_series_assets and len(series_artwork) < 2):
            fail("TMDB title, fanart, or season artwork is missing")
        poster = (
            stage_artwork(series_artwork[0], staging_root, "poster", uid, gid)
            if include_series_assets
            else None
        )
        fanart = (
            stage_artwork(series_artwork[1], staging_root, "fanart", uid, gid)
            if include_series_assets
            else None
        )
        season_poster = stage_artwork(
            season_artwork_url, staging_root, f"season{season:02d}-poster", uid, gid
        )
        episode_assets = []
        video_targets = []
        for mapped_entry in mapped:
            episode_number = mapped_entry["episode"]
            metadata = provider_episodes[episode_number]
            title = sanitize_component(str(metadata.get("title") or f"第 {episode_number} 集"))
            base = sanitize_component(
                f"{canonical_title} - S{season:02d}E{episode_number:02d} - {title}"
            )
            image_url = metadata.get("imageUrl")
            if not image_url:
                fail(f"TMDB episode artwork is missing for episode {episode_number}")
            thumb = stage_artwork(image_url, season_root, f"{base}-thumb", uid, gid)
            nfo = season_root / f"{base}.nfo"
            episode_xml = ET.Element("episodedetails")
            add_text(episode_xml, "title", title)
            add_text(episode_xml, "showtitle", canonical_title)
            add_text(episode_xml, "season", season)
            add_text(episode_xml, "episode", episode_number)
            add_text(episode_xml, "aired", metadata.get("aired"))
            add_text(episode_xml, "runtime", runtime_minutes(metadata.get("runtime")))
            add_text(episode_xml, "plot", metadata.get("overview"))
            add_text(episode_xml, "thumb", thumb.name)
            write_xml(nfo, episode_xml, uid, gid)
            video = mapped_entry["video"]
            video_targets.append(
                {
                    "episode": episode_number,
                    "source": pathlib.Path(video["path"]),
                    "target": target_root / f"Season {season:02d}" / f"{base}{pathlib.Path(video['path']).suffix.lower()}",
                    "video": video,
                }
            )
            episode_assets.extend(
                [
                    (thumb, target_root / f"Season {season:02d}" / thumb.name),
                    (nfo, target_root / f"Season {season:02d}" / nfo.name),
                ]
            )
        video_targets_by_episode = {
            entry["episode"]: entry for entry in video_targets
        }
        subtitle_pairs = []
        for package_entry in sidecar_package:
            episode = package_entry["episode"]
            video_target = video_targets_by_episode[episode]["target"]
            target = canonical_subtitle_target(video_target, package_entry["path"])
            staged = season_root / target.name
            write_bytes(staged, package_entry["path"].read_bytes(), uid, gid)
            subtitle_pairs.append(
                {
                    **package_entry,
                    "staged": staged,
                    "target": target,
                }
            )
        description = tmdb.get("series", {}).get("description") or ""
        season_nfo = season_root / "season.nfo"
        season_xml = ET.Element("season")
        add_text(season_xml, "title", f"第 {season} 季")
        add_text(season_xml, "seasonnumber", season)
        add_text(season_xml, "plot", description)
        write_xml(season_nfo, season_xml, uid, gid)
        tvshow_nfo = None
        if include_series_assets:
            series_season_count = args.series_season_count or 1
            series_episode_count = args.series_episode_count or len(mapped)
            if series_season_count < 1 or series_episode_count < len(mapped):
                fail("series season or episode count is outside the component coverage")
            tvshow_nfo = staging_root / "tvshow.nfo"
            tvshow_xml = ET.Element("tvshow")
            add_text(tvshow_xml, "title", canonical_title)
            add_text(tvshow_xml, "sorttitle", canonical_title)
            add_text(tvshow_xml, "plot", description)
            add_text(tvshow_xml, "year", year)
            add_text(tvshow_xml, "tmdbid", provider_id)
            add_text(tvshow_xml, "numberofseasons", series_season_count)
            add_text(tvshow_xml, "numberofepisodes", series_episode_count)
            add_text(tvshow_xml, "thumb", poster.name)
            unique = add_text(tvshow_xml, "uniqueid", provider_id)
            if unique is not None:
                unique.set("type", "tmdb")
                unique.set("default", "true")
            fanart_xml = ET.SubElement(tvshow_xml, "fanart")
            add_text(fanart_xml, "thumb", fanart.name)
            write_xml(tvshow_nfo, tvshow_xml, uid, gid)
        asset_pairs = [
            (season_nfo, target_root / f"Season {season:02d}" / season_nfo.name),
            *episode_assets,
            (season_poster, target_root / season_poster.name),
        ]
        if include_series_assets:
            asset_pairs.extend(
                [
                    (fanart, target_root / fanart.name),
                    (poster, target_root / poster.name),
                    (tvshow_nfo, target_root / tvshow_nfo.name),
                ]
            )
        captured_at = utc_now()
        if sidecar_mode:
            package_manifest = {
                **(
                    {
                        "archivePath": os.fspath(subtitle_archive),
                        "archiveSha256": args.subtitle_archive_sha256,
                    }
                    if subtitle_archive is not None
                    else {
                        "sourceEvidencePath": os.fspath(
                            subtitle_source_evidence_path
                        ),
                        "sourceEvidenceSha256": args.subtitle_source_evidence_sha256,
                    }
                ),
                "files": [
                    {
                        "cueCount": entry["timing"]["cueCount"],
                        "episode": entry["episode"],
                        "firstCueSeconds": entry["timing"]["firstCueSeconds"],
                        "lastCueSeconds": entry["timing"]["lastCueSeconds"],
                        "nonPositiveCueCount": entry["timing"]["nonPositiveCueCount"],
                        "sha256": sha256_file(entry["staged"]),
                        "size": entry["staged"].stat().st_size,
                        "sourcePath": os.fspath(entry["path"]),
                        "stagedPath": os.fspath(entry["staged"]),
                        "subtitleFormat": entry["subtitleFormat"],
                        "videoDurationSeconds": entry["videoDurationSeconds"],
                    }
                    for entry in subtitle_pairs
                ],
                "mutationBoundaries": {
                    "cloudWrites": 0,
                    "databaseDirectWrite": False,
                    "formalMediaWrites": 0,
                    "mediaVideoDownloads": 0,
                    "serviceMutation": False,
                    "uiWrites": 0,
                },
                "observedAt": captured_at,
                "releaseGroup": args.release_group,
                "schemaVersion": "subtitle-package-manifest-v1",
                "season": season,
                "sourceUrl": args.subtitle_source_url,
                "workItemId": work_item,
            }
            write_atomic_json(subtitle_manifest_output, package_manifest)
            created_outputs.append(subtitle_manifest_output)
        source_evidence = []
        forward = []
        for source, target in asset_pairs:
            evidence = evidence_for_asset(source, evidence_id_for_asset(source))
            source_evidence.append(evidence)
            forward.append(operation(evidence, target))
        for entry in video_targets:
            evidence = evidence_for_video(
                entry["video"], f"local-video-s{season:02d}e{entry['episode']:02d}"
            )
            source_evidence.append(evidence)
            forward.append(operation(evidence, entry["target"]))
        for entry in subtitle_pairs:
            evidence = evidence_for_subtitle(
                entry["staged"],
                f"local-subtitle-s{season:02d}e{entry['episode']:02d}-zh-cn",
            )
            source_evidence.append(evidence)
            forward.append(
                operation(
                    evidence,
                    entry["target"],
                    {
                        "episode": entry["episode"],
                        "language": "zh-CN",
                        "season": season,
                        "sourceId": source_id,
                    },
                )
            )
        forward.sort(key=lambda entry: (entry["targetPath"], entry["fileKind"]))
        source_evidence.sort(key=lambda entry: entry["path"])
        inverse = [inverse_operation(entry) for entry in reversed(forward)]
        empty = {"forward": [], "inverse": []}
        manifests = {
            "cloudSidecarQuarantine": empty,
            "cloudVideo": {"forward": [], "inverse": []},
            "local": {"forward": forward, "inverse": inverse},
        }
        manifest_sha = {
            "cloudSidecarForward": stable_sha256(manifests["cloudSidecarQuarantine"]["forward"]),
            "cloudSidecarInverse": stable_sha256(manifests["cloudSidecarQuarantine"]["inverse"]),
            "cloudVideoForward": stable_sha256(manifests["cloudVideo"]["forward"]),
            "cloudVideoInverse": stable_sha256(manifests["cloudVideo"]["inverse"]),
            "localForward": stable_sha256(forward),
            "localInverse": stable_sha256(inverse),
        }
        if sidecar_mode:
            subtitle_evidence = [
                sidecar_subtitle_evidence(
                    episodes=[entry["episode"] for entry in mapped],
                    manifest_path=os.fspath(subtitle_manifest_output),
                    manifest_sha256=sha256_file(subtitle_manifest_output),
                    observed_at=captured_at,
                    release_group=args.release_group,
                    season=season,
                    source_id=source_id,
                )
            ]
        elif burned_in_mode:
            subtitle_evidence = [
                burned_in_subtitle_evidence(
                    episodes=burned_in_review["episodes"],
                    frame_observation_count=burned_in_review[
                        "frameObservationCount"
                    ],
                    observed_at=burned_in_review["observedAt"],
                    release_group=args.release_group,
                    review_path=os.fspath(burned_in_review_path),
                    review_sha256=sha256_file(burned_in_review_path),
                    season=season,
                    source_id=source_id,
                )
            ]
        elif gap_mode:
            subtitle_evidence = []
        else:
            subtitle_evidence = [
                embedded_subtitle_evidence(
                    episodes=[entry["episode"] for entry in mapped],
                    inventory_path=os.fspath(inventory_path),
                    inventory_sha256=sha256_file(inventory_path),
                    observed_at=inventory.get("observedAt"),
                    release_group=args.release_group,
                    season=season,
                    source_id=source_id,
                    stream_count=len(signature) * len(mapped),
                )
            ]
        plan = {
            "execution": {
                "allowlists": {
                    "localSourceRoot": os.fspath(source_root),
                    "localStagingRoot": os.fspath(staging_root),
                    "localTargetRoot": os.fspath(target_root),
                },
                "manifestSha256": manifest_sha,
                "phase": "local-only",
                "replayKey": f"{work_item}-{mode_name}-local-v1",
            },
            "identity": {
                "canonicalTitle": canonical_title,
                "mediaType": "tv",
                "provider": "tmdb",
                "providerId": str(provider_id),
                "year": year,
            },
            "manifests": manifests,
            "schemaVersion": "1.2.0",
            "sealed": True,
            "sealedAt": captured_at,
            "sourceEvidence": source_evidence,
            "subtitleDecision": {
                "assignments": []
                if gap_mode
                else [
                    {
                        "episode": entry["episode"],
                        "preferredLanguage": "zh-CN",
                        "season": season,
                        "sourceId": source_id,
                    }
                    for entry in mapped
                ],
                "gapSeasons": [season] if gap_mode else [],
                "mode": "season-gap" if gap_mode else "per-season-sources",
            },
            "subtitleEvidence": subtitle_evidence,
            "targetAbsenceEvidence": [],
            "workItemId": work_item,
        }
        write_atomic_json(plan_output, plan)
        created_outputs.append(plan_output)
        input_evidence_sha256 = {
            inventory_path.name: sha256_file(inventory_path),
            tmdb_path.name: sha256_file(tmdb_path),
        }
        if burned_in_mode:
            input_evidence_sha256[burned_in_review_path.name] = sha256_file(
                burned_in_review_path
            )
        if gap_mode:
            input_evidence_sha256[subtitle_gap_evidence_path.name] = sha256_file(
                subtitle_gap_evidence_path
            )
        if subtitle_source_evidence_path is not None:
            input_evidence_sha256[subtitle_source_evidence_path.name] = sha256_file(
                subtitle_source_evidence_path
            )
        summary = {
            "artworkCount": sum(
                pathlib.Path(entry[0]).suffix.lower() in {".jpg", ".png", ".webp"}
                for entry in asset_pairs
            ),
            "capturedAt": captured_at,
            "cloudGate": False,
            "inputEvidenceSha256": input_evidence_sha256,
            "localOperationCount": len(forward),
            "manifestSha256": manifest_sha,
            "metadataFileCount": len(asset_pairs),
            "nfoCount": sum(path.suffix == ".nfo" for path, _ in asset_pairs),
            "planPath": os.fspath(plan_output),
            "planSha256": sha256_file(plan_output),
            "providerCoverage": coverage,
            "releaseGroup": args.release_group,
            "schemaVersion": "1.2.0",
            "stagingRoot": os.fspath(staging_root),
            "subtitleCount": len(subtitle_pairs),
            "subtitleMode": mode_name,
            "subtitleGapEpisodeCount": subtitle_gap["episodeCount"] if gap_mode else 0,
            "embeddedSelectionMode": (
                "official-explicit-or-default"
                if mode_name == "embedded" and args.allow_explicit_chinese_selection
                else "container-default"
                if mode_name == "embedded"
                else None
            ),
            "subtitleSourceBySeason": {
                str(season): (
                    "explicit season gap (source-blocked)"
                    if gap_mode
                    else f"{args.release_group} {mode_name} zh-CN"
                )
            },
            "targetFileCount": len(forward),
            "targetRoot": os.fspath(target_root),
            "videoCount": len(mapped),
            "videoDownloadCount": 0,
            "workItemId": work_item,
        }
        write_atomic_json(summary_output, summary)
        created_outputs.append(summary_output)
        return plan, summary
    except Exception:
        for output in reversed(created_outputs):
            output.unlink(missing_ok=True)
        if created_staging and staging_root.exists():
            shutil.rmtree(staging_root)
        raise


def subtitle_evidence_mode(evidence_method: object) -> str:
    modes = {
        "burned-in-frame-manifest-sha256-v1": "burned-in",
        "embedded-stream-manifest-sha256-v1": "embedded",
        "subtitle-package-manifest-sha256-v1": "sidecar",
    }
    mode = modes.get(evidence_method)
    if mode is None:
        fail("multi-season subtitle evidence method is unsupported")
    return mode


def build_merged(args: argparse.Namespace) -> tuple[dict, dict]:
    component_paths = [pathlib.Path(path) for path in args.component_plan]
    common_staging_root = pathlib.Path(args.staging_root)
    plan_output = pathlib.Path(args.plan_output)
    summary_output = pathlib.Path(args.summary_output)
    if len(component_paths) < 2:
        fail("multi-season merge requires at least two --component-plan values")
    validate_staging_source(
        common_staging_root,
        directory=True,
        label="multi-season staging root",
    )
    validate_new_evidence_path(plan_output, "merged plan output")
    validate_new_evidence_path(summary_output, "merged summary output")
    for path in component_paths:
        validate_evidence_file(path, "component plan")
    plans = [load_json(path) for path in component_paths]
    plan = merge_component_plans(
        plans,
        common_staging_root=common_staging_root,
        sealed_at=utc_now(),
    )
    target_root = pathlib.Path(plan["execution"]["allowlists"]["localTargetRoot"])
    if target_root.exists() or target_root.is_symlink():
        fail("canonical target root already exists")
    forward = plan["manifests"]["local"]["forward"]
    video_count = sum(row["fileKind"] == "video" for row in forward)
    subtitle_count = sum(row["fileKind"] == "subtitle" for row in forward)
    asset_operations = [row for row in forward if row["fileKind"] == "asset"]
    artwork_extensions = {".jpg", ".png", ".webp"}
    source_by_season = {}
    for evidence in plan["subtitleEvidence"]:
        mode = subtitle_evidence_mode(evidence.get("evidenceMethod"))
        source_by_season[str(evidence["season"])] = (
            f"{evidence['releaseGroup']} {mode} zh-CN"
        )
    summary = {
        "artworkCount": sum(
            pathlib.Path(row["targetPath"]).suffix.lower() in artwork_extensions
            for row in asset_operations
        ),
        "capturedAt": plan["sealedAt"],
        "cloudGate": False,
        "componentPlanCount": len(plans),
        "inputEvidenceSha256": {
            path.name: sha256_file(path) for path in component_paths
        },
        "localOperationCount": len(forward),
        "manifestSha256": plan["execution"]["manifestSha256"],
        "metadataFileCount": len(asset_operations),
        "nfoCount": sum(
            pathlib.Path(row["targetPath"]).suffix.lower() == ".nfo"
            for row in asset_operations
        ),
        "planPath": os.fspath(plan_output),
        "releaseGroupBySeason": {
            str(row["season"]): row["releaseGroup"]
            for row in plan["subtitleEvidence"]
        },
        "schemaVersion": "1.2.0",
        "stagingRoot": os.fspath(common_staging_root),
        "subtitleCount": subtitle_count,
        "subtitleMode": "multi-season",
        "subtitleSourceBySeason": source_by_season,
        "targetFileCount": len(forward),
        "targetRoot": os.fspath(target_root),
        "videoCount": video_count,
        "videoDownloadCount": 0,
        "workItemId": plan["workItemId"],
    }
    created_outputs = []
    try:
        write_atomic_json(plan_output, plan)
        created_outputs.append(plan_output)
        summary["planSha256"] = sha256_file(plan_output)
        write_atomic_json(summary_output, summary)
        created_outputs.append(summary_output)
        return plan, summary
    except Exception:
        for output in reversed(created_outputs):
            output.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage one TV season component or merge components into one local-only title plan."
    )
    parser.add_argument("--inventory")
    parser.add_argument("--tmdb")
    parser.add_argument("--release-group")
    parser.add_argument("--component-plan", action="append")
    parser.add_argument("--allow-provider-superset", action="store_true")
    parser.add_argument("--allow-explicit-chinese-selection", action="store_true")
    parser.add_argument("--omit-series-assets", action="store_true")
    parser.add_argument("--series-season-count", type=int)
    parser.add_argument("--series-episode-count", type=int)
    parser.add_argument("--burned-in-review")
    parser.add_argument("--subtitle-gap-evidence")
    parser.add_argument("--sidecar-root")
    parser.add_argument("--subtitle-archive")
    parser.add_argument("--subtitle-archive-sha256")
    parser.add_argument("--subtitle-source-evidence")
    parser.add_argument("--subtitle-source-evidence-sha256")
    parser.add_argument("--subtitle-package-manifest-output")
    parser.add_argument("--subtitle-source-url")
    parser.add_argument("--staging-root", required=True)
    parser.add_argument("--plan-output", required=True)
    parser.add_argument("--summary-output", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.component_plan:
        if any(
            value is not None
            for value in (
                args.inventory,
                args.tmdb,
                args.release_group,
                args.burned_in_review,
                args.subtitle_gap_evidence,
                args.sidecar_root,
                args.subtitle_archive,
                args.subtitle_archive_sha256,
                args.subtitle_source_evidence,
                args.subtitle_source_evidence_sha256,
                args.subtitle_package_manifest_output,
                args.subtitle_source_url,
            )
        ):
            fail("component merge cannot carry single-season inputs")
        _, summary = build_merged(args)
    else:
        if not all((args.inventory, args.tmdb)) or (
            args.release_group is None and args.subtitle_gap_evidence is None
        ):
            fail(
                "single-season mode requires inventory, TMDB capture, and either a release group or subtitle gap evidence"
            )
        _, summary = build(args)
    print(
        json.dumps(
            {
                "localOperationCount": summary["localOperationCount"],
                "planSha256": summary["planSha256"],
                "targetFileCount": summary["targetFileCount"],
                "videoCount": summary["videoCount"],
                "videoDownloadCount": summary["videoDownloadCount"],
                "workItemId": summary["workItemId"],
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
