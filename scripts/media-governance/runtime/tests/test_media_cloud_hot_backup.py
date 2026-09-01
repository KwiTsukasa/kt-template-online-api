#!/usr/bin/env python3
"""验证本地权威媒体包到 AList/Quark 热备的密封边界。"""

from __future__ import annotations

import hashlib
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).parents[1] / "media-cloud-hot-backup.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_cloud_hot_backup", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load media cloud hot backup")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaCloudHotBackupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temporary.name)
        self.media_root = self.root / "Media"
        for relative in ("movie/TV", "movie/Movies", "extras"):
            (self.media_root / relative).mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_inventory_contains_the_complete_recoverable_canonical_package(self) -> None:
        files = {
            "movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01/示例剧集 - S01E01.mkv": b"video",
            "movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01/示例剧集 - S01E01.ass": b"subtitle",
            "movie/TV/示例剧集 (2024) [tmdbid-1]/tvshow.nfo": b"metadata",
            "movie/Movies/示例电影 (2023) [tmdbid-2]/poster.jpg": b"artwork",
            "extras/示例剧集 (2024) [tmdbid-1]/PV/pv.mp4": b"extra",
        }
        for relative, content in files.items():
            path = self.media_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

        result = load_module().canonical_inventory(self.media_root)

        self.assertEqual(result["fileCount"], 5)
        self.assertEqual(result["videoCount"], 2)
        self.assertEqual(
            result["videoCountByRoot"],
            {"extras": 1, "movie/Movies": 0, "movie/TV": 1},
        )
        self.assertEqual(result["logicalBytes"], sum(map(len, files.values())))
        self.assertEqual(
            {row["targetPath"] for row in result["files"]},
            {
                "/Media/movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01/示例剧集 - S01E01.mkv",
                "/Media/movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01/示例剧集 - S01E01.ass",
                "/Media/movie/TV/示例剧集 (2024) [tmdbid-1]/tvshow.nfo",
                "/Media/movie/Movies/示例电影 (2023) [tmdbid-2]/poster.jpg",
                "/Media/movie/extras/示例剧集 (2024) [tmdbid-1]/PV/pv.mp4",
            },
        )

    def test_inventory_rejects_governance_staging_and_symbolic_links(self) -> None:
        unsafe = self.media_root / "movie/TV/.kt-canonical-staging-test"
        unsafe.mkdir()
        with self.assertRaisesRegex(RuntimeError, "unsafe name"):
            load_module().canonical_inventory(self.media_root)
        unsafe.rmdir()
        (self.media_root / "movie/TV/linked").symlink_to(self.media_root / "extras")
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            load_module().canonical_inventory(self.media_root)

    def test_ledger_requires_the_completed_bound_local_batch(self) -> None:
        module = load_module()
        ledger_path = self.root / "ledger.json"
        payload = {
            "authority": "fnos-local",
            "cloudVideoRoot": "/Media/movie",
            "executionOrder": "local-all-then-cloud-batch",
            "expectedItemCount": 2,
            "expectedVideoCount": 3,
            "items": [
                {"inventoryState": "local_reconciled", "videoCount": 1},
                {"inventoryState": "reconciled", "videoCount": 2},
            ],
            "localMediaRoot": "/vol2/1000/Media",
            "schemaVersion": "1.2.0",
        }
        ledger_path.write_text(json.dumps(payload), encoding="utf-8")
        digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()

        result = module.validate_ledger(ledger_path, digest, 2, 3)

        self.assertEqual(result["localReconciledItemCount"], 2)
        payload["items"][0]["inventoryState"] = "inventory_pending"
        ledger_path.write_text(json.dumps(payload), encoding="utf-8")
        changed_digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(RuntimeError, "unfinished"):
            module.validate_ledger(ledger_path, changed_digest, 2, 3)

    def test_preflight_rejects_a_package_below_the_ledger_baseline(self) -> None:
        module = load_module()
        path = self.media_root / "movie/TV/示例/S01E01.mkv"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"video")
        ledger_path = self.root / "ledger.json"
        payload = {
            "authority": "fnos-local",
            "cloudVideoRoot": "/Media/movie",
            "executionOrder": "local-all-then-cloud-batch",
            "expectedItemCount": 1,
            "expectedVideoCount": 2,
            "items": [{"inventoryState": "local_reconciled", "videoCount": 2}],
            "localMediaRoot": "/vol2/1000/Media",
            "schemaVersion": "1.2.0",
        }
        ledger_path.write_text(json.dumps(payload), encoding="utf-8")
        digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()

        with self.assertRaisesRegex(
            RuntimeError,
            r'actual=1 expectedMinimum=2 byRoot=\{"extras": 0, "movie/Movies": 0, "movie/TV": 1\}',
        ):
            module.preflight(
                evidence_root=self.root / "evidence",
                expected_item_count=1,
                expected_video_count=2,
                ledger_path=ledger_path,
                ledger_sha256=digest,
                local_media_root=self.media_root,
                output_path=self.root / "preflight.json",
                password="not-used-before-count-gate",
                run_id="test-count-mismatch",
            )

    def test_preflight_seals_supplementary_videos_outside_the_ledger_baseline(self) -> None:
        module = load_module()
        for relative in ("movie/TV/示例/S01E01.mkv", "extras/示例/PV.mp4"):
            path = self.media_root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"video")
        ledger_path = self.root / "ledger.json"
        payload = {
            "authority": "fnos-local",
            "cloudVideoRoot": "/Media/movie",
            "executionOrder": "local-all-then-cloud-batch",
            "expectedItemCount": 1,
            "expectedVideoCount": 1,
            "items": [{"inventoryState": "local_reconciled", "videoCount": 1}],
            "localMediaRoot": "/vol2/1000/Media",
            "schemaVersion": "1.2.0",
        }
        ledger_path.write_text(json.dumps(payload), encoding="utf-8")
        digest = hashlib.sha256(ledger_path.read_bytes()).hexdigest()

        class EmptyAlistClient:
            def __init__(self, _password: str):
                pass

            def close(self) -> None:
                pass

            def inventory(self) -> dict[str, object]:
                return {"fileCount": 0, "files": [], "logicalBytes": 0}

        module.AlistClient = EmptyAlistClient
        result = module.preflight(
            evidence_root=self.root / "evidence",
            expected_item_count=1,
            expected_video_count=1,
            ledger_path=ledger_path,
            ledger_sha256=digest,
            local_media_root=self.media_root,
            output_path=self.root / "preflight.json",
            password="fixture-password",
            run_id="test-supplementary-video",
        )

        self.assertTrue(result["canStart"])
        self.assertEqual(result["local"]["videoCount"], 2)
        self.assertEqual(result["supplementaryVideoCount"], 1)

    def test_inventory_comparison_fails_closed_on_every_kind_of_drift(self) -> None:
        module = load_module()
        local = {
            "files": [
                {"size": 10, "targetPath": "/Media/movie/TV/a.mkv"},
                {"size": 20, "targetPath": "/Media/movie/TV/a.ass"},
            ]
        }
        exact = {
            "files": [
                {"size": 20, "targetPath": "/Media/movie/TV/a.ass"},
                {"size": 10, "targetPath": "/Media/movie/TV/a.mkv"},
            ]
        }
        self.assertTrue(module.compare_inventories(local, exact)["accepted"])

        drifted = {
            "files": [
                {"size": 9, "targetPath": "/Media/movie/TV/a.mkv"},
                {"size": 1, "targetPath": "/Media/movie/unexpected.bin"},
            ]
        }
        result = module.compare_inventories(local, drifted)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["missingCount"], 1)
        self.assertEqual(result["mismatchedCount"], 1)
        self.assertEqual(result["unexpectedCount"], 1)
        self.assertEqual(
            result["mismatchedFiles"],
            [
                {
                    "actualSize": 9,
                    "expectedSize": 10,
                    "targetPath": "/Media/movie/TV/a.mkv",
                }
            ],
        )
        self.assertEqual(result["missingPaths"], ["/Media/movie/TV/a.ass"])
        self.assertEqual(result["unexpectedPaths"], ["/Media/movie/unexpected.bin"])
        self.assertEqual(
            result["unexpectedFiles"],
            [
                {
                    "providerPath": "/Media/movie/unexpected.bin",
                    "size": 1,
                    "targetPath": "/Media/movie/unexpected.bin",
                }
            ],
        )

    def test_alist_html_escaped_names_reconcile_to_the_canonical_path(self) -> None:
        module = load_module()
        client = object.__new__(module.AlistClient)
        client.list_directory = lambda _parent: [
            {
                "is_dir": False,
                "name": "Puss N&#39; Toots.mkv",
                "size": 100,
            }
        ]

        self.assertEqual(
            module._canonical_provider_name("Puss N&#39; Toots.mkv"),
            "Puss N' Toots.mkv",
        )
        self.assertEqual(
            client.file_observation(
                "/Media/movie/TV/example/Puss N' Toots.mkv"
            ),
            {"exists": True, "isDirectory": False, "size": 100},
        )

    def test_cloud_only_stale_files_do_not_block_missing_uploads(self) -> None:
        module = load_module()

        self.assertEqual(
            module.require_cloud_upload_compatibility(
                {"mismatchedCount": 0, "unexpectedCount": 3}
            ),
            3,
        )
        with self.assertRaisesRegex(RuntimeError, "2 conflicting files"):
            module.require_cloud_upload_compatibility(
                {"mismatchedCount": 2, "unexpectedCount": 0}
            )

    def test_reconciliation_accepts_only_numbered_same_size_duplicates(self) -> None:
        module = load_module()
        canonical = "/Media/movie/TV/example/Puss N' Toots.mkv"
        duplicate = "/Media/movie/TV/example/Puss N' Toots(1).mkv"
        local = {
            "digest": "a" * 64,
            "fileCount": 1,
            "files": [{"size": 100, "targetPath": canonical}],
            "logicalBytes": 100,
            "videoCount": 1,
        }
        cloud = {
            "digest": "b" * 64,
            "fileCount": 2,
            "files": [
                {
                    "providerPath": "/Media/movie/TV/example/Puss N&#39; Toots.mkv",
                    "size": 100,
                    "targetPath": canonical,
                },
                {
                    "providerPath": "/Media/movie/TV/example/Puss N&#39; Toots(1).mkv",
                    "size": 100,
                    "targetPath": duplicate,
                },
            ],
            "logicalBytes": 200,
        }

        result = module.build_reconciliation_contract(
            cloud=cloud,
            identity={"runId": "test-reconcile"},
            local=local,
        )

        self.assertEqual(result["staleFileCount"], 1)
        self.assertEqual(result["staleLogicalBytes"], 100)
        self.assertEqual(
            result["staleFiles"],
            [
                {
                    "canonicalTargetPath": canonical,
                    "duplicateIndex": 1,
                    "providerDirectory": "/Media/movie/TV/example",
                    "providerName": "Puss N&#39; Toots(1).mkv",
                    "providerPath": "/Media/movie/TV/example/Puss N&#39; Toots(1).mkv",
                    "size": 100,
                    "targetPath": duplicate,
                }
            ],
        )
        drifted = json.loads(json.dumps(cloud))
        drifted["files"][1]["providerPath"] = "/Media/movie/TV/example/unrelated.mkv"
        drifted["files"][1]["targetPath"] = "/Media/movie/TV/example/unrelated.mkv"
        with self.assertRaisesRegex(RuntimeError, "not a numbered file duplicate"):
            module.build_reconciliation_contract(
                cloud=drifted,
                identity={"runId": "test-reconcile"},
                local=local,
            )

    def test_alist_remove_uses_the_exact_provider_directory_and_names(self) -> None:
        module = load_module()
        client = object.__new__(module.AlistClient)
        calls: list[tuple[str, dict[str, object], int]] = []

        def request(
            route: str,
            body: dict[str, object],
            *,
            timeout: int,
        ) -> dict[str, object]:
            calls.append((route, body, timeout))
            return {"http": 200, "payload": {"code": 200}}

        client._json_request = request
        client.remove_files(
            "/Media/movie/TV/example",
            ["Puss N&#39; Toots(1).mkv", "Puss N&#39; Toots(2).mkv"],
        )

        self.assertEqual(
            calls,
            [
                (
                    "/api/fs/remove",
                    {
                        "dir": "/Media/movie/TV/example",
                        "names": [
                            "Puss N&#39; Toots(1).mkv",
                            "Puss N&#39; Toots(2).mkv",
                        ],
                    },
                    120,
                )
            ],
        )

    def test_reconciliation_seals_then_applies_the_same_inventory(self) -> None:
        module = load_module()
        evidence_root = self.root / "evidence"
        run_id = "test-reconcile-apply"
        canonical = "/Media/movie/TV/example/Puss N' Toots.mkv"
        duplicate = "/Media/movie/TV/example/Puss N' Toots(1).mkv"
        local = {
            "digest": "a" * 64,
            "fileCount": 1,
            "files": [{"size": 100, "targetPath": canonical}],
            "logicalBytes": 100,
            "videoCount": 1,
        }
        cloud = {
            "digest": "b" * 64,
            "fileCount": 2,
            "files": [
                {
                    "providerPath": "/Media/movie/TV/example/Puss N&#39; Toots.mkv",
                    "size": 100,
                    "targetPath": canonical,
                },
                {
                    "providerPath": "/Media/movie/TV/example/Puss N&#39; Toots(1).mkv",
                    "size": 100,
                    "targetPath": duplicate,
                },
            ],
            "logicalBytes": 200,
        }

        class FakeAlistClient:
            current = json.loads(json.dumps(cloud))
            remove_calls: list[tuple[str, list[str]]] = []

            def __init__(self, _password: str):
                pass

            def close(self) -> None:
                pass

            def inventory(self) -> dict[str, object]:
                return json.loads(json.dumps(self.current))

            def remove_files(self, directory: str, names: list[str]) -> None:
                self.remove_calls.append((directory, names))
                name_set = set(names)
                self.current["files"] = [
                    row
                    for row in self.current["files"]
                    if not (
                        str(Path(row["providerPath"]).parent) == directory
                        and Path(row["providerPath"]).name in name_set
                    )
                ]
                self.current["fileCount"] = len(self.current["files"])
                self.current["logicalBytes"] = sum(
                    row["size"] for row in self.current["files"]
                )
                self.current["digest"] = "c" * 64

        module.AlistClient = FakeAlistClient
        common = {
            "evidence_root": evidence_root,
            "expected_item_count": 61,
            "expected_video_count": 1,
            "ledger_path": self.root / "ledger.json",
            "ledger_sha256": "d" * 64,
            "local_media_root": self.media_root,
            "password": "fixture-password",
            "preflight_path": self.root / "preflight.json",
            "preflight_sha256": "e" * 64,
            "run_id": run_id,
        }
        with (
            mock.patch.object(module, "_load_preflight", return_value={}),
            mock.patch.object(module, "validate_ledger", return_value={}),
            mock.patch.object(module, "canonical_inventory", return_value=local),
        ):
            sealed = module.seal_reconciliation_plan(**common)
            applied = module.apply_reconciliation_plan(
                **common,
                reconciliation_sha256=sealed["evidenceSha256"],
            )

        self.assertEqual(
            FakeAlistClient.remove_calls,
            [
                (
                    "/Media/movie/TV/example",
                    ["Puss N&#39; Toots(1).mkv"],
                )
            ],
        )
        self.assertEqual(applied["removedFileCount"], 1)
        self.assertEqual(applied["removedLogicalBytes"], 100)
        self.assertRegex(applied["receiptSha256"], r"^[0-9a-f]{64}$")
        receipt = json.loads(
            Path(applied["receiptPath"]).read_text(encoding="utf-8")
        )
        self.assertEqual(receipt["state"], "cloud-hot-backup-reconciled")
        self.assertEqual(receipt["writeBoundaries"]["localMedia"], 0)

    def test_reconciliation_apply_rejects_unsealed_cloud_drift(self) -> None:
        module = load_module()
        evidence_root = self.root / "evidence"
        run_id = "test-reconcile-drift"
        canonical = "/Media/movie/TV/example/episode.mkv"
        duplicate = "/Media/movie/TV/example/episode(1).mkv"
        local = {
            "digest": "a" * 64,
            "fileCount": 1,
            "files": [{"size": 100, "targetPath": canonical}],
            "logicalBytes": 100,
            "videoCount": 1,
        }
        safe_cloud = {
            "digest": "b" * 64,
            "fileCount": 2,
            "files": [
                {"providerPath": canonical, "size": 100, "targetPath": canonical},
                {"providerPath": duplicate, "size": 100, "targetPath": duplicate},
            ],
            "logicalBytes": 200,
        }

        class DriftedAlistClient:
            current = json.loads(json.dumps(safe_cloud))

            def __init__(self, _password: str):
                pass

            def close(self) -> None:
                pass

            def inventory(self) -> dict[str, object]:
                return json.loads(json.dumps(self.current))

            def remove_files(self, _directory: str, _names: list[str]) -> None:
                raise AssertionError("drifted inventory must not be deleted")

        module.AlistClient = DriftedAlistClient
        common = {
            "evidence_root": evidence_root,
            "expected_item_count": 61,
            "expected_video_count": 1,
            "ledger_path": self.root / "ledger.json",
            "ledger_sha256": "d" * 64,
            "local_media_root": self.media_root,
            "password": "fixture-password",
            "preflight_path": self.root / "preflight.json",
            "preflight_sha256": "e" * 64,
            "run_id": run_id,
        }
        with (
            mock.patch.object(module, "_load_preflight", return_value={}),
            mock.patch.object(module, "validate_ledger", return_value={}),
            mock.patch.object(module, "canonical_inventory", return_value=local),
        ):
            sealed = module.seal_reconciliation_plan(**common)
            DriftedAlistClient.current["files"].append(
                {
                    "providerPath": "/Media/movie/TV/example/unsealed.bin",
                    "size": 1,
                    "targetPath": "/Media/movie/TV/example/unsealed.bin",
                }
            )
            DriftedAlistClient.current["fileCount"] = 3
            DriftedAlistClient.current["logicalBytes"] = 201
            DriftedAlistClient.current["digest"] = "f" * 64
            with self.assertRaisesRegex(RuntimeError, "outside the sealed plan"):
                module.apply_reconciliation_plan(
                    **common,
                    reconciliation_sha256=sealed["evidenceSha256"],
                )

    def test_upload_retry_accepts_an_ambiguous_error_when_the_file_landed(self) -> None:
        module = load_module()

        class AmbiguousClient:
            def __init__(self) -> None:
                self.upload_calls = 0

            def upload(self, _source_path: Path, _target_path: str) -> None:
                self.upload_calls += 1
                raise RuntimeError("AList upload failed with code 500: inner error")

            def wait_for_file(self, _target_path: str, _expected_size: int) -> bool:
                return True

        client = AmbiguousClient()
        sleeps: list[float] = []

        attempts = module.upload_with_retry(
            client,
            self.root / "episode.mkv",
            "/Media/movie/TV/example/episode.mkv",
            100,
            sleep=sleeps.append,
        )

        self.assertEqual(attempts, 1)
        self.assertEqual(client.upload_calls, 1)
        self.assertEqual(sleeps, [])

    def test_upload_retry_retries_an_absent_file_with_bounded_backoff(self) -> None:
        module = load_module()

        class TransientClient:
            def __init__(self) -> None:
                self.upload_calls = 0
                self.wait_calls = 0

            def upload(self, _source_path: Path, _target_path: str) -> None:
                self.upload_calls += 1
                if self.upload_calls == 1:
                    raise RuntimeError("AList upload failed with code 500: inner error")

            def wait_for_file(self, _target_path: str, _expected_size: int) -> bool:
                self.wait_calls += 1
                return self.wait_calls == 2

        client = TransientClient()
        sleeps: list[float] = []

        attempts = module.upload_with_retry(
            client,
            self.root / "episode.mkv",
            "/Media/movie/TV/example/episode.mkv",
            100,
            attempts=3,
            retry_delay_seconds=15,
            sleep=sleeps.append,
        )

        self.assertEqual(attempts, 2)
        self.assertEqual(client.upload_calls, 2)
        self.assertEqual(client.wait_calls, 2)
        self.assertEqual(sleeps, [15])

    def test_upload_retry_stops_after_the_declared_attempt_limit(self) -> None:
        module = load_module()

        class FailingClient:
            def __init__(self) -> None:
                self.upload_calls = 0

            def upload(self, _source_path: Path, _target_path: str) -> None:
                self.upload_calls += 1
                raise RuntimeError("persistent upstream error")

            def wait_for_file(self, _target_path: str, _expected_size: int) -> bool:
                return False

        client = FailingClient()
        sleeps: list[float] = []

        with self.assertRaisesRegex(RuntimeError, "persistent upstream error"):
            module.upload_with_retry(
                client,
                self.root / "episode.mkv",
                "/Media/movie/TV/example/episode.mkv",
                100,
                attempts=3,
                retry_delay_seconds=15,
                sleep=sleeps.append,
            )

        self.assertEqual(client.upload_calls, 3)
        self.assertEqual(sleeps, [15, 30])

    def test_wait_for_file_keeps_polling_until_the_exact_size_converges(self) -> None:
        module = load_module()
        client = object.__new__(module.AlistClient)
        observations = iter(
            (
                [{"is_dir": False, "name": "episode.mkv", "size": 50}],
                [{"is_dir": False, "name": "episode.mkv", "size": 100}],
            )
        )
        client.list_directory = lambda _parent: next(observations)

        with mock.patch.object(module.time, "sleep") as sleep:
            self.assertTrue(
                client.wait_for_file(
                    "/Media/movie/TV/example/episode.mkv",
                    100,
                )
            )

        sleep.assert_called_once_with(2)

    def test_upload_retry_reports_the_exact_nonconverged_object(self) -> None:
        module = load_module()

        class NonconvergedClient:
            def upload(self, _source_path: Path, _target_path: str) -> None:
                return None

            def wait_for_file(self, _target_path: str, _expected_size: int) -> bool:
                return False

            def file_observation(self, _target_path: str) -> dict[str, object]:
                return {"exists": True, "isDirectory": False, "size": 97}

        with self.assertRaisesRegex(
            RuntimeError,
            r"targetPath=/Media/movie/TV/example/episode\.mkv:expectedSize=100:actualSize=97",
        ):
            module.upload_with_retry(
                NonconvergedClient(),
                self.root / "episode.mkv",
                "/Media/movie/TV/example/episode.mkv",
                100,
                attempts=1,
                sleep=lambda _seconds: None,
            )

    def test_upload_stream_is_rate_limited(self) -> None:
        module = load_module()

        class Connection:
            def __init__(self) -> None:
                self.chunks: list[bytes] = []

            def send(self, chunk: bytes) -> None:
                self.chunks.append(chunk)

        connection = Connection()
        monotonic_values = iter((0.0, 0.0, 1.0))
        sleeps: list[float] = []
        sent = module.send_file_with_rate_limit(
            connection,
            io.BytesIO(b"abcdefgh"),
            bytes_per_second=4,
            chunk_bytes=4,
            monotonic=lambda: next(monotonic_values),
            sleep=sleeps.append,
        )

        self.assertEqual(sent, 8)
        self.assertEqual(connection.chunks, [b"abcd", b"efgh"])
        self.assertEqual(sleeps, [1.0, 1.0])

    def test_upload_stream_is_unlimited_by_default(self) -> None:
        module = load_module()

        class Connection:
            def __init__(self) -> None:
                self.chunks: list[bytes] = []

            def send(self, chunk: bytes) -> None:
                self.chunks.append(chunk)

        connection = Connection()
        monotonic = mock.Mock(side_effect=AssertionError("unlimited upload must not pace"))
        sleep = mock.Mock(side_effect=AssertionError("unlimited upload must not sleep"))

        sent = module.send_file_with_rate_limit(
            connection,
            io.BytesIO(b"abcdefgh"),
            chunk_bytes=4,
            monotonic=monotonic,
            sleep=sleep,
        )

        self.assertEqual(sent, 8)
        self.assertEqual(connection.chunks, [b"abcd", b"efgh"])
        monotonic.assert_not_called()
        sleep.assert_not_called()

    def test_unthrottled_policy_keeps_normal_priority(self) -> None:
        module = load_module()

        with mock.patch.object(module.os, "getpriority", return_value=0):
            policy = module.unthrottled_resource_policy()

        self.assertEqual(
            policy,
            {
                "cpuNice": 0,
                "ioClass": "default",
                "uploadRateLimitBytesPerSecond": None,
            },
        )

    def test_resume_inventory_snapshot_is_immutable_and_reusable(self) -> None:
        module = load_module()
        paths = module.evidence_paths(self.root / "evidence", "test-hot-update")
        paths["directory"].mkdir(parents=True)
        identity = {
            "ledgerSha256": "a" * 64,
            "preflightSha256": "b" * 64,
            "runId": "test-hot-update",
        }
        local = {
            "digest": "c" * 64,
            "directoryCount": 3,
            "fileCount": 8,
            "logicalBytes": 1024,
            "videoCount": 2,
            "videoCountByRoot": {
                "extras": 0,
                "movie/Movies": 0,
                "movie/TV": 2,
            },
        }

        first = module.seal_resume_inventory_snapshot(paths, identity, local)
        second = module.seal_resume_inventory_snapshot(paths, identity, local)

        self.assertEqual(first, second)
        self.assertEqual(first["digest"], local["digest"])
        self.assertRegex(first["sha256"], r"^[0-9a-f]{64}$")
        snapshot = json.loads(Path(first["path"]).read_text(encoding="utf-8"))
        self.assertEqual(
            snapshot["state"],
            "cloud-hot-backup-resume-inventory-sealed",
        )
        self.assertEqual(snapshot["writeBoundaries"]["cloud"], 0)

    def test_start_worker_does_not_report_a_stale_failed_state(self) -> None:
        module = load_module()
        evidence_root = self.root / "evidence"
        run_id = "test-resume-existing-state"
        paths = module.evidence_paths(evidence_root, run_id)
        paths["directory"].mkdir(parents=True)
        paths["state"].write_text(
            json.dumps({"phase": "failed", "pid": 99}),
            encoding="utf-8",
        )
        monotonic_values = iter((0.0, 1.0, 21.0))

        with (
            mock.patch.object(module.os, "fork", return_value=1234),
            mock.patch.object(module.time, "monotonic", side_effect=monotonic_values),
            mock.patch.object(module.time, "sleep"),
        ):
            result = module.start_worker(
                evidence_root=evidence_root,
                expected_item_count=1,
                expected_video_count=1,
                ledger_path=self.root / "ledger.json",
                ledger_sha256="a" * 64,
                local_media_root=self.media_root,
                password="fixture-password",
                preflight_path=self.root / "preflight.json",
                preflight_sha256="b" * 64,
                run_id=run_id,
            )

        self.assertEqual(result["phase"], "starting")
        self.assertEqual(result["pid"], 1234)
        self.assertTrue(result["started"])


if __name__ == "__main__":
    unittest.main()
