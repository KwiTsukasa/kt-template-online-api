#!/usr/bin/env python3
"""按密封清单通过 trim.media 官方接口精确重入库规范视频路径。"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import sqlite3
import sys
import time
from collections.abc import Callable


RE_ADD_ROUTE = "/v/api/v1/scrap/removeFromBlackByPath"
RUNNING_TASKS_ROUTE = "/v/api/v1/task/running"
FAVORITE_ROUTE = "/v/api/v1/item/favorite"
DATABASE_ROOT = pathlib.Path("/usr/local/apps/@appdata/trim.media/database")
MEDIA_DB = DATABASE_ROOT / "trimmedia.db"
ACTIVITY_DB = DATABASE_ROOT / "trimactivity.db"
EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
BACKUP_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/backups")
ROLLBACK_ROOT = pathlib.Path("/vol2/1000/.kt-media-governance-rollback")
DATABASE_NAMES = ("trimmedia.db", "trimactivity.db", "trimmedia_ext.db")
VERIFICATION_CACHE_SCHEMA = "media-manifest-verification-cache-v1"
CHUNK_SIZE = 4 * 1024 * 1024
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
        first = min(size, CHUNK_SIZE)
        digest.update(stream.read(first))
        if size > first:
            last = min(size - first, CHUNK_SIZE)
            stream.seek(size - last)
            digest.update(stream.read(last))
    return digest.hexdigest()


def trim_process_running() -> bool:
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            command = pathlib.Path(f"/proc/{name}/cmdline").read_bytes()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if b"/@appcenter/trim.media/trim-media" in command:
            return True
    return False


@contextlib.contextmanager
def connect_readonly(path: pathlib.Path):
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
    finally:
        connection.close()


def active_user_token(user_guid: str) -> str:
    with connect_readonly(ACTIVITY_DB) as connection:
        row = connection.execute(
            """
            SELECT token FROM user_token
             WHERE user_guid = ? AND status = 1
               AND token IS NOT NULL AND token <> ''
             ORDER BY update_time DESC, create_time DESC LIMIT 1
            """,
            (user_guid,),
        ).fetchone()
    if row is None or not isinstance(row[0], str) or not row[0]:
        raise RuntimeError("favorite owner has no active trim.media session")
    return row[0]


def load_official_api_helper(path: pathlib.Path, user_guid: str | None = None):
    if not path.is_absolute() or not path.is_file():
        raise RuntimeError("official API helper must be an existing absolute file")
    spec = importlib.util.spec_from_file_location("trim_official_api", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load the official same-origin API helper")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    for name in ("active_admin_token", "request", "require_ok"):
        if not callable(getattr(helper, name, None)):
            raise RuntimeError(f"official API helper does not expose {name}()")
    token = (
        helper.active_admin_token()
        if user_guid is None
        else active_user_token(user_guid)
    )
    if not isinstance(token, str) or not token:
        raise RuntimeError("official API helper returned no active admin token")
    helper.active_admin_token = lambda: token
    return helper


def require_sealed_plan(plan: dict) -> None:
    if (
        plan.get("schemaVersion") != "1.2.0"
        or plan.get("sealed") is not True
        or not isinstance(plan.get("sealedAt"), str)
        or not plan.get("sealedAt")
        or not isinstance(plan.get("workItemId"), str)
        or not plan.get("workItemId")
    ):
        raise RuntimeError("exact-path re-add accepts only a sealed Schema 1.2.0 plan")


def target_records(plan: dict) -> list[dict]:
    require_sealed_plan(plan)
    target_root_raw = (
        plan.get("execution", {})
        .get("allowlists", {})
        .get("localTargetRoot")
    )
    if not isinstance(target_root_raw, str) or not target_root_raw.startswith("/"):
        raise RuntimeError("sealed plan has no absolute localTargetRoot")
    target_root = pathlib.Path(target_root_raw).resolve(strict=False)
    operations = (
        plan.get("manifests", {}).get("local", {}).get("forward")
    )
    if not isinstance(operations, list):
        raise RuntimeError("sealed plan has no local forward manifest")
    evidence = {
        item.get("evidenceId"): item
        for item in plan.get("sourceEvidence", [])
        if isinstance(item, dict)
    }
    records = []
    seen = set()
    for operation in operations:
        if operation.get("fileKind") != "video":
            continue
        if operation.get("operation") != "move":
            raise RuntimeError("local video re-add requires a sealed move operation")
        target_raw = operation.get("targetPath")
        if not isinstance(target_raw, str) or not target_raw.startswith("/"):
            raise RuntimeError("local video target must be an absolute path")
        target = pathlib.Path(target_raw)
        resolved_target = target.resolve(strict=False)
        try:
            resolved_target.relative_to(target_root)
        except ValueError as error:
            raise RuntimeError("local video target is outside localTargetRoot") from error
        if resolved_target == target_root:
            raise RuntimeError("local video target cannot equal localTargetRoot")
        if target.suffix.lower() not in VIDEO_EXTENSIONS:
            raise RuntimeError("local re-add target is not a supported video file")
        if target_raw in seen:
            raise RuntimeError("local re-add target is duplicated")
        seen.add(target_raw)
        sealed = evidence.get(operation.get("evidenceId"))
        if (
            not isinstance(sealed, dict)
            or sealed.get("scope") != "local"
            or sealed.get("fileKind") != "video"
            or not isinstance(sealed.get("size"), int)
            or sealed.get("size") < 0
            or not isinstance(sealed.get("digest"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", sealed["digest"])
        ):
            raise RuntimeError("local video target has no valid sealed evidence")
        records.append({"path": target, "pathText": target_raw, "sealed": sealed})
    if not records:
        raise RuntimeError("sealed plan contains no local video target")
    return records


def protected_sidecar_records(plan: dict) -> list[dict]:
    """读取元数据刷新前必须保全的密封字幕与资源目标。"""
    require_sealed_plan(plan)
    target_root_raw = (
        plan.get("execution", {}).get("allowlists", {}).get("localTargetRoot")
    )
    if not isinstance(target_root_raw, str) or not target_root_raw.startswith("/"):
        raise RuntimeError("sealed plan has no absolute localTargetRoot")
    target_root = pathlib.Path(target_root_raw).resolve(strict=False)
    operations = plan.get("manifests", {}).get("local", {}).get("forward")
    if not isinstance(operations, list):
        raise RuntimeError("sealed plan has no local forward manifest")
    evidence = {
        item.get("evidenceId"): item
        for item in plan.get("sourceEvidence", [])
        if isinstance(item, dict)
    }
    records = []
    seen = set()
    for operation in operations:
        file_kind = operation.get("fileKind")
        if file_kind not in {"asset", "subtitle"}:
            continue
        target_raw = operation.get("targetPath")
        sealed = evidence.get(operation.get("evidenceId"))
        if (
            operation.get("operation") != "move"
            or not isinstance(target_raw, str)
            or not target_raw.startswith("/")
            or target_raw in seen
            or not isinstance(sealed, dict)
            or sealed.get("scope") != "local"
            or sealed.get("fileKind") != file_kind
            or sealed.get("evidenceMethod")
            not in {
                "bounded-sha256-first-last-4mib-v1",
                "sha256-full-v1",
                "sha256-v1",
            }
            or not isinstance(sealed.get("size"), int)
            or sealed.get("size") < 0
            or not isinstance(sealed.get("digest"), str)
            or not re.fullmatch(r"[a-f0-9]{64}", sealed["digest"])
        ):
            raise RuntimeError("metadata sidecar target has no valid sealed evidence")
        target = pathlib.Path(target_raw)
        resolved_target = target.resolve(strict=False)
        if not is_descendant(resolved_target, target_root):
            raise RuntimeError("metadata sidecar target is outside localTargetRoot")
        seen.add(target_raw)
        records.append(
            {
                "fileKind": file_kind,
                "path": target,
                "pathText": target_raw,
                "sealed": sealed,
                "targetRoot": target_root,
            }
        )
    return records


def verify_record(record: dict) -> None:
    path = record["path"]
    sealed = record["sealed"]
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("sealed local video target is missing or is a symlink")
    if path.stat().st_size != sealed["size"]:
        raise RuntimeError("sealed local video target size changed")
    method = sealed.get("evidenceMethod")
    if method in {"sha256-v1", "sha256-full-v1"}:
        actual = full_digest(path)
    elif method == "bounded-sha256-first-last-4mib-v1":
        actual = bounded_digest(path)
    else:
        raise RuntimeError("unsupported local video evidence method")
    if actual != sealed["digest"]:
        raise RuntimeError("sealed local video target digest changed")


def load_verification_cache(
    plan_path: pathlib.Path,
    plan: dict,
    records: list[dict],
    cache_root: pathlib.Path,
    verifier_sha256: str,
) -> dict[str, dict]:
    """读取同计划 manifest executor 记录并与当前规范目标纳秒级身份逐项完全核对。"""
    evidence_root = EVIDENCE_ROOT.resolve(strict=True)
    if (
        not cache_root.is_absolute()
        or not cache_root.is_dir()
        or cache_root.is_symlink()
        or not is_descendant(cache_root.resolve(strict=True), evidence_root)
        or cache_root.stat().st_mode & 0o077
        or not re.fullmatch(r"[a-f0-9]{64}", verifier_sha256)
    ):
        raise RuntimeError("verification cache root or tool identity is invalid")
    plan_sha256 = full_digest(plan_path)
    local_manifest_sha256 = str(
        plan.get("execution", {})
        .get("manifestSha256", {})
        .get("localForward")
        or ""
    )
    if not re.fullmatch(r"[a-f0-9]{64}", local_manifest_sha256):
        raise RuntimeError("verification cache manifest identity is invalid")
    plan_root = cache_root / plan_sha256
    if (
        not plan_root.is_dir()
        or plan_root.is_symlink()
        or plan_root.stat().st_mode & 0o077
    ):
        raise RuntimeError("verification plan cache root is invalid")
    verified = {}
    for record in records:
        target = record["path"]
        sealed = record["sealed"]
        if target.is_symlink() or not target.is_file():
            raise RuntimeError("sealed local video target is missing or is a symlink")
        current = target.stat()
        record_name = hashlib.sha256(sealed["evidenceId"].encode()).hexdigest()
        record_path = plan_root / f"{record_name}.json"
        if (
            not record_path.is_file()
            or record_path.is_symlink()
            or record_path.stat().st_mode & 0o077
            or record_path.stat().st_size < 2
            or record_path.stat().st_size > 32 * 1024
        ):
            raise RuntimeError("verification cache record is missing or unsafe")
        try:
            actual = json.loads(record_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise RuntimeError("verification cache record is invalid") from error
        expected = {
            "ctimeNs": str(current.st_ctime_ns),
            "device": str(current.st_dev),
            "digest": sealed["digest"],
            "evidenceId": sealed["evidenceId"],
            "evidenceMethod": sealed["evidenceMethod"],
            "fileKind": sealed["fileKind"],
            "inode": str(current.st_ino),
            "linkCount": str(current.st_nlink),
            "localManifestSha256": local_manifest_sha256,
            "mtimeNs": str(current.st_mtime_ns),
            "path": record["pathText"],
            "planSha256": plan_sha256,
            "schemaVersion": VERIFICATION_CACHE_SCHEMA,
            "size": current.st_size,
            "verifierSha256": verifier_sha256,
        }
        if actual != expected:
            raise RuntimeError("verification cache record changed")
        verified[record["pathText"]] = actual
    return verified


def is_descendant(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return path != root


def load_refresh_receipt(
    plan_path: pathlib.Path,
    plan: dict,
    records: list[dict],
    evidence_path: pathlib.Path,
    expected_sha256: str,
    *,
    include_database: bool = False,
) -> (
    tuple[dict[str, dict], list[dict]]
    | tuple[dict[str, dict], list[dict], pathlib.Path]
):
    resolved_evidence = evidence_path.resolve(strict=False)
    if (
        not evidence_path.is_absolute()
        or not evidence_path.is_file()
        or evidence_path.is_symlink()
        or not is_descendant(resolved_evidence, EVIDENCE_ROOT.resolve(strict=False))
        or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256)
        or full_digest(evidence_path) != expected_sha256
    ):
        raise RuntimeError("metadata refresh backup evidence is invalid")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if (
        evidence.get("schemaVersion")
        != "media-post-governance-metadata-backup-v2"
        or evidence.get("state") != "database-backup-complete"
    ):
        raise RuntimeError("metadata refresh backup schema changed")
    plans = evidence.get("plans")
    if not isinstance(plans, list) or len(plans) != 1:
        raise RuntimeError("metadata refresh backup plan identity changed")
    current_plan_sha256 = full_digest(plan_path)
    recorded_plan = pathlib.Path(str(plans[0].get("path") or ""))
    if (
        not recorded_plan.is_absolute()
        or not recorded_plan.is_file()
        or recorded_plan.is_symlink()
        or not is_descendant(
            recorded_plan.resolve(strict=False), EVIDENCE_ROOT.resolve(strict=False)
        )
        or plans[0].get("sha256") != current_plan_sha256
        or full_digest(recorded_plan) != current_plan_sha256
        or plans[0].get("workItemId") != plan.get("workItemId")
    ):
        raise RuntimeError("metadata refresh backup plan identity changed")
    database_root = pathlib.Path(str(evidence.get("databaseBackupRoot") or ""))
    databases = evidence.get("databases")
    if (
        not database_root.is_absolute()
        or not database_root.is_dir()
        or database_root.is_symlink()
        or not is_descendant(
            database_root.resolve(strict=False), BACKUP_ROOT.resolve(strict=False)
        )
        or not isinstance(databases, list)
        or len(databases) != len(DATABASE_NAMES)
    ):
        raise RuntimeError("metadata refresh database backup is incomplete")
    by_name = {entry.get("name"): entry for entry in databases if isinstance(entry, dict)}
    if set(by_name) != set(DATABASE_NAMES):
        raise RuntimeError("metadata refresh database backup set changed")
    for name in DATABASE_NAMES:
        entry = by_name[name]
        database_path = database_root / name
        if (
            entry.get("path") != os.fspath(database_path)
            or not database_path.is_file()
            or database_path.is_symlink()
            or entry.get("sha256") != full_digest(database_path)
        ):
            raise RuntimeError("metadata refresh database backup digest changed")
        with connect_readonly(database_path) as connection:
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("metadata refresh database backup quick-check failed")
    canonical = evidence.get("canonicalVideos")
    if not isinstance(canonical, list) or len(canonical) != len(records):
        raise RuntimeError("metadata refresh canonical receipt count changed")
    receipt = {
        entry.get("targetPath"): entry
        for entry in canonical
        if isinstance(entry, dict) and isinstance(entry.get("targetPath"), str)
    }
    if set(receipt) != {record["pathText"] for record in records}:
        raise RuntimeError("metadata refresh canonical receipt paths changed")
    for record in records:
        entry = receipt[record["pathText"]]
        sealed = record["sealed"]
        if (
            entry.get("workItemId") != plan.get("workItemId")
            or entry.get("digest") != sealed.get("digest")
            or entry.get("size") != sealed.get("size")
            or not all(
                isinstance(entry.get(key), int)
                for key in ("device", "inode", "mtimeNs")
            )
        ):
            raise RuntimeError("metadata refresh canonical receipt identity changed")
    sidecar_records = protected_sidecar_records(plan)
    protected = evidence.get("protectedSidecars")
    rollback_root = pathlib.Path(str(evidence.get("rollbackRoot") or ""))
    if (
        not rollback_root.is_absolute()
        or not rollback_root.is_dir()
        or rollback_root.is_symlink()
        or not is_descendant(
            rollback_root.resolve(strict=False), ROLLBACK_ROOT.resolve(strict=False)
        )
        or rollback_root.stat().st_mode & 0o077
    ):
        raise RuntimeError("metadata refresh sidecar rollback root is invalid")
    if (
        evidence.get("hardlinkCount") != len(sidecar_records)
        or not isinstance(protected, list)
        or len(protected) != len(sidecar_records)
    ):
        raise RuntimeError("metadata refresh sidecar backup is incomplete")
    protected_by_target = {
        entry.get("targetPath"): entry
        for entry in protected
        if isinstance(entry, dict) and isinstance(entry.get("targetPath"), str)
    }
    if set(protected_by_target) != {
        record["pathText"] for record in sidecar_records
    }:
        raise RuntimeError("metadata refresh sidecar receipt paths changed")
    normalized_sidecars = []
    for record in sidecar_records:
        entry = protected_by_target[record["pathText"]]
        target = record["path"]
        sealed = record["sealed"]
        relative = target.resolve(strict=False).relative_to(record["targetRoot"])
        rollback = rollback_root / plan["workItemId"] / relative
        if (
            entry.get("workItemId") != plan.get("workItemId")
            or entry.get("fileKind") != record["fileKind"]
            or entry.get("digest") != sealed.get("digest")
            or entry.get("evidenceMethod") != sealed.get("evidenceMethod")
            or entry.get("size") != sealed.get("size")
            or entry.get("rollbackPath") != os.fspath(rollback)
            or not all(
                isinstance(entry.get(key), int)
                for key in ("device", "inode", "mtimeNs")
            )
            or not rollback.is_file()
            or rollback.is_symlink()
            or target.is_symlink()
            or (target.exists() and not target.is_file())
        ):
            raise RuntimeError("metadata refresh sidecar receipt identity changed")
        rollback_stat = rollback.stat()
        target_stat = None
        if target.is_file():
            target_stat = target.stat()
        if (
            rollback_stat.st_dev != entry["device"]
            or rollback_stat.st_ino != entry["inode"]
            or rollback_stat.st_mtime_ns != entry["mtimeNs"]
            or rollback_stat.st_size != entry["size"]
            or (
                target_stat is not None
                and (
                    target_stat.st_dev != entry["device"]
                    or target_stat.st_ino != entry["inode"]
                    or target_stat.st_mtime_ns != entry["mtimeNs"]
                    or target_stat.st_size != entry["size"]
                )
            )
        ):
            raise RuntimeError("metadata refresh sidecar hardlink identity changed")
        method = sealed.get("evidenceMethod")
        actual_digest = (
            bounded_digest(rollback)
            if method == "bounded-sha256-first-last-4mib-v1"
            else full_digest(rollback)
        )
        if actual_digest != entry["digest"]:
            raise RuntimeError("metadata refresh sidecar backup digest changed")
        normalized_sidecars.append({**entry, "rollback": rollback, "target": target})
    if include_database:
        return receipt, normalized_sidecars, database_root / "trimmedia.db"
    return receipt, normalized_sidecars


def load_refresh_identity(
    plan: dict,
    records: list[dict],
    evidence_path: pathlib.Path,
    expected_sha256: str,
    task_id: str,
) -> dict[str, str]:
    resolved_evidence = evidence_path.resolve(strict=False)
    if (
        not evidence_path.is_absolute()
        or not evidence_path.is_file()
        or evidence_path.is_symlink()
        or not is_descendant(resolved_evidence, EVIDENCE_ROOT.resolve(strict=False))
        or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256)
        or full_digest(evidence_path) != expected_sha256
    ):
        raise RuntimeError("metadata refresh repair evidence is invalid")
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    identity = (evidence.get("inspection") or {}).get("identity") or {}
    if (
        evidence.get("schemaVersion") != "media-admin-metadata-repair-v1"
        or evidence.get("state") != "metadata-assets-committed"
        or evidence.get("taskId") != task_id
        or evidence.get("repairAttempt") not in {1, 2}
        or identity.get("provider") != "tmdb"
        or not str(identity.get("providerId") or "").isdigit()
    ):
        raise RuntimeError("metadata refresh repair identity changed")
    media_type = (plan.get("identity") or {}).get("mediaType")
    roots = {
        record["path"].parent.parent
        if media_type == "tv"
        else record["path"].parent
        for record in records
    }
    if (
        len(roots) != 1
        or pathlib.Path(str((evidence.get("inspection") or {}).get("titleRoot") or ""))
        != next(iter(roots))
    ):
        raise RuntimeError("metadata refresh repair title root changed")
    return {"provider": "tmdb", "providerId": str(identity["providerId"])}


def verify_record_from_receipt(record: dict, receipt: dict[str, dict]) -> None:
    path = record["path"]
    entry = receipt.get(record["pathText"])
    if entry is None or path.is_symlink() or not path.is_file():
        raise RuntimeError("metadata refresh canonical target is missing")
    stat = path.stat()
    if (
        stat.st_dev != entry["device"]
        or stat.st_ino != entry["inode"]
        or stat.st_mtime_ns != entry["mtimeNs"]
        or stat.st_size != entry["size"]
    ):
        raise RuntimeError("metadata refresh canonical target changed after backup")


def verify_records(
    records: list[dict],
    receipt: dict[str, dict] | None,
    verification_cache: dict[str, dict] | None = None,
) -> None:
    for record in records:
        if receipt is not None:
            verify_record_from_receipt(record, receipt)
        elif verification_cache is not None:
            if record["pathText"] not in verification_cache:
                raise RuntimeError("verification cache record set is incomplete")
        else:
            verify_record(record)


def ensure_sidecar_parent(target: pathlib.Path, target_root: pathlib.Path) -> None:
    if (
        not target_root.is_dir()
        or target_root.is_symlink()
        or not is_descendant(target.resolve(strict=False), target_root.resolve(strict=True))
    ):
        raise RuntimeError("metadata refresh sidecar restore boundary changed")
    current = target_root.resolve(strict=True)
    for part in target.parent.resolve(strict=False).relative_to(current).parts:
        current = current / part
        if current.exists():
            if not current.is_dir() or current.is_symlink():
                raise RuntimeError("metadata refresh sidecar restore parent changed")
        else:
            current.mkdir(mode=0o755)


def restore_refresh_sidecars(plan: dict, receipts: list[dict]) -> tuple[int, int]:
    target_root = pathlib.Path(
        str(
            plan.get("execution", {})
            .get("allowlists", {})
            .get("localTargetRoot")
            or ""
        )
    )
    restored = 0
    preserved = 0
    for entry in receipts:
        rollback = entry["rollback"]
        target = entry["target"]
        if not rollback.is_file() or rollback.is_symlink():
            raise RuntimeError("metadata refresh sidecar rollback target is missing")
        rollback_stat = rollback.stat()
        if (
            rollback_stat.st_dev != entry["device"]
            or rollback_stat.st_ino != entry["inode"]
            or rollback_stat.st_mtime_ns != entry["mtimeNs"]
            or rollback_stat.st_size != entry["size"]
        ):
            raise RuntimeError("metadata refresh sidecar rollback target changed")
        method = entry.get("evidenceMethod")
        actual_digest = (
            bounded_digest(rollback)
            if method == "bounded-sha256-first-last-4mib-v1"
            else full_digest(rollback)
        )
        if actual_digest != entry["digest"]:
            raise RuntimeError("metadata refresh sidecar rollback digest changed")
        if target.exists() or target.is_symlink():
            if not target.is_file() or target.is_symlink():
                raise RuntimeError("metadata refresh sidecar target changed")
            preserved += 1
        else:
            ensure_sidecar_parent(target, target_root)
            os.link(rollback, target)
            restored += 1
        target_stat = target.stat()
        if (
            target_stat.st_dev != entry["device"]
            or target_stat.st_ino != entry["inode"]
            or target_stat.st_mtime_ns != entry["mtimeNs"]
            or target_stat.st_size != entry["size"]
        ):
            raise RuntimeError("metadata refresh restored sidecar identity changed")
    return restored, preserved


def preflight(
    plan: dict,
    refresh_receipt: dict[str, dict] | None = None,
    refresh_sidecars: list[dict] | None = None,
    verification_cache: dict[str, dict] | None = None,
) -> dict:
    records = target_records(plan)
    verify_records(records, refresh_receipt, verification_cache)
    verification_cache_hit_count = 0
    if verification_cache is not None:
        verification_cache_hit_count = len(records)
    return {
        "databaseDirectWrite": False,
        "mechanicalScanTriggered": False,
        "operationCount": len(records),
        "passwordMutationEndpointCalled": False,
        "refreshExisting": refresh_receipt is not None,
        "sidecarProtectionCount": len(refresh_sidecars or []),
        "state": "preflight-passed",
        "verificationCacheHitCount": verification_cache_hit_count,
        "workItemId": plan["workItemId"],
    }


def canonical_rows(paths: list[str]) -> list[dict]:
    if not paths:
        return []
    marks = ",".join("?" for _ in paths)
    with connect_readonly(MEDIA_DB) as connection:
        return [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT im.guid AS media_guid, im.item_guid, im.path,
                       i.type AS item_type, i.tmdb_id AS item_tmdb_id,
                       p.guid AS parent_guid, p.type AS parent_type,
                       p.tmdb_id AS parent_tmdb_id,
                       gp.guid AS grand_guid, gp.type AS grand_type,
                       gp.tmdb_id AS grand_tmdb_id
                  FROM item_media im
                  LEFT JOIN item i ON i.guid = im.item_guid
                  LEFT JOIN item p ON p.guid = i.parent_guid
                  LEFT JOIN item gp ON gp.guid = p.parent_guid
                 WHERE im.path IN ({marks})
                 ORDER BY im.path, im.guid
                """,
                paths,
            )
        ]


