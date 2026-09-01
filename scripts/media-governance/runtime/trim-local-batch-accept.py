#!/usr/bin/env python3
"""独立验收 trim.media 本地批次的文件、LocalNFO、字幕、图像与用户状态。"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import urllib.request
import xml.etree.ElementTree as ET


DATABASE_ROOT = Path("/usr/local/apps/@appdata/trim.media/database")
MEDIA_DB = DATABASE_ROOT / "trimmedia.db"
DATABASE_NAMES = ("trimmedia.db", "trimactivity.db", "trimmedia_ext.db")
RUNNING_TASKS_ROUTE = "/v/api/v1/task/running"
PLAYER_BUNDLE = Path(
    "/usr/local/apps/@appcenter/trim.media/static/assets/"
    "bf29a647181e25c03987ab8cc8f81a1a-B0WFpgby.js"
)
PLAYER_FALLBACK_CONTRACT = (
    "this.opts.infoData?.subtitle_guid||this.subTitleStreams?.[0]?.guid||``"
)


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


def write_json_once(path: Path, value: dict) -> None:
    if not path.is_absolute() or path.exists() or path.is_symlink():
        raise RuntimeError("acceptance output must be a new absolute path")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.part-{os.getpid()}")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError("temporary acceptance output already exists")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    temporary.replace(path)


def connect_readonly(path: Path = MEDIA_DB) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def all_files(root: Path) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("canonical target root is missing or unsafe")
    entries = list(root.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise RuntimeError("canonical target contains a symlink")
    return sorted((path for path in entries if path.is_file()), key=os.fspath)


def canonical_rows(paths: list[str]) -> list[dict]:
    marks = ",".join("?" for _ in paths)
    with connect_readonly() as connection:
        return [
            dict(row)
            for row in connection.execute(
                f"""
                SELECT im.guid AS media_guid, im.item_guid, im.path, im.size,
                       im.recognition_status,
                       i.type, i.title, i.season_number, i.episode_number,
                       i.tmdb_id, i.nfo_path AS item_nfo_path,
                       i.posters AS episode_posters,
                       i.backdrops AS item_backdrops,
                       p.guid AS season_guid, p.season_number AS parent_season,
                       p.nfo_path AS season_nfo_path, p.posters AS season_posters,
                       gp.guid AS series_guid, gp.type AS series_type,
                       gp.tmdb_id AS series_tmdb_id,
                       gp.nfo_path AS series_nfo_path,
                       gp.posters AS series_posters,
                       gp.backdrops AS series_backdrops
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


def active_path_count(prefix: str) -> int:
    with connect_readonly() as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM item_media WHERE path = ? OR path LIKE ?",
            (prefix, prefix + "/%"),
        ).fetchone()[0]


def provider_count(media_type: str, provider_id: str) -> int:
    item_type = "TV" if media_type == "tv" else "Movie"
    with connect_readonly() as connection:
        return connection.execute(
            "SELECT COUNT(*) FROM item WHERE type = ? AND tmdb_id = ?",
            (item_type, int(provider_id)),
        ).fetchone()[0]


def global_user_state() -> dict[str, int]:
    with connect_readonly() as connection:
        return {
            "favorite": connection.execute(
                "SELECT COUNT(*) FROM item_user_favorite"
            ).fetchone()[0],
            "itemUser": connection.execute("SELECT COUNT(*) FROM item_user").fetchone()[0],
            "play": connection.execute(
                "SELECT COUNT(*) FROM item_user_play"
            ).fetchone()[0],
        }


