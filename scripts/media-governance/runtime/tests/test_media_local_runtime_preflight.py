#!/usr/bin/env python3
"""本地媒体流水线固定运行时身份预检测试。"""

from __future__ import annotations

import importlib.util
import pathlib
import sqlite3
import stat
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-runtime-preflight.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_local_runtime_preflight", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media local runtime preflight script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLocalRuntimePreflightTest(unittest.TestCase):
    def test_discovers_only_bounded_ast_verified_helper_candidates(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory)
            compatible = root / "evidence" / "compatible.py"
            compatible.parent.mkdir()
            compatible.write_text(
                "def active_admin_token():\n    return 'redacted'\n"
                "def request(path):\n    return {'path': path}\n"
                "def require_ok(response, label):\n    return response\n",
                encoding="utf-8",
            )
            (root / "unrelated.py").write_text(
                "def request(path):\n    return path\n", encoding="utf-8"
            )

            result = module.discover_helper_candidates(root)

        self.assertEqual(result["candidateCount"], 1)
        self.assertEqual(result["scannedPythonFileCount"], 2)
        self.assertFalse(result["truncated"])
        self.assertEqual(result["candidates"][0]["path"], str(compatible))
        self.assertEqual(
            result["candidates"][0]["requiredFunctions"],
            ["active_admin_token", "request", "require_ok"],
        )
        self.assertRegex(result["candidates"][0]["sha256"], r"^[0-9a-f]{64}$")
        self.assertNotIn("redacted", str(result))

    def test_prioritizes_likely_helper_names_before_the_ast_scan_limit(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory)
            (root / "000-unrelated.py").write_text(
                "def unrelated():\n    return None\n", encoding="utf-8"
            )
            helper = root / "zzz-trim-official-api-helper.py"
            helper.write_text(
                "def active_admin_token():\n    return 'redacted'\n"
                "def request(path):\n    return {'path': path}\n"
                "def require_ok(response, label):\n    return response\n",
                encoding="utf-8",
            )

            result = module.discover_helper_candidates(
                root, max_python_files=1
            )

        self.assertEqual(result["discoveredPythonFileCount"], 2)
        self.assertEqual(result["scannedPythonFileCount"], 1)
        self.assertEqual(result["candidateCount"], 1)
        self.assertEqual(result["candidates"][0]["path"], str(helper))
        self.assertTrue(result["truncated"])

    def test_installs_one_sha_bound_candidate_without_overwrite(self):
        module = load_module()
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = pathlib.Path(directory) / "governance"
            source = root / "evidence" / "compatible.py"
            source.parent.mkdir(parents=True)
            source.write_text(
                "def active_admin_token():\n    return 'redacted'\n"
                "def request(path):\n    return {'path': path}\n"
                "def require_ok(response, label):\n    return response\n",
                encoding="utf-8",
            )
            target = root / "private" / "trim-official-api-helper.py"
            source_sha256 = module.sha256(source)

            installed = module.install_helper_candidate(
                root, target, source_sha256
            )
            repeated = module.install_helper_candidate(
                root, target, source_sha256
            )

            self.assertEqual(target.read_bytes(), source.read_bytes())
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(installed["state"], "installed")
            self.assertEqual(repeated["state"], "already-installed")
            target.write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "refuses to overwrite"):
                module.install_helper_candidate(root, target, source_sha256)

    def test_binds_inventory_rows_to_one_series_and_source_root(self):
        module = load_module()
        payload = {
            "database": {
                "rows": [
                    {
                        "grandparent_guid": "series-guid",
                        "grandparent_tmdb_id": 88806,
                        "path": "/vol2/1000/Media/movie/街角魔族/S01E01.mkv",
                        "type": "Episode",
                    },
                    {
                        "grandparent_guid": "series-guid",
                        "grandparent_tmdb_id": 88806,
                        "path": "/vol2/1000/Media/movie/街角魔族/S02E01.mkv",
                        "type": "Episode",
                    },
                ]
            },
            "files": {
                "videos": [
                    {"path": "/vol2/1000/Media/movie/街角魔族/S01E01.mkv"},
                    {"path": "/vol2/1000/Media/movie/街角魔族/S02E01.mkv"},
                ]
            },
            "mode": "local-only-readonly",
            "schemaVersion": "1.0.0",
            "sourceRoot": "/vol2/1000/Media/movie/街角魔族",
            "summary": {"videoCount": 2},
            "workItemId": "media-057",
        }

        identity = module.inventory_identity(
            payload,
            work_item="media-057",
            source_path="/vol2/1000/Media/movie/街角魔族",
        )

        self.assertEqual(identity["providerIds"], [88806])
        self.assertEqual(identity["seriesGuids"], ["series-guid"])
        self.assertEqual(identity["videoCount"], 2)

    def test_requires_each_series_to_have_the_fixed_library_ancestor(self):
        module = load_module()
        with sqlite3.connect(":memory:") as connection:
            connection.execute(
                "CREATE TABLE item_ancestor (item_guid TEXT, ancestor_guid TEXT)"
            )
            connection.execute(
                "INSERT INTO item_ancestor VALUES (?, ?)",
                ("series-guid", "64b94942a1244a4aabc56ef80678044b"),
            )

            module.require_library_ancestry(
                connection,
                ["series-guid"],
                "64b94942a1244a4aabc56ef80678044b",
            )
            with self.assertRaisesRegex(RuntimeError, "library ancestry"):
                module.require_library_ancestry(
                    connection,
                    ["other-series"],
                    "64b94942a1244a4aabc56ef80678044b",
                )

    def test_projects_official_policy_without_tokens_or_response_payloads(self):
        module = load_module()

        class Helper:
            @staticmethod
            def request(path):
                if path == "/v/api/v1/task/running":
                    return {"body": [], "httpStatus": 200}
                return {
                    "body": {
                        "auto_scrap_subtitle": 0,
                        "guid": "64b94942a1244a4aabc56ef80678044b",
                        "prefer_local_nfo": 1,
                        "subtitle_lan": "zh-CN",
                    },
                    "httpStatus": 200,
                }

            @staticmethod
            def require_ok(response, _label):
                return response["body"]

        result = module.official_runtime_boundary(
            Helper(), "64b94942a1244a4aabc56ef80678044b"
        )

        self.assertEqual(
            result,
            {
                "autoScrapSubtitle": 0,
                "preferLocalNfo": 1,
                "runningTaskCount": 0,
                "subtitleLanguage": "zh-CN",
            },
        )
        self.assertNotIn("token", str(result).lower())


if __name__ == "__main__":
    unittest.main()
