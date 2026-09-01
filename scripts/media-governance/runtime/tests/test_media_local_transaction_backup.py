#!/usr/bin/env python3
"""本地媒体批量回滚备份器的纯函数与 SQLite 回归测试。"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from argparse import Namespace
from contextlib import closing
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-transaction-backup.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_local_transaction_backup", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load local transaction backup script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLocalTransactionBackupTest(unittest.TestCase):
    def test_bounded_sha256_uses_first_and_last_four_mib(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            path = pathlib.Path(directory) / "video.bin"
            path.write_bytes(b"a" * module.CHUNK_SIZE + b"middle" + b"z" * module.CHUNK_SIZE)

            expected = module.hashlib.sha256(
                b"a" * module.CHUNK_SIZE + b"z" * module.CHUNK_SIZE
            ).hexdigest()

            self.assertEqual(module.bounded_sha256(path), expected)

    def test_database_backup_is_consistent_and_readable(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory)
            source = root / "source.db"
            target = root / "target.db"
            with closing(sqlite3.connect(source)) as connection:
                connection.execute("CREATE TABLE sample (value TEXT NOT NULL)")
                connection.execute("INSERT INTO sample VALUES ('ok')")
                connection.commit()

            result = module.backup_database(source, target)

            self.assertEqual(result["quickCheck"], "ok")
            with closing(sqlite3.connect(target)) as connection:
                self.assertEqual(
                    connection.execute("SELECT value FROM sample").fetchone()[0],
                    "ok",
                )
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_new_path_must_stay_below_fixed_parent(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.validate_new_path(root / "child", root, "child")
            with self.assertRaisesRegex(RuntimeError, "below"):
                module.validate_new_path(root.parent / "outside", root, "outside")

    def test_collects_admin_video_from_task_staging_with_full_sha(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.STAGING_PARENT = root / "staging"
            for path in (
                module.EVIDENCE_ROOT,
                module.MEDIA_ROOT,
                module.STAGING_PARENT,
            ):
                path.mkdir(parents=True)
            source_root = module.LOCAL_MEDIA_ROOT / "incoming"
            source_root.mkdir()
            staging_root = module.STAGING_PARENT / "media-task-fixture"
            staging_root.mkdir()
            source = staging_root / "Show.S01E01.mkv"
            source.write_bytes(b"video")
            stat = source.stat()
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(
                json.dumps(
                    {
                        "execution": {
                            "allowlists": {
                                "localSourceRoot": str(source_root),
                                "localStagingRoot": str(staging_root),
                            },
                            "phase": "local-only",
                        },
                        "manifests": {
                            "local": {
                                "forward": [
                                    {
                                        "evidenceId": "video-1",
                                        "fileKind": "video",
                                        "sourcePath": str(source),
                                    }
                                ]
                            }
                        },
                        "schemaVersion": "1.2.0",
                        "sealed": True,
                        "sourceEvidence": [
                            {
                                "digest": module.sha256_file(source),
                                "evidenceId": "video-1",
                                "evidenceMethod": "sha256-full-v1",
                                "fileKind": "video",
                                "mtimeMs": stat.st_mtime_ns // 1_000_000,
                                "path": str(source),
                                "scope": "local",
                                "size": stat.st_size,
                            }
                        ],
                        "workItemId": "media-063",
                    }
                ),
                encoding="utf-8",
            )

            plan, videos = module.collect_plan_videos(plan_path)

            self.assertEqual(plan["workItemId"], "media-063")
            self.assertEqual(videos[0]["relativePath"], "Show.S01E01.mkv")

    def test_replacement_backup_protects_candidate_and_existing_canonical(self):
        """确认电影升级在移除旧目标前同时密封候选与旧规范视频 hardlink。"""
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.STAGING_PARENT = root / "staging"
            module.ROLLBACK_PARENT = root / "rollback"
            module.BACKUP_PARENT = root / "backups"
            module.DATABASE_ROOT = root / "database"
            for path in (
                module.EVIDENCE_ROOT,
                module.MEDIA_ROOT,
                module.STAGING_PARENT,
                module.ROLLBACK_PARENT,
                module.BACKUP_PARENT,
                module.DATABASE_ROOT,
            ):
                path.mkdir(parents=True)
            for name in module.DATABASE_NAMES:
                with closing(sqlite3.connect(module.DATABASE_ROOT / name)) as connection:
                    connection.execute("CREATE TABLE fixture (value TEXT)")
            source_root = module.LOCAL_MEDIA_ROOT / "incoming"
            source_root.mkdir()
            staging_root = module.STAGING_PARENT / "media-task-upgrade"
            staging_root.mkdir()
            candidate = staging_root / "Homecoming.REMUX.mkv"
            candidate.write_bytes(b"new-remux-video")
            canonical = module.MEDIA_ROOT / "Movies" / "Homecoming" / "Homecoming.mkv"
            canonical.parent.mkdir(parents=True)
            canonical.write_bytes(b"old-video")
            candidate_stat = candidate.stat()
            canonical_stat = canonical.stat()
            plan = {
                "canonicalReplacement": {
                    "replacedPlanSha256": "b" * 64,
                    "replacedTaskId": "media-task-current-homecoming",
                    "replacedTaskRevision": 24,
                    "replacedWorkItemId": "media-082",
                    "schemaVersion": "media-canonical-replacement-v1",
                    "targetEvidence": {
                        "digest": module.sha256_file(canonical),
                        "evidenceId": "canonical-replacement-video",
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": "video",
                        "mtimeMs": canonical_stat.st_mtime_ns // 1_000_000,
                        "path": str(canonical),
                        "scope": "local",
                        "size": canonical_stat.st_size,
                    },
                },
                "execution": {
                    "allowlists": {
                        "localSourceRoot": str(source_root),
                        "localStagingRoot": str(staging_root),
                        "localTargetRoot": str(module.MEDIA_ROOT),
                    },
                    "manifestSha256": {"localForward": "a" * 64},
                    "phase": "local-only",
                },
                "identity": {"mediaType": "movie"},
                "manifests": {
                    "local": {
                        "forward": [
                            {
                                "evidenceId": "candidate-video",
                                "fileKind": "video",
                                "operation": "move",
                                "sourcePath": str(candidate),
                                "targetPath": str(canonical),
                            }
                        ]
                    }
                },
                "schemaVersion": "1.2.0",
                "sealed": True,
                "sourceEvidence": [
                    {
                        "digest": module.sha256_file(candidate),
                        "evidenceId": "candidate-video",
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": "video",
                        "mtimeMs": candidate_stat.st_mtime_ns // 1_000_000,
                        "path": str(candidate),
                        "scope": "local",
                        "size": candidate_stat.st_size,
                    }
                ],
                "workItemId": "media-086",
            }
            plan_path = module.EVIDENCE_ROOT / "task" / "run" / "plan.json"
            plan_path.parent.mkdir(mode=0o700, parents=True)
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            cache_root = module.EVIDENCE_ROOT / "task" / "verification-cache"
            cache_root.mkdir(mode=0o700, parents=True)
            output = plan_path.parent / "backup.json"
            rollback_root = module.ROLLBACK_PARENT / "task" / "run"

            result = module.run(
                Namespace(
                    allow_verification_cache_seed=True,
                    database_backup_root=str(module.BACKUP_PARENT / "task" / "run"),
                    execute=True,
                    output=str(output),
                    plan=[str(plan_path)],
                    post_governance_metadata=False,
                    rollback_root=str(rollback_root),
                    verification_cache_root=str(cache_root),
                    verification_tool_sha256="c" * 64,
                )
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(result["videoCount"], 1)
            self.assertEqual(result["replacedCanonicalVideoCount"], 1)
            self.assertEqual(payload["hardlinkCount"], 1)
            self.assertEqual(len(payload["replacedCanonicalVideos"]), 1)
            candidate_rollback = pathlib.Path(payload["hardlinks"][0]["rollbackPath"])
            canonical_rollback = pathlib.Path(
                payload["replacedCanonicalVideos"][0]["rollbackPath"]
            )
            self.assertEqual(candidate.stat().st_ino, candidate_rollback.stat().st_ino)
            self.assertEqual(canonical.stat().st_ino, canonical_rollback.stat().st_ino)

    def test_shared_verification_record_binds_plan_evidence_and_inode(self):
        """确认备份器只复用同计划、同证据与同文件身份的摘要记录。"""
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.EVIDENCE_ROOT.mkdir(mode=0o700)
            cache_root = module.EVIDENCE_ROOT / "media-task-fixture" / "verification-cache"
            cache_root.mkdir(mode=0o700, parents=True)
            source = root / "episode.mkv"
            source.write_bytes(b"video")
            stat = source.stat()
            evidence = {
                "digest": module.sha256_file(source),
                "evidenceId": "video-1",
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "video",
                "mtimeMs": stat.st_mtime_ns // 1_000_000,
                "path": str(source),
                "scope": "local",
                "size": stat.st_size,
            }
            plan_sha256 = "a" * 64
            local_manifest_sha256 = "b" * 64
            verifier_sha256 = "c" * 64
            record = module.verification_record_payload(
                plan_sha256,
                local_manifest_sha256,
                source,
                evidence,
                stat,
                verifier_sha256,
            )
            record_path = module.verification_record_path(
                cache_root, plan_sha256, evidence["evidenceId"]
            )
            record_path.parent.mkdir(mode=0o700)
            record_path.write_text(
                json.dumps(record, sort_keys=True), encoding="utf-8"
            )
            record_path.chmod(0o600)

            self.assertTrue(
                module.verification_record_matches(
                    cache_root,
                    plan_sha256,
                    local_manifest_sha256,
                    source,
                    evidence,
                    source.stat(),
                    verifier_sha256,
                )
            )
            rollback = root / "rollback.mkv"
            module.os.link(source, rollback)
            self.assertFalse(
                module.verification_record_matches(
                    cache_root,
                    plan_sha256,
                    local_manifest_sha256,
                    source,
                    evidence,
                    source.stat(),
                    verifier_sha256,
                )
            )
            module.write_verification_record(
                cache_root,
                plan_sha256,
                local_manifest_sha256,
                source,
                evidence,
                source.stat(),
                verifier_sha256,
            )
            self.assertTrue(
                module.verification_record_matches(
                    cache_root,
                    plan_sha256,
                    local_manifest_sha256,
                    source,
                    evidence,
                    source.stat(),
                    verifier_sha256,
                )
            )
            rollback.unlink()
            replacement = root / "replacement.mkv"
            replacement.write_bytes(b"video")
            replacement.replace(source)
            source.touch()
            self.assertFalse(
                module.verification_record_matches(
                    cache_root,
                    plan_sha256,
                    local_manifest_sha256,
                    source,
                    evidence,
                    source.stat(),
                    verifier_sha256,
                )
            )

    def test_collects_post_governance_canonical_video_without_old_source(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.EVIDENCE_ROOT.mkdir()
            module.MEDIA_ROOT.mkdir(parents=True)
            target = module.MEDIA_ROOT / "TV" / "Fixture" / "Season 01" / "Fixture - S01E01.mkv"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"canonical-video")
            missing_source = module.LOCAL_MEDIA_ROOT / "incoming" / "old.mkv"
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(
                json.dumps(
                    {
                        "execution": {
                            "allowlists": {
                                "localTargetRoot": str(module.MEDIA_ROOT),
                            },
                            "phase": "local-only",
                        },
                        "manifests": {
                            "local": {
                                "forward": [
                                    {
                                        "evidenceId": "video-1",
                                        "fileKind": "video",
                                        "operation": "move",
                                        "sourcePath": str(missing_source),
                                        "targetPath": str(target),
                                    }
                                ]
                            }
                        },
                        "schemaVersion": "1.2.0",
                        "sealed": True,
                        "sourceEvidence": [
                            {
                                "digest": module.sha256_file(target),
                                "evidenceId": "video-1",
                                "evidenceMethod": "sha256-full-v1",
                                "fileKind": "video",
                                "scope": "local",
                                "size": target.stat().st_size,
                            }
                        ],
                        "workItemId": "media-063",
                    }
                ),
                encoding="utf-8",
            )

            plan, videos = module.collect_canonical_plan_videos(plan_path)

            self.assertEqual(plan["workItemId"], "media-063")
            self.assertFalse(missing_source.exists())
            self.assertEqual(videos[0]["targetPath"], str(target))
            self.assertEqual(videos[0]["device"], target.stat().st_dev)
            self.assertEqual(videos[0]["inode"], target.stat().st_ino)
            self.assertEqual(videos[0]["mtimeNs"], target.stat().st_mtime_ns)

    def test_post_governance_collection_reuses_exact_target_cache(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.EVIDENCE_ROOT.mkdir(mode=0o700)
            module.MEDIA_ROOT.mkdir(parents=True)
            target = (
                module.MEDIA_ROOT
                / "TV"
                / "Fixture"
                / "Season 01"
                / "Fixture - S01E01.mkv"
            )
            target.parent.mkdir(parents=True)
            target.write_bytes(b"canonical-video")
            local_manifest_sha256 = "b" * 64
            evidence = {
                "digest": module.sha256_file(target),
                "evidenceId": "video-1",
                "evidenceMethod": "sha256-full-v1",
                "fileKind": "video",
                "scope": "local",
                "size": target.stat().st_size,
            }
            plan = {
                "execution": {
                    "allowlists": {"localTargetRoot": str(module.MEDIA_ROOT)},
                    "manifestSha256": {"localForward": local_manifest_sha256},
                    "phase": "local-only",
                },
                "manifests": {
                    "local": {
                        "forward": [
                            {
                                "evidenceId": "video-1",
                                "fileKind": "video",
                                "operation": "move",
                                "sourcePath": str(root / "missing" / target.name),
                                "targetPath": str(target),
                            }
                        ]
                    }
                },
                "schemaVersion": "1.2.0",
                "sealed": True,
                "sourceEvidence": [evidence],
                "workItemId": "media-063",
            }
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            plan_sha256 = module.sha256_file(plan_path)
            verifier_sha256 = "c" * 64
            cache_root = (
                module.EVIDENCE_ROOT
                / "media-task-fixture"
                / "verification-cache"
            )
            record_path = module.verification_record_path(
                cache_root,
                plan_sha256,
                evidence["evidenceId"],
            )
            record_path.parent.mkdir(mode=0o700, parents=True)
            cache_root.chmod(0o700)
            record_path.write_text(
                json.dumps(
                    module.verification_record_payload(
                        plan_sha256,
                        local_manifest_sha256,
                        target,
                        evidence,
                        target.stat(),
                        verifier_sha256,
                    ),
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
            record_path.chmod(0o600)
            original_sha256_file = module.sha256_file

            def reject_media_rehash(path):
                if pathlib.Path(path) == target:
                    raise AssertionError("canonical media bytes must not be rehashed")
                return original_sha256_file(path)

            with mock.patch.object(
                module,
                "sha256_file",
                side_effect=reject_media_rehash,
            ):
                _plan, videos, _sidecars, _metadata = (
                    module.collect_canonical_plan_targets(
                        plan_path,
                        cache_root,
                        verifier_sha256,
                    )
                )

            self.assertEqual([entry["targetPath"] for entry in videos], [str(target)])

    def test_collects_movie_style_metadata_assets_for_movie_and_theatrical(self):
        """确认 movie 与 theatrical 都按独立 Movies 根收集可替换元数据。"""
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.EVIDENCE_ROOT.mkdir()
            title = module.MEDIA_ROOT / "Movies" / "咒术回战0"
            title.mkdir(parents=True)
            video = title / "咒术回战0.mkv"
            movie_nfo = video.with_suffix(".nfo")
            poster = title / "poster.jpg"
            video.write_bytes(b"canonical-movie")
            movie_nfo.write_bytes(b"old-movie-metadata")
            poster.write_bytes(b"old-movie-poster")
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(
                json.dumps(
                    {
                        "execution": {
                            "allowlists": {"localTargetRoot": str(module.MEDIA_ROOT)},
                            "phase": "local-only",
                        },
                        "identity": {
                            "mediaType": "movie",
                            "providerRef": {
                                "provider": "tmdb",
                                "providerId": "810693",
                            },
                        },
                        "manifests": {
                            "local": {
                                "forward": [
                                    {
                                        "evidenceId": "video-1",
                                        "fileKind": "video",
                                        "operation": "move",
                                        "sourcePath": str(root / "missing" / video.name),
                                        "targetPath": str(video),
                                    }
                                ]
                            }
                        },
                        "schemaVersion": "1.2.0",
                        "sealed": True,
                        "sourceEvidence": [
                            {
                                "digest": module.sha256_file(video),
                                "evidenceId": "video-1",
                                "evidenceMethod": "sha256-full-v1",
                                "fileKind": "video",
                                "scope": "local",
                                "size": video.stat().st_size,
                            }
                        ],
                        "workItemId": "media-063",
                    }
                ),
                encoding="utf-8",
            )

            _plan, videos, sidecars, metadata_assets = (
                module.collect_canonical_plan_targets(plan_path)
            )

            self.assertEqual([entry["targetPath"] for entry in videos], [str(video)])
            self.assertEqual(sidecars, [])
            self.assertEqual(
                {entry["targetPath"] for entry in metadata_assets},
                {str(movie_nfo), str(poster)},
            )

            theatrical_plan = json.loads(plan_path.read_text(encoding="utf-8"))
            theatrical_plan["identity"]["mediaType"] = "theatrical"
            plan_path.write_text(json.dumps(theatrical_plan), encoding="utf-8")

            _plan, videos, sidecars, metadata_assets = (
                module.collect_canonical_plan_targets(plan_path)
            )

            self.assertEqual([entry["targetPath"] for entry in videos], [str(video)])
            self.assertEqual(sidecars, [])
            self.assertEqual(
                {entry["targetPath"] for entry in metadata_assets},
                {str(movie_nfo), str(poster)},
            )

    def test_post_governance_backup_hardlinks_every_sealed_sidecar(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.ROLLBACK_PARENT = root / "rollback"
            module.BACKUP_PARENT = root / "backups"
            module.DATABASE_ROOT = root / "database"
            for path in (
                module.EVIDENCE_ROOT,
                module.MEDIA_ROOT,
                module.ROLLBACK_PARENT,
                module.BACKUP_PARENT,
                module.DATABASE_ROOT,
            ):
                path.mkdir(parents=True)
            for name in module.DATABASE_NAMES:
                with closing(sqlite3.connect(module.DATABASE_ROOT / name)) as connection:
                    connection.execute("CREATE TABLE fixture (value TEXT)")
            title = module.MEDIA_ROOT / "TV" / "Fixture"
            video = title / "Season 01" / "Fixture - S01E01.mkv"
            subtitle = title / "Season 01" / "Fixture - S01E01.zh-CN.ass"
            asset = title / "Season 01" / "extras" / "Fonts" / "Fonts.7z"
            existing_tvshow_nfo = title / "tvshow.nfo"
            existing_episode_poster = video.with_suffix(".jpg")
            for target, content in (
                (video, b"video"),
                (subtitle, b"subtitle"),
                (asset, b"asset"),
                (existing_tvshow_nfo, b"old-tvshow-metadata"),
                (existing_episode_poster, b"old-episode-poster"),
            ):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            operations = []
            evidence = []
            for index, (target, kind) in enumerate(
                ((video, "video"), (subtitle, "subtitle"), (asset, "asset")),
                start=1,
            ):
                evidence_id = f"evidence-{index}"
                operations.append(
                    {
                        "evidenceId": evidence_id,
                        "fileKind": kind,
                        "operation": "move",
                        "sourcePath": str(root / "missing" / target.name),
                        "targetPath": str(target),
                    }
                )
                evidence.append(
                    {
                        "digest": module.sha256_file(target),
                        "evidenceId": evidence_id,
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": kind,
                        "scope": "local",
                        "size": target.stat().st_size,
                    }
                )
            plan_path = module.EVIDENCE_ROOT / "plan.json"
            plan_path.write_text(
                json.dumps(
                    {
                        "execution": {
                            "allowlists": {"localTargetRoot": str(module.MEDIA_ROOT)},
                            "phase": "local-only",
                        },
                        "manifests": {"local": {"forward": operations}},
                        "schemaVersion": "1.2.0",
                        "sealed": True,
                        "sourceEvidence": evidence,
                        "workItemId": "media-063",
                    }
                ),
                encoding="utf-8",
            )
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            local_manifest_sha256 = "d" * 64
            plan["execution"]["manifestSha256"] = {
                "localForward": local_manifest_sha256
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            plan_sha256 = module.sha256_file(plan_path)
            verifier_sha256 = "e" * 64
            cache_root = module.EVIDENCE_ROOT / "task" / "verification-cache"
            plan_cache_root = cache_root / plan_sha256
            plan_cache_root.mkdir(mode=0o700, parents=True)
            cache_root.chmod(0o700)
            evidence_by_id = {
                entry["evidenceId"]: entry for entry in plan["sourceEvidence"]
            }
            for operation in plan["manifests"]["local"]["forward"]:
                sealed = evidence_by_id[operation["evidenceId"]]
                target = pathlib.Path(operation["targetPath"])
                record_path = module.verification_record_path(
                    cache_root,
                    plan_sha256,
                    sealed["evidenceId"],
                )
                record_path.write_text(
                    json.dumps(
                        module.verification_record_payload(
                            plan_sha256,
                            local_manifest_sha256,
                            target,
                            sealed,
                            target.stat(),
                            verifier_sha256,
                        ),
                        sort_keys=True,
                    ),
                    encoding="utf-8",
                )
                record_path.chmod(0o600)
            rollback_root = module.ROLLBACK_PARENT / "task" / "run"
            output = module.EVIDENCE_ROOT / "task" / "run" / "metadata-backup.json"
            result = module.run(
                Namespace(
                    database_backup_root=str(module.BACKUP_PARENT / "task" / "run"),
                    execute=True,
                    output=str(output),
                    plan=[str(plan_path)],
                    post_governance_metadata=True,
                    rollback_root=str(rollback_root),
                    verification_cache_root=str(cache_root),
                    verification_tool_sha256=verifier_sha256,
                )
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(result["sidecarCount"], 2)
            self.assertEqual(result["metadataAssetCount"], 2)
            self.assertEqual(
                payload["schemaVersion"],
                "media-post-governance-metadata-backup-v2",
            )
            self.assertEqual(payload["hardlinkCount"], 2)
            self.assertNotIn("_verification", payload["canonicalVideos"][0])
            self.assertEqual(len(payload["protectedSidecars"]), 2)
            for entry in payload["protectedSidecars"]:
                source = pathlib.Path(entry["targetPath"])
                rollback = pathlib.Path(entry["rollbackPath"])
                self.assertEqual(source.stat().st_ino, rollback.stat().st_ino)
                self.assertEqual(source.stat().st_dev, rollback.stat().st_dev)
                sealed = evidence_by_id[
                    next(
                        operation["evidenceId"]
                        for operation in plan["manifests"]["local"]["forward"]
                        if operation["targetPath"] == entry["targetPath"]
                    )
                ]
                self.assertTrue(
                    module.verification_record_matches(
                        cache_root,
                        plan_sha256,
                        local_manifest_sha256,
                        source,
                        sealed,
                        source.stat(),
                        verifier_sha256,
                    )
                )
            self.assertEqual(payload["metadataAssetHardlinkCount"], 2)
            self.assertEqual(len(payload["replaceableMetadataAssets"]), 2)
            replacements = {
                entry["targetPath"]: entry
                for entry in payload["replaceableMetadataAssets"]
            }
            self.assertEqual(
                set(replacements),
                {str(existing_episode_poster), str(existing_tvshow_nfo)},
            )
            for source_path, replacement in replacements.items():
                self.assertEqual(
                    pathlib.Path(source_path).stat().st_ino,
                    pathlib.Path(replacement["rollbackPath"]).stat().st_ino,
                )
            self.assertEqual(video.stat().st_nlink, 1)

    def test_series_reconciliation_backup_seals_metadata_from_multiple_roots(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory).resolve()
            module.EVIDENCE_ROOT = root / "evidence"
            module.LOCAL_MEDIA_ROOT = root / "Media"
            module.MEDIA_ROOT = module.LOCAL_MEDIA_ROOT / "movie"
            module.EVIDENCE_ROOT.mkdir(parents=True)
            module.MEDIA_ROOT.mkdir(parents=True)
            title_roots = [
                module.MEDIA_ROOT / "TV" / "旧根一",
                module.MEDIA_ROOT / "TV" / "旧根二",
            ]
            videos = []
            for index, title_root in enumerate(title_roots, start=1):
                season = title_root / f"Season {index:02d}"
                video = season / f"旧根 - S{index:02d}E{index:02d}.mkv"
                video.parent.mkdir(parents=True)
                video.write_bytes(f"video-{index}".encode())
                (title_root / "tvshow.nfo").write_text("<tvshow/>")
                (season / "season.nfo").write_text("<season/>")
                videos.append(video)
            operations = []
            evidence = []
            for index, video in enumerate(videos, start=1):
                evidence_id = f"video-{index}"
                operations.append(
                    {
                        "evidenceId": evidence_id,
                        "fileKind": "video",
                        "operation": "move",
                        "sourcePath": str(video),
                        "targetPath": str(video),
                    }
                )
                evidence.append(
                    {
                        "digest": module.sha256_file(video),
                        "evidenceId": evidence_id,
                        "evidenceMethod": "sha256-full-v1",
                        "fileKind": "video",
                        "scope": "local",
                        "size": video.stat().st_size,
                    }
                )
            plan = {
                "execution": {
                    "allowlists": {"localTargetRoot": str(module.MEDIA_ROOT)},
                    "phase": "local-only",
                },
                "identity": {"mediaType": "tv"},
                "manifests": {"local": {"forward": operations}},
                "schemaVersion": "1.2.0",
                "sealed": True,
                "seriesReconciliation": {
                    "canonicalTitle": "死神",
                    "releaseYear": 2004,
                    "sourceTitleRoots": [str(path) for path in title_roots],
                    "targetTitleRoot": str(
                        module.MEDIA_ROOT / "TV" / "死神 (2004) [tmdbid-30984]"
                    ),
                },
                "sourceEvidence": evidence,
                "workItemId": "media-077",
            }
            plan_path = module.EVIDENCE_ROOT / "series-plan.json"
            plan_path.write_text(json.dumps(plan))

            _plan, _videos, _sidecars, metadata = (
                module.collect_canonical_plan_targets(plan_path)
            )
            without_marker = dict(plan)
            without_marker.pop("seriesReconciliation")
            plain_path = module.EVIDENCE_ROOT / "plain-plan.json"
            plain_path.write_text(json.dumps(without_marker))

            self.assertEqual(
                {pathlib.Path(item["targetPath"]).name for item in metadata},
                {"season.nfo", "tvshow.nfo"},
            )
            self.assertEqual(len(metadata), 4)
            with self.assertRaisesRegex(RuntimeError, "more than one title root"):
                module.collect_canonical_plan_targets(plain_path)


if __name__ == "__main__":
    unittest.main()