def validate_hidden_preference_evidence(
    path: Path,
    expected_sha256: str,
    plans: dict[str, dict],
    rows_by_work_item: dict[str, list[dict]],
    prior_global_state: dict,
) -> dict:
    require_exact_file(path, expected_sha256, "hidden subtitle preference evidence")
    evidence = read_json(path)
    seeds = evidence.get("seeds")
    boundaries = evidence.get("mutationBoundaries") or {}
    if (
        evidence.get("schemaVersion")
        != "trim-local-hidden-subtitle-preference-v1"
        or evidence.get("state") != "hidden-subtitle-preference-established"
        or evidence.get("priorGlobalUserState") != prior_global_state
        or evidence.get("visiblePlaybackHistoryCount") != 0
        or not isinstance(seeds, list)
        or not seeds
        or boundaries.get("cloudWrites") != 0
        or boundaries.get("databaseDirectWrite") is not False
        or boundaries.get("uiWrites") != 0
        or boundaries.get("officialPlayRecordPostCount") != len(seeds)
        or boundaries.get("officialPlayRecordDeleteCount") != len(seeds)
    ):
        raise RuntimeError("hidden subtitle preference evidence boundary changed")

    canonical = {
        (work_item_id, row["item_guid"], row["media_guid"])
        for work_item_id, rows in rows_by_work_item.items()
        for row in rows
    }
    play_by_work_item = {work_item_id: 0 for work_item_id in plans}
    seen_items = set()
    with connect_readonly() as connection:
        for seed in seeds:
            work_item_id = seed.get("workItemId")
            item_guid = seed.get("itemGuid")
            media_guid = seed.get("mediaGuid")
            key = (work_item_id, item_guid, media_guid)
            if (
                work_item_id not in plans
                or key not in canonical
                or item_guid in seen_items
                or seed.get("visible") != 0
                or seed.get("watched") != 0
                or seed.get("ts") != 0
            ):
                raise RuntimeError("hidden subtitle preference seed is outside the canonical batch")
            seen_items.add(item_guid)
            rows = [
                dict(row)
                for row in connection.execute(
                    "SELECT item_guid, media_guid, video_guid, audio_guid, subtitle_guid, "
                    "resolution, bitrate, direct_link_audio_index, ts, visible, watched "
                    "FROM item_user_play WHERE item_guid = ? AND media_guid = ?",
                    (item_guid, media_guid),
                )
            ]
            if len(rows) != 1:
                raise RuntimeError("hidden subtitle preference row is missing or duplicated")
            row = rows[0]
            expected = {
                "item_guid": item_guid,
                "media_guid": media_guid,
                "video_guid": seed.get("videoGuid"),
                "audio_guid": seed.get("audioGuid"),
                "subtitle_guid": seed.get("subtitleGuid"),
                "resolution": seed.get("resolution"),
                "bitrate": seed.get("bitrate"),
                "direct_link_audio_index": seed.get("directLinkAudioIndex"),
                "ts": 0,
                "visible": 0,
                "watched": 0,
            }
            if row != expected or not expected["subtitle_guid"]:
                raise RuntimeError("hidden subtitle preference row changed")
            play_by_work_item[work_item_id] += 1

    final_global_state = evidence.get("finalGlobalUserState")
    expected_final = {
        "favorite": prior_global_state["favorite"],
        "itemUser": prior_global_state["itemUser"],
        "play": prior_global_state["play"] + len(seeds),
    }
    if final_global_state != expected_final or global_user_state() != expected_final:
        raise RuntimeError("hidden subtitle preference changed global user state")
    return {
        "finalGlobalUserState": expected_final,
        "hiddenPreferenceCount": len(seeds),
        "playByWorkItem": play_by_work_item,
        "visiblePlaybackHistoryCount": 0,
    }


