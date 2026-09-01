#!/usr/bin/env python3
"""逐集只读复核本地媒体的简中烧录字幕，帧只保留在 NAS 内存。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any
import warnings


MEDIA_ROOT = Path("/vol2/1000/Media/movie")
EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
CHUNK_SIZE = 4 * 1024 * 1024
HAN = re.compile(r"[\u3400-\u9fff]")
KANA = re.compile(r"[\u3040-\u30ff]")
SIMPLIFIED_MARKERS = set(
    "这还进过为么发后里说门见听给让从当会个们时开关问间长总样实头经场"
    "现应动种点国对无于与万两来气学车边东叶刘孙张赵陈杨吴马风龙鸟鱼"
    "爱体战气术击败坏愿旅转轻处认觉尽并带线权严备复观读写选"
)
MINIMUM_MATCHES_PER_EPISODE = 2
PASSES = (
    {
        "fractions": (0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82),
        "lowerBand": 0.45,
        "name": "primary-dialogue",
        "width": 1280,
    },
    {
        "fractions": (0.10, 0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.80, 0.88),
        "lowerBand": 0.50,
        "name": "gap-dense-early",
        "width": 1920,
    },
)
RESUME_PASSES = (
    {
        "fractions": (
            0.04,
            0.07,
            0.13,
            0.19,
            0.27,
            0.35,
            0.45,
            0.55,
            0.67,
            0.75,
            0.86,
            0.93,
        ),
        "lowerBand": 0.50,
        "name": "gap-resume-dense",
        "width": 1920,
    },
)


def fail(message: str) -> None:
    raise RuntimeError(message)


def utc_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bounded_digest(path: Path) -> str:
    size = path.stat().st_size
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        first = min(size, CHUNK_SIZE)
        digest.update(stream.read(first))
        if size > first:
            last = min(size - first, CHUNK_SIZE)
            stream.seek(size - last)
            digest.update(stream.read(last))
    return digest.hexdigest()


def is_descendant(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return path != root


def atomic_text(path: Path, value: str) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(value, encoding="utf-8")
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path: Path, value: object) -> None:
    atomic_text(
        path,
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def validate_release(
    inventory_path: Path,
    inventory_sha256: str,
    output_path: Path,
    script_sha256: str,
) -> None:
    script = Path(__file__).absolute()
    if (
        not re.fullmatch(r"[0-9a-f]{64}", script_sha256)
        or script.is_symlink()
        or sha256(script) != script_sha256
    ):
        fail("burned-in subtitle review script SHA changed")
    if (
        not inventory_path.is_absolute()
        or not inventory_path.is_file()
        or inventory_path.is_symlink()
        or not is_descendant(inventory_path.resolve(strict=False), EVIDENCE_ROOT)
        or sha256(inventory_path) != inventory_sha256
    ):
        fail("sealed local inventory changed")
    if (
        not output_path.is_absolute()
        or output_path.suffix != ".json"
        or not is_descendant(output_path.resolve(strict=False), EVIDENCE_ROOT)
        or output_path.exists()
        or output_path.is_symlink()
        or output_path.with_suffix(output_path.suffix + ".sha256").exists()
    ):
        fail("burned-in review output path is unsafe or already exists")


def provider_id(row: dict[str, Any]) -> Any:
    return (
        row.get("grandparent_tmdb_id")
        or row.get("parent_tmdb_id")
        or row.get("tmdb_id")
    )


def row_season(row: dict[str, Any]) -> Any:
    return (
        row.get("parent_season")
        if row.get("parent_season") is not None
        else row.get("season_number")
    )


def select_provider_episode_row(
    rows: list[dict[str, Any]], target_provider_id: int | None
) -> dict[str, Any] | None:
    matching = [
        row
        for row in rows
        if row.get("type") == "Episode"
        and (
            target_provider_id is None
            or str(provider_id(row)) == str(target_provider_id)
        )
    ]
    if not matching:
        if target_provider_id is not None:
            identifiable = [
                row
                for row in rows
                if row.get("type") in {"Episode", "Movie"}
                and provider_id(row) not in {None, ""}
            ]
            if rows and len(identifiable) == len(rows):
                return None
        fail("episode identity is not complete")
    if len(matching) != len(rows):
        fail("episode path has conflicting provider rows")
    identities = {
        (str(provider_id(row)), row_season(row), row.get("episode_number"))
        for row in matching
    }
    if len(identities) != 1:
        fail("conflicting provider episode rows")
    return matching[0]


def seal_episode_sources(
    inventory: dict[str, Any],
    expected_source_group: str | None = None,
    *,
    allow_existing_embedded: bool = False,
    season_source_groups: dict[int, str] | None = None,
    season_source_markers: dict[int, str] | None = None,
    target_provider_id: int | None = None,
) -> tuple[list[dict[str, Any]], str, dict[int, dict[str, str]]]:
    if (
        inventory.get("schemaVersion") != "1.0.0"
        or re.fullmatch(r"media-\d{3}", str(inventory.get("workItemId") or ""))
        is None
    ):
        fail("unsupported local inventory contract")
    season_source_groups = season_source_groups or {}
    season_source_markers = season_source_markers or {}
    if expected_source_group is not None and (
        season_source_groups or season_source_markers
    ):
        fail("global and per-season source groups are mutually exclusive")
    groups = [expected_source_group] if expected_source_group is not None else list(
        season_source_groups.values()
    )
    if not groups or any(
        not str(group).strip() or "/" in str(group) or "\\" in str(group)
        for group in groups
    ):
        fail("expected source group is invalid")
    if any(
        not str(marker).strip() or "\\" in str(marker)
        for marker in season_source_markers.values()
    ):
        fail("expected source marker is invalid")
    source_root = Path(str(inventory.get("sourceRoot") or ""))
    if (
        not source_root.is_absolute()
        or source_root.parent != MEDIA_ROOT
        or source_root.is_symlink()
        or not source_root.is_dir()
    ):
        fail("source root left the fixed local media boundary")
    summary = inventory.get("summary") or {}
    videos = list((inventory.get("files") or {}).get("videos") or [])
    subtitles = list((inventory.get("files") or {}).get("subtitles") or [])
    if int(summary.get("videoCount") or 0) < 1 or len(videos) != int(
        summary.get("videoCount") or 0
    ):
        fail("local inventory video count changed")
    if subtitles or int(summary.get("subtitleCount") or 0) != 0:
        fail("burned-in review requires zero local sidecar subtitles")
    if (
        int(summary.get("embeddedSubtitleStreamCount") or 0) != 0
        and not allow_existing_embedded
    ):
        fail("burned-in review requires zero embedded subtitle streams")

    rows_by_path: dict[str, list[dict[str, Any]]] = {}
    for row in (inventory.get("database") or {}).get("rows") or []:
        rows_by_path.setdefault(str(row.get("path") or ""), []).append(row)
    episodes = []
    provider_refs = set()
    for video in videos:
        path = Path(str(video.get("path") or ""))
        relative = str(video.get("relativePath") or "")
        rows = rows_by_path.get(os.fspath(path), [])
        row = select_provider_episode_row(rows, target_provider_id)
        if row is None:
            continue
        if (
            not path.is_absolute()
            or not is_descendant(path, source_root)
            or path.is_symlink()
            or not path.is_file()
            or path.relative_to(source_root).as_posix() != relative
            or path.stat().st_size != int(video.get("size") or -1)
            or path.stat().st_mtime_ns // 1_000_000 != int(video.get("mtimeMs") or -1)
            or bounded_digest(path) != video.get("boundedSha256")
        ):
            fail(f"sealed source or release group changed: {relative}")
        embedded_streams = [
            stream
            for stream in video.get("streams") or []
            if stream.get("type") == "subtitle"
        ]
        if embedded_streams and not allow_existing_embedded:
            fail(f"embedded subtitle stream appeared: {relative}")
        season = row_season(row)
        episode = row.get("episode_number")
        provider = provider_id(row)
        if (
            row.get("type") != "Episode"
            or not isinstance(season, int)
            or season < 0
            or not isinstance(episode, int)
            or episode < 1
            or provider in {None, ""}
        ):
            fail(f"episode metadata identity is incomplete: {relative}")
        source_group = season_source_groups.get(season, expected_source_group)
        source_marker = season_source_markers.get(season, source_group)
        if source_group is None or source_marker is None:
            fail(f"season {season} has no sealed source group")
        if str(source_marker).casefold() not in relative.casefold():
            fail(f"sealed source or release group changed: {relative}")
        provider_refs.add(str(provider))
        source = {
                "boundedSha256": video["boundedSha256"],
                "bytes": int(video["size"]),
                "durationSeconds": float(video.get("durationSeconds") or 0),
                "episode": episode,
                "mtimeMs": int(video["mtimeMs"]),
                "path": os.fspath(path),
                "relativePath": relative,
                "season": season,
            }
        if allow_existing_embedded:
            source["embeddedSubtitleStreamCount"] = len(embedded_streams)
        episodes.append(source)
    identities = {(row["season"], row["episode"]) for row in episodes}
    if len(identities) != len(episodes) or len(provider_refs) != 1:
        fail("episode identity or provider reference is not unique")
    seasons = {row["season"] for row in episodes}
    if season_source_groups and set(season_source_groups) != seasons:
        fail("per-season source groups do not exactly cover the inventory seasons")
    if not set(season_source_markers).issubset(seasons):
        fail("per-season source markers reference an unknown season")
    episodes.sort(key=lambda row: (row["season"], row["episode"], row["relativePath"]))
    season_sources = {
        season: {
            "group": str(season_source_groups.get(season, expected_source_group)),
            "marker": str(
                season_source_markers.get(
                    season, season_source_groups.get(season, expected_source_group)
                )
            ),
        }
        for season in sorted(seasons)
    }
    return episodes, f"tmdb:{next(iter(provider_refs))}", season_sources


def parse_season_map(values: list[str], label: str) -> dict[int, str]:
    parsed: dict[int, str] = {}
    for value in values:
        season_text, separator, item = value.partition("=")
        try:
            season = int(season_text)
        except ValueError:
            fail(f"{label} must use SEASON=VALUE")
        if (
            separator != "="
            or season < 0
            or not item.strip()
            or season in parsed
        ):
            fail(f"{label} must use unique non-negative SEASON=VALUE entries")
        parsed[season] = item.strip()
    return parsed


def sample_seconds(duration: float, fractions: tuple[float, ...]) -> list[int]:
    if not math.isfinite(duration) or duration <= 10:
        fail("video duration is too short for burned-in review")
    upper = max(5, math.floor(duration - 5))
    seconds = {
        min(upper, max(5, round(duration * fraction)))
        for fraction in fractions
        if fraction > 0
    }
    return sorted(seconds)


def clean_text(value: object) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(value)).strip()[:160]


def projection(result: Any) -> list[dict[str, Any]]:
    texts = list(result.txts or [])
    scores = list(result.scores or [])
    boxes = result.boxes.tolist() if result.boxes is not None else []
    rows = []
    for text, score, box in zip(texts, scores, boxes, strict=True):
        normalized = clean_text(text)
        if not normalized or len(box) < 4:
            continue
        y_center = sum(float(point[1]) for point in box) / len(box)
        rows.append(
            {
                "hanCount": len(HAN.findall(normalized)),
                "hasKana": bool(KANA.search(normalized)),
                "score": round(float(score), 4),
                "simplifiedMarkerCount": sum(
                    character in SIMPLIFIED_MARKERS for character in normalized
                ),
                "text": normalized,
                "yCenter": round(y_center, 2),
            }
        )
    return rows


def select_simplified_chinese(
    lines: list[dict[str, Any]], frame_height: int
) -> dict[str, Any] | None:
    candidates = [
        line
        for line in lines
        if float(line["score"]) >= 0.86
        and int(line["hanCount"]) >= 2
        and not bool(line["hasKana"])
        and int(line["simplifiedMarkerCount"]) >= 1
        and float(line["yCenter"]) >= frame_height * 0.35
    ]
    if not candidates:
        return None
    return dict(
        sorted(
            candidates,
            key=lambda line: (
                -int(line["simplifiedMarkerCount"]),
                -float(line["score"]),
                -int(line["hanCount"]),
                str(line["text"]),
            ),
        )[0]
    )


def require_health() -> dict[str, Any]:
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text(
        encoding="ascii"
    ).strip()
    guard = subprocess.run(
        ["systemctl", "is-active", "kt-nas-power-guard.service"],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    boost_path = Path("/sys/devices/system/cpu/cpufreq/boost")
    boost = (
        boost_path.read_text(encoding="ascii").strip()
        if boost_path.is_file()
        else "unsupported"
    )
    mdstat = Path("/proc/mdstat").read_text(encoding="ascii")
    raid_states = sorted(set(re.findall(r"\[[U_]+\]", mdstat)))
    if guard != "active" or boost not in {"0", "unsupported"}:
        fail(f"NAS power guard changed: guard={guard}, boost={boost}")
    if not raid_states or any("_" in state for state in raid_states):
        fail(f"NAS RAID is not fully online: {raid_states}")
    return {
        "bootId": boot_id,
        "cpuBoost": boost,
        "powerGuard": guard,
        "raidMemberStates": raid_states,
    }


def extract_frame(path: Path, second: int, width: int, lower_band: float, cv2, np):
    completed = subprocess.run(
        [
            "/usr/bin/nice",
            "-n",
            "19",
            "/usr/bin/ionice",
            "-c",
            "3",
            "/usr/bin/ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-threads",
            "1",
            "-ss",
            str(second),
            "-i",
            os.fspath(path),
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2,crop=iw:ih*{lower_band}:0:ih*(1-{lower_band})",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ],
        check=True,
        capture_output=True,
        timeout=45,
    )
    frame = cv2.imdecode(np.frombuffer(completed.stdout, dtype="uint8"), cv2.IMREAD_COLOR)
    if frame is None:
        fail(f"cannot decode OCR frame: {path.name}@{second}")
    return frame


def source_tags(path: Path) -> dict[str, str]:
    completed = subprocess.run(
        [
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format_tags",
            "-of",
            "json",
            os.fspath(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    tags = json.loads(completed.stdout).get("format", {}).get("tags", {})
    return {str(key).casefold(): clean_text(value) for key, value in sorted(tags.items())}


def load_ocr_runtime():
    import cv2
    import numpy as np
    from rapidocr import RapidOCR

    model_root = Path(sys.prefix) / "lib/python3.11/site-packages/rapidocr/models"
    if not model_root.is_dir():
        fail(f"RapidOCR model root is missing: {model_root}")
    warnings.filterwarnings("ignore")
    engine = RapidOCR(
        params={
            "Global.log_level": "critical",
            "Global.max_side_len": 1920,
            "Global.model_root_dir": os.fspath(model_root),
            "EngineConfig.onnxruntime.intra_op_num_threads": 1,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "Cls.cls_batch_num": 1,
            "Rec.rec_batch_num": 1,
        }
    )
    return cv2, np, engine, os.fspath(model_root)


def review_episode(
    source: dict[str, Any],
    engine,
    cv2,
    np,
    *,
    existing: dict[str, Any] | None = None,
    passes: tuple[dict[str, Any], ...] = PASSES,
) -> dict[str, Any]:
    path = Path(source["path"])
    attempts = list((existing or {}).get("attempts") or [])
    matches = list((existing or {}).get("matchedSimplifiedChinese") or [])
    attempted_seconds = {
        row.get("second")
        for row in attempts
        if isinstance(row, dict) and isinstance(row.get("second"), (int, float))
    }
    def enough_matches() -> bool:
        seconds = {
            row.get("second")
            for row in matches
            if isinstance(row, dict)
            and isinstance(row.get("second"), (int, float))
            and str(row.get("text") or "").strip()
        }
        return len(matches) >= MINIMUM_MATCHES_PER_EPISODE and len(seconds) >= 2

    for review_pass in passes:
        if enough_matches():
            break
        for second in sample_seconds(
            source["durationSeconds"], review_pass["fractions"]
        ):
            if second in attempted_seconds:
                continue
            attempted_seconds.add(second)
            started = time.monotonic()
            frame = extract_frame(
                path,
                second,
                int(review_pass["width"]),
                float(review_pass["lowerBand"]),
                cv2,
                np,
            )
            lines = projection(engine(frame))
            selected = select_simplified_chinese(lines, int(frame.shape[0]))
            candidates = [
                line
                for line in lines
                if float(line["score"]) >= 0.5
                and (int(line["hanCount"]) > 0 or bool(line["hasKana"]))
            ][:8]
            attempt = {
                "candidateLines": candidates,
                "elapsedMs": round((time.monotonic() - started) * 1000),
                "frameHeight": int(frame.shape[0]),
                "frameWidth": int(frame.shape[1]),
                "pass": review_pass["name"],
                "second": second,
                "selectedSimplifiedChinese": selected,
            }
            attempts.append(attempt)
            if selected is not None:
                matches.append(
                    {
                        **selected,
                        "frameHeight": int(frame.shape[0]),
                        "frameWidth": int(frame.shape[1]),
                        "pass": review_pass["name"],
                        "second": second,
                    }
                )
            if enough_matches():
                break
        if enough_matches():
            break
    return {
        **source,
        "attemptCount": len(attempts),
        "attempts": attempts,
        "matchedSimplifiedChinese": matches,
        "sealedBurnedIn": enough_matches(),
        "sourceTags": source_tags(path),
    }


def season_routes(episodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seasons = sorted({int(row["season"]) for row in episodes})
    output = []
    for season in seasons:
        selected = [row for row in episodes if int(row["season"]) == season]
        gaps = [int(row["episode"]) for row in selected if not row["sealedBurnedIn"]]
        output.append(
            {
                "episodeCount": len(selected),
                "gapEpisodes": gaps,
                "route": (
                    "burned-in-sealed"
                    if not gaps
                    else "manual-review-or-complete-season-single-source"
                ),
                "sealedEpisodeCount": len(selected) - len(gaps),
                "season": season,
            }
        )
    return output


def load_resume_review(
    path_text: str | None,
    expected_sha256: str | None,
    *,
    inventory_path: Path,
    inventory_sha256: str,
    provider_ref: str,
    season_sources: dict[str, dict[str, str]],
    source_group: str | None,
    sources: list[dict[str, Any]],
    work_item: str,
) -> dict[tuple[int, int], dict[str, Any]]:
    if (path_text is None) != (expected_sha256 is None):
        fail("resume review path and SHA-256 must be provided together")
    if path_text is None or expected_sha256 is None:
        return {}
    path = Path(path_text)
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or not is_descendant(path.resolve(strict=True), EVIDENCE_ROOT)
        or sha256(path) != expected_sha256
    ):
        fail("sealed resume review changed")
    review = json.loads(path.read_text(encoding="utf-8"))
    expected_groups = {
        season: source["group"] for season, source in season_sources.items()
    }
    expected_markers = {
        season: source["marker"] for season, source in season_sources.items()
    }
    if (
        review.get("schemaVersion") != "burned-in-frame-manifest-sha256-v1"
        or review.get("workItemId") != work_item
        or review.get("inventoryPath") != os.fspath(inventory_path)
        or review.get("inventorySha256") != inventory_sha256
        or review.get("providerRef") != provider_ref
        or review.get("sourceGroup") != source_group
        or review.get("seasonSourceGroups") != expected_groups
        or review.get("seasonSourceMarkers") != expected_markers
    ):
        fail("resume review identity changed")
    mutation = review.get("mutationBoundaries") or {}
    if mutation != {
        "cloudWrites": 0,
        "databaseDirectWrite": False,
        "mechanicalScanTriggered": False,
        "mediaFileWrites": 0,
        "serviceMutation": False,
        "uiWrites": 0,
    }:
        fail("resume review crossed a read-only boundary")
    rows = review.get("episodes") or []
    by_key: dict[tuple[int, int], dict[str, Any]] = {}
    for row in rows:
        key = (row.get("season"), row.get("episode"))
        if (
            not isinstance(key[0], int)
            or not isinstance(key[1], int)
            or key in by_key
        ):
            fail("resume review episode identity changed")
        by_key[key] = row
    source_by_key = {(row["season"], row["episode"]): row for row in sources}
    if set(by_key) != set(source_by_key):
        fail("resume review episode coverage changed")
    for key, source in source_by_key.items():
        row = by_key[key]
        source_fields = [
            "path",
            "relativePath",
            "boundedSha256",
            "bytes",
            "mtimeMs",
        ]
        if "embeddedSubtitleStreamCount" in source:
            source_fields.append("embeddedSubtitleStreamCount")
        if any(row.get(field) != source.get(field) for field in source_fields):
            fail("resume review source changed")
        attempts = row.get("attempts")
        matches = row.get("matchedSimplifiedChinese")
        if not isinstance(attempts, list) or not isinstance(matches, list):
            fail("resume review observations changed")
        if row.get("sealedBurnedIn") is True:
            seconds = {
                match.get("second")
                for match in matches
                if isinstance(match, dict)
                and isinstance(match.get("second"), (int, float))
            }
            if len(matches) < MINIMUM_MATCHES_PER_EPISODE or len(seconds) < 2:
                fail("resume review sealed episode lacks two observations")
    if all(row.get("sealedBurnedIn") is True for row in by_key.values()):
        fail("resume review has no unresolved episode")
    return by_key


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Review Simplified-Chinese burned-in subtitles without persisting frames."
    )
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--inventory-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--provider-id", type=int)
    parser.add_argument("--allow-existing-embedded-streams", action="store_true")
    parser.add_argument("--resume-review")
    parser.add_argument("--resume-review-sha256")
    parser.add_argument("--script-sha256", required=True)
    parser.add_argument("--source-group")
    parser.add_argument("--season-source-group", action="append", default=[])
    parser.add_argument("--season-source-marker", action="append", default=[])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.provider_id is not None and args.provider_id < 1:
        fail("provider ID must be positive")
    inventory_path = Path(args.inventory)
    output_path = Path(args.output)
    validate_release(
        inventory_path,
        args.inventory_sha256,
        output_path,
        args.script_sha256,
    )
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    season_source_groups = parse_season_map(
        args.season_source_group, "season source group"
    )
    season_source_markers = parse_season_map(
        args.season_source_marker, "season source marker"
    )
    sources, provider_ref, season_sources = seal_episode_sources(
        inventory,
        args.source_group,
        allow_existing_embedded=args.allow_existing_embedded_streams,
        season_source_groups=season_source_groups,
        season_source_markers=season_source_markers,
        target_provider_id=args.provider_id,
    )
    normalized_season_sources = {
        str(season): source for season, source in season_sources.items()
    }
    resume_by_key = load_resume_review(
        args.resume_review,
        args.resume_review_sha256,
        inventory_path=inventory_path,
        inventory_sha256=args.inventory_sha256,
        provider_ref=provider_ref,
        season_sources=normalized_season_sources,
        source_group=args.source_group,
        sources=sources,
        work_item=inventory["workItemId"],
    )
    active_passes = RESUME_PASSES if resume_by_key else PASSES
    configuration = {
        "allowExistingEmbeddedStreams": args.allow_existing_embedded_streams,
        "inventorySha256": args.inventory_sha256,
        "minimumMatchesPerEpisode": MINIMUM_MATCHES_PER_EPISODE,
        "passes": active_passes,
        "providerRef": provider_ref,
        "providerSelector": args.provider_id,
        "resumeReviewSha256": args.resume_review_sha256,
        "scriptSha256": args.script_sha256,
        "seasonSources": normalized_season_sources,
        "sourceGroup": args.source_group,
        "workItemId": inventory["workItemId"],
    }
    configuration_sha256 = hashlib.sha256(
        json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    partial_path = output_path.with_name(f".{output_path.name}.partial.json")
    if partial_path.is_symlink() or (
        partial_path.exists() and not partial_path.is_file()
    ):
        fail("burned-in review checkpoint path is unsafe")
    completed = []
    health_before = require_health()
    if partial_path.exists():
        partial = json.loads(partial_path.read_text(encoding="utf-8"))
        if (
            partial.get("configurationSha256") != configuration_sha256
            or partial.get("healthBefore") != health_before
        ):
            fail("burned-in review checkpoint changed")
        completed = list(partial.get("episodes") or [])
    expected_keys = [(row["season"], row["episode"]) for row in sources]
    completed_keys = [(row.get("season"), row.get("episode")) for row in completed]
    if completed_keys != expected_keys[: len(completed_keys)]:
        fail("burned-in review checkpoint episode order changed")

    cv2, np, engine, model_root = load_ocr_runtime()
    started = time.monotonic()
    for source in sources[len(completed) :]:
        key = (source["season"], source["episode"])
        existing = resume_by_key.get(key)
        needs_review = existing is None or existing.get("sealedBurnedIn") is not True
        if needs_review:
            result = review_episode(
                source,
                engine,
                cv2,
                np,
                existing=existing,
                passes=active_passes,
            )
        else:
            result = existing
        completed.append(result)
        if needs_review:
            atomic_json(
                partial_path,
                {
                    "configurationSha256": configuration_sha256,
                    "episodes": completed,
                    "healthBefore": health_before,
                    "schemaVersion": "burned-in-frame-manifest-sha256-v1-partial",
                },
            )
            print(
                json.dumps(
                    {
                        "completed": len(completed),
                        "matched": sum(row["sealedBurnedIn"] for row in completed),
                        "phase": (
                            "burned-in-review-resume"
                            if resume_by_key
                            else "burned-in-review"
                        ),
                        "total": len(sources),
                        "workItemId": inventory["workItemId"],
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                flush=True,
            )

    health_after = require_health()
    if health_after != health_before:
        fail("NAS health or boot changed during burned-in review")
    routes = season_routes(completed)
    missing = [
        {"episode": row["episode"], "season": row["season"]}
        for row in completed
        if not row["sealedBurnedIn"]
    ]
    source_tag_variants = {
        json.dumps(row["sourceTags"], ensure_ascii=False, sort_keys=True)
        for row in completed
    }
    output = {
        "capturedAt": utc_now(),
        "commandContract": {
            "decoderConcurrency": 1,
            "evidenceWrites": 2,
            "explicitModelRoot": model_root,
            "ffmpegThreads": 1,
            "frameBytesPersisted": 0,
            "ioniceClass": 3,
            "nice": 19,
            "onnxInterThreads": 1,
            "onnxIntraThreads": 1,
            "publicSshResourcePayloadBytes": 0,
            "resampledGapEpisodeCount": sum(
                row.get("sealedBurnedIn") is not True
                for row in resume_by_key.values()
            ),
            "reusedSealedEpisodeCount": sum(
                row.get("sealedBurnedIn") is True for row in resume_by_key.values()
            ),
        },
        "configurationSha256": configuration_sha256,
        "episodes": completed,
        "healthAfter": health_after,
        "healthBefore": health_before,
        "inventoryPath": os.fspath(inventory_path),
        "inventorySha256": args.inventory_sha256,
        "mode": "local-only-burned-in-readonly-v1",
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "mediaFileWrites": 0,
            "mechanicalScanTriggered": False,
            "serviceMutation": False,
            "uiWrites": 0,
        },
        "providerRef": provider_ref,
        "providerSelector": args.provider_id,
        "resumeReviewPath": args.resume_review,
        "resumeReviewSha256": args.resume_review_sha256,
        "schemaVersion": "burned-in-frame-manifest-sha256-v1",
        "scriptSha256": args.script_sha256,
        "seasonSourceGroups": {
            season: source["group"]
            for season, source in normalized_season_sources.items()
        },
        "seasonSourceMarkers": {
            season: source["marker"]
            for season, source in normalized_season_sources.items()
        },
        "seasonRoutes": routes,
        "sourceGroup": args.source_group,
        "summary": {
            "allEpisodesSealed": not missing,
            "elapsedMs": round((time.monotonic() - started) * 1000),
            "embeddedSubtitleEpisodeCount": sum(
                int(row.get("embeddedSubtitleStreamCount") or 0) > 0
                for row in completed
            ),
            "episodeCount": len(completed),
            "missingSimplifiedChineseEpisodes": missing,
            "sealedEpisodeCount": len(completed) - len(missing),
            "sourceTagVariantCount": len(source_tag_variants),
        },
        "workItemId": inventory["workItemId"],
    }
    atomic_json(output_path, output)
    output_sha256 = sha256(output_path)
    atomic_text(
        output_path.with_suffix(output_path.suffix + ".sha256"),
        f"{output_sha256}  {output_path.name}\n",
    )
    partial_path.unlink(missing_ok=True)
    print(
        json.dumps(
            {
                "outputPath": os.fspath(output_path),
                "sha256": output_sha256,
                "summary": output["summary"],
                "workItemId": inventory["workItemId"],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
