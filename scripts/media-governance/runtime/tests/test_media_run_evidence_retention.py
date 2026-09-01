#!/usr/bin/env python3
"""验证媒体 Run 不可变证据的保留审计和精确清理合同。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-run-evidence-retention.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_run_evidence_retention", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load media run evidence retention")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaRunEvidenceRetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temporary.name)
        self.evidence_root = self.root / "vol1/docker/kt-codex/artifacts/automation/media"
        self.run_id = "media-run-018-20260101-v1"
        self.run_root = self.evidence_root / self.run_id
        self.operation_root = self.evidence_root / "retention-drill-20260814-v1"
        self.run_root.mkdir(parents=True)
        self.operation_root.mkdir()
        self.run_root.chmod(0o700)
        self.write_file("events.ndjson", b'{"sequence":1}\n')
        self.write_file("report.json", b'{"accepted":true}\n')
        self.write_file("report.html", b"<p>accepted</p>\n")
        self.write_file("evidence/plan-summary.json", b'{"operations":41}\n')
        self.write_file("evidence/journal-summary.json", b'{"state":"committed"}\n')
        self.write_file("evidence/tombstone.json", b'{"closed":true}\n')
        self.write_file("raw-progress/progress.ndjson", b'{"percent":100}\n')
        self.write_file("diagnostics/runner.log", b"completed\n")
        self.manifest_sha = self.write_manifest()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_file(self, relative: str, content: bytes) -> Path:
        path = self.run_root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def file_entry(self, relative: str, role: str, retention_class: str) -> dict[str, object]:
        path = self.run_root / relative
        return {
            "artifactRole": role,
            "path": relative,
            "retentionClass": retention_class,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "size": path.stat().st_size,
        }

    def manifest_payload(self, **overrides: object) -> dict[str, object]:
        payload: dict[str, object] = {
            "activeRunId": None,
            "closedAt": "2026-01-01T00:00:00Z",
            "files": [
                self.file_entry("events.ndjson", "semantic-events", "long-term"),
                self.file_entry("report.json", "final-report-json", "long-term"),
                self.file_entry("report.html", "final-report-html", "long-term"),
                self.file_entry("evidence/plan-summary.json", "plan-summary", "long-term"),
                self.file_entry("evidence/journal-summary.json", "journal-summary", "long-term"),
                self.file_entry("evidence/tombstone.json", "tombstone", "long-term"),
                self.file_entry(
                    "raw-progress/progress.ndjson",
                    "raw-progress",
                    "high-frequency-progress",
                ),
                self.file_entry("diagnostics/runner.log", "runner-diagnostic", "diagnostic"),
            ],
            "recoveryActive": False,
            "runId": self.run_id,
            "runState": "succeeded",
            "schemaVersion": "media-run-evidence-retention-v1",
            "sealedAt": "2026-01-01T00:00:01Z",
            "sequenceSeal": {"count": 8, "first": 1, "last": 8},
            "taskId": "media-task-018-20260101-v1",
            "taskStage": "closed",
        }
        payload.update(overrides)
        return payload

    def write_manifest(self, **overrides: object) -> str:
        path = self.run_root / "manifest.json"
        path.write_text(
            json.dumps(self.manifest_payload(**overrides), ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def audit(
        self,
        manifest_sha: str | None = None,
        *,
        as_of: str = "2026-08-14T00:00:00Z",
    ) -> dict[str, object]:
        return load_module().audit_run(
            as_of=as_of,
            evidence_root=self.evidence_root,
            manifest_sha256=manifest_sha or self.manifest_sha,
            target_run_id=self.run_id,
        )

    def seal_audit(
        self,
        *,
        as_of: str = "2026-08-14T00:00:00Z",
        output_name: str = "run-evidence-retention-audit.json",
    ) -> tuple[Path, str, dict[str, object]]:
        module = load_module()
        payload = self.audit(as_of=as_of)
        path = self.operation_root / output_name
        module.write_json_exclusive(path, payload)
        return path, hashlib.sha256(path.read_bytes()).hexdigest(), payload

    def compress(
        self,
        *,
        audit_path: Path,
        audit_sha: str,
        execute: bool,
        output_name: str | None = None,
    ) -> dict[str, object]:
        return load_module().compress_run(
            audit_path=audit_path,
            audit_sha256=audit_sha,
            evidence_root=self.evidence_root,
            execute=execute,
            expected_candidate_count=2,
            manifest_sha256=self.manifest_sha,
            output_path=(self.operation_root / output_name) if output_name else None,
            target_run_id=self.run_id,
        )

    def cleanup(
        self,
        *,
        audit_path: Path,
        audit_sha: str,
        execute: bool,
        output_name: str | None = None,
    ) -> dict[str, object]:
        return load_module().cleanup_run(
            audit_path=audit_path,
            audit_sha256=audit_sha,
            evidence_root=self.evidence_root,
            execute=execute,
            expected_candidate_count=2,
            manifest_sha256=self.manifest_sha,
            output_path=(self.operation_root / output_name) if output_name else None,
            target_run_id=self.run_id,
        )

    def test_audit_selects_only_expired_diagnostics_and_preserves_long_term_roles(self) -> None:
        result = self.audit()

        self.assertTrue(result["eligible"])
        self.assertEqual(result["blockers"], [])
        self.assertEqual(result["candidateCount"], 2)
        self.assertEqual(
            result["candidatePaths"],
            ["diagnostics/runner.log", "raw-progress/progress.ndjson"],
        )
        self.assertEqual(result["protectedFileCount"], 7)
        self.assertEqual(result["writeBoundaries"]["formalMedia"], 0)

    def test_audit_fails_closed_for_nonterminal_recovery_and_open_window(self) -> None:
        cases = (
            ({"activeRunId": self.run_id, "runState": "running", "taskStage": "governance"}, "task-not-closed"),
            ({"recoveryActive": True}, "recovery-active"),
            ({"closedAt": "2026-08-01T00:00:00Z"}, "retention-window-open"),
            ({"runState": "blocked"}, "run-not-terminal"),
        )
        for overrides, blocker in cases:
            with self.subTest(blocker=blocker):
                digest = self.write_manifest(**overrides)
                result = self.audit(digest)
                self.assertFalse(result["eligible"])
                self.assertIn(blocker, result["blockers"])
                self.assertEqual(result["candidateCount"], 0)

    def test_compression_audit_uses_the_seven_to_180_day_window(self) -> None:
        too_early = self.audit(as_of="2026-01-07T23:59:59Z")
        eligible = self.audit(as_of="2026-01-08T00:00:00Z")
        cleanup_window = self.audit(as_of="2026-06-30T00:00:00Z")

        self.assertFalse(too_early["compressionEligible"])
        self.assertIn("compression-window-open", too_early["compressionBlockers"])
        self.assertTrue(eligible["compressionEligible"])
        self.assertEqual(eligible["compressionCandidateCount"], 2)
        self.assertEqual(eligible["retentionState"], "hot")
        self.assertFalse(cleanup_window["compressionEligible"])
        self.assertIn(
            "cleanup-window-reached",
            cleanup_window["compressionBlockers"],
        )

    def test_inventory_reports_exact_actionable_runs_without_writing(self) -> None:
        invalid_root = self.evidence_root / "media-run-invalid-v1"
        invalid_root.mkdir(mode=0o700)
        (invalid_root / "manifest.json").write_text("{}\n", encoding="utf-8")
        (self.evidence_root / "media-run-unsealed-v1").mkdir(mode=0o700)
        (self.evidence_root / "media-task-agent-v1").mkdir(mode=0o700)
        (self.evidence_root / "unexpected-file").write_text("ignored\n", encoding="utf-8")

        result = load_module().inventory_runs(
            as_of="2026-08-14T00:00:00Z",
            evidence_root=self.evidence_root,
        )

        self.assertEqual(result["manifestRunCount"], 2)
        self.assertEqual(result["validRunCount"], 1)
        self.assertEqual(result["invalidRunCount"], 1)
        self.assertEqual(result["unsealedRunDirectoryCount"], 1)
        self.assertEqual(result["ignoredDirectoryCount"], 2)
        self.assertEqual(result["unsafeEntryCount"], 1)
        summary = load_module().result_summary(result, None)
        self.assertEqual(summary["unsealedRunDirectoryCount"], 1)
        self.assertEqual(summary["ignoredDirectoryCount"], 2)
        self.assertEqual(summary["unsafeEntryCount"], 1)
        self.assertEqual(result["auditEligibleRunCount"], 1)
        self.assertEqual(result["compressionEligibleRunCount"], 0)
        self.assertEqual(result["cleanupEligibleRunCount"], 1)
        self.assertEqual(
            result["actionableRuns"],
            [
                {
                    "activeRunId": None,
                    "auditEligible": True,
                    "cleanupCandidateCount": 2,
                    "cleanupEligible": True,
                    "compressionCandidateCount": 0,
                    "compressionEligible": False,
                    "manifestSha256": self.manifest_sha,
                    "recoveryActive": False,
                    "retentionAgeDays": 225,
                    "retentionState": "hot",
                    "runState": "succeeded",
                    "targetRunId": self.run_id,
                    "taskId": "media-task-018-20260101-v1",
                    "taskStage": "closed",
                }
            ],
        )
        self.assertEqual(
            result["invalidRuns"],
            [{"reason": "manifest schema version is invalid", "targetRunId": "media-run-invalid-v1"}],
        )
        self.assertFalse((self.evidence_root / ".retention").exists())

    def test_inventory_projects_one_fully_verified_fresh_target_run(self) -> None:
        terminal = {
            "action": "source.inspect",
            "evidenceSha256": "d" * 64,
            "eventType": "run-succeeded",
            "observedAt": "2026-08-14T12:32:47.000Z",
            "runId": self.run_id,
            "sequence": 2,
            "summary": "来源描述文件与清单已密封",
            "taskId": "media-task-018-20260101-v1",
            "taskRevision": 11,
        }
        events = (
            json.dumps(
                {
                    "action": "source.inspect",
                    "eventType": "run-started",
                    "observedAt": "2026-08-14T12:32:46.000Z",
                    "runId": self.run_id,
                    "sequence": 1,
                    "summary": "NAS 执行器已接收密封任务",
                    "taskId": "media-task-018-20260101-v1",
                    "taskRevision": 11,
                },
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
            + json.dumps(
                terminal,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        self.write_file("events.ndjson", events)
        terminal_bytes = (
            json.dumps(
                terminal,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        self.manifest_sha = self.write_manifest(
            sealedInputSha256="c" * 64,
            sequenceSeal={"count": 2, "first": 1, "last": 2},
            taskStage="intake",
            terminalEventSha256=hashlib.sha256(terminal_bytes).hexdigest(),
        )

        result = load_module().inventory_runs(
            as_of="2026-08-14T12:33:00Z",
            evidence_root=self.evidence_root,
            target_run_id=self.run_id,
        )

        target = result["targetRun"]
        self.assertEqual(target["manifestSha256"], self.manifest_sha)
        self.assertEqual(target["sequenceSeal"], {"count": 2, "first": 1, "last": 2})
        self.assertEqual(target["terminalEvent"], terminal)
        self.assertEqual(load_module().result_summary(result, None)["targetRun"], target)
        self.assertFalse((self.evidence_root / ".retention").exists())

        with self.assertRaisesRegex(RuntimeError, "target Run manifest is missing"):
            load_module().inventory_runs(
                as_of="2026-08-14T12:33:00Z",
                evidence_root=self.evidence_root,
                target_run_id="media-run-missing-20260814-v1",
            )

    def test_compression_apply_and_reentry_preserve_exact_content_read_only(self) -> None:
        audit_path, audit_sha, _ = self.seal_audit(
            as_of="2026-01-08T00:00:00Z",
            output_name="compression-audit.json",
        )
        protected = {
            relative: hashlib.sha256((self.run_root / relative).read_bytes()).hexdigest()
            for relative in (
                "events.ndjson",
                "manifest.json",
                "report.json",
                "report.html",
                "evidence/plan-summary.json",
                "evidence/journal-summary.json",
                "evidence/tombstone.json",
            )
        }

        preview = self.compress(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=False,
        )
        self.assertEqual(preview["removedCount"], 0)
        self.assertFalse((self.evidence_root / ".retention").exists())

        applied = self.compress(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=True,
            output_name="compression.json",
        )
        state_root = self.evidence_root / ".retention" / self.run_id
        archive = state_root / "diagnostics-progress.zip"
        receipt = state_root / "compression.json"
        self.assertEqual(applied["removedCount"], 2)
        self.assertTrue(archive.is_file())
        self.assertTrue(receipt.is_file())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o400)
        self.assertFalse((self.run_root / "diagnostics/runner.log").exists())
        self.assertFalse((self.run_root / "raw-progress/progress.ndjson").exists())
        archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()

        reentered = self.compress(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=True,
            output_name="compression-reentry.json",
        )
        self.assertEqual(reentered["removedCount"], 0)
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), archive_sha)
        for relative, digest in protected.items():
            self.assertEqual(
                hashlib.sha256((self.run_root / relative).read_bytes()).hexdigest(),
                digest,
            )

    def test_compression_archive_bytes_are_deterministic(self) -> None:
        module = load_module()
        files = module.normalized_files(self.manifest_payload())
        sources = module.compression_sources(files)
        first = self.root / "first.zip"
        second = self.root / "second.zip"

        module.build_compression_archive(
            archive_path=first,
            sources=sources,
            target=self.run_root,
        )
        module.build_compression_archive(
            archive_path=second,
            sources=sources,
            target=self.run_root,
        )

        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_cleanup_after_compression_removes_only_archive_and_keeps_receipt(self) -> None:
        compression_audit, compression_audit_sha, _ = self.seal_audit(
            as_of="2026-01-08T00:00:00Z",
            output_name="compression-audit.json",
        )
        self.compress(
            audit_path=compression_audit,
            audit_sha=compression_audit_sha,
            execute=True,
            output_name="compression.json",
        )
        cleanup_audit, cleanup_audit_sha, payload = self.seal_audit(
            output_name="compressed-cleanup-audit.json",
        )
        self.assertTrue(payload["eligible"])
        self.assertEqual(payload["candidateCount"], 1)
        self.assertEqual(payload["retentionState"], "compressed")

        applied = load_module().cleanup_run(
            audit_path=cleanup_audit,
            audit_sha256=cleanup_audit_sha,
            evidence_root=self.evidence_root,
            execute=True,
            expected_candidate_count=1,
            manifest_sha256=self.manifest_sha,
            output_path=self.operation_root / "compressed-cleanup.json",
            target_run_id=self.run_id,
        )
        state_root = self.evidence_root / ".retention" / self.run_id
        self.assertEqual(applied["removedCount"], 1)
        self.assertFalse((state_root / "diagnostics-progress.zip").exists())
        self.assertTrue((state_root / "compression.json").is_file())
        self.assertTrue((state_root / "cleanup.json").is_file())
        reaudited = self.audit()
        self.assertEqual(reaudited["retentionState"], "cleaned")
        self.assertEqual(reaudited["candidateCount"], 0)

    def test_compression_resumes_forward_after_partial_original_removal(self) -> None:
        audit_path, audit_sha, _ = self.seal_audit(
            as_of="2026-01-08T00:00:00Z",
            output_name="compression-audit.json",
        )
        module = load_module()
        target, _, files, _, _ = module.load_manifest(
            evidence_root=self.evidence_root,
            manifest_sha256=self.manifest_sha,
            target_run_id=self.run_id,
        )
        module.publish_compression_state(
            evidence_root=self.evidence_root,
            files=files,
            manifest_sha256=self.manifest_sha,
            target=target,
            target_run_id=self.run_id,
        )
        (self.run_root / "diagnostics/runner.log").unlink()

        resumed = self.compress(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=True,
            output_name="compression-resumed.json",
        )

        self.assertEqual(resumed["removedCount"], 1)
        self.assertEqual(
            resumed["alreadyRemovedPaths"],
            ["diagnostics/runner.log"],
        )
        self.assertFalse((self.run_root / "raw-progress/progress.ndjson").exists())

    def test_compressed_archive_drift_fails_before_cleanup(self) -> None:
        compression_audit, compression_audit_sha, _ = self.seal_audit(
            as_of="2026-01-08T00:00:00Z",
            output_name="compression-audit.json",
        )
        self.compress(
            audit_path=compression_audit,
            audit_sha=compression_audit_sha,
            execute=True,
            output_name="compression.json",
        )
        archive = (
            self.evidence_root
            / ".retention"
            / self.run_id
            / "diagnostics-progress.zip"
        )
        archive.chmod(0o600)
        archive.write_bytes(archive.read_bytes() + b"drift")

        with self.assertRaisesRegex(RuntimeError, "archive"):
            self.audit()

    def test_cleanup_preview_apply_and_reentry_leave_long_term_evidence_unchanged(self) -> None:
        audit_path, audit_sha, _ = self.seal_audit()
        protected = {
            relative: hashlib.sha256((self.run_root / relative).read_bytes()).hexdigest()
            for relative in (
                "events.ndjson",
                "manifest.json",
                "report.json",
                "report.html",
                "evidence/plan-summary.json",
                "evidence/journal-summary.json",
                "evidence/tombstone.json",
            )
        }

        preview = self.cleanup(audit_path=audit_path, audit_sha=audit_sha, execute=False)
        self.assertEqual(preview["removedCount"], 0)
        self.assertEqual(len(preview["pendingPaths"]), 2)

        applied = self.cleanup(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=True,
            output_name="run-evidence-retention-cleanup.json",
        )
        self.assertEqual(applied["removedCount"], 2)
        self.assertFalse((self.run_root / "diagnostics/runner.log").exists())
        self.assertFalse((self.run_root / "raw-progress/progress.ndjson").exists())

        reentered = self.cleanup(
            audit_path=audit_path,
            audit_sha=audit_sha,
            execute=True,
            output_name="run-evidence-retention-cleanup-reentry.json",
        )
        self.assertEqual(reentered["removedCount"], 0)
        self.assertEqual(len(reentered["alreadyRemovedPaths"]), 2)
        for relative, digest in protected.items():
            self.assertEqual(hashlib.sha256((self.run_root / relative).read_bytes()).hexdigest(), digest)

    def test_rejects_wrong_manifest_sha_symlink_and_hardlink_without_mutation(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "manifest"):
            self.audit("0" * 64)
        unsafe = self.run_root / "diagnostics/unsafe-link"
        unsafe.symlink_to(self.run_root / "report.json")
        with self.assertRaisesRegex(RuntimeError, "unsafe"):
            self.audit()
        unsafe.unlink()
        os.link(
            self.run_root / "diagnostics/runner.log",
            self.root / "runner-hardlink.log",
        )
        hardlinked = self.audit()
        self.assertFalse(hardlinked["eligible"])
        self.assertIn("cleanable-hardlink", hardlinked["blockers"])
        self.assertTrue((self.run_root / "raw-progress/progress.ndjson").exists())

    def test_cleanup_rejects_post_audit_drift_before_any_delete(self) -> None:
        audit_path, audit_sha, _ = self.seal_audit()
        (self.run_root / "diagnostics/runner.log").write_text("changed\n", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "drift"):
            self.cleanup(
                audit_path=audit_path,
                audit_sha=audit_sha,
                execute=True,
                output_name="should-not-exist.json",
            )

        self.assertTrue((self.run_root / "diagnostics/runner.log").exists())
        self.assertTrue((self.run_root / "raw-progress/progress.ndjson").exists())
        self.assertFalse((self.operation_root / "should-not-exist.json").exists())

    def test_cli_runs_sealed_audit_preview_and_apply_inside_fixture_only(self) -> None:
        audit_path = self.operation_root / "cli-audit.json"
        audit = subprocess.run(
            [
                sys.executable,
                os.fspath(SCRIPT_PATH),
                "--operation",
                "audit",
                "--evidence-root",
                os.fspath(self.evidence_root),
                "--target-run-id",
                self.run_id,
                "--manifest-sha256",
                self.manifest_sha,
                "--as-of",
                "2026-08-14T00:00:00Z",
                "--output",
                os.fspath(audit_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(audit.stdout)["candidateCount"], 2)
        audit_sha = hashlib.sha256(audit_path.read_bytes()).hexdigest()
        common = [
            sys.executable,
            os.fspath(SCRIPT_PATH),
            "--operation",
            "cleanup",
            "--evidence-root",
            os.fspath(self.evidence_root),
            "--target-run-id",
            self.run_id,
            "--manifest-sha256",
            self.manifest_sha,
            "--audit",
            os.fspath(audit_path),
            "--audit-sha256",
            audit_sha,
            "--expected-candidate-count",
            "2",
        ]
        preview = subprocess.run(common, check=True, capture_output=True, text=True)
        self.assertEqual(
            json.loads(preview.stdout)["state"],
            "run-evidence-retention-cleanup-preview",
        )
        cleanup_path = self.operation_root / "cli-cleanup.json"
        applied = subprocess.run(
            [*common, "--output", os.fspath(cleanup_path), "--execute"],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(applied.stdout)["removedCount"], 2)
        self.assertTrue(cleanup_path.is_file())

    def test_cli_runs_sealed_compression_preview_and_apply_inside_fixture_only(self) -> None:
        audit_path = self.operation_root / "cli-compression-audit.json"
        subprocess.run(
            [
                sys.executable,
                os.fspath(SCRIPT_PATH),
                "--operation",
                "audit",
                "--evidence-root",
                os.fspath(self.evidence_root),
                "--target-run-id",
                self.run_id,
                "--manifest-sha256",
                self.manifest_sha,
                "--as-of",
                "2026-01-08T00:00:00Z",
                "--output",
                os.fspath(audit_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        audit_sha = hashlib.sha256(audit_path.read_bytes()).hexdigest()
        common = [
            sys.executable,
            os.fspath(SCRIPT_PATH),
            "--operation",
            "compress",
            "--evidence-root",
            os.fspath(self.evidence_root),
            "--target-run-id",
            self.run_id,
            "--manifest-sha256",
            self.manifest_sha,
            "--audit",
            os.fspath(audit_path),
            "--audit-sha256",
            audit_sha,
            "--expected-candidate-count",
            "2",
        ]
        preview = subprocess.run(common, check=True, capture_output=True, text=True)
        self.assertEqual(
            json.loads(preview.stdout)["state"],
            "run-evidence-compression-preview",
        )
        output = self.operation_root / "cli-compression.json"
        applied = subprocess.run(
            [*common, "--output", os.fspath(output), "--execute"],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(json.loads(applied.stdout)["removedCount"], 2)
        self.assertTrue(output.is_file())


if __name__ == "__main__":
    unittest.main()