def title_user_state(root_guid: str) -> dict:
    with connect_readonly() as connection:
        item_guids = [
            row[0]
            for row in connection.execute(
                """
                WITH RECURSIVE tree(guid) AS (
                    SELECT guid FROM item WHERE guid = ?
                    UNION ALL
                    SELECT child.guid FROM item child JOIN tree
                      ON child.parent_guid = tree.guid
                )
                SELECT guid FROM tree
                """,
                (root_guid,),
            )
        ]
        marks = ",".join("?" for _ in item_guids) or "NULL"
        media_guids = [
            row[0]
            for row in connection.execute(
                f"SELECT guid FROM item_media WHERE item_guid IN ({marks})",
                item_guids,
            )
        ]
        media_marks = ",".join("?" for _ in media_guids) or "NULL"
        favorites = [
            row[0]
            for row in connection.execute(
                f"SELECT user_guid FROM item_user_favorite "
                f"WHERE item_guid IN ({marks}) ORDER BY user_guid",
                item_guids,
            )
        ]
        return {
            "favoriteOwners": favorites,
            "favorite": len(favorites),
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


def load_helper(path: Path, expected_sha256: str):
    helper = load_module(path, expected_sha256, "trim_official_api")
    for name in ("active_admin_token", "request", "require_ok"):
        if not callable(getattr(helper, name, None)):
            raise RuntimeError("official helper contract changed")
    token = helper.active_admin_token()
    if not isinstance(token, str) or not token:
        raise RuntimeError("official helper returned no active admin session")
    helper.active_admin_token = lambda: token
    return helper


def trim_process_running() -> bool:
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            command = Path(f"/proc/{name}/cmdline").read_bytes()
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if b"/@appcenter/trim.media/trim-media" in command:
            return True
    return False


def require_runtime_boundary(helper, library_guid: str) -> None:
    if not trim_process_running():
        raise RuntimeError("trim.media process is not running")
    running = helper.require_ok(
        helper.request(RUNNING_TASKS_ROUTE), "official running task query"
    ) or []
    if running:
        raise RuntimeError("trim.media has running tasks during acceptance")
    library = helper.require_ok(
        helper.request(f"/v/api/v1/mdb/{library_guid}"), "official library query"
    ) or {}
    if (
        library.get("prefer_local_nfo") != 1
        or library.get("auto_scrap_subtitle") != 0
        or library.get("subtitle_lan") != "zh-CN"
    ):
        raise RuntimeError("trim.media LocalNFO/subtitle policy changed")


def validate_backup(evidence: dict) -> None:
    if evidence.get("schemaVersion") != "media-local-transaction-backup-v1":
        raise RuntimeError("backup evidence schema changed")
    root = Path(str(evidence.get("databaseBackupRoot") or ""))
    rows = evidence.get("databases")
    if not root.is_dir() or root.is_symlink() or not isinstance(rows, list) or len(rows) != 3:
        raise RuntimeError("three-database backup boundary changed")
    for row in rows:
        path = root / str(row.get("name"))
        if row.get("name") not in DATABASE_NAMES or Path(str(row.get("path"))) != path:
            raise RuntimeError("backup database path boundary changed")
        require_exact_file(path, str(row.get("sha256") or ""), "backup database")
        with connect_readonly(path) as connection:
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("backup database quick_check failed")


def validate_files(plans: dict[str, dict], readd_module) -> tuple[dict, dict]:
    totals = {"asset": 0, "subtitle": 0, "video": 0, "videoBytes": 0}
    video_records = {}
    for work_item_id, plan in plans.items():
        operations = plan["manifests"]["local"]["forward"]
        contracts = plan["_identityContracts"]
        target_paths_by_component = {key: set() for key in contracts}
        for operation in operations:
            component_key = component_key_for_target_path(
                contracts, operation["targetPath"]
            )
            target_paths_by_component[component_key].add(Path(operation["targetPath"]))
        for component_key, contract in contracts.items():
            actual_paths = set(all_files(Path(contract["targetRoot"])))
            if actual_paths != target_paths_by_component[component_key]:
                raise RuntimeError("canonical component file set differs from sealed plan")
        evidence = {row["evidenceId"]: row for row in plan["sourceEvidence"]}
        for operation in operations:
            kind = operation["fileKind"]
            target = Path(operation["targetPath"])
            sealed = evidence[operation["evidenceId"]]
            record = {"path": target, "pathText": str(target), "sealed": sealed}
            readd_module.verify_record(record) if kind == "video" else None
            if kind != "video":
                if (
                    not target.is_file()
                    or target.is_symlink()
                    or target.stat().st_size != sealed["size"]
                    or sealed.get("evidenceMethod")
                    not in {"sha256-v1", "sha256-full-v1"}
                    or sha256(target) != sealed["digest"]
                ):
                    raise RuntimeError("canonical sidecar/asset digest changed")
            totals[kind] += 1
            if kind == "video":
                totals["videoBytes"] += target.stat().st_size
                video_records[str(target)] = {
                    "componentKey": component_key_for_target_path(
                        contracts, operation["targetPath"]
                    ),
                    "operation": operation,
                    "workItemId": work_item_id,
                }
    return totals, video_records


def nfo_values(video_path: str, media_type: str = "tv") -> dict:
    nfo_path = Path(video_path).with_suffix(".nfo")
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
    required = ("title", "aired", "plot", "thumb")
    if (
        root.tag != "episodedetails"
        or any(not values.get(field, "").strip() for field in required)
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["aired"].strip()) is None
        or Path(values["thumb"]).name != values["thumb"]
    ):
        raise RuntimeError("canonical episode LocalNFO metadata is incomplete")
    return {
        "aired": values["aired"].strip(),
        "episode": int(values.get("displayepisode") or values["episode"]),
        "plot": values["plot"].strip(),
        "providerEpisode": int(values["episode"]),
        "providerSeason": int(values["season"]),
        "runtime": values.get("runtime", "").strip(),
        "season": int(values.get("displayseason") or values["season"]),
        "showtitle": values.get("showtitle", "").strip(),
        "thumb": str(Path(video_path).with_name(values["thumb"])),
        "title": values["title"].strip(),
    }


def planned_artwork_targets(plan: dict, target_root: str | None = None) -> dict[str, object]:
    root = Path(
        target_root or plan["execution"]["allowlists"]["localTargetRoot"]
    )
    result: dict[str, object] = {"season": {}}
    for operation in plan["manifests"]["local"]["forward"]:
        if operation["fileKind"] != "asset":
            continue
        target = Path(operation["targetPath"])
        if target.parent != root or target.suffix.lower() not in {".jpg", ".png", ".webp"}:
            continue
        if target.stem in {"poster", "fanart"}:
            result[target.stem] = str(target)
            continue
        match = re.fullmatch(r"season(\d{2})-poster", target.stem)
        if match:
            result["season"][int(match.group(1))] = str(target)
    if "poster" not in result or "fanart" not in result:
        raise RuntimeError("canonical series artwork plan is incomplete")
    return result