def hierarchy_snapshot(root_guid: str) -> dict:
    with connect_readonly(MEDIA_DB) as connection:
        items = [
            dict(row)
            for row in connection.execute(
                """
                WITH RECURSIVE tree(guid) AS (
                    SELECT guid FROM item WHERE guid = ?
                    UNION ALL
                    SELECT child.guid FROM item child JOIN tree
                      ON child.parent_guid = tree.guid
                )
                SELECT i.guid, i.type, i.tmdb_id
                  FROM item i JOIN tree ON tree.guid = i.guid
                 ORDER BY i.guid
                """,
                (root_guid,),
            )
        ]
        item_guids = [row["guid"] for row in items]
        marks = ",".join("?" for _ in item_guids) or "NULL"
        media = [
            dict(row)
            for row in connection.execute(
                f"SELECT guid, item_guid, path FROM item_media "
                f"WHERE item_guid IN ({marks}) ORDER BY path, guid",
                item_guids,
            )
        ]
        media_guids = [row["guid"] for row in media]
        media_marks = ",".join("?" for _ in media_guids) or "NULL"
        favorites = [
            dict(row)
            for row in connection.execute(
                f"SELECT user_guid, item_guid FROM item_user_favorite "
                f"WHERE item_guid IN ({marks}) ORDER BY user_guid, item_guid",
                item_guids,
            )
        ]
        item_user_count = connection.execute(
            f"SELECT COUNT(*) FROM item_user WHERE item_guid IN ({marks})",
            item_guids,
        ).fetchone()[0]
        play_count = connection.execute(
            f"SELECT COUNT(*) FROM item_user_play WHERE item_guid IN ({marks}) "
            f"OR media_guid IN ({media_marks})",
            [*item_guids, *media_guids],
        ).fetchone()[0]
    return {
        "favoriteOwners": sorted({row["user_guid"] for row in favorites}),
        "itemUserCount": int(item_user_count),
        "items": items,
        "media": media,
        "playCount": int(play_count),
    }


