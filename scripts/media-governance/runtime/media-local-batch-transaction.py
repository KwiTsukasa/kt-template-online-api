#!/usr/bin/env python3
"""以一次 trim.media 停服窗口提交多个已密封本地媒体计划。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import time
from typing import NamedTuple


EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
RELEASE_ROOTS = (
    pathlib.Path("/vol1/docker/kt-media-governance/releases"),
    pathlib.Path("/vol1/docker/kt-media-governance/executor/releases"),
)
APPCTL = pathlib.Path("/usr/local/bin/appcenter-cli")
APP_NAME = "trim.media"
PROCESS_NEEDLE = "/@appcenter/trim.media/trim-media"
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
MANIFEST_EXECUTOR_TIMEOUT_SECONDS = 1_800


class PlanSpec(NamedTuple):
    path: pathlib.Path
    sha256: str
    work_item_id: str
    replay_key: str


class BatchTransactionError(RuntimeError):
    def __init__(self, message: str, result: dict):
        super().__init__(message)
        self.result = result


def fail(message: str) -> None:
    raise RuntimeError(message)


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_descendant(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return path != root


def validate_digest(value: str, label: str) -> str:
    normalized = value.strip().lower()
    if not HASH_PATTERN.fullmatch(normalized):
        fail(f"{label} must be a lowercase SHA-256 digest")
    return normalized


def load_plan_specs(
    plan_values: list[str], digest_values: list[str], root: pathlib.Path = EVIDENCE_ROOT
) -> list[PlanSpec]:
    if len(plan_values) != len(digest_values):
        fail("--plan and --plan-sha256 must appear the same number of times")
    if not plan_values:
        fail("at least one sealed plan is required")
    resolved_root = root.resolve(strict=True)
    specs = []
    work_items = set()
    replay_keys = set()
    for plan_value, digest_value in zip(plan_values, digest_values, strict=True):
        path = pathlib.Path(plan_value)
        if (
            not path.is_absolute()
            or not path.is_file()
            or path.is_symlink()
            or not is_descendant(path.resolve(strict=True), resolved_root)
        ):
            fail(f"plan must be a regular file below {resolved_root}")
        expected = validate_digest(digest_value, "plan SHA-256")
        if sha256_file(path) != expected:
            fail(f"plan SHA-256 changed: {path}")
        plan = json.loads(path.read_text(encoding="utf-8"))
        execution = plan.get("execution") or {}
        work_item_id = str(plan.get("workItemId") or "")
        replay_key = str(execution.get("replayKey") or "")
        if (
            plan.get("schemaVersion") != "1.2.0"
            or plan.get("sealed") is not True
            or execution.get("phase") != "local-only"
            or not re.fullmatch(r"media-\d{3}", work_item_id)
            or not replay_key
        ):
            fail(f"plan is not a sealed Schema 1.2.0 local-only plan: {path}")
        if work_item_id in work_items or replay_key in replay_keys:
            fail("batch plan work-item IDs and replay keys must be unique")
        work_items.add(work_item_id)
        replay_keys.add(replay_key)
        specs.append(PlanSpec(path, expected, work_item_id, replay_key))
    return specs


def compact_executor_result(result: dict) -> dict:
    return {
        key: result.get(key)
        for key in ("operationCount", "serviceStopped", "state")
        if key in result
    }


def execute_batch(plans: list[PlanSpec], runtime) -> dict:
    started_at = utc_now()
    forward_preflight = []
    for plan in plans:
        preview = runtime.preflight(plan, "forward")
        if preview.get("serviceStopped") is True:
            fail("trim.media stopped during forward preflight")
        forward_preflight.append(
            {
                "workItemId": plan.work_item_id,
                **compact_executor_result(preview),
            }
        )
    runtime.require_running()
    committed: list[PlanSpec] = []
    rolled_back: list[str] = []
    inverse_preflight = []
    forward_results = []
    rollback_errors = []
    transaction_error: Exception | None = None
    restore_error: Exception | None = None
    try:
        runtime.stop()
        try:
            for plan in plans:
                forward = runtime.execute(plan, "forward")
                committed.append(plan)
                forward_results.append(
                    {
                        "workItemId": plan.work_item_id,
                        **compact_executor_result(forward),
                    }
                )
                inverse = runtime.preflight(plan, "inverse")
                if inverse.get("serviceStopped") is not True:
                    fail("trim.media restarted before inverse preflight")
                inverse_preflight.append(
                    {
                        "workItemId": plan.work_item_id,
                        **compact_executor_result(inverse),
                    }
                )
        except Exception as error:  # noqa: BLE001 - rollback needs the original failure.
            transaction_error = error
            for plan in reversed(committed):
                try:
                    runtime.preflight(plan, "inverse")
                    runtime.execute(plan, "inverse")
                    rolled_back.append(plan.work_item_id)
                except Exception as rollback_error:  # noqa: BLE001
                    rollback_errors.append(
                        {"error": str(rollback_error), "workItemId": plan.work_item_id}
                    )
    finally:
        try:
            runtime.start()
        except Exception as error:  # noqa: BLE001 - service restoration is evidence.
            restore_error = error

    state = "committed"
    if rollback_errors:
        state = "rollback-failed"
    elif transaction_error is not None:
        state = "rolled-back"
    elif restore_error is not None:
        state = "service-restore-failed"
    result = {
        "committedWorkItemIds": [plan.work_item_id for plan in committed],
        "finishedAt": utc_now(),
        "forward": forward_results,
        "forwardPreflight": forward_preflight,
        "inversePreflight": inverse_preflight,
        "mutationBoundaries": {
            "appStartCount": 1,
            "appStopCount": 1,
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "uiWrites": 0,
        },
        "rollbackErrors": rollback_errors,
        "rolledBackWorkItemIds": rolled_back,
        "startedAt": started_at,
        "state": state,
    }
    errors = []
    if transaction_error is not None:
        errors.append(f"transaction: {transaction_error}")
    if restore_error is not None:
        errors.append(f"service restore: {restore_error}")
    if rollback_errors:
        errors.append("one or more committed plans failed to roll back")
    if errors:
        raise BatchTransactionError("; ".join(errors), result)
    return result


class ProductionRuntime:
    def __init__(
        self,
        executor: pathlib.Path,
        verification_cache_root: pathlib.Path | None = None,
        verification_attempt_id: str | None = None,
        verification_tool_sha256: str | None = None,
        replacement_backup_evidence: pathlib.Path | None = None,
        replacement_backup_evidence_sha256: str | None = None,
    ):
        node = shutil.which("node")
        if not node:
            fail("node is unavailable")
        self.node = node
        self.executor = executor
        self.verification_cache_root = verification_cache_root
        self.verification_attempt_id = verification_attempt_id
        self.verification_tool_sha256 = verification_tool_sha256
        self.replacement_backup_evidence = replacement_backup_evidence
        self.replacement_backup_evidence_sha256 = (
            replacement_backup_evidence_sha256
        )

    def _run(self, command: list[str], timeout_seconds: int) -> subprocess.CompletedProcess:
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                check=False,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(f"bounded command timed out: {command[0]}") from error
        if result.returncode != 0:
            diagnostic = (result.stderr or result.stdout or "no diagnostic").strip()
            raise RuntimeError(
                f"command failed ({result.returncode}): {diagnostic[-1200:]}"
            )
        return result

    def _executor(self, plan: PlanSpec, direction: str, execute: bool) -> dict:
        command = [
            self.node,
            os.fspath(self.executor),
            "--plan",
            os.fspath(plan.path),
            "--scope",
            "local",
            "--direction",
            direction,
        ]
        if self.verification_cache_root is not None:
            command.extend(
                [
                    "--verification-cache-root",
                    os.fspath(self.verification_cache_root),
                    "--verification-attempt-id",
                    str(self.verification_attempt_id),
                    "--verification-tool-sha256",
                    str(self.verification_tool_sha256),
                    "--require-verification-cache",
                ]
            )
        replacement_backup_evidence = getattr(
            self, "replacement_backup_evidence", None
        )
        if replacement_backup_evidence is not None:
            command.extend(
                [
                    "--replacement-backup-evidence",
                    os.fspath(replacement_backup_evidence),
                    "--replacement-backup-evidence-sha256",
                    str(
                        getattr(
                            self, "replacement_backup_evidence_sha256", None
                        )
                    ),
                ]
            )
        if execute:
            command.append("--execute")
        result = self._run(command, MANIFEST_EXECUTOR_TIMEOUT_SECONDS)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        if not lines:
            fail("media executor returned no JSON result")
        payload = json.loads(lines[-1])
        if execute and payload.get("state") != "committed":
            fail("media executor did not commit")
        if not execute and payload.get("state") != "preflight-passed":
            fail("media executor preflight did not pass")
        return payload

    def preflight(self, plan: PlanSpec, direction: str) -> dict:
        return self._executor(plan, direction, False)

    def execute(self, plan: PlanSpec, direction: str) -> dict:
        return self._executor(plan, direction, True)

    def process_running(self) -> bool:
        for proc in pathlib.Path("/proc").iterdir():
            if not proc.name.isdigit():
                continue
            try:
                command = (proc / "cmdline").read_bytes().replace(b"\0", b" ")
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                continue
            if PROCESS_NEEDLE.encode() in command:
                return True
        return False

    def require_running(self) -> None:
        status = self._run([os.fspath(APPCTL), "status", APP_NAME], 30)
        if status.stdout.strip() not in {"running", "start"} or not self.process_running():
            fail("trim.media is not fully running before the batch")

    def _wait_process(self, expected: bool) -> None:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.process_running() is expected:
                return
            time.sleep(0.5)
        fail(f"trim.media process did not become {'running' if expected else 'stopped'}")

    def stop(self) -> None:
        self._run([os.fspath(APPCTL), "stop", APP_NAME], 120)
        self._wait_process(False)

    def start(self) -> None:
        self._run([os.fspath(APPCTL), "start", APP_NAME], 120)
        self._wait_process(True)


def validate_executor(path_value: str, digest_value: str) -> pathlib.Path:
    path = pathlib.Path(path_value)
    expected = validate_digest(digest_value, "executor SHA-256")
    resolved = path.resolve(strict=True) if path.is_file() else path
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or not any(
            root.is_dir()
            and is_descendant(resolved, root.resolve(strict=True))
            for root in RELEASE_ROOTS
        )
        or sha256_file(path) != expected
    ):
        fail("executor path or SHA-256 is invalid")
    return path


def validate_verification_cache_root(
    path_value: str | None,
    tool_sha256: str | None,
) -> pathlib.Path | None:
    """验证可恢复摘要缓存位于固定证据根、权限私有且绑定当前 executor。"""
    if path_value is None and tool_sha256 is None:
        return None
    if not path_value or not tool_sha256:
        fail("verification cache root and tool SHA-256 must be provided together")
    validate_digest(tool_sha256, "verification tool SHA-256")
    path = pathlib.Path(path_value)
    resolved_root = EVIDENCE_ROOT.resolve(strict=True)
    resolved = path
    if path.is_dir():
        resolved = path.resolve(strict=True)
    if (
        not path.is_absolute()
        or not path.is_dir()
        or path.is_symlink()
        or not is_descendant(resolved, resolved_root)
        or path.stat().st_mode & 0o077
    ):
        fail("verification cache root is invalid")
    return path


def validate_replacement_backup_evidence(
    path_value: str | None,
    digest_value: str | None,
) -> pathlib.Path | None:
    """要求替换备份收据位于私有证据根且内容摘要与调用方密封值一致。"""
    if path_value is None and digest_value is None:
        return None
    if not path_value or not digest_value:
        fail("replacement backup path and SHA-256 must be provided together")
    expected = validate_digest(digest_value, "replacement backup SHA-256")
    path = pathlib.Path(path_value)
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or path.stat().st_mode & 0o077
        or not is_descendant(
            path.resolve(strict=True), EVIDENCE_ROOT.resolve(strict=True)
        )
        or sha256_file(path) != expected
    ):
        fail("replacement backup evidence is invalid")
    return path


def validate_output(path_value: str) -> pathlib.Path:
    path = pathlib.Path(path_value)
    if (
        not path.is_absolute()
        or path.exists()
        or path.is_symlink()
        or path.suffix != ".json"
        or not is_descendant(
            path.resolve(strict=False), EVIDENCE_ROOT.resolve(strict=True)
        )
    ):
        fail("output must be a new JSON path below the evidence root")
    return path


def write_atomic_json(path: pathlib.Path, payload: dict) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Commit several sealed local media plans in one trim.media stop window."
    )
    parser.add_argument("--plan", action="append", required=True)
    parser.add_argument("--plan-sha256", action="append", required=True)
    parser.add_argument("--executor", required=True)
    parser.add_argument("--executor-sha256", required=True)
    parser.add_argument("--verification-cache-root")
    parser.add_argument("--verification-attempt-id")
    parser.add_argument("--verification-tool-sha256")
    parser.add_argument("--replacement-backup-evidence")
    parser.add_argument("--replacement-backup-evidence-sha256")
    parser.add_argument("--output")
    parser.add_argument("--execute", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    plans = load_plan_specs(args.plan, args.plan_sha256)
    executor = validate_executor(args.executor, args.executor_sha256)
    verification_cache_root = validate_verification_cache_root(
        args.verification_cache_root,
        args.verification_tool_sha256,
    )
    if verification_cache_root is not None and not args.verification_attempt_id:
        fail("verification attempt ID is required with the cache")
    replacement_backup_evidence = validate_replacement_backup_evidence(
        args.replacement_backup_evidence,
        args.replacement_backup_evidence_sha256,
    )
    if replacement_backup_evidence is not None and len(plans) != 1:
        fail("canonical replacement transaction requires exactly one plan")
    runtime = ProductionRuntime(
        executor,
        verification_cache_root,
        args.verification_attempt_id,
        args.verification_tool_sha256,
        replacement_backup_evidence,
        args.replacement_backup_evidence_sha256,
    )
    if not args.execute:
        preview = [
            {
                "workItemId": plan.work_item_id,
                **compact_executor_result(runtime.preflight(plan, "forward")),
            }
            for plan in plans
        ]
        print(
            json.dumps(
                {"execute": False, "planCount": len(plans), "preflight": preview},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
        return
    if os.geteuid() != 0:
        fail("formal local batch execution requires root")
    expected_self = validate_digest(
        os.environ.get("KT_SCRIPT_SHA256", ""), "KT_SCRIPT_SHA256"
    )
    if sha256_file(pathlib.Path(__file__)) != expected_self:
        fail("transaction script SHA-256 changed")
    if not args.output:
        fail("--output is required with --execute")
    output = validate_output(args.output)
    base = {
        "execute": True,
        "executor": {"path": os.fspath(executor), "sha256": args.executor_sha256},
        "plans": [
            {
                "path": os.fspath(plan.path),
                "replayKey": plan.replay_key,
                "sha256": plan.sha256,
                "workItemId": plan.work_item_id,
            }
            for plan in plans
        ],
        "schemaVersion": "media-local-batch-transaction-v1",
        "scriptSha256": expected_self,
    }
    try:
        result = {**base, **execute_batch(plans, runtime)}
        write_atomic_json(output, result)
        print(
            json.dumps(
                {
                    "committedWorkItemIds": result["committedWorkItemIds"],
                    "evidenceSha256": sha256_file(output),
                    "output": os.fspath(output),
                    "outputSha256": sha256_file(output),
                    "state": result["state"],
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
    except BatchTransactionError as error:
        result = {**base, **error.result, "error": str(error)}
        write_atomic_json(output, result)
        raise


def interrupted(signum, _frame) -> None:
    raise RuntimeError(f"received signal {signum}")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except Exception as error:  # noqa: BLE001 - CLI must emit one bounded diagnostic.
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
