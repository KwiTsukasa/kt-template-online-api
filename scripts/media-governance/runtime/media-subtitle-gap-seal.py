#!/usr/bin/env python3
"""把固定来源搜索和零载荷探针结果密封为逐季字幕缺口证据。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import tempfile
from typing import Any


EVIDENCE_PARENT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
DIGEST = re.compile(r"[a-f0-9]{64}")
INFO_HASH = re.compile(r"[a-f0-9]{40}")
RUN_ID = re.compile(r"[a-z0-9][a-z0-9-]{2,47}")
WORK_ITEM = re.compile(r"media-\d{3}")
FIXED_PROVIDERS = {"bangumi-moe", "mikanani", "nyaa"}


def fail(message: str) -> None:
    raise RuntimeError(message)


def descendant(path: pathlib.Path, root: pathlib.Path) -> bool:
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


def load_json(path: pathlib.Path, label: str) -> dict[str, Any]:
    if (
        not path.is_absolute()
        or path.is_symlink()
        or not path.is_file()
        or not descendant(path.resolve(strict=True), EVIDENCE_PARENT.resolve(strict=True))
    ):
        fail(f"{label} path is unsafe")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        fail(f"{label} payload is invalid")
    return payload


def atomic_json(path: pathlib.Path, payload: dict[str, Any]) -> None:
    if path.exists() or path.is_symlink():
        fail("subtitle gap output already exists")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def captured_at() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def verify_self() -> None:
    expected = os.environ.get("KT_SCRIPT_SHA256", "")
    if not DIGEST.fullmatch(expected) or sha256_file(pathlib.Path(__file__)) != expected:
        fail("media subtitle gap seal script SHA-256 changed")


def validate_inventory(
    contract: dict[str, Any], *, season: int, work_item: str
) -> None:
    inventory_path = pathlib.Path(str(contract.get("inventoryPath") or ""))
    inventory_sha = str(contract.get("inventorySha256") or "")
    if not DIGEST.fullmatch(inventory_sha):
        fail("subtitle gap inventory SHA-256 is invalid")
    inventory = load_json(inventory_path, "subtitle gap inventory")
    if sha256_file(inventory_path) != inventory_sha:
        fail("subtitle gap inventory SHA-256 changed")
    if (
        inventory.get("workItemId") != work_item
        or inventory.get("mode") != "local-only-readonly"
    ):
        fail("subtitle gap inventory identity changed")
    video_paths = {
        str(row.get("path") or "")
        for row in (inventory.get("files") or {}).get("videos", [])
        if isinstance(row, dict)
    }
    episodes: dict[int, str] = {}
    for row in (inventory.get("database") or {}).get("rows", []):
        if not isinstance(row, dict) or row.get("type") != "Episode":
            continue
        if row.get("parent_season") != season:
            continue
        episode = row.get("episode_number")
        source_path = str(row.get("path") or "")
        if not isinstance(episode, int) or episode < 1 or source_path not in video_paths:
            fail("subtitle gap inventory episode mapping is invalid")
        previous = episodes.setdefault(episode, source_path)
        if previous != source_path:
            fail("subtitle gap inventory episode mapping is ambiguous")
    required = contract.get("requiredEpisodeCount")
    if not isinstance(required, int) or required < 1 or len(episodes) != required:
        fail("subtitle gap required episode count changed")


def validate_candidate(
    value: Any, *, season: int, work_item: str
) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("subtitle gap candidate is invalid")
    info_hash = str(value.get("infoHash") or "").lower()
    evidence_run_id = str(value.get("evidenceRunId") or "")
    evidence_sha = str(value.get("evidenceSha256") or "")
    source_group = str(value.get("sourceGroup") or "").strip()
    evidence_path = pathlib.Path(str(value.get("evidencePath") or ""))
    expected_path = (
        EVIDENCE_PARENT
        / evidence_run_id
        / f"{work_item}-s{season:02d}-{info_hash}-subtitle-metadata.json"
    )
    if (
        not INFO_HASH.fullmatch(info_hash)
        or not RUN_ID.fullmatch(evidence_run_id)
        or not DIGEST.fullmatch(evidence_sha)
        or not source_group
        or len(source_group) > 160
        or evidence_path != expected_path
    ):
        fail("subtitle gap candidate identity changed")
    evidence = load_json(evidence_path, "subtitle gap candidate evidence")
    if sha256_file(evidence_path) != evidence_sha:
        fail("subtitle gap candidate evidence SHA-256 changed")
    if (
        evidence.get("schemaVersion") != "media-subtitle-source-metadata-v1"
        or evidence.get("workItemId") != work_item
        or str(evidence.get("infoHash") or "").lower() != info_hash
        or evidence.get("videoDownloadCount") != 0
        or evidence.get("payloadDownloadedBytes") != 0
    ):
        fail("subtitle gap candidate evidence boundary changed")
    status = evidence.get("status")
    if status == "metadata-ready":
        mutation = evidence.get("mutationBoundaries") or {}
        if (
            evidence.get("season") != season
            or evidence.get("subtitleFileCount") != 0
            or evidence.get("officialTaskRemoved") is not True
            or mutation.get("cloudWrites") != 0
            or mutation.get("databaseDirectWrite") is not False
            or mutation.get("formalMediaWrites") != 0
            or mutation.get("mechanicalScanTriggered") is not False
            or mutation.get("payloadDownloads") != 0
            or mutation.get("uiWrites") != 0
        ):
            fail("subtitle gap candidate has a downloadable subtitle or crossed a boundary")
        outcome = "metadata-ready-no-sidecar"
    elif status == "failed" and str(evidence.get("error") or "").strip():
        outcome = "source-metadata-unavailable"
    else:
        fail("subtitle gap candidate outcome is incomplete")
    return {
        "availabilityEvidenceSha256": evidence_sha,
        "infoHash": info_hash,
        "outcome": outcome,
        "sourceGroup": source_group,
    }


def validate_searches(values: Any) -> list[dict[str, Any]]:
    if not isinstance(values, list) or not 3 <= len(values) <= 40:
        fail("subtitle gap fixed provider set is incomplete")
    rows = []
    seen = set()
    for value in values:
        if not isinstance(value, dict):
            fail("subtitle gap search summary is invalid")
        provider = value.get("provider")
        query = str(value.get("query") or "").strip()
        provider_count = value.get("providerResultCount")
        candidate_count = value.get("candidateCount")
        result_sha = value.get("resultSha256")
        key = (provider, query)
        if (
            provider not in FIXED_PROVIDERS
            or not query
            or len(query) > 160
            or not isinstance(provider_count, int)
            or not 0 <= provider_count <= 100_000
            or not isinstance(candidate_count, int)
            or not 0 <= candidate_count <= 100_000
            or (result_sha is not None and not DIGEST.fullmatch(str(result_sha)))
            or key in seen
        ):
            fail("subtitle gap search summary is invalid")
        seen.add(key)
        rows.append(
            {
                "candidateCount": candidate_count,
                "provider": provider,
                "providerResultCount": provider_count,
                "query": query,
                "resultSha256": result_sha,
            }
        )
    if {row["provider"] for row in rows} != FIXED_PROVIDERS:
        fail("subtitle gap fixed provider set is incomplete")
    return sorted(rows, key=lambda row: (row["provider"], row["query"]))


def seal_gap(contract_path: pathlib.Path) -> dict[str, Any]:
    contract = load_json(contract_path, "subtitle gap contract")
    work_item = str(contract.get("workItemId") or "")
    season = contract.get("seasonNumber")
    output_path = pathlib.Path(str(contract.get("outputPath") or ""))
    run_id = contract_path.parent.name
    if (
        contract.get("schemaVersion") != "media-subtitle-gap-seal-contract-v1"
        or not WORK_ITEM.fullmatch(work_item)
        or not isinstance(season, int)
        or season < 0
        or not RUN_ID.fullmatch(run_id)
        or contract_path
        != EVIDENCE_PARENT
        / run_id
        / f"{work_item}-s{season:02d}-subtitle-gap-contract.json"
        or output_path
        != EVIDENCE_PARENT / run_id / f"{work_item}-s{season:02d}-subtitle-gap.json"
    ):
        fail("subtitle gap contract identity changed")
    validate_inventory(contract, season=season, work_item=work_item)
    candidates = [
        validate_candidate(value, season=season, work_item=work_item)
        for value in contract.get("candidates") or []
    ]
    if not candidates or len({row["infoHash"] for row in candidates}) != len(candidates):
        fail("subtitle gap candidate set is incomplete")
    searches = validate_searches(contract.get("searches"))
    payload = {
        "candidates": candidates,
        "capturedAt": captured_at(),
        "decision": "manual-governance-required-until-one-complete-season-source-is-live",
        "fallbackSearch": {
            "compliantCandidateCount": 0,
            "fixedProviderSet": sorted(FIXED_PROVIDERS),
            "queries": searches,
        },
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "mediaVideoDownloads": 0,
            "uiWrites": 0,
        },
        "requiredEpisodeCount": contract["requiredEpisodeCount"],
        "schemaVersion": "media-subtitle-source-resolution-v1",
        "seasonNumber": season,
        "selectedSource": None,
        "status": "source-blocked",
        "videoDownloadCeiling": 0,
        "workItemId": work_item,
    }
    atomic_json(output_path, payload)
    return {
        "evidencePath": os.fspath(output_path),
        "evidenceSha256": sha256_file(output_path),
        "payload": payload,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    return parser.parse_args()


def main() -> int:
    verify_self()
    args = parse_args()
    result = seal_gap(pathlib.Path(args.contract))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