def snapshot_refresh_scope(root_guid: str, snapshot: dict) -> dict:
    """把一个精确层级快照投影为可删除并可按路径复核的元数据刷新范围。"""
    return {
        "favoriteOwners": snapshot["favoriteOwners"],
        "itemUserCount": snapshot["itemUserCount"],
        "mediaGuids": sorted(row["guid"] for row in snapshot["media"]),
        "paths": sorted(row["path"] for row in snapshot["media"]),
        "playCount": snapshot["playCount"],
        "rootGuid": root_guid,
    }


def refresh_scope(
    plan: dict,
    records: list[dict],
    verified_identity: dict[str, str],
    *,
    allow_unverified_provider_identity: bool = False,
    require_provider_identity: bool = True,
) -> dict | None:
    paths = [record["pathText"] for record in records]
    rows = canonical_rows(paths)
    if not rows:
        return None
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["path"]] = counts.get(row["path"], 0) + 1
    if set(counts) != set(paths) or any(count != 1 for count in counts.values()):
        raise RuntimeError("metadata refresh canonical path set is partial or duplicated")
    identity = plan.get("identity") or {}
    media_type = identity.get("mediaType")
    if (
        verified_identity.get("provider") != "tmdb"
        or not str(verified_identity.get("providerId") or "").isdigit()
        or media_type not in {"movie", "theatrical", "tv"}
    ):
        raise RuntimeError("metadata refresh plan identity is invalid")
    provider_id = str(verified_identity["providerId"])
    roots = set()
    for row in rows:
        if media_type == "tv":
            valid = (
                row["item_type"] == "Episode"
                and row["parent_type"] == "Season"
                and row["parent_guid"]
                and row["grand_type"] == "TV"
                and row["grand_guid"]
            )
            if require_provider_identity:
                valid = valid and str(row["grand_tmdb_id"] or "") == provider_id
            elif allow_unverified_provider_identity:
                valid = valid and str(row["grand_tmdb_id"]) in {
                    "0",
                    provider_id,
                }
            roots.add(row["grand_guid"])
        else:
            valid = (
                row["item_type"] == "Movie"
                and row["item_guid"]
            )
            if require_provider_identity:
                valid = valid and str(row["item_tmdb_id"] or "") == provider_id
            elif allow_unverified_provider_identity:
                valid = valid and str(row["item_tmdb_id"]) in {
                    "0",
                    provider_id,
                }
            roots.add(row["item_guid"])
        if not valid:
            raise RuntimeError("metadata refresh active provider identity changed")
    if len(roots) != 1:
        raise RuntimeError("metadata refresh spans more than one active title root")
    title_root_guid = next(iter(roots))
    root_guid = title_root_guid
    snapshot = hierarchy_snapshot(title_root_guid)
    snapshot_paths = {row["path"] for row in snapshot["media"]}
    if media_type == "tv" and (
        snapshot_paths != set(paths) or len(snapshot["media"]) != len(paths)
    ):
        season_roots = {row["parent_guid"] for row in rows}
        if len(season_roots) != 1:
            raise RuntimeError(
                "metadata refresh spans multiple partial seasons under one title"
            )
        root_guid = next(iter(season_roots))
        snapshot = hierarchy_snapshot(root_guid)
        snapshot_paths = {row["path"] for row in snapshot["media"]}
    if (
        not snapshot["items"]
        or snapshot_paths != set(paths)
        or len(snapshot["media"]) != len(paths)
    ):
        raise RuntimeError("metadata refresh scope contains media outside the sealed plan")
    return snapshot_refresh_scope(root_guid, snapshot)


