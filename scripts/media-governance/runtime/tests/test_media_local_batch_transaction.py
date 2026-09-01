#!/usr/bin/env python3
"""本地媒体多计划事务入口的顺序、回滚与 SHA 配对测试。"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-batch-transaction.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_local_batch_transaction", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media local batch transaction script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeRuntime:
    def __init__(self, fail_forward: str | None = None):
        self.calls = []
        self.fail_forward = fail_forward

    def preflight(self, plan, direction):
        self.calls.append(("preflight", plan.work_item_id, direction))
        return {"operationCount": 1, "serviceStopped": direction == "inverse"}

    def execute(self, plan, direction):
        self.calls.append(("execute", plan.work_item_id, direction))
        if direction == "forward" and plan.work_item_id == self.fail_forward:
            raise RuntimeError("synthetic forward failure")
        return {"operationCount": 1, "state": "committed"}

    def require_running(self):
        self.calls.append(("require-running",))

    def stop(self):
        self.calls.append(("stop",))

    def start(self):
        self.calls.append(("start",))


class MediaLocalBatchTransactionTest(unittest.TestCase):
    def test_manifest_preflight_and_execute_share_long_timeout(self):
        """确认缓存命中的预检与实际执行仍受同一有限超时约束。"""
        module = load_module()
        runtime = object.__new__(module.ProductionRuntime)
        runtime.node = "/usr/bin/node"
        runtime.executor = pathlib.Path("/release/media-manifest-executor.mjs")
        runtime.verification_cache_root = pathlib.Path("/evidence/verification-cache")
        runtime.verification_attempt_id = "media-run-fixture"
        runtime.verification_tool_sha256 = "b" * 64
        runtime.replacement_backup_evidence = pathlib.Path("/evidence/backup.json")
        runtime.replacement_backup_evidence_sha256 = "c" * 64
        calls = []

        def fake_run(command, timeout_seconds):
            """记录子命令超时并按是否执行返回对应的固定状态。"""
            calls.append((command, timeout_seconds))
            state = "preflight-passed"
            if "--execute" in command:
                state = "committed"
            return type("Result", (), {"stdout": json.dumps({"state": state})})()

        runtime._run = fake_run
        plan = module.PlanSpec(
            pathlib.Path("/evidence/plan.json"),
            "a" * 64,
            "media-001",
            "replay-key-001",
        )

        self.assertEqual(runtime.preflight(plan, "forward")["state"], "preflight-passed")
        self.assertEqual(runtime.execute(plan, "forward")["state"], "committed")
        self.assertEqual(module.MANIFEST_EXECUTOR_TIMEOUT_SECONDS, 1_800)
        self.assertEqual([timeout for _, timeout in calls], [1_800, 1_800])
        self.assertNotIn("--execute", calls[0][0])
        self.assertIn("--execute", calls[1][0])
        self.assertIn("--verification-cache-root", calls[0][0])
        self.assertIn("/evidence/verification-cache", calls[0][0])
        self.assertIn("--require-verification-cache", calls[0][0])
        self.assertIn("--replacement-backup-evidence", calls[0][0])
        self.assertIn("/evidence/backup.json", calls[0][0])
        self.assertIn("--replacement-backup-evidence-sha256", calls[0][0])
        self.assertIn("c" * 64, calls[0][0])

    def test_fnos_start_status_is_a_running_application(self):
        module = load_module()
        runtime = object.__new__(module.ProductionRuntime)
        runtime.process_running = lambda: True
        for status in ("start", "running"):
            with self.subTest(status=status):
                runtime._run = lambda _command, _timeout, value=status: type(
                    "Result", (), {"stdout": value}
                )()
                runtime.require_running()
        runtime._run = lambda _command, _timeout: type(
            "Result", (), {"stdout": "stop"}
        )()
        with self.assertRaisesRegex(RuntimeError, "not fully running"):
            runtime.require_running()

    def test_executor_accepts_only_the_two_fixed_release_roots(self):
        module = load_module()
        self.assertEqual(
            tuple(map(str, module.RELEASE_ROOTS)),
            (
                "/vol1/docker/kt-media-governance/releases",
                "/vol1/docker/kt-media-governance/executor/releases",
            ),
        )
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory)
            legacy = root / "releases"
            executor = root / "executor" / "releases"
            outside = root / "outside"
            for release_root in (legacy, executor, outside):
                (release_root / "digest").mkdir(parents=True)
            original_roots = module.RELEASE_ROOTS
            module.RELEASE_ROOTS = (legacy, executor)
            try:
                for release_root in (legacy, executor):
                    candidate = release_root / "digest" / "executor.mjs"
                    candidate.write_text("export {};\n", encoding="utf-8")
                    self.assertEqual(
                        module.validate_executor(
                            str(candidate), module.sha256_file(candidate)
                        ),
                        candidate,
                    )
                rejected = outside / "digest" / "executor.mjs"
                rejected.write_text("export {};\n", encoding="utf-8")
                with self.assertRaisesRegex(RuntimeError, "path or SHA-256"):
                    module.validate_executor(
                        str(rejected), module.sha256_file(rejected)
                    )
            finally:
                module.RELEASE_ROOTS = original_roots

    def test_success_stops_once_and_preflights_each_inverse(self):
        module = load_module()
        plans = [
            module.PlanSpec(pathlib.Path("/p1"), "a" * 64, "media-001", "r1"),
            module.PlanSpec(pathlib.Path("/p2"), "b" * 64, "media-002", "r2"),
        ]
        runtime = FakeRuntime()

        result = module.execute_batch(plans, runtime)

        self.assertEqual(result["state"], "committed")
        self.assertEqual(result["committedWorkItemIds"], ["media-001", "media-002"])
        self.assertEqual(runtime.calls.count(("stop",)), 1)
        self.assertEqual(runtime.calls.count(("start",)), 1)
        self.assertIn(("preflight", "media-001", "inverse"), runtime.calls)
        self.assertIn(("preflight", "media-002", "inverse"), runtime.calls)

    def test_later_failure_rolls_back_only_committed_plans_in_reverse(self):
        module = load_module()
        plans = [
            module.PlanSpec(pathlib.Path("/p1"), "a" * 64, "media-001", "r1"),
            module.PlanSpec(pathlib.Path("/p2"), "b" * 64, "media-002", "r2"),
        ]
        runtime = FakeRuntime(fail_forward="media-002")

        with self.assertRaises(module.BatchTransactionError) as caught:
            module.execute_batch(plans, runtime)

        self.assertEqual(caught.exception.result["state"], "rolled-back")
        self.assertEqual(caught.exception.result["rolledBackWorkItemIds"], ["media-001"])
        self.assertIn(("execute", "media-001", "inverse"), runtime.calls)
        self.assertNotIn(("execute", "media-002", "inverse"), runtime.calls)
        self.assertEqual(runtime.calls[-1], ("start",))

    def test_plan_and_digest_arguments_are_paired_and_verified(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory)
            plan = root / "plan.json"
            plan.write_text(
                '{"execution":{"phase":"local-only","replayKey":"replay-key-001"},'
                '"schemaVersion":"1.2.0","sealed":true,"workItemId":"media-001"}',
                encoding="utf-8",
            )
            digest = module.sha256_file(plan)

            specs = module.load_plan_specs([str(plan)], [digest], root)

            self.assertEqual(specs[0].work_item_id, "media-001")
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                module.load_plan_specs([str(plan)], ["0" * 64], root)
            with self.assertRaisesRegex(RuntimeError, "same number"):
                module.load_plan_specs([str(plan)], [], root)


if __name__ == "__main__":
    unittest.main()
