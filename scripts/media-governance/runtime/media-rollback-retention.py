#!/usr/bin/env python3
"""密封审计并精确删除已经完成的媒体治理 rollback 批次。"""

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


DEFAULT_EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
DEFAULT_MEDIA_ROOT = Path("/vol2/1000/Media")
DEFAULT_ROLLBACK_PARENT = Path("/vol2/1000/.kt-media-governance-rollback")
COMPLETED_STATES = {"local_reconciled", "reconciled"}
WORK_ITEM_PATTERN = re.compile(r"(?<![a-z0-9])(media-\d{3})(?!\d)", re.IGNORECASE)
CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
PROVIDER_ID_PATTERN = re.compile(r"\[(tmdbid|tvdbid)-([1-9]\d*)\]", re.IGNORECASE)
LEDGER_PROVIDER_PATTERN = re.compile(r"^(tmdb|tvdb):([1-9]\d*)$")
UTC_TIMESTAMP_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"
)
SCHEMA_VERSION = "media-rollback-retention-v1"


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_exclusive(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)


def verify_script_digest() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if expected and sha256_file(Path(__file__)) != expected:
        raise RuntimeError("script SHA-256 does not match the sealed release")


def validate_fixed_directory(
    path: Path,
    *,
    expected_gid: int,
    expected_uid: int,
    require_private_mode: bool,
) -> None:
    try:
        current = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"required directory is missing: {path}") from error
    if stat.S_ISLNK(current.st_mode) or not stat.S_ISDIR(current.st_mode):
        raise RuntimeError(f"required directory is unsafe: {path}")
    if current.st_uid != expected_uid or current.st_gid != expected_gid:
        raise RuntimeError(f"required directory ownership is unexpected: {path}")
    if require_private_mode and stat.S_IMODE(current.st_mode) != 0o700:
        raise RuntimeError(f"required directory mode is not 0700: {path}")


def load_completed_ledger(path: Path) -> tuple[dict[str, dict[str, str]], str, list[str]]:
    try:
        current = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"ledger is missing: {path}") from error
    if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
        raise RuntimeError("ledger is not a regular file")
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("ledger items are missing")
    records: dict[str, dict[str, str]] = {}
    unfinished: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            raise RuntimeError("ledger item is not an object")
        work_item = item.get("workItemId")
        state_value = item.get("inventoryState")
        metadata_identity = item.get("metadataIdentity")
        completed_at = (
            item.get("localReconciledAt")
            if state_value == "local_reconciled"
            else item.get("reconciledAt") if state_value == "reconciled" else ""
        )
        if (
            not isinstance(work_item, str)
            or re.fullmatch(r"media-\d{3}", work_item) is None
            or not isinstance(state_value, str)
            or work_item in records
            or not isinstance(metadata_identity, str)
            or LEDGER_PROVIDER_PATTERN.fullmatch(metadata_identity) is None
            or (
                state_value in COMPLETED_STATES
                and (
                    not isinstance(completed_at, str)
                    or UTC_TIMESTAMP_PATTERN.fullmatch(completed_at) is None
                )
            )
        ):
            raise RuntimeError("ledger item identity is invalid")
        records[work_item] = {
            "completedAt": completed_at,
            "metadataIdentity": metadata_identity,
            "state": state_value,
        }
        if state_value not in COMPLETED_STATES:
            unfinished.append(work_item)
    return records, sha256_file(path), sorted(unfinished)


def node_identity(relative_path: str, current: os.stat_result, kind: str) -> dict[str, Any]:
    return {
        "allocatedBytes": current.st_blocks * 512 if kind == "file" else 0,
        "device": current.st_dev,
        "inode": current.st_ino,
        "kind": kind,
        "linkCount": current.st_nlink,
        "mode": stat.S_IMODE(current.st_mode),
        "modifiedNs": current.st_mtime_ns,
        "path": relative_path,
        "size": current.st_size if kind == "file" else 0,
    }