def validate_metadata(
    plans: dict[str, dict], video_records: dict[str, dict]
) -> tuple[dict[str, list[dict]], list[tuple[str, str]]]:
    contracts = {}
    for work_item_id, plan in plans.items():
        contracts.update(
            plan.get("_identityContracts")
            or {work_item_id: {"parentWorkItemId": work_item_id}}
        )
    by_component: dict[str, list[str]] = {}
    for path, record in video_records.items():
        by_component.setdefault(record["componentKey"], []).append(path)
    rows_by_component = {}
    image_sources = []
    for component_key, paths in by_component.items():
        identity = contracts[component_key]
        plan = plans[identity["parentWorkItemId"]]
        rows = canonical_rows(paths)
        if len(rows) != len(paths) or {row["path"] for row in rows} != set(paths):
            raise RuntimeError("canonical database path set changed")
        provider_id = str(identity["providerId"])
        roots = set()
        for row in rows:
            if identity["mediaType"] == "tv":
                expected = nfo_values(row["path"], "tv")
                valid = (
                    row["type"] == "Episode"
                    and row["recognition_status"] == 3
                    and int(row["season_number"]) == expected["season"]
                    and int(row["episode_number"]) == expected["episode"]
                    and int(row["parent_season"]) == expected["season"]
                    and int(row["series_tmdb_id"]) == int(provider_id)
                    and bool(str(row["title"] or "").strip())
                )
                roots.add(row["series_guid"])
            else:
                expected = nfo_values(row["path"], "movie")
                valid = (
                    row["type"] == "Movie"
                    and row["recognition_status"] == 3
                    and int(row["tmdb_id"]) == int(provider_id)
                    and expected["providerId"] == provider_id
                    and bool(expected["title"])
                    and expected["year"] > 1800
                )
                roots.add(row["item_guid"])
            if not valid or int(row["size"]) != Path(row["path"]).stat().st_size:
                raise RuntimeError("canonical LocalNFO database identity changed")
        if len(roots) != 1 or provider_count(identity["mediaType"], provider_id) != 1:
            raise RuntimeError("canonical TMDB TV identity is missing or duplicated")
        source = plan["execution"]["allowlists"]["localSourceRoot"]
        staging = plan["execution"]["allowlists"]["localStagingRoot"]
        if active_path_count(source) or active_path_count(staging):
            raise RuntimeError("old or staging metadata rows remain active")
        artwork_targets = planned_artwork_targets(plan, identity["targetRoot"])
        first = rows[0]
        if identity["mediaType"] == "tv":
            image_sources.extend(
                [
                    (first["series_posters"], artwork_targets["poster"]),
                    (first["series_backdrops"], artwork_targets["fanart"]),
                ]
            )
            rows_by_season = {}
            for row in rows:
                rows_by_season.setdefault(int(row["parent_season"]), row)
            if set(rows_by_season) != set(artwork_targets["season"]):
                raise RuntimeError("canonical season artwork plan is incomplete")
            image_sources.extend(
                (
                    rows_by_season[season]["season_posters"],
                    artwork_targets["season"][season],
                )
                for season in sorted(rows_by_season)
            )
            image_sources.extend(
                (row["episode_posters"], nfo_values(row["path"], "tv")["thumb"])
                for row in rows
            )
        else:
            image_sources.extend(
                [
                    (first["episode_posters"], artwork_targets["poster"]),
                    (first["item_backdrops"], artwork_targets["fanart"]),
                ]
            )
        rows_by_component[component_key] = rows
    bindings = [binding for binding, _source in image_sources]
    if any(not binding for binding in bindings) or len(bindings) != len(set(bindings)):
        raise RuntimeError("canonical artwork bindings are missing or duplicated")
    return rows_by_component, image_sources


def stream_language(stream: dict) -> str | None:
    title = str(stream.get("title") or "").strip().lower().replace("_", "-")
    language = str(stream.get("language") or stream.get("lan") or "").strip().lower()
    if title in {"zh-cn", "chs", "sc"} or "简" in title:
        return "zh-CN"
    if title in {"zh-tw", "cht", "tc"} or "繁" in title:
        return "zh-TW"
    if language in {"chi", "zho", "zh", "zh-cn"}:
        return "zh"
    return None


def preferred_embedded_subtitle(
    streams: list[dict], source_streams: list[dict], *, selected_guid: str
) -> tuple[dict, bool]:
    if len(streams) != len(source_streams) or not streams:
        raise RuntimeError("official embedded subtitle stream set changed")
    candidates = []
    for stream, source in zip(streams, source_streams, strict=True):
        language = stream_language(stream) or stream_language(source)
        if language in {"zh-CN", "zh"}:
            candidates.append((stream, source))
    if not candidates:
        raise RuntimeError("official embedded Chinese subtitle stream is missing")
    defaults = [
        stream
        for stream, source in candidates
        if int(source.get("default") or 0) == 1
        and stream.get("is_default") in {1, True}
    ]
    if len(defaults) == 1:
        preferred = defaults[0]
        if selected_guid and selected_guid != preferred.get("guid"):
            raise RuntimeError("official playback did not select the default Chinese stream")
        return preferred, bool(selected_guid)
    explicit = [
        stream
        for stream, _source in candidates
        if selected_guid and selected_guid == stream.get("guid")
    ]
    if len(explicit) == 1:
        return explicit[0], True
    if not selected_guid and candidates[0][0] is streams[0]:
        return candidates[0][0], False
    raise RuntimeError("official playback did not select a Chinese embedded stream")


