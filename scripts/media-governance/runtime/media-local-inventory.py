#!/usr/bin/env python3
"""只读清点一个 fnOS 本地媒体条目的文件、字幕、关联和用户态。"""

from __future__ import annotations

import argparse
import collections
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import subprocess


MEDIA_ROOT = pathlib.Path("/vol2/1000/Media/movie")
EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
MEDIA_DB = pathlib.Path("/usr/local/apps/@appdata/trim.media/database/trimmedia.db")
BACKUP_DB = pathlib.Path("/usr/trim/var/backup_service/basic_backup.db3")
BACKUP_TASK_IDS = (3336513092, 4050934883)
VIDEO_EXTENSIONS = {
    ".avi",
    ".m2ts",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".ts",
    ".webm",
}
SUBTITLE_EXTENSIONS = {".ass", ".idx", ".srt", ".ssa", ".sub", ".sup", ".vtt"}
TEXT_SUBTITLE_EXTENSIONS = {".ass", ".srt", ".ssa", ".vtt"}
CHUNK_SIZE = 4 * 1024 * 1024
FFPROBE_WORKERS = 4
USER_STATE_HIERARCHY_TYPES = {"Movie", "Season", "TV"}


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


def validate_paths(
    source_root: pathlib.Path, output_path: pathlib.Path | None
) -> None:
    if not source_root.is_absolute():
        fail("source root must be absolute")
    source = source_root.resolve(strict=False)
    if not is_descendant(source, MEDIA_ROOT):
        fail("source root must stay below /vol2/1000/Media/movie")
    if output_path is not None:
        if not output_path.is_absolute():
            fail("output path must be absolute")
        output = output_path.resolve(strict=False)
        if not is_descendant(output, EVIDENCE_ROOT) or output.suffix != ".json":
            fail("output path must be a JSON file below the governance evidence root")