def inventory_tree(root: Path) -> dict[str, Any]:
    try:
        root_stat = root.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"rollback entry disappeared during audit: {root.name}") from error
    nodes: list[dict[str, Any]] = []
    unsafe: list[str] = []
    work_items: set[str] = set(
        match.group(1).lower() for match in WORK_ITEM_PATTERN.finditer(root.name)
    )
    if CONTROL_PATTERN.search(root.name):
        unsafe.append("unsafe-name")
    if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
        unsafe.append("unsafe-top-level-entry")
        return {
            "allocatedBytes": 0,
            "digest": "",
            "directoryCount": 0,
            "fileCount": 0,
            "logicalBytes": 0,
            "nodes": nodes,
            "unsafe": sorted(set(unsafe)),
            "workItemIds": sorted(work_items),
        }

    pending = [root]
    while pending:
        directory = pending.pop()
        relative_directory = "." if directory == root else directory.relative_to(root).as_posix()
        current = directory.lstat()
        nodes.append(node_identity(relative_directory, current, "directory"))
        try:
            children = sorted(os.scandir(directory), key=lambda entry: entry.name)
        except OSError as error:
            raise RuntimeError(f"unable to inventory rollback entry {root.name}: {error}") from error
        directories: list[Path] = []
        for child in children:
            relative_path = Path(child.path).relative_to(root).as_posix()
            if CONTROL_PATTERN.search(child.name):
                unsafe.append("unsafe-name")
            work_items.update(
                match.group(1).lower()
                for match in WORK_ITEM_PATTERN.finditer(relative_path)
            )
            child_stat = os.lstat(child.path)
            if stat.S_ISLNK(child_stat.st_mode):
                unsafe.append("symlink")
            elif stat.S_ISDIR(child_stat.st_mode):
                directories.append(Path(child.path))
            elif stat.S_ISREG(child_stat.st_mode):
                nodes.append(node_identity(relative_path, child_stat, "file"))
            else:
                unsafe.append("special-node")
        pending.extend(reversed(directories))

    serialized = json.dumps(nodes, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    files = [row for row in nodes if row["kind"] == "file"]
    return {
        "allocatedBytes": sum(row["allocatedBytes"] for row in files),
        "digest": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
        "directoryCount": sum(row["kind"] == "directory" for row in nodes),
        "fileCount": len(files),
        "logicalBytes": sum(row["size"] for row in files),
        "nodes": nodes,
        "unsafe": sorted(set(unsafe)),
        "workItemIds": sorted(work_items),
    }


def canonical_snapshot(
    media_root: Path,
) -> tuple[dict[str, Any], set[tuple[int, int]], set[str]]:
    roots = [media_root / "movie/TV", media_root / "movie/Movies", media_root / "extras"]
    nodes: list[dict[str, Any]] = []
    inodes: set[tuple[int, int]] = set()
    provider_identities: set[str] = set()
    for fixed_root in roots:
        if not fixed_root.is_dir() or fixed_root.is_symlink():
            raise RuntimeError(f"canonical media root is unsafe: {fixed_root}")
        pending = [fixed_root]
        while pending:
            directory = pending.pop()
            relative_directory = directory.relative_to(media_root).as_posix()
            current = directory.lstat()
            nodes.append(node_identity(relative_directory, current, "directory"))
            children = sorted(os.scandir(directory), key=lambda entry: entry.name)
            directories: list[Path] = []
            for child in children:
                child_stat = os.lstat(child.path)
                relative_path = Path(child.path).relative_to(media_root).as_posix()
                if stat.S_ISLNK(child_stat.st_mode):
                    raise RuntimeError(f"canonical media contains a symlink: {relative_path}")
                if stat.S_ISDIR(child_stat.st_mode):
                    directories.append(Path(child.path))
                elif stat.S_ISREG(child_stat.st_mode):
                    row = node_identity(relative_path, child_stat, "file")
                    nodes.append(row)
                    inodes.add((row["device"], row["inode"]))
                else:
                    raise RuntimeError(f"canonical media contains a special node: {relative_path}")
            pending.extend(reversed(directories))
    for row in nodes:
        for match in PROVIDER_ID_PATTERN.finditer(row["path"]):
            provider_identities.add(
                f"{match.group(1).lower().removesuffix('id')}:{match.group(2)}"
            )
    serialized = json.dumps(nodes, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    files = [row for row in nodes if row["kind"] == "file"]
    return (
        {
            "digest": hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
            "directoryCount": sum(row["kind"] == "directory" for row in nodes),
            "fileCount": len(files),
            "logicalBytes": sum(row["size"] for row in files),
        },
        inodes,
        provider_identities,
    )


def accepted_work_items(evidence_root: Path, entry_name: str) -> list[str]:
    root = evidence_root / entry_name
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError(f"acceptance evidence root is unsafe: {entry_name}")
    accepted: set[str] = set()
    for directory, directories, files in os.walk(root, followlinks=False):
        safe_directories: list[str] = []
        for name in directories:
            candidate = Path(directory) / name
            if candidate.is_symlink():
                raise RuntimeError(f"acceptance evidence contains a symlink: {entry_name}")
            safe_directories.append(name)
        directories[:] = sorted(safe_directories)
        for name in sorted(files):
            if "acceptance" not in name.casefold() or not name.casefold().endswith(".json"):
                continue
            candidate = Path(directory) / name
            current = candidate.lstat()
            if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
                raise RuntimeError(f"acceptance evidence is unsafe: {candidate}")
            if current.st_size > 4 * 1024 * 1024:
                raise RuntimeError(f"acceptance evidence is unexpectedly large: {candidate}")
            payload = json.loads(candidate.read_text(encoding="utf-8"))
            if payload.get("state") != "local-batch-accepted":
                continue
            values = payload.get("workItemIds")
            if isinstance(values, list):
                accepted.update(
                    value
                    for value in values
                    if isinstance(value, str) and re.fullmatch(r"media-\d{3}", value)
                )
    return sorted(accepted)


def accepted_work_item_index(evidence_root: Path) -> set[str]:
    if evidence_root.is_symlink() or not evidence_root.is_dir():
        raise RuntimeError("fixed evidence root is unsafe")
    accepted: set[str] = set()
    for directory, directories, files in os.walk(evidence_root, followlinks=False):
        directories[:] = sorted(
            name
            for name in directories
            if not (Path(directory) / name).is_symlink()
        )
        for name in sorted(files):
            if "acceptance" not in name.casefold() or not name.casefold().endswith(".json"):
                continue
            candidate = Path(directory) / name
            try:
                current = candidate.lstat()
                if (
                    stat.S_ISLNK(current.st_mode)
                    or not stat.S_ISREG(current.st_mode)
                    or current.st_size > 4 * 1024 * 1024
                ):
                    continue
                payload = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            if payload.get("state") != "local-batch-accepted":
                continue
            values = payload.get("workItemIds")
            if isinstance(values, list):
                accepted.update(
                    value
                    for value in values
                    if isinstance(value, str) and re.fullmatch(r"media-\d{3}", value)
                )
    return accepted


def available_bytes(path: Path) -> int:
    current = os.statvfs(path)
    return current.f_bavail * current.f_frsize


def projected_reclaim_bytes(entries: list[dict[str, Any]]) -> int:
    observed: dict[tuple[int, int], dict[str, int]] = {}
    for entry in entries:
        if entry["eligibility"] == "ineligible":
            continue
        for node in entry["_inventory"]["nodes"]:
            if node["kind"] != "file":
                continue
            key = (node["device"], node["inode"])
            value = observed.setdefault(
                key,
                {
                    "allocatedBytes": node["allocatedBytes"],
                    "linkCount": node["linkCount"],
                    "observedLinks": 0,
                },
            )
            value["observedLinks"] += 1
    return sum(
        value["allocatedBytes"]
        for value in observed.values()
        if value["observedLinks"] >= value["linkCount"]
    )


def audit_rollback(
    *,
    evidence_root: Path,
    expected_entry_count: int,
    expected_gid: int,
    expected_uid: int,
    ledger_path: Path,
    media_root: Path,
    rollback_parent: Path,
) -> dict[str, Any]:
    if expected_entry_count < 0:
        raise RuntimeError("expected rollback entry count is invalid")
    validate_fixed_directory(
        rollback_parent,
        expected_gid=expected_gid,
        expected_uid=expected_uid,
        require_private_mode=True,
    )
    records, ledger_sha256, unfinished = load_completed_ledger(ledger_path)
    global_accepted = accepted_work_item_index(evidence_root)
    snapshot, canonical_inodes, canonical_identities = canonical_snapshot(media_root)
    top_entries = sorted(os.scandir(rollback_parent), key=lambda entry: entry.name)
    if len(top_entries) != expected_entry_count:
        raise RuntimeError(
            f"rollback entry count drift: expected {expected_entry_count}, got {len(top_entries)}"
        )
    blockers = ["ledger-has-unfinished-items"] if unfinished else []
    entries: list[dict[str, Any]] = []
    for directory_entry in top_entries:
        entry = Path(directory_entry.path)
        inventory = inventory_tree(entry)
        local_accepted = accepted_work_items(evidence_root, entry.name)
        work_items = sorted(set(inventory["workItemIds"]) | set(local_accepted))
        accepted = sorted(set(work_items) & global_accepted)
        files = [row for row in inventory["nodes"] if row["kind"] == "file"]
        all_canonical_hardlinks = bool(files) and all(
            (row["device"], row["inode"]) in canonical_inodes for row in files
        )
        reasons: list[str] = []
        if blockers:
            reasons.extend(blockers)
        if inventory["unsafe"]:
            reasons.append("unsafe-node")
        if work_items:
            if any(work_item not in records for work_item in work_items):
                reasons.append("unknown-work-item")
            if any(
                records.get(work_item, {}).get("state") not in COMPLETED_STATES
                for work_item in work_items
            ):
                reasons.append("unfinished-work-item")
            if any(
                records.get(work_item, {}).get("metadataIdentity")
                not in canonical_identities
                for work_item in work_items
            ):
                reasons.append("canonical-identity-missing")
            eligibility = (
                "completed-batch-accepted"
                if set(work_items).issubset(accepted)
                else "completed-ledger-canonical"
            )
        elif all_canonical_hardlinks:
            eligibility = "canonical-hardlink-redundant"
        else:
            reasons.append("unbound-unique-content")
            eligibility = "ineligible"
        if reasons:
            eligibility = "ineligible"
        entries.append(
            {
                "_inventory": inventory,
                "acceptedWorkItemIds": accepted,
                "allocatedBytes": inventory["allocatedBytes"],
                "digest": inventory["digest"],
                "directoryCount": inventory["directoryCount"],
                "eligibility": eligibility,
                "fileCount": inventory["fileCount"],
                "logicalBytes": inventory["logicalBytes"],
                "name": entry.name,
                "reasons": sorted(set(reasons)),
                "workItemIds": work_items,
            }
        )
    eligible = [row for row in entries if row["eligibility"] != "ineligible"]
    public_entries = [{key: value for key, value in row.items() if key != "_inventory"} for row in entries]
    return {
        "availableBytesBefore": available_bytes(rollback_parent),
        "blockers": blockers,
        "canonicalSnapshot": snapshot,
        "capturedAt": utc_now(),
        "eligibleEntryCount": len(eligible),
        "entries": public_entries,
        "expectedEntryCount": expected_entry_count,
        "ineligibleEntryCount": len(entries) - len(eligible),
        "ledgerSha256": ledger_sha256,
        "projectedReclaimBytes": projected_reclaim_bytes(entries),
        "rollbackEntryCount": len(entries),
        "schemaVersion": SCHEMA_VERSION,
        "state": "rollback-retention-audited",
        "unfinishedWorkItemIds": unfinished,
    }


def load_audit(path: Path, sha256: str) -> dict[str, Any]:
    if re.fullmatch(r"[0-9a-f]{64}", sha256) is None:
        raise RuntimeError("audit SHA-256 is invalid")
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("audit evidence is not a regular file")
    if sha256_file(path) != sha256:
        raise RuntimeError("audit evidence SHA-256 does not match")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != SCHEMA_VERSION or payload.get("state") != "rollback-retention-audited":
        raise RuntimeError("audit evidence schema or state is invalid")
    return payload


def delete_inventory(root: Path, inventory: dict[str, Any]) -> tuple[int, int]:
    files = [row for row in inventory["nodes"] if row["kind"] == "file"]
    directories = [row for row in inventory["nodes"] if row["kind"] == "directory"]
    for row in sorted(files, key=lambda value: value["path"]):
        path = root / row["path"]
        current = path.lstat()
        if (
            not stat.S_ISREG(current.st_mode)
            or current.st_dev != row["device"]
            or current.st_ino != row["inode"]
            or current.st_size != row["size"]
            or current.st_mtime_ns != row["modifiedNs"]
        ):
            raise RuntimeError(f"rollback file drift before unlink: {root.name}")
        path.unlink()
    for row in sorted(
        directories,
        key=lambda value: (value["path"].count("/"), value["path"]),
        reverse=True,
    ):
        path = root if row["path"] == "." else root / row["path"]
        current = path.lstat()
        if (
            not stat.S_ISDIR(current.st_mode)
            or stat.S_ISLNK(current.st_mode)
            or current.st_dev != row["device"]
            or current.st_ino != row["inode"]
        ):
            raise RuntimeError(f"rollback directory drift before removal: {root.name}")
        path.rmdir()
    return len(files), len(directories)


def cleanup_rollback(
    *,
    audit_path: Path,
    audit_sha256: str,
    evidence_root: Path,
    execute: bool,
    expected_entry_count: int,
    expected_gid: int,
    expected_uid: int,
    ledger_path: Path,
    media_root: Path,
    output_path: Path | None,
    rollback_parent: Path,
) -> dict[str, Any]:
    audit = load_audit(audit_path, audit_sha256)
    if audit.get("expectedEntryCount") != expected_entry_count:
        raise RuntimeError("audit expected entry count does not match cleanup request")
    if audit.get("ineligibleEntryCount", 0) < 0:
        raise RuntimeError("audit ineligible count is invalid")
    validate_fixed_directory(
        rollback_parent,
        expected_gid=expected_gid,
        expected_uid=expected_uid,
        require_private_mode=True,
    )
    records, ledger_sha256, unfinished = load_completed_ledger(ledger_path)
    if unfinished or ledger_sha256 != audit.get("ledgerSha256"):
        raise RuntimeError("ledger drift after rollback audit")
    snapshot_before, canonical_inodes, canonical_identities = canonical_snapshot(media_root)
    global_accepted = accepted_work_item_index(evidence_root)
    if snapshot_before != audit.get("canonicalSnapshot"):
        raise RuntimeError("canonical media drift after rollback audit")
    audit_entries = audit.get("entries")
    if not isinstance(audit_entries, list) or len(audit_entries) != expected_entry_count:
        raise RuntimeError("audit entry set is invalid")
    expected_by_name = {
        row.get("name"): row for row in audit_entries if isinstance(row, dict)
    }
    if len(expected_by_name) != expected_entry_count or not all(
        isinstance(name, str) for name in expected_by_name
    ):
        raise RuntimeError("audit entry identity is invalid")
    current_names = sorted(entry.name for entry in os.scandir(rollback_parent))
    if current_names != sorted(expected_by_name):
        raise RuntimeError("rollback top-level entry drift after audit")

    current_inventories: dict[str, dict[str, Any]] = {}
    for name in current_names:
        path = rollback_parent / name
        inventory = inventory_tree(path)
        local_accepted = accepted_work_items(evidence_root, name)
        work_items = sorted(set(inventory["workItemIds"]) | set(local_accepted))
        accepted = sorted(set(work_items) & global_accepted)
        files = [row for row in inventory["nodes"] if row["kind"] == "file"]
        hardlink_redundant = bool(files) and all(
            (row["device"], row["inode"]) in canonical_inodes for row in files
        )
        reasons: list[str] = []
        if inventory["unsafe"]:
            reasons.append("unsafe-node")
        if work_items:
            if any(work_item not in records for work_item in work_items):
                reasons.append("unknown-work-item")
            if any(
                records.get(work_item, {}).get("state") not in COMPLETED_STATES
                for work_item in work_items
            ):
                reasons.append("unfinished-work-item")
            if any(
                records.get(work_item, {}).get("metadataIdentity")
                not in canonical_identities
                for work_item in work_items
            ):
                reasons.append("canonical-identity-missing")
            eligibility = (
                "completed-batch-accepted"
                if set(work_items).issubset(accepted)
                else "completed-ledger-canonical"
            )
        elif hardlink_redundant:
            eligibility = "canonical-hardlink-redundant"
        else:
            reasons.append("unbound-unique-content")
            eligibility = "ineligible"
        if reasons:
            eligibility = "ineligible"
        expected = expected_by_name[name]
        comparable = {
            "acceptedWorkItemIds": accepted,
            "allocatedBytes": inventory["allocatedBytes"],
            "digest": inventory["digest"],
            "directoryCount": inventory["directoryCount"],
            "eligibility": eligibility,
            "fileCount": inventory["fileCount"],
            "logicalBytes": inventory["logicalBytes"],
            "name": name,
            "reasons": sorted(set(reasons)),
            "workItemIds": work_items,
        }
        if comparable != expected:
            raise RuntimeError(f"rollback entry drift after audit: {name}")
        current_inventories[name] = inventory

    targets = sorted(
        name
        for name, row in expected_by_name.items()
        if row.get("eligibility") != "ineligible"
    )
    before = available_bytes(rollback_parent)
    if not execute:
        return {
            "auditSha256": audit_sha256,
            "canonicalSnapshot": snapshot_before,
            "plannedEntries": targets,
            "plannedEntryCount": len(targets),
            "projectedReclaimBytes": audit.get("projectedReclaimBytes", 0),
            "remainingIneligibleEntries": sorted(set(current_names) - set(targets)),
            "schemaVersion": SCHEMA_VERSION,
            "state": "rollback-retention-cleanup-preview",
        }
    if output_path is None:
        raise RuntimeError("cleanup output is required for execution")

    removed_files = 0
    removed_directories = 0
    removed_logical_bytes = 0
    for name in targets:
        inventory = current_inventories[name]
        file_count, directory_count = delete_inventory(
            rollback_parent / name,
            inventory,
        )
        removed_files += file_count
        removed_directories += directory_count
        removed_logical_bytes += inventory["logicalBytes"]
    snapshot_after, _, _ = canonical_snapshot(media_root)
    if snapshot_after != snapshot_before:
        raise RuntimeError("canonical media changed during rollback cleanup")
    remaining = sorted(entry.name for entry in os.scandir(rollback_parent))
    after = available_bytes(rollback_parent)
    result = {
        "auditSha256": audit_sha256,
        "availableBytesAfter": after,
        "availableBytesBefore": before,
        "availableBytesDelta": after - before,
        "canonicalSnapshot": snapshot_after,
        "completedAt": utc_now(),
        "projectedReclaimBytes": audit.get("projectedReclaimBytes", 0),
        "remainingEntries": remaining,
        "remainingEntryCount": len(remaining),
        "removedDirectories": removed_directories,
        "removedEntries": targets,
        "removedEntryCount": len(targets),
        "removedFiles": removed_files,
        "removedLogicalBytes": removed_logical_bytes,
        "schemaVersion": SCHEMA_VERSION,
        "state": "rollback-retention-cleanup-complete",
    }
    write_json_exclusive(output_path, result)
    return result


def evidence_result_summary(payload: dict[str, Any], output: Path | None) -> dict[str, Any]:
    keys = (
        "availableBytesDelta",
        "eligibleEntryCount",
        "ineligibleEntryCount",
        "plannedEntryCount",
        "projectedReclaimBytes",
        "remainingEntryCount",
        "removedEntryCount",
        "removedLogicalBytes",
        "rollbackEntryCount",
        "state",
    )
    result = {key: payload[key] for key in keys if key in payload}
    if isinstance(payload.get("entries"), list):
        rows = [row for row in payload["entries"] if isinstance(row, dict)]
        reason_names: dict[str, list[str]] = {}
        for row in rows:
            for reason in row.get("reasons", []):
                if isinstance(reason, str) and isinstance(row.get("name"), str):
                    reason_names.setdefault(reason, []).append(row["name"])
        result["diagnostics"] = {
            "eligibleNames": sorted(
                row["name"]
                for row in rows
                if row.get("eligibility") != "ineligible"
                and isinstance(row.get("name"), str)
            ),
            "reasonNames": {
                reason: sorted(names) for reason, names in sorted(reason_names.items())
            },
        }
    if output is not None and output.is_file():
        result["evidencePath"] = os.fspath(output)
        result["evidenceSha256"] = sha256_file(output)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", choices=("audit", "cleanup"), required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--evidence-root", type=Path, default=DEFAULT_EVIDENCE_ROOT)
    parser.add_argument("--media-root", type=Path, default=DEFAULT_MEDIA_ROOT)
    parser.add_argument("--rollback-parent", type=Path, default=DEFAULT_ROLLBACK_PARENT)
    parser.add_argument("--expected-entry-count", type=int, required=True)
    parser.add_argument("--expected-uid", type=int, default=0)
    parser.add_argument("--expected-gid", type=int, default=0)
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--audit-sha256")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    verify_script_digest()
    if args.operation == "audit":
        if args.execute:
            raise RuntimeError("audit does not accept --execute")
        if args.output is None:
            raise RuntimeError("audit output is required")
        payload = audit_rollback(
            evidence_root=args.evidence_root,
            expected_entry_count=args.expected_entry_count,
            expected_gid=args.expected_gid,
            expected_uid=args.expected_uid,
            ledger_path=args.ledger,
            media_root=args.media_root,
            rollback_parent=args.rollback_parent,
        )
        write_json_exclusive(args.output, payload)
        print(json.dumps(evidence_result_summary(payload, args.output), ensure_ascii=False, sort_keys=True))
        return
    if args.audit is None or args.audit_sha256 is None:
        raise RuntimeError("cleanup audit evidence and SHA-256 are required")
    payload = cleanup_rollback(
        audit_path=args.audit,
        audit_sha256=args.audit_sha256,
        evidence_root=args.evidence_root,
        execute=args.execute,
        expected_entry_count=args.expected_entry_count,
        expected_gid=args.expected_gid,
        expected_uid=args.expected_uid,
        ledger_path=args.ledger,
        media_root=args.media_root,
        output_path=args.output,
        rollback_parent=args.rollback_parent,
    )
    print(json.dumps(evidence_result_summary(payload, args.output), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - 远端入口必须输出单一失败原因。
        print(json.dumps({"error": str(error), "state": "rollback-retention-failed"}, ensure_ascii=False, sort_keys=True))
        sys.exit(1)