def preferred_external_subtitle(
    streams: list[dict], source_streams: list[dict]
) -> tuple[dict, int, int]:
    embedded = [
        stream for stream in streams if stream.get("is_external") in {0, False}
    ]
    external = [
        stream for stream in streams if stream.get("is_external") in {1, True}
    ]
    if (
        len(embedded) != len(source_streams)
        or len(external) != 1
        or len(embedded) + len(external) != len(streams)
        or stream_language(external[0]) != "zh-CN"
        or str(external[0].get("codec_name") or "").lower()
        not in {"ass", "ssa", "srt", "subrip"}
    ):
        raise RuntimeError("official subtitle stream contract changed")
    return external[0], len(embedded), len(external)


def subtitle_gap_component_ids(plan: dict) -> set[str]:
    decision = plan.get("subtitleDecision") or {}
    entries = decision.get("gapComponents", [])
    if not isinstance(entries, list):
        raise RuntimeError("subtitle gap component contract changed")
    component_ids = []
    for entry in entries:
        component_id = entry.get("componentId") if isinstance(entry, dict) else None
        if not isinstance(component_id, str) or not component_id:
            raise RuntimeError("subtitle gap component contract changed")
        component_ids.append(component_id)
    if len(component_ids) != len(set(component_ids)):
        raise RuntimeError("subtitle gap components are duplicated")
    if decision.get("mode") == "season-gap":
        if (
            component_ids
            or decision.get("assignments") != []
            or not isinstance(decision.get("gapSeasons"), list)
            or not decision["gapSeasons"]
            or decision.get("gapEpisodes") not in (None, [])
            or (plan.get("identity") or {}).get("mediaType") != "tv"
            or not isinstance(plan.get("workItemId"), str)
        ):
            raise RuntimeError("standard subtitle season-gap contract changed")
        return {plan["workItemId"]}
    return set(component_ids)


def component_has_sidecar(plan: dict, contract: dict) -> bool:
    root_text = contract.get("targetRoot")
    if not isinstance(root_text, str) or not root_text.startswith("/"):
        return any(
            item["fileKind"] == "subtitle"
            for item in plan["manifests"]["local"]["forward"]
        )
    root = Path(root_text).resolve(strict=False)
    for item in plan["manifests"]["local"]["forward"]:
        if item["fileKind"] != "subtitle":
            continue
        target = Path(item["targetPath"]).resolve(strict=False)
        try:
            target.relative_to(root)
        except ValueError:
            continue
        if target != root:
            return True
    return False


def subtitle_delivery_mode(plan: dict, contract: dict | None = None) -> str:
    methods = {
        evidence.get("evidenceMethod")
        for evidence in plan.get("subtitleEvidence", [])
    }
    has_any_sidecar = any(
        item["fileKind"] == "subtitle"
        for item in plan["manifests"]["local"]["forward"]
    )
    if methods == {"burned-in-frame-manifest-sha256-v1"}:
        if has_any_sidecar:
            raise RuntimeError("burned-in subtitle evidence cannot carry sidecars")
        return "burned-in"
    if "burned-in-frame-manifest-sha256-v1" in methods:
        raise RuntimeError("burned-in subtitle evidence cannot mix delivery modes")
    if contract is None or not contract.get("componentId"):
        return "external" if has_any_sidecar else "embedded"
    has_component_sidecar = component_has_sidecar(plan, contract)
    if contract["componentId"] in subtitle_gap_component_ids(plan):
        if has_component_sidecar:
            raise RuntimeError("subtitle gap component cannot carry a sidecar")
        return "gap"
    return "external" if has_component_sidecar else "embedded"


