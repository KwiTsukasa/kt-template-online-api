#!/usr/bin/env python3
"""把本地规范媒体包按路径和大小热备到固定 AList/Quark 边界。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import html
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import time
from typing import Any, BinaryIO, Callable
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "http://127.0.0.1:5244/alist"
CLOUD_ROOT = "/Media/movie"
DEFAULT_EVIDENCE_ROOT = Path("/vol1/docker/kt-media-governance/evidence")
DEFAULT_LOCAL_MEDIA_ROOT = Path("/vol2/1000/Media")
SOURCE_MAPPINGS = (
    ("movie/TV", "TV"),
    ("movie/Movies", "Movies"),
    ("extras", "extras"),
)
SCHEMA_VERSION = "media-cloud-hot-backup-v1"
RUN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{2,47}$")
NUMBERED_DUPLICATE_PATTERN = re.compile(r"^(?P<base>.+)\((?P<index>[1-9][0-9]*)\)$")
MAX_RECONCILIATION_FILES = 100
UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024
UPLOAD_RATE_LIMIT_BYTES_PER_SECOND: int | None = None
VIDEO_EXTENSIONS = {
    ".3gp",
    ".avi",
    ".flv",
    ".m2ts",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".mts",
    ".ts",
    ".vob",
    ".webm",
    ".wmv",
}


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


def stable_digest(value: Any) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def verify_script_digest() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if expected and sha256_file(Path(__file__)) != expected:
        raise RuntimeError("script SHA-256 does not match the sealed release")


def write_json_exclusive(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    path.chmod(0o600)


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.partial-{os.getpid()}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        if temporary.exists():
            temporary.unlink()


def require_safe_regular_file(path: Path, label: str) -> os.stat_result:
    try:
        current = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"{label} is missing") from error
    if stat.S_ISLNK(current.st_mode) or not stat.S_ISREG(current.st_mode):
        raise RuntimeError(f"{label} is not a safe regular file")
    return current


def validate_ledger(
    path: Path,
    expected_sha256: str,
    expected_item_count: int,
    expected_video_count: int,
) -> dict[str, Any]:
    require_safe_regular_file(path, "ledger")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError("ledger SHA-256 changed")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if (
        payload.get("schemaVersion") != "1.2.0"
        or payload.get("authority") != "fnos-local"
        or payload.get("executionOrder") != "local-all-then-cloud-batch"
        or payload.get("expectedItemCount") != expected_item_count
        or payload.get("expectedVideoCount") != expected_video_count
        or payload.get("localMediaRoot") != str(DEFAULT_LOCAL_MEDIA_ROOT)
        or payload.get("cloudVideoRoot") != CLOUD_ROOT
    ):
        raise RuntimeError("ledger authority or cloud batch contract changed")
    items = payload.get("items")
    if not isinstance(items, list) or len(items) != expected_item_count:
        raise RuntimeError("ledger item count changed")
    if any(
        not isinstance(item, dict)
        or item.get("inventoryState") not in {"local_reconciled", "reconciled"}
        for item in items
    ):
        raise RuntimeError("ledger contains an unfinished item")
    if sum(int(item.get("videoCount", -1)) for item in items) != expected_video_count:
        raise RuntimeError("ledger video count changed")
    return {
        "expectedItemCount": expected_item_count,
        "expectedVideoCount": expected_video_count,
        "ledgerSha256": actual_sha256,
        "localReconciledItemCount": len(items),
    }


def _safe_child_name(name: str) -> bool:
    return (
        name not in {".", ".."}
        and "/" not in name
        and "\x00" not in name
        and not any(ord(character) < 32 or ord(character) == 127 for character in name)
        and not name.casefold().startswith(".kt-")
        and name not in {".DS_Store", "Thumbs.db"}
    )


def _canonical_provider_name(name: str) -> str:
    if not _safe_child_name(name):
        raise RuntimeError("AList target contains an unsafe name")
    canonical = html.unescape(name)
    if not _safe_child_name(canonical):
        raise RuntimeError("AList target contains an unsafe canonical name")
    return canonical


def canonical_inventory(local_media_root: Path) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    directory_count = 0
    video_count_by_root: dict[str, int] = {}
    for local_relative, cloud_relative in SOURCE_MAPPINGS:
        video_count_by_root[local_relative] = 0
        fixed_root = local_media_root / local_relative
        try:
            fixed_stat = fixed_root.lstat()
        except FileNotFoundError as error:
            raise RuntimeError(f"canonical root is missing: {local_relative}") from error
        if stat.S_ISLNK(fixed_stat.st_mode) or not stat.S_ISDIR(fixed_stat.st_mode):
            raise RuntimeError(f"canonical root is unsafe: {local_relative}")
        pending = [fixed_root]
        while pending:
            directory = pending.pop()
            directory_count += 1
            directories: list[Path] = []
            for child in sorted(os.scandir(directory), key=lambda entry: entry.name):
                if not _safe_child_name(child.name):
                    relative = Path(child.path).relative_to(local_media_root).as_posix()
                    raise RuntimeError(f"canonical tree contains an unsafe name: {relative}")
                current = os.lstat(child.path)
                if stat.S_ISLNK(current.st_mode):
                    raise RuntimeError("canonical tree contains a symlink")
                if stat.S_ISDIR(current.st_mode):
                    directories.append(Path(child.path))
                    continue
                if not stat.S_ISREG(current.st_mode):
                    raise RuntimeError("canonical tree contains a special node")
                source_path = Path(child.path)
                relative = source_path.relative_to(fixed_root).as_posix()
                target_path = str(PurePosixPath(CLOUD_ROOT, cloud_relative, relative))
                is_video = source_path.suffix.casefold() in VIDEO_EXTENSIONS
                if is_video:
                    video_count_by_root[local_relative] += 1
                files.append(
                    {
                        "modifiedNs": current.st_mtime_ns,
                        "relativePath": str(
                            PurePosixPath(cloud_relative, relative)
                        ),
                        "size": current.st_size,
                        "sourcePath": str(source_path),
                        "targetPath": target_path,
                        "video": is_video,
                    }
                )
            pending.extend(reversed(directories))
    files.sort(key=lambda row: row["targetPath"])
    identity_rows = [
        {
            "modifiedNs": row["modifiedNs"],
            "size": row["size"],
            "targetPath": row["targetPath"],
        }
        for row in files
    ]
    return {
        "digest": stable_digest(identity_rows),
        "directoryCount": directory_count,
        "fileCount": len(files),
        "files": files,
        "logicalBytes": sum(row["size"] for row in files),
        "videoCount": sum(bool(row["video"]) for row in files),
        "videoCountByRoot": video_count_by_root,
    }


class AlistClient:
    def __init__(self, password: str):
        if not password or "\n" in password or "\r" in password:
            raise RuntimeError("AList password input is invalid")
        self._token = ""
        self._login(password)

    def _json_request(
        self,
        route: str,
        body: dict[str, Any] | None = None,
        *,
        method: str = "POST",
        timeout: int = 30,
        anonymous: bool = False,
    ) -> dict[str, Any]:
        encoded = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"content-type": "application/json"}
        if self._token and not anonymous:
            headers["authorization"] = self._token
        request = urllib.request.Request(
            API_BASE + route,
            data=encoded,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
                return {"http": response.status, "payload": payload}
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"code": error.code, "message": "non-json response"}
            return {"http": error.code, "payload": payload}

    @staticmethod
    def _require_success(result: dict[str, Any], label: str) -> dict[str, Any]:
        payload = result.get("payload")
        if result.get("http") != 200 or not isinstance(payload, dict) or payload.get("code") != 200:
            code = payload.get("code") if isinstance(payload, dict) else result.get("http")
            message = payload.get("message") if isinstance(payload, dict) else "invalid response"
            raise RuntimeError(f"{label} failed with code {code}: {message}")
        return payload

    @staticmethod
    def _not_found(result: dict[str, Any]) -> bool:
        payload = result.get("payload")
        return (
            result.get("http") == 200
            and isinstance(payload, dict)
            and payload.get("code") == 500
            and any(
                marker in str(payload.get("message", "")).casefold()
                for marker in (
                    "not found",
                    "not exist",
                    "object does not exist",
                    "path does not exist",
                )
            )
        )

    def _login(self, password: str) -> None:
        payload = self._require_success(
            self._json_request(
                "/api/auth/login",
                {"password": password, "username": "admin"},
                anonymous=True,
                timeout=15,
            ),
            "AList login",
        )
        token = payload.get("data", {}).get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError("AList login returned no token")
        self._token = token

    def close(self) -> None:
        if not self._token:
            return
        try:
            self._json_request("/api/auth/logout", method="GET", timeout=10)
        finally:
            self._token = ""

    def list_directory(self, path: str) -> list[dict[str, Any]]:
        result = self._json_request(
            "/api/fs/list",
            {
                "page": 1,
                "password": "",
                "path": path,
                "per_page": 1000,
                "refresh": True,
            },
        )
        if self._not_found(result):
            raise RuntimeError(f"AList target directory is missing: {path}")
        payload = self._require_success(result, "AList list")
        data = payload.get("data") or {}
        content = data.get("content") or []
        if not isinstance(content, list):
            raise RuntimeError("AList list returned invalid content")
        total = data.get("total", len(content))
        if isinstance(total, int) and total > len(content):
            raise RuntimeError(f"AList directory exceeds 1000 entries: {path}")
        return content

    def ensure_directory(self, path: str) -> None:
        relative = PurePosixPath(path).relative_to(PurePosixPath(CLOUD_ROOT))
        current = PurePosixPath(CLOUD_ROOT)
        for segment in relative.parts:
            current = current / segment
            current_path = str(current)
            parent = str(current.parent)
            existing = next(
                (
                    entry
                    for entry in self.list_directory(parent)
                    if isinstance(entry.get("name"), str)
                    and _canonical_provider_name(entry["name"]) == segment
                ),
                None,
            )
            if existing is not None:
                if existing.get("is_dir") is not True:
                    raise RuntimeError(f"AList target parent is not a directory: {current_path}")
                continue
            self._require_success(
                self._json_request("/api/fs/mkdir", {"path": current_path}),
                "AList mkdir",
            )
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                created = next(
                    (
                        entry
                        for entry in self.list_directory(parent)
                        if isinstance(entry.get("name"), str)
                        and _canonical_provider_name(entry["name"]) == segment
                    ),
                    None,
                )
                if created is not None:
                    if created.get("is_dir") is not True:
                        raise RuntimeError(f"AList mkdir returned a file: {current_path}")
                    break
                time.sleep(2)
            else:
                raise RuntimeError(f"AList mkdir postcondition failed: {current_path}")

    def file_observation(self, path: str) -> dict[str, Any]:
        parent = str(PurePosixPath(path).parent)
        name = PurePosixPath(path).name
        uploaded = next(
            (
                entry
                for entry in self.list_directory(parent)
                if isinstance(entry.get("name"), str)
                and _canonical_provider_name(entry["name"]) == name
            ),
            None,
        )
        if uploaded is None:
            return {"exists": False, "isDirectory": None, "size": None}
        size = uploaded.get("size")
        return {
            "exists": True,
            "isDirectory": uploaded.get("is_dir"),
            "size": size if isinstance(size, int) and size >= 0 else None,
        }

    def wait_for_file(self, path: str, expected_size: int) -> bool:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            uploaded = self.file_observation(path)
            if (
                uploaded["exists"]
                and uploaded["isDirectory"] is False
                and uploaded.get("size") == expected_size
            ):
                return True
            time.sleep(2)
        return False

    def upload(self, source_path: Path, target_path: str, timeout: int = 7200) -> None:
        parsed = urllib.parse.urlsplit(API_BASE)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
            raise RuntimeError("AList upload endpoint is not loopback HTTP")
        size = source_path.stat().st_size
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=timeout)
        endpoint = parsed.path.rstrip("/") + "/api/fs/put"
        connection.putrequest("PUT", endpoint)
        connection.putheader("authorization", self._token)
        connection.putheader("File-Path", urllib.parse.quote(target_path, safe=""))
        connection.putheader("As-Task", "false")
        connection.putheader("Content-Type", "application/octet-stream")
        connection.putheader("Content-Length", str(size))
        connection.endheaders()
        with source_path.open("rb") as source:
            send_file_with_rate_limit(connection, source)
        response = connection.getresponse()
        raw = response.read().decode("utf-8", errors="replace")
        connection.close()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"code": response.status, "message": "non-json response"}
        self._require_success({"http": response.status, "payload": payload}, "AList upload")

    def remove_files(self, directory: str, names: list[str]) -> None:
        directory_path = PurePosixPath(directory)
        try:
            directory_path.relative_to(PurePosixPath(CLOUD_ROOT))
        except ValueError as error:
            raise RuntimeError("AList removal directory is outside the cloud root") from error
        if not names or len(names) > MAX_RECONCILIATION_FILES:
            raise RuntimeError("AList removal names are empty or exceed the safety bound")
        if len(set(names)) != len(names) or any(not _safe_child_name(name) for name in names):
            raise RuntimeError("AList removal names are unsafe")
        self._require_success(
            self._json_request(
                "/api/fs/remove",
                {"dir": directory, "names": names},
                timeout=120,
            ),
            "AList remove",
        )

    def inventory(self, root: str = CLOUD_ROOT) -> dict[str, Any]:
        files: list[dict[str, Any]] = []
        canonical_paths: set[str] = set()
        pending = [(root, root)]
        while pending:
            provider_directory, canonical_directory = pending.pop()
            directories: list[tuple[str, str]] = []
            for child in self.list_directory(provider_directory):
                name = child.get("name")
                if not isinstance(name, str) or not _safe_child_name(name):
                    raise RuntimeError("AList target contains an unsafe name")
                canonical_name = _canonical_provider_name(name)
                candidate = str(PurePosixPath(provider_directory, name))
                canonical_candidate = str(
                    PurePosixPath(canonical_directory, canonical_name)
                )
                if child.get("is_dir") is True:
                    directories.append((candidate, canonical_candidate))
                    continue
                size = child.get("size")
                if child.get("is_dir") is not False or not isinstance(size, int) or size < 0:
                    raise RuntimeError("AList target returned invalid file metadata")
                if canonical_candidate in canonical_paths:
                    raise RuntimeError(
                        f"AList target contains a canonical path collision: {canonical_candidate}"
                    )
                canonical_paths.add(canonical_candidate)
                files.append(
                    {
                        "providerPath": candidate,
                        "size": size,
                        "targetPath": canonical_candidate,
                    }
                )
            pending.extend(reversed(sorted(directories)))
        files.sort(key=lambda row: row["targetPath"])
        return {
            "digest": stable_digest(files),
            "fileCount": len(files),
            "files": files,
            "logicalBytes": sum(row["size"] for row in files),
        }


def send_file_with_rate_limit(
    connection: http.client.HTTPConnection,
    source: BinaryIO,
    *,
    bytes_per_second: int | None = UPLOAD_RATE_LIMIT_BYTES_PER_SECOND,
    chunk_bytes: int = UPLOAD_CHUNK_BYTES,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    if chunk_bytes <= 0 or (
        bytes_per_second is not None and bytes_per_second <= 0
    ):
        raise ValueError("upload rate limit must be positive")
    started = monotonic() if bytes_per_second is not None else 0.0
    sent = 0
    for chunk in iter(lambda: source.read(chunk_bytes), b""):
        connection.send(chunk)
        sent += len(chunk)
        if bytes_per_second is not None:
            delay = sent / bytes_per_second - (monotonic() - started)
            if delay > 0:
                sleep(delay)
    return sent


def unthrottled_resource_policy() -> dict[str, Any]:
    return {
        "cpuNice": os.getpriority(os.PRIO_PROCESS, 0),
        "ioClass": "default",
        "uploadRateLimitBytesPerSecond": UPLOAD_RATE_LIMIT_BYTES_PER_SECOND,
    }


def upload_with_retry(
    client: AlistClient,
    source_path: Path,
    target_path: str,
    expected_size: int,
    *,
    attempts: int = 3,
    retry_delay_seconds: float = 15,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    if attempts < 1:
        raise ValueError("upload attempts must be positive")
    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            client.upload(source_path, target_path)
            last_error = None
        except (OSError, http.client.HTTPException, RuntimeError) as error:
            last_error = error
        if client.wait_for_file(target_path, expected_size):
            return attempt
        if last_error is None:
            observe = getattr(client, "file_observation", None)
            observation = (
                observe(target_path)
                if callable(observe)
                else {"exists": None, "isDirectory": None, "size": None}
            )
            last_error = RuntimeError(
                "uploaded file failed exact size verification:"
                f"targetPath={target_path}:expectedSize={expected_size}:"
                f"actualSize={observation.get('size')}:"
                f"exists={observation.get('exists')}:"
                f"isDirectory={observation.get('isDirectory')}"
            )
        if attempt < attempts:
            sleep(retry_delay_seconds * attempt)
    if last_error is None:
        raise RuntimeError("upload failed without an error")
    raise last_error


def compare_inventories(local: dict[str, Any], cloud: dict[str, Any]) -> dict[str, Any]:
    local_index = {row["targetPath"]: row["size"] for row in local["files"]}
    cloud_index = {row["targetPath"]: row["size"] for row in cloud["files"]}
    missing = sorted(path for path in local_index if path not in cloud_index)
    unexpected = sorted(path for path in cloud_index if path not in local_index)
    mismatched = sorted(
        path
        for path in local_index.keys() & cloud_index.keys()
        if local_index[path] != cloud_index[path]
    )
    mismatched_files = [
        {
            "actualSize": cloud_index[path],
            "expectedSize": local_index[path],
            "targetPath": path,
        }
        for path in mismatched[:20]
    ]
    cloud_rows = {row["targetPath"]: row for row in cloud["files"]}
    unexpected_files = [
        {
            "providerPath": cloud_rows[path].get("providerPath", path),
            "size": cloud_index[path],
            "targetPath": path,
        }
        for path in unexpected[:20]
    ]
    return {
        "accepted": not missing and not unexpected and not mismatched,
        "matchedBytes": sum(
            size
            for path, size in local_index.items()
            if cloud_index.get(path) == size
        ),
        "matchedFiles": sum(cloud_index.get(path) == size for path, size in local_index.items()),
        "mismatchedCount": len(mismatched),
        "mismatchedFiles": mismatched_files,
        "missingCount": len(missing),
        "missingPaths": missing[:20],
        "unexpectedCount": len(unexpected),
        "unexpectedFiles": unexpected_files,
        "unexpectedPaths": unexpected[:20],
    }


def require_cloud_upload_compatibility(comparison: dict[str, Any]) -> int:
    mismatched_count = comparison.get("mismatchedCount")
    unexpected_count = comparison.get("unexpectedCount")
    if not isinstance(mismatched_count, int) or not isinstance(unexpected_count, int):
        raise RuntimeError("cloud comparison contract is invalid")
    if mismatched_count:
        raise RuntimeError(
            f"cloud target contains {mismatched_count} conflicting files"
        )
    return unexpected_count


def read_password_from_stdin() -> str:
    password = sys.stdin.read().rstrip("\r\n")
    if not password or len(password) > 512 or "\n" in password or "\r" in password:
        raise RuntimeError("AList password stdin is invalid")
    return password


def evidence_paths(evidence_root: Path, run_id: str) -> dict[str, Path]:
    directory = evidence_root / run_id
    return {
        "directory": directory,
        "lock": directory / "cloud-hot-backup.lock",
        "log": directory / "cloud-hot-backup.log",
        "preflight": directory / "cloud-hot-backup-preflight.json",
        "reconciliation": directory / "cloud-hot-backup-reconciliation.json",
        "reconciliationReceipt": directory / "cloud-hot-backup-reconciliation-receipt.json",
        "state": directory / "cloud-hot-backup-state.json",
        "verify": directory / "cloud-hot-backup-verification.json",
    }


def seal_resume_inventory_snapshot(
    paths: dict[str, Path],
    identity: dict[str, str],
    local: dict[str, Any],
) -> dict[str, str]:
    inventory_digest = local.get("digest")
    if not isinstance(inventory_digest, str) or not re.fullmatch(
        r"[0-9a-f]{64}", inventory_digest
    ):
        raise RuntimeError("canonical inventory digest is invalid")
    snapshot_path = (
        paths["directory"]
        / f"cloud-hot-backup-inventory-{inventory_digest}.json"
    )
    contract = {
        "identity": identity,
        "local": {
            key: local[key]
            for key in (
                "digest",
                "directoryCount",
                "fileCount",
                "logicalBytes",
                "videoCount",
                "videoCountByRoot",
            )
        },
        "schemaVersion": SCHEMA_VERSION,
        "state": "cloud-hot-backup-resume-inventory-sealed",
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "localMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }
    if snapshot_path.exists():
        require_safe_regular_file(snapshot_path, "resume inventory snapshot")
        existing = json.loads(snapshot_path.read_text(encoding="utf-8"))
        if {key: existing.get(key) for key in contract} != contract:
            raise RuntimeError("resume inventory snapshot contract changed")
    else:
        write_json_exclusive(
            snapshot_path,
            {**contract, "sealedAt": utc_now()},
        )
    return {
        "digest": inventory_digest,
        "path": str(snapshot_path),
        "sha256": sha256_file(snapshot_path),
    }


def preflight(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    output_path: Path,
    password: str,
    run_id: str,
) -> dict[str, Any]:
    ledger = validate_ledger(
        ledger_path,
        ledger_sha256,
        expected_item_count,
        expected_video_count,
    )
    local = canonical_inventory(local_media_root)
    if local["videoCount"] < expected_video_count:
        raise RuntimeError(
            "canonical video count is below the completed ledger baseline: "
            f"actual={local['videoCount']} expectedMinimum={expected_video_count} "
            f"byRoot={json.dumps(local['videoCountByRoot'], sort_keys=True)}"
        )
    client = AlistClient(password)
    try:
        cloud = client.inventory()
    finally:
        client.close()
    blockers: list[str] = []
    if cloud["fileCount"] != 0:
        blockers.append("cloud-target-not-empty")
    if local["fileCount"] < local["videoCount"]:
        blockers.append("canonical-file-count-invalid")
    payload = {
        "blockers": blockers,
        "canStart": not blockers,
        "cloud": {
            "fileCount": cloud["fileCount"],
            "logicalBytes": cloud["logicalBytes"],
        },
        "createdAt": utc_now(),
        "dataPlane": "alist-native-api",
        "ledger": ledger,
        "local": {
            key: local[key]
            for key in (
                "digest",
                "directoryCount",
                "fileCount",
                "logicalBytes",
                "videoCount",
                "videoCountByRoot",
            )
        },
        "runId": run_id,
        "schemaVersion": SCHEMA_VERSION,
        "state": "cloud-hot-backup-preflight-passed" if not blockers else "cloud-hot-backup-preflight-blocked",
        "supplementaryVideoCount": local["videoCount"] - expected_video_count,
        "targetIdentity": {
            "apiBase": API_BASE,
            "storageRoot": CLOUD_ROOT,
            "username": "admin",
        },
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "localMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }
    write_json_exclusive(output_path, payload)
    return payload


def _load_preflight(
    path: Path,
    expected_sha256: str,
    ledger_sha256: str,
    run_id: str,
) -> dict[str, Any]:
    require_safe_regular_file(path, "preflight evidence")
    if sha256_file(path) != expected_sha256:
        raise RuntimeError("preflight evidence SHA-256 changed")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if (
        payload.get("schemaVersion") != SCHEMA_VERSION
        or payload.get("state") != "cloud-hot-backup-preflight-passed"
        or payload.get("canStart") is not True
        or payload.get("ledger", {}).get("ledgerSha256") != ledger_sha256
        or payload.get("runId") != run_id
        or payload.get("targetIdentity", {}).get("apiBase") != API_BASE
        or payload.get("targetIdentity", {}).get("storageRoot") != CLOUD_ROOT
    ):
        raise RuntimeError("preflight evidence contract is invalid")
    return payload


def _semantic_title(target_path: str) -> str:
    parts = PurePosixPath(target_path).parts
    if len(parts) >= 5 and parts[3] in {"TV", "Movies"}:
        return parts[4]
    if len(parts) >= 4 and parts[3] == "extras":
        return "extras"
    return "媒体资源"


def _state_payload(
    *,
    completed_bytes: int,
    completed_files: int,
    current_title: str | None,
    attempt_started_bytes: int,
    phase: str,
    pid: int,
    resource_policy: dict[str, Any] | None,
    started_monotonic: float,
    total_bytes: int,
    total_files: int,
    current_target: dict[str, Any] | None = None,
    error: str | None = None,
    identity: dict[str, str],
) -> dict[str, Any]:
    elapsed = max(time.monotonic() - started_monotonic, 0.001)
    uploaded_bytes = max(completed_bytes - attempt_started_bytes, 0)
    speed = uploaded_bytes / elapsed
    remaining = max(total_bytes - completed_bytes, 0)
    eta = round(remaining / speed) if speed > 0 else None
    return {
        "completedBytes": completed_bytes,
        "completedFiles": completed_files,
        "currentTitle": current_title,
        "currentTarget": current_target,
        "error": error,
        "etaSeconds": eta,
        "phase": phase,
        "pid": pid,
        "identity": identity,
        "schemaVersion": SCHEMA_VERSION,
        "resourcePolicy": resource_policy,
        "speedBytesPerSecond": round(speed),
        "totalBytes": total_bytes,
        "totalFiles": total_files,
        "updatedAt": utc_now(),
        "uploadedBytesThisAttempt": uploaded_bytes,
    }


def _safe_file_observation(
    client: AlistClient | None,
    current_target: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if client is None or current_target is None:
        return current_target
    try:
        observation = client.file_observation(current_target["targetPath"])
    except (OSError, http.client.HTTPException, RuntimeError):
        observation = {"exists": None, "isDirectory": None, "size": None}
    return {**current_target, **observation}


def _run_worker(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    password: str,
    preflight_path: Path,
    preflight_sha256: str,
    run_id: str,
) -> None:
    paths = evidence_paths(evidence_root, run_id)
    started = time.monotonic()
    stopped = False

    def request_stop(_signum: int, _frame: Any) -> None:
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    completed_files = 0
    completed_bytes = 0
    attempt_started_bytes = 0
    total_files = 0
    total_bytes = 0
    uploaded_files = 0
    uploaded_bytes = 0
    identity = {
        "ledgerSha256": ledger_sha256,
        "preflightSha256": preflight_sha256,
        "runId": run_id,
    }
    client: AlistClient | None = None
    current_title: str | None = None
    current_target: dict[str, Any] | None = None
    resource_policy: dict[str, Any] | None = None
    try:
        resource_policy = unthrottled_resource_policy()
        preflight_payload = _load_preflight(
            preflight_path,
            preflight_sha256,
            ledger_sha256,
            run_id,
        )
        validate_ledger(
            ledger_path,
            ledger_sha256,
            expected_item_count,
            expected_video_count,
        )
        local = canonical_inventory(local_media_root)
        total_files = local["fileCount"]
        total_bytes = local["logicalBytes"]
        if local["digest"] != preflight_payload["local"]["digest"]:
            snapshot = seal_resume_inventory_snapshot(paths, identity, local)
            identity["inventoryDigest"] = snapshot["digest"]
            identity["inventorySnapshotSha256"] = snapshot["sha256"]
        client = AlistClient(password)
        password = ""
        cloud = client.inventory()
        comparison = compare_inventories(local, cloud)
        unexpected_count = require_cloud_upload_compatibility(comparison)
        identity["unexpectedFilesAtStart"] = str(unexpected_count)
        cloud_index = {row["targetPath"]: row["size"] for row in cloud["files"]}
        completed_files = comparison["matchedFiles"]
        completed_bytes = comparison["matchedBytes"]
        attempt_started_bytes = completed_bytes
        write_json_atomic(
            paths["state"],
            _state_payload(
                completed_bytes=completed_bytes,
                completed_files=completed_files,
                current_title=None,
                attempt_started_bytes=attempt_started_bytes,
                identity=identity,
                phase="uploading",
                pid=os.getpid(),
                resource_policy=resource_policy,
                started_monotonic=started,
                total_bytes=local["logicalBytes"],
                total_files=local["fileCount"],
            ),
        )
        ensured: set[str] = set()
        for row in local["files"]:
            if stopped:
                raise InterruptedError("hot backup was stopped")
            target_path = row["targetPath"]
            if cloud_index.get(target_path) == row["size"]:
                continue
            current_source = Path(row["sourcePath"])
            current = require_safe_regular_file(current_source, "canonical source")
            if current.st_size != row["size"] or current.st_mtime_ns != row["modifiedNs"]:
                raise RuntimeError("canonical source drifted during upload")
            parent = str(PurePosixPath(target_path).parent)
            if parent not in ensured:
                client.ensure_directory(parent)
                ensured.add(parent)
            current_title = _semantic_title(target_path)
            current_target = {
                "expectedSize": row["size"],
                "targetPath": target_path,
            }
            upload_with_retry(client, current_source, target_path, row["size"])
            cloud_index[target_path] = row["size"]
            completed_files += 1
            completed_bytes += row["size"]
            uploaded_files += 1
            uploaded_bytes += row["size"]
            write_json_atomic(
                paths["state"],
                _state_payload(
                    completed_bytes=completed_bytes,
                    completed_files=completed_files,
                    current_title=current_title,
                    current_target=current_target,
                    attempt_started_bytes=attempt_started_bytes,
                    identity=identity,
                    phase="uploading",
                    pid=os.getpid(),
                    resource_policy=resource_policy,
                    started_monotonic=started,
                    total_bytes=local["logicalBytes"],
                    total_files=local["fileCount"],
                ),
            )
        write_json_atomic(
            paths["state"],
            _state_payload(
                completed_bytes=completed_bytes,
                completed_files=completed_files,
                current_title=None,
                current_target=None,
                attempt_started_bytes=attempt_started_bytes,
                identity=identity,
                phase="verifying",
                pid=os.getpid(),
                resource_policy=resource_policy,
                started_monotonic=started,
                total_bytes=local["logicalBytes"],
                total_files=local["fileCount"],
            ),
        )
        cloud = client.inventory()
        comparison = compare_inventories(local, cloud)
        unexpected_count = require_cloud_upload_compatibility(comparison)
        if comparison["missingCount"]:
            raise RuntimeError("cloud inventory did not converge after upload")
        if unexpected_count:
            write_json_atomic(
                paths["state"],
                _state_payload(
                    completed_bytes=completed_bytes,
                    completed_files=completed_files,
                    current_title=None,
                    current_target=None,
                    attempt_started_bytes=attempt_started_bytes,
                    error=(
                        f"cloud target retains {unexpected_count} stale files "
                        "pending sealed reconciliation"
                    ),
                    identity=identity,
                    phase="reconcile-required",
                    pid=os.getpid(),
                    resource_policy=resource_policy,
                    started_monotonic=started,
                    total_bytes=local["logicalBytes"],
                    total_files=local["fileCount"],
                ),
            )
            return
        verify_payload = {
            "acceptedAt": utc_now(),
            "cloud": {
                key: cloud[key]
                for key in ("digest", "fileCount", "logicalBytes")
            },
            "comparison": comparison,
            "local": {
                key: local[key]
                for key in ("digest", "fileCount", "logicalBytes", "videoCount")
            },
            "schemaVersion": SCHEMA_VERSION,
            "state": "cloud-hot-backup-accepted",
            "identity": identity,
            "writeBoundaries": {
                "cloudUploadedBytesThisAttempt": uploaded_bytes,
                "cloudUploadsThisAttempt": uploaded_files,
                "databaseDirect": 0,
                "localMedia": 0,
                "mechanicalScan": 0,
                "ui": 0,
            },
        }
        write_json_exclusive(paths["verify"], verify_payload)
        write_json_atomic(
            paths["state"],
            _state_payload(
                completed_bytes=completed_bytes,
                completed_files=completed_files,
                current_title=None,
                current_target=None,
                attempt_started_bytes=attempt_started_bytes,
                identity=identity,
                phase="accepted",
                pid=os.getpid(),
                resource_policy=resource_policy,
                started_monotonic=started,
                total_bytes=local["logicalBytes"],
                total_files=local["fileCount"],
            ),
        )
    except InterruptedError as error:
        write_json_atomic(
            paths["state"],
            _state_payload(
                completed_bytes=completed_bytes,
                completed_files=completed_files,
                current_title=None,
                current_target=None,
                attempt_started_bytes=attempt_started_bytes,
                error=str(error),
                identity=identity,
                phase="stopped",
                pid=os.getpid(),
                resource_policy=resource_policy,
                started_monotonic=started,
                total_bytes=total_bytes,
                total_files=total_files,
            ),
        )
    except Exception as error:  # noqa: BLE001 - persisted failure evidence is required.
        write_json_atomic(
            paths["state"],
            _state_payload(
                completed_bytes=completed_bytes,
                completed_files=completed_files,
                current_title=current_title,
                current_target=_safe_file_observation(client, current_target),
                attempt_started_bytes=attempt_started_bytes,
                error=str(error),
                identity=identity,
                phase="failed",
                pid=os.getpid(),
                resource_policy=resource_policy,
                started_monotonic=started,
                total_bytes=total_bytes,
                total_files=total_files,
            ),
        )
    finally:
        password = ""
        if client is not None:
            client.close()
        try:
            paths["lock"].unlink()
        except FileNotFoundError:
            pass


def start_worker(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    password: str,
    preflight_path: Path,
    preflight_sha256: str,
    run_id: str,
) -> dict[str, Any]:
    paths = evidence_paths(evidence_root, run_id)
    paths["directory"].mkdir(parents=True, exist_ok=True, mode=0o700)
    if paths["verify"].exists():
        raise RuntimeError("hot backup run is already accepted")
    previous_state_sha256 = None
    if paths["state"].exists():
        require_safe_regular_file(paths["state"], "hot backup state")
        previous_state_sha256 = sha256_file(paths["state"])
    try:
        descriptor = os.open(paths["lock"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise RuntimeError("hot backup runner is already active") from error
    os.write(descriptor, f"starting {os.getpid()}\n".encode("utf-8"))
    os.fsync(descriptor)
    os.close(descriptor)
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
            null_descriptor = os.open(os.devnull, os.O_RDONLY)
            log_descriptor = os.open(
                paths["log"],
                os.O_WRONLY | os.O_CREAT | os.O_APPEND,
                0o600,
            )
            os.dup2(null_descriptor, 0)
            os.dup2(log_descriptor, 1)
            os.dup2(log_descriptor, 2)
            os.close(null_descriptor)
            os.close(log_descriptor)
            paths["lock"].write_text(f"{os.getpid()}\n", encoding="utf-8")
            paths["lock"].chmod(0o600)
            _run_worker(
                evidence_root=evidence_root,
                expected_item_count=expected_item_count,
                expected_video_count=expected_video_count,
                ledger_path=ledger_path,
                ledger_sha256=ledger_sha256,
                local_media_root=local_media_root,
                password=password,
                preflight_path=preflight_path,
                preflight_sha256=preflight_sha256,
                run_id=run_id,
            )
        finally:
            os._exit(0)
    password = ""
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if paths["state"].exists():
            require_safe_regular_file(paths["state"], "hot backup state")
            if sha256_file(paths["state"]) == previous_state_sha256:
                time.sleep(0.25)
                continue
            payload = json.loads(paths["state"].read_text(encoding="utf-8"))
            return {
                "phase": payload.get("phase"),
                "pid": payload.get("pid"),
                "started": payload.get("phase") not in {"failed", "stopped"},
                "statePath": str(paths["state"]),
            }
        time.sleep(0.25)
    return {
        "phase": "starting",
        "pid": pid,
        "started": True,
        "statePath": str(paths["state"]),
    }


def _worker_process_matches(pid: int, run_id: str) -> bool:
    if pid <= 1:
        return False
    try:
        command = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        arguments = [value.decode("utf-8", errors="replace") for value in command if value]
        if "media-cloud-hot-backup.py" not in " ".join(arguments) or run_id not in arguments:
            return False
        os.kill(pid, 0)
        return True
    except (FileNotFoundError, PermissionError, ProcessLookupError, RuntimeError):
        return False


def _worker_alive(paths: dict[str, Path], pid: int, run_id: str) -> bool:
    try:
        require_safe_regular_file(paths["lock"], "hot backup lock")
        if paths["lock"].read_text(encoding="utf-8").strip() != str(pid):
            return False
    except (FileNotFoundError, RuntimeError):
        return False
    return _worker_process_matches(pid, run_id)


def require_reconciliation_idle(paths: dict[str, Path], run_id: str) -> None:
    if paths["lock"].exists():
        require_safe_regular_file(paths["lock"], "hot backup lock")
        raise RuntimeError("hot backup runner lock is present")
    if not paths["state"].exists():
        return
    require_safe_regular_file(paths["state"], "hot backup state")
    state = json.loads(paths["state"].read_text(encoding="utf-8"))
    pid = state.get("pid")
    if isinstance(pid, int) and _worker_process_matches(pid, run_id):
        raise RuntimeError("hot backup runner is active")


def acquire_reconciliation_lock(paths: dict[str, Path]) -> None:
    try:
        descriptor = os.open(paths["lock"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise RuntimeError("hot backup runner lock is present") from error
    try:
        os.write(descriptor, f"{os.getpid()}\n".encode("utf-8"))
        os.fsync(descriptor)
    except OSError:
        os.close(descriptor)
        release_reconciliation_lock(paths)
        raise
    os.close(descriptor)


def release_reconciliation_lock(paths: dict[str, Path]) -> None:
    try:
        paths["lock"].unlink()
    except FileNotFoundError:
        pass


def read_status(evidence_root: Path, run_id: str) -> dict[str, Any]:
    paths = evidence_paths(evidence_root, run_id)
    require_safe_regular_file(paths["state"], "hot backup state")
    payload = json.loads(paths["state"].read_text(encoding="utf-8"))
    pid = payload.get("pid")
    process_alive = isinstance(pid, int) and _worker_alive(paths, pid, run_id)
    return {
        **payload,
        "processAlive": process_alive,
        "verificationSha256": sha256_file(paths["verify"]) if paths["verify"].is_file() else None,
    }


def verify_backup(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    password: str,
    preflight_path: Path,
    preflight_sha256: str,
    run_id: str,
) -> dict[str, Any]:
    _load_preflight(preflight_path, preflight_sha256, ledger_sha256, run_id)
    validate_ledger(
        ledger_path,
        ledger_sha256,
        expected_item_count,
        expected_video_count,
    )
    local = canonical_inventory(local_media_root)
    client = AlistClient(password)
    try:
        cloud = client.inventory()
    finally:
        client.close()
    comparison = compare_inventories(local, cloud)
    return {
        "cloud": {
            key: cloud[key] for key in ("digest", "fileCount", "logicalBytes")
        },
        "comparison": comparison,
        "local": {
            key: local[key]
            for key in ("digest", "fileCount", "logicalBytes", "videoCount")
        },
        "schemaVersion": SCHEMA_VERSION,
        "state": "cloud-hot-backup-accepted" if comparison["accepted"] else "cloud-hot-backup-incomplete",
        "identity": {
            "ledgerSha256": ledger_sha256,
            "preflightSha256": preflight_sha256,
            "runId": run_id,
        },
    }


def build_reconciliation_contract(
    *,
    cloud: dict[str, Any],
    identity: dict[str, str],
    local: dict[str, Any],
) -> dict[str, Any]:
    comparison = compare_inventories(local, cloud)
    if comparison["missingCount"] or comparison["mismatchedCount"]:
        raise RuntimeError("reconciliation requires zero missing and mismatched files")
    unexpected_count = comparison["unexpectedCount"]
    if not unexpected_count:
        raise RuntimeError("cloud target has no stale files to reconcile")
    if unexpected_count > MAX_RECONCILIATION_FILES:
        raise RuntimeError("cloud stale file count exceeds the reconciliation safety bound")

    local_index = {row["targetPath"]: row["size"] for row in local["files"]}
    cloud_index = {row["targetPath"]: row["size"] for row in cloud["files"]}
    stale_files: list[dict[str, Any]] = []
    for row in cloud["files"]:
        target_path = row["targetPath"]
        if target_path in local_index:
            continue
        provider_path = row.get("providerPath")
        size = row.get("size")
        if not isinstance(provider_path, str) or not isinstance(size, int) or size < 0:
            raise RuntimeError("cloud stale file metadata is invalid")
        target = PurePosixPath(target_path)
        provider = PurePosixPath(provider_path)
        try:
            target.relative_to(PurePosixPath(CLOUD_ROOT))
            provider.relative_to(PurePosixPath(CLOUD_ROOT))
        except ValueError as error:
            raise RuntimeError("cloud stale file is outside the fixed root") from error
        if not target.suffix:
            raise RuntimeError("cloud stale file is not a numbered file duplicate")
        match = NUMBERED_DUPLICATE_PATTERN.fullmatch(target.stem)
        if match is None:
            raise RuntimeError("cloud stale file is not a numbered file duplicate")
        canonical_target_path = str(
            target.with_name(match.group("base") + target.suffix)
        )
        if (
            local_index.get(canonical_target_path) != size
            or cloud_index.get(canonical_target_path) != size
        ):
            raise RuntimeError(
                "cloud numbered duplicate lacks matching local and cloud canonical copies"
            )
        provider_name = provider.name
        if (
            not _safe_child_name(provider_name)
            or _canonical_provider_name(provider_name) != target.name
        ):
            raise RuntimeError("cloud stale provider path does not match its canonical path")
        stale_files.append(
            {
                "canonicalTargetPath": canonical_target_path,
                "duplicateIndex": int(match.group("index")),
                "providerDirectory": str(provider.parent),
                "providerName": provider_name,
                "providerPath": provider_path,
                "size": size,
                "targetPath": target_path,
            }
        )
    stale_files.sort(key=lambda value: value["targetPath"])
    if len(stale_files) != unexpected_count:
        raise RuntimeError("cloud stale reconciliation inventory is incomplete")
    return {
        "cloud": {
            key: cloud[key] for key in ("digest", "fileCount", "logicalBytes")
        },
        "comparison": {
            "mismatchedCount": comparison["mismatchedCount"],
            "missingCount": comparison["missingCount"],
            "unexpectedCount": comparison["unexpectedCount"],
        },
        "identity": identity,
        "local": {
            key: local[key]
            for key in ("digest", "fileCount", "logicalBytes", "videoCount")
        },
        "recovery": {
            "canonicalCloudCopiesRetained": True,
            "localAuthoritativeCopiesRetained": True,
            "providerDeleteRoute": "/api/fs/remove",
        },
        "schemaVersion": SCHEMA_VERSION,
        "staleFileCount": len(stale_files),
        "staleFiles": stale_files,
        "staleLogicalBytes": sum(row["size"] for row in stale_files),
        "state": "cloud-hot-backup-reconciliation-sealed",
        "writeBoundaries": {
            "cloud": 0,
            "databaseDirect": 0,
            "localMedia": 0,
            "mechanicalScan": 0,
            "ui": 0,
        },
    }


def seal_reconciliation_plan(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    password: str,
    preflight_path: Path,
    preflight_sha256: str,
    run_id: str,
) -> dict[str, Any]:
    paths = evidence_paths(evidence_root, run_id)
    paths["directory"].mkdir(parents=True, exist_ok=True, mode=0o700)
    require_reconciliation_idle(paths, run_id)
    acquire_reconciliation_lock(paths)
    client: AlistClient | None = None
    try:
        _load_preflight(preflight_path, preflight_sha256, ledger_sha256, run_id)
        validate_ledger(
            ledger_path,
            ledger_sha256,
            expected_item_count,
            expected_video_count,
        )
        local = canonical_inventory(local_media_root)
        if local["videoCount"] < expected_video_count:
            raise RuntimeError("local canonical video count is below the ledger baseline")
        client = AlistClient(password)
        password = ""
        cloud = client.inventory()
        identity = {
            "ledgerSha256": ledger_sha256,
            "preflightSha256": preflight_sha256,
            "runId": run_id,
        }
        contract = build_reconciliation_contract(
            cloud=cloud,
            identity=identity,
            local=local,
        )
        if paths["reconciliation"].exists():
            require_safe_regular_file(
                paths["reconciliation"],
                "reconciliation evidence",
            )
            existing = json.loads(
                paths["reconciliation"].read_text(encoding="utf-8")
            )
            if {key: existing.get(key) for key in contract} != contract:
                raise RuntimeError(
                    "sealed reconciliation evidence does not match current inventory"
                )
        else:
            write_json_exclusive(
                paths["reconciliation"],
                {**contract, "sealedAt": utc_now()},
            )
        return {
            "evidencePath": str(paths["reconciliation"]),
            "evidenceSha256": sha256_file(paths["reconciliation"]),
            "staleFileCount": contract["staleFileCount"],
            "staleLogicalBytes": contract["staleLogicalBytes"],
            "state": contract["state"],
            "writeBoundaries": contract["writeBoundaries"],
        }
    finally:
        password = ""
        if client is not None:
            client.close()
        release_reconciliation_lock(paths)


def validate_reconciliation_plan_rows(plan: dict[str, Any]) -> list[dict[str, Any]]:
    rows = plan.get("staleFiles")
    if (
        not isinstance(rows, list)
        or not rows
        or len(rows) > MAX_RECONCILIATION_FILES
        or plan.get("staleFileCount") != len(rows)
    ):
        raise RuntimeError("reconciliation evidence file count is invalid")
    total_bytes = 0
    targets: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("reconciliation evidence contains an invalid row")
        provider_path = row.get("providerPath")
        provider_directory = row.get("providerDirectory")
        provider_name = row.get("providerName")
        target_path = row.get("targetPath")
        canonical_target_path = row.get("canonicalTargetPath")
        duplicate_index = row.get("duplicateIndex")
        size = row.get("size")
        if (
            not all(
                isinstance(value, str)
                for value in (
                    provider_path,
                    provider_directory,
                    provider_name,
                    target_path,
                    canonical_target_path,
                )
            )
            or not isinstance(duplicate_index, int)
            or duplicate_index < 1
            or not isinstance(size, int)
            or size < 0
        ):
            raise RuntimeError("reconciliation evidence row types are invalid")
        provider = PurePosixPath(provider_path)
        target = PurePosixPath(target_path)
        try:
            provider.relative_to(PurePosixPath(CLOUD_ROOT))
            target.relative_to(PurePosixPath(CLOUD_ROOT))
        except ValueError as error:
            raise RuntimeError("reconciliation evidence row is outside the fixed root") from error
        match = NUMBERED_DUPLICATE_PATTERN.fullmatch(target.stem)
        expected_canonical = (
            str(target.with_name(match.group("base") + target.suffix))
            if match is not None and target.suffix
            else ""
        )
        if (
            provider.parent != PurePosixPath(provider_directory)
            or provider.name != provider_name
            or not _safe_child_name(provider_name)
            or _canonical_provider_name(provider_name) != target.name
            or match is None
            or int(match.group("index")) != duplicate_index
            or expected_canonical != canonical_target_path
            or target_path in targets
        ):
            raise RuntimeError("reconciliation evidence row identity is invalid")
        targets.add(target_path)
        total_bytes += size
    if plan.get("staleLogicalBytes") != total_bytes:
        raise RuntimeError("reconciliation evidence byte count is invalid")
    return rows


def apply_reconciliation_plan(
    *,
    evidence_root: Path,
    expected_item_count: int,
    expected_video_count: int,
    ledger_path: Path,
    ledger_sha256: str,
    local_media_root: Path,
    password: str,
    preflight_path: Path,
    preflight_sha256: str,
    reconciliation_sha256: str,
    run_id: str,
) -> dict[str, Any]:
    paths = evidence_paths(evidence_root, run_id)
    require_safe_regular_file(paths["reconciliation"], "reconciliation evidence")
    if sha256_file(paths["reconciliation"]) != reconciliation_sha256:
        raise RuntimeError("reconciliation evidence SHA-256 changed")
    plan = json.loads(paths["reconciliation"].read_text(encoding="utf-8"))
    identity = {
        "ledgerSha256": ledger_sha256,
        "preflightSha256": preflight_sha256,
        "runId": run_id,
    }
    if (
        plan.get("schemaVersion") != SCHEMA_VERSION
        or plan.get("state") != "cloud-hot-backup-reconciliation-sealed"
        or plan.get("identity") != identity
        or plan.get("writeBoundaries", {}).get("cloud") != 0
    ):
        raise RuntimeError("reconciliation evidence contract is invalid")
    plan_rows = validate_reconciliation_plan_rows(plan)
    _load_preflight(preflight_path, preflight_sha256, ledger_sha256, run_id)
    validate_ledger(
        ledger_path,
        ledger_sha256,
        expected_item_count,
        expected_video_count,
    )
    require_reconciliation_idle(paths, run_id)
    acquire_reconciliation_lock(paths)
    client: AlistClient | None = None
    try:
        local = canonical_inventory(local_media_root)
        if local["digest"] != plan.get("local", {}).get("digest"):
            raise RuntimeError("local canonical inventory drifted after reconciliation seal")
        if local["videoCount"] < expected_video_count:
            raise RuntimeError("local canonical video count is below the ledger baseline")
        client = AlistClient(password)
        password = ""
        cloud_before = client.inventory()
        comparison_before = compare_inventories(local, cloud_before)
        if comparison_before["missingCount"] or comparison_before["mismatchedCount"]:
            raise RuntimeError("cloud canonical inventory drifted after reconciliation seal")

        planned_by_target = {
            row["targetPath"]: row for row in plan_rows
        }
        local_target_paths = {row["targetPath"] for row in local["files"]}
        current_unexpected = [
            row for row in cloud_before["files"]
            if row["targetPath"] not in local_target_paths
        ]
        remaining: list[dict[str, Any]] = []
        for current in current_unexpected:
            planned = planned_by_target.get(current["targetPath"])
            if planned is None or any(
                current.get(key) != planned.get(key)
                for key in ("providerPath", "size", "targetPath")
            ):
                raise RuntimeError("cloud reconciliation inventory drifted outside the sealed plan")
            remaining.append(planned)
        absent_count = len(plan_rows) - len(remaining)
        if comparison_before["unexpectedCount"] != len(remaining):
            raise RuntimeError("cloud reconciliation comparison is inconsistent")

        grouped: dict[str, list[str]] = {}
        for row in remaining:
            grouped.setdefault(row["providerDirectory"], []).append(row["providerName"])
        for directory in sorted(grouped):
            client.remove_files(directory, sorted(grouped[directory]))

        local_after = canonical_inventory(local_media_root)
        if local_after["digest"] != plan.get("local", {}).get("digest"):
            raise RuntimeError("local canonical inventory drifted during reconciliation")
        if local_after["videoCount"] < expected_video_count:
            raise RuntimeError("local canonical video count fell below the ledger baseline")
        cloud_after = client.inventory()
        comparison_after = compare_inventories(local_after, cloud_after)
        if not comparison_after["accepted"]:
            raise RuntimeError("cloud target did not converge after sealed reconciliation")
        receipt = {
            "acceptedAt": utc_now(),
            "alreadyAbsentFileCount": absent_count,
            "cloud": {
                "after": {
                    key: cloud_after[key]
                    for key in ("digest", "fileCount", "logicalBytes")
                },
                "before": {
                    key: cloud_before[key]
                    for key in ("digest", "fileCount", "logicalBytes")
                },
            },
            "comparison": comparison_after,
            "identity": identity,
            "localDigest": local_after["digest"],
            "reconciliationEvidenceSha256": reconciliation_sha256,
            "removedFileCount": len(remaining),
            "removedLogicalBytes": sum(row["size"] for row in remaining),
            "schemaVersion": SCHEMA_VERSION,
            "state": "cloud-hot-backup-reconciled",
            "writeBoundaries": {
                "cloud": "sealed-stale-numbered-duplicate-delete",
                "cloudDeletedFiles": len(remaining),
                "databaseDirect": 0,
                "localMedia": 0,
                "mechanicalScan": 0,
                "ui": 0,
            },
        }
        if paths["reconciliationReceipt"].exists():
            require_safe_regular_file(
                paths["reconciliationReceipt"],
                "reconciliation receipt",
            )
            existing = json.loads(
                paths["reconciliationReceipt"].read_text(encoding="utf-8")
            )
            if existing.get("reconciliationEvidenceSha256") != reconciliation_sha256:
                raise RuntimeError("reconciliation receipt is bound to another plan")
        else:
            write_json_exclusive(paths["reconciliationReceipt"], receipt)
        receipt_sha256 = sha256_file(paths["reconciliationReceipt"])
        if paths["state"].exists():
            require_safe_regular_file(paths["state"], "hot backup state")
            state = json.loads(paths["state"].read_text(encoding="utf-8"))
            state.update(
                {
                    "error": None,
                    "phase": "reconciled",
                    "reconciliationEvidenceSha256": reconciliation_sha256,
                    "reconciliationReceiptSha256": receipt_sha256,
                    "updatedAt": utc_now(),
                }
            )
            write_json_atomic(paths["state"], state)
        return {
            "receiptPath": str(paths["reconciliationReceipt"]),
            "receiptSha256": receipt_sha256,
            "removedFileCount": len(remaining),
            "removedLogicalBytes": sum(row["size"] for row in remaining),
            "state": "cloud-hot-backup-reconciled",
            "writeBoundaries": receipt["writeBoundaries"],
        }
    finally:
        password = ""
        if client is not None:
            client.close()
        release_reconciliation_lock(paths)


def stop_worker(evidence_root: Path, run_id: str, execute: bool) -> dict[str, Any]:
    status_payload = read_status(evidence_root, run_id)
    pid = status_payload.get("pid")
    phase = status_payload.get("phase")
    active = phase in {"starting", "uploading", "verifying"} and status_payload["processAlive"]
    if execute and active and isinstance(pid, int):
        os.kill(pid, signal.SIGTERM)
    return {
        "activeBefore": active,
        "execute": execute,
        "pid": pid,
        "signalSent": bool(execute and active),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--operation",
        choices=("preflight", "start", "status", "verify", "reconcile", "stop"),
        required=True,
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--evidence-root", type=Path, default=DEFAULT_EVIDENCE_ROOT)
    parser.add_argument("--local-media-root", type=Path, default=DEFAULT_LOCAL_MEDIA_ROOT)
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--ledger-sha256")
    parser.add_argument("--expected-item-count", type=int)
    parser.add_argument("--expected-video-count", type=int)
    parser.add_argument("--preflight")
    parser.add_argument("--preflight-sha256")
    parser.add_argument("--reconciliation-sha256")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--password-stdin", action="store_true")
    parser.add_argument("--execute", action="store_true")
    return parser


def main() -> None:
    verify_script_digest()
    args = build_parser().parse_args()
    if not RUN_ID_PATTERN.fullmatch(args.run_id or ""):
        raise RuntimeError("run id is invalid")
    if args.evidence_root != DEFAULT_EVIDENCE_ROOT:
        raise RuntimeError("evidence root is not fixed")
    if args.local_media_root != DEFAULT_LOCAL_MEDIA_ROOT:
        raise RuntimeError("local media root is not fixed")
    paths = evidence_paths(args.evidence_root, args.run_id)
    if args.operation in {"preflight", "start", "verify", "reconcile"}:
        if (
            args.ledger is None
            or not args.ledger_sha256
            or args.expected_item_count is None
            or args.expected_video_count is None
            or not args.password_stdin
        ):
            raise RuntimeError("sealed ledger, counts, and password stdin are required")
    password = read_password_from_stdin() if args.password_stdin else ""
    if args.operation == "preflight":
        if args.output != paths["preflight"]:
            raise RuntimeError("preflight output path is not fixed")
        result = preflight(
            evidence_root=args.evidence_root,
            expected_item_count=args.expected_item_count,
            expected_video_count=args.expected_video_count,
            ledger_path=args.ledger,
            ledger_sha256=args.ledger_sha256,
            local_media_root=args.local_media_root,
            output_path=args.output,
            password=password,
            run_id=args.run_id,
        )
        result = {**result, "evidenceSha256": sha256_file(paths["preflight"])}
    elif args.operation == "start":
        if not args.execute:
            raise RuntimeError("start requires --execute")
        if args.preflight != str(paths["preflight"]) or not args.preflight_sha256:
            raise RuntimeError("start requires fixed preflight evidence")
        result = start_worker(
            evidence_root=args.evidence_root,
            expected_item_count=args.expected_item_count,
            expected_video_count=args.expected_video_count,
            ledger_path=args.ledger,
            ledger_sha256=args.ledger_sha256,
            local_media_root=args.local_media_root,
            password=password,
            preflight_path=Path(args.preflight),
            preflight_sha256=args.preflight_sha256,
            run_id=args.run_id,
        )
    elif args.operation == "status":
        result = read_status(args.evidence_root, args.run_id)
    elif args.operation == "verify":
        if args.preflight != str(paths["preflight"]) or not args.preflight_sha256:
            raise RuntimeError("verify requires fixed preflight evidence")
        result = verify_backup(
            evidence_root=args.evidence_root,
            expected_item_count=args.expected_item_count,
            expected_video_count=args.expected_video_count,
            ledger_path=args.ledger,
            ledger_sha256=args.ledger_sha256,
            local_media_root=args.local_media_root,
            password=password,
            preflight_path=Path(args.preflight),
            preflight_sha256=args.preflight_sha256,
            run_id=args.run_id,
        )
    elif args.operation == "reconcile":
        if args.preflight != str(paths["preflight"]) or not args.preflight_sha256:
            raise RuntimeError("reconcile requires fixed preflight evidence")
        if args.execute:
            if not args.reconciliation_sha256:
                raise RuntimeError("reconcile execution requires sealed reconciliation evidence")
            result = apply_reconciliation_plan(
                evidence_root=args.evidence_root,
                expected_item_count=args.expected_item_count,
                expected_video_count=args.expected_video_count,
                ledger_path=args.ledger,
                ledger_sha256=args.ledger_sha256,
                local_media_root=args.local_media_root,
                password=password,
                preflight_path=Path(args.preflight),
                preflight_sha256=args.preflight_sha256,
                reconciliation_sha256=args.reconciliation_sha256,
                run_id=args.run_id,
            )
        else:
            if args.output != paths["reconciliation"]:
                raise RuntimeError("reconcile output path is not fixed")
            result = seal_reconciliation_plan(
                evidence_root=args.evidence_root,
                expected_item_count=args.expected_item_count,
                expected_video_count=args.expected_video_count,
                ledger_path=args.ledger,
                ledger_sha256=args.ledger_sha256,
                local_media_root=args.local_media_root,
                password=password,
                preflight_path=Path(args.preflight),
                preflight_sha256=args.preflight_sha256,
                run_id=args.run_id,
            )
    else:
        result = stop_worker(args.evidence_root, args.run_id, args.execute)
    password = ""
    sys.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - command line emits bounded diagnostics.
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(1)
