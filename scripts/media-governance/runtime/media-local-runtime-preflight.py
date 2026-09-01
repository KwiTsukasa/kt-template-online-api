#!/usr/bin/env python3
"""只读密封本地媒体流水线依赖的 trim.media 运行时身份。"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
from typing import Any


EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
GOVERNANCE_ROOT = Path("/vol1/docker/kt-media-governance")
MEDIA_DB = Path("/usr/local/apps/@appdata/trim.media/database/trimmedia.db")
OFFICIAL_API_HELPER = Path(
    "/vol1/docker/kt-media-governance/private/trim-official-api-helper.py"
)
DIGEST = re.compile(r"[0-9a-f]{64}")
GUID = re.compile(r"[0-9a-f]{32}")
WORK_ITEM = re.compile(r"media-\d{3}")
REQUIRED_HELPER_FUNCTIONS = (
    "active_admin_token",
    "request",
    "require_ok",
)
MAX_HELPER_CANDIDATES = 16
MAX_DISCOVERED_PYTHON_FILES = 50_000
MAX_HELPER_PYTHON_FILES = MAX_DISCOVERED_PYTHON_FILES
MAX_HELPER_BYTES = 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def descendant(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return path != root
    except ValueError:
        return False


def require_file(path: Path, label: str) -> None:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise RuntimeError(f"{label} is unavailable")


def helper_function_names(path: Path) -> list[str]:
    if path.is_symlink():
        return []
    try:
        metadata = path.stat()
    except (FileNotFoundError, PermissionError, OSError):
        return []
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_size < 1
        or metadata.st_size > MAX_HELPER_BYTES
    ):
        return []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError, UnicodeError):
        return []
    names = {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    if not set(REQUIRED_HELPER_FUNCTIONS).issubset(names):
        return []
    return list(REQUIRED_HELPER_FUNCTIONS)


def discover_helper_candidates(
    root: Path,
    *,
    max_python_files: int = MAX_HELPER_PYTHON_FILES,
    max_candidates: int = MAX_HELPER_CANDIDATES,
) -> dict[str, Any]:
    if (
        not root.is_absolute()
        or root.is_symlink()
        or not root.is_dir()
        or max_python_files < 1
        or max_candidates < 1
    ):
        raise RuntimeError("official helper discovery root is unavailable")
    root_resolved = root.resolve(strict=True)
    discovered_python_files: list[Path] = []
    truncated = False
    for current, directories, filenames in os.walk(root_resolved, followlinks=False):
        current_path = Path(current)
        directories[:] = sorted(
            name
            for name in directories
            if not (current_path / name).is_symlink()
        )
        for filename in sorted(filenames):
            if not filename.endswith(".py"):
                continue
            if len(discovered_python_files) >= MAX_DISCOVERED_PYTHON_FILES:
                truncated = True
                break
            discovered_python_files.append(current_path / filename)
        if truncated:
            break
    likely_tokens = ("api", "helper", "official", "probe", "trim")
    python_files = sorted(
        discovered_python_files,
        key=lambda path: (
            0 if any(token in path.name.lower() for token in likely_tokens) else 1,
            str(path),
        ),
    )[:max_python_files]
    if len(discovered_python_files) > len(python_files):
        truncated = True
    candidates = []
    for path in python_files:
        required_functions = helper_function_names(path)
        if not required_functions:
            continue
        resolved = path.resolve(strict=True)
        if not descendant(resolved, root_resolved):
            continue
        candidates.append(
            {
                "path": str(resolved),
                "requiredFunctions": required_functions,
                "sha256": sha256(resolved),
                "size": resolved.stat().st_size,
            }
        )
        if len(candidates) >= max_candidates:
            truncated = True
            break
    return {
        "candidateCount": len(candidates),
        "candidateLimit": max_candidates,
        "candidates": candidates,
        "discoveredPythonFileCount": len(discovered_python_files),
        "discoveredPythonFileLimit": MAX_DISCOVERED_PYTHON_FILES,
        "root": str(root_resolved),
        "scannedPythonFileCount": len(python_files),
        "scannedPythonFileLimit": max_python_files,
        "truncated": truncated,
    }


def install_helper_candidate(
    root: Path, target: Path, candidate_sha256: str
) -> dict[str, Any]:
    expected_target = root / "private" / "trim-official-api-helper.py"
    if target != expected_target or not DIGEST.fullmatch(candidate_sha256):
        raise RuntimeError("official helper recovery identity is invalid")
    if target.exists() or target.is_symlink():
        require_file(target, "official API helper")
        if sha256(target) != candidate_sha256:
            raise RuntimeError("official helper recovery refuses to overwrite target")
        target.chmod(0o600)
        return {
            "officialApiHelperSha256": candidate_sha256,
            "state": "already-installed",
            "targetPath": str(target),
        }
    discovery = discover_helper_candidates(root)
    matches = [
        Path(row["path"])
        for row in discovery["candidates"]
        if row["sha256"] == candidate_sha256
    ]
    if len(matches) != 1:
        raise RuntimeError("official helper candidate SHA is unavailable or ambiguous")
    source = matches[0]
    payload = source.read_bytes()
    if len(payload) > MAX_HELPER_BYTES or hashlib.sha256(payload).hexdigest() != candidate_sha256:
        raise RuntimeError("official helper candidate changed before installation")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.parent.chmod(0o700)
    temporary = target.parent / f".{target.name}.{os.getpid()}.tmp"
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, target, follow_symlinks=False)
    except FileExistsError as error:
        raise RuntimeError("official helper recovery refuses to overwrite target") from error
    finally:
        temporary.unlink(missing_ok=True)
    target.chmod(0o600)
    return {
        "officialApiHelperSha256": candidate_sha256,
        "sourcePath": str(source),
        "state": "installed",
        "targetPath": str(target),
    }


def inventory_identity(
    payload: dict[str, Any], *, work_item: str, source_path: str
) -> dict[str, Any]:
    videos = list((payload.get("files") or {}).get("videos") or [])
    rows = list((payload.get("database") or {}).get("rows") or [])
    summary = payload.get("summary") or {}
    if (
        payload.get("schemaVersion") != "1.0.0"
        or payload.get("mode") != "local-only-readonly"
        or payload.get("workItemId") != work_item
        or payload.get("sourceRoot") != source_path
        or not videos
        or summary.get("videoCount") != len(videos)
    ):
        raise RuntimeError("inventory identity changed")
    source_prefix = source_path.rstrip("/") + "/"
    video_paths = {str(row.get("path") or "") for row in videos}
    if any(not value.startswith(source_prefix) for value in video_paths):
        raise RuntimeError("inventory video escaped the source root")
    episode_rows = [
        row
        for row in rows
        if row.get("type") == "Episode" and str(row.get("path") or "") in video_paths
    ]
    if not episode_rows or {str(row.get("path") or "") for row in episode_rows} != video_paths:
        raise RuntimeError("inventory episode mapping is incomplete")
    series_guids = sorted(
        {
            str(row.get("grandparent_guid") or "")
            for row in episode_rows
            if row.get("grandparent_guid")
        }
    )
    provider_ids = sorted(
        {
            int(row.get("grandparent_tmdb_id"))
            for row in episode_rows
            if str(row.get("grandparent_tmdb_id") or "").isdigit()
            and int(row.get("grandparent_tmdb_id")) > 0
        }
    )
    if len(series_guids) != 1 or len(provider_ids) != 1:
        raise RuntimeError("inventory series identity is not unique")
    return {
        "providerIds": provider_ids,
        "seriesGuids": series_guids,
        "videoCount": len(videos),
    }


def require_library_ancestry(
    connection: sqlite3.Connection, series_guids: list[str], library_guid: str
) -> None:
    for series_guid in series_guids:
        row = connection.execute(
            "SELECT 1 FROM item_ancestor WHERE item_guid = ? AND ancestor_guid = ? LIMIT 1",
            (series_guid, library_guid),
        ).fetchone()
        if row is None:
            raise RuntimeError("series library ancestry changed")


def load_helper(path: Path):
    require_file(path, "official API helper")
    spec = importlib.util.spec_from_file_location("trim_official_api", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("official API helper cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in ("active_admin_token", "request", "require_ok"):
        if not callable(getattr(module, name, None)):
            raise RuntimeError("official API helper contract changed")
    return module


def official_runtime_boundary(helper, library_guid: str) -> dict[str, Any]:
    running = helper.require_ok(
        helper.request("/v/api/v1/task/running"), "official running task query"
    ) or []
    if not isinstance(running, list) or running:
        raise RuntimeError("trim.media has running tasks")
    library = helper.require_ok(
        helper.request(f"/v/api/v1/mdb/{library_guid}"), "official library query"
    ) or {}
    if not isinstance(library, dict):
        raise RuntimeError("official library response changed")
    observed_guid = library.get("guid")
    if observed_guid is not None and observed_guid != library_guid:
        raise RuntimeError("official library identity changed")
    if (
        library.get("prefer_local_nfo") != 1
        or library.get("auto_scrap_subtitle") != 0
        or library.get("subtitle_lan") != "zh-CN"
    ):
        raise RuntimeError("trim.media LocalNFO/subtitle policy changed")
    return {
        "autoScrapSubtitle": 0,
        "preferLocalNfo": 1,
        "runningTaskCount": 0,
        "subtitleLanguage": "zh-CN",
    }


def require_script_digest() -> None:
    expected_self = os.environ.get("KT_SCRIPT_SHA256", "")
    script = Path(__file__).resolve()
    if not DIGEST.fullmatch(expected_self) or sha256(script) != expected_self:
        raise RuntimeError("runtime preflight script SHA-256 changed")


def run(args: argparse.Namespace) -> dict[str, Any]:
    require_script_digest()
    if not WORK_ITEM.fullmatch(args.work_item):
        raise RuntimeError("work item identity is invalid")
    if not GUID.fullmatch(args.library_guid):
        raise RuntimeError("library GUID is invalid")
    if not args.source_path.startswith("/vol2/1000/Media/"):
        raise RuntimeError("source path is outside the media root")
    inventory = Path(args.inventory)
    helper_path = Path(args.official_api_helper)
    require_file(inventory, "inventory evidence")
    if (
        not descendant(inventory.resolve(strict=True), EVIDENCE_ROOT)
        or not DIGEST.fullmatch(args.inventory_sha256)
        or sha256(inventory) != args.inventory_sha256
    ):
        raise RuntimeError("inventory evidence SHA-256 changed")
    if helper_path != OFFICIAL_API_HELPER:
        raise RuntimeError("official API helper path changed")
    require_file(MEDIA_DB, "trim.media database")
    payload = json.loads(inventory.read_text(encoding="utf-8"))
    identity = inventory_identity(
        payload, work_item=args.work_item, source_path=args.source_path
    )
    with sqlite3.connect(f"file:{MEDIA_DB}?mode=ro", uri=True) as connection:
        require_library_ancestry(
            connection, identity["seriesGuids"], args.library_guid
        )
    helper_sha256 = sha256(helper_path)
    runtime = official_runtime_boundary(load_helper(helper_path), args.library_guid)
    return {
        **identity,
        **runtime,
        "inventorySha256": args.inventory_sha256,
        "libraryGuid": args.library_guid,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMediaWrites": 0,
            "officialApiWrites": 0,
            "uiWrites": 0,
        },
        "officialApiHelperSha256": helper_sha256,
        "schemaVersion": "media-local-runtime-preflight-v1",
        "sourcePath": args.source_path,
        "status": "runtime-preflight-passed",
        "workItemId": args.work_item,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover-helper-candidates", action="store_true")
    parser.add_argument("--install-helper-candidate-sha256")
    parser.add_argument("--work-item")
    parser.add_argument("--source-path")
    parser.add_argument("--inventory")
    parser.add_argument("--inventory-sha256")
    parser.add_argument("--official-api-helper")
    parser.add_argument("--library-guid")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.discover_helper_candidates:
        if args.install_helper_candidate_sha256:
            raise RuntimeError("official helper recovery mode is ambiguous")
        require_script_digest()
        result = {
            **discover_helper_candidates(GOVERNANCE_ROOT),
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "formalMediaWrites": 0,
                "officialApiWrites": 0,
                "uiWrites": 0,
            },
            "schemaVersion": "media-official-helper-recovery-v1",
            "status": "helper-candidates-observed",
        }
    elif args.install_helper_candidate_sha256:
        require_script_digest()
        result = {
            **install_helper_candidate(
                GOVERNANCE_ROOT,
                OFFICIAL_API_HELPER,
                args.install_helper_candidate_sha256,
            ),
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "formalMediaWrites": 0,
                "officialApiWrites": 0,
                "uiWrites": 0,
            },
            "rollback": "remove target only while its SHA-256 is unchanged",
            "schemaVersion": "media-official-helper-recovery-v1",
            "status": "helper-recovery-passed",
        }
    else:
        required = (
            args.work_item,
            args.source_path,
            args.inventory,
            args.inventory_sha256,
            args.official_api_helper,
            args.library_guid,
        )
        if any(not value for value in required):
            raise RuntimeError("runtime preflight arguments are incomplete")
        result = run(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