def validate_playback(
    helper,
    plans: dict[str, dict],
    inventories: dict[str, dict],
    rows_by_component: dict[str, list[dict]],
) -> dict[str, int]:
    if (
        not PLAYER_BUNDLE.is_file()
        or PLAYER_FALLBACK_CONTRACT not in PLAYER_BUNDLE.read_text(encoding="utf-8")
    ):
        raise RuntimeError("fnOS player first-subtitle fallback contract changed")
    expected_streams = {}
    contracts = {}
    for work_item_id, plan in plans.items():
        contracts.update(
            plan.get("_identityContracts")
            or {work_item_id: {"parentWorkItemId": work_item_id}}
        )
        gap_ids = subtitle_gap_component_ids(plan)
        component_ids = {
            contract.get("componentId")
            for contract in contracts.values()
            if contract.get("parentWorkItemId") == work_item_id
            and contract.get("componentId")
        }
        if not gap_ids.issubset(component_ids):
            raise RuntimeError("subtitle gap component is outside plan identity")
    for work_item_id, plan in plans.items():
        source_videos = {
            row["path"]: row for row in inventories[work_item_id]["files"]["videos"]
        }
        evidence = {row["evidenceId"]: row for row in plan["sourceEvidence"]}
        for operation in plan["manifests"]["local"]["forward"]:
            if operation["fileKind"] != "video":
                continue
            source_path = evidence[operation["evidenceId"]]["path"]
            expected_streams[operation["targetPath"]] = [
                row for row in source_videos[source_path]["streams"] if row["type"] == "subtitle"
            ]

    def inspect(entry: tuple[str, dict]) -> tuple[str, int, int, int, int, int, int]:
        component_key, row = entry
        result = helper.require_ok(
            helper.request(f"/v/api/v1/stream/list/{row['item_guid']}"),
            "official subtitle stream query",
        ) or {}
        streams = [
            item
            for item in result.get("subtitle_streams", [])
            if item.get("media_guid") == row["media_guid"]
        ]
        plan = plans[contracts[component_key]["parentWorkItemId"]]
        delivery_mode = subtitle_delivery_mode(plan, contracts[component_key])
        play = helper.require_ok(
            helper.request(
                "/v/api/v1/play/info",
                method="POST",
                payload={"item_guid": row["item_guid"]},
            ),
            "official play-information query",
        ) or {}
        selected = play.get("subtitle_guid") or ""
        burned_in_count = 0
        gap_count = 0
        if delivery_mode == "burned-in":
            source_streams = expected_streams[row["path"]]
            valid = not source_streams and not streams and not selected
            preferred = None
            embedded_count = 0
            external_count = 0
            burned_in_count = 1
        elif delivery_mode == "gap":
            source_streams = expected_streams[row["path"]]
            valid = (
                len(streams) == len(source_streams)
                and all(item.get("is_external") in {0, False} for item in streams)
                and not any(
                    stream_language(item) in {"zh-CN", "zh"}
                    for item in [*streams, *source_streams]
                )
                and not selected
            )
            preferred = None
            embedded_count = len(streams)
            external_count = 0
            gap_count = 1
        elif delivery_mode == "external":
            preferred, embedded_count, external_count = preferred_external_subtitle(
                streams, expected_streams[row["path"]]
            )
            valid = True
        else:
            source_streams = expected_streams[row["path"]]
            valid = (
                len(streams) == len(source_streams)
                and len(streams) >= 1
                and all(item.get("is_external") in {0, False} for item in streams)
            )
            preferred = (
                preferred_embedded_subtitle(
                    streams,
                    source_streams,
                    selected_guid=selected,
                )[0]
                if valid
                else None
            )
            embedded_count = len(streams)
            external_count = 0
        if not valid or any(
            str(item.get("Source") or item.get("source") or "").lower() == "online"
            for item in streams
        ):
            raise RuntimeError("official subtitle stream contract changed")
        if play.get("media_guid") != row["media_guid"] or (
            selected and (preferred is None or selected != preferred.get("guid"))
        ):
            raise RuntimeError("official playback selected stale/non-preferred media")
        return (
            component_key,
            embedded_count,
            external_count,
            int(bool(selected)),
            int(not selected and delivery_mode not in {"burned-in", "gap"}),
            burned_in_count,
            gap_count,
        )

    entries = [
        (component_key, row)
        for component_key, rows in rows_by_component.items()
        for row in rows
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(inspect, entries))
    gap_count = sum(row[6] for row in results)
    return {
        "automaticSimplifiedChineseCount": len(results) - gap_count,
        "burnedInSubtitleEpisodeCount": sum(row[5] for row in results),
        "embeddedSubtitleStreamCount": sum(row[1] for row in results),
        "explicitSubtitleGapCount": gap_count,
        "explicitSelectionCount": sum(row[3] for row in results),
        "externalSubtitleStreamCount": sum(row[2] for row in results),
        "fallbackSelectionCount": sum(row[4] for row in results),
    }


def expected_exact_path_readd_count(plans: dict[str, dict], readd_module) -> int:
    return sum(len(readd_module.target_records(plan)) for plan in plans.values())


def serve_image(helper, binding: str, source: str) -> None:
    path = "/v/api/v1/sys/img" + binding
    request = urllib.request.Request(
        helper.BASE_URL + path,
        method="GET",
        headers={
            "Accept": "image/*",
            "Authorization": helper.active_admin_token(),
            "authx": helper.authx("GET", path, ""),
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
        status = response.status
        content_type = response.headers.get("Content-Type", "")
    source_path = Path(source)
    if (
        status != 200
        or not content_type.startswith("image/")
        or not source_path.is_file()
        or source_path.is_symlink()
        or hashlib.sha256(body).hexdigest() != sha256(source_path)
    ):
        raise RuntimeError("official artwork binding does not match canonical asset")


def validate_artwork(helper, image_sources: list[tuple[str, str]]) -> int:
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda pair: serve_image(helper, *pair), image_sources))
    return len(image_sources)