def metadata_refresh_scopes(
    plan: dict,
    records: list[dict],
    verified_identity: dict[str, str],
    *,
    allow_unverified_provider_identity: bool = False,
    require_provider_identity: bool = True,
) -> list[dict]:
    """优先使用完整作品或季范围，局部季任务则收敛为互不重叠的单集刷新范围。"""
    try:
        scope = refresh_scope(
            plan,
            records,
            verified_identity,
            allow_unverified_provider_identity=allow_unverified_provider_identity,
            require_provider_identity=require_provider_identity,
        )
    except RuntimeError as error:
        if (
            str(error) != "metadata refresh scope contains media outside the sealed plan"
            or (plan.get("identity") or {}).get("mediaType") != "tv"
        ):
            raise
    else:
        if scope is None:
            return []
        return [scope]

    paths = [record["pathText"] for record in records]
    rows = canonical_rows(paths)
    provider_id = str(verified_identity.get("providerId") or "")
    if (
        len(rows) != len(paths)
        or len({row["path"] for row in rows}) != len(paths)
        or len({row["item_guid"] for row in rows}) != len(paths)
        or len({row["parent_guid"] for row in rows}) != 1
    ):
        raise RuntimeError("metadata refresh partial episode scope is ambiguous")
    for row in rows:
        valid = (
            row["item_type"] == "Episode"
            and row["parent_type"] == "Season"
            and row["parent_guid"]
            and row["grand_type"] == "TV"
            and row["grand_guid"]
        )
        if require_provider_identity:
            valid = valid and str(row["grand_tmdb_id"] or "") == provider_id
        elif allow_unverified_provider_identity:
            valid = valid and str(row["grand_tmdb_id"] or "0") in {
                "0",
                provider_id,
            }
        if not valid:
            raise RuntimeError("metadata refresh active provider identity changed")

    scopes = []
    for row in rows:
        snapshot = hierarchy_snapshot(row["item_guid"])
        snapshot_paths = {item["path"] for item in snapshot["media"]}
        if (
            len(snapshot["items"]) != 1
            or snapshot["items"][0].get("type") != "Episode"
            or len(snapshot["media"]) != 1
            or snapshot_paths != {row["path"]}
        ):
            raise RuntimeError("metadata refresh partial episode scope changed")
        scopes.append(snapshot_refresh_scope(row["item_guid"], snapshot))
    return sorted(scopes, key=lambda scope: tuple(scope["paths"]))


