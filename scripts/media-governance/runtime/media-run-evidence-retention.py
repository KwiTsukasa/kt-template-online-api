#!/usr/bin/env python3
"""盘点、审计、压缩并精确清理已关闭媒体 Run 的过期诊断证据。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from typing import Any


DEFAULT_EVIDENCE_ROOT = Path("/vol1/docker/kt-codex/artifacts/automation/media")
SCHEMA_VERSION = "media-run-evidence-retention-v1"
AUDIT_STATE = "run-evidence-retention-audited"
INVENTORY_STATE = "run-evidence-retention-inventory"
COMPRESSION_SECONDS = 7 * 24 * 60 * 60
RETENTION_SECONDS = 180 * 24 * 60 * 60
COMPRESSION_SCHEMA_VERSION = "media-run-evidence-compression-v1"
CLEANUP_SCHEMA_VERSION = "media-run-evidence-cleanup-v1"
COMPRESSION_ARCHIVE_NAME = "diagnostics-progress.zip"
COMPRESSION_RECEIPT_NAME = "compression.json"
CLEANUP_RECEIPT_NAME = "cleanup.json"
RETENTION_STATE_ROOT = ".retention"
IDENTITY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$")
RUN_DIRECTORY_PATTERN = re.compile(r"^media-run-[A-Za-z0-9._-]{1,85}$")
DIGEST_PATTERN = re.compile(r"^[0-9a-f]{64}$")
CLEANABLE_CLASSES = {"diagnostic", "high-frequency-progress"}
LONG_TERM_CLASS = "long-term"
REQUIRED_LONG_TERM = {
    "events.ndjson": "semantic-events",
    "report.json": "final-report-json",
    "report.html": "final-report-html",
    "evidence/plan-summary.json": "plan-summary",
    "evidence/journal-summary.json": "journal-summary",
    "evidence/tombstone.json": "tombstone",
}
CLEANABLE_PREFIXES = ("diagnostics/", "raw-progress/")
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
MAX_INVENTORY_RUNS = 1_000


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def parse_timestamp(value: object, field: str) -> datetime.datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise RuntimeError(f"{field} must be an RFC3339 UTC timestamp")
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError(f"{field} must be an RFC3339 UTC timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() != datetime.timedelta(0):
        raise RuntimeError(f"{field} must be an RFC3339 UTC timestamp")
    return parsed


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_script_digest() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if expected and sha256_file(Path(__file__)) != expected:
        raise RuntimeError("script SHA-256 does not match the sealed release")


def safe_relative_path(value: object) -> str:
    if not isinstance(value, str) or not value or len(value) > 500:
        raise RuntimeError("manifest file path is invalid")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or any(part in {"", ".", ".."} for part in candidate.parts):
        raise RuntimeError(f"manifest file path is unsafe: {value}")
    return candidate.as_posix()


def validate_root(evidence_root: Path, target_run_id: str) -> Path:
    if IDENTITY_PATTERN.fullmatch(target_run_id) is None:
        raise RuntimeError("target run ID is invalid")
    if evidence_root.is_symlink() or not evidence_root.is_dir():
        raise RuntimeError("fixed evidence root is unsafe")
    root = evidence_root.resolve(strict=True)
    target = root / target_run_id
    if target.is_symlink() or not target.is_dir() or target.resolve(strict=True).parent != root:
        raise RuntimeError("target run directory is unsafe")
    if target.stat().st_mode & 0o022:
        raise RuntimeError("target run directory must not be group/world writable")
    return target


def inventory_tree(target: Path) -> dict[str, dict[str, Any]]:
    inventory: dict[str, dict[str, Any]] = {}
    for directory, directories, files in os.walk(target, followlinks=False):
        base = Path(directory)
        for name in sorted(directories):
            child = base / name
            info = child.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise RuntimeError(f"run evidence contains an unsafe directory: {child.relative_to(target)}")
        for name in sorted(files):
            child = base / name
            info = child.lstat()
            relative = child.relative_to(target).as_posix()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise RuntimeError(f"run evidence contains an unsafe file: {relative}")
            inventory[relative] = {
                "device": info.st_dev,
                "inode": info.st_ino,
                "modifiedNs": info.st_mtime_ns,
                "linkCount": info.st_nlink,
                "mode": stat.S_IMODE(info.st_mode),
                "sha256": sha256_file(child),
                "size": info.st_size,
            }
    return inventory


def normalized_files(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("files")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("manifest files must be a non-empty array")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for value in rows:
        if not isinstance(value, dict):
            raise RuntimeError("manifest file entry is invalid")
        relative = safe_relative_path(value.get("path"))
        if relative == "manifest.json" or relative in seen:
            raise RuntimeError(f"manifest file identity is duplicated: {relative}")
        seen.add(relative)
        retention_class = value.get("retentionClass")
        role = value.get("artifactRole")
        size = value.get("size")
        digest = value.get("sha256")
        if retention_class not in {LONG_TERM_CLASS, *CLEANABLE_CLASSES}:
            raise RuntimeError(f"manifest retention class is invalid: {relative}")
        if not isinstance(role, str) or not role or len(role) > 80:
            raise RuntimeError(f"manifest artifact role is invalid: {relative}")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise RuntimeError(f"manifest file size is invalid: {relative}")
        if not isinstance(digest, str) or DIGEST_PATTERN.fullmatch(digest) is None:
            raise RuntimeError(f"manifest file SHA-256 is invalid: {relative}")
        if retention_class in CLEANABLE_CLASSES and not relative.startswith(CLEANABLE_PREFIXES):
            raise RuntimeError(f"cleanable evidence path is outside fixed prefixes: {relative}")
        if relative.startswith(("diagnostics/", "raw-progress/")) and retention_class not in CLEANABLE_CLASSES:
            raise RuntimeError(f"ephemeral evidence path has an invalid class: {relative}")
        if relative.startswith("evidence/") and retention_class != LONG_TERM_CLASS:
            raise RuntimeError(f"sealed evidence cannot be cleanable: {relative}")
        normalized.append(
            {
                "artifactRole": role,
                "path": relative,
                "retentionClass": retention_class,
                "sha256": digest,
                "size": size,
            }
        )
    for relative, role in REQUIRED_LONG_TERM.items():
        matches = [row for row in normalized if row["path"] == relative]
        if len(matches) != 1 or matches[0]["retentionClass"] != LONG_TERM_CLASS or matches[0]["artifactRole"] != role:
            raise RuntimeError(f"required long-term evidence is missing or misclassified: {relative}")
    return sorted(normalized, key=lambda row: row["path"])


def sealed_tree_digest(manifest_sha256: str, files: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    digest.update(f"manifest.json\0{manifest_sha256}\n".encode())
    for row in files:
        digest.update(
            (
                f"{row['path']}\0{row['sha256']}\0{row['size']}\0"
                f"{row['retentionClass']}\0{row['artifactRole']}\n"
            ).encode()
        )
    return digest.hexdigest()


def cleanable_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [row for row in files if row["retentionClass"] in CLEANABLE_CLASSES]


def compression_sources(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "artifactRole": row["artifactRole"],
            "path": row["path"],
            "retentionClass": row["retentionClass"],
            "sha256": row["sha256"],
            "size": row["size"],
        }
        for row in cleanable_files(files)
    ]


def verify_compression_archive(path: Path, sources: list[dict[str, Any]]) -> None:
    expected = {row["path"]: row for row in sources}
    try:
        with zipfile.ZipFile(path, "r") as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if names != sorted(expected) or len(names) != len(set(names)):
                raise RuntimeError("compression archive file identity is invalid")
            for entry in entries:
                row = expected[entry.filename]
                mode = (entry.external_attr >> 16) & 0o777
                if (
                    entry.is_dir()
                    or entry.date_time != ZIP_TIMESTAMP
                    or entry.compress_type != zipfile.ZIP_DEFLATED
                    or mode != 0o400
                ):
                    raise RuntimeError("compression archive metadata is invalid")
                digest = hashlib.sha256()
                size = 0
                with archive.open(entry, "r") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                        size += len(chunk)
                if size != row["size"] or digest.hexdigest() != row["sha256"]:
                    raise RuntimeError(f"compression archive content drift: {entry.filename}")
    except (KeyError, zipfile.BadZipFile) as error:
        raise RuntimeError("compression archive is invalid") from error


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"{label} is invalid") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label} is invalid")
    return payload


def read_retention_state(
    *,
    evidence_root: Path,
    files: list[dict[str, Any]],
    manifest_sha256: str,
    target_run_id: str,
) -> dict[str, Any]:
    root = evidence_root.resolve(strict=True)
    retention_root = root / RETENTION_STATE_ROOT
    if not retention_root.exists():
        return {"artifacts": {}, "directory": os.fspath(retention_root / target_run_id), "state": "hot"}
    if (
        retention_root.is_symlink()
        or not retention_root.is_dir()
        or stat.S_IMODE(retention_root.stat().st_mode) != 0o700
    ):
        raise RuntimeError("retention state root is unsafe")
    retention_root = retention_root.resolve(strict=True)
    state_root = retention_root / target_run_id
    if not state_root.exists():
        return {"artifacts": {}, "directory": os.fspath(state_root), "state": "hot"}
    if (
        state_root.is_symlink()
        or not state_root.is_dir()
        or state_root.resolve(strict=True).parent != retention_root
        or stat.S_IMODE(state_root.stat().st_mode) != 0o700
    ):
        raise RuntimeError("retention state directory is unsafe")
    state_root = state_root.resolve(strict=True)
    inventory = inventory_tree(state_root)
    allowed = {
        COMPRESSION_ARCHIVE_NAME,
        COMPRESSION_RECEIPT_NAME,
        CLEANUP_RECEIPT_NAME,
    }
    if not set(inventory).issubset(allowed):
        raise RuntimeError("retention state contains an unknown artifact")
    if COMPRESSION_RECEIPT_NAME not in inventory:
        raise RuntimeError("retention compression receipt is missing")
    if inventory[COMPRESSION_RECEIPT_NAME]["mode"] != 0o600:
        raise RuntimeError("retention compression receipt mode is invalid")
    receipt_path = state_root / COMPRESSION_RECEIPT_NAME
    receipt = read_json_object(receipt_path, "retention compression receipt")
    sources = compression_sources(files)
    if (
        receipt.get("schemaVersion") != COMPRESSION_SCHEMA_VERSION
        or receipt.get("state") != "run-evidence-compression-complete"
        or receipt.get("archiveFormat") != "deterministic-zip-v1"
        or receipt.get("targetRunId") != target_run_id
        or receipt.get("manifestSha256") != manifest_sha256
        or receipt.get("sources") != sources
    ):
        raise RuntimeError("retention compression receipt identity is invalid")
    archive = receipt.get("archive")
    if not isinstance(archive, dict) or archive.get("path") != COMPRESSION_ARCHIVE_NAME:
        raise RuntimeError("retention compression archive identity is invalid")
    archive_sha256 = archive.get("sha256")
    archive_size = archive.get("size")
    if (
        not isinstance(archive_sha256, str)
        or DIGEST_PATTERN.fullmatch(archive_sha256) is None
        or not isinstance(archive_size, int)
        or isinstance(archive_size, bool)
        or archive_size < 0
    ):
        raise RuntimeError("retention compression archive identity is invalid")
    archive_present = COMPRESSION_ARCHIVE_NAME in inventory
    if archive_present:
        archive_path = state_root / COMPRESSION_ARCHIVE_NAME
        if (
            inventory[COMPRESSION_ARCHIVE_NAME]["sha256"] != archive_sha256
            or inventory[COMPRESSION_ARCHIVE_NAME]["size"] != archive_size
            or inventory[COMPRESSION_ARCHIVE_NAME]["linkCount"] != 1
            or inventory[COMPRESSION_ARCHIVE_NAME]["mode"] != 0o400
        ):
            raise RuntimeError("retention compression archive drift")
        verify_compression_archive(archive_path, sources)
    cleanup_present = CLEANUP_RECEIPT_NAME in inventory
    if cleanup_present:
        if inventory[CLEANUP_RECEIPT_NAME]["mode"] != 0o600:
            raise RuntimeError("retention cleanup receipt mode is invalid")
        cleanup = read_json_object(state_root / CLEANUP_RECEIPT_NAME, "retention cleanup receipt")
        if (
            cleanup.get("schemaVersion") != CLEANUP_SCHEMA_VERSION
            or cleanup.get("state") != "run-evidence-cleanup-committed"
            or cleanup.get("targetRunId") != target_run_id
            or cleanup.get("manifestSha256") != manifest_sha256
            or cleanup.get("archiveSha256") != archive_sha256
            or cleanup.get("compressionReceiptSha256") != inventory[COMPRESSION_RECEIPT_NAME]["sha256"]
        ):
            raise RuntimeError("retention cleanup receipt identity is invalid")
    elif not archive_present:
        raise RuntimeError("retention compression archive is missing")
    state = "cleanup-committed" if cleanup_present and archive_present else "cleaned" if cleanup_present else "compressed"
    return {
        "archivePath": os.fspath(state_root / COMPRESSION_ARCHIVE_NAME),
        "artifacts": inventory,
        "directory": os.fspath(state_root),
        "receipt": receipt,
        "state": state,
    }


def load_manifest(
    *,
    evidence_root: Path,
    manifest_sha256: str,
    target_run_id: str,
) -> tuple[
    Path,
    dict[str, Any],
    list[dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, Any],
]:
    if DIGEST_PATTERN.fullmatch(manifest_sha256) is None:
        raise RuntimeError("manifest SHA-256 is invalid")
    target = validate_root(evidence_root, target_run_id)
    manifest = target / "manifest.json"
    if manifest.is_symlink() or not manifest.is_file() or sha256_file(manifest) != manifest_sha256:
        raise RuntimeError("manifest is missing, unsafe, or does not match SHA-256")
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("manifest schema version is invalid")
    if payload.get("runId") != target_run_id or IDENTITY_PATTERN.fullmatch(str(payload.get("taskId", ""))) is None:
        raise RuntimeError("manifest Task/Run identity is invalid")
    parse_timestamp(payload.get("closedAt"), "closedAt")
    parse_timestamp(payload.get("sealedAt"), "sealedAt")
    sequence = payload.get("sequenceSeal")
    if not isinstance(sequence, dict):
        raise RuntimeError("manifest sequence seal is invalid")
    first, last, count = sequence.get("first"), sequence.get("last"), sequence.get("count")
    if not all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in (first, last, count)):
        raise RuntimeError("manifest sequence seal is invalid")
    if first > last or count > last - first + 1:
        raise RuntimeError("manifest sequence seal is inconsistent")
    files = normalized_files(payload)
    inventory = inventory_tree(target)
    expected_paths = {"manifest.json", *(row["path"] for row in files)}
    if not set(inventory).issubset(expected_paths):
        raise RuntimeError("run evidence tree gained an unsealed file")
    cleanable_paths = {row["path"] for row in cleanable_files(files)}
    protected_paths = expected_paths - cleanable_paths
    if not protected_paths.issubset(inventory):
        raise RuntimeError("protected run evidence is missing")
    for row in files:
        if row["path"] not in inventory:
            continue
        current = inventory[row["path"]]
        if current["size"] != row["size"] or current["sha256"] != row["sha256"]:
            raise RuntimeError(f"run evidence does not match the sealed manifest: {row['path']}")
    retention = read_retention_state(
        evidence_root=evidence_root,
        files=files,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    missing_cleanable = cleanable_paths - set(inventory)
    if retention["state"] == "hot" and missing_cleanable:
        raise RuntimeError("cleanable run evidence is missing without a retention transition")
    if retention["state"] in {"cleanup-committed", "cleaned"} and missing_cleanable != cleanable_paths:
        raise RuntimeError("cleaned retention state still has original candidates")
    if retention["state"] == "compressed" and missing_cleanable != cleanable_paths:
        retention = {**retention, "state": "compression-committed"}
    return target, payload, files, inventory, retention


def audit_run(
    *,
    as_of: str,
    evidence_root: Path,
    manifest_sha256: str,
    target_run_id: str,
) -> dict[str, Any]:
    target, manifest, files, inventory, retention = load_manifest(
        evidence_root=evidence_root,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    observed = parse_timestamp(as_of, "asOf")
    closed = parse_timestamp(manifest["closedAt"], "closedAt")
    if observed < closed:
        raise RuntimeError("asOf precedes closedAt")
    common_blockers: list[str] = []
    if manifest.get("taskStage") != "closed":
        common_blockers.append("task-not-closed")
    if manifest.get("runState") not in {"failed", "succeeded"}:
        common_blockers.append("run-not-terminal")
    if manifest.get("activeRunId") is not None:
        common_blockers.append("active-run-present")
    if manifest.get("recoveryActive") is not False:
        common_blockers.append("recovery-active")
    age_seconds = int((observed - closed).total_seconds())
    cleanable = cleanable_files(files)
    if any(
        inventory[row["path"]]["linkCount"] != 1
        for row in cleanable
        if row["path"] in inventory
    ):
        common_blockers.append("cleanable-hardlink")

    compression_blockers = list(common_blockers)
    if age_seconds < COMPRESSION_SECONDS:
        compression_blockers.append("compression-window-open")
    if age_seconds >= RETENTION_SECONDS:
        compression_blockers.append("cleanup-window-reached")
    if retention["state"] != "hot":
        compression_blockers.append(
            "compression-incomplete"
            if retention["state"] == "compression-committed"
            else "already-compressed"
        )
    compression_eligible = not compression_blockers
    compression_candidates = cleanable if compression_eligible else []

    blockers = list(common_blockers)
    if age_seconds < RETENTION_SECONDS:
        blockers.append("retention-window-open")
    if retention["state"] in {"compression-committed", "cleanup-committed"}:
        blockers.append("retention-transition-incomplete")
    eligible = not blockers
    candidate_kind = "compressed-archive" if retention["state"] == "compressed" else "original-files"
    if not eligible or retention["state"] == "cleaned":
        candidate_paths: list[str] = []
    elif candidate_kind == "compressed-archive":
        candidate_paths = [
            f"{RETENTION_STATE_ROOT}/{target_run_id}/{COMPRESSION_ARCHIVE_NAME}"
        ]
    else:
        candidate_paths = [row["path"] for row in cleanable]
    sealed_files = []
    for row in files:
        identity = inventory.get(row["path"])
        sealed_files.append(
            {**row, "present": identity is not None, **(identity or {})}
        )
    manifest_identity = inventory["manifest.json"]
    return {
        "asOf": as_of,
        "blockers": blockers,
        "candidateCount": len(candidate_paths),
        "candidateKind": candidate_kind,
        "candidatePaths": candidate_paths,
        "capturedAt": utc_now(),
        "compressionBlockers": compression_blockers,
        "compressionCandidateCount": len(compression_candidates),
        "compressionCandidatePaths": [row["path"] for row in compression_candidates],
        "compressionEligible": compression_eligible,
        "eligible": eligible,
        "manifestIdentity": manifest_identity,
        "manifestSha256": manifest_sha256,
        "protectedFileCount": len(files) - len(candidate_paths) + 1,
        "retentionAgeDays": age_seconds // (24 * 60 * 60),
        "retentionArtifacts": retention["artifacts"],
        "retentionState": retention["state"],
        "schemaVersion": SCHEMA_VERSION,
        "sealedFiles": sealed_files,
        "sealedTreeSha256": sealed_tree_digest(manifest_sha256, files),
        "state": AUDIT_STATE,
        "targetRunId": target_run_id,
        "targetRunPath": os.fspath(target),
        "transitionBlockers": common_blockers,
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "formalMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def inventory_runs(
    *,
    as_of: str,
    evidence_root: Path,
    target_run_id: str | None = None,
) -> dict[str, Any]:
    parse_timestamp(as_of, "asOf")
    if evidence_root.is_symlink() or not evidence_root.is_dir():
        raise RuntimeError("fixed evidence root is unsafe")
    root = evidence_root.resolve(strict=True)
    manifest_roots: list[Path] = []
    ignored_directory_count = 0
    unsealed_run_directory_count = 0
    unsafe_entry_count = 0
    for candidate in sorted(root.iterdir(), key=lambda value: value.name):
        if candidate.name == RETENTION_STATE_ROOT:
            continue
        if candidate.is_symlink() or not candidate.is_dir():
            unsafe_entry_count += 1
            continue
        if RUN_DIRECTORY_PATTERN.fullmatch(candidate.name) is None:
            ignored_directory_count += 1
            continue
        manifest = candidate / "manifest.json"
        if manifest.exists() or manifest.is_symlink():
            manifest_roots.append(candidate)
        else:
            unsealed_run_directory_count += 1
    if len(manifest_roots) + unsealed_run_directory_count > MAX_INVENTORY_RUNS:
        raise RuntimeError("run evidence inventory exceeds the fixed run limit")
    if target_run_id is not None:
        if RUN_DIRECTORY_PATTERN.fullmatch(target_run_id) is None:
            raise RuntimeError("inventory target Run ID is invalid")
        if target_run_id not in {candidate.name for candidate in manifest_roots}:
            raise RuntimeError("inventory target Run manifest is missing")

    actionable: list[dict[str, Any]] = []
    invalid: list[dict[str, str]] = []
    state_counts: dict[str, int] = {}
    audit_eligible_count = 0
    compression_eligible_count = 0
    cleanup_eligible_count = 0
    valid_count = 0
    target_run: dict[str, Any] | None = None
    for candidate in manifest_roots:
        candidate_run_id = candidate.name
        try:
            manifest_path = candidate / "manifest.json"
            if manifest_path.is_symlink() or not manifest_path.is_file():
                raise RuntimeError("manifest is missing or unsafe")
            manifest_sha256 = sha256_file(manifest_path)
            audit = audit_run(
                as_of=as_of,
                evidence_root=root,
                manifest_sha256=manifest_sha256,
                target_run_id=candidate_run_id,
            )
            manifest = read_json_object(manifest_path, "run evidence manifest")
        except Exception as error:  # noqa: BLE001 - 单项失效必须被有界汇总。
            invalid.append(
                {
                    "reason": str(error)[:200],
                    "targetRunId": candidate_run_id,
                }
            )
            continue
        valid_count += 1
        retention_state = str(audit["retentionState"])
        state_counts[retention_state] = state_counts.get(retention_state, 0) + 1
        audit_eligible = audit["transitionBlockers"] == []
        compression_eligible = audit["compressionEligible"] is True
        cleanup_eligible = audit["eligible"] is True
        audit_eligible_count += int(audit_eligible)
        compression_eligible_count += int(compression_eligible)
        cleanup_eligible_count += int(cleanup_eligible)
        if target_run_id is not None and target_run_id == candidate_run_id:
            events_path = candidate / "events.ndjson"
            if (
                events_path.is_symlink()
                or not events_path.is_file()
                or events_path.stat().st_size <= 0
                or events_path.stat().st_size > 64 * 1024 * 1024
            ):
                raise RuntimeError("inventory target terminal event stream is unsafe")
            try:
                events = [
                    json.loads(line)
                    for line in events_path.read_text(encoding="utf-8").splitlines()
                    if line
                ]
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise RuntimeError("inventory target terminal event stream is invalid") from error
            terminal = events[-1] if events else None
            sequence = manifest.get("sequenceSeal")
            if (
                not isinstance(terminal, dict)
                or terminal.get("eventType") not in {"run-failed", "run-succeeded"}
                or terminal.get("runId") != candidate_run_id
                or terminal.get("taskId") != manifest.get("taskId")
                or terminal.get("sequence") != sequence.get("last")
            ):
                raise RuntimeError("inventory target terminal event identity is invalid")
            terminal_bytes = (
                json.dumps(
                    terminal,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                )
                + "\n"
            ).encode("utf-8")
            if hashlib.sha256(terminal_bytes).hexdigest() != manifest.get(
                "terminalEventSha256"
            ):
                raise RuntimeError("inventory target terminal event SHA-256 drift")
            target_run = {
                "activeRunId": manifest.get("activeRunId"),
                "manifestSha256": manifest_sha256,
                "recoveryActive": manifest.get("recoveryActive"),
                "retentionState": retention_state,
                "runId": candidate_run_id,
                "runState": manifest.get("runState"),
                "sealedInputSha256": manifest.get("sealedInputSha256"),
                "sequenceSeal": sequence,
                "taskId": manifest.get("taskId"),
                "taskStage": manifest.get("taskStage"),
                "terminalEvent": {
                    key: terminal[key]
                    for key in (
                        "action",
                        "evidenceSha256",
                        "eventType",
                        "observedAt",
                        "runId",
                        "sequence",
                        "summary",
                        "taskId",
                        "taskRevision",
                    )
                    if key in terminal
                },
                "terminalEventSha256": manifest.get("terminalEventSha256"),
            }
        if compression_eligible or cleanup_eligible:
            actionable.append(
                {
                    "activeRunId": manifest.get("activeRunId"),
                    "auditEligible": audit_eligible,
                    "cleanupCandidateCount": audit["candidateCount"],
                    "cleanupEligible": cleanup_eligible,
                    "compressionCandidateCount": audit["compressionCandidateCount"],
                    "compressionEligible": compression_eligible,
                    "manifestSha256": manifest_sha256,
                    "recoveryActive": manifest.get("recoveryActive"),
                    "retentionAgeDays": audit["retentionAgeDays"],
                    "retentionState": retention_state,
                    "runState": manifest.get("runState"),
                    "targetRunId": candidate_run_id,
                    "taskId": manifest.get("taskId"),
                    "taskStage": manifest.get("taskStage"),
                }
            )
    if target_run_id is not None and target_run is None:
        raise RuntimeError("inventory target Run is invalid")
    return {
        "actionableRuns": actionable,
        "asOf": as_of,
        "auditEligibleRunCount": audit_eligible_count,
        "capturedAt": utc_now(),
        "cleanupEligibleRunCount": cleanup_eligible_count,
        "compressionEligibleRunCount": compression_eligible_count,
        "invalidRunCount": len(invalid),
        "invalidRuns": invalid,
        "ignoredDirectoryCount": ignored_directory_count,
        "manifestRunCount": len(manifest_roots),
        "retentionStateCounts": state_counts,
        "schemaVersion": SCHEMA_VERSION,
        "state": INVENTORY_STATE,
        **({"targetRun": target_run} if target_run is not None else {}),
        "unsealedRunDirectoryCount": unsealed_run_directory_count,
        "unsafeEntryCount": unsafe_entry_count,
        "validRunCount": valid_count,
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "evidence": 0,
            "formalMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def write_json_exclusive(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)


def validate_output_path(evidence_root: Path, target: Path, output: Path) -> None:
    if not output.is_absolute() or output.exists() or output.is_symlink():
        raise RuntimeError("retention output path must be a new absolute file")
    if output.parent.is_symlink() or not output.parent.is_dir():
        raise RuntimeError("retention output parent is unsafe")
    root = evidence_root.resolve(strict=True)
    parent = output.parent.resolve(strict=True)
    if output.parent.absolute() != parent or not parent.is_relative_to(root) or parent.is_relative_to(target):
        raise RuntimeError("retention output must stay outside the target run under the evidence root")


def load_audit(path: Path, sha256: str) -> dict[str, Any]:
    if DIGEST_PATTERN.fullmatch(sha256) is None:
        raise RuntimeError("audit SHA-256 is invalid")
    if path.is_symlink() or not path.is_file() or sha256_file(path) != sha256:
        raise RuntimeError("audit evidence is missing, unsafe, or does not match SHA-256")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION or payload.get("state") != AUDIT_STATE:
        raise RuntimeError("audit evidence schema or state is invalid")
    return payload


def ensure_retention_state_root(evidence_root: Path) -> Path:
    root = evidence_root.resolve(strict=True)
    retention_root = root / RETENTION_STATE_ROOT
    if not retention_root.exists():
        retention_root.mkdir(mode=0o700)
    if (
        retention_root.is_symlink()
        or not retention_root.is_dir()
        or retention_root.resolve(strict=True).parent != root
        or stat.S_IMODE(retention_root.stat().st_mode) != 0o700
    ):
        raise RuntimeError("retention state root is unsafe")
    return retention_root.resolve(strict=True)


def build_compression_archive(
    *,
    archive_path: Path,
    sources: list[dict[str, Any]],
    target: Path,
) -> None:
    with zipfile.ZipFile(
        archive_path,
        "x",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for row in sources:
            info = zipfile.ZipInfo(row["path"], ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o400) << 16
            with (target / row["path"]).open("rb") as source_handle:
                with archive.open(info, "w", force_zip64=True) as archive_handle:
                    for chunk in iter(lambda: source_handle.read(1024 * 1024), b""):
                        archive_handle.write(chunk)
    archive_path.chmod(0o400)
    with archive_path.open("rb") as handle:
        os.fsync(handle.fileno())
    verify_compression_archive(archive_path, sources)


def publish_compression_state(
    *,
    evidence_root: Path,
    files: list[dict[str, Any]],
    manifest_sha256: str,
    target: Path,
    target_run_id: str,
) -> dict[str, Any]:
    retention_root = ensure_retention_state_root(evidence_root)
    state_root = retention_root / target_run_id
    if state_root.exists():
        return read_retention_state(
            evidence_root=evidence_root,
            files=files,
            manifest_sha256=manifest_sha256,
            target_run_id=target_run_id,
        )
    temporary = Path(tempfile.mkdtemp(prefix=f".{target_run_id}.tmp-", dir=retention_root))
    temporary.chmod(0o700)
    try:
        sources = compression_sources(files)
        archive_path = temporary / COMPRESSION_ARCHIVE_NAME
        build_compression_archive(
            archive_path=archive_path,
            sources=sources,
            target=target,
        )
        receipt = {
            "archive": {
                "path": COMPRESSION_ARCHIVE_NAME,
                "sha256": sha256_file(archive_path),
                "size": archive_path.stat().st_size,
            },
            "archiveFormat": "deterministic-zip-v1",
            "compressedAt": utc_now(),
            "manifestSha256": manifest_sha256,
            "schemaVersion": COMPRESSION_SCHEMA_VERSION,
            "sources": sources,
            "state": "run-evidence-compression-complete",
            "targetRunId": target_run_id,
            "writeBoundaries": {
                "cloud": 0,
                "databaseDirect": 0,
                "formalMedia": 0,
                "mechanicalScan": 0,
                "ui": 0,
            },
        }
        write_json_exclusive(temporary / COMPRESSION_RECEIPT_NAME, receipt)
        os.rename(temporary, state_root)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return read_retention_state(
        evidence_root=evidence_root,
        files=files,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )


def compress_run(
    *,
    audit_path: Path,
    audit_sha256: str,
    evidence_root: Path,
    execute: bool,
    expected_candidate_count: int,
    manifest_sha256: str,
    output_path: Path | None,
    target_run_id: str,
) -> dict[str, Any]:
    audit = load_audit(audit_path, audit_sha256)
    if audit.get("targetRunId") != target_run_id or audit.get("manifestSha256") != manifest_sha256:
        raise RuntimeError("audit target identity does not match compression request")
    if audit.get("compressionEligible") is not True or audit.get("compressionBlockers") != []:
        raise RuntimeError("audit is not eligible for compression")
    candidates = audit.get("compressionCandidatePaths")
    if not isinstance(candidates, list) or len(candidates) != expected_candidate_count:
        raise RuntimeError("audit candidate count does not match compression request")
    if len(set(candidates)) != len(candidates) or any(not isinstance(value, str) for value in candidates):
        raise RuntimeError("audit compression candidate identity is invalid")
    target, _, files, inventory, retention = load_manifest(
        evidence_root=evidence_root,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    cleanable = cleanable_files(files)
    if candidates != [row["path"] for row in cleanable]:
        raise RuntimeError("audit compression candidates differ from the manifest")
    if sealed_tree_digest(manifest_sha256, files) != audit.get("sealedTreeSha256"):
        raise RuntimeError("sealed run tree drift after compression audit")
    audit_files = audit.get("sealedFiles")
    if not isinstance(audit_files, list):
        raise RuntimeError("audit sealed file inventory is invalid")
    expected = {row.get("path"): row for row in audit_files if isinstance(row, dict)}
    if len(expected) != len(files) or set(expected) != {row["path"] for row in files}:
        raise RuntimeError("audit sealed file identity is invalid")
    for relative in candidates:
        if relative not in inventory:
            continue
        current = inventory[relative]
        if any(
            current[key] != expected[relative].get(key)
            for key in ("device", "inode", "modifiedNs", "linkCount", "sha256", "size")
        ):
            raise RuntimeError(f"run evidence drift after compression audit: {relative}")
    pending = sorted(set(candidates) & set(inventory))
    already_removed = sorted(set(candidates) - set(inventory))
    if retention["state"] not in {"hot", "compression-committed", "compressed"}:
        raise RuntimeError("retention state is not compressible")
    if execute and output_path is None:
        raise RuntimeError("compression output is required for execute")
    if execute:
        validate_output_path(evidence_root, target, output_path)
    if not execute:
        return {
            "alreadyRemovedPaths": already_removed,
            "archiveFormat": "deterministic-zip-v1",
            "auditSha256": audit_sha256,
            "candidateCount": expected_candidate_count,
            "manifestSha256": manifest_sha256,
            "pendingPaths": pending,
            "removedCount": 0,
            "removedPaths": [],
            "retentionState": retention["state"],
            "schemaVersion": COMPRESSION_SCHEMA_VERSION,
            "state": "run-evidence-compression-preview",
            "targetRunId": target_run_id,
            "writeBoundaries": audit["writeBoundaries"],
        }
    if retention["state"] == "hot":
        retention = publish_compression_state(
            evidence_root=evidence_root,
            files=files,
            manifest_sha256=manifest_sha256,
            target=target,
            target_run_id=target_run_id,
        )
    if retention["state"] not in {"compression-committed", "compressed"}:
        raise RuntimeError("compression state commit failed")
    removed: list[str] = []
    for relative in pending:
        path = target / relative
        current = path.lstat()
        row = expected[relative]
        if (
            not stat.S_ISREG(current.st_mode)
            or current.st_nlink != 1
            or path.stat().st_size != row["size"]
            or sha256_file(path) != row["sha256"]
        ):
            raise RuntimeError(f"compression candidate drift before unlink: {relative}")
    for relative in pending:
        (target / relative).unlink()
        removed.append(relative)
    for directory in sorted(
        {(target / value).parent for value in pending},
        key=lambda value: len(value.parts),
        reverse=True,
    ):
        if directory != target:
            try:
                directory.rmdir()
            except OSError:
                pass
    _, _, _, _, completed = load_manifest(
        evidence_root=evidence_root,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    if completed["state"] != "compressed":
        raise RuntimeError("compression did not reach the sealed state")
    artifacts = completed["artifacts"]
    result = {
        "alreadyRemovedPaths": already_removed,
        "archiveFormat": "deterministic-zip-v1",
        "archiveSha256": artifacts[COMPRESSION_ARCHIVE_NAME]["sha256"],
        "auditSha256": audit_sha256,
        "candidateCount": expected_candidate_count,
        "manifestSha256": manifest_sha256,
        "pendingPaths": [],
        "receiptSha256": artifacts[COMPRESSION_RECEIPT_NAME]["sha256"],
        "removedCount": len(removed),
        "removedPaths": removed,
        "retentionState": "compressed",
        "schemaVersion": COMPRESSION_SCHEMA_VERSION,
        "state": "run-evidence-compression-complete",
        "targetRunId": target_run_id,
        "writeBoundaries": audit["writeBoundaries"],
    }
    write_json_exclusive(output_path, result)
    return result


def cleanup_compressed_archive(
    *,
    audit: dict[str, Any],
    audit_sha256: str,
    candidates: list[str],
    evidence_root: Path,
    execute: bool,
    expected_candidate_count: int,
    manifest_sha256: str,
    output_path: Path | None,
    target: Path,
    target_run_id: str,
) -> dict[str, Any]:
    expected_path = f"{RETENTION_STATE_ROOT}/{target_run_id}/{COMPRESSION_ARCHIVE_NAME}"
    if candidates != [expected_path] or expected_candidate_count != 1:
        raise RuntimeError("compressed cleanup candidate identity is invalid")
    _, _, _, _, retention = load_manifest(
        evidence_root=evidence_root,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    if retention["state"] not in {"compressed", "cleanup-committed", "cleaned"}:
        raise RuntimeError("retention state is not ready for compressed cleanup")
    artifacts = retention["artifacts"]
    audit_artifacts = audit.get("retentionArtifacts")
    if not isinstance(audit_artifacts, dict):
        raise RuntimeError("audit retention artifact inventory is invalid")
    archive_identity = audit_artifacts.get(COMPRESSION_ARCHIVE_NAME)
    if not isinstance(archive_identity, dict):
        raise RuntimeError("audit compression archive identity is missing")
    if COMPRESSION_ARCHIVE_NAME in artifacts and any(
        artifacts[COMPRESSION_ARCHIVE_NAME][key] != archive_identity.get(key)
        for key in ("device", "inode", "modifiedNs", "linkCount", "sha256", "size")
    ):
        raise RuntimeError("compression archive drift after retention audit")
    pending = [expected_path] if COMPRESSION_ARCHIVE_NAME in artifacts else []
    already_removed = [] if pending else [expected_path]
    if execute and output_path is None:
        raise RuntimeError("cleanup output is required for execute")
    if execute:
        validate_output_path(evidence_root, target, output_path)
    removed: list[str] = []
    if execute and pending:
        state_root = Path(retention["directory"])
        cleanup_receipt_path = state_root / CLEANUP_RECEIPT_NAME
        compression_receipt_sha256 = artifacts[COMPRESSION_RECEIPT_NAME]["sha256"]
        if cleanup_receipt_path.exists():
            cleanup_receipt = read_json_object(
                cleanup_receipt_path,
                "retention cleanup receipt",
            )
            if cleanup_receipt.get("auditSha256") != audit_sha256:
                raise RuntimeError("retention cleanup receipt audit identity differs")
        else:
            cleanup_receipt = {
                "archiveSha256": archive_identity["sha256"],
                "auditSha256": audit_sha256,
                "cleanedAt": utc_now(),
                "compressionReceiptSha256": compression_receipt_sha256,
                "manifestSha256": manifest_sha256,
                "schemaVersion": CLEANUP_SCHEMA_VERSION,
                "state": "run-evidence-cleanup-committed",
                "targetRunId": target_run_id,
                "writeBoundaries": audit["writeBoundaries"],
            }
            write_json_exclusive(cleanup_receipt_path, cleanup_receipt)
        archive_path = state_root / COMPRESSION_ARCHIVE_NAME
        if sha256_file(archive_path) != archive_identity["sha256"]:
            raise RuntimeError("compression archive drift before unlink")
        archive_path.unlink()
        removed.append(expected_path)
    _, _, _, _, completed = load_manifest(
        evidence_root=evidence_root,
        manifest_sha256=manifest_sha256,
        target_run_id=target_run_id,
    )
    if execute and completed["state"] != "cleaned":
        raise RuntimeError("compressed cleanup did not reach the sealed state")
    result = {
        "alreadyRemovedPaths": already_removed,
        "auditSha256": audit_sha256,
        "candidateCount": expected_candidate_count,
        "manifestSha256": manifest_sha256,
        "pendingPaths": [] if execute else pending,
        "removedCount": len(removed),
        "removedPaths": removed,
        "retentionState": completed["state"],
        "schemaVersion": SCHEMA_VERSION,
        "state": "run-evidence-retention-cleanup-complete" if execute else "run-evidence-retention-cleanup-preview",
        "targetRunId": target_run_id,
        "writeBoundaries": audit["writeBoundaries"],
    }
    if execute:
        write_json_exclusive(output_path, result)
    return result


def cleanup_run(
    *,
    audit_path: Path,
    audit_sha256: str,
    evidence_root: Path,
    execute: bool,
    expected_candidate_count: int,
    manifest_sha256: str,
    output_path: Path | None,
    target_run_id: str,
) -> dict[str, Any]:
    audit = load_audit(audit_path, audit_sha256)
    if audit.get("targetRunId") != target_run_id or audit.get("manifestSha256") != manifest_sha256:
        raise RuntimeError("audit target identity does not match cleanup request")
    if audit.get("eligible") is not True or audit.get("blockers") != []:
        raise RuntimeError("audit is not eligible for cleanup")
    candidates = audit.get("candidatePaths")
    if not isinstance(candidates, list) or len(candidates) != expected_candidate_count:
        raise RuntimeError("audit candidate count does not match cleanup request")
    if len(set(candidates)) != len(candidates) or any(not isinstance(value, str) for value in candidates):
        raise RuntimeError("audit candidate identity is invalid")
    target = validate_root(evidence_root, target_run_id)
    manifest_path = target / "manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file() or sha256_file(manifest_path) != manifest_sha256:
        raise RuntimeError("manifest drift after retention audit")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = normalized_files(manifest)
    if sealed_tree_digest(manifest_sha256, files) != audit.get("sealedTreeSha256"):
        raise RuntimeError("sealed run tree drift after retention audit")
    audit_files = audit.get("sealedFiles")
    if not isinstance(audit_files, list):
        raise RuntimeError("audit sealed file inventory is invalid")
    expected = {row.get("path"): row for row in audit_files if isinstance(row, dict)}
    if len(expected) != len(files) or set(expected) != {row["path"] for row in files}:
        raise RuntimeError("audit sealed file identity is invalid")
    if audit.get("candidateKind") == "compressed-archive":
        return cleanup_compressed_archive(
            audit=audit,
            audit_sha256=audit_sha256,
            candidates=candidates,
            evidence_root=evidence_root,
            execute=execute,
            expected_candidate_count=expected_candidate_count,
            manifest_sha256=manifest_sha256,
            output_path=output_path,
            target=target,
            target_run_id=target_run_id,
        )
    inventory = inventory_tree(target)
    allowed_paths = {"manifest.json", *(row["path"] for row in files)}
    if not set(inventory).issubset(allowed_paths):
        raise RuntimeError("run evidence tree gained an unsealed file")
    manifest_identity = audit.get("manifestIdentity")
    if not isinstance(manifest_identity, dict) or any(
        inventory["manifest.json"][key] != manifest_identity.get(key)
        for key in ("device", "inode", "modifiedNs", "linkCount", "sha256", "size")
    ):
        raise RuntimeError("manifest identity drift after retention audit")
    missing = allowed_paths - set(inventory)
    if not missing.issubset(set(candidates)):
        raise RuntimeError("protected run evidence is missing")
    for relative, row in expected.items():
        if relative not in inventory:
            continue
        current = inventory[relative]
        if any(current[key] != row.get(key) for key in ("device", "inode", "modifiedNs", "linkCount", "sha256", "size")):
            raise RuntimeError(f"run evidence drift after retention audit: {relative}")
    pending = sorted(set(candidates) & set(inventory))
    already_removed = sorted(set(candidates) - set(inventory))
    if execute and output_path is None:
        raise RuntimeError("cleanup output is required for execute")
    if execute:
        validate_output_path(evidence_root, target, output_path)
    removed: list[str] = []
    if execute:
        for relative in pending:
            path = target / relative
            info = path.lstat()
            expected_row = expected[relative]
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or sha256_file(path) != expected_row["sha256"]:
                raise RuntimeError(f"cleanup candidate drift before unlink: {relative}")
        for relative in pending:
            (target / relative).unlink()
            removed.append(relative)
        for directory in sorted({(target / value).parent for value in pending}, key=lambda value: len(value.parts), reverse=True):
            if directory != target:
                try:
                    directory.rmdir()
                except OSError:
                    pass
    result = {
        "alreadyRemovedPaths": already_removed,
        "auditSha256": audit_sha256,
        "candidateCount": expected_candidate_count,
        "manifestSha256": manifest_sha256,
        "pendingPaths": [] if execute else pending,
        "removedCount": len(removed),
        "removedPaths": removed,
        "schemaVersion": SCHEMA_VERSION,
        "state": "run-evidence-retention-cleanup-complete" if execute else "run-evidence-retention-cleanup-preview",
        "targetRunId": target_run_id,
        "writeBoundaries": audit["writeBoundaries"],
    }
    if execute:
        remaining = inventory_tree(target)
        expected_remaining = allowed_paths - set(candidates)
        if set(remaining) != expected_remaining:
            raise RuntimeError("run evidence tree is inconsistent after cleanup")
        for relative in expected_remaining:
            if remaining[relative]["sha256"] != inventory[relative]["sha256"]:
                raise RuntimeError(f"protected run evidence changed during cleanup: {relative}")
        write_json_exclusive(output_path, result)
    return result


def result_summary(payload: dict[str, Any], output: Path | None) -> dict[str, Any]:
    summary = {
        key: payload[key]
        for key in (
            "archiveFormat",
            "archiveSha256",
            "actionableRuns",
            "auditEligibleRunCount",
            "blockers",
            "candidateCount",
            "compressionBlockers",
            "compressionCandidateCount",
            "compressionEligible",
            "compressionEligibleRunCount",
            "cleanupEligibleRunCount",
            "eligible",
            "invalidRunCount",
            "invalidRuns",
            "ignoredDirectoryCount",
            "manifestRunCount",
            "removedCount",
            "retentionState",
            "retentionStateCounts",
            "schemaVersion",
            "state",
            "targetRun",
            "targetRunId",
            "unsealedRunDirectoryCount",
            "unsafeEntryCount",
            "validRunCount",
            "writeBoundaries",
        )
        if key in payload
    }
    if output is not None and output.is_file():
        summary["evidencePath"] = os.fspath(output)
        summary["evidenceSha256"] = sha256_file(output)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--operation",
        choices=("inventory", "audit", "compress", "cleanup"),
        required=True,
    )
    parser.add_argument("--evidence-root", type=Path, default=DEFAULT_EVIDENCE_ROOT)
    parser.add_argument("--target-run-id")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--as-of")
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--audit-sha256")
    parser.add_argument("--expected-candidate-count", type=int)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    verify_script_digest()
    if args.operation == "inventory":
        if (
            args.as_of is None
            or args.execute
            or args.output is not None
            or args.manifest_sha256 is not None
            or args.audit is not None
            or args.audit_sha256 is not None
            or args.expected_candidate_count is not None
        ):
            raise RuntimeError("inventory requires only --as-of and rejects write fields")
        payload = inventory_runs(
            as_of=args.as_of,
            evidence_root=args.evidence_root,
            target_run_id=args.target_run_id,
        )
        print(json.dumps(result_summary(payload, None), ensure_ascii=False, sort_keys=True))
        return
    if args.target_run_id is None or args.manifest_sha256 is None:
        raise RuntimeError(f"{args.operation} target Run ID and manifest SHA-256 are required")
    if args.operation == "audit":
        if args.as_of is None or args.output is None or args.execute:
            raise RuntimeError("audit requires --as-of and --output and rejects --execute")
        payload = audit_run(
            as_of=args.as_of,
            evidence_root=args.evidence_root,
            manifest_sha256=args.manifest_sha256,
            target_run_id=args.target_run_id,
        )
        validate_output_path(
            args.evidence_root,
            validate_root(args.evidence_root, args.target_run_id),
            args.output,
        )
        write_json_exclusive(args.output, payload)
        print(json.dumps(result_summary(payload, args.output), ensure_ascii=False, sort_keys=True))
        return
    if args.audit is None or args.audit_sha256 is None or args.expected_candidate_count is None:
        raise RuntimeError(
            f"{args.operation} audit, SHA-256, and expected candidate count are required"
        )
    if args.expected_candidate_count < 0 or args.expected_candidate_count > 10_000:
        raise RuntimeError("expected candidate count is invalid")
    operation = compress_run if args.operation == "compress" else cleanup_run
    payload = operation(
        audit_path=args.audit,
        audit_sha256=args.audit_sha256,
        evidence_root=args.evidence_root,
        execute=args.execute,
        expected_candidate_count=args.expected_candidate_count,
        manifest_sha256=args.manifest_sha256,
        output_path=args.output,
        target_run_id=args.target_run_id,
    )
    print(json.dumps(result_summary(payload, args.output), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - 命令入口只输出单一失败原因。
        print(json.dumps({"error": str(error), "state": "run-evidence-retention-failed"}, ensure_ascii=False, sort_keys=True))
        sys.exit(1)