def validate_user_state(
    plans: dict[str, dict],
    inventories: dict[str, dict],
    rows_by_component: dict[str, list[dict]],
    expected_global: dict,
    expected_hidden_play_by_work_item: dict[str, int] | None = None,
) -> dict:
    expected_hidden_play_by_work_item = expected_hidden_play_by_work_item or {}
    contracts = {
        key: contract
        for plan in plans.values()
        for key, contract in plan["_identityContracts"].items()
    }
    title_summaries = {}
    for component_key, rows in rows_by_component.items():
        contract = contracts[component_key]
        work_item_id = contract["parentWorkItemId"]
        root_guid = (
            rows[0]["series_guid"]
            if contract["mediaType"] == "tv"
            else rows[0]["item_guid"]
        )
        actual = title_user_state(root_guid)
        expected_play = expected_hidden_play_by_work_item.get(component_key, 0)
        parent_play = expected_hidden_play_by_work_item.get(work_item_id, 0)
        if parent_play:
            if len(plans[work_item_id]["_identityContracts"]) != 1:
                raise RuntimeError(
                    "bundle hidden subtitle preference lacks a component identity"
                )
            expected_play = parent_play
        old_root_guids = set()
        for inventory_row in inventories[work_item_id]["database"]["rows"]:
            if (
                component_key_for_inventory_row(
                    plans[work_item_id]["_identityContracts"], inventory_row
                )
                != component_key
            ):
                continue
            old_root_guids.add(
                inventory_row.get("grandparent_guid")
                if contract["mediaType"] == "tv"
                else inventory_row.get("item_guid")
            )
        expected_owners = sorted(
            {
                row["user_guid"]
                for row in inventories[work_item_id]["database"]["userState"]["favoriteRows"]
                if row.get("item_guid") in old_root_guids
            }
        )
        if (
            actual["favoriteOwners"] != expected_owners
            or actual["itemUser"] != 0
            or actual["play"] != expected_play
        ):
            raise RuntimeError("canonical title user-state policy changed")
        title_summaries[component_key] = {
            "favorite": actual["favorite"],
            "itemUser": 0,
            "play": expected_play,
        }
    if global_user_state() != expected_global:
        raise RuntimeError("global user state changed after metadata execution")
    return title_summaries


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Accept a trim.media local batch.")
    parser.add_argument("--plan", action="append", required=True)
    parser.add_argument("--inventory", action="append", required=True)
    parser.add_argument("--inventory-sha256", action="append", required=True)
    parser.add_argument("--metadata-evidence", required=True)
    parser.add_argument("--metadata-evidence-sha256", required=True)
    parser.add_argument("--backup-evidence", required=True)
    parser.add_argument("--backup-evidence-sha256", required=True)
    parser.add_argument("--readd-script", required=True)
    parser.add_argument("--readd-script-sha256", required=True)
    parser.add_argument("--official-api-helper", required=True)
    parser.add_argument("--official-api-helper-sha256", required=True)
    parser.add_argument("--library-guid", required=True)
    parser.add_argument("--hidden-preference-evidence")
    parser.add_argument("--hidden-preference-evidence-sha256")
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def acceptance_result_summary(output: dict, path: Path) -> dict:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError("acceptance evidence output is unavailable")
    return {**output, "evidenceSha256": sha256(path)}


def subtitle_source_info_hashes(plans: dict[str, dict]) -> list[str]:
    info_hashes = set()
    for work_item_id, plan in plans.items():
        for evidence in plan.get("subtitleEvidence", []):
            if evidence.get("evidenceMethod") != "subtitle-package-manifest-sha256-v1":
                continue
            manifest_path = Path(str(evidence.get("manifestPath") or ""))
            manifest_sha256 = str(evidence.get("manifestSha256") or "")
            require_exact_file(
                manifest_path, manifest_sha256, "subtitle package manifest"
            )
            manifest = read_json(manifest_path)
            source_url = str(manifest.get("sourceUrl") or "")
            matched = re.fullmatch(r"urn:btih:([0-9a-f]{40})", source_url)
            if (
                manifest.get("schemaVersion") != "subtitle-package-manifest-v1"
                or manifest.get("workItemId") != work_item_id
                or matched is None
            ):
                raise RuntimeError("subtitle package source identity changed")
            info_hashes.add(matched.group(1))
    return sorted(info_hashes)