def metadata_refresh_scopes_from_database(
    plan: dict,
    records: list[dict],
    verified_identity: dict[str, str],
    database: pathlib.Path,
) -> list[dict]:
    """在只读备份库上恢复刷新前范围，并在返回前恢复实时数据库绑定。"""
    global MEDIA_DB
    current_database = MEDIA_DB
    try:
        MEDIA_DB = database
        return metadata_refresh_scopes(plan, records, verified_identity)
    finally:
        MEDIA_DB = current_database


def refresh_scope_contract(scopes: list[dict]) -> list[dict]:
    """把刷新范围压缩为可比较的身份、路径与用户状态合同。"""
    return sorted(
        [
            {
                "favoriteOwners": list(scope["favoriteOwners"]),
                "itemUserCount": scope["itemUserCount"],
                "mediaGuids": list(scope["mediaGuids"]),
                "paths": list(scope["paths"]),
                "playCount": scope["playCount"],
                "rootGuid": scope["rootGuid"],
            }
            for scope in scopes
        ],
        key=lambda scope: tuple(scope["paths"]),
    )


def identity_rebase_transition(plan: dict, records: list[dict]) -> dict | None:
    """校验规范身份重排声明与每条路径保持同一相对位置。"""
    transition = plan.get("transition")
    if transition is None:
        return None
    if (
        not isinstance(transition, dict)
        or transition.get("kind") != "canonical-identity-rebase-v1"
    ):
        raise RuntimeError("identity rebase transition is invalid")
    allowlists = plan.get("execution", {}).get("allowlists", {})
    local_target_root = pathlib.Path(str(allowlists.get("localTargetRoot") or ""))
    previous_root = pathlib.Path(str(transition.get("previousTitleRoot") or ""))
    target_root = pathlib.Path(str(transition.get("targetTitleRoot") or ""))
    if (
        not local_target_root.is_absolute()
        or not previous_root.is_absolute()
        or not target_root.is_absolute()
        or previous_root == target_root
        or not is_descendant(
            previous_root.resolve(strict=False), local_target_root.resolve(strict=False)
        )
        or not is_descendant(
            target_root.resolve(strict=False), local_target_root.resolve(strict=False)
        )
        or not re.fullmatch(
            r"[a-f0-9]{64}", str(transition.get("previousPlanSha256") or "")
        )
        or not re.fullmatch(
            r"[a-f0-9]{64}", str(transition.get("amendmentPlanSha256") or "")
        )
    ):
        raise RuntimeError("identity rebase roots or digests are invalid")
    operations = plan.get("manifests", {}).get("local", {}).get("forward")
    if not isinstance(operations, list) or not operations:
        raise RuntimeError("identity rebase has no local operations")
    for operation in operations:
        source = pathlib.Path(str(operation.get("sourcePath") or ""))
        target = pathlib.Path(str(operation.get("targetPath") or ""))
        try:
            source_relative = source.relative_to(previous_root)
            target_relative = target.relative_to(target_root)
        except ValueError as error:
            raise RuntimeError(
                "identity rebase operation crosses its title roots"
            ) from error
        if source_relative != target_relative or not source_relative.parts:
            raise RuntimeError(
                "identity rebase operation changed its relative identity"
            )
    media_type = (plan.get("identity") or {}).get("mediaType")
    roots = set()
    for record in records:
        root = record["path"].parent
        if media_type == "tv":
            root = root.parent
        roots.add(root.resolve(strict=False))
    if roots != {target_root.resolve(strict=False)}:
        raise RuntimeError("identity rebase target root does not match video targets")
    provider_ref = (plan.get("identity") or {}).get("providerRef") or {}
    if (
        media_type not in {"movie", "tv"}
        or provider_ref.get("provider") != "tmdb"
        or not str(provider_ref.get("providerId") or "").isdigit()
    ):
        raise RuntimeError("identity rebase requires one TMDB movie or TV identity")
    return {
        "previousRoot": previous_root,
        "providerId": str(provider_ref["providerId"]),
        "targetRoot": target_root,
    }


def identity_rebase_scope(plan: dict, records: list[dict]) -> dict | None:
    """只读绑定旧路径完整层级；缺失返回空，部分或跨根则拒绝。"""
    operations = plan.get("manifests", {}).get("local", {}).get("forward") or []
    source_by_evidence = {
        operation.get("evidenceId"): operation.get("sourcePath")
        for operation in operations
        if operation.get("fileKind") == "video"
    }
    paths = [
        source_by_evidence.get(record["sealed"].get("evidenceId"))
        for record in records
    ]
    if any(not isinstance(path, str) for path in paths):
        raise RuntimeError("identity rebase old video path set is incomplete")
    rows = canonical_rows(paths)
    if not rows:
        return None
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["path"]] = counts.get(row["path"], 0) + 1
    if set(counts) != set(paths) or any(count != 1 for count in counts.values()):
        raise RuntimeError("identity rebase old path set is partial or duplicated")
    media_type = (plan.get("identity") or {}).get("mediaType")
    roots = set()
    for row in rows:
        if media_type == "tv":
            valid = (
                row["item_type"] == "Episode"
                and row["parent_type"] == "Season"
                and row["parent_guid"]
                and row["grand_type"] == "TV"
                and row["grand_guid"]
            )
            roots.add(row["grand_guid"])
        else:
            valid = row["item_type"] == "Movie" and row["item_guid"]
            roots.add(row["item_guid"])
        if not valid:
            raise RuntimeError("identity rebase old hierarchy is invalid")
    if len(roots) != 1:
        raise RuntimeError("identity rebase spans more than one old title root")
    root_guid = next(iter(roots))
    snapshot = hierarchy_snapshot(root_guid)
    snapshot_paths = {row["path"] for row in snapshot["media"]}
    if (
        not snapshot["items"]
        or snapshot_paths != set(paths)
        or len(snapshot["media"]) != len(paths)
    ):
        raise RuntimeError("identity rebase old scope exceeds the sealed plan")
    return {
        "favoriteOwners": snapshot["favoriteOwners"],
        "itemUserCount": snapshot["itemUserCount"],
        "mediaGuids": sorted(row["guid"] for row in snapshot["media"]),
        "playCount": snapshot["playCount"],
        "rootGuid": root_guid,
    }


