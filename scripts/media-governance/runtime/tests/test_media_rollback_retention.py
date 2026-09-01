#!/usr/bin/env python3
"""验证已完成媒体 rollback 批次的密封审计与精确清理。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-rollback-retention.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_rollback_retention", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load media rollback retention")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaRollbackRetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temporary.name)
        self.media_root = self.root / "vol2/1000/Media"
        self.rollback_parent = self.root / "vol2/1000/.kt-media-governance-rollback"
        self.evidence_root = self.root / "vol1/docker/kt-media-governance/evidence"
        self.output_root = self.evidence_root / "rollback-retention-test-v1"
        for path in (
            self.media_root / "movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01",
            self.media_root / "movie/Movies",
            self.media_root / "extras",
            self.rollback_parent,
            self.evidence_root,
            self.output_root,
        ):
            path.mkdir(parents=True, exist_ok=True)
        self.rollback_parent.chmod(0o700)
        (self.media_root / "movie/Movies/示例电影 (2023) [tmdbid-2]").mkdir()
        self.ledger_path = self.root / "ledger.json"
        self.write_ledger()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_ledger(self, pending: bool = False) -> None:
        self.ledger_path.write_text(
            json.dumps(
                {
                    "items": [
                        {
                            "localReconciledAt": "2026-08-01T00:00:00Z",
                            "metadataIdentity": "tmdb:1",
                            "inventoryState": "inventory_pending" if pending else "local_reconciled",
                            "workItemId": "media-001",
                        },
                        {
                            "metadataIdentity": "tmdb:2",
                            "reconciledAt": "2026-08-01T00:00:00.123456Z",
                            "inventoryState": "reconciled",
                            "workItemId": "media-002",
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )

    def write_acceptance(self, run_id: str, work_items: list[str]) -> None:
        path = self.evidence_root / run_id / "batch-acceptance.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "state": "local-batch-accepted",
                    "workItemIds": work_items,
                }
            ),
            encoding="utf-8",
        )

    def audit(self, expected_count: int):
        module = load_module()
        return module.audit_rollback(
            evidence_root=self.evidence_root,
            expected_entry_count=expected_count,
            expected_gid=os.getgid(),
            expected_uid=os.getuid(),
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            rollback_parent=self.rollback_parent,
        )

    def seal_audit(self, expected_count: int):
        module = load_module()
        payload = self.audit(expected_count)
        path = self.output_root / "rollback-retention-audit.json"
        module.write_json_exclusive(path, payload)
        return payload, path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_audit_accepts_completed_bound_batches_and_redundant_hardlinks(self) -> None:
        canonical = self.media_root / "movie/TV/示例剧集 (2024) [tmdbid-1]/Season 01/S01E01.mkv"
        canonical.write_bytes(b"video")
        bound = self.rollback_parent / "media-002-legacy-v1"
        bound.mkdir()
        (bound / "notes.nfo").write_text("metadata", encoding="utf-8")
        self.write_acceptance("accepted-media-002-v1", ["media-002"])
        redundant = self.rollback_parent / "legacy-hardlink-v1"
        redundant.mkdir()
        os.link(canonical, redundant / "S01E01.mkv")

        result = self.audit(2)

        self.assertEqual(result["state"], "rollback-retention-audited")
        self.assertEqual(result["eligibleEntryCount"], 2)
        self.assertEqual(result["ineligibleEntryCount"], 0)
        entries = {row["name"]: row for row in result["entries"]}
        self.assertEqual(entries[bound.name]["workItemIds"], ["media-002"])
        self.assertEqual(entries[redundant.name]["eligibility"], "canonical-hardlink-redundant")
        summary = load_module().evidence_result_summary(result, None)
        self.assertEqual(
            summary["diagnostics"]["eligibleNames"],
            ["legacy-hardlink-v1", "media-002-legacy-v1"],
        )

    def test_audit_fails_closed_for_pending_ledger_unbound_content_and_symlink(self) -> None:
        unbound = self.rollback_parent / "unknown-v1"
        unbound.mkdir()
        (unbound / "orphan.bin").write_bytes(b"orphan")
        linked = self.rollback_parent / "media-001-linked-v1"
        linked.mkdir()
        (linked / "unsafe").symlink_to(unbound / "orphan.bin")
        self.write_acceptance(linked.name, ["media-001"])
        self.write_ledger(pending=True)

        result = self.audit(2)

        self.assertEqual(result["eligibleEntryCount"], 0)
        self.assertEqual(result["ineligibleEntryCount"], 2)
        self.assertIn("ledger-has-unfinished-items", result["blockers"])
        reasons = {reason for row in result["entries"] for reason in row["reasons"]}
        self.assertIn("unsafe-node", reasons)
        self.assertIn("unbound-unique-content", reasons)

    def test_cleanup_dry_run_preserves_entries_and_apply_removes_only_eligible(self) -> None:
        completed = self.rollback_parent / "media-001-complete-v1"
        completed.mkdir()
        (completed / "original.mkv").write_bytes(b"old-video")
        self.write_acceptance(completed.name, ["media-001"])
        unbound = self.rollback_parent / "unbound-v1"
        unbound.mkdir()
        (unbound / "keep.bin").write_bytes(b"keep")
        audit, audit_path, audit_sha = self.seal_audit(2)
        module = load_module()
        canonical_before = audit["canonicalSnapshot"]

        preview = module.cleanup_rollback(
            audit_path=audit_path,
            audit_sha256=audit_sha,
            evidence_root=self.evidence_root,
            execute=False,
            expected_entry_count=2,
            expected_gid=os.getgid(),
            expected_uid=os.getuid(),
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            output_path=None,
            rollback_parent=self.rollback_parent,
        )
        self.assertEqual(preview["state"], "rollback-retention-cleanup-preview")
        self.assertTrue(completed.exists())

        output = self.output_root / "rollback-retention-cleanup.json"
        result = module.cleanup_rollback(
            audit_path=audit_path,
            audit_sha256=audit_sha,
            evidence_root=self.evidence_root,
            execute=True,
            expected_entry_count=2,
            expected_gid=os.getgid(),
            expected_uid=os.getuid(),
            ledger_path=self.ledger_path,
            media_root=self.media_root,
            output_path=output,
            rollback_parent=self.rollback_parent,
        )

        self.assertEqual(result["state"], "rollback-retention-cleanup-complete")
        self.assertEqual(result["removedEntries"], [completed.name])
        self.assertFalse(completed.exists())
        self.assertTrue(unbound.exists())
        self.assertEqual(result["remainingEntries"], [unbound.name])
        self.assertEqual(result["canonicalSnapshot"], canonical_before)
        self.assertTrue(output.is_file())

    def test_cleanup_rejects_drift_before_deleting_any_entry(self) -> None:
        first = self.rollback_parent / "media-001-complete-v1"
        second = self.rollback_parent / "media-002-complete-v1"
        for entry, work_item in ((first, "media-001"), (second, "media-002")):
            entry.mkdir()
            (entry / "original.bin").write_bytes(work_item.encode())
            self.write_acceptance(entry.name, [work_item])
        _, audit_path, audit_sha = self.seal_audit(2)
        (second / "changed.bin").write_bytes(b"drift")
        module = load_module()

        with self.assertRaisesRegex(RuntimeError, "drift"):
            module.cleanup_rollback(
                audit_path=audit_path,
                audit_sha256=audit_sha,
                evidence_root=self.evidence_root,
                execute=True,
                expected_entry_count=2,
                expected_gid=os.getgid(),
                expected_uid=os.getuid(),
                ledger_path=self.ledger_path,
                media_root=self.media_root,
                output_path=self.output_root / "cleanup.json",
                rollback_parent=self.rollback_parent,
            )

        self.assertTrue(first.exists())
        self.assertTrue(second.exists())


if __name__ == "__main__":
    unittest.main()
