#!/usr/bin/env python3
"""为一批本地媒体事务创建同盘硬链接与 trim.media SQLite 回滚备份。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3


MEDIA_ROOT = pathlib.Path("/vol2/1000/Media/movie")
LOCAL_MEDIA_ROOT = pathlib.Path("/vol2/1000/Media")
STAGING_PARENT = pathlib.Path("/vol2/1000/.kt-media-governance-staging")
ROLLBACK_PARENT = pathlib.Path("/vol2/1000/.kt-media-governance-rollback")
EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
BACKUP_PARENT = pathlib.Path("/vol1/docker/kt-media-governance/backups")
DATABASE_ROOT = pathlib.Path("/usr/local/apps/@appdata/trim.media/database")
DATABASE_NAMES = ("trimmedia.db", "trimactivity.db", "trimmedia_ext.db")
CHUNK_SIZE = 4 * 1024 * 1024
IMAGE_EXTENSIONS = (".jpeg", ".jpg", ".png", ".webp")
MOVIE_METADATA_TYPES = frozenset({"movie", "theatrical"})
VERIFICATION_CACHE_SCHEMA = "media-manifest-verification-cache-v1"
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


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


def bounded_sha256(path: pathlib.Path) -> str:
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


def validate_new_path(path: pathlib.Path, root: pathlib.Path, label: str) -> None:
    if (
        not path.is_absolute()
        or path.exists()
        or path.is_symlink()
        or not is_descendant(path.resolve(strict=False), root)
    ):
        fail(f"{label} must be a new absolute path below {root}")


def validate_plan_path(path: pathlib.Path) -> None:
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or path.suffix != ".json"
        or not is_descendant(path.resolve(strict=True), EVIDENCE_ROOT)
    ):
        fail("plan must be an existing regular JSON file below the evidence root")


def source_evidence_by_id(plan: dict) -> dict[str, dict]:
    evidence = {}
    for entry in plan.get("sourceEvidence", []):
        evidence_id = entry.get("evidenceId")
        if not evidence_id or evidence_id in evidence:
            fail("plan source evidence IDs are missing or duplicated")
        evidence[evidence_id] = entry
    return evidence


def verification_record_path(
    cache_root: pathlib.Path,
    plan_sha256: str,
    evidence_id: str,
) -> pathlib.Path:
    """以 evidenceId 摘要派生计划直属记录路径，拒绝原始标识参与目录解析。"""
    if not SHA256_PATTERN.fullmatch(plan_sha256):
        fail("verification plan SHA-256 is invalid")
    plan_root = cache_root / plan_sha256
    record_name = hashlib.sha256(evidence_id.encode()).hexdigest() + ".json"
    candidate = plan_root / record_name
    if candidate.parent != plan_root:
        fail("verification record escaped the plan root")
    return candidate


def verification_record_payload(
    plan_sha256: str,
    local_manifest_sha256: str,
    file_path: pathlib.Path,
    evidence: dict,
    stat: os.stat_result,
    verifier_sha256: str,
) -> dict:
    """绑定计划、清单、证据、工具与纳秒级 live stat，生成跨脚本一致的摘要记录。"""
    if (
        not SHA256_PATTERN.fullmatch(plan_sha256)
        or not SHA256_PATTERN.fullmatch(local_manifest_sha256)
        or not SHA256_PATTERN.fullmatch(verifier_sha256)
    ):
        fail("verification record digest identity is invalid")
    return {
        "ctimeNs": str(stat.st_ctime_ns),
        "device": str(stat.st_dev),
        "digest": evidence["digest"],
        "evidenceId": evidence["evidenceId"],
        "evidenceMethod": evidence["evidenceMethod"],
        "fileKind": evidence["fileKind"],
        "inode": str(stat.st_ino),
        "linkCount": str(stat.st_nlink),
        "localManifestSha256": local_manifest_sha256,
        "mtimeNs": str(stat.st_mtime_ns),
        "path": os.fspath(file_path),
        "planSha256": plan_sha256,
        "schemaVersion": VERIFICATION_CACHE_SCHEMA,
        "size": stat.st_size,
        "verifierSha256": verifier_sha256,
    }


def validate_verification_cache_root(
    path_value: str | None,
    verifier_sha256: str | None,
) -> pathlib.Path | None:
    """要求摘要缓存位于固定 evidence 根、权限为 0700 且与当前工具摘要成对提供。"""
    if path_value is None and verifier_sha256 is None:
        return None
    if not path_value or not verifier_sha256:
        fail("verification cache root and tool SHA-256 must be provided together")
    if not SHA256_PATTERN.fullmatch(verifier_sha256):
        fail("verification tool SHA-256 is invalid")
    cache_root = pathlib.Path(path_value)
    evidence_root = EVIDENCE_ROOT.resolve(strict=True)
    resolved = cache_root
    if cache_root.is_dir():
        resolved = cache_root.resolve(strict=True)
    if (
        not cache_root.is_absolute()
        or not cache_root.is_dir()
        or cache_root.is_symlink()
        or not is_descendant(resolved, evidence_root)
        or cache_root.stat().st_mode & 0o077
    ):
        fail("verification cache root is invalid")
    return cache_root


def verification_record_matches(
    cache_root: pathlib.Path,
    plan_sha256: str,
    local_manifest_sha256: str,
    file_path: pathlib.Path,
    evidence: dict,
    stat: os.stat_result,
    verifier_sha256: str,
) -> bool:
    """读取私有记录并与当前计划、证据和 live stat 完全比较；缺失返回 false，损坏立即拒绝。"""
    record_path = verification_record_path(
        cache_root, plan_sha256, str(evidence["evidenceId"])
    )
    if not record_path.exists():
        return False
    record_stat = record_path.lstat()
    if (
        record_path.is_symlink()
        or not record_path.is_file()
        or record_stat.st_mode & 0o077
        or record_stat.st_size < 2
        or record_stat.st_size > 32 * 1024
    ):
        fail("verification cache record is unsafe")
    try:
        actual = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise RuntimeError("verification cache record is invalid") from error
    expected = verification_record_payload(
        plan_sha256,
        local_manifest_sha256,
        file_path,
        evidence,
        stat,
        verifier_sha256,
    )
    return actual == expected


def write_verification_record(
    cache_root: pathlib.Path,
    plan_sha256: str,
    local_manifest_sha256: str,
    file_path: pathlib.Path,
    evidence: dict,
    stat: os.stat_result,
    verifier_sha256: str,
) -> None:
    """在受控 hardlink 后以最新 ctime/nlink 原子替换同一证据记录，并回读确认正文未漂移。"""
    record_path = verification_record_path(
        cache_root, plan_sha256, str(evidence["evidenceId"])
    )
    record_path.parent.mkdir(mode=0o700, exist_ok=True)
    if not record_path.parent.is_dir() or record_path.parent.is_symlink():
        fail("verification plan cache root is invalid")
    if record_path.parent.stat().st_mode & 0o077:
        fail("verification plan cache root is not private")
    if record_path.exists() and (
        record_path.is_symlink()
        or not record_path.is_file()
        or record_path.stat().st_mode & 0o077
    ):
        fail("verification cache record is unsafe")
    payload = verification_record_payload(
        plan_sha256,
        local_manifest_sha256,
        file_path,
        evidence,
        stat,
        verifier_sha256,
    )
    temporary = record_path.with_name(f".{record_path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, record_path)
    finally:
        temporary.unlink(missing_ok=True)
    if json.loads(record_path.read_text(encoding="utf-8")) != payload:
        fail("verification cache record write drifted")


def collect_plan_videos(
    plan_path: pathlib.Path,
    verification_cache_root: pathlib.Path | None = None,
    verification_tool_sha256: str | None = None,
    allow_verification_cache_seed: bool = False,
) -> tuple[dict, list[dict]]:
    validate_plan_path(plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    plan_sha256 = sha256_file(plan_path)
    execution = plan.get("execution") or {}
    allowlists = execution.get("allowlists") or {}
    source_root = pathlib.Path(str(allowlists.get("localSourceRoot") or ""))
    staging_root_raw = allowlists.get("localStagingRoot")
    staging_root = (
        pathlib.Path(str(staging_root_raw)) if staging_root_raw is not None else None
    )
    if (
        plan.get("schemaVersion") != "1.2.0"
        or plan.get("sealed") is not True
        or execution.get("phase") != "local-only"
        or not re.fullmatch(r"media-\d{3}", str(plan.get("workItemId") or ""))
        or not source_root.is_absolute()
        or not is_descendant(source_root.resolve(strict=False), LOCAL_MEDIA_ROOT)
        or (
            staging_root is not None
            and (
                not staging_root.is_absolute()
                or not staging_root.is_dir()
                or staging_root.is_symlink()
                or not is_descendant(
                    staging_root.resolve(strict=True), STAGING_PARENT.resolve(strict=True)
                )
            )
        )
    ):
        fail("plan is not a sealed local-only media plan")
    evidence = source_evidence_by_id(plan)
    local_manifest_sha256 = str(
        (execution.get("manifestSha256") or {}).get("localForward") or ""
    )
    videos = []
    for operation in plan.get("manifests", {}).get("local", {}).get("forward", []):
        if operation.get("fileKind") != "video":
            continue
        source = pathlib.Path(str(operation.get("sourcePath") or ""))
        entry = evidence.get(operation.get("evidenceId"))
        resolved_source = source.resolve(strict=True) if source.is_file() else source
        source_base = None
        for candidate in (source_root, staging_root):
            if candidate is None or not candidate.exists():
                continue
            if is_descendant(resolved_source, candidate.resolve(strict=True)):
                source_base = candidate.resolve(strict=True)
                break
        method = entry.get("evidenceMethod") if entry else None
        if (
            entry is None
            or entry.get("fileKind") != "video"
            or entry.get("scope") != "local"
            or method
            not in {
                "bounded-sha256-first-last-4mib-v1",
                "sha256-full-v1",
            }
            or entry.get("path") != os.fspath(source)
            or not source.is_file()
            or source.is_symlink()
            or source_base is None
        ):
            fail("video operation lacks valid local source evidence")
        stat = source.stat()
        cache_hit = False
        if verification_cache_root is not None:
            cache_hit = verification_record_matches(
                verification_cache_root,
                plan_sha256,
                local_manifest_sha256,
                source,
                entry,
                stat,
                str(verification_tool_sha256),
            )
            if not cache_hit and not allow_verification_cache_seed:
                fail(f"video verification cache is incomplete or stale: {source}")
        actual_digest = entry.get("digest")
        if not cache_hit:
            if method == "bounded-sha256-first-last-4mib-v1":
                actual_digest = bounded_sha256(source)
            else:
                actual_digest = sha256_file(source)
        if (
            stat.st_size != entry.get("size")
            or stat.st_mtime_ns // 1_000_000 != entry.get("mtimeMs")
            or actual_digest != entry.get("digest")
        ):
            fail(f"video evidence changed before backup: {source}")
        videos.append(
            {
                "device": stat.st_dev,
                "digest": entry["digest"],
                "ctimeNs": stat.st_ctime_ns,
                "evidenceId": entry["evidenceId"],
                "evidenceMethod": entry["evidenceMethod"],
                "inode": stat.st_ino,
                "linkCount": stat.st_nlink,
                "mtimeNs": stat.st_mtime_ns,
                "relativePath": source.resolve(strict=True).relative_to(source_base).as_posix(),
                "size": stat.st_size,
                "sourcePath": os.fspath(source),
                "_verification": {
                    "evidence": entry,
                    "localManifestSha256": local_manifest_sha256,
                    "planSha256": plan_sha256,
                    "toolSha256": verification_tool_sha256,
                },
                "workItemId": plan["workItemId"],
            }
        )
    if not videos:
        fail("plan contains no local video operations")
    return {
        "path": os.fspath(plan_path),
        "sha256": plan_sha256,
        "videoCount": len(videos),
        "workItemId": plan["workItemId"],
    }, videos


def collect_plans(
    plan_paths: list[pathlib.Path],
    verification_cache_root: pathlib.Path | None = None,
    verification_tool_sha256: str | None = None,
    allow_verification_cache_seed: bool = False,
) -> tuple[list[dict], list[dict]]:
    plans = []
    videos = []
    work_items = set()
    source_paths = set()
    for path in plan_paths:
        plan, plan_videos = collect_plan_videos(
            path,
            verification_cache_root,
            verification_tool_sha256,
            allow_verification_cache_seed,
        )
        if plan["workItemId"] in work_items:
            fail("backup batch contains a duplicate work item")
        work_items.add(plan["workItemId"])
        for video in plan_videos:
            if video["sourcePath"] in source_paths:
                fail("backup batch contains a duplicate source video")
            source_paths.add(video["sourcePath"])
        plans.append(plan)
        videos.extend(plan_videos)
    return plans, videos


def collect_canonical_replacement(plan_path: pathlib.Path) -> list[dict]:
    """读取单个密封电影计划的旧规范目标证据，并在替换前完整复核 live 文件身份。"""
    validate_plan_path(plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    replacement = plan.get("canonicalReplacement")
    if replacement is None:
        return []
    expected_contract_keys = {
        "replacedPlanSha256",
        "replacedTaskId",
        "replacedTaskRevision",
        "replacedWorkItemId",
        "schemaVersion",
        "targetEvidence",
    }
    if not isinstance(replacement, dict) or set(replacement) != expected_contract_keys:
        fail("canonical replacement contract is invalid")
    evidence = replacement.get("targetEvidence")
    expected_evidence_keys = {
        "digest",
        "evidenceId",
        "evidenceMethod",
        "fileKind",
        "mtimeMs",
        "path",
        "scope",
        "size",
    }
    if not isinstance(evidence, dict) or set(evidence) != expected_evidence_keys:
        fail("canonical replacement evidence is invalid")
    execution = plan.get("execution") or {}
    allowlists = execution.get("allowlists") or {}
    target_root = pathlib.Path(str(allowlists.get("localTargetRoot") or ""))
    forward = (plan.get("manifests") or {}).get("local", {}).get("forward", [])
    video_operations = [
        operation
        for operation in forward
        if isinstance(operation, dict) and operation.get("fileKind") == "video"
    ]
    target = pathlib.Path(str(evidence.get("path") or ""))
    identity_invalid = (
        replacement.get("schemaVersion") != "media-canonical-replacement-v1"
        or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._-]{7,95}",
            str(replacement.get("replacedTaskId") or ""),
        )
        or not re.fullmatch(
            r"media-\d{3}", str(replacement.get("replacedWorkItemId") or "")
        )
        or not SHA256_PATTERN.fullmatch(
            str(replacement.get("replacedPlanSha256") or "")
        )
        or not isinstance(replacement.get("replacedTaskRevision"), int)
        or replacement["replacedTaskRevision"] < 1
    )
    evidence_invalid = (
        evidence.get("evidenceMethod") != "sha256-full-v1"
        or evidence.get("fileKind") != "video"
        or evidence.get("scope") != "local"
        or not SHA256_PATTERN.fullmatch(str(evidence.get("digest") or ""))
        or not isinstance(evidence.get("mtimeMs"), int)
        or evidence["mtimeMs"] < 0
        or not isinstance(evidence.get("size"), int)
        or evidence["size"] < 1
        or len(video_operations) != 1
        or video_operations[0].get("targetPath") != os.fspath(target)
    )
    path_invalid = (
        not target_root.is_absolute()
        or not target_root.is_dir()
        or target_root.is_symlink()
        or not target.is_absolute()
        or not target.is_file()
        or target.is_symlink()
        or not is_descendant(
            target.resolve(strict=True), target_root.resolve(strict=True)
        )
        or not is_descendant(
            target_root.resolve(strict=True), LOCAL_MEDIA_ROOT.resolve(strict=True)
        )
    )
    if identity_invalid or evidence_invalid or path_invalid:
        fail("canonical replacement target is invalid")
    stat = target.stat()
    if (
        stat.st_size != evidence["size"]
        or stat.st_mtime_ns // 1_000_000 != evidence["mtimeMs"]
        or sha256_file(target) != evidence["digest"]
    ):
        fail("canonical replacement target evidence changed")
    return [
        {
            "device": stat.st_dev,
            "digest": evidence["digest"],
            "evidenceId": evidence["evidenceId"],
            "evidenceMethod": evidence["evidenceMethod"],
            "inode": stat.st_ino,
            "linkCount": stat.st_nlink,
            "mtimeNs": stat.st_mtime_ns,
            "relativePath": target.resolve(strict=True)
            .relative_to(target_root.resolve(strict=True))
            .as_posix(),
            "replacedPlanSha256": replacement["replacedPlanSha256"],
            "replacedTaskId": replacement["replacedTaskId"],
            "replacedTaskRevision": replacement["replacedTaskRevision"],
            "replacedWorkItemId": replacement["replacedWorkItemId"],
            "size": stat.st_size,
            "targetPath": os.fspath(target),
            "workItemId": plan["workItemId"],
        }
    ]


def collect_canonical_replacements(plan_paths: list[pathlib.Path]) -> list[dict]:
    """合并批次中互不碰撞的规范目标替换收据。"""
    replacements = []
    target_paths = set()
    for plan_path in plan_paths:
        for replacement in collect_canonical_replacement(plan_path):
            if replacement["targetPath"] in target_paths:
                fail("backup batch contains a duplicate replacement target")
            target_paths.add(replacement["targetPath"])
            replacements.append(replacement)
    return replacements


def collect_canonical_plan_targets(
    plan_path: pathlib.Path,
    verification_cache_root: pathlib.Path | None = None,
    verification_tool_sha256: str | None = None,
) -> tuple[dict, list[dict], list[dict], list[dict]]:
    """校验已提交的规范目标，并优先复用同计划同工具的精确摘要记录。"""
    validate_plan_path(plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    plan_sha256 = sha256_file(plan_path)
    execution = plan.get("execution") or {}
    allowlists = execution.get("allowlists") or {}
    local_manifest_sha256 = str(
        (execution.get("manifestSha256") or {}).get("localForward") or ""
    )
    target_root = pathlib.Path(str(allowlists.get("localTargetRoot") or ""))
    if (
        plan.get("schemaVersion") != "1.2.0"
        or plan.get("sealed") is not True
        or execution.get("phase") != "local-only"
        or not re.fullmatch(r"media-\d{3}", str(plan.get("workItemId") or ""))
        or not target_root.is_absolute()
        or not target_root.is_dir()
        or target_root.is_symlink()
        or not is_descendant(
            target_root.resolve(strict=True), LOCAL_MEDIA_ROOT.resolve(strict=True)
        )
    ):
        fail("plan is not a sealed post-governance local-only media plan")
    evidence = source_evidence_by_id(plan)
    videos = []
    sidecars = []
    seen_targets = set()
    for operation in plan.get("manifests", {}).get("local", {}).get("forward", []):
        file_kind = operation.get("fileKind")
        if file_kind not in {"asset", "subtitle", "video"}:
            continue
        target = pathlib.Path(str(operation.get("targetPath") or ""))
        entry = evidence.get(operation.get("evidenceId"))
        method = entry.get("evidenceMethod") if entry else None
        if (
            operation.get("operation") != "move"
            or entry is None
            or entry.get("fileKind") != file_kind
            or entry.get("scope") != "local"
            or method
            not in {
                "bounded-sha256-first-last-4mib-v1",
                "sha256-full-v1",
                "sha256-v1",
            }
            or not target.is_absolute()
            or not target.is_file()
            or target.is_symlink()
            or not is_descendant(
                target.resolve(strict=True), target_root.resolve(strict=True)
            )
            or os.fspath(target) in seen_targets
        ):
            fail("canonical operation lacks valid local target evidence")
        seen_targets.add(os.fspath(target))
        stat = target.stat()
        cache_hit = False
        if verification_cache_root is not None:
            cache_hit = verification_record_matches(
                verification_cache_root,
                plan_sha256,
                local_manifest_sha256,
                target,
                entry,
                stat,
                str(verification_tool_sha256),
            )
            if not cache_hit:
                fail(f"canonical verification cache is incomplete or stale: {target}")
        actual_digest = entry.get("digest")
        if not cache_hit:
            if method == "bounded-sha256-first-last-4mib-v1":
                actual_digest = bounded_sha256(target)
            else:
                actual_digest = sha256_file(target)
        if stat.st_size != entry.get("size") or actual_digest != entry.get("digest"):
            fail(f"canonical target evidence changed before metadata backup: {target}")
        receipt = {
            "device": stat.st_dev,
            "digest": entry["digest"],
            "evidenceMethod": method,
            "fileKind": file_kind,
            "inode": stat.st_ino,
            "mtimeNs": stat.st_mtime_ns,
            "relativePath": target.resolve(strict=True)
            .relative_to(target_root.resolve(strict=True))
            .as_posix(),
            "size": stat.st_size,
            "targetPath": os.fspath(target),
            "workItemId": plan["workItemId"],
        }
        if verification_cache_root is not None:
            receipt["_verification"] = {
                "evidence": entry,
                "linkCount": stat.st_nlink,
                "localManifestSha256": local_manifest_sha256,
                "planSha256": plan_sha256,
                "toolSha256": verification_tool_sha256,
            }
        if file_kind == "video":
            videos.append(receipt)
        else:
            sidecars.append(receipt)
    if not videos:
        fail("plan contains no canonical local video operations")
    media_type = (plan.get("identity") or {}).get("mediaType")
    metadata_candidates = set()
    if media_type in MOVIE_METADATA_TYPES:
        if len(videos) != 1:
            fail("canonical movie metadata backup requires exactly one video")
        video_path = pathlib.Path(videos[0]["targetPath"])
        title_root = video_path.parent
        relative = video_path.resolve(strict=True).relative_to(
            target_root.resolve(strict=True)
        )
        if len(relative.parts) != 3 or relative.parts[0] != "Movies":
            fail("canonical movie video is outside one Movies title root")
        metadata_candidates.add(video_path.with_suffix(".nfo"))
        for extension in IMAGE_EXTENSIONS:
            metadata_candidates.add(video_path.with_suffix(extension))
    elif media_type == "tv" or media_type is None:
        title_roots = {
            pathlib.Path(entry["targetPath"]).parent.parent for entry in videos
        }
        series_reconciliation = plan.get("seriesReconciliation")
        multiple_roots_allowed = (
            isinstance(series_reconciliation, dict)
            and series_reconciliation.get("sourceTitleRoots")
            == sorted(os.fspath(root) for root in title_roots)
        )
        if len(title_roots) != 1 and not multiple_roots_allowed:
            fail("canonical metadata backup spans more than one title root")
        seasons_by_root = {root: set() for root in title_roots}
        for video in videos:
            video_path = pathlib.Path(video["targetPath"])
            season_match = re.fullmatch(r"Season (\d{2})", video_path.parent.name)
            episode_match = re.search(r"- S(\d{2})E\d{2,3}(?:\D|$)", video_path.stem)
            if (
                not season_match
                or not episode_match
                or season_match.group(1) != episode_match.group(1)
            ):
                fail("canonical video has no stable metadata identity")
            title_root = video_path.parent.parent
            seasons_by_root[title_root].add(int(season_match.group(1)))
            metadata_candidates.add(video_path.with_suffix(".nfo"))
            for extension in IMAGE_EXTENSIONS:
                metadata_candidates.add(video_path.with_suffix(extension))
        for title_root, seasons in seasons_by_root.items():
            metadata_candidates.add(title_root / "tvshow.nfo")
            for season in seasons:
                metadata_candidates.add(
                    title_root / f"Season {season:02d}" / "season.nfo"
                )
                for extension in IMAGE_EXTENSIONS:
                    metadata_candidates.add(
                        title_root / f"season{season:02d}-poster{extension}"
                    )
            for extension in IMAGE_EXTENSIONS:
                metadata_candidates.add(title_root / f"poster{extension}")
    else:
        fail("canonical metadata backup media type is unsupported")
    if media_type in MOVIE_METADATA_TYPES:
        for extension in IMAGE_EXTENSIONS:
            metadata_candidates.add(title_root / f"poster{extension}")
    metadata_assets = []
    for target in sorted(metadata_candidates, key=os.fspath):
        if not target.exists() and not target.is_symlink():
            continue
        if target.is_symlink() or not target.is_file():
            fail(f"replaceable metadata asset is unsafe: {target}")
        stat = target.stat()
        size_limit = (
            2 * 1024 * 1024
            if target.suffix.lower() == ".nfo"
            else 25 * 1024 * 1024
        )
        if stat.st_size < 1 or stat.st_size > size_limit:
            fail(f"replaceable metadata asset size is invalid: {target}")
        metadata_assets.append(
            {
                "device": stat.st_dev,
                "digest": sha256_file(target),
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "metadata",
                "inode": stat.st_ino,
                "mtimeNs": stat.st_mtime_ns,
                "relativePath": target.resolve(strict=True)
                .relative_to(target_root.resolve(strict=True))
                .as_posix(),
                "size": stat.st_size,
                "targetPath": os.fspath(target),
                "workItemId": plan["workItemId"],
            }
        )
    return {
        "path": os.fspath(plan_path),
        "sha256": plan_sha256,
        "videoCount": len(videos),
        "workItemId": plan["workItemId"],
        "sidecarCount": len(sidecars),
    }, videos, sidecars, metadata_assets


def collect_canonical_plan_videos(plan_path: pathlib.Path) -> tuple[dict, list[dict]]:
    """保留原有纯视频调用合同。"""
    plan, videos, _sidecars, _metadata_assets = collect_canonical_plan_targets(
        plan_path
    )
    return plan, videos


def collect_canonical_plans(
    plan_paths: list[pathlib.Path],
    verification_cache_root: pathlib.Path | None = None,
    verification_tool_sha256: str | None = None,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    plans = []
    videos = []
    sidecars = []
    metadata_assets = []
    work_items = set()
    target_paths = set()
    for path in plan_paths:
        plan, plan_videos, plan_sidecars, plan_metadata_assets = (
            collect_canonical_plan_targets(
                path,
                verification_cache_root,
                verification_tool_sha256,
            )
        )
        if plan["workItemId"] in work_items:
            fail("metadata backup batch contains a duplicate work item")
        work_items.add(plan["workItemId"])
        for target in [*plan_videos, *plan_sidecars]:
            if target["targetPath"] in target_paths:
                fail("metadata backup batch contains a duplicate canonical target")
            target_paths.add(target["targetPath"])
        for target in plan_metadata_assets:
            if target["targetPath"] in target_paths:
                fail("metadata backup contains a duplicate target")
            target_paths.add(target["targetPath"])
        plans.append(plan)
        videos.extend(plan_videos)
        sidecars.extend(plan_sidecars)
        metadata_assets.extend(plan_metadata_assets)
    return plans, videos, sidecars, metadata_assets


def backup_database(source: pathlib.Path, target: pathlib.Path) -> dict:
    if not source.is_file() or source.is_symlink() or target.exists():
        fail(f"database backup path is invalid: {source}")
    source_connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    target_connection = sqlite3.connect(target)
    try:
        source_connection.backup(target_connection)
        quick_check = target_connection.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        target_connection.close()
        source_connection.close()
    target.chmod(0o600)
    if quick_check != "ok":
        fail(f"database backup quick_check failed: {source.name}")
    return {
        "name": source.name,
        "path": os.fspath(target),
        "quickCheck": quick_check,
        "sha256": sha256_file(target),
        "size": target.stat().st_size,
    }


def write_atomic_json(path: pathlib.Path, payload: dict) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def run(args: argparse.Namespace) -> dict:
    plan_paths = [pathlib.Path(value) for value in args.plan]
    database_backup_root = pathlib.Path(args.database_backup_root)
    output = pathlib.Path(args.output)
    validate_new_path(database_backup_root, BACKUP_PARENT, "database backup root")
    validate_new_path(output, EVIDENCE_ROOT, "evidence output")
    if output.suffix != ".json":
        fail("evidence output must be JSON")
    verification_tool_sha256 = getattr(args, "verification_tool_sha256", None)
    verification_cache_root = validate_verification_cache_root(
        getattr(args, "verification_cache_root", None),
        verification_tool_sha256,
    )
    if args.post_governance_metadata:
        if not args.rollback_root:
            fail("post-governance metadata backup requires --rollback-root")
        rollback_root = pathlib.Path(args.rollback_root)
        validate_new_path(rollback_root, ROLLBACK_PARENT, "metadata rollback root")
        plans, videos, sidecars, metadata_assets = collect_canonical_plans(
            plan_paths,
            verification_cache_root,
            verification_tool_sha256,
        )
        replaced_videos = []
    else:
        if not args.rollback_root:
            fail("local media transaction backup requires --rollback-root")
        rollback_root = pathlib.Path(args.rollback_root)
        validate_new_path(rollback_root, ROLLBACK_PARENT, "rollback root")
        plans, videos = collect_plans(
            plan_paths,
            verification_cache_root,
            verification_tool_sha256,
            getattr(args, "allow_verification_cache_seed", False),
        )
        replaced_videos = collect_canonical_replacements(plan_paths)
        sidecars = []
        metadata_assets = []
    database_sources = [DATABASE_ROOT / name for name in DATABASE_NAMES]
    if any(not path.is_file() or path.is_symlink() for path in database_sources):
        fail("one or more trim.media database sources are missing")
    preview = {
        "databaseCount": len(database_sources),
        "execute": args.execute,
        "logicalVideoBytes": 0
        if args.post_governance_metadata
        else sum(entry["size"] for entry in videos),
        "metadataAssetCount": len(metadata_assets),
        "planCount": len(plans),
        "replacedCanonicalVideoCount": len(replaced_videos),
        "sidecarCount": len(sidecars),
        "videoCount": len(videos),
        "workItemIds": [entry["workItemId"] for entry in plans],
    }
    if not args.execute:
        return preview
    created_rollback = False
    created_database_backup = False
    try:
        rollback_root.mkdir(mode=0o700, parents=True)
        created_rollback = True
        database_backup_root.mkdir(mode=0o700, parents=True)
        created_database_backup = True
        hardlinks = []
        metadata_asset_hardlinks = []
        replaced_target_hardlinks = []
        if args.post_governance_metadata:
            link_sources = [
                *((entry, "sidecar") for entry in sidecars),
                *((entry, "metadata") for entry in metadata_assets),
            ]
        else:
            link_sources = [
                *((entry, "video") for entry in videos),
                *((entry, "replaced-video") for entry in replaced_videos),
            ]
        for source_receipt, link_kind in link_sources:
            source_key = "sourcePath"
            if args.post_governance_metadata or link_kind == "replaced-video":
                source_key = "targetPath"
            source = pathlib.Path(source_receipt[source_key])
            target = rollback_root / source_receipt["workItemId"]
            if link_kind == "metadata":
                target = target / ".metadata-originals"
            if link_kind == "replaced-video":
                target = (
                    target
                    / ".replaced-originals"
                    / source_receipt["replacedTaskId"]
                )
            target = target / source_receipt["relativePath"]
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.link(source, target)
            source_after = source.stat()
            target_stat = target.stat()
            hardlink_invalid = (
                target_stat.st_dev != source_receipt["device"]
                or target_stat.st_ino != source_receipt["inode"]
            )
            if not args.post_governance_metadata:
                hardlink_invalid = hardlink_invalid or (
                    source_after.st_dev != source_receipt["device"]
                    or source_after.st_ino != source_receipt["inode"]
                    or source_after.st_size != source_receipt["size"]
                    or source_after.st_mtime_ns != source_receipt["mtimeNs"]
                    or source_after.st_nlink != source_receipt["linkCount"] + 1
                    or target_stat.st_nlink != source_after.st_nlink
                    or target_stat.st_ctime_ns != source_after.st_ctime_ns
                )
            elif link_kind == "sidecar" and verification_cache_root is not None:
                verification = source_receipt.get("_verification")
                if not isinstance(verification, dict):
                    fail("sidecar verification transition context is missing")
                hardlink_invalid = hardlink_invalid or (
                    source_after.st_dev != source_receipt["device"]
                    or source_after.st_ino != source_receipt["inode"]
                    or source_after.st_size != source_receipt["size"]
                    or source_after.st_mtime_ns != source_receipt["mtimeNs"]
                    or source_after.st_nlink != verification["linkCount"] + 1
                    or target_stat.st_nlink != source_after.st_nlink
                    or target_stat.st_ctime_ns != source_after.st_ctime_ns
                )
            if hardlink_invalid:
                fail(f"rollback target is not the same hardlink: {target}")
            verification = source_receipt.get("_verification")
            should_update_verification = (
                not args.post_governance_metadata
                and link_kind != "replaced-video"
            )
            if args.post_governance_metadata and link_kind == "sidecar":
                should_update_verification = True
            if verification_cache_root is not None and should_update_verification:
                if not isinstance(verification, dict):
                    fail("verification transition context is missing")
                write_verification_record(
                    verification_cache_root,
                    verification["planSha256"],
                    verification["localManifestSha256"],
                    source,
                    verification["evidence"],
                    source_after,
                    verification["toolSha256"],
                )
            receipt = {
                **{
                    key: source_receipt[key]
                    for key in source_receipt
                    if key not in {"_verification", "relativePath"}
                },
                "rollbackPath": os.fspath(target),
            }
            if not args.post_governance_metadata:
                receipt["ctimeNs"] = source_after.st_ctime_ns
                receipt["linkCount"] = source_after.st_nlink
            if link_kind == "metadata":
                metadata_asset_hardlinks.append(receipt)
            elif link_kind == "replaced-video":
                replaced_target_hardlinks.append(receipt)
            else:
                hardlinks.append(receipt)
        databases = [
            backup_database(source, database_backup_root / source.name)
            for source in database_sources
        ]
        canonical_videos = []
        if args.post_governance_metadata:
            canonical_videos = [
                {
                    key: entry[key]
                    for key in entry
                    if key != "_verification"
                }
                for entry in videos
            ]
        payload = {
            "capturedAt": utc_now(),
            "databaseBackupRoot": os.fspath(database_backup_root),
            "databases": databases,
            "hardlinkCount": len(hardlinks),
            "hardlinks": [] if args.post_governance_metadata else hardlinks,
            "canonicalVideos": canonical_videos,
            "logicalSidecarBytes": (
                sum(entry["size"] for entry in hardlinks)
                if args.post_governance_metadata
                else 0
            ),
            "logicalMetadataAssetBytes": sum(
                entry["size"] for entry in metadata_asset_hardlinks
            ),
            "logicalVideoBytes": (
                0
                if args.post_governance_metadata
                else sum(entry["size"] for entry in hardlinks)
            ),
            "logicalReplacedCanonicalVideoBytes": sum(
                entry["size"] for entry in replaced_target_hardlinks
            ),
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "formalMediaWrites": 0,
                "serviceMutation": False,
                "uiWrites": 0,
            },
            "plans": plans,
            "protectedSidecars": hardlinks if args.post_governance_metadata else [],
            "metadataAssetHardlinkCount": len(metadata_asset_hardlinks),
            "replaceableMetadataAssets": metadata_asset_hardlinks,
            "replacedCanonicalVideos": replaced_target_hardlinks,
            "rollbackRoot": os.fspath(rollback_root),
            "schemaVersion": (
                "media-post-governance-metadata-backup-v2"
                if args.post_governance_metadata
                else "media-local-transaction-backup-v1"
            ),
            "state": "database-backup-complete"
            if args.post_governance_metadata
            else "transaction-backup-complete",
        }
        write_atomic_json(output, payload)
        return {
            **preview,
            "databaseQuickCheck": [entry["quickCheck"] for entry in databases],
            "evidenceSha256": sha256_file(output),
            "output": os.fspath(output),
            "state": payload["state"],
        }
    except Exception:
        if created_database_backup and database_backup_root.exists():
            shutil.rmtree(database_backup_root)
        if created_rollback and rollback_root.exists():
            shutil.rmtree(rollback_root)
        output.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create same-device video hardlinks or post-governance SQLite "
            "backups for sealed local plans."
        )
    )
    parser.add_argument("--plan", action="append", required=True)
    parser.add_argument("--rollback-root")
    parser.add_argument("--database-backup-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--post-governance-metadata", action="store_true")
    parser.add_argument("--verification-cache-root")
    parser.add_argument("--verification-tool-sha256")
    parser.add_argument("--allow-verification-cache-seed", action="store_true")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    print(json.dumps(run(parse_args()), ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