def remove_empty_identity_rebase_root(
    root: pathlib.Path, boundary: pathlib.Path
) -> bool:
    """仅递归移除受管媒体边界内完全为空的旧作品目录树。"""
    if not root.exists() and not root.is_symlink():
        return False
    resolved_root = root.resolve(strict=True)
    resolved_boundary = boundary.resolve(strict=True)
    if (
        root.is_symlink()
        or not root.is_dir()
        or not is_descendant(resolved_root, resolved_boundary)
    ):
        raise RuntimeError("identity rebase old title root is unsafe")
    for child in root.iterdir():
        if child.is_symlink() or not child.is_dir():
            raise RuntimeError("identity rebase old title root is not empty")
        remove_empty_identity_rebase_root(child, resolved_root)
    root.rmdir()
    return True


def sealed_identity_change_authorized(
    plan: dict, verified_identity: dict[str, str]
) -> bool:
    identity = plan.get("identity") or {}
    metadata_identity = plan.get("metadataIdentity")
    if not isinstance(metadata_identity, dict):
        metadata_identity = identity.get("metadataIdentity")
    if isinstance(metadata_identity, dict):
        provider_ref = metadata_identity
        provider_title = metadata_identity.get("providerTitle")
        release_year = metadata_identity.get("releaseYear")
    else:
        provider_ref = identity.get("providerRef") or {}
        provider_title = identity.get("providerTitle")
        release_year = identity.get("releaseYear")
    if (
        provider_ref.get("provider") != "tmdb"
        or str(provider_ref.get("providerId") or "")
        != str(verified_identity.get("providerId") or "")
        or not isinstance(provider_title, str)
        or not provider_title.strip()
        or not isinstance(release_year, int)
    ):
        return False
    return any(
        isinstance(amendment, dict)
        and amendment.get("kind") == "identity"
        and amendment.get("provider") == "tmdb"
        and str(amendment.get("providerId") or "")
        == str(verified_identity.get("providerId") or "")
        and amendment.get("providerTitle") == provider_title
        and amendment.get("releaseYear") == release_year
        and re.fullmatch(r"[a-f0-9]{64}", str(amendment.get("planSha256") or ""))
        for amendment in plan.get("agentAmendments") or []
    )


def metadata_refresh_settle_timeout(path_count: int) -> int:
    """按每条两秒放大官方刷新观察窗，并限制在九十秒到十五分钟。"""
    if not isinstance(path_count, int) or path_count < 1:
        raise RuntimeError("metadata refresh path count is invalid")
    return min(900, max(90, path_count * 2))


def wait_for_paths_absent(
    paths: list[str], timeout: float | None = None
) -> None:
    if timeout is None:
        timeout = metadata_refresh_settle_timeout(len(paths))
    deadline = time.monotonic() + timeout
    rows = canonical_rows(paths)
    while rows and time.monotonic() < deadline:
        time.sleep(0.25)
        rows = canonical_rows(paths)
    if rows:
        raise RuntimeError("official metadata refresh left active canonical paths")


def media_delete_paths(paths: list[str]) -> set[str]:
    """只读返回 trim.media 删除队列中与密封视频完全匹配的路径。"""
    if not paths:
        return set()
    marks = ",".join("?" for _ in paths)
    with connect_readonly(MEDIA_DB) as connection:
        rows = connection.execute(
            f"SELECT DISTINCT media_path FROM media_delete "
            f"WHERE media_path IN ({marks})",
            paths,
        )
        return {str(row[0]) for row in rows}


def wait_for_delete_markers(
    paths: list[str], timeout: float | None = None
) -> None:
    """等待官方删除事务为全部密封视频发布墓碑后才允许恢复。"""
    if timeout is None:
        timeout = metadata_refresh_settle_timeout(len(paths))
    expected = set(paths)
    deadline = time.monotonic() + timeout
    actual = media_delete_paths(paths)
    while actual != expected and time.monotonic() < deadline:
        time.sleep(0.25)
        actual = media_delete_paths(paths)
    if actual != expected:
        raise RuntimeError("official metadata refresh did not publish delete markers")


def wait_for_delete_markers_absent(
    paths: list[str], timeout: float | None = None
) -> None:
    """等待官方恢复接口清除全部精确路径墓碑，避免成功响应掩盖空操作。"""
    if timeout is None:
        timeout = metadata_refresh_settle_timeout(len(paths))
    deadline = time.monotonic() + timeout
    actual = media_delete_paths(paths)
    while actual and time.monotonic() < deadline:
        time.sleep(0.25)
        actual = media_delete_paths(paths)
    if actual:
        raise RuntimeError("official exact-path re-add left delete markers")


def official_write_with_uncertain_timeout(
    helper,
    route: str,
    label: str,
    *,
    method: str,
    payload: dict,
) -> bool:
    """执行一次官方写请求，超时时不重放并交由调用方核对确定性后置状态。"""
    try:
        response = helper.request(route, method=method, payload=payload)
    except TimeoutError:
        return False
    helper.require_ok(response, label)
    return True


def wait_for_refresh_scope(
    plan: dict,
    records: list[dict],
    verified_identity: dict[str, str],
    timeout: float = 300,
    *,
    allow_unverified_provider_identity: bool = False,
    require_provider_identity: bool = True,
) -> dict:
    paths = [record["pathText"] for record in records]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = canonical_rows(paths)
        counts: dict[str, int] = {}
        for row in rows:
            counts[row["path"]] = counts.get(row["path"], 0) + 1
        if set(counts) == set(paths) and all(count == 1 for count in counts.values()):
            try:
                scope = refresh_scope(
                    plan,
                    records,
                    verified_identity,
                    allow_unverified_provider_identity=allow_unverified_provider_identity,
                    require_provider_identity=require_provider_identity,
                )
            except RuntimeError as error:
                if str(error) not in {
                    "metadata refresh active provider identity changed",
                    "metadata refresh spans more than one active title root",
                }:
                    raise
            else:
                if scope is not None:
                    return scope
        elif any(count > 1 for count in counts.values()):
            raise RuntimeError("metadata refresh created duplicate canonical paths")
        time.sleep(0.5)
    raise RuntimeError("metadata refresh canonical paths did not converge")


def wait_for_metadata_refresh_scopes(
    plan: dict,
    records: list[dict],
    verified_identity: dict[str, str],
    timeout: float = 300,
    *,
    allow_unverified_provider_identity: bool = False,
    require_provider_identity: bool = True,
) -> list[dict]:
    """等待完整层级或局部单集范围全部按同一 provider 身份重新出现。"""
    paths = [record["pathText"] for record in records]
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = canonical_rows(paths)
        counts: dict[str, int] = {}
        for row in rows:
            counts[row["path"]] = counts.get(row["path"], 0) + 1
        if set(counts) == set(paths) and all(count == 1 for count in counts.values()):
            try:
                scopes = metadata_refresh_scopes(
                    plan,
                    records,
                    verified_identity,
                    allow_unverified_provider_identity=allow_unverified_provider_identity,
                    require_provider_identity=require_provider_identity,
                )
            except RuntimeError as error:
                if str(error) not in {
                    "metadata refresh active provider identity changed",
                    "metadata refresh spans more than one active title root",
                }:
                    raise
            else:
                if scopes:
                    return scopes
        elif any(count > 1 for count in counts.values()):
            raise RuntimeError("metadata refresh created duplicate canonical paths")
        time.sleep(0.5)
    raise RuntimeError("metadata refresh canonical paths did not converge")


