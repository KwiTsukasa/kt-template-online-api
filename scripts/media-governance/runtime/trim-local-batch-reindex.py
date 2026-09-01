#!/usr/bin/env python3
"""通过 trim.media 官方 API 批量重建密封本地媒体计划的精确索引。"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET


DATABASE_ROOT = Path("/usr/local/apps/@appdata/trim.media/database")
MEDIA_DB = DATABASE_ROOT / "trimmedia.db"
ACTIVITY_DB = DATABASE_ROOT / "trimactivity.db"
DATABASE_NAMES = ("trimmedia.db", "trimactivity.db", "trimmedia_ext.db")
RUNNING_TASKS_ROUTE = "/v/api/v1/task/running"
FAVORITE_ROUTE = "/v/api/v1/item/favorite"
GUID_PATTERN = re.compile(r"[0-9a-f]{32}")
OFFICIAL_TASK_SETTLE_TIMEOUT = 600


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_exact_file(path: Path, expected: str, label: str) -> None:
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or GUID_PATTERN.fullmatch(expected) is not None
        or re.fullmatch(r"[0-9a-f]{64}", expected) is None
        or sha256(path) != expected
    ):
        raise RuntimeError(f"{label} SHA gate failed")


def load_module(path: Path, expected_sha256: str, name: str):
    require_exact_file(path, expected_sha256, name)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("JSON input must be an object")
    return value


def write_json_once(path: Path, value: dict) -> None:
    if not path.is_absolute() or path.exists() or path.is_symlink():
        raise RuntimeError("output must be a new absolute path")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError("temporary output already exists")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    temporary.replace(path)


def reindex_result_summary(output: dict, path: Path) -> dict:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("reindex evidence output is unavailable")
    return {**output, "evidenceSha256": sha256(path)}


def root_guid_for_row(row: dict) -> str:
    row_type = row.get("type")
    if row_type == "Episode" and row.get("grandparent_type") == "TV":
        value = row.get("grandparent_guid")
    elif row_type in {"Movie", "TV"}:
        value = row.get("item_guid")
    else:
        raise RuntimeError("inventory row has no supported TV/Movie root")
    if not isinstance(value, str) or GUID_PATTERN.fullmatch(value) is None:
        raise RuntimeError("inventory row has an invalid root GUID")
    return value


def plan_identity_contracts(plan: dict) -> dict[str, dict]:
    work_item_id = plan.get("workItemId")
    identity = plan.get("identity") or {}
    target_root_text = (
        plan.get("execution", {}).get("allowlists", {}).get("localTargetRoot")
    )
    if not isinstance(work_item_id, str) or not work_item_id:
        raise RuntimeError("plan work item is missing")
    if not isinstance(target_root_text, str) or not target_root_text.startswith("/"):
        raise RuntimeError("plan local target root is missing")
    target_root = Path(target_root_text).resolve(strict=False)
    if identity.get("mediaType") != "bundle":
        raw_components = [{**identity, "componentId": work_item_id, "targetRoot": target_root_text}]
    else:
        raw_components = identity.get("components")
        if not isinstance(raw_components, list) or not raw_components:
            raise RuntimeError("bundle identity has no components")
    contracts = {}
    provider_keys = set()
    roots = []
    for raw in raw_components:
        component_id = raw.get("componentId")
        media_type = raw.get("mediaType")
        provider = raw.get("provider")
        provider_id = str(raw.get("providerId") or "")
        component_root_text = raw.get("targetRoot")
        if (
            not isinstance(component_id, str)
            or not component_id
            or media_type not in {"tv", "movie"}
            or provider != "tmdb"
            or not provider_id.isdigit()
            or not isinstance(component_root_text, str)
            or not component_root_text.startswith("/")
        ):
            raise RuntimeError("plan identity component is invalid")
        component_root = Path(component_root_text).resolve(strict=False)
        try:
            component_root.relative_to(target_root)
        except ValueError as error:
            raise RuntimeError("identity component target is outside local target root") from error
        if component_root == target_root and identity.get("mediaType") == "bundle":
            raise RuntimeError("bundle component target cannot equal local target root")
        key = work_item_id if identity.get("mediaType") != "bundle" else f"{work_item_id}:{component_id}"
        provider_key = (media_type, provider_id)
        if key in contracts or provider_key in provider_keys:
            raise RuntimeError("plan identity components are duplicated")
        provider_keys.add(provider_key)
        roots.append((key, component_root))
        contracts[key] = {
            **raw,
            "componentId": component_id,
            "componentKey": key,
            "mediaType": media_type,
            "parentWorkItemId": work_item_id,
            "provider": provider,
            "providerId": provider_id,
            "targetRoot": str(component_root),
        }
    for index, (left_key, left_root) in enumerate(roots):
        for right_key, right_root in roots[index + 1:]:
            if left_root in right_root.parents or right_root in left_root.parents:
                raise RuntimeError(
                    f"identity component targets overlap: {left_key}, {right_key}"
                )
    return contracts


def component_key_for_inventory_row(contracts: dict[str, dict], row: dict) -> str:
    if row.get("type") == "Episode" and row.get("grandparent_type") == "TV":
        media_type = "tv"
        provider_id = row.get("series_tmdb_id") or row.get("tmdb_id")
    elif row.get("type") == "Movie":
        media_type = "movie"
        provider_id = row.get("tmdb_id")
    else:
        raise RuntimeError("inventory row has no supported component identity")
    matches = [
        key
        for key, contract in contracts.items()
        if contract["mediaType"] == media_type
        and contract["providerId"] == str(provider_id or "")
    ]
    if len(matches) != 1:
        raise RuntimeError("inventory row does not match exactly one identity component")
    return matches[0]


def component_key_for_target_path(contracts: dict[str, dict], path_text: str) -> str:
    target = Path(path_text).resolve(strict=False)
    matches = []
    for key, contract in contracts.items():
        root = Path(contract["targetRoot"])
        try:
            target.relative_to(root)
        except ValueError:
            continue
        if target != root:
            matches.append(key)
    if len(matches) != 1:
        raise RuntimeError("canonical target does not match exactly one identity component")
    return matches[0]


def expected_global_after_delete(global_state: dict, scoped_state: dict) -> dict:
    return {
        "favorite": global_state["favorite"] - scoped_state["favorite"],
        "itemUser": global_state["itemUser"] - scoped_state["itemUser"],
        "play": global_state["play"] - scoped_state["play"],
    }


def expected_resume_user_state(
    backup_global: dict,
    *,
    deleted_old_state: dict,
    prior_orphan_state: dict,
    restored_favorite_count: int,
) -> dict[str, int]:
    keys = ("favorite", "itemUser", "play")
    states = (backup_global, deleted_old_state, prior_orphan_state)
    if any(
        not isinstance(state, dict)
        or any(not isinstance(state.get(key), int) or state[key] < 0 for key in keys)
        for state in states
    ):
        raise RuntimeError("resume user state is invalid")
    if (
        not isinstance(restored_favorite_count, int)
        or restored_favorite_count < 0
        or restored_favorite_count > deleted_old_state["favorite"]
    ):
        raise RuntimeError("restored favorite count is invalid")
    result = {
        key: backup_global[key]
        - deleted_old_state[key]
        - prior_orphan_state[key]
        for key in keys
    }
    result["favorite"] += restored_favorite_count
    if any(value < 0 for value in result.values()) or result["favorite"] > backup_global[
        "favorite"
    ]:
        raise RuntimeError("resume user state is impossible")
    return result


def connect_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def global_user_state(database: Path = MEDIA_DB) -> dict[str, int]:
    with connect_readonly(database) as connection:
        return {
            "favorite": connection.execute(
                "SELECT COUNT(*) FROM item_user_favorite"
            ).fetchone()[0],
            "itemUser": connection.execute("SELECT COUNT(*) FROM item_user").fetchone()[0],
            "play": connection.execute(
                "SELECT COUNT(*) FROM item_user_play"
            ).fetchone()[0],
        }


def hierarchy_snapshot(root_guid: str, database: Path = MEDIA_DB) -> dict:
    with connect_readonly(database) as connection:
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
                SELECT i.* FROM item i JOIN tree ON tree.guid = i.guid
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
                f"SELECT * FROM item_media WHERE item_guid IN ({marks}) ORDER BY guid",
                item_guids,
            )
        ]
        media_guids = [row["guid"] for row in media]
        media_marks = ",".join("?" for _ in media_guids) or "NULL"
        state = {
            "favorite": connection.execute(
                f"SELECT COUNT(*) FROM item_user_favorite WHERE item_guid IN ({marks})",
                item_guids,
            ).fetchone()[0],
            "itemUser": connection.execute(
                f"SELECT COUNT(*) FROM item_user WHERE item_guid IN ({marks})",
                item_guids,
            ).fetchone()[0],
            "play": connection.execute(
                f"SELECT COUNT(*) FROM item_user_play WHERE item_guid IN ({marks}) "
                f"OR media_guid IN ({media_marks})",
                [*item_guids, *media_guids],
            ).fetchone()[0],
        }
        favorites = [
            dict(row)
            for row in connection.execute(
                f"SELECT user_guid, item_guid, item_type FROM item_user_favorite "
                f"WHERE item_guid IN ({marks}) ORDER BY user_guid, item_guid",
                item_guids,
            )
        ]
    return {"favorites": favorites, "items": items, "media": media, "state": state}


def canonical_rows(paths: list[str], database: Path = MEDIA_DB) -> list[dict]:
    if not paths:
        return []
    marks = ",".join("?" for _ in paths)
    with connect_readonly(database) as connection:
        return [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT im.guid AS media_guid, im.item_guid, im.path, im.size,
                       im.recognition_status,
                       i.type, i.title, i.season_number, i.episode_number,
                       i.tmdb_id, i.nfo_path AS item_nfo_path,
                       p.guid AS season_guid, p.season_number AS parent_season,
                       p.nfo_path AS season_nfo_path,
                       gp.guid AS series_guid, gp.type AS series_type,
                       gp.tmdb_id AS series_tmdb_id,
                       gp.nfo_path AS series_nfo_path
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


def wait_for_rows(paths: list[str], expected: int, timeout: float = 300) -> list[dict]:
    deadline = time.monotonic() + timeout
    rows = canonical_rows(paths)
    while len(rows) != expected and time.monotonic() < deadline:
        time.sleep(1)
        rows = canonical_rows(paths)
    return rows


def active_path_count(prefix: str, database: Path = MEDIA_DB) -> int:
    with connect_readonly(database) as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM item_media WHERE path = ? OR path LIKE ?",
            (prefix, prefix + "/%"),
        ).fetchone()[0]


def provider_root_count(media_type: str, provider_id: str) -> int:
    item_type = "TV" if media_type == "tv" else "Movie"
    with connect_readonly(MEDIA_DB) as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM item WHERE type = ? AND tmdb_id = ?",
            (item_type, int(provider_id)),
        ).fetchone()[0]


def provider_root_guids(media_type: str, provider_id: str, database: Path) -> list[str]:
    item_type = "TV" if media_type == "tv" else "Movie"
    with connect_readonly(database) as connection:
        return [
            row[0]
            for row in connection.execute(
                "SELECT guid FROM item WHERE type = ? AND tmdb_id = ? ORDER BY guid",
                (item_type, int(provider_id)),
            )
        ]


def validate_backup(evidence: dict, plans: dict[str, dict]) -> Path:
    if evidence.get("schemaVersion") != "media-local-transaction-backup-v1":
        raise RuntimeError("backup evidence schema changed")
    backup_root = Path(str(evidence.get("databaseBackupRoot") or ""))
    if not backup_root.is_absolute() or not backup_root.is_dir() or backup_root.is_symlink():
        raise RuntimeError("database backup root is missing or unsafe")
    database_rows = evidence.get("databases")
    if not isinstance(database_rows, list) or len(database_rows) != 3:
        raise RuntimeError("backup evidence must contain exactly three databases")
    for row in database_rows:
        name = row.get("name")
        path = backup_root / str(name)
        if name not in DATABASE_NAMES or Path(str(row.get("path"))) != path:
            raise RuntimeError("backup database boundary changed")
        require_exact_file(path, str(row.get("sha256") or ""), "backup database")
        with connect_readonly(path) as connection:
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("backup database quick_check failed")
    plan_rows = evidence.get("plans")
    if not isinstance(plan_rows, list) or len(plan_rows) != len(plans):
        raise RuntimeError("backup evidence plan set changed")
    backed = {row.get("workItemId"): row for row in plan_rows}
    if set(backed) != set(plans):
        raise RuntimeError("backup evidence work-item set changed")
    for work_item_id, plan in plans.items():
        path = Path(str(backed[work_item_id].get("path") or ""))
        if path != plan["_path"] or sha256(path) != backed[work_item_id].get("sha256"):
            raise RuntimeError("backup evidence plan SHA changed")
    return backup_root


def validate_bundle(
    plan_paths: list[Path],
    inventory_paths: list[Path],
    inventory_hashes: list[str],
    readd_module,
) -> tuple[dict[str, dict], dict[str, dict], dict[str, list[dict]], list[dict]]:
    if len(plan_paths) != len(inventory_paths) or len(plan_paths) != len(inventory_hashes):
        raise RuntimeError("plan, inventory and inventory SHA counts must match")
    plans: dict[str, dict] = {}
    inventories: dict[str, dict] = {}
    roots: dict[str, list[dict]] = {}
    records: list[dict] = []
    for plan_path in plan_paths:
        if not plan_path.is_absolute() or not plan_path.is_file() or plan_path.is_symlink():
            raise RuntimeError("plan must be an existing absolute regular file")
        plan = read_json(plan_path)
        readd_module.require_sealed_plan(plan)
        work_item_id = plan["workItemId"]
        if work_item_id in plans:
            raise RuntimeError("duplicate work item in batch")
        if plan.get("identity", {}).get("provider") != "tmdb":
            raise RuntimeError("batch reindex currently accepts only TMDB identities")
        plan["_path"] = plan_path
        plan["_identityContracts"] = plan_identity_contracts(plan)
        plans[work_item_id] = plan
    for inventory_path, expected_sha in zip(inventory_paths, inventory_hashes, strict=True):
        require_exact_file(inventory_path, expected_sha, "inventory")
        inventory = read_json(inventory_path)
        work_item_id = inventory.get("workItemId")
        if work_item_id in inventories or work_item_id not in plans:
            raise RuntimeError("inventory work-item set changed")
        plan = plans[work_item_id]
        source_root = plan["execution"]["allowlists"]["localSourceRoot"]
        if inventory.get("sourceRoot") != source_root:
            raise RuntimeError("inventory source root does not match sealed plan")
        inventories[work_item_id] = inventory
        for row in inventory.get("database", {}).get("rows", []):
            root_guid = root_guid_for_row(row)
            component_key = component_key_for_inventory_row(
                plan["_identityContracts"], row
            )
            roots.setdefault(root_guid, []).append({
                "componentKey": component_key,
                "workItemId": work_item_id,
                **row,
            })
    if set(inventories) != set(plans) or not roots:
        raise RuntimeError("batch plan/inventory set is incomplete")
    if any(
        len({row["componentKey"] for row in root_rows}) != 1
        for root_rows in roots.values()
    ):
        raise RuntimeError("one frozen provider root spans multiple identity components")
    for work_item_id, plan in plans.items():
        for record in readd_module.target_records(plan):
            readd_module.verify_record(record)
            records.append({
                "componentKey": component_key_for_target_path(
                    plan["_identityContracts"], record["pathText"]
                ),
                "workItemId": work_item_id,
                **record,
            })
    path_texts = [row["pathText"] for row in records]
    if len(path_texts) != len(set(path_texts)):
        raise RuntimeError("canonical video targets are duplicated across plans")
    component_counts = {}
    for record in records:
        component_counts[record["componentKey"]] = (
            component_counts.get(record["componentKey"], 0) + 1
        )
    for plan in plans.values():
        for key, contract in plan["_identityContracts"].items():
            expected = contract.get("videoCount")
            if isinstance(expected, int) and component_counts.get(key, 0) != expected:
                raise RuntimeError("canonical component video count changed")
    return plans, inventories, roots, records


def compare_frozen_root(root_rows: list[dict], snapshot: dict) -> None:
    frozen = {
        (row["media_guid"], row["item_guid"], row["path"], int(row["size"]))
        for row in root_rows
    }
    live = {
        (row["guid"], row["item_guid"], row["path"], int(row["size"]))
        for row in snapshot["media"]
    }
    if live != frozen:
        raise RuntimeError("live old hierarchy no longer matches frozen inventory")


def backup_scope(roots: dict[str, list[dict]], backup_db: Path) -> tuple[dict, dict]:
    scoped = {"favorite": 0, "itemUser": 0, "play": 0}
    snapshots = {}
    for root_guid, root_rows in roots.items():
        snapshot = hierarchy_snapshot(root_guid, backup_db)
        if not snapshot["items"]:
            raise RuntimeError("frozen root is missing from the database backup")
        compare_frozen_root(root_rows, snapshot)
        snapshots[root_guid] = snapshot
        for key in scoped:
            scoped[key] += snapshot["state"][key]
    if scoped["itemUser"]:
        raise RuntimeError("batch contains scoped item-user state without a migration policy")
    return scoped, snapshots


def live_transition_state(roots: dict[str, list[dict]]) -> tuple[list[str], list[str]]:
    present = []
    absent = []
    for root_guid, root_rows in roots.items():
        snapshot = hierarchy_snapshot(root_guid)
        if snapshot["items"]:
            compare_frozen_root(root_rows, snapshot)
            present.append(root_guid)
        else:
            media_guids = [row["media_guid"] for row in root_rows]
            marks = ",".join("?" for _ in media_guids)
            with connect_readonly(MEDIA_DB) as connection:
                count = connection.execute(
                    f"SELECT COUNT(*) FROM item_media WHERE guid IN ({marks})",
                    media_guids,
                ).fetchone()[0]
            if count:
                raise RuntimeError("absent root still owns active frozen media rows")
            absent.append(root_guid)
    return present, absent


def load_official_helper(path: Path, expected_sha256: str, user_guid: str | None = None):
    helper = load_module(path, expected_sha256, "trim_official_api")
    for name in ("active_admin_token", "request", "require_ok"):
        if not callable(getattr(helper, name, None)):
            raise RuntimeError("official helper contract changed")
    if user_guid is None:
        token = helper.active_admin_token()
    else:
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
        if row is None:
            raise RuntimeError("favorite owner has no active trim.media session")
        token = row[0]
    if not isinstance(token, str) or not token:
        raise RuntimeError("official helper returned no active session")
    helper.active_admin_token = lambda: token
    return helper


def require_library_policy(helper, library_guid: str) -> None:
    if GUID_PATTERN.fullmatch(library_guid) is None:
        raise RuntimeError("library GUID must be lowercase hexadecimal")
    library = helper.require_ok(
        helper.request(f"/v/api/v1/mdb/{library_guid}"), "official library query"
    ) or {}
    if (
        library.get("prefer_local_nfo") != 1
        or library.get("auto_scrap_subtitle") != 0
        or library.get("subtitle_lan") != "zh-CN"
    ):
        raise RuntimeError("trim.media LocalNFO/subtitle policy changed")


def require_official_boundary(helper, library_guid: str) -> None:
    if GUID_PATTERN.fullmatch(library_guid) is None:
        raise RuntimeError("library GUID must be lowercase hexadecimal")
    running = helper.require_ok(
        helper.request(RUNNING_TASKS_ROUTE), "official running task query"
    ) or []
    if running:
        raise RuntimeError("trim.media has running tasks")
    require_library_policy(helper, library_guid)


def wait_for_official_boundary(
    helper,
    library_guid: str,
    timeout: float = OFFICIAL_TASK_SETTLE_TIMEOUT,
    interval: float = 1,
) -> None:
    if timeout <= 0 or interval <= 0:
        raise RuntimeError("official task settle timeout must be positive")
    deadline = time.monotonic() + timeout
    running = helper.require_ok(
        helper.request(RUNNING_TASKS_ROUTE), "official running task query"
    ) or []
    observed_running = bool(running)
    if observed_running:
        emit_progress("official-task-settle", 0, 1)
    while running:
        if time.monotonic() >= deadline:
            raise RuntimeError("trim.media has running tasks after bounded settle")
        time.sleep(interval)
        running = helper.require_ok(
            helper.request(RUNNING_TASKS_ROUTE), "official running task query"
        ) or []
    if observed_running:
        emit_progress("official-task-settle", 1, 1)
    require_library_policy(helper, library_guid)


def emit_progress(phase: str, completed: int, total: int) -> None:
    print(
        json.dumps(
            {"completed": completed, "phase": phase, "total": total},
            sort_keys=True,
        ),
        file=sys.stderr,
        flush=True,
    )


def delete_old_roots(helper, roots: dict[str, list[dict]]) -> int:
    deleted = 0
    total = len(roots)
    for index, (root_guid, root_rows) in enumerate(sorted(roots.items()), start=1):
        snapshot = hierarchy_snapshot(root_guid)
        if not snapshot["items"]:
            emit_progress("old-hierarchy-delete", index, total)
            continue
        compare_frozen_root(root_rows, snapshot)
        helper.require_ok(
            helper.request(
                f"/v/api/v1/item/{root_guid}",
                method="DELETE",
                payload={
                    "delete_file": 0,
                    "guid": root_guid,
                    "media_guids": sorted(row["guid"] for row in snapshot["media"]),
                },
            ),
            "official old hierarchy delete",
        )
        deadline = time.monotonic() + 90
        while hierarchy_snapshot(root_guid)["items"] and time.monotonic() < deadline:
            time.sleep(0.25)
        if hierarchy_snapshot(root_guid)["items"]:
            raise RuntimeError("official API left an old hierarchy active")
        deleted += 1
        emit_progress("old-hierarchy-delete", index, total)
    return deleted


def readd_missing_paths(helper, library_guid: str, records: list[dict], route: str) -> int:
    paths = [row["pathText"] for row in records]
    rows = canonical_rows(paths)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["path"]] = counts.get(row["path"], 0) + 1
    if any(count != 1 for count in counts.values()) or any(path not in paths for path in counts):
        raise RuntimeError("canonical path transition contains duplicate or unexpected rows")
    missing = [path for path in paths if path not in counts]
    total = len(missing)
    for index, path in enumerate(missing, start=1):
        helper.require_ok(
            helper.request(
                route,
                method="POST",
                payload={"mdb_guid": library_guid, "path": path},
            ),
            "official exact-path re-add",
        )
        if index % 10 == 0 or index == total:
            emit_progress("exact-path-readd", index, total)
    return total


def canonical_root_guids(
    plans: dict[str, dict], records: list[dict]
) -> dict[str, str]:
    contracts = {
        key: contract
        for plan in plans.values()
        for key, contract in plan["_identityContracts"].items()
    }
    by_component: dict[str, list[str]] = {}
    for record in records:
        by_component.setdefault(record["componentKey"], []).append(record["pathText"])
    result = {}
    for component_key, paths in by_component.items():
        rows = wait_for_rows(paths, len(paths))
        if len(rows) != len(paths) or {row["path"] for row in rows} != set(paths):
            raise RuntimeError("canonical media path set did not converge")
        media_type = contracts[component_key]["mediaType"]
        values = {
            row["series_guid"] if media_type == "tv" else row["item_guid"]
            for row in rows
        }
        if len(values) != 1 or None in values:
            raise RuntimeError("canonical media rows do not share one provider root")
        result[component_key] = next(iter(values))
    return result


def delete_frozen_provider_orphans(
    helper,
    plans: dict[str, dict],
    canonical_roots: dict[str, str],
    backup_db: Path,
) -> tuple[int, dict[str, int]]:
    candidates: list[tuple[str, dict, dict]] = []
    contracts = {
        key: contract
        for plan in plans.values()
        for key, contract in plan["_identityContracts"].items()
    }
    for component_key, identity in contracts.items():
        live_roots = provider_root_guids(
            identity["mediaType"], str(identity["providerId"]), MEDIA_DB
        )
        canonical_root = canonical_roots[component_key]
        for root_guid in live_roots:
            if root_guid == canonical_root:
                continue
            live = hierarchy_snapshot(root_guid)
            frozen = hierarchy_snapshot(root_guid, backup_db)
            if not frozen["items"] or not live["items"]:
                raise RuntimeError("duplicate provider root is not frozen in the backup")
            live_media = {
                (row["guid"], row["item_guid"], row["path"], int(row["size"]))
                for row in live["media"]
            }
            frozen_media = {
                (row["guid"], row["item_guid"], row["path"], int(row["size"]))
                for row in frozen["media"]
            }
            if (
                live_media != frozen_media
                or live["state"] != frozen["state"]
                or live["state"]["favorite"]
                or live["state"]["itemUser"]
                or any(Path(row["path"]).exists() for row in live["media"])
            ):
                raise RuntimeError(
                    "duplicate provider root is not a file-absent, backup-frozen orphan"
                )
            candidates.append((root_guid, live, frozen))
    scoped = {"favorite": 0, "itemUser": 0, "play": 0}
    total = len(candidates)
    for index, (root_guid, live, frozen) in enumerate(candidates, start=1):
        helper.require_ok(
            helper.request(
                f"/v/api/v1/item/{root_guid}",
                method="DELETE",
                payload={
                    "delete_file": 0,
                    "guid": root_guid,
                    "media_guids": sorted(row["guid"] for row in live["media"]),
                },
            ),
            "official frozen provider-orphan delete",
        )
        deadline = time.monotonic() + 90
        while hierarchy_snapshot(root_guid)["items"] and time.monotonic() < deadline:
            time.sleep(0.25)
        if hierarchy_snapshot(root_guid)["items"]:
            raise RuntimeError("official API left a frozen provider orphan active")
        for key in scoped:
            scoped[key] += frozen["state"][key]
        emit_progress("provider-orphan-delete", index, total)
    return total, scoped


def nfo_identity(path_text: str, media_type: str = "tv") -> dict:
    nfo_path = Path(path_text).with_suffix(".nfo")
    root = ET.parse(nfo_path).getroot()
    values = {child.tag: child.text or "" for child in root}
    if media_type == "movie":
        provider_id = values.get("tmdbid")
        if not provider_id:
            provider_id = next(
                (
                    child.text or ""
                    for child in root.findall("uniqueid")
                    if child.get("type") == "tmdb"
                ),
                "",
            )
        return {
            "providerId": provider_id,
            "title": values["title"],
            "year": int(values["year"]),
        }
    if media_type != "tv":
        raise RuntimeError("unsupported LocalNFO media type")
    return {
        "episode": int(values["episode"]),
        "season": int(values["season"]),
    }


def validate_canonical_metadata(plans: dict[str, dict], records: list[dict]) -> dict:
    contracts = {
        key: contract
        for plan in plans.values()
        for key, contract in plan["_identityContracts"].items()
    }
    by_component: dict[str, list[dict]] = {}
    for record in records:
        by_component.setdefault(record["componentKey"], []).append(record)
    summary = {}
    for component_key, identity in contracts.items():
        plan_records = by_component[component_key]
        paths = [row["pathText"] for row in plan_records]
        rows = wait_for_rows(paths, len(paths))
        if len(rows) != len(paths) or {row["path"] for row in rows} != set(paths):
            raise RuntimeError("canonical media path set did not converge")
        media_type = identity["mediaType"]
        provider_id = str(identity["providerId"])
        series_guids = set()
        for row in rows:
            expected = nfo_identity(row["path"], media_type)
            if media_type == "tv":
                valid = (
                    row["type"] == "Episode"
                    and row["recognition_status"] == 3
                    and int(row["season_number"]) == expected["season"]
                    and int(row["episode_number"]) == expected["episode"]
                    and int(row["parent_season"]) == expected["season"]
                    and int(row["series_tmdb_id"]) == int(provider_id)
                    and row["series_type"] == "TV"
                )
                series_guids.add(row["series_guid"])
            else:
                valid = (
                    row["type"] == "Movie"
                    and row["recognition_status"] == 3
                    and int(row["tmdb_id"]) == int(provider_id)
                    and expected["providerId"] == provider_id
                    and bool(expected["title"])
                    and expected["year"] > 1800
                )
                series_guids.add(row["item_guid"])
            if not valid or int(row["size"]) != Path(row["path"]).stat().st_size:
                raise RuntimeError("canonical LocalNFO identity changed")
        if len(series_guids) != 1 or provider_root_count(media_type, provider_id) != 1:
            raise RuntimeError("canonical provider identity is missing or duplicated")
        plan = plans[identity["parentWorkItemId"]]
        source_root = plan["execution"]["allowlists"]["localSourceRoot"]
        staging_root = plan["execution"]["allowlists"]["localStagingRoot"]
        if active_path_count(source_root) or active_path_count(staging_root):
            raise RuntimeError("old or staging metadata rows remain active")
        summary[component_key] = {
            "canonicalMediaCount": len(rows),
            "mediaType": media_type,
            "provider": "tmdb",
            "providerId": provider_id,
            "providerRootCount": 1,
            "recognitionStatus": 3,
            "seriesGuid": next(iter(series_guids)),
        }
    return summary


def favorite_rows(item_guid: str) -> list[dict]:
    with connect_readonly(MEDIA_DB) as connection:
        return [
            dict(row)
            for row in connection.execute(
                "SELECT user_guid, item_guid, item_type FROM item_user_favorite "
                "WHERE item_guid = ? ORDER BY user_guid",
                (item_guid,),
            )
        ]


def prior_provider_orphan_state(
    plans: dict[str, dict],
    roots: dict[str, list[dict]],
    canonical_roots: dict[str, str],
    backup_db: Path,
) -> tuple[int, dict[str, int]]:
    contracts = {
        key: contract
        for plan in plans.values()
        for key, contract in plan["_identityContracts"].items()
    }
    state = {"favorite": 0, "itemUser": 0, "play": 0}
    count = 0
    for component_key, identity in contracts.items():
        backup_roots = set(
            provider_root_guids(
                identity["mediaType"], str(identity["providerId"]), backup_db
            )
        )
        live_roots = set(
            provider_root_guids(
                identity["mediaType"], str(identity["providerId"]), MEDIA_DB
            )
        )
        canonical_root = canonical_roots.get(component_key)
        if canonical_root not in live_roots:
            raise RuntimeError("resume canonical provider root is missing")
        for root_guid in sorted(backup_roots - live_roots):
            if root_guid in roots:
                continue
            frozen = hierarchy_snapshot(root_guid, backup_db)
            if (
                not frozen["items"]
                or frozen["state"]["favorite"]
                or frozen["state"]["itemUser"]
            ):
                raise RuntimeError("prior provider orphan state is not safely frozen")
            for key in state:
                state[key] += frozen["state"][key]
            count += 1
    return count, state


def restored_canonical_favorite_count(
    roots: dict[str, list[dict]],
    backup_snapshots: dict,
    canonical_roots: dict[str, str],
) -> int:
    root_to_component = {
        root_guid: root_rows[0]["componentKey"] for root_guid, root_rows in roots.items()
    }
    wanted: dict[str, set[str]] = {}
    for root_guid, snapshot in backup_snapshots.items():
        component_key = root_to_component[root_guid]
        wanted.setdefault(component_key, set()).update(
            favorite["user_guid"] for favorite in snapshot["favorites"]
        )
    restored = 0
    for component_key, canonical_root in canonical_roots.items():
        rows = favorite_rows(canonical_root)
        owners = [row["user_guid"] for row in rows]
        if len(owners) != len(set(owners)) or not set(owners).issubset(
            wanted.get(component_key, set())
        ):
            raise RuntimeError("resume canonical favorite owner changed")
        restored += len(owners)
    return restored


def restore_favorites(
    helper_path: Path,
    helper_sha256: str,
    roots: dict[str, list[dict]],
    backup_snapshots: dict,
    canonical: dict,
) -> tuple[int, int]:
    wanted: dict[tuple[str, str], dict] = {}
    root_to_component = {
        root_guid: root_rows[0]["componentKey"] for root_guid, root_rows in roots.items()
    }
    for root_guid, snapshot in backup_snapshots.items():
        component_key = root_to_component[root_guid]
        for favorite in snapshot["favorites"]:
            wanted[(component_key, favorite["user_guid"])] = favorite
    restored = 0
    already = 0
    for (component_key, user_guid), _favorite in sorted(wanted.items()):
        series_guid = canonical[component_key]["seriesGuid"]
        rows = favorite_rows(series_guid)
        if rows:
            if len(rows) != 1 or rows[0]["user_guid"] != user_guid:
                raise RuntimeError("canonical favorite owner changed")
            already += 1
            continue
        owner_helper = load_official_helper(helper_path, helper_sha256, user_guid)
        owner_helper.require_ok(
            owner_helper.request(
                FAVORITE_ROUTE,
                method="PUT",
                payload={"item_guid": series_guid},
            ),
            "official favorite restoration",
        )
        deadline = time.monotonic() + 30
        rows = favorite_rows(series_guid)
        while not rows and time.monotonic() < deadline:
            time.sleep(0.25)
            rows = favorite_rows(series_guid)
        if len(rows) != 1 or rows[0]["user_guid"] != user_guid:
            raise RuntimeError("official favorite restoration did not converge")
        restored += 1
    for value in canonical.values():
        value.pop("seriesGuid", None)
    return restored, already


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight or execute an official trim.media local batch reindex."
    )
    parser.add_argument("--plan", action="append", required=True)
    parser.add_argument("--inventory", action="append", required=True)
    parser.add_argument("--inventory-sha256", action="append", required=True)
    parser.add_argument("--backup-evidence", required=True)
    parser.add_argument("--backup-evidence-sha256", required=True)
    parser.add_argument("--readd-script", required=True)
    parser.add_argument("--readd-script-sha256", required=True)
    parser.add_argument("--official-api-helper")
    parser.add_argument("--official-api-helper-sha256")
    parser.add_argument("--library-guid")
    parser.add_argument("--output")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    readd_path = Path(args.readd_script)
    readd_module = load_module(
        readd_path, args.readd_script_sha256, "trim_exact_path_readd"
    )
    plans, _inventories, roots, records = validate_bundle(
        [Path(path) for path in args.plan],
        [Path(path) for path in args.inventory],
        args.inventory_sha256,
        readd_module,
    )
    backup_evidence_path = Path(args.backup_evidence)
    require_exact_file(
        backup_evidence_path,
        args.backup_evidence_sha256,
        "backup evidence",
    )
    backup_evidence = read_json(backup_evidence_path)
    backup_root = validate_backup(backup_evidence, plans)
    backup_global = global_user_state(backup_root / "trimmedia.db")
    scoped_state, backup_snapshots = backup_scope(
        roots, backup_root / "trimmedia.db"
    )
    present_roots, absent_roots = live_transition_state(roots)
    target_paths = [record["pathText"] for record in records]
    existing_rows = canonical_rows(target_paths)
    preflight = {
        "backupDatabaseCount": 3,
        "backupDatabaseQuickCheck": "ok",
        "canonicalExistingCount": len(existing_rows),
        "databaseDirectWrite": False,
        "deleteFileCount": 0,
        "mechanicalScanTriggered": False,
        "oldHierarchyAbsentCount": len(absent_roots),
        "oldHierarchyCount": len(roots),
        "oldHierarchyPresentCount": len(present_roots),
        "operationCount": len(records),
        "planCount": len(plans),
        "state": "preflight-passed",
        "uiWrites": 0,
    }
    if not args.execute:
        print(json.dumps(preflight, ensure_ascii=False, sort_keys=True))
        return
    if not all(
        (
            args.official_api_helper,
            args.official_api_helper_sha256,
            args.library_guid,
            args.output,
        )
    ):
        raise RuntimeError("execute requires helper, library and output arguments")
    script_sha = os.environ.get("KT_SCRIPT_SHA256", "")
    require_exact_file(Path(__file__).resolve(), script_sha, "batch reindex script")
    helper_path = Path(args.official_api_helper)
    admin_helper = load_official_helper(
        helper_path, args.official_api_helper_sha256
    )
    require_official_boundary(admin_helper, args.library_guid)
    before = global_user_state()
    absent_state = {"favorite": 0, "itemUser": 0, "play": 0}
    for root_guid in absent_roots:
        for key in absent_state:
            absent_state[key] += backup_snapshots[root_guid]["state"][key]
    prior_orphan_count = 0
    prior_orphan_state = {"favorite": 0, "itemUser": 0, "play": 0}
    resume_restored_favorites = 0
    if absent_roots and len(existing_rows) == len(records):
        resume_canonical_roots = canonical_root_guids(plans, records)
        prior_orphan_count, prior_orphan_state = prior_provider_orphan_state(
            plans, roots, resume_canonical_roots, backup_root / "trimmedia.db"
        )
        resume_restored_favorites = restored_canonical_favorite_count(
            roots, backup_snapshots, resume_canonical_roots
        )
    expected_before = expected_resume_user_state(
        backup_global,
        deleted_old_state=absent_state,
        prior_orphan_state=prior_orphan_state,
        restored_favorite_count=resume_restored_favorites,
    )
    if before != expected_before:
        raise RuntimeError("live global user state changed outside the resumable batch state")
    deleted = delete_old_roots(admin_helper, roots)
    expected_after_delete = expected_resume_user_state(
        backup_global,
        deleted_old_state=scoped_state,
        prior_orphan_state=prior_orphan_state,
        restored_favorite_count=resume_restored_favorites,
    )
    if global_user_state() != expected_after_delete:
        raise RuntimeError("global user state changed outside the frozen title scope")
    readded = readd_missing_paths(
        admin_helper,
        args.library_guid,
        records,
        readd_module.RE_ADD_ROUTE,
    )
    canonical_roots = canonical_root_guids(plans, records)
    orphan_deleted, orphan_state = delete_frozen_provider_orphans(
        admin_helper,
        plans,
        canonical_roots,
        backup_root / "trimmedia.db",
    )
    expected_after_orphans = expected_global_after_delete(
        expected_after_delete, orphan_state
    )
    if global_user_state() != expected_after_orphans:
        raise RuntimeError("provider-orphan cleanup changed unrelated user state")
    canonical = validate_canonical_metadata(plans, records)
    restored, already_restored = restore_favorites(
        helper_path,
        args.official_api_helper_sha256,
        roots,
        backup_snapshots,
        canonical,
    )
    expected_final = {
        "favorite": backup_global["favorite"],
        "itemUser": expected_after_orphans["itemUser"],
        "play": expected_after_orphans["play"],
    }
    if global_user_state() != expected_final:
        raise RuntimeError("final global user state does not match the sealed policy")
    wait_for_official_boundary(admin_helper, args.library_guid)
    output = {
        **preflight,
        "canonicalExistingCount": len(records),
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "exactPathReAddCount": len(records),
        "exactPathReAddExecutedThisRun": readded,
        "favoriteAlreadyRestoredCount": already_restored,
        "favoriteRestoreCount": restored,
        "finalGlobalUserState": expected_final,
        "officialDeleteCount": len(roots) + prior_orphan_count + orphan_deleted,
        "officialDeleteExecutedThisRun": deleted + orphan_deleted,
        "officialDeleteFileValue": 0,
        "officialExactPathReAddEndpoint": readd_module.RE_ADD_ROUTE,
        "playbackHistoryPolicy": "discard",
        "providerOrphanDeleteCount": prior_orphan_count + orphan_deleted,
        "providerOrphanDiscardedPlayCount": prior_orphan_state["play"]
        + orphan_state["play"],
        "resumeAlreadyRestoredFavoriteCount": resume_restored_favorites,
        "resumeMode": "fresh" if not absent_roots else "post-old-delete",
        "resumePriorProviderOrphanDeleteCount": prior_orphan_count,
        "state": "local-metadata-committed",
        "titles": canonical,
    }
    output_path = Path(args.output)
    write_json_once(output_path, output)
    print(
        json.dumps(
            reindex_result_summary(output, output_path),
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
