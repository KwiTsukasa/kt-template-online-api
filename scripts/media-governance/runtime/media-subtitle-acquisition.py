#!/usr/bin/env python3
"""在隔离 qBittorrent 中验活并仅下载一个完整季的外挂字幕。"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import stat
import subprocess
import time
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit


EVIDENCE_PARENT = Path("/vol1/docker/kt-media-governance/evidence")
STAGING_PARENT = Path("/vol2/1000/.kt-media-governance-staging")
PROFILE_PARENT = Path("/run/kt-media-qbt")
QBT_BINARY = Path("/usr/trim/bin/trim-qbittorrent-nox")
QBT_VERSION = "qBittorrent v4.6.4"
QBT_API_VERSION = "v4.6.4"
INFO_HASH = re.compile(r"[0-9a-f]{40}")
DIGEST = re.compile(r"[0-9a-f]{64}")
RUN_ID = re.compile(r"[a-z0-9][a-z0-9-]{2,47}")
WORK_ITEM = re.compile(r"media-\d{3}")
SUBTITLE_SUFFIXES = {".ass", ".srt", ".ssa", ".vtt"}
VIDEO_SUFFIXES = {".avi", ".flv", ".m2ts", ".mkv", ".mov", ".mp4", ".ts", ".webm", ".wmv"}
MAX_TORRENT_FILES = 512
MAX_LAYOUT_DIAGNOSTIC_FILES = 64
MAX_VIDEO_DIAGNOSTIC_ROWS = 8
SIMPLIFIED_MARKERS = "这后发里为个国们来时说对开过还进么会样现实应与没从经于间问题"
TRADITIONAL_MARKERS = "這後發裡為個國們來時說對開過還進麼會樣現實應與沒從經於間問題"


class VideoPayloadBoundaryError(RuntimeError):
    def __init__(self, evidence: dict[str, Any]):
        super().__init__("qBittorrent downloaded an unselected video payload")
        self.evidence = evidence


class SelectedPayloadLayoutError(RuntimeError):
    def __init__(self, evidence: dict[str, Any]):
        super().__init__("downloaded subtitle payload path or size changed")
        self.evidence = evidence


class SubtitleCueBoundaryError(RuntimeError):
    def __init__(self, path: Path, evidence: dict[str, Any]):
        super().__init__(f"subtitle contains non-positive cues: {path.name}")
        self.evidence = evidence


def captured_at() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_self() -> str:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    script = Path(__file__)
    if not DIGEST.fullmatch(expected) or script.is_symlink() or sha256(script) != expected:
        raise RuntimeError("media subtitle runner SHA-256 gate changed")
    return expected


def descendant(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def prune_empty_ancestors(start: Path, parent: Path) -> None:
    if (
        not start.is_absolute()
        or not parent.is_absolute()
        or start == parent
        or not descendant(start, parent)
        or parent.is_symlink()
        or not parent.is_dir()
    ):
        raise RuntimeError("empty ancestor cleanup is outside the fixed parent")
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


def safe_torrent_path(value: str) -> str:
    if not value or "\0" in value or "\r" in value or "\n" in value:
        raise RuntimeError(f"torrent path is unsafe (empty-or-control): {value[:160]!r}")
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    reason = None
    if len(normalized) > 1024:
        reason = "too-long"
    elif path.is_absolute():
        reason = "absolute"
    elif not path.parts:
        reason = "empty"
    elif any(part in {"", ".", ".."} for part in path.parts):
        reason = "dot-segment"
    if reason is not None:
        raise RuntimeError(
            f"torrent path is unsafe ({reason}): {normalized[:160]!r}"
        )
    return path.as_posix()


def safe_qbt_torrent_path(value: str) -> str:
    if value.startswith("//"):
        raise RuntimeError(f"torrent path is unsafe (multiple-root-markers): {value[:160]!r}")
    normalized = value[1:] if value.startswith("/") else value
    return safe_torrent_path(normalized)


def safe_relative(value: str) -> str:
    normalized = safe_torrent_path(value)
    path = PurePosixPath(normalized)
    if path.suffix.lower() not in SUBTITLE_SUFFIXES:
        raise RuntimeError("selected payload is not a subtitle file")
    return normalized


def safe_qbt_subtitle_path(value: str) -> str:
    normalized = safe_qbt_torrent_path(value)
    if PurePosixPath(normalized).suffix.lower() not in SUBTITLE_SUFFIXES:
        raise RuntimeError("selected payload is not a subtitle file")
    return normalized


def qbt_content_root(task: dict[str, Any], staging: Path) -> Path:
    raw_content_path = str(task.get("content_path") or "")
    raw_save_path = str(task.get("save_path") or "")
    if (
        not raw_content_path
        or not raw_save_path
        or any(value in raw_content_path + raw_save_path for value in ("\0", "\r", "\n"))
    ):
        raise RuntimeError("qBittorrent content path is unavailable")
    staging_root = staging.resolve(strict=True)
    save_root = Path(raw_save_path)
    content_root = Path(raw_content_path)
    if (
        not save_root.is_absolute()
        or not content_root.is_absolute()
        or save_root.is_symlink()
        or content_root.is_symlink()
        or not content_root.is_dir()
        or save_root.resolve(strict=True) != staging_root
    ):
        raise RuntimeError("qBittorrent content path is outside sealed staging")
    resolved = content_root.resolve(strict=True)
    try:
        relative = resolved.relative_to(staging_root)
    except ValueError as error:
        raise RuntimeError("qBittorrent content path is outside sealed staging") from error
    if len(relative.parts) != 1 or relative.parts[0] in {"", ".", ".."}:
        raise RuntimeError("qBittorrent content root must be one staging level")
    return resolved


def video_payload_evidence(
    rows: list[dict[str, Any]], staging: Path, task_downloaded_bytes: int
) -> dict[str, Any]:
    triggered = [
        row
        for row in rows
        if PurePosixPath(str(row.get("name") or "")).suffix.lower()
        in VIDEO_SUFFIXES
        and float(row.get("progress") or 0) > 0
    ]
    sealed = []
    staging_root = staging.resolve(strict=True)
    for row in triggered[:MAX_VIDEO_DIAGNOSTIC_ROWS]:
        torrent_path = safe_qbt_torrent_path(str(row.get("name") or ""))
        candidate = staging / torrent_path
        existing_bytes = 0
        if candidate.exists() and not candidate.is_symlink():
            resolved = candidate.resolve(strict=True)
            if descendant(resolved, staging_root) and resolved.is_file():
                existing_bytes = resolved.stat().st_size
        piece_range = row.get("piece_range")
        if not (
            isinstance(piece_range, list)
            and len(piece_range) == 2
            and all(isinstance(value, int) and value >= 0 for value in piece_range)
        ):
            piece_range = None
        sealed.append(
            {
                "existingBytes": existing_bytes,
                "index": int(row.get("index") or 0),
                "path": torrent_path,
                "pieceRange": piece_range,
                "priority": int(row.get("priority") or 0),
                "progress": float(row.get("progress") or 0),
                "size": int(row.get("size") or 0),
            }
        )
    return {
        "materializedVideoBytes": sum(row["existingBytes"] for row in sealed),
        "rows": sealed,
        "taskDownloadedBytes": max(0, int(task_downloaded_bytes)),
        "triggeredVideoCount": len(triggered),
        "truncatedVideoCount": max(0, len(triggered) - len(sealed)),
    }


def enforce_video_payload_boundary(evidence: dict[str, Any]) -> None:
    rows = evidence.get("rows") or []
    if int(evidence.get("materializedVideoBytes") or 0) > 0 or any(
        int(row.get("priority") or 0) > 0 for row in rows
    ):
        raise VideoPayloadBoundaryError(evidence)


def selected_payload_layout_evidence(
    staging: Path, selected: dict[str, Any], row: dict[str, Any]
) -> dict[str, Any]:
    raw_path = str(row.get("name") or "")
    normalized_path = safe_qbt_subtitle_path(raw_path)
    files = []
    truncated = False
    for root, directories, names in os.walk(staging, followlinks=False):
        directories.sort()
        names.sort()
        for name in names:
            candidate = Path(root) / name
            relative = safe_torrent_path(candidate.relative_to(staging).as_posix())
            files.append(
                {
                    "path": relative,
                    "size": None if candidate.is_symlink() else candidate.stat().st_size,
                }
            )
            if len(files) > MAX_LAYOUT_DIAGNOSTIC_FILES:
                truncated = True
                break
        if truncated:
            break
    return {
        "episode": selected["episode"],
        "expectedSize": int(row.get("size") or 0),
        "files": files[:MAX_LAYOUT_DIAGNOSTIC_FILES],
        "index": selected["index"],
        "normalizedPath": normalized_path,
        "rawPath": raw_path[:1_024],
        "truncated": truncated,
    }


def safe_source_uri(value: str, info_hash: str) -> str:
    if not value or len(value) > 4096 or "\0" in value or "\r" in value or "\n" in value:
        raise RuntimeError("subtitle source URI is unsafe")
    parsed = urlsplit(value)
    if parsed.scheme == "magnet":
        hashes = [entry.lower() for entry in parse_qs(parsed.query).get("xt", [])]
        if (
            parsed.netloc
            or parsed.path
            or parsed.fragment
            or f"urn:btih:{info_hash}" not in hashes
        ):
            raise RuntimeError("subtitle magnet info hash changed")
        return value
    if (
        parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("subtitle torrent URL is unsafe")
    mikan = (
        parsed.hostname == "mikanani.kas.pub"
        and re.fullmatch(rf"/Download/\d{{8}}/{info_hash}\.torrent", parsed.path, re.IGNORECASE)
    )
    nyaa = parsed.hostname == "nyaa.si" and re.fullmatch(
        r"/download/\d+\.torrent", parsed.path
    )
    if not mikan and not nyaa:
        raise RuntimeError("subtitle torrent URL is not an allowed fixed provider URL")
    return value


def load_contract(path: Path) -> dict[str, Any]:
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise RuntimeError("subtitle contract path is unsafe")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != "media-subtitle-acquisition-contract-v1":
        raise RuntimeError("subtitle contract schema changed")
    work_item = str(payload.get("workItemId") or "")
    info_hash = str(payload.get("infoHash") or "")
    evidence_root = Path(str(payload.get("evidenceRoot") or ""))
    paths = payload.get("paths") or {}
    contract_mode = str(payload.get("contractMode") or "acquisition")
    season = payload.get("season")
    profile_root = Path(str(payload.get("profileRoot") or ""))
    run_id = evidence_root.name
    run_digest = hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:8]
    candidate_token = f"{work_item}-s{season:02d}-{info_hash}" if isinstance(season, int) else ""
    contract_name = (
        f"{candidate_token}-subtitle-metadata-contract.json"
        if contract_mode == "metadata-probe"
        else f"{candidate_token}-subtitle-acquisition-contract.json"
    )
    if (
        not WORK_ITEM.fullmatch(work_item)
        or not INFO_HASH.fullmatch(info_hash)
        or not RUN_ID.fullmatch(run_id)
        or contract_mode not in {"acquisition", "metadata-probe"}
        or not isinstance(season, int)
        or season < 0
        or evidence_root != EVIDENCE_PARENT / run_id
        or path != evidence_root / contract_name
        or profile_root
        != PROFILE_PARENT / f"{work_item}-s{season:02d}-{info_hash[:12]}-{run_digest}"
        or payload.get("videoDownloadCount") != 0
    ):
        raise RuntimeError("subtitle contract identity changed")
    source_uri = safe_source_uri(
        str(payload.get("sourceUri") or payload.get("magnet") or ""), info_hash
    )
    source_uri_kind = "magnet" if source_uri.startswith("magnet:?") else "torrent-url"
    if payload.get("sourceUriKind") not in (None, source_uri_kind):
        raise RuntimeError("subtitle source URI kind changed")
    staging_root = Path(str(paths.get("stagingRoot") or ""))
    expected_staging = STAGING_PARENT / run_id / "sources" / f"{work_item}-s{season:02d}-{info_hash}"
    runtime_name = (
        f"{candidate_token}-subtitle-metadata-runtime.log"
        if contract_mode == "metadata-probe"
        else f"{candidate_token}-subtitle-acquisition-runtime.log"
    )
    expected_paths = {
        "acceptanceEvidence": evidence_root / f"{work_item}-acceptance.json",
        "cleanupEvidence": evidence_root / f"{candidate_token}-subtitle-acquisition-cleanup.json",
        "contract": path,
        "progressEvidence": evidence_root / f"{candidate_token}-subtitle-acquisition-progress.json",
        "resultEvidence": evidence_root / f"{candidate_token}-subtitle-acquisition-result.json",
        "runtimeLog": evidence_root / runtime_name,
        "stagingRoot": expected_staging,
    }
    if contract_mode == "metadata-probe":
        expected_paths["metadataEvidence"] = evidence_root / f"{candidate_token}-subtitle-metadata.json"
    if staging_root != expected_staging:
        raise RuntimeError("subtitle staging path changed")
    for key, expected in expected_paths.items():
        if Path(str(paths.get(key) or "")) != expected:
            raise RuntimeError(f"subtitle {key} path changed")
    inventory = Path(str(payload.get("inventoryPath") or ""))
    inventory_run_id = str(payload.get("inventoryRunId") or inventory.parent.name)
    if (
        not RUN_ID.fullmatch(inventory_run_id)
        or inventory != EVIDENCE_PARENT / inventory_run_id / f"{work_item}-local-inventory.json"
        or not DIGEST.fullmatch(str(payload.get("inventorySha256") or ""))
    ):
        raise RuntimeError("subtitle inventory binding changed")
    selected = payload.get("selectedFiles")
    if (
        not isinstance(selected, list)
        or len(selected) > 200
        or (contract_mode == "acquisition" and not selected)
        or (contract_mode == "metadata-probe" and selected)
    ):
        raise RuntimeError("subtitle selected file set is invalid")
    normalized = []
    for row in selected:
        if not isinstance(row, dict):
            raise RuntimeError("subtitle selected file row is invalid")
        episode = row.get("episode")
        index = row.get("index")
        if not isinstance(episode, int) or episode < 1 or not isinstance(index, int) or index < 0:
            raise RuntimeError("subtitle selected file identity is invalid")
        normalized.append({"episode": episode, "index": index, "path": safe_relative(str(row.get("path") or ""))})
    if (
        len({row["episode"] for row in normalized}) != len(normalized)
        or len({row["index"] for row in normalized}) != len(normalized)
        or len({row["path"] for row in normalized}) != len(normalized)
    ):
        raise RuntimeError("subtitle selected identities are not unique")
    payload["selectedFiles"] = sorted(normalized, key=lambda row: row["episode"])
    payload["contractMode"] = contract_mode
    payload["inventoryRunId"] = inventory_run_id
    payload["paths"] = {key: os.fspath(value) for key, value in expected_paths.items()}
    payload["sourceUri"] = source_uri
    payload["sourceUriKind"] = source_uri_kind
    return payload


def atomic_json(path: Path, payload: dict[str, Any], *, replace: bool = False) -> None:
    if path.is_symlink() or (path.exists() and not replace):
        raise RuntimeError(f"refusing to overwrite evidence: {path}")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{secrets.token_hex(4)}")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def isolated_processes(profile_root: Path) -> list[int]:
    needle = f"--profile={profile_root}"
    matches = []
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = [value.decode() for value in (proc / "cmdline").read_bytes().split(b"\0") if value]
        except (FileNotFoundError, PermissionError, UnicodeDecodeError):
            continue
        if args and args[0] == os.fspath(QBT_BINARY) and needle in args:
            matches.append(int(proc.name))
    return matches


def port_unused(port: int) -> bool:
    completed = subprocess.run(
        ["ss", "-ltnuH"], check=True, capture_output=True, text=True, timeout=10
    )
    return all(f":{port} " not in f"{line} " for line in completed.stdout.splitlines())


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path: Path) -> None:
        super().__init__("localhost", timeout=20)
        self.socket_path = socket_path

    def connect(self) -> None:
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(self.timeout)
        connection.connect(os.fspath(self.socket_path))
        self.sock = connection


class QbtApi:
    def __init__(self, socket_path: Path, password: str) -> None:
        self.socket_path = socket_path
        self.cookie = ""
        response = self.request(
            "POST", "auth/login", {"username": "admin", "password": password}, False
        )
        if response.decode() != "Ok." or not self.cookie.startswith("SID="):
            raise RuntimeError("qBittorrent authentication failed")

    def request(
        self,
        method: str,
        endpoint: str,
        form: dict[str, str] | None = None,
        authenticated: bool = True,
    ) -> bytes:
        headers = {"Referer": "http://localhost/"}
        body = None
        if authenticated:
            headers["Cookie"] = self.cookie
        if form is not None:
            body = urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        connection = UnixHTTPConnection(self.socket_path)
        try:
            connection.request(method, f"/api/v2/{endpoint}", body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
            if response.status != 200:
                raise RuntimeError(f"qBittorrent API {endpoint} returned HTTP {response.status}")
            cookie = response.getheader("Set-Cookie")
            if cookie:
                self.cookie = cookie.split(";", 1)[0]
            return payload
        finally:
            connection.close()

    def json(self, endpoint: str) -> Any:
        return json.loads(self.request("GET", endpoint))

    def post(self, endpoint: str, form: dict[str, str]) -> bytes:
        return self.request("POST", endpoint, form)


def start_qbt(contract: dict[str, Any], *, resume_profile: bool) -> tuple[subprocess.Popen[bytes], Any, QbtApi]:
    profile_root = Path(contract["profileRoot"])
    socket_path = profile_root / "control.sock"
    log_path = Path(contract["paths"]["runtimeLog"])
    if isolated_processes(profile_root):
        raise RuntimeError("duplicate isolated qBittorrent process")
    if resume_profile:
        if not profile_root.is_dir() or profile_root.is_symlink():
            raise RuntimeError("isolated qBittorrent profile is missing")
        socket_path.unlink(missing_ok=True)
    else:
        profile_root.mkdir(mode=0o700, parents=True)
    log_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    log_stream = log_path.open("ab" if resume_profile else "xb")
    log_path.chmod(0o600)
    password = f"kt-media-{secrets.token_urlsafe(32)}"
    environment = os.environ.copy()
    environment["QBT_CONFIRM_LEGAL_NOTICE"] = "1"
    process = subprocess.Popen(
        [
            os.fspath(QBT_BINARY),
            f"--profile={profile_root}",
            f"--webui-sock-path={socket_path}",
            f"--webui-password={password}",
            f"--torrenting-port={int(contract['qBittorrentPort'])}",
            f"--stop-with-process={os.getpid()}",
        ],
        stdout=log_stream,
        stderr=subprocess.STDOUT,
        env=environment,
    )
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if socket_path.exists() and stat.S_ISSOCK(socket_path.lstat().st_mode):
                break
            if process.poll() is not None:
                raise RuntimeError(f"isolated qBittorrent exited: {process.returncode}")
            time.sleep(0.1)
        if not socket_path.exists() or not stat.S_ISSOCK(socket_path.lstat().st_mode):
            raise RuntimeError("isolated qBittorrent Unix socket did not appear")
        api = QbtApi(socket_path, password)
        del password
        if api.request("GET", "app/version").decode() != QBT_API_VERSION:
            raise RuntimeError("qBittorrent API version changed")
        if isolated_processes(profile_root) != [process.pid]:
            raise RuntimeError("isolated qBittorrent process identity changed")
        return process, log_stream, api
    except BaseException:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=20)
        log_stream.close()
        raise


def stop_qbt(process: subprocess.Popen[bytes], log_stream: Any, api: QbtApi | None) -> None:
    if api is not None and process.poll() is None:
        try:
            api.post("app/shutdown", {})
        except Exception:
            pass
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    log_stream.close()


def task_rows(api: QbtApi, info_hash: str) -> list[dict[str, Any]]:
    rows = api.json(f"torrents/info?hashes={info_hash}")
    if not isinstance(rows, list):
        raise RuntimeError("qBittorrent task response changed")
    return rows


def all_task_rows(api: QbtApi) -> list[dict[str, Any]]:
    rows = api.json("torrents/info")
    if not isinstance(rows, list):
        raise RuntimeError("qBittorrent task response changed")
    return rows


def exact_task_rows(api: QbtApi, info_hash: str) -> list[dict[str, Any]]:
    rows = all_task_rows(api)
    if len(rows) > 1:
        raise RuntimeError("isolated qBittorrent created multiple tasks")
    if rows:
        actual_hash = str(rows[0].get("hash") or "").lower()
        if not INFO_HASH.fullmatch(actual_hash):
            raise RuntimeError("qBittorrent task identity changed")
        if actual_hash != info_hash:
            remove_exact_task(api, actual_hash, True)
            raise RuntimeError("torrent descriptor info hash does not match")
    return rows


def file_rows(api: QbtApi, info_hash: str) -> list[dict[str, Any]]:
    rows = api.json(f"torrents/files?hash={info_hash}")
    if not isinstance(rows, list):
        raise RuntimeError("qBittorrent file response changed")
    return rows


def summarize_metadata_rows(
    contract: dict[str, Any], rows: list[dict[str, Any]], payload_downloaded_bytes: int
) -> dict[str, Any]:
    if not rows or len(rows) > MAX_TORRENT_FILES:
        raise RuntimeError("torrent metadata file count is invalid")
    if not isinstance(payload_downloaded_bytes, int) or payload_downloaded_bytes != 0:
        raise RuntimeError("metadata probe downloaded payload bytes")
    normalized = []
    for row in rows:
        index = row.get("index")
        size = row.get("size")
        priority = row.get("priority")
        progress = row.get("progress")
        if (
            not isinstance(index, int)
            or index < 0
            or not isinstance(size, int)
            or size < 0
            or int(priority or 0) != 0
            or float(progress or 0) != 0
        ):
            raise RuntimeError("metadata probe payload boundary changed")
        try:
            torrent_path = safe_qbt_torrent_path(str(row.get("name") or ""))
        except RuntimeError as error:
            raise RuntimeError(f"torrent metadata file index {index}: {error}") from error
        normalized.append({"index": index, "path": torrent_path, "size": size})
    if len({row["index"] for row in normalized}) != len(normalized):
        raise RuntimeError("torrent metadata file indices changed")
    subtitle_files = [
        row
        for row in normalized
        if PurePosixPath(row["path"]).suffix.lower() in SUBTITLE_SUFFIXES
    ]
    video_file_count = sum(
        PurePosixPath(row["path"]).suffix.lower() in VIDEO_SUFFIXES
        for row in normalized
    )
    return {
        "capturedAt": captured_at(),
        "fileCount": len(normalized),
        "infoHash": contract["infoHash"],
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "formalMediaWrites": 0,
            "mechanicalScanTriggered": False,
            "payloadDownloads": 0,
            "uiWrites": 0,
        },
        "otherFileCount": len(normalized) - len(subtitle_files) - video_file_count,
        "payloadDownloadedBytes": payload_downloaded_bytes,
        "schemaVersion": "media-subtitle-source-metadata-v1",
        "season": contract["season"],
        "status": "metadata-ready",
        "subtitleFileCount": len(subtitle_files),
        "subtitleFiles": subtitle_files,
        "videoDownloadCount": 0,
        "videoFileCount": video_file_count,
        "workItemId": contract["workItemId"],
    }


def preflight(contract: dict[str, Any]) -> dict[str, Any]:
    inventory = Path(contract["inventoryPath"])
    profile = Path(contract["profileRoot"])
    staging = Path(contract["paths"]["stagingRoot"])
    if os.geteuid() != 0:
        raise RuntimeError("media subtitle acquisition requires root")
    if not QBT_BINARY.is_file() or QBT_BINARY.is_symlink():
        raise RuntimeError("qBittorrent binary is unavailable")
    version = subprocess.run(
        [os.fspath(QBT_BINARY), "--version"],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    version = (version.stdout or version.stderr).strip()
    if version != QBT_VERSION:
        raise RuntimeError("qBittorrent version changed")
    if not inventory.is_file() or inventory.is_symlink() or sha256(inventory) != contract["inventorySha256"]:
        raise RuntimeError("subtitle inventory SHA-256 changed")
    if isolated_processes(profile):
        raise RuntimeError("isolated qBittorrent is already active")
    if profile.exists() or staging.exists():
        raise RuntimeError("isolated qBittorrent profile or staging already exists")
    if not port_unused(int(contract["qBittorrentPort"])):
        raise RuntimeError("isolated qBittorrent peer port is already in use")
    free = shutil.disk_usage(STAGING_PARENT).free
    if free < 512 * 1024 * 1024:
        raise RuntimeError("insufficient free space for subtitle acquisition")
    return {
        "freeBytes": free,
        "infoHash": contract["infoHash"],
        "inventorySha256": contract["inventorySha256"],
        "qBittorrentVersion": version,
        "selectedFileCount": len(contract["selectedFiles"]),
        "status": "preflight-passed",
        "videoDownloadCount": 0,
        "workItemId": contract["workItemId"],
    }


def configure_task(api: QbtApi, contract: dict[str, Any]) -> list[dict[str, Any]]:
    info_hash = contract["infoHash"]
    if all_task_rows(api):
        raise RuntimeError("isolated qBittorrent profile is not empty")
    response = api.post(
        "torrents/add",
        {
            "autoTMM": "false",
            "dlLimit": "1024",
            "paused": "true",
            "savepath": contract["paths"]["stagingRoot"],
            "tags": f"kt-media-governance,{contract['workItemId']},subtitle-only",
            "urls": contract["sourceUri"],
        },
    )
    if response.decode() != "Ok.":
        raise RuntimeError("qBittorrent rejected the sealed source URI")
    deadline = time.monotonic() + int(contract["zeroByteProbeSeconds"])
    rows: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        tasks = exact_task_rows(api, info_hash)
        if tasks:
            rows = file_rows(api, info_hash)
            if rows:
                break
        time.sleep(1)
    if not rows:
        raise RuntimeError("source_metadata_unavailable")
    indexed = {int(row["index"]): row for row in rows}
    if len(indexed) != len(rows):
        raise RuntimeError("torrent file indices changed")
    selected_indices = set()
    for selected in contract["selectedFiles"]:
        row = indexed.get(selected["index"])
        if row is None or safe_qbt_subtitle_path(str(row.get("name") or "")) != selected["path"]:
            raise RuntimeError("selected subtitle file identity changed")
        selected_indices.add(selected["index"])
    all_indices = "|".join(str(index) for index in sorted(indexed))
    wanted = "|".join(str(index) for index in sorted(selected_indices))
    api.post("torrents/filePrio", {"hash": info_hash, "id": all_indices, "priority": "0"})
    api.post("torrents/filePrio", {"hash": info_hash, "id": wanted, "priority": "1"})
    api.post("torrents/setDownloadLimit", {"hashes": info_hash, "limit": "0"})
    api.post("torrents/resume", {"hashes": info_hash})
    confirmed = file_rows(api, info_hash)
    positive = {int(row["index"]) for row in confirmed if int(row.get("priority", 0)) > 0}
    video_positive = [
        row for row in confirmed
        if PurePosixPath(str(row.get("name") or "")).suffix.lower() in VIDEO_SUFFIXES
        and int(row.get("priority", 0)) > 0
    ]
    if positive != selected_indices or video_positive:
        raise RuntimeError("qBittorrent selective subtitle priority gate failed")
    return confirmed


def local_connectivity_ok() -> bool:
    try:
        with socket.create_connection(("1.1.1.1", 443), timeout=5):
            return True
    except OSError:
        return False


def monitor(
    api: QbtApi, contract: dict[str, Any]
) -> tuple[list[dict[str, Any]], Path]:
    info_hash = contract["infoHash"]
    selected_indices = {row["index"] for row in contract["selectedFiles"]}
    started = time.monotonic()
    last_bytes = 0
    last_progress = started
    progress_path = Path(contract["paths"]["progressEvidence"])
    while True:
        now = time.monotonic()
        tasks = task_rows(api, info_hash)
        if len(tasks) != 1:
            raise RuntimeError("exact qBittorrent task disappeared")
        task = tasks[0]
        files = file_rows(api, info_hash)
        selected = [row for row in files if int(row["index"]) in selected_indices]
        positive = {int(row["index"]) for row in files if int(row.get("priority", 0)) > 0}
        if positive != selected_indices:
            raise RuntimeError("qBittorrent selective priority drifted")
        downloaded = max(0, int(task.get("downloaded", 0)))
        video_evidence = video_payload_evidence(
            files, Path(contract["paths"]["stagingRoot"]), downloaded
        )
        enforce_video_payload_boundary(video_evidence)
        if downloaded > last_bytes:
            last_bytes = downloaded
            last_progress = now
        complete = len(selected) == len(selected_indices) and all(
            float(row.get("progress", 0)) >= 0.999999 for row in selected
        )
        elapsed = now - started
        state = "downloading"
        reason = None
        if complete:
            state = "payload-ready"
        elif downloaded == 0 and elapsed >= int(contract["zeroByteProbeSeconds"]):
            reason = "source_runtime_unavailable" if local_connectivity_ok() else "local_connectivity_degraded"
            state = "unavailable" if reason == "source_runtime_unavailable" else "inconclusive"
        elif downloaded > 0 and now - last_progress >= int(contract["stallSeconds"]):
            reason = "download_stalled"
            state = "unavailable"
        elif elapsed >= int(contract["maxRuntimeSeconds"]):
            reason = "source_probe_inconclusive"
            state = "inconclusive"
        evidence = {
            "capturedAt": captured_at(),
            "downloadedBytes": downloaded,
            "downloadSpeedBytesPerSecond": max(0, int(task.get("dlspeed", 0))),
            "elapsedSeconds": round(elapsed, 3),
            "infoHash": info_hash,
            "peersConnected": max(0, int(task.get("num_leechs", 0))),
            "reason": reason,
            "seedsConnected": max(0, int(task.get("num_seeds", 0))),
            "selectedCompleteCount": sum(float(row.get("progress", 0)) >= 0.999999 for row in selected),
            "selectedFileCount": len(selected_indices),
            "state": state,
            "unselectedVideoProgressCount": video_evidence["triggeredVideoCount"],
            "materializedVideoBytes": video_evidence["materializedVideoBytes"],
            "videoDownloadCount": 0,
            "workItemId": contract["workItemId"],
        }
        atomic_json(progress_path, evidence, replace=True)
        print(json.dumps(evidence, ensure_ascii=False, sort_keys=True), flush=True)
        if state == "payload-ready":
            api.post("torrents/pause", {"hashes": info_hash})
            return files, qbt_content_root(
                task, Path(contract["paths"]["stagingRoot"])
            )
        if state in {"unavailable", "inconclusive"}:
            raise RuntimeError(reason or state)
        time.sleep(int(contract["pollSeconds"]))


def decode_subtitle(path: Path) -> str:
    payload = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"subtitle encoding is unsupported: {path.name}")


def subtitle_timestamp_seconds(value: str) -> float:
    matched = re.fullmatch(
        r"\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{2,3})\s*", value
    )
    if matched is None:
        raise RuntimeError("subtitle timestamp is invalid")
    hours, minutes, seconds, fraction = matched.groups()
    if int(minutes) > 59 or int(seconds) > 59:
        raise RuntimeError("subtitle timestamp is invalid")
    return (
        int(hours) * 3600
        + int(minutes) * 60
        + int(seconds)
        + int(fraction) / (10 ** len(fraction))
    )


def subtitle_summary(path: Path) -> dict[str, Any]:
    text = decode_subtitle(path)
    suffix = path.suffix.lower()
    if suffix in {".ass", ".ssa"}:
        raw_cues = []
        for line in text.splitlines():
            matched = re.match(r"^\s*Dialogue:\s*[^,]*,([^,]+),([^,]+),", line)
            if matched is not None:
                raw_cues.append(matched.groups())
    else:
        raw_cues = re.findall(
            r"(?m)^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})",
            text,
        )
    if not raw_cues:
        raise RuntimeError(f"subtitle contains no timed cues: {path.name}")
    cues = [
        (subtitle_timestamp_seconds(start), subtitle_timestamp_seconds(end))
        for start, end in raw_cues
    ]
    zero_sentinels = [(start, end) for start, end in cues if start == 0 and end == 0]
    non_positive_cues = [
        (start, end)
        for start, end in cues
        if end < start or (end == start and (start != 0 or end != 0))
    ]
    non_positive = len(non_positive_cues)
    if non_positive_cues:
        raise SubtitleCueBoundaryError(
            path,
            {
                "cueCount": len(cues),
                "nonPositiveCueCount": non_positive,
                "samples": [
                    {"endSeconds": end, "startSeconds": start}
                    for start, end in non_positive_cues[:5]
                ],
            },
        )
    positive_cues = [(start, end) for start, end in cues if end > start]
    if not positive_cues:
        raise RuntimeError(f"subtitle contains no positive timed cues: {path.name}")
    simplified = sum(text.count(character) for character in SIMPLIFIED_MARKERS)
    traditional = sum(text.count(character) for character in TRADITIONAL_MARKERS)
    if simplified <= traditional:
        raise RuntimeError(f"subtitle is not verified Simplified Chinese: {path.name}")
    return {
        "cueCount": len(cues),
        "firstCueSeconds": min(start for start, _end in positive_cues),
        "ignoredZeroSentinelCueCount": len(zero_sentinels),
        "lastCueSeconds": max(end for _start, end in positive_cues),
        "nonPositiveCueCount": non_positive,
        "simplifiedMarkerCount": simplified,
        "traditionalMarkerCount": traditional,
    }


def inventory_episodes(contract: dict[str, Any]) -> set[int]:
    payload = json.loads(Path(contract["inventoryPath"]).read_text(encoding="utf-8"))
    videos = list((payload.get("files") or {}).get("videos") or [])
    rows = list((payload.get("database") or {}).get("rows") or [])
    episodes = set()
    for video in videos:
        matches = [row for row in rows if row.get("path") == video.get("path")]
        for row in matches:
            season = row.get("parent_season") if row.get("parent_season") is not None else row.get("season_number")
            episode = row.get("episode_number")
            if str(season).isdigit() and int(season) == contract["season"] and str(episode).isdigit() and int(episode) > 0:
                episodes.add(int(episode))
    if not episodes:
        raise RuntimeError("inventory has no exact target-season episodes")
    return episodes


def verify_payload(
    contract: dict[str, Any], rows: list[dict[str, Any]], content_root: Path
) -> dict[str, Any]:
    staging = Path(contract["paths"]["stagingRoot"])
    indexed = {int(row["index"]): row for row in rows}
    expected_episodes = inventory_episodes(contract)
    selected_episodes = {row["episode"] for row in contract["selectedFiles"]}
    if selected_episodes != expected_episodes:
        raise RuntimeError("subtitle package does not cover the complete local season")
    sealed = []
    for selected in contract["selectedFiles"]:
        row = indexed[selected["index"]]
        target = content_root / safe_qbt_subtitle_path(str(row["name"]))
        if (
            not target.is_file()
            or target.is_symlink()
        ):
            raise SelectedPayloadLayoutError(
                selected_payload_layout_evidence(staging, selected, row)
            )
        resolved = target.resolve(strict=True)
        if (
            not descendant(resolved, content_root.resolve(strict=True))
            or target.stat().st_size != int(row["size"])
        ):
            raise SelectedPayloadLayoutError(
                selected_payload_layout_evidence(staging, selected, row)
            )
        summary = subtitle_summary(target)
        sealed.append(
            {
                "episode": selected["episode"],
                "path": selected["path"],
                "sha256": sha256(target),
                "size": target.stat().st_size,
                "targetPath": os.fspath(target),
                **summary,
            }
        )
    for candidate in staging.rglob("*"):
        if candidate.is_file() and candidate.suffix.lower() in VIDEO_SUFFIXES and candidate.stat().st_size > 0:
            raise RuntimeError("subtitle acquisition downloaded a video payload")
    return {
        "capturedAt": captured_at(),
        "episodeCoverage": sorted(expected_episodes),
        "files": sealed,
        "infoHash": contract["infoHash"],
        "inventorySha256": contract["inventorySha256"],
        "localStagingRoot": os.fspath(staging),
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "mechanicalScanTriggered": False,
            "mediaVideoDownloads": 0,
            "serviceMutation": True,
            "subtitlePayloadDownloads": len(sealed),
            "uiWrites": 0,
        },
        "schemaVersion": "media-local-subtitle-package-v1",
        "season": contract["season"],
        "sourceReference": f"urn:btih:{contract['infoHash']}",
        "sourceReleaseGroup": contract["sourceGroup"],
        "status": "accepted",
        "subtitleCount": len(sealed),
        "videoDownloadCount": 0,
        "workItemId": contract["workItemId"],
    }


def remove_exact_task(api: QbtApi, info_hash: str, delete_files: bool) -> None:
    if task_rows(api, info_hash):
        api.post("torrents/pause", {"hashes": info_hash})
        api.post(
            "torrents/delete",
            {"deleteFiles": "true" if delete_files else "false", "hashes": info_hash},
        )
        deadline = time.monotonic() + 60
        while task_rows(api, info_hash) and time.monotonic() < deadline:
            time.sleep(0.25)
        if task_rows(api, info_hash):
            raise RuntimeError("official qBittorrent task cleanup failed")


def remove_all_tasks(api: QbtApi) -> None:
    for row in all_task_rows(api):
        info_hash = str(row.get("hash") or "").lower()
        if not INFO_HASH.fullmatch(info_hash):
            raise RuntimeError("qBittorrent task identity changed during cleanup")
        remove_exact_task(api, info_hash, True)


def probe_metadata(contract: dict[str, Any]) -> dict[str, Any]:
    preflight(contract)
    evidence_path = Path(contract["paths"]["metadataEvidence"])
    profile = Path(contract["profileRoot"])
    staging = Path(contract["paths"]["stagingRoot"])
    process = None
    log_stream = None
    api = None
    payload_downloaded_bytes = 0
    try:
        process, log_stream, api = start_qbt(contract, resume_profile=False)
        if all_task_rows(api):
            raise RuntimeError("isolated qBittorrent profile is not empty")
        response = api.post(
            "torrents/add",
            {
                "autoTMM": "false",
                "dlLimit": "1024",
                "paused": "true",
                "savepath": os.fspath(staging),
                "tags": f"kt-media-governance,{contract['workItemId']},metadata-only",
                "urls": contract["sourceUri"],
            },
        )
        if response.decode() != "Ok.":
            raise RuntimeError("qBittorrent rejected the sealed metadata source URI")
        deadline = time.monotonic() + int(contract["zeroByteProbeSeconds"])
        rows: list[dict[str, Any]] = []
        while time.monotonic() < deadline:
            tasks = exact_task_rows(api, contract["infoHash"])
            if tasks:
                payload_downloaded_bytes = max(0, int(tasks[0].get("downloaded", 0)))
                rows = file_rows(api, contract["infoHash"])
                if rows:
                    break
            time.sleep(1)
        if not rows:
            raise RuntimeError("source_metadata_unavailable")
        if len(rows) > MAX_TORRENT_FILES:
            raise RuntimeError("torrent metadata file count is invalid")
        indices = [int(row["index"]) for row in rows]
        if len(set(indices)) != len(indices):
            raise RuntimeError("torrent metadata file indices changed")
        api.post(
            "torrents/filePrio",
            {
                "hash": contract["infoHash"],
                "id": "|".join(str(index) for index in sorted(indices)),
                "priority": "0",
            },
        )
        confirmed = file_rows(api, contract["infoHash"])
        tasks = task_rows(api, contract["infoHash"])
        if len(tasks) != 1:
            raise RuntimeError("exact qBittorrent metadata task disappeared")
        payload_downloaded_bytes = max(0, int(tasks[0].get("downloaded", 0)))
        evidence = summarize_metadata_rows(
            contract, confirmed, payload_downloaded_bytes
        )
        remove_exact_task(api, contract["infoHash"], True)
        evidence["officialTaskRemoved"] = True
        atomic_json(evidence_path, evidence)
        return evidence
    except BaseException as error:
        if api is not None:
            try:
                remove_all_tasks(api)
            except Exception:
                pass
        if not evidence_path.exists():
            atomic_json(
                evidence_path,
                {
                    "capturedAt": captured_at(),
                    "error": str(error),
                    "infoHash": contract["infoHash"],
                    "payloadDownloadedBytes": payload_downloaded_bytes,
                    "schemaVersion": "media-subtitle-source-metadata-v1",
                    "status": "failed",
                    "videoDownloadCount": 0,
                    "workItemId": contract["workItemId"],
                },
            )
        raise
    finally:
        if process is not None and log_stream is not None:
            stop_qbt(process, log_stream, api)
        if profile.exists() and descendant(profile, PROFILE_PARENT):
            shutil.rmtree(profile)
        if staging.exists() and descendant(staging, STAGING_PARENT):
            shutil.rmtree(staging)
        if descendant(staging, STAGING_PARENT):
            prune_empty_ancestors(staging.parent, STAGING_PARENT)


def acquire(contract: dict[str, Any]) -> dict[str, Any]:
    preflight(contract)
    staging = Path(contract["paths"]["stagingRoot"])
    result_path = Path(contract["paths"]["resultEvidence"])
    staging.mkdir(mode=0o700, parents=True)
    process = None
    log_stream = None
    api = None
    try:
        process, log_stream, api = start_qbt(contract, resume_profile=False)
        rows = configure_task(api, contract)
        rows, content_root = monitor(api, contract)
        result = verify_payload(contract, rows, content_root)
        atomic_json(result_path, result)
        return result
    except BaseException as error:
        if api is not None:
            try:
                remove_all_tasks(api)
            except Exception:
                pass
        if not result_path.exists():
            failure = {
                "capturedAt": captured_at(),
                "error": str(error),
                "infoHash": contract["infoHash"],
                "schemaVersion": "media-local-subtitle-package-v1",
                "status": "failed",
                "videoDownloadCount": 0,
                "workItemId": contract["workItemId"],
            }
            if isinstance(error, VideoPayloadBoundaryError):
                failure["videoPayloadEvidence"] = error.evidence
            if isinstance(error, SelectedPayloadLayoutError):
                failure["selectedPayloadLayoutEvidence"] = error.evidence
            if isinstance(error, SubtitleCueBoundaryError):
                failure["subtitleCueEvidence"] = error.evidence
            atomic_json(result_path, failure)
        raise
    finally:
        if process is not None and log_stream is not None:
            stop_qbt(process, log_stream, api)
        if result_path.exists():
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            if payload.get("status") != "accepted":
                profile = Path(contract["profileRoot"])
                if profile.exists() and descendant(profile, PROFILE_PARENT):
                    shutil.rmtree(profile)
                if staging.exists() and descendant(staging, STAGING_PARENT):
                    shutil.rmtree(staging)
                if descendant(staging, STAGING_PARENT):
                    prune_empty_ancestors(staging.parent, STAGING_PARENT)


def status(contract: dict[str, Any]) -> dict[str, Any]:
    result_path = Path(contract["paths"]["resultEvidence"])
    progress_path = Path(contract["paths"]["progressEvidence"])
    selected = result_path if result_path.is_file() else progress_path
    payload = json.loads(selected.read_text(encoding="utf-8")) if selected.is_file() else {}
    return {
        "evidencePath": os.fspath(selected) if selected.is_file() else None,
        "evidenceSha256": sha256(selected) if selected.is_file() else None,
        "infoHash": contract["infoHash"],
        "payload": payload,
        "processCount": len(isolated_processes(Path(contract["profileRoot"]))),
        "state": "result" if result_path.is_file() else ("progress" if progress_path.is_file() else "pending"),
        "workItemId": contract["workItemId"],
    }


def probe_status(contract: dict[str, Any]) -> dict[str, Any]:
    evidence_path = Path(contract["paths"]["metadataEvidence"])
    if evidence_path.is_symlink():
        raise RuntimeError("metadata probe evidence path is unsafe")
    payload = (
        json.loads(evidence_path.read_text(encoding="utf-8"))
        if evidence_path.is_file()
        else {}
    )
    process_count = len(isolated_processes(Path(contract["profileRoot"])))
    return {
        "evidencePath": os.fspath(evidence_path) if evidence_path.is_file() else None,
        "evidenceSha256": sha256(evidence_path) if evidence_path.is_file() else None,
        "infoHash": contract["infoHash"],
        "payload": payload,
        "processCount": process_count,
        "state": "result" if evidence_path.is_file() else ("active" if process_count else "pending"),
        "workItemId": contract["workItemId"],
    }


def validate_acceptance_evidence(
    acceptance: Path, expected_sha256: str, contract: dict[str, Any]
) -> dict[str, Any]:
    if (
        not DIGEST.fullmatch(expected_sha256)
        or not acceptance.is_absolute()
        or acceptance.is_symlink()
        or not acceptance.is_file()
        or acceptance.name != f"{contract['workItemId']}-acceptance.json"
        or not RUN_ID.fullmatch(acceptance.parent.name)
        or not descendant(
            acceptance.resolve(strict=True), EVIDENCE_PARENT.resolve(strict=True)
        )
        or sha256(acceptance) != expected_sha256
    ):
        raise RuntimeError("sealed local acceptance evidence changed")
    payload = json.loads(acceptance.read_text(encoding="utf-8"))
    if (
        payload.get("state") != "local-batch-accepted"
        or payload.get("deleteFileCount") != 0
        or contract["workItemId"] not in set(payload.get("workItemIds") or [])
        or contract["infoHash"]
        not in set(payload.get("subtitleSourceInfoHashes") or [])
        or int(payload.get("subtitleFileCount") or 0)
        < len(contract.get("selectedFiles") or [])
    ):
        raise RuntimeError("sealed local acceptance source identity changed")
    return payload


def cleanup(
    contract: dict[str, Any],
    acceptance_sha256: str,
    acceptance_path: Path | None = None,
) -> dict[str, Any]:
    acceptance = acceptance_path or Path(contract["paths"]["acceptanceEvidence"])
    result_path = Path(contract["paths"]["resultEvidence"])
    expected_acceptance = acceptance_sha256
    validate_acceptance_evidence(acceptance, expected_acceptance, contract)
    if not result_path.is_file() or result_path.is_symlink():
        raise RuntimeError("accepted subtitle acquisition evidence is missing")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    if (
        result.get("status") != "accepted"
        or result.get("infoHash") != contract["infoHash"]
        or result.get("workItemId") != contract["workItemId"]
    ):
        raise RuntimeError("subtitle acquisition result identity changed")
    staging = Path(contract["paths"]["stagingRoot"])
    profile = Path(contract["profileRoot"])
    cleanup_path = Path(contract["paths"]["cleanupEvidence"])
    if cleanup_path.is_file() and not cleanup_path.is_symlink():
        existing = json.loads(cleanup_path.read_text(encoding="utf-8"))
        if (
            existing.get("status") == "cleaned"
            and existing.get("acceptanceEvidenceSha256") == expected_acceptance
            and existing.get("infoHash") == contract["infoHash"]
            and not staging.exists()
            and not profile.exists()
        ):
            prune_empty_ancestors(staging.parent, STAGING_PARENT)
            return existing
        raise RuntimeError("subtitle cleanup evidence conflicts with live state")
    process, log_stream, api = start_qbt(contract, resume_profile=True)
    try:
        remove_exact_task(api, contract["infoHash"], True)
    finally:
        stop_qbt(process, log_stream, api)
    deadline = time.monotonic() + 60
    while staging.exists() and time.monotonic() < deadline:
        time.sleep(0.25)
    if staging.exists():
        if any(staging.iterdir()):
            raise RuntimeError("owned subtitle staging remained after official cleanup")
        staging.rmdir()
    prune_empty_ancestors(staging.parent, STAGING_PARENT)
    if profile.exists() and descendant(profile, PROFILE_PARENT):
        shutil.rmtree(profile)
    evidence = {
        "acceptanceEvidenceSha256": expected_acceptance,
        "capturedAt": captured_at(),
        "infoHash": contract["infoHash"],
        "officialDeleteFiles": True,
        "profilePresent": profile.exists(),
        "stagingPresent": staging.exists(),
        "status": "cleaned",
        "workItemId": contract["workItemId"],
    }
    atomic_json(cleanup_path, evidence)
    return evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "operation",
        choices=("acquire", "cleanup", "preflight", "probe", "probe-status", "status"),
    )
    parser.add_argument("--acceptance-evidence-sha256")
    parser.add_argument("--acceptance-evidence")
    parser.add_argument("--contract", required=True)
    return parser.parse_args()


def main() -> int:
    verify_self()
    args = parse_args()
    contract = load_contract(Path(args.contract))
    if args.operation == "preflight":
        result = preflight(contract)
    elif args.operation == "probe":
        result = probe_metadata(contract)
    elif args.operation == "probe-status":
        result = probe_status(contract)
    elif args.operation == "acquire":
        result = acquire(contract)
    elif args.operation == "status":
        result = status(contract)
    else:
        if not args.acceptance_evidence_sha256:
            raise RuntimeError("cleanup requires acceptance evidence SHA-256")
        result = cleanup(
            contract,
            args.acceptance_evidence_sha256,
            Path(args.acceptance_evidence) if args.acceptance_evidence else None,
        )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