def official_running_tasks(helper, timeout: float = 90) -> list[dict]:
    """只重试无写副作用的官方运行任务查询，并在有界窗口后保留超时失败。"""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return helper.require_ok(
                helper.request(RUNNING_TASKS_ROUTE),
                "official running task query",
            ) or []
        except TimeoutError as error:
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    "official running task query timed out"
                ) from error
            time.sleep(1)


def wait_for_running_tasks(helper, timeout: float = 300) -> None:
    deadline = time.monotonic() + timeout
    running = official_running_tasks(helper)
    while running and time.monotonic() < deadline:
        time.sleep(1)
        running = official_running_tasks(helper)
    if running:
        raise RuntimeError("trim.media metadata refresh tasks did not settle")


def favorite_owners(root_guid: str) -> list[str]:
    with connect_readonly(MEDIA_DB) as connection:
        return [
            row[0]
            for row in connection.execute(
                "SELECT user_guid FROM item_user_favorite "
                "WHERE item_guid = ? ORDER BY user_guid",
                (root_guid,),
            )
        ]


def restore_refresh_favorites(
    owners: list[str],
    root_guid: str,
    helper_path: pathlib.Path,
) -> int:
    restored = 0
    for owner in owners:
        current = favorite_owners(root_guid)
        if owner in current:
            continue
        owner_helper = load_official_api_helper(helper_path, owner)
        owner_helper.require_ok(
            owner_helper.request(
                FAVORITE_ROUTE,
                method="PUT",
                payload={"item_guid": root_guid},
            ),
            "official favorite restoration",
        )
        deadline = time.monotonic() + 30
        while owner not in favorite_owners(root_guid) and time.monotonic() < deadline:
            time.sleep(0.25)
        if owner not in favorite_owners(root_guid):
            raise RuntimeError("official favorite restoration did not converge")
        restored += 1
    if set(favorite_owners(root_guid)) != set(owners):
        raise RuntimeError("metadata refresh favorite owner set changed")
    return restored


def restore_metadata_refresh_favorites(
    previous_scopes: list[dict],
    current_scopes: list[dict],
    helper_path: pathlib.Path,
) -> int:
    """按完全相同的媒体路径集合把局部刷新前的收藏恢复到对应新层级。"""
    if len(previous_scopes) != len(current_scopes):
        raise RuntimeError("metadata refresh scope count changed")
    current_by_paths = {
        tuple(scope.get("paths") or []): scope for scope in current_scopes
    }
    restored = 0
    for index, previous in enumerate(previous_scopes):
        path_key = tuple(previous.get("paths") or [])
        current = current_by_paths.get(path_key)
        if current is None and len(previous_scopes) == 1:
            current = current_scopes[index]
        if current is None:
            raise RuntimeError("metadata refresh scope paths changed")
        restored += restore_refresh_favorites(
            previous["favoriteOwners"],
            current["rootGuid"],
            helper_path,
        )
    return restored