def full_digest(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bounded_digest(path: pathlib.Path) -> str:
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


def source_episode_hints(name: str) -> list[int]:
    hints: list[int] = []
    patterns = (
        r"(?:^|[^A-Za-z0-9])S\d{1,2}E(\d{1,3})(?:[^0-9]|$)",
        r"(?:^|[^A-Za-z0-9])(?:EP?|Episode)[ ._-]?(\d{1,3})(?:[^0-9]|$)",
        r"\[(\d{1,3})\]",
        r"\s-\s(\d{1,3})(?=\s|\[|\.|$)",
    )
    for pattern in patterns:
        for raw in re.findall(pattern, name, flags=re.IGNORECASE):
            value = int(raw)
            if value not in hints:
                hints.append(value)
    return hints


def classify_files(files: list[pathlib.Path]) -> dict[str, list[pathlib.Path]]:
    videos = [path for path in files if path.suffix.lower() in VIDEO_EXTENSIONS]
    subtitles = [
        path for path in files if path.suffix.lower() in SUBTITLE_EXTENSIONS
    ]
    assets = [
        path
        for path in files
        if path.suffix.lower() not in VIDEO_EXTENSIONS | SUBTITLE_EXTENSIONS
    ]
    return {
        "assets": sorted(assets),
        "subtitles": sorted(subtitles),
        "videos": sorted(videos),
    }


def probe_video(path: pathlib.Path) -> dict:
    completed = subprocess.run(
        [
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=index,codec_type,codec_name,width,height,"
            "sample_rate,channels:stream_tags=language,title,filename,mimetype:"
            "stream_disposition=default,forced",
            "-of",
            "json",
            os.fspath(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    )
    parsed = json.loads(completed.stdout)
    streams = []
    for stream in parsed.get("streams", []):
        tags = stream.get("tags") or {}
        disposition = stream.get("disposition") or {}
        streams.append(
            {
                "channels": stream.get("channels"),
                "codec": stream.get("codec_name"),
                "default": int(disposition.get("default") or 0),
                "forced": int(disposition.get("forced") or 0),
                "height": stream.get("height"),
                "index": int(stream["index"]),
                "language": tags.get("language"),
                "mimetype": tags.get("mimetype"),
                "sampleRate": stream.get("sample_rate"),
                "title": tags.get("title"),
                "type": stream.get("codec_type"),
                "width": stream.get("width"),
            }
        )
    return {
        "durationSeconds": float((parsed.get("format") or {}).get("duration") or 0),
        "formatName": (parsed.get("format") or {}).get("format_name"),
        "streams": streams,
    }


def decode_text(raw: bytes) -> tuple[str, str]:
    encodings = []
    if raw.startswith(b"\xef\xbb\xbf"):
        encodings.append("utf-8-sig")
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        encodings.append("utf-16")
    encodings.extend(("utf-8", "gb18030", "big5", "shift_jis"))
    for encoding in encodings:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace"), "utf-8-replace"


def subtitle_entry(path: pathlib.Path, source_root: pathlib.Path) -> dict:
    raw = path.read_bytes()
    entry = file_entry(path, source_root, full_digest_value=hashlib.sha256(raw).hexdigest())
    entry.update({"creditLines": [], "cueCount": None, "encoding": None})
    if path.suffix.lower() in TEXT_SUBTITLE_EXTENSIONS:
        text, encoding = decode_text(raw)
        credits = []
        for line in text.splitlines():
            if re.search(
                r"VCB|字幕|字幕組|字幕组|翻译|翻譯|校对|校對|时轴|時軸|rip|encode",
                line,
                re.IGNORECASE,
            ):
                normalized = re.sub(r"\s+", " ", line).strip()
                if normalized and normalized not in credits:
                    credits.append(normalized[:240])
            if len(credits) >= 8:
                break
        entry.update(
            {
                "creditLines": credits,
                "cueCount": sum(
                    line.startswith("Dialogue:") for line in text.splitlines()
                ),
                "encoding": encoding,
            }
        )
    return entry


def file_entry(
    path: pathlib.Path,
    source_root: pathlib.Path,
    *,
    full_digest_value: str | None = None,
    bounded_digest_value: str | None = None,
) -> dict:
    stat = path.stat()
    result = {
        "mtimeMs": stat.st_mtime_ns // 1_000_000,
        "path": os.fspath(path),
        "relativePath": path.relative_to(source_root).as_posix(),
        "size": stat.st_size,
        "sourceEpisodeHints": source_episode_hints(path.name),
    }
    if full_digest_value is not None:
        result["fullSha256"] = full_digest_value
    if bounded_digest_value is not None:
        result["boundedSha256"] = bounded_digest_value
    return result


def video_entry(path: pathlib.Path, source_root: pathlib.Path) -> dict:
    probe = probe_video(path)
    result = file_entry(
        path,
        source_root,
        bounded_digest_value=bounded_digest(path),
    )
    result.update(probe)
    return result


def asset_entry(path: pathlib.Path, source_root: pathlib.Path) -> dict:
    return file_entry(path, source_root, full_digest_value=full_digest(path))


def placeholders(values: list[str]) -> str:
    return ",".join("?" for _ in values)


def scoped_user_state_item_guids(rows: list[dict]) -> list[str]:
    item_guids = {row["item_guid"] for row in rows if row.get("item_guid")}
    for row in rows:
        for prefix in ("parent", "grandparent"):
            guid = row.get(f"{prefix}_guid")
            item_type = row.get(f"{prefix}_type")
            if guid and item_type in USER_STATE_HIERARCHY_TYPES:
                item_guids.add(guid)
    return sorted(item_guids)


def database_snapshot(source_root: pathlib.Path) -> dict:
    if not MEDIA_DB.is_file():
        fail("trim.media database is missing")
    with sqlite3.connect(f"file:{MEDIA_DB}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = [
            dict(row)
            for row in connection.execute(
                """
                SELECT im.guid AS media_guid, im.item_guid, im.path, im.size,
                       im.recognition_status,
                       i.type, i.title, i.original_title, i.season_number,
                       i.episode_number, i.parent_guid, i.tmdb_id, i.trim_id,
                       p.type AS parent_type, p.title AS parent_title,
                       p.season_number AS parent_season,
                       p.tmdb_id AS parent_tmdb_id, p.parent_guid AS grandparent_guid,
                       gp.type AS grandparent_type, gp.title AS grandparent_title,
                       gp.tmdb_id AS grandparent_tmdb_id
                  FROM item_media im
                  LEFT JOIN item i ON i.guid = im.item_guid
                  LEFT JOIN item p ON p.guid = i.parent_guid
                  LEFT JOIN item gp ON gp.guid = p.parent_guid
                 WHERE im.path LIKE ?
                 ORDER BY im.path, im.guid
                """,
                (os.fspath(source_root) + "/%",),
            )
        ]
        item_guids = scoped_user_state_item_guids(rows)
        media_guids = sorted({row["media_guid"] for row in rows if row["media_guid"]})
        play_rows = []
        favorite_rows = []
        item_user_rows = []
        if item_guids or media_guids:
            item_marks = placeholders(item_guids) if item_guids else "NULL"
            media_marks = placeholders(media_guids) if media_guids else "NULL"
            play_rows = [
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM item_user_play WHERE item_guid IN ({item_marks}) "
                    f"OR media_guid IN ({media_marks}) ORDER BY user_guid, item_guid, media_guid",
                    [*item_guids, *media_guids],
                )
            ]
        if item_guids:
            marks = placeholders(item_guids)
            favorite_rows = [
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM item_user_favorite WHERE item_guid IN ({marks}) ORDER BY item_guid",
                    item_guids,
                )
            ]
            item_user_rows = [
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM item_user WHERE item_guid IN ({marks}) ORDER BY item_guid",
                    item_guids,
                )
            ]
    groups = collections.Counter()
    for row in rows:
        groups[
            (
                row["grandparent_title"] or row["parent_title"] or row["title"],
                row["grandparent_tmdb_id"] or row["parent_tmdb_id"] or row["tmdb_id"],
                row["type"],
            )
        ] += 1
    return {
        "metadataGroups": [
            {"mediaRows": count, "title": key[0], "tmdbId": key[1], "type": key[2]}
            for key, count in sorted(
                groups.items(), key=lambda entry: (-entry[1], str(entry[0]))
            )
        ],
        "rows": rows,
        "userState": {
            "favoriteRows": favorite_rows,
            "itemPlayRows": play_rows,
            "itemUserRows": item_user_rows,
            "summary": {
                "favoriteRowCount": len(favorite_rows),
                "itemPlayRowCount": len(play_rows),
                "itemUserRowCount": len(item_user_rows),
                "scopedItemGuidCount": len(item_guids),
                "visiblePlayRowCount": sum(
                    int(row.get("visible") or 0) != 0 for row in play_rows
                ),
                "watchedPlayRowCount": sum(
                    int(row.get("watched") or 0) != 0 for row in play_rows
                ),
            },
        },
    }