def main() -> None:
    args = parse_args()
    require_exact_file(
        Path(__file__).resolve(),
        os.environ.get("KT_SCRIPT_SHA256", ""),
        "batch acceptance script",
    )
    if not (
        len(args.plan) == len(args.inventory) == len(args.inventory_sha256)
    ):
        raise RuntimeError("plan, inventory and inventory SHA counts must match")
    readd_module = load_module(
        Path(args.readd_script), args.readd_script_sha256, "trim_exact_path_readd"
    )
    plans = {}
    inventories = {}
    for path_text in args.plan:
        path = Path(path_text)
        plan = read_json(path)
        readd_module.require_sealed_plan(plan)
        plan["_path"] = path
        plan["_identityContracts"] = plan_identity_contracts(plan)
        plans[plan["workItemId"]] = plan
    for path_text, expected_sha in zip(
        args.inventory, args.inventory_sha256, strict=True
    ):
        path = Path(path_text)
        require_exact_file(path, expected_sha, "inventory")
        inventory = read_json(path)
        inventories[inventory["workItemId"]] = inventory
    if set(plans) != set(inventories) or len(plans) != len(args.plan):
        raise RuntimeError("plan/inventory work-item set changed")
    metadata_path = Path(args.metadata_evidence)
    require_exact_file(metadata_path, args.metadata_evidence_sha256, "metadata evidence")
    metadata = read_json(metadata_path)
    expected_readd_count = expected_exact_path_readd_count(plans, readd_module)
    if (
        metadata.get("state") != "local-metadata-committed"
        or metadata.get("deleteFileCount") != 0
        or metadata.get("exactPathReAddCount") != expected_readd_count
        or metadata.get("databaseDirectWrite") is not False
        or metadata.get("uiWrites") != 0
    ):
        raise RuntimeError("metadata execution evidence boundary changed")
    backup_path = Path(args.backup_evidence)
    require_exact_file(backup_path, args.backup_evidence_sha256, "backup evidence")
    validate_backup(read_json(backup_path))
    helper = load_helper(
        Path(args.official_api_helper), args.official_api_helper_sha256
    )
    require_runtime_boundary(helper, args.library_guid)
    totals, video_records = validate_files(plans, readd_module)
    rows_by_component, image_sources = validate_metadata(plans, video_records)
    supplied_preference = (
        args.hidden_preference_evidence is not None,
        args.hidden_preference_evidence_sha256 is not None,
    )
    if supplied_preference[0] != supplied_preference[1]:
        raise RuntimeError("hidden preference evidence path and SHA must appear together")
    if supplied_preference[0]:
        rows_by_work_item = {}
        contracts = {
            key: contract
            for plan in plans.values()
            for key, contract in plan["_identityContracts"].items()
        }
        for component_key, rows in rows_by_component.items():
            rows_by_work_item.setdefault(
                contracts[component_key]["parentWorkItemId"], []
            ).extend(rows)
        hidden_preference = validate_hidden_preference_evidence(
            Path(args.hidden_preference_evidence),
            args.hidden_preference_evidence_sha256,
            plans,
            rows_by_work_item,
            metadata["finalGlobalUserState"],
        )
    else:
        hidden_preference = {
            "finalGlobalUserState": metadata["finalGlobalUserState"],
            "hiddenPreferenceCount": 0,
            "playByWorkItem": {},
            "visiblePlaybackHistoryCount": 0,
        }
    playback = validate_playback(helper, plans, inventories, rows_by_component)
    artwork_count = validate_artwork(helper, image_sources)
    title_state = validate_user_state(
        plans,
        inventories,
        rows_by_component,
        hidden_preference["finalGlobalUserState"],
        hidden_preference["playByWorkItem"],
    )
    require_runtime_boundary(helper, args.library_guid)
    output = {
        **playback,
        "artworkHttp200Count": artwork_count,
        "assetCount": totals["asset"],
        "backupDatabaseCount": 3,
        "backupDatabaseQuickCheck": "ok",
        "canonicalFileCount": totals["asset"] + totals["subtitle"] + totals["video"],
        "canonicalVideoBytes": totals["videoBytes"],
        "canonicalVideoCount": totals["video"],
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cloudOperationCount": 0,
        "databaseDirectWrite": False,
        "deleteFileCount": 0,
        "globalUserState": hidden_preference["finalGlobalUserState"],
        "hiddenSubtitlePreferenceCount": hidden_preference[
            "hiddenPreferenceCount"
        ],
        "mechanicalScanTriggered": False,
        "officialRunningTaskCount": 0,
        "planCount": len(plans),
        "publicSshResourcePayloadBytes": 0,
        "state": "local-batch-accepted",
        "subtitleFileCount": totals["subtitle"],
        "subtitleSourceInfoHashes": subtitle_source_info_hashes(plans),
        "titleUserState": title_state,
        "uiWrites": 0,
        "visiblePlaybackHistoryCount": hidden_preference[
            "visiblePlaybackHistoryCount"
        ],
        "workItemIds": sorted(plans),
    }
    output_path = Path(args.output)
    write_json_once(output_path, output)
    print(
        json.dumps(
            acceptance_result_summary(output, output_path),
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