def execute_exact_path_readd(
    plan: dict,
    library_guid: str,
    helper,
    *,
    official_helper_path: pathlib.Path | None = None,
    refresh_existing: bool = False,
    refresh_identity: dict[str, str] | None = None,
    refresh_previous_scopes: list[dict] | None = None,
    refresh_receipt: dict[str, dict] | None = None,
    refresh_sidecars: list[dict] | None = None,
    verification_cache: dict[str, dict] | None = None,
    service_running: Callable[[], bool] = trim_process_running,
    progress: Callable[[int, int], None] | None = None,
) -> dict:
    if not re.fullmatch(r"[0-9a-f]{32}", library_guid):
        raise RuntimeError("library GUID must be 32 lowercase hexadecimal characters")
    records = target_records(plan)
    if refresh_existing and (
        refresh_receipt is None
        or refresh_identity is None
        or refresh_sidecars is None
    ):
        raise RuntimeError(
            "metadata refresh requires verified backup and repair evidence"
        )
    verify_records(records, refresh_receipt, verification_cache)
    if not service_running():
        raise RuntimeError("trim.media must be running before exact-path re-add")
    running = official_running_tasks(helper)
    if running:
        raise RuntimeError("trim.media has running tasks before exact-path re-add")
    rebase = identity_rebase_transition(plan, records)
    rebase_scope = None
    rebase_target_scope = None
    rebase_identity = None
    rebase_identity_transition = False
    rebase_old_paths: list[str] = []
    if rebase is not None:
        rebase_identity = {
            "provider": "tmdb",
            "providerId": rebase["providerId"],
        }
        rebase_identity_transition = sealed_identity_change_authorized(
            plan, rebase_identity
        )
        rebase_scope = identity_rebase_scope(plan, records)
        rebase_target_scope = refresh_scope(
            plan,
            records,
            rebase_identity,
            allow_unverified_provider_identity=rebase_identity_transition,
            require_provider_identity=not rebase_identity_transition,
        )
        if rebase_scope is not None and rebase_target_scope is not None:
            raise RuntimeError("identity rebase old and new scopes are both active")
        operations = plan.get("manifests", {}).get("local", {}).get("forward") or []
        rebase_old_paths = [
            operation["sourcePath"]
            for operation in operations
            if operation.get("fileKind") == "video"
        ]
        if any(pathlib.Path(value).exists() for value in rebase_old_paths):
            raise RuntimeError("identity rebase old video files still exist")
    refresh_identity_transition = refresh_existing and sealed_identity_change_authorized(
        plan, refresh_identity
    )
    refresh_scopes = (
        metadata_refresh_scopes(
            plan,
            records,
            refresh_identity,
            allow_unverified_provider_identity=refresh_identity_transition,
            require_provider_identity=not refresh_identity_transition,
        )
        if refresh_existing
        else []
    )
    refresh_paths = [record["pathText"] for record in records]
    has_refresh_previous_scopes = refresh_previous_scopes is not None
    if refresh_previous_scopes is None:
        refresh_previous_scopes = refresh_scopes
    if (
        refresh_existing
        and refresh_scopes
        and has_refresh_previous_scopes
        and refresh_scope_contract(refresh_scopes)
        != refresh_scope_contract(refresh_previous_scopes)
    ):
        raise RuntimeError("metadata refresh backup scope changed")
    refresh_recovery = False
    if refresh_existing and not refresh_scopes:
        if canonical_rows(refresh_paths):
            raise RuntimeError("metadata refresh recovery canonical rows are ambiguous")
        if not refresh_previous_scopes:
            raise RuntimeError("metadata refresh backup has no canonical scope")
        refresh_recovery = True
    official_request_timeout_count = 0
    if refresh_existing and refresh_scopes:
        if official_helper_path is None:
            raise RuntimeError("metadata refresh requires the official helper path")
        for scope in refresh_scopes:
            for owner in scope["favoriteOwners"]:
                active_user_token(owner)
            request_confirmed = official_write_with_uncertain_timeout(
                helper,
                f"/v/api/v1/item/{scope['rootGuid']}",
                "official metadata title refresh",
                method="DELETE",
                payload={
                    "delete_file": 0,
                    "guid": scope["rootGuid"],
                    "media_guids": scope["mediaGuids"],
                },
            )
            if not request_confirmed:
                official_request_timeout_count += 1
        wait_for_paths_absent(refresh_paths)
        rebase_target_scope = None
    if (
        refresh_existing
        and refresh_scopes
        and official_request_timeout_count == 0
    ):
        wait_for_delete_markers(refresh_paths)
    if rebase_scope is not None:
        helper.require_ok(
            helper.request(
                f"/v/api/v1/item/{rebase_scope['rootGuid']}",
                method="DELETE",
                payload={
                    "delete_file": 0,
                    "guid": rebase_scope["rootGuid"],
                    "media_guids": rebase_scope["mediaGuids"],
                },
            ),
            "official identity rebase old title removal",
        )
        wait_for_paths_absent(rebase_old_paths)
    sidecar_restored = 0
    sidecar_preserved = 0
    if refresh_existing:
        sidecar_restored, sidecar_preserved = restore_refresh_sidecars(
            plan, refresh_sidecars
        )
    total = len(records)
    exact_readd_count = 0
    if rebase_target_scope is None:
        for index, record in enumerate(records, start=1):
            request_confirmed = official_write_with_uncertain_timeout(
                helper,
                RE_ADD_ROUTE,
                "official exact-path re-add",
                method="POST",
                payload={"mdb_guid": library_guid, "path": record["pathText"]},
            )
            if not request_confirmed:
                official_request_timeout_count += 1
            exact_readd_count += 1
            if progress and (index % 25 == 0 or index == total):
                progress(index, total)
    if refresh_existing:
        wait_for_delete_markers_absent(refresh_paths)
    new_scope = None
    new_refresh_scopes: list[dict] = []
    favorite_restored = 0
    if refresh_existing:
        new_refresh_scopes = wait_for_metadata_refresh_scopes(
            plan,
            records,
            refresh_identity,
        )
        wait_for_running_tasks(helper)
        new_refresh_scopes = metadata_refresh_scopes(
            plan,
            records,
            refresh_identity,
        )
        if not new_refresh_scopes:
            raise RuntimeError("metadata refresh canonical scope disappeared")
        if refresh_previous_scopes:
            favorite_restored = restore_metadata_refresh_favorites(
                refresh_previous_scopes,
                new_refresh_scopes,
                official_helper_path,
            )
    old_title_root_removed = False
    if rebase is not None:
        if rebase_target_scope is None:
            new_scope = wait_for_refresh_scope(
                plan,
                records,
                rebase_identity,
                allow_unverified_provider_identity=rebase_identity_transition,
                require_provider_identity=not rebase_identity_transition,
            )
            wait_for_running_tasks(helper)
            new_scope = refresh_scope(
                plan,
                records,
                rebase_identity,
                allow_unverified_provider_identity=rebase_identity_transition,
                require_provider_identity=not rebase_identity_transition,
            )
            if new_scope is None:
                raise RuntimeError("identity rebase target scope did not converge")
        else:
            new_scope = rebase_target_scope
        if rebase_scope is not None and rebase_scope["favoriteOwners"]:
            if official_helper_path is None:
                raise RuntimeError("identity rebase requires the official helper path")
            favorite_restored = restore_refresh_favorites(
                rebase_scope["favoriteOwners"],
                new_scope["rootGuid"],
                official_helper_path,
            )
        old_title_root_removed = remove_empty_identity_rebase_root(
            rebase["previousRoot"],
            pathlib.Path(
                str(
                    plan.get("execution", {})
                    .get("allowlists", {})
                    .get("localTargetRoot")
                    or ""
                )
            ),
        )
    official_delete_count = len(refresh_scopes) + int(rebase_scope is not None)
    official_delete_file_value = None
    if official_delete_count > 0:
        official_delete_file_value = 0
    return {
        "databaseDirectWrite": False,
        "discardedItemUserCount": sum(
            scope["itemUserCount"] for scope in refresh_previous_scopes
        ),
        "discardedPlaybackCount": sum(
            scope["playCount"] for scope in refresh_previous_scopes
        ),
        "favoriteRestoreCount": favorite_restored,
        "mechanicalScanTriggered": False,
        "exactReaddCount": exact_readd_count,
        "identityRebase": rebase is not None,
        "officialDeleteCount": official_delete_count,
        "officialDeleteFileValue": official_delete_file_value,
        "officialEndpoint": RE_ADD_ROUTE,
        "officialRequestTimeoutCount": official_request_timeout_count,
        "oldTitleRootRemoved": old_title_root_removed,
        "operationCount": total,
        "passwordMutationEndpointCalled": False,
        "refreshExisting": refresh_existing,
        "refreshRecovery": refresh_recovery,
        "sidecarPreservedCount": sidecar_preserved,
        "sidecarRestoreCount": sidecar_restored,
        "state": "committed",
        "workItemId": plan["workItemId"],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight or execute official trim.media exact-path re-adds."
    )
    parser.add_argument("--plan", required=True)
    parser.add_argument("--library-guid")
    parser.add_argument("--metadata-backup-evidence")
    parser.add_argument("--metadata-backup-evidence-sha256")
    parser.add_argument("--metadata-repair-evidence")
    parser.add_argument("--metadata-repair-evidence-sha256")
    parser.add_argument("--official-api-helper")
    parser.add_argument("--refresh-existing", action="store_true")
    parser.add_argument("--task-id")
    parser.add_argument("--verification-cache-root")
    parser.add_argument("--verification-tool-sha256")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    plan_path = pathlib.Path(args.plan)
    if not plan_path.is_absolute() or not plan_path.is_file():
        raise RuntimeError("sealed plan must be an existing absolute file")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    records = target_records(plan)
    verification_cache = None
    if bool(args.verification_cache_root) != bool(args.verification_tool_sha256):
        raise RuntimeError(
            "verification cache root and tool SHA-256 must be provided together"
        )
    if args.verification_cache_root:
        verification_cache = load_verification_cache(
            plan_path,
            plan,
            records,
            pathlib.Path(args.verification_cache_root),
            args.verification_tool_sha256,
        )
    refresh_identity = None
    refresh_previous_scopes = None
    refresh_receipt = None
    refresh_sidecars = None
    if args.refresh_existing:
        if not all(
            (
                args.metadata_backup_evidence,
                args.metadata_backup_evidence_sha256,
                args.metadata_repair_evidence,
                args.metadata_repair_evidence_sha256,
                args.task_id,
            )
        ):
            raise RuntimeError(
                "--refresh-existing requires task-bound backup and repair evidence"
            )
        refresh_receipt, refresh_sidecars, backup_media_db = load_refresh_receipt(
            plan_path,
            plan,
            records,
            pathlib.Path(args.metadata_backup_evidence),
            args.metadata_backup_evidence_sha256,
            include_database=True,
        )
        refresh_identity = load_refresh_identity(
            plan,
            records,
            pathlib.Path(args.metadata_repair_evidence),
            args.metadata_repair_evidence_sha256,
            args.task_id,
        )
        refresh_previous_scopes = metadata_refresh_scopes_from_database(
            plan,
            records,
            refresh_identity,
            backup_media_db,
        )
    if not args.execute:
        print(
            json.dumps(
                preflight(
                    plan,
                    refresh_receipt,
                    refresh_sidecars,
                    verification_cache,
                ),
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return
    if not args.library_guid or not args.official_api_helper:
        raise RuntimeError(
            "--execute requires --library-guid and --official-api-helper"
        )
    helper = load_official_api_helper(pathlib.Path(args.official_api_helper))

    def emit_progress(completed: int, total: int) -> None:
        print(
            json.dumps(
                {
                    "completed": completed,
                    "phase": "exact-path-readd",
                    "total": total,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )

    result = execute_exact_path_readd(
        plan,
        args.library_guid,
        helper,
        official_helper_path=pathlib.Path(args.official_api_helper),
        refresh_existing=args.refresh_existing,
        refresh_identity=refresh_identity,
        refresh_previous_scopes=refresh_previous_scopes,
        refresh_receipt=refresh_receipt,
        refresh_sidecars=refresh_sidecars,
        verification_cache=verification_cache,
        progress=emit_progress,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
