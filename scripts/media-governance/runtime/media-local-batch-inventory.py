#!/usr/bin/env python3
"""一次性快速清点 fnOS 待治理媒体，并密封本地复用门。"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys


MEDIA_ROOT = Path("/vol2/1000/Media/movie")
EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
SINGLE_INVENTORY_PATH = Path(__file__).with_name("media-local-inventory.py")
SUPPORTED_STATES = {"inventory_pending", "local_reconciled", "reconciled"}


def fail(message: str) -> None:
    raise RuntimeError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_single_inventory(expected_sha256: str):
    if (
        not SINGLE_INVENTORY_PATH.is_file()
        or SINGLE_INVENTORY_PATH.is_symlink()
        or sha256(SINGLE_INVENTORY_PATH) != expected_sha256
    ):
        fail("fixed single-title inventory library changed")
    spec = importlib.util.spec_from_file_location(
        "media_local_inventory", SINGLE_INVENTORY_PATH
    )
    if spec is None or spec.loader is None:
        fail("cannot load single-title inventory library")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_release(
    script_sha256: str, ledger_path: Path, ledger_sha256: str, output_path: Path
) -> None:
    script = Path(__file__).resolve()
    if script.is_symlink() or sha256(script) != script_sha256:
        fail("batch inventory script SHA changed")
    if (
        not ledger_path.is_absolute()
        or not ledger_path.is_file()
        or ledger_path.is_symlink()
        or sha256(ledger_path) != ledger_sha256
    ):
        fail("sealed media ledger changed")
    if not output_path.is_absolute() or output_path.suffix != ".json":
        fail("output path must be an absolute JSON path")
    try:
        relative = output_path.resolve(strict=False).relative_to(EVIDENCE_ROOT)
    except ValueError as error:
        raise RuntimeError("output path must stay below the evidence root") from error
    if relative == Path(".") or output_path.exists() or output_path.is_symlink():
        fail("batch inventory output already exists or is unsafe")


def load_items(ledger_path: Path, selected_state: str) -> tuple[dict, list[dict]]:
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    if (
        ledger.get("schemaVersion") != "1.2.0"
        or ledger.get("localTitleRoot") != os.fspath(MEDIA_ROOT)
        or selected_state not in SUPPORTED_STATES
    ):
        fail("unsupported media ledger boundary")
    items = [
        item for item in ledger.get("items", []) if item.get("inventoryState") == selected_state
    ]
    if len({item.get("workItemId") for item in items}) != len(items):
        fail("duplicate media work item in ledger")
    for item in items:
        source = Path(str(item.get("sourcePath") or ""))
        if (
            re.fullmatch(r"media-\d{3}", str(item.get("workItemId") or "")) is None
            or source.parent != MEDIA_ROOT
            or source.name != item.get("sourceDirectory")
            or int(item.get("videoCount") or 0) < 1
        ):
            fail(f"invalid ledger item boundary: {item.get('workItemId')}")
    return ledger, items


def fast_probe(path: Path) -> dict:
    try:
        completed = subprocess.run(
            [
                "/usr/bin/ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
                os.fspath(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=90,
        )
        parsed = json.loads(completed.stdout)
        streams = parsed.get("streams", [])
        duration = float((parsed.get("format") or {}).get("duration") or 0)
        video_count = sum(row.get("codec_type") == "video" for row in streams)
        audio_count = sum(row.get("codec_type") == "audio" for row in streams)
        subtitle_count = sum(row.get("codec_type") == "subtitle" for row in streams)
        playable = duration > 1 and video_count > 0 and audio_count > 0
        return {
            "audioStreamCount": audio_count,
            "durationSeconds": duration,
            "playable": playable,
            "subtitleStreamCount": subtitle_count,
            "videoStreamCount": video_count,
        }
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        return {
            "audioStreamCount": 0,
            "durationSeconds": 0,
            "playable": False,
            "subtitleStreamCount": 0,
            "videoStreamCount": 0,
        }


def episode_identities(database_rows: list[dict], video_paths: list[Path]) -> list[dict]:
    by_path: dict[str, list[dict]] = {}
    for row in database_rows:
        by_path.setdefault(str(row.get("path") or ""), []).append(row)
    identities = []
    for path in video_paths:
        rows = by_path.get(os.fspath(path), [])
        if len(rows) != 1:
            return []
        row = rows[0]
        if row.get("type") == "Episode":
            season = row.get("season_number")
            episode = row.get("episode_number")
            if not isinstance(season, int) or season < 0 or not isinstance(episode, int) or episode < 1:
                return []
            identities.append({"episode": episode, "season": season})
        elif row.get("type") == "Movie" and len(video_paths) == 1:
            identities.append({"episode": 1, "season": 0})
        else:
            return []
    keys = {(item["season"], item["episode"]) for item in identities}
    return identities if len(keys) == len(video_paths) else []


def provider_refs(database_rows: list[dict]) -> list[str]:
    values = set()
    for row in database_rows:
        provider_id = (
            row.get("grandparent_tmdb_id")
            or row.get("parent_tmdb_id")
            or row.get("tmdb_id")
        )
        if provider_id:
            values.add(f"tmdb:{provider_id}")
    return sorted(values)


def sidecar_episode_numbers(single, subtitle_paths: list[Path]) -> set[int]:
    numbers = set()
    for path in subtitle_paths:
        hints = single.source_episode_hints(path.name)
        if len(hints) == 1:
            numbers.add(hints[0])
    return numbers


def summarize_title(
    single,
    item: dict,
    paths: list[Path],
    probes: dict[str, dict],
    database: dict,
) -> dict:
    source = Path(item["sourcePath"])
    symlinks = [path for path in paths if path.is_symlink()]
    special = [
        path
        for path in paths
        if not path.is_symlink() and not path.is_dir() and not path.is_file()
    ]
    files = [path for path in paths if path.is_file() and not path.is_symlink()]
    classified = single.classify_files(files)
    videos = classified["videos"]
    subtitles = classified["subtitles"]
    video_probes = [probes[os.fspath(path)] for path in videos]
    playable = sum(bool(probe["playable"]) for probe in video_probes)
    corrupt = len(videos) - playable
    embedded_files = sum(probe["subtitleStreamCount"] > 0 for probe in video_probes)
    identities = episode_identities(database["rows"], videos)
    sidecar_numbers = sidecar_episode_numbers(single, subtitles)
    local_episodes = []
    if identities:
        for identity, probe in zip(identities, video_probes, strict=True):
            subtitle_state = "embedded" if probe["subtitleStreamCount"] > 0 else "unknown"
            if identity["episode"] in sidecar_numbers:
                subtitle_state = "sidecar"
            local_episodes.append(
                {
                    **identity,
                    "subtitleState": subtitle_state,
                    "videoState": "playable" if probe["playable"] else "corrupt",
                }
            )
    count_matches = len(videos) == int(item["videoCount"])
    all_playable = count_matches and playable == len(videos)
    if identities:
        subtitle_gap_seasons = sorted(
            {
                episode["season"]
                for episode in local_episodes
                if episode["videoState"] == "playable"
                and episode["subtitleState"] == "unknown"
            }
        )
        download_ceiling = sum(
            episode["videoState"] == "corrupt" for episode in local_episodes
        )
        classification = (
            "gap-only-video-acquisition"
            if download_ceiling
            else "subtitle-evidence-required"
            if subtitle_gap_seasons
            else "local-reuse-fast-path"
        )
    else:
        subtitle_gap_seasons = []
        download_ceiling = 0
        classification = (
            "identity-resolution-required-local-reuse"
            if all_playable
            else "identity-resolution-required-before-gap-acquisition"
        )
    nfo_count = sum(path.suffix.lower() == ".nfo" for path in files)
    artwork_count = sum(
        path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} for path in files
    )
    return {
        "allLocalVideosPlayable": all_playable,
        "artworkCount": artwork_count,
        "corruptVideoCount": corrupt,
        "databaseMediaRowCount": len(database["rows"]),
        "embeddedSubtitleVideoCount": embedded_files,
        "expectedVideoCount": int(item["videoCount"]),
        "identityResolution": "resolved" if identities else "requires-provider-validation",
        "localFirstClassification": classification,
        "maximumGovernanceVideoDownloadCount": download_ceiling,
        "nfoCount": nfo_count,
        "observedVideoBytes": sum(path.stat().st_size for path in videos),
        "observedVideoCount": len(videos),
        "playableVideoCount": playable,
        "priority": item["priority"],
        "providerRefs": provider_refs(database["rows"]),
        "sidecarSubtitleCount": len(subtitles),
        "sourcePath": os.fspath(source),
        "specialFileCount": len(special),
        "subtitleEvidenceRoute": (
            "local-selectable-present"
            if embedded_files == len(videos) or len(sidecar_numbers) == len(videos)
            else "bounded-burned-in-review-before-subtitle-acquisition"
        ),
        "subtitleGapSeasonsAfterSelectableEvidence": subtitle_gap_seasons,
        "symlinkCount": len(symlinks),
        "videoCountMatchesLedger": count_matches,
        "workItemId": item["workItemId"],
    }


def wave(video_count: int) -> str:
    if video_count <= 13:
        return "small"
    if video_count <= 40:
        return "medium"
    return "large"


def collect_batch(single, ledger: dict, items: list[dict], workers: int) -> dict:
    paths_by_item: dict[str, list[Path]] = {}
    all_videos = []
    for item in items:
        source = Path(item["sourcePath"])
        single.validate_paths(source, None)
        if source.is_symlink() or not source.is_dir():
            fail(f"source root is missing or unsafe: {item['workItemId']}")
        paths = sorted(source.rglob("*"))
        paths_by_item[item["workItemId"]] = paths
        files = [path for path in paths if path.is_file() and not path.is_symlink()]
        all_videos.extend(single.classify_files(files)["videos"])
    probes = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(fast_probe, path): path for path in all_videos}
        for completed_count, future in enumerate(
            concurrent.futures.as_completed(futures), 1
        ):
            path = futures[future]
            probes[os.fspath(path)] = future.result()
            if completed_count % 50 == 0 or completed_count == len(all_videos):
                print(
                    f"批量视频探针进度={completed_count}/{len(all_videos)}",
                    file=sys.stderr,
                    flush=True,
                )
    summaries = []
    for item in items:
        source = Path(item["sourcePath"])
        summaries.append(
            summarize_title(
                single,
                item,
                paths_by_item[item["workItemId"]],
                probes,
                single.database_snapshot(source),
            )
        )
    wave_summary = {}
    for name in ("small", "medium", "large"):
        selected = [row for row in summaries if wave(row["expectedVideoCount"]) == name]
        wave_summary[name] = {
            "titleCount": len(selected),
            "videoCount": sum(row["expectedVideoCount"] for row in selected),
            "workItemIds": [row["workItemId"] for row in selected],
        }
    return {
        "inventoryState": items[0]["inventoryState"] if items else None,
        "items": summaries,
        "ledgerObservedAt": ledger.get("observedAt"),
        "mode": "local-batch-readonly-fast-v1",
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "evidenceWrites": 1,
            "fileWritesOutsideEvidence": 0,
            "mechanicalScanTriggered": False,
            "serviceMutation": False,
            "uiWrites": 0,
        },
        "schemaVersion": "1.0.0",
        "summary": {
            "allLocalVideosPlayableTitleCount": sum(
                row["allLocalVideosPlayable"] for row in summaries
            ),
            "corruptVideoCount": sum(row["corruptVideoCount"] for row in summaries),
            "expectedVideoCount": sum(row["expectedVideoCount"] for row in summaries),
            "identityResolvedTitleCount": sum(
                row["identityResolution"] == "resolved" for row in summaries
            ),
            "maximumGovernanceVideoDownloadCount": sum(
                row["maximumGovernanceVideoDownloadCount"] for row in summaries
            ),
            "observedVideoCount": sum(row["observedVideoCount"] for row in summaries),
            "playableVideoCount": sum(row["playableVideoCount"] for row in summaries),
            "subtitleReviewTitleCount": sum(
                row["subtitleEvidenceRoute"].startswith("bounded-") for row in summaries
            ),
            "titleCount": len(summaries),
            "videoCountDriftTitleCount": sum(
                not row["videoCountMatchesLedger"] for row in summaries
            ),
        },
        "waves": wave_summary,
    }


def write_atomic(output_path: Path, payload: dict) -> None:
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.partial-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect one compact local media batch inventory.")
    parser.add_argument("--base-sha256", required=True)
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--ledger-sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--script-sha256", required=True)
    parser.add_argument("--state", default="inventory_pending", choices=sorted(SUPPORTED_STATES))
    parser.add_argument("--workers", type=int, default=12)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ledger_path = Path(args.ledger)
    output_path = Path(args.output)
    if not 1 <= args.workers <= 24:
        fail("workers must stay between 1 and 24")
    validate_release(args.script_sha256, ledger_path, args.ledger_sha256, output_path)
    single = load_single_inventory(args.base_sha256)
    ledger, items = load_items(ledger_path, args.state)
    payload = collect_batch(single, ledger, items, args.workers)
    payload["releaseSha256"] = {
        "batchInventory": args.script_sha256,
        "ledger": args.ledger_sha256,
        "singleInventory": args.base_sha256,
    }
    write_atomic(output_path, payload)
    print(
        json.dumps(
            {
                "mode": payload["mode"],
                "mutationBoundaries": payload["mutationBoundaries"],
                "outputPath": os.fspath(output_path),
                "summary": payload["summary"],
                "waves": payload["waves"],
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