def backup_tasks() -> list[dict]:
    if not BACKUP_DB.is_file():
        fail("fnOS backup database is missing")
    output = []
    with sqlite3.connect(f"file:{BACKUP_DB}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        for task_id in BACKUP_TASK_IDS:
            task = connection.execute(
                "SELECT id, name, direction, last_operation_id, period, status, next_time "
                "FROM user_tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
            if task is None:
                fail(f"backup task {task_id} is missing")
            operation = connection.execute(
                "SELECT id, start_time, finished_time, status FROM operations WHERE id = ?",
                (task["last_operation_id"],),
            ).fetchone()
            entry = dict(task)
            entry["lastOperation"] = dict(operation) if operation else None
            output.append(entry)
    return output


def trim_process_count() -> int:
    count = 0
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            command = pathlib.Path(f"/proc/{name}/cmdline").read_bytes()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if b"/@appcenter/trim.media/trim-media" in command:
            count += 1
    return count


def read_text(path: pathlib.Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (FileNotFoundError, PermissionError):
        return None


def host_snapshot() -> dict:
    return {
        "bootId": read_text(pathlib.Path("/proc/sys/kernel/random/boot_id")),
        "cpuBoost": read_text(pathlib.Path("/sys/devices/system/cpu/cpufreq/boost")),
        "mdstat": read_text(pathlib.Path("/proc/mdstat")),
        "trimMediaProcessCount": trim_process_count(),
    }


def write_atomic_json(output_path: pathlib.Path, payload: dict) -> None:
    if output_path.exists():
        fail("inventory evidence already exists")
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)


def collect(
    work_item_id: str,
    source_root: pathlib.Path,
    expected_video_count: int,
    output_path: pathlib.Path | None,
) -> dict:
    validate_paths(source_root, output_path)
    if not re.fullmatch(r"media-\d{3}", work_item_id):
        fail("work item ID must match media-NNN")
    if expected_video_count < 1:
        fail("expected video count must be positive")
    if source_root.is_symlink() or not source_root.is_dir():
        fail("source root is missing or is a symlink")
    all_paths = sorted(source_root.rglob("*"))
    symlinks = [path for path in all_paths if path.is_symlink()]
    special_files = [
        path for path in all_paths if not path.is_symlink() and not path.is_dir() and not path.is_file()
    ]
    files = [path for path in all_paths if path.is_file() and not path.is_symlink()]
    classified = classify_files(files)
    videos = classified["videos"]
    subtitles = classified["subtitles"]
    assets = classified["assets"]
    if len(videos) != expected_video_count:
        fail(
            f"source video count changed: expected {expected_video_count}, found {len(videos)}"
        )
    with concurrent.futures.ThreadPoolExecutor(max_workers=FFPROBE_WORKERS) as executor:
        video_entries = list(
            executor.map(lambda path: video_entry(path, source_root), videos)
        )
    subtitle_entries = [subtitle_entry(path, source_root) for path in subtitles]
    asset_entries = [asset_entry(path, source_root) for path in assets]
    database = database_snapshot(source_root)
    backup = backup_tasks()
    host = host_snapshot()
    payload = {
        "backupTasks": backup,
        "database": database,
        "directories": [
            path.relative_to(source_root).as_posix()
            for path in all_paths
            if path.is_dir() and not path.is_symlink()
        ],
        "files": {
            "assets": asset_entries,
            "subtitles": subtitle_entries,
            "videos": video_entries,
        },
        "host": host,
        "mode": "local-only-readonly",
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "evidenceWrites": int(output_path is not None),
            "fileWritesOutsideEvidence": 0,
            "mechanicalScanTriggered": False,
            "passwordRead": False,
            "serviceMutation": False,
            "uiWrites": 0,
        },
        "observedAt": utc_now(),
        "schemaVersion": "1.0.0",
        "sourceRoot": os.fspath(source_root),
        "specialFiles": [path.relative_to(source_root).as_posix() for path in special_files],
        "summary": {
            "assetBytes": sum(entry["size"] for entry in asset_entries),
            "assetCount": len(asset_entries),
            "directoryCount": sum(
                path.is_dir() and not path.is_symlink() for path in all_paths
            ),
            "embeddedSubtitleStreamCount": sum(
                stream["type"] == "subtitle"
                for entry in video_entries
                for stream in entry["streams"]
            ),
            "fileCount": len(files),
            "mediaRowCount": len(database["rows"]),
            "subtitleBytes": sum(entry["size"] for entry in subtitle_entries),
            "subtitleCount": len(subtitle_entries),
            "subtitleStreamFileCount": sum(
                any(stream["type"] == "subtitle" for stream in entry["streams"])
                for entry in video_entries
            ),
            "symlinkCount": len(symlinks),
            "videoBytes": sum(entry["size"] for entry in video_entries),
            "videoCount": len(video_entries),
        },
        "symlinks": [path.relative_to(source_root).as_posix() for path in symlinks],
        "workItemId": work_item_id,
    }
    if output_path is not None:
        write_atomic_json(output_path, payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect a read-only local fnOS media-title inventory."
    )
    parser.add_argument("--work-item", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--expected-video-count", required=True, type=int)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--output")
    output.add_argument("--stdout", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = pathlib.Path(args.output) if args.output else None
    payload = collect(
        args.work_item,
        pathlib.Path(args.source_root),
        args.expected_video_count,
        output_path,
    )
    if args.stdout:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return
    print(
        json.dumps(
            {
                "backupTasks": payload["backupTasks"],
                "databaseGroups": payload["database"]["metadataGroups"],
                "host": {
                    "bootId": payload["host"]["bootId"],
                    "cpuBoost": payload["host"]["cpuBoost"],
                    "trimMediaProcessCount": payload["host"]["trimMediaProcessCount"],
                },
                "mutationBoundaries": payload["mutationBoundaries"],
                "outputPath": os.fspath(output_path),
                "summary": payload["summary"],
                "userState": payload["database"]["userState"]["summary"],
                "workItemId": payload["workItemId"],
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
