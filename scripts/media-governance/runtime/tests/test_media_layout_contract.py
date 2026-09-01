#!/usr/bin/env python3
"""验证媒体目录全局收敛合同。"""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-layout-contract.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_layout_contract", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load media layout contract")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLayoutContractTest(unittest.TestCase):
    def test_reports_written_layout_evidence_digest(self):
        module = load_module()
        output = Path(self.temporary.name) / "layout.json"
        payload = {"status": "media-layout-contract-passed"}
        module.write_json_exclusive(output, payload)

        result = module.evidence_result_summary(payload, output)

        self.assertEqual(result["evidenceSha256"], module.sha256_file(output))

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temporary.name)
        self.media_root = self.root / "vol2/1000/Media"
        self.movie_root = self.media_root / "movie"
        self.staging_parent = self.root / "vol2/1000/.kt-media-governance-staging"
        self.rollback_parent = self.root / "vol2/1000/.kt-media-governance-rollback"
        for path in (
            self.movie_root / "TV",
            self.movie_root / "Movies",
            self.media_root / "incoming/quark",
            self.media_root / "extras",
            self.media_root / "cache",
            self.media_root / "img",
            self.media_root / "index",
            self.media_root / "subtitle",
            self.staging_parent,
            self.rollback_parent,
        ):
            path.mkdir(parents=True, exist_ok=True)
        for name in ("cache", "img", "index", "subtitle"):
            (self.media_root / name).chmod(0o700)
        self.staging_parent.chmod(0o700)
        self.rollback_parent.chmod(0o700)
        self.pending_path = self.movie_root / "pending-title"
        self.closed_path = self.movie_root / "closed-title"
        self.ledger_path = self.root / "ledger.json"
        self.write_ledger()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_ledger(self) -> None:
        self.ledger_path.write_text(
            json.dumps(
                {
                    "localMediaRoot": str(self.media_root),
                    "localTitleRoot": str(self.movie_root),
                    "items": [
                        {
                            "inventoryState": "inventory_pending",
                            "sourcePath": str(self.pending_path),
                            "workItemId": "media-027",
                        },
                        {
                            "inventoryState": "local_reconciled",
                            "sourcePath": str(self.closed_path),
                            "workItemId": "media-026",
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )

    def audit(self):
        module = load_module()
        return module.audit_layout(
            expected_gid=os.getgid(),
            expected_uid=os.getuid(),
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            rollback_parent=self.rollback_parent,
            staging_parent=self.staging_parent,
        )

    def test_accepts_only_pending_legacy_roots_and_active_external_staging(self) -> None:
        self.pending_path.mkdir()
        (self.movie_root / "TV/示例剧集 (2024) [tmdbid-1]").mkdir()
        (self.movie_root / "Movies/示例电影 (2024) [tmdbid-2]").mkdir()
        (self.staging_parent / "media-027-title-v1").mkdir()
        (self.rollback_parent / "media-026-title-original-v1").mkdir()

        result = self.audit()

        self.assertEqual(
            result["status"], "media-layout-contract-passed", result["issues"]
        )
        self.assertEqual(result["issueCount"], 0)
        self.assertEqual(result["pendingLegacyRootCount"], 1)
        self.assertEqual(result["activeStagingWorkItems"], ["media-027"])

    def test_rejects_completed_roots_and_watched_tree_workflow_artifacts(self) -> None:
        self.pending_path.mkdir()
        self.closed_path.mkdir()
        (self.media_root / ".kt-media-originals").mkdir()
        (self.media_root / "extras/legacy-media").mkdir()
        (self.movie_root / ".kt-canonical-staging-media-001-v1").mkdir()
        (self.movie_root / "错层电影 (2021) [tmdbid-3]").mkdir()
        (self.staging_parent / "media-026-stale-v1").mkdir()

        result = self.audit()
        codes = {issue["code"] for issue in result["issues"]}

        self.assertEqual(result["status"], "media-layout-contract-failed")
        self.assertIn("closed-source-root-present", codes)
        self.assertIn("forbidden-watched-tree-directory", codes)
        self.assertIn("unexpected-movie-root", codes)
        self.assertIn("closed-staging-present", codes)

    def test_rejects_missing_pending_source_and_noncanonical_formal_title(self) -> None:
        (self.movie_root / "TV/not-canonical").mkdir()
        (self.media_root / "cache").rmdir()

        result = self.audit()
        codes = {issue["code"] for issue in result["issues"]}

        self.assertIn("pending-source-root-missing", codes)
        self.assertIn("noncanonical-formal-title", codes)
        self.assertIn("missing-system-media-root", codes)

    def test_dry_runs_and_removes_only_empty_closed_staging_from_failed_evidence(self) -> None:
        module = load_module()
        closed = self.staging_parent / "media-026-finished-v1"
        (closed / "sources").mkdir(parents=True)
        failed_path = self.root / "failed-layout.json"
        failed = {
            "issueCount": 1,
            "issues": [{"code": "closed-staging-present", "path": str(closed)}],
            "issuesTruncated": False,
            "status": "media-layout-contract-failed",
        }
        failed_path.write_text(json.dumps(failed), encoding="utf-8")
        failed_sha = hashlib.sha256(failed_path.read_bytes()).hexdigest()
        output = self.root / "cleanup.json"

        preview = module.cleanup_empty_closed_staging(
            execute=False,
            failed_evidence_path=failed_path,
            failed_evidence_sha256=failed_sha,
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            output_path=None,
            staging_parent=self.staging_parent,
        )
        self.assertEqual(preview["plannedRootRemovalCount"], 1)
        self.assertTrue(closed.exists())

        result = module.cleanup_empty_closed_staging(
            execute=True,
            failed_evidence_path=failed_path,
            failed_evidence_sha256=failed_sha,
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            output_path=output,
            staging_parent=self.staging_parent,
        )
        self.assertEqual(result["state"], "cleanup-complete")
        self.assertFalse(closed.exists())
        self.assertFalse(failed_path.exists())
        self.assertTrue(Path(result["archivedLayoutEvidence"]).is_file())


if __name__ == "__main__":
    unittest.main()
