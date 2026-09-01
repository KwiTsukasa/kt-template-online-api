#!/usr/bin/env python3
"""trim 精确路径重入库脚本的最小回归测试。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import pathlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "trim-exact-path-readd.py"


def load_module():
    spec = importlib.util.spec_from_file_location("trim_exact_path_readd", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load trim exact-path re-add script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeHelper:
    def __init__(self):
        self.calls = []

    def active_admin_token(self):
        return "transient-test-token"

    def request(self, path, method="GET", payload=None):
        self.calls.append((path, method, payload))
        return {"httpStatus": 200, "body": {"code": 0, "data": None}}

    @staticmethod
    def require_ok(response, _label):
        if response["httpStatus"] != 200 or response["body"].get("code") != 0:
            raise RuntimeError("fake official request failed")
        return response["body"].get("data")


def build_plan(target_root: pathlib.Path, targets: list[pathlib.Path]):
    evidence = []
    operations = []
    for index, target in enumerate(targets, start=1):
        content = f"episode-{index}".encode("utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        evidence_id = f"local-video-{index}"
        evidence.append(
            {
                "digest": hashlib.sha256(content).hexdigest(),
                "evidenceId": evidence_id,
                "evidenceMethod": "sha256-v1",
                "fileKind": "video",
                "mtimeMs": target.stat().st_mtime_ns // 1_000_000,
                "path": str(target_root / "old" / target.name),
                "scope": "local",
                "size": len(content),
            }
        )
        operations.append(
            {
                "evidenceId": evidence_id,
                "fileKind": "video",
                "operation": "move",
                "sourcePath": str(target_root / "old" / target.name),
                "targetPath": str(target),
            }
        )
    return {
        "execution": {"allowlists": {"localTargetRoot": str(target_root)}},
        "manifests": {"local": {"forward": operations, "inverse": []}},
        "schemaVersion": "1.2.0",
        "sealed": True,
        "sealedAt": "2026-08-02T22:00:00Z",
        "sourceEvidence": evidence,
        "workItemId": "media-test",
    }


def build_verification_cache(
    module,
    evidence_root: pathlib.Path,
    plan_path: pathlib.Path,
    plan: dict,
    tool_sha256: str,
) -> pathlib.Path:
    cache_root = evidence_root / "media-task-fixture" / "verification-cache"
    plan_sha256 = module.full_digest(plan_path)
    plan_root = cache_root / plan_sha256
    plan_root.mkdir(mode=0o700, parents=True)
    cache_root.chmod(0o700)
    local_manifest_sha256 = plan["execution"]["manifestSha256"]["localForward"]
    evidence = {row["evidenceId"]: row for row in plan["sourceEvidence"]}
    for operation in plan["manifests"]["local"]["forward"]:
        sealed = evidence[operation["evidenceId"]]
        target = pathlib.Path(operation["targetPath"])
        current = target.stat()
        record = {
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
            "path": str(target),
            "planSha256": plan_sha256,
            "schemaVersion": "media-manifest-verification-cache-v1",
            "size": current.st_size,
            "verifierSha256": tool_sha256,
        }
        record_path = plan_root / (
            hashlib.sha256(operation["evidenceId"].encode()).hexdigest() + ".json"
        )
        record_path.write_text(
            json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n",
            encoding="utf-8",
        )
        record_path.chmod(0o600)
    return cache_root


class TrimExactPathReaddTest(unittest.TestCase):
    def test_scales_metadata_refresh_settle_timeout_with_path_count(self):
        module = load_module()

        self.assertEqual(module.metadata_refresh_settle_timeout(1), 90)
        self.assertEqual(module.metadata_refresh_settle_timeout(45), 90)
        self.assertEqual(module.metadata_refresh_settle_timeout(46), 92)
        self.assertEqual(module.metadata_refresh_settle_timeout(366), 732)
        self.assertEqual(module.metadata_refresh_settle_timeout(1_000), 900)

    def test_reuses_exact_manifest_cache_without_rehashing_canonical_targets(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = root / "evidence"
            plan_root = module.EVIDENCE_ROOT / "media-task-fixture" / "media-run-fixture"
            plan_root.mkdir(mode=0o700, parents=True)
            target_root = root / "Media" / "movie" / "TV" / "Fixture"
            targets = [
                target_root / "Season 01" / "Fixture - S01E01.mkv",
                target_root / "Season 01" / "Fixture - S01E02.mkv",
            ]
            plan = build_plan(target_root, targets)
            plan["execution"]["manifestSha256"] = {
                "localForward": "b" * 64
            }
            plan_path = plan_root / "plan.json"
            plan_path.write_text(
                json.dumps(plan, separators=(",", ":"), sort_keys=True),
                encoding="utf-8",
            )
            tool_sha256 = "c" * 64
            cache_root = build_verification_cache(
                module,
                module.EVIDENCE_ROOT,
                plan_path,
                plan,
                tool_sha256,
            )
            records = module.target_records(plan)
            verification_cache = module.load_verification_cache(
                plan_path,
                plan,
                records,
                cache_root,
                tool_sha256,
            )

            with mock.patch.object(
                module,
                "full_digest",
                side_effect=AssertionError("canonical bytes must not be rehashed"),
            ):
                result = module.preflight(
                    plan,
                    verification_cache=verification_cache,
                )

        self.assertEqual(result["operationCount"], 2)
        self.assertEqual(result["verificationCacheHitCount"], 2)

    def test_rejects_manifest_cache_after_target_stat_changes(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = root / "evidence"
            plan_root = module.EVIDENCE_ROOT / "media-task-fixture" / "media-run-fixture"
            plan_root.mkdir(mode=0o700, parents=True)
            target_root = root / "Media" / "movie" / "TV" / "Fixture"
            target = target_root / "Season 01" / "Fixture - S01E01.mkv"
            plan = build_plan(target_root, [target])
            plan["execution"]["manifestSha256"] = {
                "localForward": "b" * 64
            }
            plan_path = plan_root / "plan.json"
            plan_path.write_text(
                json.dumps(plan, separators=(",", ":"), sort_keys=True),
                encoding="utf-8",
            )
            tool_sha256 = "c" * 64
            cache_root = build_verification_cache(
                module,
                module.EVIDENCE_ROOT,
                plan_path,
                plan,
                tool_sha256,
            )
            target_stat = target.stat()
            os.utime(
                target,
                ns=(target_stat.st_atime_ns, target_stat.st_mtime_ns + 1_000_000_000),
            )

            with self.assertRaisesRegex(RuntimeError, "cache record changed"):
                module.load_verification_cache(
                    plan_path,
                    plan,
                    module.target_records(plan),
                    cache_root,
                    tool_sha256,
                )

    def test_observes_exact_media_delete_markers_without_writing_database(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            database = pathlib.Path(temporary) / "trimmedia.db"
            canonical_path = "/media/Movies/Title/Title.mkv"
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("CREATE TABLE media_delete (media_path TEXT)")
                connection.execute(
                    "INSERT INTO media_delete (media_path) VALUES (?)",
                    (canonical_path,),
                )
                connection.commit()
            module.MEDIA_DB = database
            module.wait_for_delete_markers([canonical_path], timeout=0)
            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    "DELETE FROM media_delete WHERE media_path = ?",
                    (canonical_path,),
                )
                connection.commit()
            module.wait_for_delete_markers_absent([canonical_path], timeout=0)

    def test_executes_only_sealed_exact_video_targets(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [
                root / "Season 01" / "Title - S01E01.mkv",
                root / "Season 01" / "Title - S01E02.mkv",
            ]
            plan = build_plan(root, targets)
            helper = FakeHelper()
            result = module.execute_exact_path_readd(
                plan,
                "a" * 32,
                helper,
                service_running=lambda: True,
            )
        self.assertEqual(result["operationCount"], 2)
        self.assertEqual(result["state"], "committed")
        self.assertEqual(
            helper.calls,
            [("/v/api/v1/task/running", "GET", None)]
            + [
                (
                    "/v/api/v1/scrap/removeFromBlackByPath",
                    "POST",
                    {"mdb_guid": "a" * 32, "path": str(target)},
                )
                for target in targets
            ],
        )

    def test_rejects_target_outside_sealed_root_before_api_call(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            target = root / "Season 01" / "Title - S01E01.mkv"
            plan = build_plan(root, [target])
            outside = pathlib.Path(temporary) / "outside.mkv"
            outside.write_bytes(target.read_bytes())
            plan["manifests"]["local"]["forward"][0]["targetPath"] = str(outside)
            helper = FakeHelper()
            with self.assertRaisesRegex(RuntimeError, "outside localTargetRoot"):
                module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    helper,
                    service_running=lambda: True,
                )
        self.assertEqual(helper.calls, [])

    def test_refreshes_existing_exact_title_before_readd(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [
                root / "Season 01" / "Title - S01E01.mkv",
                root / "Season 01" / "Title - S01E02.mkv",
            ]
            plan = build_plan(root, targets)
            media_root = root.parent
            previous_root = media_root / "Legacy Title"
            plan["execution"]["allowlists"]["localTargetRoot"] = str(media_root)
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "tmdb", "providerId": "123"},
            }
            plan["transition"] = {
                "amendmentPlanSha256": "a" * 64,
                "kind": "canonical-identity-rebase-v1",
                "previousPlanSha256": "b" * 64,
                "previousTitleRoot": str(previous_root),
                "summary": "修正规范身份目录",
                "targetTitleRoot": str(root),
            }
            for operation, evidence in zip(
                plan["manifests"]["local"]["forward"],
                plan["sourceEvidence"],
                strict=True,
            ):
                source = previous_root / pathlib.Path(
                    operation["targetPath"]
                ).relative_to(root)
                operation["sourcePath"] = str(source)
                evidence["path"] = str(source)
            receipt = {
                str(target): {
                    "device": target.stat().st_dev,
                    "inode": target.stat().st_ino,
                    "mtimeNs": target.stat().st_mtime_ns,
                    "size": target.stat().st_size,
                }
                for target in targets
            }
            old_scope = {
                "favoriteOwners": [],
                "itemUserCount": 2,
                "mediaGuids": ["media-1", "media-2"],
                "playCount": 3,
                "rootGuid": "old-root",
            }
            new_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["new-media-1", "new-media-2"],
                "playCount": 0,
                "rootGuid": "new-root",
            }
            events = []

            class OrderingHelper(FakeHelper):
                def request(self, path, method="GET", payload=None):
                    if path.startswith("/v/api/v1/item/"):
                        events.append("official-delete")
                    if path == "/v/api/v1/scrap/removeFromBlackByPath":
                        events.append("official-readd")
                    return super().request(path, method, payload)

            helper = OrderingHelper()
            with (
                mock.patch.object(
                    module,
                    "refresh_scope",
                    side_effect=[old_scope, new_scope],
                ),
                mock.patch.object(
                    module,
                    "metadata_refresh_scopes",
                    side_effect=[[old_scope], [new_scope]],
                ),
                mock.patch.object(module, "identity_rebase_scope", return_value=None),
                mock.patch.object(
                    module,
                    "wait_for_paths_absent",
                    side_effect=lambda _paths: events.append("active-paths-absent"),
                ),
                mock.patch.object(
                    module,
                    "wait_for_delete_markers",
                    side_effect=lambda _paths: events.append("delete-markers-present"),
                ),
                mock.patch.object(
                    module,
                    "wait_for_delete_markers_absent",
                    side_effect=lambda _paths: events.append("delete-markers-absent"),
                ),
                mock.patch.object(
                    module,
                    "wait_for_refresh_scope",
                    return_value=new_scope,
                ),
                mock.patch.object(
                    module,
                    "wait_for_metadata_refresh_scopes",
                    return_value=[new_scope],
                ),
                mock.patch.object(module, "wait_for_running_tasks"),
                mock.patch.object(
                    module,
                    "restore_refresh_favorites",
                    return_value=0,
                ),
            ):
                result = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    helper,
                    official_helper_path=SCRIPT_PATH,
                    refresh_existing=True,
                    refresh_identity={"provider": "tmdb", "providerId": "123"},
                    refresh_receipt=receipt,
                    refresh_sidecars=[],
                    service_running=lambda: True,
                )
        self.assertEqual(
            events,
            [
                "official-delete",
                "active-paths-absent",
                "delete-markers-present",
                "official-readd",
                "official-readd",
                "delete-markers-absent",
            ],
        )
        self.assertEqual(result["officialDeleteCount"], 1)
        self.assertEqual(result["officialDeleteFileValue"], 0)
        self.assertEqual(result["discardedPlaybackCount"], 3)
        self.assertEqual(
            helper.calls,
            [
                ("/v/api/v1/task/running", "GET", None),
                (
                    "/v/api/v1/item/old-root",
                    "DELETE",
                    {
                        "delete_file": 0,
                        "guid": "old-root",
                        "media_guids": ["media-1", "media-2"],
                    },
                ),
            ]
            + [
                (
                    "/v/api/v1/scrap/removeFromBlackByPath",
                    "POST",
                    {"mdb_guid": "a" * 32, "path": str(target)},
                )
                for target in targets
            ],
        )

    def test_rebases_old_official_scope_before_exact_new_path_readd(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            media_root = pathlib.Path(temporary) / "Movies"
            old_root = media_root / "咒术回战0"
            target_root = media_root / "咒术回战0 (2022) [tmdbid-810693]"
            old_root.mkdir(parents=True)
            target = target_root / "咒术回战0.mkv"
            plan = build_plan(media_root, [target])
            plan["identity"] = {
                "mediaType": "movie",
                "providerRef": {"provider": "tmdb", "providerId": "810693"},
            }
            plan["transition"] = {
                "amendmentPlanSha256": "a" * 64,
                "kind": "canonical-identity-rebase-v1",
                "previousPlanSha256": "b" * 64,
                "previousTitleRoot": str(old_root),
                "summary": "修正电影身份目录",
                "targetTitleRoot": str(target_root),
            }
            operation = plan["manifests"]["local"]["forward"][0]
            operation["sourcePath"] = str(old_root / target.name)
            plan["sourceEvidence"][0]["path"] = operation["sourcePath"]
            old_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["old-media"],
                "playCount": 0,
                "rootGuid": "old-root-guid",
            }
            new_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["new-media"],
                "playCount": 0,
                "rootGuid": "new-root-guid",
            }
            helper = FakeHelper()
            with (
                mock.patch.object(
                    module, "identity_rebase_scope", return_value=old_scope
                ),
                mock.patch.object(
                    module,
                    "refresh_scope",
                    side_effect=[None, new_scope],
                ),
                mock.patch.object(module, "wait_for_paths_absent"),
                mock.patch.object(
                    module, "wait_for_refresh_scope", return_value=new_scope
                ),
                mock.patch.object(module, "wait_for_running_tasks"),
            ):
                result = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    helper,
                    service_running=lambda: True,
                )

            self.assertEqual(result["identityRebase"], True)
            self.assertEqual(result["officialDeleteCount"], 1)
            self.assertEqual(result["officialDeleteFileValue"], 0)
            self.assertEqual(result["oldTitleRootRemoved"], True)
            self.assertFalse(old_root.exists())
            self.assertEqual(
                helper.calls,
                [
                    ("/v/api/v1/task/running", "GET", None),
                    (
                        "/v/api/v1/item/old-root-guid",
                        "DELETE",
                        {
                            "delete_file": 0,
                            "guid": "old-root-guid",
                            "media_guids": ["old-media"],
                        },
                    ),
                    (
                        "/v/api/v1/scrap/removeFromBlackByPath",
                        "POST",
                        {"mdb_guid": "a" * 32, "path": str(target)},
                    ),
                ],
            )
            resumed_helper = FakeHelper()
            with (
                mock.patch.object(module, "identity_rebase_scope", return_value=None),
                mock.patch.object(module, "refresh_scope", return_value=new_scope),
            ):
                resumed = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    resumed_helper,
                    service_running=lambda: True,
                )
            self.assertEqual(resumed["exactReaddCount"], 0)
            self.assertEqual(resumed["officialDeleteCount"], 0)
            self.assertEqual(resumed["oldTitleRootRemoved"], False)
            self.assertEqual(
                resumed_helper.calls,
                [("/v/api/v1/task/running", "GET", None)],
            )

    def test_refreshes_a_partial_season_through_exact_episode_scopes(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [
                root / "Season 02" / "Title - S02E27.mkv",
                root / "Season 02" / "Title - S02E28.mkv",
            ]
            plan = build_plan(root, targets)
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "tmdb", "providerId": "123"},
            }
            receipt = {
                str(target): {
                    "device": target.stat().st_dev,
                    "inode": target.stat().st_ino,
                    "mtimeNs": target.stat().st_mtime_ns,
                    "size": target.stat().st_size,
                }
                for target in targets
            }
            previous_scopes = [
                {
                    "favoriteOwners": [],
                    "itemUserCount": index,
                    "mediaGuids": [f"old-media-{index}"],
                    "paths": [str(target)],
                    "playCount": index + 1,
                    "rootGuid": f"old-episode-{index}",
                }
                for index, target in enumerate(targets, start=1)
            ]
            current_scopes = [
                {
                    "favoriteOwners": [],
                    "itemUserCount": 0,
                    "mediaGuids": [f"new-media-{index}"],
                    "paths": [str(target)],
                    "playCount": 0,
                    "rootGuid": f"new-episode-{index}",
                }
                for index, target in enumerate(targets, start=1)
            ]
            helper = FakeHelper()
            with (
                mock.patch.object(
                    module,
                    "metadata_refresh_scopes",
                    side_effect=[previous_scopes, current_scopes],
                ),
                mock.patch.object(module, "wait_for_paths_absent"),
                mock.patch.object(module, "wait_for_delete_markers"),
                mock.patch.object(module, "wait_for_delete_markers_absent"),
                mock.patch.object(
                    module,
                    "wait_for_metadata_refresh_scopes",
                    return_value=current_scopes,
                ),
                mock.patch.object(module, "wait_for_running_tasks"),
                mock.patch.object(
                    module,
                    "restore_refresh_favorites",
                    return_value=0,
                ),
            ):
                result = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    helper,
                    official_helper_path=SCRIPT_PATH,
                    refresh_existing=True,
                    refresh_identity={"provider": "tmdb", "providerId": "123"},
                    refresh_receipt=receipt,
                    refresh_sidecars=[],
                    service_running=lambda: True,
                )

            self.assertEqual(result["officialDeleteCount"], 2)
            self.assertEqual(result["discardedItemUserCount"], 3)
            self.assertEqual(result["discardedPlaybackCount"], 5)
            self.assertEqual(
                helper.calls,
                [("/v/api/v1/task/running", "GET", None)]
                + [
                    (
                        f"/v/api/v1/item/old-episode-{index}",
                        "DELETE",
                        {
                            "delete_file": 0,
                            "guid": f"old-episode-{index}",
                            "media_guids": [f"old-media-{index}"],
                        },
                    )
                    for index in (1, 2)
                ]
                + [
                    (
                        "/v/api/v1/scrap/removeFromBlackByPath",
                        "POST",
                        {"mdb_guid": "a" * 32, "path": str(target)},
                    )
                    for target in targets
                ],
            )

    def test_refresh_restores_sealed_sidecars_before_exact_readd(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            title = pathlib.Path(temporary) / "TV" / "Title"
            video = title / "Season 01" / "Title - S01E01.mkv"
            plan = build_plan(title, [video])
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "tmdb", "providerId": "123"},
                "providerTitle": "Title",
                "releaseYear": 2026,
            }
            sidecars = [
                (title / "Season 01" / "Title - S01E01.zh-CN.ass", b"subtitle", "subtitle"),
                (title / "Season 01" / "extras" / "Fonts" / "Fonts.7z", b"asset", "asset"),
            ]
            rollback_root = pathlib.Path(temporary) / "rollback"
            receipts = []
            for index, (target, content, file_kind) in enumerate(sidecars, start=1):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                evidence_id = f"sidecar-{index}"
                plan["sourceEvidence"].append(
                    {
                        "digest": hashlib.sha256(content).hexdigest(),
                        "evidenceId": evidence_id,
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": file_kind,
                        "scope": "local",
                        "size": len(content),
                    }
                )
                plan["manifests"]["local"]["forward"].append(
                    {
                        "evidenceId": evidence_id,
                        "fileKind": file_kind,
                        "operation": "move",
                        "sourcePath": str(title / "old" / target.name),
                        "targetPath": str(target),
                    }
                )
                rollback = rollback_root / target.relative_to(title)
                rollback.parent.mkdir(parents=True, exist_ok=True)
                rollback.hardlink_to(target)
                stat = target.stat()
                receipts.append(
                    {
                        "device": stat.st_dev,
                        "digest": hashlib.sha256(content).hexdigest(),
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": file_kind,
                        "inode": stat.st_ino,
                        "mtimeNs": stat.st_mtime_ns,
                        "rollback": rollback,
                        "size": stat.st_size,
                        "target": target,
                    }
                )
            video_receipt = {
                str(video): {
                    "device": video.stat().st_dev,
                    "inode": video.stat().st_ino,
                    "mtimeNs": video.stat().st_mtime_ns,
                    "size": video.stat().st_size,
                }
            }
            old_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["media-1"],
                "playCount": 0,
                "rootGuid": "old-root",
            }
            new_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["new-media-1"],
                "playCount": 0,
                "rootGuid": "new-root",
            }

            def delete_sidecars(_paths):
                for target, _content, _kind in sidecars:
                    target.unlink()

            with (
                mock.patch.object(
                    module,
                    "metadata_refresh_scopes",
                    side_effect=[[old_scope], [new_scope]],
                ),
                mock.patch.object(module, "wait_for_paths_absent", side_effect=delete_sidecars),
                mock.patch.object(module, "wait_for_delete_markers"),
                mock.patch.object(module, "wait_for_delete_markers_absent"),
                mock.patch.object(
                    module,
                    "wait_for_metadata_refresh_scopes",
                    return_value=[new_scope],
                ),
                mock.patch.object(module, "wait_for_running_tasks"),
                mock.patch.object(module, "restore_refresh_favorites", return_value=0),
            ):
                result = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    FakeHelper(),
                    official_helper_path=SCRIPT_PATH,
                    refresh_existing=True,
                    refresh_identity={"provider": "tmdb", "providerId": "123"},
                    refresh_receipt=video_receipt,
                    refresh_sidecars=receipts,
                    service_running=lambda: True,
                )

            self.assertEqual(result["sidecarRestoreCount"], 2)
            self.assertEqual(result["sidecarPreservedCount"], 0)
            for entry in receipts:
                self.assertTrue(entry["target"].is_file())
                self.assertEqual(entry["target"].stat().st_ino, entry["inode"])

    def test_refresh_recovers_missing_sidecar_after_uncertain_readd_timeout(self):
        """确认已删除状态可从密封备份恢复字幕且不会盲重放超时写请求。"""
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            title = pathlib.Path(temporary) / "Movies" / "Title"
            video = title / "Title.mkv"
            plan = build_plan(title, [video])
            plan["identity"] = {
                "mediaType": "movie",
                "providerRef": {"provider": "tmdb", "providerId": "123"},
            }
            subtitle = title / "Title.zh-CN.ass"
            subtitle.write_bytes(b"subtitle")
            plan["sourceEvidence"].append(
                {
                    "digest": hashlib.sha256(b"subtitle").hexdigest(),
                    "evidenceId": "subtitle-1",
                    "evidenceMethod": "sha256-full-v1",
                    "fileKind": "subtitle",
                    "scope": "local",
                    "size": len(b"subtitle"),
                }
            )
            plan["manifests"]["local"]["forward"].append(
                {
                    "evidenceId": "subtitle-1",
                    "fileKind": "subtitle",
                    "operation": "move",
                    "sourcePath": str(title / "old" / subtitle.name),
                    "targetPath": str(subtitle),
                }
            )
            rollback = pathlib.Path(temporary) / "rollback" / subtitle.name
            rollback.parent.mkdir()
            rollback.hardlink_to(subtitle)
            subtitle_stat = subtitle.stat()
            sidecar_receipt = {
                "device": subtitle_stat.st_dev,
                "digest": hashlib.sha256(b"subtitle").hexdigest(),
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "subtitle",
                "inode": subtitle_stat.st_ino,
                "mtimeNs": subtitle_stat.st_mtime_ns,
                "rollback": rollback,
                "size": subtitle_stat.st_size,
                "target": subtitle,
            }
            video_receipt = {
                str(video): {
                    "device": video.stat().st_dev,
                    "inode": video.stat().st_ino,
                    "mtimeNs": video.stat().st_mtime_ns,
                    "size": video.stat().st_size,
                }
            }
            previous_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["old-media"],
                "paths": [str(video)],
                "playCount": 0,
                "rootGuid": "old-root",
            }
            current_scope = {
                "favoriteOwners": [],
                "itemUserCount": 0,
                "mediaGuids": ["new-media"],
                "paths": [str(video)],
                "playCount": 0,
                "rootGuid": "new-root",
            }
            subtitle.unlink()

            class TimeoutReaddHelper(FakeHelper):
                def request(self, path, method="GET", payload=None):
                    """仅让精确重入库写请求呈现响应未知的超时结果。"""
                    if path == module.RE_ADD_ROUTE:
                        self.calls.append((path, method, payload))
                        raise TimeoutError("timed out")
                    return super().request(path, method, payload)

            helper = TimeoutReaddHelper()
            with (
                mock.patch.object(module, "canonical_rows", return_value=[]),
                mock.patch.object(
                    module,
                    "metadata_refresh_scopes",
                    side_effect=[[], [current_scope]],
                ),
                mock.patch.object(module, "wait_for_delete_markers_absent"),
                mock.patch.object(
                    module,
                    "wait_for_metadata_refresh_scopes",
                    return_value=[current_scope],
                ),
                mock.patch.object(module, "wait_for_running_tasks"),
                mock.patch.object(
                    module,
                    "restore_metadata_refresh_favorites",
                    return_value=0,
                ),
            ):
                result = module.execute_exact_path_readd(
                    plan,
                    "a" * 32,
                    helper,
                    official_helper_path=SCRIPT_PATH,
                    refresh_existing=True,
                    refresh_identity={"provider": "tmdb", "providerId": "123"},
                    refresh_previous_scopes=[previous_scope],
                    refresh_receipt=video_receipt,
                    refresh_sidecars=[sidecar_receipt],
                    service_running=lambda: True,
                )

            self.assertTrue(subtitle.is_file())
            self.assertEqual(subtitle.stat().st_ino, subtitle_stat.st_ino)
            self.assertEqual(result["refreshRecovery"], True)
            self.assertEqual(result["sidecarRestoreCount"], 1)
            self.assertEqual(result["officialDeleteCount"], 0)
            self.assertEqual(result["officialRequestTimeoutCount"], 1)
            self.assertEqual(
                helper.calls,
                [
                    ("/v/api/v1/task/running", "GET", None),
                    (
                        module.RE_ADD_ROUTE,
                        "POST",
                        {"mdb_guid": "a" * 32, "path": str(video)},
                    ),
                ],
            )

    def test_dry_run_does_not_load_or_call_an_auth_helper(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            target = root / "Season 01" / "Title - S01E01.mkv"
            plan = build_plan(root, [target])
            plan_path = pathlib.Path(temporary) / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = module.preflight(plan)
        self.assertEqual(result["operationCount"], 1)
        self.assertEqual(result["state"], "preflight-passed")

    def test_loads_task_bound_repair_identity_when_plan_provider_is_empty(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            evidence_root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = evidence_root
            title_root = evidence_root / "TV" / "Title"
            target = title_root / "Season 01" / "Title - S01E01.mkv"
            plan = build_plan(title_root, [target])
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": None,
                "title": "Title",
            }
            evidence_path = evidence_root / "metadata-repair.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "inspection": {
                            "identity": {
                                "provider": "tmdb",
                                "providerId": "123",
                                "releaseYear": 2023,
                            },
                            "titleRoot": str(title_root),
                        },
                        "repairAttempt": 1,
                        "schemaVersion": "media-admin-metadata-repair-v1",
                        "state": "metadata-assets-committed",
                        "taskId": "media-task-fixture",
                    }
                ),
                encoding="utf-8",
            )
            identity = module.load_refresh_identity(
                plan,
                module.target_records(plan),
                evidence_path,
                module.full_digest(evidence_path),
                "media-task-fixture",
            )
        self.assertEqual(identity, {"provider": "tmdb", "providerId": "123"})

    def test_loads_v2_refresh_receipt_with_same_inode_sidecar_backup(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as temporary:
            root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = root / "evidence"
            module.BACKUP_ROOT = root / "backups"
            module.ROLLBACK_ROOT = root / "rollback"
            for directory in (
                module.EVIDENCE_ROOT,
                module.BACKUP_ROOT,
                module.ROLLBACK_ROOT,
            ):
                directory.mkdir()
            title = root / "Media" / "movie" / "TV" / "Title"
            video = title / "Season 01" / "Title - S01E01.mkv"
            plan = build_plan(title, [video])
            subtitle = title / "Season 01" / "Title - S01E01.zh-CN.ass"
            subtitle.write_bytes(b"subtitle")
            plan["sourceEvidence"].append(
                {
                    "digest": hashlib.sha256(b"subtitle").hexdigest(),
                    "evidenceId": "subtitle-1",
                    "evidenceMethod": "sha256-full-v1",
                    "fileKind": "subtitle",
                    "scope": "local",
                    "size": len(b"subtitle"),
                }
            )
            plan["manifests"]["local"]["forward"].append(
                {
                    "evidenceId": "subtitle-1",
                    "fileKind": "subtitle",
                    "operation": "move",
                    "sourcePath": str(title / "old" / subtitle.name),
                    "targetPath": str(subtitle),
                }
            )
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            database_root = module.BACKUP_ROOT / "task" / "run"
            database_root.mkdir(parents=True)
            databases = []
            for name in module.DATABASE_NAMES:
                database = database_root / name
                with closing(sqlite3.connect(database)) as connection:
                    connection.execute("CREATE TABLE fixture (value TEXT)")
                databases.append(
                    {
                        "name": name,
                        "path": str(database),
                        "quickCheck": "ok",
                        "sha256": module.full_digest(database),
                    }
                )
            rollback_root = module.ROLLBACK_ROOT / "task" / "run"
            rollback_root.mkdir(parents=True, mode=0o700)
            rollback_root.chmod(0o700)
            rollback = (
                rollback_root
                / plan["workItemId"]
                / subtitle.relative_to(title)
            )
            rollback.parent.mkdir(parents=True)
            rollback.hardlink_to(subtitle)
            subtitle_stat = subtitle.stat()
            video_stat = video.stat()
            evidence_path = module.EVIDENCE_ROOT / "metadata-backup.json"
            evidence_path.write_text(
                json.dumps(
                    {
                        "canonicalVideos": [
                            {
                                "device": video_stat.st_dev,
                                "digest": plan["sourceEvidence"][0]["digest"],
                                "inode": video_stat.st_ino,
                                "mtimeNs": video_stat.st_mtime_ns,
                                "size": video_stat.st_size,
                                "targetPath": str(video),
                                "workItemId": plan["workItemId"],
                            }
                        ],
                        "databaseBackupRoot": str(database_root),
                        "databases": databases,
                        "hardlinkCount": 1,
                        "plans": [
                            {
                                "path": str(plan_path),
                                "sha256": module.full_digest(plan_path),
                                "workItemId": plan["workItemId"],
                            }
                        ],
                        "protectedSidecars": [
                            {
                                "device": subtitle_stat.st_dev,
                                "digest": hashlib.sha256(b"subtitle").hexdigest(),
                                "evidenceMethod": "sha256-full-v1",
                                "fileKind": "subtitle",
                                "inode": subtitle_stat.st_ino,
                                "mtimeNs": subtitle_stat.st_mtime_ns,
                                "rollbackPath": str(rollback),
                                "size": subtitle_stat.st_size,
                                "targetPath": str(subtitle),
                                "workItemId": plan["workItemId"],
                            }
                        ],
                        "rollbackRoot": str(rollback_root),
                        "schemaVersion": "media-post-governance-metadata-backup-v2",
                        "state": "database-backup-complete",
                    }
                ),
                encoding="utf-8",
            )

            self.assertTrue(rollback_root.is_absolute())
            self.assertTrue(rollback_root.is_dir())
            self.assertFalse(rollback_root.is_symlink())
            self.assertTrue(
                module.is_descendant(
                    rollback_root.resolve(strict=False),
                    module.ROLLBACK_ROOT.resolve(strict=False),
                )
            )
            self.assertEqual(rollback_root.stat().st_mode & 0o077, 0)

            subtitle.unlink()
            video_receipt, sidecar_receipts = module.load_refresh_receipt(
                plan_path,
                plan,
                module.target_records(plan),
                evidence_path,
                module.full_digest(evidence_path),
            )

            self.assertEqual(set(video_receipt), {str(video)})
            self.assertEqual(len(sidecar_receipts), 1)
            self.assertFalse(subtitle.exists())
            restored, preserved = module.restore_refresh_sidecars(
                plan, sidecar_receipts
            )
            self.assertEqual((restored, preserved), (1, 0))
            self.assertEqual(
                sidecar_receipts[0]["rollback"].stat().st_ino,
                subtitle.stat().st_ino,
            )

    def test_refresh_scope_requires_the_complete_unique_title_root(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [
                root / "Season 01" / "Title - S01E01.mkv",
                root / "Season 01" / "Title - S01E02.mkv",
            ]
            plan = build_plan(root, targets)
            plan["identity"] = {"mediaType": "tv", "providerRef": None}
            database = pathlib.Path(temporary) / "trimmedia.db"
            module.MEDIA_DB = database
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(
                    """
                    CREATE TABLE item (
                      guid TEXT PRIMARY KEY,
                      parent_guid TEXT,
                      type TEXT,
                      tmdb_id INTEGER
                    );
                    CREATE TABLE item_media (
                      guid TEXT PRIMARY KEY,
                      item_guid TEXT,
                      path TEXT
                    );
                    CREATE TABLE item_user_favorite (user_guid TEXT, item_guid TEXT);
                    CREATE TABLE item_user (item_guid TEXT);
                    CREATE TABLE item_user_play (item_guid TEXT, media_guid TEXT);
                    """
                )
                connection.executemany(
                    "INSERT INTO item(guid,parent_guid,type,tmdb_id) VALUES(?,?,?,?)",
                    [
                        ("root", None, "TV", 123),
                        ("season", "root", "Season", 0),
                        ("episode-1", "season", "Episode", 0),
                        ("episode-2", "season", "Episode", 0),
                    ],
                )
                connection.executemany(
                    "INSERT INTO item_media(guid,item_guid,path) VALUES(?,?,?)",
                    [
                        ("media-1", "episode-1", str(targets[0])),
                        ("media-2", "episode-2", str(targets[1])),
                    ],
                )
                connection.commit()
            scope = module.refresh_scope(
                plan,
                module.target_records(plan),
                {"provider": "tmdb", "providerId": "123"},
            )
            self.assertEqual(scope["rootGuid"], "root")
            self.assertEqual(scope["mediaGuids"], ["media-1", "media-2"])
            with closing(sqlite3.connect(database)) as connection:
                connection.execute(
                    "INSERT INTO item(guid,parent_guid,type,tmdb_id) VALUES(?,?,?,?)",
                    ("episode-extra", "season", "Episode", 0),
                )
                connection.execute(
                    "INSERT INTO item_media(guid,item_guid,path) VALUES(?,?,?)",
                    ("media-extra", "episode-extra", str(root / "extra.mkv")),
                )
                connection.commit()
            with self.assertRaisesRegex(RuntimeError, "outside the sealed plan"):
                module.refresh_scope(
                    plan,
                    module.target_records(plan),
                    {"provider": "tmdb", "providerId": "123"},
                )
            scopes = module.metadata_refresh_scopes(
                plan,
                module.target_records(plan),
                {"provider": "tmdb", "providerId": "123"},
            )
            self.assertEqual(
                [scope["rootGuid"] for scope in scopes],
                ["episode-1", "episode-2"],
            )
            self.assertEqual(
                [scope["mediaGuids"] for scope in scopes],
                [["media-1"], ["media-2"]],
            )

    def test_refresh_scope_accepts_one_complete_season_beside_another_season(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [
                root / "Season 02" / "Title - S02E25.mkv",
                root / "Season 02" / "Title - S02E26.mkv",
            ]
            plan = build_plan(root, targets)
            plan["identity"] = {"mediaType": "tv", "providerRef": None}
            database = pathlib.Path(temporary) / "trimmedia.db"
            module.MEDIA_DB = database
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(
                    """
                    CREATE TABLE item (
                      guid TEXT PRIMARY KEY,
                      parent_guid TEXT,
                      type TEXT,
                      tmdb_id INTEGER
                    );
                    CREATE TABLE item_media (
                      guid TEXT PRIMARY KEY,
                      item_guid TEXT,
                      path TEXT
                    );
                    CREATE TABLE item_user_favorite (user_guid TEXT, item_guid TEXT);
                    CREATE TABLE item_user (item_guid TEXT);
                    CREATE TABLE item_user_play (item_guid TEXT, media_guid TEXT);
                    """
                )
                connection.executemany(
                    "INSERT INTO item(guid,parent_guid,type,tmdb_id) VALUES(?,?,?,?)",
                    [
                        ("root", None, "TV", 123),
                        ("season-1", "root", "Season", 0),
                        ("season-2", "root", "Season", 0),
                        ("episode-1", "season-1", "Episode", 0),
                        ("episode-25", "season-2", "Episode", 0),
                        ("episode-26", "season-2", "Episode", 0),
                    ],
                )
                connection.executemany(
                    "INSERT INTO item_media(guid,item_guid,path) VALUES(?,?,?)",
                    [
                        (
                            "media-1",
                            "episode-1",
                            str(root / "Season 01" / "Title - S01E01.mkv"),
                        ),
                        ("media-25", "episode-25", str(targets[0])),
                        ("media-26", "episode-26", str(targets[1])),
                    ],
                )
                connection.commit()

            scope = module.refresh_scope(
                plan,
                module.target_records(plan),
                {"provider": "tmdb", "providerId": "123"},
            )

            self.assertEqual(scope["rootGuid"], "season-2")
            self.assertEqual(scope["mediaGuids"], ["media-25", "media-26"])

    def test_identity_amendment_binds_the_old_scope_before_verifying_the_new_identity(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "TV" / "Title"
            targets = [root / "Season 00" / "Title - S00E01.mkv"]
            plan = build_plan(root, targets)
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "tmdb", "providerId": "123"},
                "providerTitle": "Title",
                "releaseYear": 2026,
            }
            plan["agentAmendments"] = [
                {
                    "kind": "identity",
                    "planSha256": "a" * 64,
                    "provider": "tmdb",
                    "providerId": "123",
                    "providerTitle": "Title",
                    "releaseYear": 2026,
                }
            ]
            database = pathlib.Path(temporary) / "trimmedia.db"
            module.MEDIA_DB = database
            with closing(sqlite3.connect(database)) as connection:
                connection.executescript(
                    """
                    CREATE TABLE item (
                      guid TEXT PRIMARY KEY,
                      parent_guid TEXT,
                      type TEXT,
                      tmdb_id INTEGER
                    );
                    CREATE TABLE item_media (
                      guid TEXT PRIMARY KEY,
                      item_guid TEXT,
                      path TEXT
                    );
                    CREATE TABLE item_user_favorite (user_guid TEXT, item_guid TEXT);
                    CREATE TABLE item_user (item_guid TEXT);
                    CREATE TABLE item_user_play (item_guid TEXT, media_guid TEXT);
                    """
                )
                connection.executemany(
                    "INSERT INTO item(guid,parent_guid,type,tmdb_id) VALUES(?,?,?,?)",
                    [
                        ("old-root", None, "TV", 999),
                        ("season", "old-root", "Season", 0),
                        ("episode-1", "season", "Episode", 0),
                    ],
                )
                connection.execute(
                    "INSERT INTO item_media(guid,item_guid,path) VALUES(?,?,?)",
                    ("media-1", "episode-1", str(targets[0])),
                )
                connection.commit()
            identity = {"provider": "tmdb", "providerId": "123"}

            self.assertTrue(module.sealed_identity_change_authorized(plan, identity))
            with self.assertRaisesRegex(RuntimeError, "active provider identity"):
                module.refresh_scope(plan, module.target_records(plan), identity)
            old_scope = module.refresh_scope(
                plan,
                module.target_records(plan),
                identity,
                require_provider_identity=False,
            )

            self.assertEqual(old_scope["rootGuid"], "old-root")
            with self.assertRaisesRegex(RuntimeError, "active provider identity"):
                module.refresh_scope(
                    plan,
                    module.target_records(plan),
                    identity,
                    allow_unverified_provider_identity=True,
                    require_provider_identity=False,
                )
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE item SET tmdb_id = NULL WHERE guid = 'old-root'")
                connection.commit()
            with self.assertRaisesRegex(RuntimeError, "active provider identity"):
                module.refresh_scope(
                    plan,
                    module.target_records(plan),
                    identity,
                    allow_unverified_provider_identity=True,
                    require_provider_identity=False,
                )
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE item SET tmdb_id = '' WHERE guid = 'old-root'")
                connection.commit()
            with self.assertRaisesRegex(RuntimeError, "active provider identity"):
                module.refresh_scope(
                    plan,
                    module.target_records(plan),
                    identity,
                    allow_unverified_provider_identity=True,
                    require_provider_identity=False,
                )
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE item SET tmdb_id = 0 WHERE guid = 'old-root'")
                connection.commit()
            transitional_scope = module.refresh_scope(
                plan,
                module.target_records(plan),
                identity,
                allow_unverified_provider_identity=True,
                require_provider_identity=False,
            )
            self.assertEqual(transitional_scope["rootGuid"], "old-root")
            with closing(sqlite3.connect(database)) as connection:
                connection.execute("UPDATE item SET tmdb_id = 123 WHERE guid = 'old-root'")
                connection.commit()
            target_scope = module.refresh_scope(
                plan,
                module.target_records(plan),
                identity,
                allow_unverified_provider_identity=True,
                require_provider_identity=False,
            )
            self.assertEqual(target_scope["rootGuid"], "old-root")
            plan["catalogIdentity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "bangumi", "providerId": "302286"},
                "releaseYear": 2022,
                "title": "Title",
            }
            plan["identity"] = {
                "mediaType": "tv",
                "providerRef": {"provider": "bangumi", "providerId": "302286"},
                "releaseYear": 2022,
                "title": "Title",
            }
            plan["metadataIdentity"] = {
                "provider": "tmdb",
                "providerId": "123",
                "providerTitle": "Title",
                "releaseYear": 2026,
            }
            self.assertTrue(module.sealed_identity_change_authorized(plan, identity))
            plan["agentAmendments"][0]["providerId"] = "456"
            self.assertFalse(module.sealed_identity_change_authorized(plan, identity))


if __name__ == "__main__":
    unittest.main()
