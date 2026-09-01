#!/usr/bin/env python3
"""通过固定 NAS loopback API 查询并驱动类型化 Admin 媒体任务。"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import time
from typing import Any
import urllib.parse
import urllib.request


API_HOST = "nas4.kwitsukasa.top"
API_PORT = 10443
API_PREFIX = "/api"
USERNAME = "kwitsukasa"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$")
MIKAN_TORRENT_URL = re.compile(
    r"^https://mikanani\.kas\.pub/Download/\d{8}/[0-9a-f]{40}\.torrent$"
)
MIKAN_TORRENT_FETCH_URL = re.compile(
    r"^https://(?:mikanani\.kas\.pub|mikanani\.me)/Download/\d{8}/[0-9a-f]{40}\.torrent$"
)
READ_OPERATIONS = {
    "task-page",
    "task-summary",
    "task-detail",
    "series-page",
    "series-detail",
    "series-history-classification",
    "source-manifest",
    "agent-session",
    "evidence",
}
OPERATIONS = READ_OPERATIONS | {
    "task-create",
    "series-work-create",
    "series-season-create",
    "rss-subscription-rebind",
    "rss-subscription-context-repair",
    "rss-subscription-poll",
    "series-reconcile",
    "series-magnet-batch",
    "task-cleanup",
    "task-discard",
    "task-identity-update",
    "catalog-identity-restore",
    "source-magnet-add",
    "source-torrent-add",
    "source-classification",
    "source-selection",
    "source-inspect",
    "source-probe-runtime",
    "source-remove",
    "subtitle-contract",
    "download-start",
    "download-pause",
    "download-resume",
    "download-cancel",
    "governance-start",
    "governance-identity-rebase",
    "metadata-verify",
    "metadata-repair",
    "acceptance-verify",
    "agent-start",
    "agent-reverify",
    "operator-decision",
}
COMMAND_ROUTES = {
    "task-identity-update": ("PUT", "identity"),
    "catalog-identity-restore": ("POST", "catalog-identity/restore"),
    "source-classification": ("PUT", "sources/{sourceId}/classification"),
    "source-selection": ("PUT", "sources/{sourceId}/selection"),
    "source-inspect": ("POST", "sources/{sourceId}/inspect"),
    "source-probe-runtime": ("POST", "sources/{sourceId}/probe-runtime"),
    "source-remove": ("POST", "sources/{sourceId}/remove"),
    "subtitle-contract": ("PUT", "units/{unitId}/subtitle-contract"),
    "download-start": ("POST", "downloads/start"),
    "download-pause": ("POST", "downloads/pause"),
    "download-resume": ("POST", "downloads/resume"),
    "download-cancel": ("POST", "downloads/cancel"),
    "governance-start": ("POST", "governance/start"),
    "governance-identity-rebase": ("POST", "governance/identity-rebase"),
    "metadata-verify": ("POST", "metadata/verify"),
    "metadata-repair": ("POST", "metadata/repair"),
    "acceptance-verify": ("POST", "acceptance/verify"),
    "agent-start": ("POST", "agent/start"),
    "agent-reverify": ("POST", "acceptance/verify"),
    "operator-decision": ("POST", "agent/operator-decision"),
}
BLOCKED_KEYS = {
    "accesstoken",
    "authorization",
    "cookie",
    "descriptorgrantid",
    "descriptorobjectid",
    "magneturi",
    "password",
    "refreshtoken",
    "set-cookie",
    "token",
    "tracker",
    "trackers",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_script_digest() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RuntimeError("script SHA-256 is required")
    if sha256_file(Path(__file__)) != expected:
        raise RuntimeError("script SHA-256 does not match the sealed release")


def bounded_error(value: Any) -> str:
    text = " ".join(str(value).replace("\x00", "").split())
    return text[:160] or "unknown Admin API failure"


class ResolvedHttpsConnection(http.client.HTTPSConnection):
    def connect(self) -> None:
        raw_socket = socket.create_connection(("127.0.0.1", API_PORT), self.timeout)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=API_HOST)


class AdminClient:
    def __init__(self, password: str):
        self._context = ssl.create_default_context()
        self._cookie = ""
        self._token = ""
        status, payload, headers = self._request_raw(
            "POST",
            "/auth/login",
            {"password": password, "username": USERNAME},
            anonymous=True,
        )
        data = self._unwrap(status, payload, "login")
        token = data.get("accessToken") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token:
            raise RuntimeError("Admin login returned no access token")
        self._token = token
        cookies = [
            value.split(";", 1)[0]
            for key, value in headers
            if key.casefold() == "set-cookie" and "=" in value
        ]
        self._cookie = "; ".join(cookies)

    def _request_raw(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        anonymous: bool = False,
    ) -> tuple[int, dict[str, Any], list[tuple[str, str]]]:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        ) if body is not None else None
        headers = {"Accept": "application/json", "Host": f"{API_HOST}:{API_PORT}"}
        if encoded is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(encoded))
        if self._token and not anonymous:
            headers["Authorization"] = f"Bearer {self._token}"
        if self._cookie and not anonymous:
            headers["Cookie"] = self._cookie
        connection = ResolvedHttpsConnection(
            API_HOST,
            API_PORT,
            context=self._context,
            timeout=45,
        )
        connection.request(method, API_PREFIX + path, body=encoded, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        response_headers = response.getheaders()
        status = response.status
        connection.close()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"err": "non-json Admin API response"}
        return status, payload, response_headers

    @staticmethod
    def _unwrap(status: int, payload: dict[str, Any], label: str) -> Any:
        if not 200 <= status < 300 or payload.get("code") != 200:
            detail = payload.get("err") or payload.get("msg") or payload.get("message")
            raise RuntimeError(f"{label} failed:{status}:{bounded_error(detail)}")
        return payload.get("data")

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
    ) -> Any:
        status, payload, _headers = self._request_raw(method, path, body)
        return self._unwrap(status, payload, path)

    def request_multipart(
        self,
        path: str,
        fields: dict[str, Any],
        file_bytes: bytes,
    ) -> Any:
        boundary = f"----kt-media-{hashlib.sha256(file_bytes).hexdigest()[:32]}"
        body = bytearray()
        for key, raw_value in fields.items():
            values = raw_value if isinstance(raw_value, list) else [raw_value]
            for value in values:
                text = str(value)
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", key) or any(
                    marker in text for marker in ("\x00", "\r", "\n")
                ):
                    raise RuntimeError("multipart field is invalid")
                body.extend(f"--{boundary}\r\n".encode())
                body.extend(
                    f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
                )
                body.extend(text.encode("utf-8"))
                body.extend(b"\r\n")
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            b'Content-Disposition: form-data; name="file"; filename="source.torrent"\r\n'
        )
        body.extend(b"Content-Type: application/x-bittorrent\r\n\r\n")
        body.extend(file_bytes)
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._token}",
            "Content-Length": str(len(body)),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Cookie": self._cookie,
            "Host": f"{API_HOST}:{API_PORT}",
        }
        connection = ResolvedHttpsConnection(
            API_HOST,
            API_PORT,
            context=self._context,
            timeout=45,
        )
        connection.request("POST", API_PREFIX + path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        status = response.status
        connection.close()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"err": "non-json Admin API response"}
        return self._unwrap(status, payload, path)

    def close(self) -> None:
        if self._token or self._cookie:
            try:
                self._request_raw("POST", "/auth/logout")
            except (OSError, RuntimeError):
                pass
        self._cookie = ""
        self._token = ""


def sanitize(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return "<depth-limit>"
    if isinstance(value, dict):
        return {
            key: sanitize(item, depth + 1)
            for key, item in value.items()
            if str(key).casefold() not in BLOCKED_KEYS
        }
    if isinstance(value, list):
        return [sanitize(item, depth + 1) for item in value[:500]]
    if isinstance(value, str):
        if "magnet:?" in value.casefold():
            return "<redacted-magnet-uri>"
        return value[:2_000]
    return value


def project_page_task(task: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "activeRunId",
        "closedMode",
        "gateReason",
        "governanceProfile",
        "id",
        "metadataStatus",
        "nextCommandLabel",
        "progress",
        "revision",
        "runState",
        "stage",
        "titleHint",
        "workItemId",
        "inputSnapshotSha256",
    )
    projected = {key: sanitize(task.get(key)) for key in keys}
    sources = task.get("sources") or []
    units = task.get("units") or []
    projected["sourceCount"] = len(sources)
    projected["sourceIds"] = [
        source.get("id")
        for source in sources
        if isinstance(source, dict) and SAFE_ID.fullmatch(str(source.get("id", "")))
    ]
    projected["canDiscard"] = (
        task.get("stage") == "intake"
        and task.get("runState") == "draft"
        and task.get("activeRunId") is None
        and not sources
        and task.get("workItemId") is None
        and task.get("payloadSeal") is None
        and task.get("sealedPlan") is None
        and task.get("sealedPlanSha256") is None
        and task.get("closedAt") is None
        and task.get("agentSession") is None
        and task.get("metadataIdentity") is None
        and task.get("metadataStatus") == "pending"
        and all(
            isinstance(unit, dict)
            and unit.get("evidenceSha256") is None
            and unit.get("localAcceptedAt") is None
            and unit.get("subtitleContract") is None
            for unit in units
        )
    )
    return projected


def project_task(task: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "activeRunId",
        "agentSession",
        "closedAt",
        "closedMode",
        "gateReason",
        "governanceProfile",
        "id",
        "identityPreview",
        "inputSnapshotSha256",
        "mediaType",
        "metadataIdentity",
        "metadataStatus",
        "nextCommandLabel",
        "payloadSeal",
        "progress",
        "providerRef",
        "operationKind",
        "releaseYear",
        "revision",
        "runState",
        "sealedPlanSha256",
        "semanticProjection",
        "stage",
        "titleHint",
        "units",
        "seriesId",
        "workId",
        "workItemId",
    )
    projected = {key: sanitize(task.get(key)) for key in keys}
    projected["sources"] = [
        {
            key: sanitize(source.get(key))
            for key in (
                "contentKind",
                "descriptorRevision",
                "descriptorSha256",
                "descriptorTombstonedAt",
                "id",
                "infoHash",
                "manifestSha256",
                "manifestState",
                "releaseGroup",
                "seasonNumbers",
                "selectedBytes",
                "selectedFileCount",
                "selectedFileIndices",
                "selectedFileMappings",
                "sourceHealth",
                "sourceHealthLabel",
                "sourceHealthReasonLabel",
                "sourceRole",
                "transportKind",
            )
        }
        | {"manifestFileCount": len(source.get("manifest") or [])}
        for source in task.get("sources", [])
    ]
    return projected


def require_id(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not SAFE_ID.fullmatch(value):
        raise RuntimeError(f"{key} is invalid")
    return value


def require_provider_ref(value: Any) -> dict[str, str]:
    """校验一个受支持资料源引用并裁剪首尾空白。"""
    if not isinstance(value, dict) or set(value) != {"provider", "providerId"}:
        raise RuntimeError("series provider reference is invalid")
    provider = value.get("provider")
    provider_id = value.get("providerId")
    if (
        provider not in {"bangumi", "tmdb", "tvdb"}
        or not isinstance(provider_id, str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}", provider_id)
    ):
        raise RuntimeError("series provider reference is invalid")
    return {"provider": provider, "providerId": provider_id}


def normalize_series_catalog(value: Any) -> dict[str, Any]:
    """校验系列、季、外部资料和 Task 集范围的完整唯一事实。"""
    allowed = {
        "canonicalProviderRef",
        "externalRefs",
        "originalTitle",
        "releaseYear",
        "seasons",
        "taskBindings",
        "title",
    }
    if not isinstance(value, dict) or set(value) - allowed:
        raise RuntimeError("series catalog is invalid")
    canonical = require_provider_ref(value.get("canonicalProviderRef"))
    title = value.get("title")
    original_title = value.get("originalTitle")
    release_year = value.get("releaseYear")
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 200
        or (
            original_title is not None
            and (
                not isinstance(original_title, str)
                or not original_title.strip()
                or len(original_title) > 200
            )
        )
        or not isinstance(release_year, int)
        or not 1888 <= release_year <= 2100
    ):
        raise RuntimeError("series catalog identity is invalid")
    raw_seasons = value.get("seasons")
    if not isinstance(raw_seasons, list) or not 1 <= len(raw_seasons) <= 100:
        raise RuntimeError("series catalog seasons are invalid")
    seasons = []
    season_ranges: dict[int, tuple[int, int]] = {}
    for raw_season in raw_seasons:
        if not isinstance(raw_season, dict) or set(raw_season) - {
            "episodeCount",
            "episodeStart",
            "releaseYear",
            "seasonNumber",
            "title",
        }:
            raise RuntimeError("series catalog season is invalid")
        season_number = raw_season.get("seasonNumber")
        episode_start = raw_season.get("episodeStart", 1)
        episode_count = raw_season.get("episodeCount")
        season_title = raw_season.get("title")
        season_year = raw_season.get("releaseYear")
        if (
            not isinstance(season_number, int)
            or not 0 <= season_number <= 99
            or season_number in season_ranges
            or not isinstance(episode_start, int)
            or not 1 <= episode_start <= 2000
            or not isinstance(episode_count, int)
            or not 1 <= episode_count <= 2000
            or episode_start + episode_count - 1 > 2000
            or not isinstance(season_title, str)
            or not season_title.strip()
            or len(season_title) > 200
            or (
                season_year is not None
                and (
                    not isinstance(season_year, int)
                    or not 1888 <= season_year <= 2100
                )
            )
        ):
            raise RuntimeError("series catalog season is invalid")
        season_ranges[season_number] = (
            episode_start,
            episode_start + episode_count - 1,
        )
        season = {
            "episodeCount": episode_count,
            "episodeStart": episode_start,
            "seasonNumber": season_number,
            "title": season_title.strip(),
        }
        if season_year is not None:
            season["releaseYear"] = season_year
        seasons.append(season)
    references = []
    reference_keys = {f"{canonical['provider']}:{canonical['providerId']}"}
    raw_references = value.get("externalRefs", [])
    if not isinstance(raw_references, list) or len(raw_references) > 50:
        raise RuntimeError("series external references are invalid")
    for raw_reference in raw_references:
        if not isinstance(raw_reference, dict) or set(raw_reference) - {
            "providerRef",
            "releaseYear",
            "title",
        }:
            raise RuntimeError("series external reference is invalid")
        provider_ref = require_provider_ref(raw_reference.get("providerRef"))
        key = f"{provider_ref['provider']}:{provider_ref['providerId']}"
        reference_title = raw_reference.get("title")
        reference_year = raw_reference.get("releaseYear")
        if (
            key in reference_keys
            or (
                reference_title is not None
                and (
                    not isinstance(reference_title, str)
                    or not reference_title.strip()
                    or len(reference_title) > 200
                )
            )
            or (
                reference_year is not None
                and (
                    not isinstance(reference_year, int)
                    or not 1888 <= reference_year <= 2100
                )
            )
        ):
            raise RuntimeError("series external reference is invalid")
        reference_keys.add(key)
        reference = {"providerRef": provider_ref}
        if reference_title is not None:
            reference["title"] = reference_title.strip()
        if reference_year is not None:
            reference["releaseYear"] = reference_year
        references.append(reference)
    bindings = []
    binding_keys = set()
    raw_bindings = value.get("taskBindings", [])
    if not isinstance(raw_bindings, list) or len(raw_bindings) > 200:
        raise RuntimeError("series task bindings are invalid")
    for raw_binding in raw_bindings:
        if not isinstance(raw_binding, dict) or set(raw_binding) != {
            "episodeEnd",
            "episodeStart",
            "seasonNumber",
            "taskId",
        }:
            raise RuntimeError("series task binding is invalid")
        task_id = require_id(raw_binding, "taskId")
        season_number = raw_binding.get("seasonNumber")
        episode_start = raw_binding.get("episodeStart")
        episode_end = raw_binding.get("episodeEnd")
        if (
            not isinstance(season_number, int)
            or season_number not in season_ranges
            or not isinstance(episode_start, int)
            or not isinstance(episode_end, int)
            or episode_start < season_ranges.get(season_number, (1, 0))[0]
            or episode_start > episode_end
            or episode_end > season_ranges.get(season_number, (1, 0))[1]
        ):
            raise RuntimeError("series task binding is invalid")
        for episode in range(episode_start, episode_end + 1):
            key = (task_id, season_number, episode)
            if key in binding_keys:
                raise RuntimeError("series task binding is duplicated")
            binding_keys.add(key)
        bindings.append(
            {
                "episodeEnd": episode_end,
                "episodeStart": episode_start,
                "seasonNumber": season_number,
                "taskId": task_id,
            }
        )
    result = {
        "canonicalProviderRef": canonical,
        "externalRefs": references,
        "releaseYear": release_year,
        "seasons": seasons,
        "taskBindings": bindings,
        "title": title.strip(),
    }
    if original_title is not None:
        result["originalTitle"] = original_title.strip()
    return result


def normalize_magnet_batch(value: Any) -> dict[str, Any]:
    """校验批量按集磁链的统一分类、集号和 BTIH 唯一性。"""
    if not isinstance(value, dict) or set(value) - {
        "contentKind",
        "items",
        "releaseGroup",
    }:
        raise RuntimeError("series magnet batch is invalid")
    content_kind = value.get("contentKind")
    release_group = value.get("releaseGroup")
    items = value.get("items")
    if (
        content_kind
        not in {
            "bundled_sidecar_media",
            "burned_in_subtitle_media",
            "embedded_subtitle_media",
            "subtitleless_media",
        }
        or (
            release_group is not None
            and (
                not isinstance(release_group, str)
                or not release_group.strip()
                or len(release_group) > 160
            )
        )
        or not isinstance(items, list)
        or not 1 <= len(items) <= 16
    ):
        raise RuntimeError("series magnet batch is invalid")
    episodes = set()
    hashes = set()
    normalized_items = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"episodeNumber", "magnetUri"}:
            raise RuntimeError("series magnet item is invalid")
        episode = item.get("episodeNumber")
        magnet = item.get("magnetUri")
        if (
            not isinstance(episode, int)
            or not 1 <= episode <= 2000
            or episode in episodes
            or not isinstance(magnet, str)
            or not 1 <= len(magnet) <= 4096
            or not magnet.startswith("magnet:?")
        ):
            raise RuntimeError("series magnet item is invalid")
        parsed = urllib.parse.urlparse(magnet)
        query = urllib.parse.parse_qs(parsed.query)
        hashes_in_uri = [
            match.group(1).lower()
            for value in query.get("xt", [])
            if (match := re.fullmatch(r"urn:btih:([0-9a-f]{40})", value, re.I))
        ]
        if parsed.scheme != "magnet" or len(hashes_in_uri) != 1 or hashes_in_uri[0] in hashes:
            raise RuntimeError("series magnet item is invalid")
        episodes.add(episode)
        hashes.add(hashes_in_uri[0])
        normalized_items.append({"episodeNumber": episode, "magnetUri": magnet})
    result = {"contentKind": content_kind, "items": normalized_items}
    if release_group is not None:
        result["releaseGroup"] = release_group.strip()
    return result


def read_task(client: AdminClient, task_id: str) -> dict[str, Any]:
    task = client.request("GET", f"/media-governance/tasks/{task_id}")
    if not isinstance(task, dict) or task.get("id") != task_id:
        raise RuntimeError("Admin task detail identity mismatch")
    return task


def cleanup_target(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {
        "expectedRevision",
        "inputSnapshotSha256",
        "sourceIds",
        "taskId",
    }:
        raise RuntimeError("cleanup target is invalid")
    task_id = require_id(payload, "taskId")
    expected_revision = payload.get("expectedRevision")
    input_snapshot_sha256 = payload.get("inputSnapshotSha256")
    source_ids = payload.get("sourceIds")
    if (
        not isinstance(expected_revision, int)
        or expected_revision < 1
        or not isinstance(input_snapshot_sha256, str)
        or not re.fullmatch(r"[0-9a-f]{64}", input_snapshot_sha256)
        or not isinstance(source_ids, list)
        or len(source_ids) > 20
    ):
        raise RuntimeError("cleanup target is invalid")
    normalized_source_ids = [
        require_id({"sourceId": source_id}, "sourceId") for source_id in source_ids
    ]
    if len(set(normalized_source_ids)) != len(normalized_source_ids):
        raise RuntimeError("cleanup target source identities are duplicated")
    return {
        "expectedRevision": expected_revision,
        "inputSnapshotSha256": input_snapshot_sha256,
        "sourceIds": normalized_source_ids,
        "taskId": task_id,
    }


def assert_cleanup_identity(task: dict[str, Any], target: dict[str, Any]) -> None:
    source_ids = [
        source.get("id")
        for source in task.get("sources") or []
        if isinstance(source, dict)
    ]
    units = task.get("units") or []
    if (
        task.get("id") != target["taskId"]
        or task.get("revision") != target["expectedRevision"]
        or task.get("inputSnapshotSha256") != target["inputSnapshotSha256"]
        or source_ids != target["sourceIds"]
        or task.get("stage") != "intake"
        or task.get("runState") not in {"draft", "blocked"}
        or task.get("activeRunId") is not None
        or task.get("workItemId") is not None
        or task.get("payloadSeal") is not None
        or task.get("sealedPlan") is not None
        or task.get("sealedPlanSha256") is not None
        or task.get("closedAt") is not None
        or task.get("closedMode") is not None
        or task.get("agentSession") is not None
        or task.get("metadataIdentity") is not None
        or task.get("metadataStatus") != "pending"
        or any(
            not isinstance(unit, dict)
            or unit.get("evidenceSha256") is not None
            or unit.get("localAcceptedAt") is not None
            for unit in units
        )
    ):
        raise RuntimeError(f"cleanup target is not an unbound intake residue:{target['taskId']}")


def execute_task_cleanup(
    client: AdminClient,
    raw_targets: Any,
) -> dict[str, Any]:
    if not isinstance(raw_targets, list) or not 1 <= len(raw_targets) <= 20:
        raise RuntimeError("cleanup targets are invalid")
    targets = [cleanup_target(target) for target in raw_targets]
    if len({target["taskId"] for target in targets}) != len(targets):
        raise RuntimeError("cleanup task identities are duplicated")

    snapshots: dict[str, dict[str, Any]] = {}
    for target in targets:
        task = read_task(client, target["taskId"])
        assert_cleanup_identity(task, target)
        snapshots[target["taskId"]] = task

    deadline = time.monotonic() + 90
    deleted_task_ids: list[str] = []
    removed_source_ids: list[str] = []
    for target in targets:
        task_id = target["taskId"]
        current = snapshots[task_id]
        for source_id in target["sourceIds"]:
            client.request(
                "POST",
                f"/media-governance/tasks/{task_id}/sources/{source_id}/remove",
                {"expectedRevision": current["revision"]},
            )
            while True:
                current = read_task(client, task_id)
                remaining_ids = [
                    source.get("id")
                    for source in current.get("sources") or []
                    if isinstance(source, dict)
                ]
                if source_id not in remaining_ids and current.get("activeRunId") is None:
                    removed_source_ids.append(source_id)
                    break
                if time.monotonic() >= deadline:
                    return {
                        "deletedTaskIds": deleted_task_ids,
                        "operation": "task-cleanup",
                        "pending": {
                            "activeRunId": current.get("activeRunId"),
                            "revision": current.get("revision"),
                            "sourceId": source_id,
                            "taskId": task_id,
                        },
                        "removedSourceIds": removed_source_ids,
                        "state": "partial",
                    }
                time.sleep(1)
        if not project_page_task(current)["canDiscard"]:
            raise RuntimeError(f"cleanup task did not become discardable:{task_id}")
        result = client.request(
            "DELETE",
            f"/media-governance/tasks/{task_id}?"
            + urllib.parse.urlencode({"expectedRevision": current["revision"]}),
        )
        if not isinstance(result, dict) or result.get("deletedTaskId") != task_id:
            raise RuntimeError(f"cleanup delete identity mismatch:{task_id}")
        deleted_task_ids.append(task_id)
    return {
        "deletedTaskIds": deleted_task_ids,
        "operation": "task-cleanup",
        "removedSourceIds": removed_source_ids,
        "state": "complete",
    }


def command_body(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    expected_revision = payload.get("expectedRevision")
    if not isinstance(expected_revision, int) or expected_revision < 1:
        raise RuntimeError("expectedRevision is invalid")
    body: dict[str, Any] = {"expectedRevision": expected_revision}
    if operation in {"task-identity-update", "catalog-identity-restore"}:
        body["providerRef"] = payload.get("providerRef")
        if "releaseYear" in payload:
            body["releaseYear"] = payload["releaseYear"]
    elif operation in {
        "source-classification",
        "source-magnet-add",
        "source-torrent-add",
    }:
        for key in ("contentKind", "releaseGroup", "seasonNumbers", "sourceRole"):
            if key in payload:
                body[key] = payload[key]
        if operation == "source-magnet-add":
            body["magnetUri"] = payload.get("magnetUri")
    elif operation == "source-selection":
        body["fileMappings"] = payload.get("fileMappings")
        body["selectedFileIndices"] = payload.get("selectedFileIndices")
    elif operation == "subtitle-contract":
        for key in (
            "expectedEpisodeNumbers",
            "mappings",
            "releaseGroup",
            "sourceId",
        ):
            body[key] = payload.get(key)
    elif operation == "operator-decision":
        body["reason"] = payload.get("reason")
        body["selectedCandidateId"] = payload.get("selectedCandidateId")
    return body


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise RuntimeError("torrent descriptor redirect is forbidden")


def fetch_mikan_torrent_origin(url: str) -> bytes:
    if not MIKAN_TORRENT_FETCH_URL.fullmatch(url):
        raise RuntimeError("torrent fetch URL is not allowlisted")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "KT-Media-Governance/1.0"},
        method="GET",
    )
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=45) as response:
        if response.geturl() != url:
            raise RuntimeError("torrent descriptor identity changed")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > 2 * 1024 * 1024:
            raise RuntimeError("torrent descriptor exceeds size limit")
        descriptor = response.read(2 * 1024 * 1024 + 1)
    if not descriptor or len(descriptor) > 2 * 1024 * 1024:
        raise RuntimeError("torrent descriptor size is invalid")
    return descriptor


def fetch_mikan_torrent(url: Any) -> bytes:
    if not isinstance(url, str) or not MIKAN_TORRENT_URL.fullmatch(url):
        raise RuntimeError("torrent URL is not allowlisted")
    fallback_url = url.replace(
        "https://mikanani.kas.pub/",
        "https://mikanani.me/",
        1,
    )
    last_error: Exception | None = None
    for candidate in (url, fallback_url):
        try:
            return fetch_mikan_torrent_origin(candidate)
        except OSError as error:
            last_error = error
    raise RuntimeError("torrent descriptor is unavailable from Mikan origins") from last_error


def execute(client: AdminClient, payload: dict[str, Any]) -> dict[str, Any]:
    operation = payload.get("operation")
    if operation not in OPERATIONS:
        raise RuntimeError("operation is invalid")
    if operation == "task-page":
        query = {
            key: payload[key]
            for key in (
                "gateReason",
                "governanceProfile",
                "metadataStatus",
                "pageNo",
                "pageSize",
                "runState",
                "stage",
            )
            if key in payload
        }
        page = client.request(
            "GET",
            "/media-governance/tasks/page?" + urllib.parse.urlencode(query),
        )
        items = page.get("items", page.get("list", [])) if isinstance(page, dict) else []
        if not isinstance(items, list):
            raise RuntimeError("Admin task page projection is invalid")
        return {
            "operation": operation,
            "tasks": [project_page_task(item) for item in items],
            "total": page.get("total", len(items)),
        }
    if operation == "task-summary":
        return {
            "operation": operation,
            "summary": sanitize(client.request("GET", "/media-governance/tasks/summary")),
        }
    if operation == "series-page":
        page_no = payload.get("pageNo", 1)
        page_size = payload.get("pageSize", 100)
        if (
            not isinstance(page_no, int)
            or page_no < 1
            or not isinstance(page_size, int)
            or not 1 <= page_size <= 100
        ):
            raise RuntimeError("series page is invalid")
        query = urllib.parse.urlencode({"pageNo": page_no, "pageSize": page_size})
        return {
            "operation": operation,
            "page": sanitize(
                client.request("GET", f"/media-governance/series/page?{query}")
            ),
        }
    if operation == "series-detail":
        series_id = require_id(payload, "seriesId")
        return {
            "detail": sanitize(
                client.request("GET", f"/media-governance/series/{series_id}")
            ),
            "operation": operation,
            "seriesId": series_id,
        }
    if operation == "series-work-create":
        series_id = require_id(payload, "seriesId")
        identity = require_provider_ref(payload.get("identity"))
        work_type = payload.get("workType")
        if work_type not in {"movie", "theatrical", "tv"}:
            raise RuntimeError("series Work type is invalid")
        return {
            "detail": sanitize(
                client.request(
                    "POST",
                    f"/media-governance/series/{series_id}/works",
                    {"identity": identity, "workType": work_type},
                )
            ),
            "operation": operation,
            "seriesId": series_id,
        }
    if operation == "series-season-create":
        series_id = require_id(payload, "seriesId")
        work_id = require_id(payload, "workId")
        season = payload.get("season")
        if not isinstance(season, dict) or set(season) - {
            "episodeCount",
            "episodeStart",
            "releaseYear",
            "seasonNumber",
            "title",
        }:
            raise RuntimeError("series Season contract is invalid")
        return {
            "detail": sanitize(
                client.request(
                    "POST",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons",
                    season,
                )
            ),
            "operation": operation,
            "seriesId": series_id,
            "workId": work_id,
        }
    if operation == "rss-subscription-rebind":
        series_id = require_id(payload, "seriesId")
        work_id = require_id(payload, "workId")
        subscription_id = require_id(payload, "subscriptionId")
        season_number = payload.get("seasonNumber")
        expected_revision = payload.get("expectedRevision")
        if (
            not isinstance(season_number, int)
            or not 0 <= season_number <= 99
            or not isinstance(expected_revision, int)
            or expected_revision < 1
        ):
            raise RuntimeError("RSS subscription rebind contract is invalid")
        return {
            "operation": operation,
            "subscription": sanitize(
                client.request(
                    "PUT",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/{season_number}/rss-subscriptions/{subscription_id}/context",
                    {"expectedRevision": expected_revision},
                )
            ),
        }
    if operation == "rss-subscription-context-repair":
        series_id = require_id(payload, "seriesId")
        work_id = require_id(payload, "workId")
        source_work_id = require_id(payload, "sourceWorkId")
        subscription_id = require_id(payload, "subscriptionId")
        season_number = payload.get("seasonNumber")
        expected_revision = payload.get("expectedRevision")
        identity_input = payload.get("identity")
        if not isinstance(identity_input, dict):
            raise RuntimeError("RSS context repair identity is invalid")
        identity = require_provider_ref(
            {
                "provider": identity_input.get("provider"),
                "providerId": identity_input.get("providerId"),
            }
        )
        tasks = payload.get("tasks")
        if (
            not isinstance(season_number, int)
            or not 0 <= season_number <= 99
            or not isinstance(expected_revision, int)
            or expected_revision < 1
            or not isinstance(tasks, list)
            or not 1 <= len(tasks) <= 16
        ):
            raise RuntimeError("RSS context repair contract is invalid")
        normalized_tasks = []
        task_ids = set()
        for task in tasks:
            if not isinstance(task, dict) or set(task) != {"expectedRevision", "taskId"}:
                raise RuntimeError("RSS context repair Task is invalid")
            task_id = require_id(task, "taskId")
            task_revision = task.get("expectedRevision")
            if (
                not isinstance(task_revision, int)
                or task_revision < 1
                or task_id in task_ids
            ):
                raise RuntimeError("RSS context repair Task is invalid")
            task_ids.add(task_id)
            normalized_tasks.append(
                {"expectedRevision": task_revision, "taskId": task_id}
            )
        release_year = identity_input.get("releaseYear")
        if release_year is not None:
            identity["releaseYear"] = release_year
        return {
            "operation": operation,
            "result": sanitize(
                client.request(
                    "PUT",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/{season_number}/rss-subscriptions/{subscription_id}/context-repair",
                    {
                        "expectedRevision": expected_revision,
                        "identity": identity,
                        "sourceWorkId": source_work_id,
                        "tasks": normalized_tasks,
                    },
                )
            ),
        }
    if operation == "rss-subscription-poll":
        subscription_id = require_id(payload, "subscriptionId")
        return {
            "operation": operation,
            "result": sanitize(
                client.request(
                    "POST",
                    f"/media-governance/series/rss-subscriptions/{subscription_id}/poll",
                )
            ),
        }
    if operation == "series-history-classification":
        return {
            "classification": sanitize(
                client.request(
                    "GET",
                    "/media-governance/series/history-classification",
                )
            ),
            "operation": operation,
        }
    if operation == "series-reconcile":
        catalog = normalize_series_catalog(payload.get("seriesCatalog"))
        return {
            "detail": sanitize(
                client.request(
                    "POST",
                    "/media-governance/series/reconcile",
                    catalog,
                )
            ),
            "operation": operation,
        }
    if operation == "series-magnet-batch":
        series_id = require_id(payload, "seriesId")
        work_id = require_id(payload, "workId")
        season_number = payload.get("seasonNumber")
        if not isinstance(season_number, int) or not 0 <= season_number <= 99:
            raise RuntimeError("series season number is invalid")
        batch = normalize_magnet_batch(payload.get("magnetBatch"))
        return {
            "operation": operation,
            "result": sanitize(
                client.request(
                    "POST",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/{season_number}/magnet-batch",
                    batch,
                )
            ),
            "seasonNumber": season_number,
            "seriesId": series_id,
            "workId": work_id,
        }
    if operation == "task-create":
        body = {
            key: payload[key]
            for key in (
                "mediaType",
                "providerRef",
                "releaseYear",
                "seasonNumbers",
                "titleHint",
                "workItemId",
            )
            if key in payload
        }
        task = client.request("POST", "/media-governance/tasks", body)
        if not isinstance(task, dict) or not SAFE_ID.fullmatch(str(task.get("id", ""))):
            raise RuntimeError("Admin task create identity is invalid")
        return {"operation": operation, "task": project_task(task)}
    if operation == "task-cleanup":
        return execute_task_cleanup(client, payload.get("cleanupTargets"))

    task_id = require_id(payload, "taskId")
    if operation == "task-detail":
        return {"operation": operation, "task": project_task(read_task(client, task_id))}
    if operation == "source-manifest":
        source_id = require_id(payload, "sourceId")
        task = read_task(client, task_id)
        source = next(
            (candidate for candidate in task.get("sources", []) if candidate.get("id") == source_id),
            None,
        )
        if not isinstance(source, dict):
            raise RuntimeError("Admin source identity mismatch")
        manifest = source.get("manifest") or []
        offset = payload.get("manifestOffset", 0)
        limit = payload.get("manifestLimit", 100)
        if (
            not isinstance(offset, int)
            or offset < 0
            or not isinstance(limit, int)
            or limit < 1
            or limit > 200
        ):
            raise RuntimeError("manifest page is invalid")
        return {
            "items": sanitize(manifest[offset : offset + limit]),
            "nextOffset": min(offset + limit, len(manifest)),
            "operation": operation,
            "sourceId": source_id,
            "taskId": task_id,
            "total": len(manifest),
        }
    if operation == "agent-session":
        return {
            "operation": operation,
            "session": sanitize(
                client.request("GET", f"/media-governance/tasks/{task_id}/agent/session")
            ),
            "taskId": task_id,
        }
    if operation == "evidence":
        return {
            "evidence": sanitize(
                client.request("GET", f"/media-governance/tasks/{task_id}/evidence")
            ),
            "operation": operation,
            "taskId": task_id,
        }

    before = read_task(client, task_id)
    expected_revision = payload.get("expectedRevision")
    if before.get("revision") != expected_revision:
        raise RuntimeError(
            f"task revision mismatch:expected={expected_revision}:actual={before.get('revision')}"
        )
    if operation == "task-discard":
        command_result = client.request(
            "DELETE",
            f"/media-governance/tasks/{task_id}?"
            + urllib.parse.urlencode({"expectedRevision": expected_revision}),
        )
        return {
            "before": project_page_task(before),
            "commandResult": sanitize(command_result),
            "operation": operation,
            "taskId": task_id,
        }
    if operation == "source-magnet-add":
        command_result = client.request(
            "POST",
            f"/media-governance/tasks/{task_id}/sources/magnet",
            command_body(operation, payload),
        )
    elif operation == "source-torrent-add":
        command_result = client.request_multipart(
            f"/media-governance/tasks/{task_id}/sources/torrent",
            command_body(operation, payload),
            fetch_mikan_torrent(payload.get("torrentUrl")),
        )
    else:
        method, relative_route = COMMAND_ROUTES[operation]
        route = relative_route.format(
            sourceId=require_id(payload, "sourceId") if "{sourceId}" in relative_route else "",
            unitId=require_id(payload, "unitId") if "{unitId}" in relative_route else "",
        )
        command_result = client.request(
            method,
            f"/media-governance/tasks/{task_id}/{route}",
            command_body(operation, payload),
        )
    after = read_task(client, task_id)
    return {
        "after": project_task(after),
        "before": project_page_task(before),
        "commandResult": sanitize(command_result),
        "operation": operation,
        "taskId": task_id,
    }


def read_input() -> tuple[bytearray, dict[str, Any]]:
    password = bytearray(sys.stdin.buffer.readline(1_025).rstrip(b"\r\n"))
    if not password or len(password) > 512 or b"\x00" in password:
        raise RuntimeError("credential stdin is invalid")
    raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise RuntimeError("request stdin exceeds the sealed limit")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("request stdin is invalid")
    return password, payload


def main() -> None:
    verify_script_digest()
    password, payload = read_input()
    client: AdminClient | None = None
    try:
        client = AdminClient(password.decode("utf-8"))
        result = execute(client, payload)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    finally:
        for index in range(len(password)):
            password[index] = 0
        if client is not None:
            client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - return one bounded MCP error.
        print(
            json.dumps(
                {"error": bounded_error(error), "ok": False},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        raise SystemExit(2)
