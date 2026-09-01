#!/usr/bin/env python3
"""只读验证 fnOS 媒体目录、治理账本和外置事务目录的一致性。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any


DEFAULT_LEDGER = Path("data/fnos-media-governance-ledger.json")
DEFAULT_MEDIA_ROOT = Path("/vol2/1000/Media")
DEFAULT_STAGING_PARENT = Path("/vol2/1000/.kt-media-governance-staging")
DEFAULT_ROLLBACK_PARENT = Path("/vol2/1000/.kt-media-governance-rollback")
FORMAL_TITLE_PATTERN = re.compile(
    r"^.+ \(\d{4}\) \[(?:tmdbid|tvdbid)-[1-9]\d*\]$"
)
WORK_ITEM_PATTERN = re.compile(r"^(media-\d{3})(?:-|$)")
FORBIDDEN_WORKFLOW_PATTERN = re.compile(
    r"^\.kt-.*(?:staging|rollback|originals?)(?:-|$)", re.IGNORECASE
)
FORBIDDEN_DIRECTORY_NAMES = {
    "legacy-media",
    "legacy-sidecars",
    "legacy-video",
}
SYSTEM_MEDIA_ROOT_ENTRIES = {"cache", "img", "index", "subtitle"}
ALLOWED_MEDIA_ROOT_ENTRIES = {
    "extras",
    "incoming",
    "movie",
    *SYSTEM_MEDIA_ROOT_ENTRIES,
}
ALLOWED_MOVIE_ROOT_ENTRIES = {"Movies", "TV"}


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def load_ledger(path: Path, media_root: Path) -> tuple[dict[Path, dict[str, str]], dict[str, str]]:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"ledger is not a regular file: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    movie_root = media_root / "movie"
    if payload.get("localMediaRoot") != os.fspath(media_root):
        raise RuntimeError("ledger localMediaRoot does not match the audited media root")
    if payload.get("localTitleRoot") != os.fspath(movie_root):
        raise RuntimeError("ledger localTitleRoot does not match the audited movie root")
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("ledger items are missing")

    by_source: dict[Path, dict[str, str]] = {}
    states: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            raise RuntimeError("ledger item is not an object")
        work_item = item.get("workItemId")
        source = item.get("sourcePath")
        state_value = item.get("inventoryState")
        if (
            not isinstance(work_item, str)
            or re.fullmatch(r"media-\d{3}", work_item) is None
            or not isinstance(source, str)
            or not isinstance(state_value, str)
        ):
            raise RuntimeError("ledger item identity is incomplete")
        source_path = Path(source)
        if not source_path.is_absolute() or source_path.parent != movie_root:
            raise RuntimeError(f"ledger sourcePath leaves the movie root: {source}")
        if source_path in by_source or work_item in states:
            raise RuntimeError("ledger sourcePath or workItemId is duplicated")
        by_source[source_path] = {
            "state": state_value,
            "workItemId": work_item,
        }
        states[work_item] = state_value
    return by_source, states


def is_forbidden_workflow_directory(name: str) -> bool:
    return (
        name.casefold() in FORBIDDEN_DIRECTORY_NAMES
        or FORBIDDEN_WORKFLOW_PATTERN.fullmatch(name) is not None
    )


def issue(code: str, path: Path) -> dict[str, str]:
    return {"code": code, "path": os.fspath(path)}


def require_directory(
    path: Path, code: str, issues: list[dict[str, str]]
) -> bool:
    if not path.is_dir() or path.is_symlink():
        issues.append(issue(code, path))
        return False
    return True


def audit_external_parent(
    *,
    expected_gid: int,
    expected_uid: int,
    media_device: int,
    parent: Path,
    parent_kind: str,
    states: dict[str, str],
    issues: list[dict[str, str]],
) -> tuple[list[str], int]:
    if not require_directory(parent, f"missing-{parent_kind}-parent", issues):
        return [], 0
    parent_stat = parent.stat()
    if stat.S_IMODE(parent_stat.st_mode) != 0o700:
        issues.append(issue(f"unsafe-{parent_kind}-parent-mode", parent))
    if parent_stat.st_uid != expected_uid or parent_stat.st_gid != expected_gid:
        issues.append(issue(f"unsafe-{parent_kind}-parent-owner", parent))
    if parent_stat.st_dev != media_device:
        issues.append(issue(f"cross-device-{parent_kind}-parent", parent))

    active_work_items: list[str] = []
    entries = sorted(parent.iterdir(), key=lambda path: path.name.casefold())
    for entry in entries:
        if not entry.is_dir() or entry.is_symlink():
            issues.append(issue(f"invalid-{parent_kind}-entry", entry))
            continue
        match = WORK_ITEM_PATTERN.match(entry.name)
        if match is None or match.group(1) not in states:
            issues.append(issue(f"unknown-{parent_kind}-entry", entry))
            continue
        work_item = match.group(1)
        if parent_kind == "staging":
            if states[work_item] != "inventory_pending":
                issues.append(issue("closed-staging-present", entry))
            else:
                active_work_items.append(work_item)
    return sorted(set(active_work_items)), len(entries)


def audit_layout(
    *,
    expected_gid: int = 0,
    expected_uid: int = 0,
    ledger_path: Path,
    media_root: Path,
    rollback_parent: Path,
    staging_parent: Path,
) -> dict[str, Any]:
    media_root = media_root.resolve(strict=False)
    movie_root = media_root / "movie"
    issues: list[dict[str, str]] = []
    if not require_directory(media_root, "missing-media-root", issues):
        raise RuntimeError(f"media root is unavailable: {media_root}")
    source_items, states = load_ledger(ledger_path, media_root)
    media_device = media_root.stat().st_dev

    for entry in sorted(media_root.iterdir(), key=lambda path: path.name.casefold()):
        if entry.name not in ALLOWED_MEDIA_ROOT_ENTRIES:
            issues.append(issue("unexpected-media-root-entry", entry))
        elif not entry.is_dir() or entry.is_symlink():
            issues.append(issue("invalid-media-root-entry", entry))

    for name in sorted(SYSTEM_MEDIA_ROOT_ENTRIES):
        system_root = media_root / name
        if not require_directory(system_root, "missing-system-media-root", issues):
            continue
        system_stat = system_root.stat()
        if stat.S_IMODE(system_stat.st_mode) != 0o700:
            issues.append(issue("unsafe-system-media-root-mode", system_root))
        if system_stat.st_uid != expected_uid or system_stat.st_gid != expected_gid:
            issues.append(issue("unsafe-system-media-root-owner", system_root))
        if system_stat.st_dev != media_device:
            issues.append(issue("cross-device-system-media-root", system_root))

    incoming_root = media_root / "incoming"
    if require_directory(incoming_root, "missing-incoming-root", issues):
        for entry in sorted(incoming_root.iterdir(), key=lambda path: path.name.casefold()):
            if entry.name != "quark" or not entry.is_dir() or entry.is_symlink():
                issues.append(issue("unexpected-incoming-entry", entry))
    require_directory(incoming_root / "quark", "missing-incoming-quark", issues)
    require_directory(media_root / "extras", "missing-extras-root", issues)

    pending_root_count = 0
    if require_directory(movie_root, "missing-movie-root", issues):
        for entry in sorted(movie_root.iterdir(), key=lambda path: path.name.casefold()):
            if entry.name in ALLOWED_MOVIE_ROOT_ENTRIES:
                if not entry.is_dir() or entry.is_symlink():
                    issues.append(issue("invalid-movie-structural-root", entry))
                continue
            ledger_item = source_items.get(entry)
            if ledger_item is None:
                issues.append(issue("unexpected-movie-root", entry))
            elif ledger_item["state"] != "inventory_pending":
                issues.append(issue("closed-source-root-present", entry))
            elif not entry.is_dir() or entry.is_symlink():
                issues.append(issue("invalid-pending-source-root", entry))
            else:
                pending_root_count += 1

    for source_path, ledger_item in source_items.items():
        if ledger_item["state"] == "inventory_pending" and not source_path.is_dir():
            issues.append(issue("pending-source-root-missing", source_path))

    for current, directories, _ in os.walk(media_root, followlinks=False):
        current_path = Path(current)
        if current_path == media_root:
            directories[:] = [
                name for name in directories if name not in SYSTEM_MEDIA_ROOT_ENTRIES
            ]
        for name in directories:
            path = current_path / name
            if is_forbidden_workflow_directory(name):
                issues.append(issue("forbidden-watched-tree-directory", path))

    canonical_counts: dict[str, int] = {}
    for kind in ("TV", "Movies"):
        formal_root = movie_root / kind
        count = 0
        if require_directory(formal_root, f"missing-{kind.casefold()}-root", issues):
            for entry in sorted(formal_root.iterdir(), key=lambda path: path.name.casefold()):
                if not entry.is_dir() or entry.is_symlink():
                    issues.append(issue("invalid-formal-title-entry", entry))
                elif FORMAL_TITLE_PATTERN.fullmatch(entry.name) is None:
                    issues.append(issue("noncanonical-formal-title", entry))
                else:
                    count += 1
        canonical_counts[kind] = count

    active_staging, staging_count = audit_external_parent(
        expected_gid=expected_gid,
        expected_uid=expected_uid,
        media_device=media_device,
        parent=staging_parent,
        parent_kind="staging",
        states=states,
        issues=issues,
    )
    _, rollback_count = audit_external_parent(
        expected_gid=expected_gid,
        expected_uid=expected_uid,
        media_device=media_device,
        parent=rollback_parent,
        parent_kind="rollback",
        states=states,
        issues=issues,
    )

    unique_issues = sorted(
        {(item["code"], item["path"]) for item in issues},
        key=lambda item: (item[0], item[1].casefold()),
    )
    issue_records = [
        {"code": code, "path": path} for code, path in unique_issues[:100]
    ]
    return {
        "activeStagingWorkItems": active_staging,
        "canonicalMovieCount": canonical_counts["Movies"],
        "canonicalTvCount": canonical_counts["TV"],
        "capturedAt": utc_now(),
        "externalRollbackEntryCount": rollback_count,
        "externalStagingEntryCount": staging_count,
        "issueCount": len(unique_issues),
        "issues": issue_records,
        "issuesTruncated": len(unique_issues) > len(issue_records),
        "mutationCount": 0,
        "pendingLegacyRootCount": pending_root_count,
        "status": (
            "media-layout-contract-passed"
            if not unique_issues
            else "media-layout-contract-failed"
        ),
    }


def write_json_exclusive(path: Path, payload: object) -> None:
    if path.exists() or path.is_symlink():
        raise RuntimeError(f"refusing to overwrite evidence: {path}")
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise RuntimeError(f"evidence parent is unavailable: {path.parent}")
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        if temporary.exists() and temporary.parent == path.parent:
            temporary.unlink()
        raise


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def evidence_result_summary(result: dict, path: Path) -> dict:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("layout evidence output is unavailable")
    return {**result, "evidenceSha256": sha256_file(path)}


def cleanup_empty_closed_staging(
    *,
    execute: bool,
    failed_evidence_path: Path,
    failed_evidence_sha256: str,
    ledger_path: Path,
    media_root: Path,
    output_path: Path | None,
    staging_parent: Path,
) -> dict[str, Any]:
    if (
        not failed_evidence_path.is_file()
        or failed_evidence_path.is_symlink()
        or re.fullmatch(r"[a-f0-9]{64}", failed_evidence_sha256) is None
        or sha256_file(failed_evidence_path) != failed_evidence_sha256
    ):
        raise RuntimeError("failed layout evidence SHA-256 changed")
    failed = json.loads(failed_evidence_path.read_text(encoding="utf-8"))
    issues = failed.get("issues")
    if (
        failed.get("status") != "media-layout-contract-failed"
        or failed.get("issuesTruncated") is not False
        or not isinstance(issues, list)
        or not issues
        or failed.get("issueCount") != len(issues)
        or any(
            not isinstance(value, dict)
            or value.get("code") != "closed-staging-present"
            for value in issues
        )
    ):
        raise RuntimeError("failed layout evidence is not an empty-staging-only failure")
    _, states = load_ledger(ledger_path, media_root)
    roots = []
    directory_count = 0
    for value in issues:
        root = Path(str(value.get("path") or ""))
        match = WORK_ITEM_PATTERN.match(root.name)
        if (
            not root.is_absolute()
            or root.parent != staging_parent
            or root.is_symlink()
            or not root.is_dir()
            or match is None
            or states.get(match.group(1)) in (None, "inventory_pending")
            or root in roots
        ):
            raise RuntimeError("closed staging cleanup root identity changed")
        entries = list(root.rglob("*"))
        if any(entry.is_symlink() or not entry.is_dir() for entry in entries):
            raise RuntimeError("closed staging cleanup accepts empty directory trees only")
        roots.append(root)
        directory_count += len(entries) + 1
    archive = failed_evidence_path.with_name(
        f"{failed_evidence_path.stem}-failed-{failed_evidence_sha256[:12]}.json"
    )
    preview = {
        "archivedLayoutEvidence": os.fspath(archive),
        "capturedAt": utc_now(),
        "failedLayoutEvidenceSha256": failed_evidence_sha256,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMediaWrites": 0,
            "uiWrites": 0,
        },
        "plannedDirectoryRemovalCount": directory_count,
        "plannedRootRemovalCount": len(roots),
        "roots": [os.fspath(root) for root in roots],
        "schemaVersion": "media-layout-hygiene-cleanup-v1",
        "state": "cleanup-preflight-passed",
    }
    if not execute:
        return preview
    if output_path is None or output_path.exists() or output_path.is_symlink():
        raise RuntimeError("layout hygiene cleanup output must be a new path")
    if archive.exists() or archive.is_symlink():
        raise RuntimeError("failed layout evidence archive already exists")
    for root in roots:
        directories = sorted(
            (entry for entry in root.rglob("*") if entry.is_dir()),
            key=lambda entry: len(entry.parts),
            reverse=True,
        )
        for directory in directories:
            directory.rmdir()
        root.rmdir()
    failed_evidence_path.rename(archive)
    result = {
        **preview,
        "removedDirectoryCount": directory_count,
        "removedRootCount": len(roots),
        "state": "cleanup-complete",
    }
    write_json_exclusive(output_path, result)
    return evidence_result_summary(result, output_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--media-root", type=Path, default=DEFAULT_MEDIA_ROOT)
    parser.add_argument(
        "--rollback-parent", type=Path, default=DEFAULT_ROLLBACK_PARENT
    )
    parser.add_argument(
        "--staging-parent", type=Path, default=DEFAULT_STAGING_PARENT
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cleanup-failed-layout", type=Path)
    parser.add_argument("--cleanup-failed-layout-sha256")
    parser.add_argument("--cleanup-output", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if args.cleanup_failed_layout is not None:
        if not args.cleanup_failed_layout_sha256:
            raise RuntimeError("layout hygiene cleanup requires failed evidence SHA-256")
        if args.execute:
            expected = os.environ.get("KT_SCRIPT_SHA256", "")
            if (
                re.fullmatch(r"[a-f0-9]{64}", expected) is None
                or sha256_file(Path(__file__)) != expected
            ):
                raise RuntimeError("media layout contract script SHA-256 changed")
        result = cleanup_empty_closed_staging(
            execute=args.execute,
            failed_evidence_path=args.cleanup_failed_layout,
            failed_evidence_sha256=args.cleanup_failed_layout_sha256,
            ledger_path=args.ledger,
            media_root=args.media_root,
            output_path=args.cleanup_output,
            staging_parent=args.staging_parent,
        )
        print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
        return
    result = audit_layout(
        ledger_path=args.ledger,
        media_root=args.media_root,
        rollback_parent=args.rollback_parent,
        staging_parent=args.staging_parent,
    )
    if args.output is not None:
        write_json_exclusive(args.output, result)
        result = evidence_result_summary(result, args.output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
    if result["status"] != "media-layout-contract-passed":
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {"error": f"{type(error).__name__}: {error}", "status": "failed"},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
            flush=True,
        )
        raise
