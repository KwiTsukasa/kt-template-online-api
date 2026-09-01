#!/usr/bin/env python3
"""隔离字幕获取器的路径、语种与完整季载荷门禁测试。"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-subtitle-acquisition.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_subtitle_acquisition", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media subtitle acquisition script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaSubtitleAcquisitionTest(unittest.TestCase):
    def test_prunes_only_empty_staging_ancestors_below_fixed_parent(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "staging"
            leaf = parent / "run" / "sources"
            leaf.mkdir(parents=True)

            module.prune_empty_ancestors(leaf, parent)

            self.assertTrue(parent.is_dir())
            self.assertFalse((parent / "run").exists())
            outside = Path(directory) / "outside"
            outside.mkdir()
            link = parent / "linked"
            link.symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                module.prune_empty_ancestors(link, parent)

    def test_binds_external_acceptance_to_the_same_work_item_and_source_hash(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            module.EVIDENCE_PARENT = Path(directory) / "evidence"
            acceptance = (
                module.EVIDENCE_PARENT
                / "media-057-local-closeout-v1"
                / "media-057-acceptance.json"
            )
            acceptance.parent.mkdir(parents=True)
            info_hash = "0123456789abcdef0123456789abcdef01234567"
            payload = {
                "deleteFileCount": 0,
                "state": "local-batch-accepted",
                "subtitleFileCount": 12,
                "subtitleSourceInfoHashes": [info_hash],
                "workItemIds": ["media-057"],
            }
            acceptance.write_text(json.dumps(payload), encoding="utf-8")
            contract = {
                "infoHash": info_hash,
                "selectedFiles": [{"episode": 1}],
                "workItemId": "media-057",
            }

            result = module.validate_acceptance_evidence(
                acceptance, module.sha256(acceptance), contract
            )

            self.assertEqual(result["state"], "local-batch-accepted")
            payload["subtitleSourceInfoHashes"] = []
            acceptance.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "source identity"):
                module.validate_acceptance_evidence(
                    acceptance, module.sha256(acceptance), contract
                )

    def test_binds_each_candidate_to_hash_scoped_contract_and_runtime_paths(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            module.EVIDENCE_PARENT = root / "evidence"
            module.STAGING_PARENT = root / "staging"
            module.PROFILE_PARENT = root / "profiles"
            run_id = "remaining-two-20260810-v1"
            work_item = "media-057"
            season = 2
            info_hash = "0123456789abcdef0123456789abcdef01234567"
            evidence_root = module.EVIDENCE_PARENT / run_id
            evidence_root.mkdir(parents=True)
            candidate = f"{work_item}-s02-{info_hash}"
            contract_path = evidence_root / f"{candidate}-subtitle-acquisition-contract.json"
            staging = module.STAGING_PARENT / run_id / "sources" / candidate
            run_digest = module.hashlib.sha256(run_id.encode("utf-8")).hexdigest()[:8]
            profile = module.PROFILE_PARENT / f"{work_item}-s02-{info_hash[:12]}-{run_digest}"
            contract = {
                "evidenceRoot": str(evidence_root),
                "infoHash": info_hash,
                "inventoryPath": str(evidence_root / f"{work_item}-local-inventory.json"),
                "inventoryRunId": run_id,
                "inventorySha256": "a" * 64,
                "paths": {
                    "acceptanceEvidence": str(evidence_root / f"{work_item}-acceptance.json"),
                    "cleanupEvidence": str(evidence_root / f"{candidate}-subtitle-acquisition-cleanup.json"),
                    "contract": str(contract_path),
                    "progressEvidence": str(evidence_root / f"{candidate}-subtitle-acquisition-progress.json"),
                    "resultEvidence": str(evidence_root / f"{candidate}-subtitle-acquisition-result.json"),
                    "runtimeLog": str(evidence_root / f"{candidate}-subtitle-acquisition-runtime.log"),
                    "stagingRoot": str(staging),
                },
                "profileRoot": str(profile),
                "schemaVersion": "media-subtitle-acquisition-contract-v1",
                "season": season,
                "selectedFiles": [
                    {"episode": 1, "index": 4, "path": "Season 02/E01.sc.ass"}
                ],
                "sourceUri": f"magnet:?xt=urn:btih:{info_hash}",
                "sourceUriKind": "magnet",
                "videoDownloadCount": 0,
                "workItemId": work_item,
            }
            contract_path.write_text(json.dumps(contract), encoding="utf-8")

            loaded = module.load_contract(contract_path)

            self.assertEqual(loaded["profileRoot"], str(profile))
            self.assertEqual(loaded["paths"]["stagingRoot"], str(staging))

    def test_accepts_only_safe_subtitle_relative_paths(self):
        module = load_module()

        self.assertEqual(module.safe_relative("Season 02/E01.sc.ass"), "Season 02/E01.sc.ass")
        for unsafe in ("../E01.ass", "/tmp/E01.srt", "Season 02/E01.mkv"):
            with self.subTest(unsafe=unsafe), self.assertRaises(RuntimeError):
                module.safe_relative(unsafe)

    def test_normalizes_only_qbittorrents_single_root_marker(self):
        module = load_module()

        self.assertEqual(
            module.safe_qbt_torrent_path("/CDs/OST/file.wav"),
            "CDs/OST/file.wav",
        )
        self.assertEqual(
            module.safe_qbt_torrent_path("Season 01/E01.ass"),
            "Season 01/E01.ass",
        )
        for unsafe in ("//etc/passwd", "/../escape.ass", "/"):
            with self.subTest(unsafe=unsafe), self.assertRaises(RuntimeError):
                module.safe_qbt_torrent_path(unsafe)

    def test_accepts_only_fixed_source_uris_bound_to_the_candidate(self):
        module = load_module()
        info_hash = "0123456789abcdef0123456789abcdef01234567"

        self.assertEqual(
            module.safe_source_uri(
                f"https://mikanani.kas.pub/Download/20220101/{info_hash}.torrent",
                info_hash,
            ),
            f"https://mikanani.kas.pub/Download/20220101/{info_hash}.torrent",
        )
        self.assertEqual(
            module.safe_source_uri("https://nyaa.si/download/12345.torrent", info_hash),
            "https://nyaa.si/download/12345.torrent",
        )
        for unsafe in (
            f"https://example.invalid/Download/20220101/{info_hash}.torrent",
            "https://nyaa.si/download/not-a-number.torrent",
            "https://nyaa.si/download/12345.torrent?redirect=1",
        ):
            with self.subTest(unsafe=unsafe), self.assertRaises(RuntimeError):
                module.safe_source_uri(unsafe, info_hash)

    def test_removes_a_descriptor_task_when_qbittorrent_reports_another_hash(self):
        module = load_module()
        expected = "0123456789abcdef0123456789abcdef01234567"
        actual = "89abcdef0123456789abcdef0123456789abcdef"
        removed = []

        class FakeApi:
            def json(self, endpoint):
                self.assert_endpoint = endpoint
                return [{"hash": actual}]

        module.remove_exact_task = lambda _api, info_hash, delete_files: removed.append(
            (info_hash, delete_files)
        )
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            module.exact_task_rows(FakeApi(), expected)
        self.assertEqual(removed, [(actual, True)])

    def test_requires_timed_simplified_chinese_subtitles(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            accepted = Path(directory) / "accepted.srt"
            accepted.write_text(
                "1\n00:00:01,000 --> 00:00:03,000\n这是没有问题的简体字幕。\n",
                encoding="utf-8",
            )
            rejected = Path(directory) / "rejected.srt"
            rejected.write_text(
                "1\n00:00:01,000 --> 00:00:03,000\n這是繁體字幕。\n",
                encoding="utf-8",
            )
            non_positive = Path(directory) / "non-positive.srt"
            non_positive.write_text(
                "1\n00:00:03,000 --> 00:00:01,000\n这是错误时间轴。\n\n"
                "2\n00:00:04,000 --> 00:00:06,000\n这是正常时间轴。\n",
                encoding="utf-8",
            )
            zero_sentinel = Path(directory) / "zero-sentinel.ass"
            zero_sentinel.write_text(
                "[Events]\n"
                "Dialogue: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,,哨兵\n"
                "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,这是正常简体字幕。\n",
                encoding="utf-8",
            )
            nonzero_zero = Path(directory) / "nonzero-zero.ass"
            nonzero_zero.write_text(
                "[Events]\n"
                "Dialogue: 0,0:00:04.00,0:00:04.00,Default,,0,0,0,,这是错误时间轴。\n",
                encoding="utf-8",
            )

            self.assertEqual(module.subtitle_summary(accepted)["cueCount"], 1)
            sentinel_summary = module.subtitle_summary(zero_sentinel)
            self.assertEqual(sentinel_summary["cueCount"], 2)
            self.assertEqual(sentinel_summary["ignoredZeroSentinelCueCount"], 1)
            self.assertEqual(sentinel_summary["nonPositiveCueCount"], 0)
            with self.assertRaisesRegex(RuntimeError, "Simplified Chinese"):
                module.subtitle_summary(rejected)
            with self.assertRaises(module.SubtitleCueBoundaryError) as captured:
                module.subtitle_summary(non_positive)
            self.assertEqual(
                captured.exception.evidence,
                {
                    "cueCount": 2,
                    "nonPositiveCueCount": 1,
                    "samples": [{"endSeconds": 1.0, "startSeconds": 3.0}],
                },
            )
            with self.assertRaises(module.SubtitleCueBoundaryError):
                module.subtitle_summary(nonzero_zero)

    def test_summarizes_metadata_only_after_all_payload_priorities_are_zero(self):
        module = load_module()
        contract = {
            "infoHash": "0123456789abcdef0123456789abcdef01234567",
            "season": 2,
            "workItemId": "media-057",
        }
        rows = [
            {
                "index": 0,
                "name": "Season 02/E01.mkv",
                "priority": 0,
                "progress": 0,
                "size": 1_000_000,
            },
            {
                "index": 1,
                "name": "Season 02/E01.sc.ass",
                "priority": 0,
                "progress": 0,
                "size": 80_000,
            },
        ]

        evidence = module.summarize_metadata_rows(contract, rows, 0)

        self.assertEqual(evidence["fileCount"], 2)
        self.assertEqual(evidence["videoFileCount"], 1)
        self.assertEqual(
            evidence["subtitleFiles"],
            [{"index": 1, "path": "Season 02/E01.sc.ass", "size": 80_000}],
        )
        self.assertEqual(evidence["payloadDownloadedBytes"], 0)
        self.assertEqual(evidence["videoDownloadCount"], 0)

        rows[0]["progress"] = 0.01
        with self.assertRaisesRegex(RuntimeError, "payload"):
            module.summarize_metadata_rows(contract, rows, 1)

    def test_seals_file_level_evidence_for_unselected_video_progress(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory) / "payload"
            video = staging / "Season 01" / "E01.mkv"
            video.parent.mkdir(parents=True)
            video.write_bytes(b"boundary-piece")
            rows = [
                {
                    "index": 0,
                    "name": "/Season 01/E01.mkv",
                    "piece_range": [10, 11],
                    "priority": 0,
                    "progress": 0.0001,
                    "size": 1_000_000,
                },
                {
                    "index": 1,
                    "name": "/Season 01/E01.sc.ass",
                    "piece_range": [11, 11],
                    "priority": 1,
                    "progress": 1,
                    "size": 80_000,
                },
            ]

            evidence = module.video_payload_evidence(rows, staging, 120_000)

            self.assertEqual(evidence["taskDownloadedBytes"], 120_000)
            self.assertEqual(evidence["triggeredVideoCount"], 1)
            self.assertEqual(evidence["truncatedVideoCount"], 0)
            self.assertEqual(
                evidence["materializedVideoBytes"], len(b"boundary-piece")
            )
            self.assertEqual(
                evidence["rows"],
                [
                    {
                        "existingBytes": len(b"boundary-piece"),
                        "index": 0,
                        "path": "Season 01/E01.mkv",
                        "pieceRange": [10, 11],
                        "priority": 0,
                        "progress": 0.0001,
                        "size": 1_000_000,
                    }
                ],
            )
            with self.assertRaisesRegex(RuntimeError, "unselected video payload"):
                module.enforce_video_payload_boundary(evidence)

            video.unlink()
            progress_only = module.video_payload_evidence(rows, staging, 120_000)
            self.assertEqual(progress_only["materializedVideoBytes"], 0)
            module.enforce_video_payload_boundary(progress_only)

    def test_seals_bounded_staging_layout_for_a_missing_selected_file(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory) / "payload"
            actual = staging / ".unwanted" / "Season 01" / "E01.sc.ass.!qB"
            actual.parent.mkdir(parents=True)
            actual.write_bytes(b"partial")
            selected = {
                "episode": 1,
                "index": 1,
                "path": "Season 01/E01.sc.ass",
            }
            row = {"index": 1, "name": "/Season 01/E01.sc.ass", "size": 80_000}

            evidence = module.selected_payload_layout_evidence(
                staging, selected, row
            )

            self.assertEqual(evidence["episode"], 1)
            self.assertEqual(evidence["index"], 1)
            self.assertEqual(evidence["rawPath"], "/Season 01/E01.sc.ass")
            self.assertEqual(evidence["normalizedPath"], "Season 01/E01.sc.ass")
            self.assertEqual(evidence["expectedSize"], 80_000)
            self.assertEqual(
                evidence["files"],
                [
                    {
                        "path": ".unwanted/Season 01/E01.sc.ass.!qB",
                        "size": len(b"partial"),
                    }
                ],
            )
            self.assertFalse(evidence["truncated"])

    def test_accepts_only_a_real_single_level_qbittorrent_content_root(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory) / "payload"
            content_root = staging / "torrent-root"
            content_root.mkdir(parents=True)

            self.assertEqual(
                module.qbt_content_root(
                    {
                        "content_path": str(content_root),
                        "save_path": f"{staging}/",
                    },
                    staging,
                ),
                content_root.resolve(strict=True),
            )
            for unsafe in (
                staging,
                staging / "nested" / "root",
                Path(directory) / "outside",
            ):
                unsafe.mkdir(parents=True, exist_ok=True)
                with self.subTest(unsafe=unsafe), self.assertRaises(RuntimeError):
                    module.qbt_content_root(
                        {
                            "content_path": str(unsafe),
                            "save_path": f"{staging}/",
                        },
                        staging,
                    )

    def test_reports_metadata_probe_evidence_without_starting_another_runtime(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "metadata.json"
            evidence.write_text(
                json.dumps({"status": "metadata-ready", "subtitleFileCount": 12}),
                encoding="utf-8",
            )
            contract = {
                "infoHash": "0123456789abcdef0123456789abcdef01234567",
                "paths": {"metadataEvidence": str(evidence)},
                "profileRoot": str(root / "profile"),
                "workItemId": "media-057",
            }
            module.isolated_processes = lambda _profile: []

            status = module.probe_status(contract)

            self.assertEqual(status["state"], "result")
            self.assertEqual(status["payload"]["subtitleFileCount"], 12)
            self.assertEqual(status["processCount"], 0)

    def test_seals_exact_complete_season_without_video_payloads(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staging = root / "payload"
            content_root = staging / "torrent-root"
            content_root.mkdir(parents=True)
            inventory_path = root / "inventory.json"
            videos = []
            database_rows = []
            selected_files = []
            torrent_rows = []
            for episode in (1, 2):
                relative = f"Season 02/E{episode:02d}.sc.srt"
                subtitle = content_root / relative
                subtitle.parent.mkdir(parents=True, exist_ok=True)
                subtitle.write_text(
                    f"1\n00:00:01,000 --> 00:00:03,000\n这是第 {episode} 集字幕。\n",
                    encoding="utf-8",
                )
                video_path = f"/vol2/1000/Media/movie/title/Title - S02E{episode:02d}.mkv"
                videos.append({"path": video_path})
                database_rows.append(
                    {
                        "episode_number": episode,
                        "parent_season": 2,
                        "path": video_path,
                    }
                )
                selected_files.append(
                    {"episode": episode, "index": episode - 1, "path": relative}
                )
                torrent_rows.append(
                    {
                        "index": episode - 1,
                        "name": f"/{relative}",
                        "size": subtitle.stat().st_size,
                    }
                )
            inventory_path.write_text(
                json.dumps(
                    {"database": {"rows": database_rows}, "files": {"videos": videos}}
                ),
                encoding="utf-8",
            )
            contract = {
                "infoHash": "0123456789abcdef0123456789abcdef01234567",
                "inventoryPath": str(inventory_path),
                "inventorySha256": "a" * 64,
                "paths": {"stagingRoot": str(staging)},
                "season": 2,
                "selectedFiles": selected_files,
                "sourceGroup": "group",
                "workItemId": "media-057",
            }

            evidence = module.verify_payload(contract, torrent_rows, content_root)

            self.assertEqual(evidence["episodeCoverage"], [1, 2])
            self.assertEqual(evidence["subtitleCount"], 2)
            self.assertEqual(evidence["inventorySha256"], "a" * 64)
            self.assertEqual(evidence["videoDownloadCount"], 0)
            self.assertEqual(evidence["mutationBoundaries"]["mediaVideoDownloads"], 0)


if __name__ == "__main__":
    unittest.main()
