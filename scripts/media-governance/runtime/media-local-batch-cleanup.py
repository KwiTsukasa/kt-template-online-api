#!/usr/bin/env python3
"""在独立验收后精确清理本地媒体批次的源、staging 与回滚硬链接。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


STAGING_PARENT = Path("/vol2/1000/.kt-media-governance-staging")
ROLLBACK_PARENT = Path("/vol2/1000/.kt-media-governance-rollback")
VIDEO_METHOD = "bounded-sha256-first-last-4mib-v1"
FULL_METHODS = {"sha256-v1", "sha256-full-v1"}
CHUNK_SIZE = 4 * 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bounded_sha256(path: Path) -> str:
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


def require_exact_file(path: Path, expected: str, label: str) -> None:
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or re.fullmatch(r"[0-9a-f]{64}", expected) is None
        or sha256(path) != expected
    ):
        raise RuntimeError(f"{label} SHA gate failed")


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("JSON input must be an object")
    return value


def write_json_once(path: Path, value: dict) -> None:
    if not path.is_absolute() or path.exists() or path.is_symlink():
        raise RuntimeError("cleanup output must be a new absolute path")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError("temporary cleanup output already exists")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    temporary.replace(path)


def require_child(path: Path, parent: Path, label: str) -> None:
    if not path.is_absolute() or path == parent or path.parent == Path("/"):
        raise RuntimeError(f"{label} must be a specific absolute child")
    try:
        path.relative_to(parent)
    except ValueError as error:
        raise RuntimeError(f"{label} is outside its fixed parent") from error


def tree_entries(root: Path) -> tuple[list[Path], list[Path]]:
    if not root.exists():
        return [], []
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("cleanup tree root is missing or unsafe")
    entries = list(root.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise RuntimeError("cleanup tree contains a symlink")
    files = sorted((path for path in entries if path.is_file()), key=os.fspath)
    directories = sorted(
        (path for path in entries if path.is_dir()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    return files, directories


def remove_tree(root: Path, files: list[Path], directories: list[Path]) -> None:
    for path in files:
        path.unlink()
    for path in directories:
        path.rmdir()
    root.rmdir()


def prune_empty_ancestors(start: Path, parent: Path) -> None:
    if (
        not start.is_absolute()
        or not parent.is_absolute()
        or start == parent
        or parent.is_symlink()
        or not parent.is_dir()
    ):
        raise RuntimeError("empty ancestor cleanup is outside the fixed parent")
    try:
        start.relative_to(parent)
    except ValueError as error:
        raise RuntimeError("empty ancestor cleanup is outside the fixed parent") from error
    current = start
    while current != parent:
        if current.is_symlink():
            raise RuntimeError("empty ancestor cleanup rejects symlinks")
        if current.exists():
            if not current.is_dir():
                raise RuntimeError("empty ancestor cleanup encountered a non-directory")
            try:
                current.rmdir()
            except OSError:
                break
        current = current.parent


def canonical_target_roots(plan: dict) -> list[Path]:
    target_parent = Path(plan["execution"]["allowlists"]["localTargetRoot"])
    if not target_parent.is_absolute():
        raise RuntimeError("canonical target parent is not absolute")
    identity = plan.get("identity") or {}
    if identity.get("mediaType") == "bundle":
        components = identity.get("components")
        if not isinstance(components, list) or not components:
            raise RuntimeError("bundle cleanup identity has no components")
        roots = [Path(str(component.get("targetRoot") or "")) for component in components]
    else:
        roots = [target_parent]
    if len(roots) != len(set(roots)):
        raise RuntimeError("canonical cleanup roots are duplicated")
    for root in roots:
        if not root.is_absolute():
            raise RuntimeError("canonical cleanup root is not absolute")
        try:
            root.relative_to(target_parent)
        except ValueError as error:
            raise RuntimeError("canonical cleanup root is outside target parent") from error
        if identity.get("mediaType") == "bundle" and root == target_parent:
            raise RuntimeError("bundle cleanup root cannot equal target parent")
    for index, left in enumerate(roots):
        for right in roots[index + 1 :]:
            if left in right.parents or right in left.parents:
                raise RuntimeError("canonical cleanup roots overlap")
    return roots


def tree_digest(root: Path, files: list[Path]) -> str:
    records = []
    for path in files:
        records.append(
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": sha256(path),
                "size": path.stat().st_size,
            }
        )
    payload = json.dumps(records, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_sealed_target(plan: dict) -> dict[str, dict]:
    if (
        plan.get("schemaVersion") != "1.2.0"
        or plan.get("sealed") is not True
        or plan.get("execution", {}).get("phase") != "local-only"
    ):
        raise RuntimeError("cleanup accepts only sealed local-only Schema 1.2.0 plans")
    target_roots = canonical_target_roots(plan)
    evidence = {row["evidenceId"]: row for row in plan["sourceEvidence"]}
    expected = {}
    for operation in plan["manifests"]["local"]["forward"]:
        target = Path(operation["targetPath"])
        matches = []
        for root in target_roots:
            try:
                target.relative_to(root)
            except ValueError:
                continue
            if target != root:
                matches.append(root)
        if len(matches) != 1:
            raise RuntimeError("canonical target does not match exactly one cleanup root")
        sealed = evidence[operation["evidenceId"]]
        if not target.is_file() or target.is_symlink() or target.stat().st_size != sealed["size"]:
            raise RuntimeError("canonical target file changed before cleanup")
        method = sealed.get("evidenceMethod")
        if method == VIDEO_METHOD:
            digest = bounded_sha256(target)
        elif method in FULL_METHODS:
            digest = sha256(target)
        else:
            raise RuntimeError("canonical target evidence method changed")
        if digest != sealed["digest"]:
            raise RuntimeError("canonical target digest changed before cleanup")
        expected[str(target)] = {
            "digest": digest,
            "inode": target.stat().st_ino,
            "method": method,
            "size": target.stat().st_size,
        }
    actual_files = []
    for root in target_roots:
        root_files, _directories = tree_entries(root)
        actual_files.extend(root_files)
    if {str(path) for path in actual_files} != set(expected):
        raise RuntimeError("canonical target file set changed before cleanup")
    return expected


def copy_retained_file(source: Path, target: Path) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.exists() or target.is_symlink():
        raise RuntimeError("retained backup target already exists")
    shutil.copy2(source, target)
    target.chmod(0o600)
    source_sha = sha256(source)
    if sha256(target) != source_sha or target.stat().st_size != source.stat().st_size:
        raise RuntimeError("retained backup copy verification failed")
    return {"sha256": source_sha, "size": source.stat().st_size}


def verify_rollback_hardlinks(
    backup_evidence: dict, plans: dict[str, dict], rollback_root: Path
) -> tuple[list[Path], int]:
    plan_targets = {}
    for plan in plans.values():
        for operation in plan["manifests"]["local"]["forward"]:
            if operation["fileKind"] == "video":
                plan_targets[operation["sourcePath"]] = Path(operation["targetPath"])
    rows = backup_evidence.get("hardlinks")
    if not isinstance(rows, list) or len(rows) != len(plan_targets):
        raise RuntimeError("rollback hardlink evidence set changed")
    expected_paths = set()
    logical_bytes = 0
    for row in rows:
        rollback = Path(row["rollbackPath"])
        require_child(rollback, rollback_root, "rollback file")
        target = plan_targets.get(row["sourcePath"])
        if target is None or not rollback.is_file() or rollback.is_symlink():
            raise RuntimeError("rollback hardlink is missing or unexpected")
        rollback_stat = rollback.stat()
        target_stat = target.stat()
        if (
            rollback_stat.st_dev != target_stat.st_dev
            or rollback_stat.st_ino != target_stat.st_ino
            or rollback_stat.st_size != row["size"]
            or bounded_sha256(rollback) != row["digest"]
        ):
            raise RuntimeError("rollback hardlink no longer matches canonical video")
        expected_paths.add(rollback)
        logical_bytes += rollback_stat.st_size
    actual_files, _directories = tree_entries(rollback_root)
    if set(actual_files) != expected_paths:
        raise RuntimeError("rollback root contains unsealed files")
    return sorted(expected_paths, key=os.fspath), logical_bytes


def has_acquisition_bundle(
    acquisition_root: str | None, acquisition_archive_sha256: str | None
) -> bool:
    supplied = (acquisition_root is not None, acquisition_archive_sha256 is not None)
    if supplied[0] != supplied[1]:
        raise RuntimeError(
            "acquisition root and acquisition archive SHA must be supplied together"
        )
    return supplied[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean an accepted local media batch.")
    parser.add_argument("--plan", action="append", required=True)
    parser.add_argument("--acceptance-evidence", required=True)
    parser.add_argument("--acceptance-evidence-sha256", required=True)
    parser.add_argument("--backup-evidence", required=True)
    parser.add_argument("--backup-evidence-sha256", required=True)
    parser.add_argument("--acquisition-root")
    parser.add_argument("--acquisition-archive-sha256")
    parser.add_argument("--discard-root", action="append", default=[])
    parser.add_argument("--discard-tree-sha256", action="append", default=[])
    parser.add_argument("--retention-root", required=True)
    parser.add_argument("--output")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    plans = {}
    canonical = {}
    for path_text in args.plan:
        path = Path(path_text)
        if not path.is_absolute() or not path.is_file() or path.is_symlink():
            raise RuntimeError("plan path is missing or unsafe")
        plan = read_json(path)
        work_item_id = plan.get("workItemId")
        if work_item_id in plans:
            raise RuntimeError("duplicate cleanup plan")
        plans[work_item_id] = plan
        canonical.update(verify_sealed_target(plan))
    acceptance_path = Path(args.acceptance_evidence)
    require_exact_file(
        acceptance_path, args.acceptance_evidence_sha256, "acceptance evidence"
    )
    acceptance = read_json(acceptance_path)
    if (
        acceptance.get("state") != "local-batch-accepted"
        or acceptance.get("canonicalFileCount") != len(canonical)
        or acceptance.get("deleteFileCount") != 0
    ):
        raise RuntimeError("acceptance evidence boundary changed")
    backup_path = Path(args.backup_evidence)
    require_exact_file(backup_path, args.backup_evidence_sha256, "backup evidence")
    backup = read_json(backup_path)
    rollback_root = Path(str(backup.get("rollbackRoot") or ""))
    require_child(rollback_root, ROLLBACK_PARENT, "rollback root")
    rollback_files, rollback_bytes = verify_rollback_hardlinks(
        backup, plans, rollback_root
    )
    source_roots = {
        work_item_id: Path(plan["execution"]["allowlists"]["localSourceRoot"])
        for work_item_id, plan in plans.items()
    }
    staging_roots = [
        Path(plan["execution"]["allowlists"]["localStagingRoot"])
        for plan in plans.values()
    ]
    for root in staging_roots:
        require_child(root, STAGING_PARENT, "local staging root")
        files, _directories = tree_entries(root)
        if files:
            raise RuntimeError("sealed local staging root is not empty")
    source_files = {}
    source_bytes = 0
    for work_item_id, root in source_roots.items():
        files, _directories = tree_entries(root)
        source_files[work_item_id] = files
        source_bytes += sum(path.stat().st_size for path in files)
        if any(path.suffix.lower() in {".mkv", ".mp4", ".avi", ".ts"} for path in files):
            raise RuntimeError("old source root still contains a video")
    acquisition_root = None
    acquisition_files = []
    archives = []
    if has_acquisition_bundle(
        args.acquisition_root, args.acquisition_archive_sha256
    ):
        acquisition_root = Path(args.acquisition_root)
        require_child(acquisition_root, STAGING_PARENT, "acquisition root")
        acquisition_files, _acquisition_directories = tree_entries(acquisition_root)
        archives = [path for path in acquisition_files if path.suffix.lower() == ".7z"]
        if len(archives) != 1:
            raise RuntimeError("acquisition root must contain exactly one source archive")
        require_exact_file(
            archives[0], args.acquisition_archive_sha256, "acquisition archive"
        )
        subprocess.run(
            ["7z", "t", os.fspath(archives[0])],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
    if len(args.discard_root) != len(args.discard_tree_sha256):
        raise RuntimeError("discard root and tree SHA counts must match")
    discard_roots = [Path(value) for value in args.discard_root]
    if len(discard_roots) != len(set(discard_roots)):
        raise RuntimeError("discard roots are duplicated")
    reserved_staging_roots = set(staging_roots)
    if acquisition_root is not None:
        reserved_staging_roots.add(acquisition_root)
    discard_trees = []
    for root, expected_digest in zip(
        discard_roots, args.discard_tree_sha256, strict=True
    ):
        require_child(root, STAGING_PARENT, "discard root")
        if root.parent != STAGING_PARENT or root in reserved_staging_roots:
            raise RuntimeError("discard root must be a distinct direct staging child")
        if re.fullmatch(r"[0-9a-f]{64}", expected_digest) is None:
            raise RuntimeError("discard tree SHA-256 is invalid")
        files, directories = tree_entries(root)
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError("discard root is missing or unsafe")
        actual_digest = tree_digest(root, files)
        if actual_digest != expected_digest:
            raise RuntimeError("discard tree SHA-256 changed")
        discard_trees.append((root, files, directories, actual_digest))
    retention_root = Path(args.retention_root)
    if not retention_root.is_absolute() or retention_root.exists() or retention_root.is_symlink():
        raise RuntimeError("retention root must be a new absolute path")
    preview = {
        "acquisitionFileCount": len(acquisition_files),
        "canonicalDeleteCount": 0,
        "canonicalFileCount": len(canonical),
        "cloudOperationCount": 0,
        "databaseDirectWrite": False,
        "discardFileCount": sum(len(files) for _root, files, _directories, _digest in discard_trees),
        "discardLogicalBytes": sum(
            path.stat().st_size
            for _root, files, _directories, _digest in discard_trees
            for path in files
        ),
        "discardRootCount": len(discard_trees),
        "discardTreeSha256": [digest for _root, _files, _directories, digest in discard_trees],
        "logicalRollbackBytes": rollback_bytes,
        "oldSourceFileCount": sum(len(files) for files in source_files.values()),
        "oldSourceLogicalBytes": source_bytes,
        "planCount": len(plans),
        "retainedFileCount": sum(len(files) for files in source_files.values())
        + len(archives),
        "rollbackHardlinkCount": len(rollback_files),
        "state": "cleanup-preflight-passed",
        "uiWrites": 0,
    }
    if not args.execute:
        print(json.dumps(preview, ensure_ascii=False, sort_keys=True))
        return
    if not args.output:
        raise RuntimeError("execute requires an output path")
    require_exact_file(
        Path(__file__).resolve(),
        os.environ.get("KT_SCRIPT_SHA256", ""),
        "batch cleanup script",
    )
    retained_input_count = sum(len(files) for files in source_files.values()) + len(archives)
    if retained_input_count:
        retention_root.mkdir(parents=True, mode=0o700)
    retained = []
    for work_item_id, files in source_files.items():
        root = source_roots[work_item_id]
        for source in files:
            relative = source.relative_to(root)
            info = copy_retained_file(
                source, retention_root / "legacy-source" / work_item_id / relative
            )
            retained.append(info)
    if archives:
        retained.append(
            copy_retained_file(
                archives[0],
                retention_root / "acquisition-archive" / archives[0].name,
            )
        )
    for work_item_id, root in source_roots.items():
        files, directories = tree_entries(root)
        remove_tree(root, files, directories)
    for root in staging_roots:
        files, directories = tree_entries(root)
        remove_tree(root, files, directories)
        prune_empty_ancestors(root.parent, STAGING_PARENT)
    if acquisition_root is not None:
        files, directories = tree_entries(acquisition_root)
        remove_tree(acquisition_root, files, directories)
        prune_empty_ancestors(acquisition_root.parent, STAGING_PARENT)
    for root, files, directories, _digest in discard_trees:
        remove_tree(root, files, directories)
    files, directories = tree_entries(rollback_root)
    remove_tree(rollback_root, files, directories)
    prune_empty_ancestors(rollback_root.parent, ROLLBACK_PARENT)
    for path_text, expected in canonical.items():
        path = Path(path_text)
        if (
            not path.is_file()
            or path.is_symlink()
            or path.stat().st_size != expected["size"]
            or path.stat().st_ino != expected["inode"]
        ):
            raise RuntimeError("canonical target changed during cleanup")
        digest = (
            bounded_sha256(path)
            if expected["method"] == VIDEO_METHOD
            else sha256(path)
        )
        if digest != expected["digest"]:
            raise RuntimeError("canonical target digest changed during cleanup")
    if any(
        root.exists()
        for root in [
            *source_roots.values(),
            *staging_roots,
            *([acquisition_root] if acquisition_root is not None else []),
            *discard_roots,
            rollback_root,
        ]
    ):
        raise RuntimeError("cleanup left an exact retired root present")
    output = {
        **preview,
        "canonicalFileCountAfter": len(canonical),
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cleanupUnlinkCount": len(rollback_files)
        + len(acquisition_files)
        + sum(len(files) for _root, files, _directories, _digest in discard_trees)
        + sum(len(files) for files in source_files.values()),
        "removedRootCount": len(source_roots)
        + len(staging_roots)
        + int(acquisition_root is not None)
        + len(discard_roots)
        + 1,
        "retentionRootCreated": retention_root.exists(),
        "retainedBytes": sum(row["size"] for row in retained),
        "retainedSha256Count": len(retained),
        "state": "post-acceptance-cleanup-complete",
    }
    write_json_once(Path(args.output), output)
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
