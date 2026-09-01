#!/usr/bin/env python3
"""trim.media 批量本地重入库脚本的最小回归测试。"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "trim-local-batch-reindex.py"


def load_module():
    spec = importlib.util.spec_from_file_location("trim_local_batch_reindex", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load trim local batch reindex script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TrimLocalBatchReindexTest(unittest.TestCase):
    def test_waits_for_tasks_started_by_reindex_before_final_boundary(self):
        module = load_module()

        class Helper:
            def __init__(self):
                self.running = [[{"guid": "task-1"}], []]

            def request(self, route):
                if route == module.RUNNING_TASKS_ROUTE:
                    return self.running.pop(0)
                return {
                    "prefer_local_nfo": 1,
                    "auto_scrap_subtitle": 0,
                    "subtitle_lan": "zh-CN",
                }

            @staticmethod
            def require_ok(value, _label):
                return value

        helper = Helper()
        with (
            mock.patch.object(module.time, "monotonic", side_effect=[0, 0.1]),
            mock.patch.object(module.time, "sleep") as sleep,
            mock.patch.object(module, "emit_progress") as progress,
        ):
            module.wait_for_official_boundary(
                helper, "a" * 32, timeout=10, interval=0.25
            )

        sleep.assert_called_once_with(0.25)
        progress.assert_has_calls(
            [
                mock.call("official-task-settle", 0, 1),
                mock.call("official-task-settle", 1, 1),
            ]
        )

    def test_final_boundary_wait_fails_closed_after_timeout(self):
        module = load_module()

        class Helper:
            def request(self, route):
                if route == module.RUNNING_TASKS_ROUTE:
                    return [{"guid": "task-1"}]
                raise AssertionError("library policy must not be queried while tasks run")

            @staticmethod
            def require_ok(value, _label):
                return value

        with mock.patch.object(module.time, "monotonic", side_effect=[0, 2]):
            with self.assertRaisesRegex(RuntimeError, "running tasks"):
                module.wait_for_official_boundary(
                    Helper(), "a" * 32, timeout=1, interval=0.25
                )

    def test_reports_written_reindex_evidence_digest(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "reindex.json"
            output.write_text(
                '{"state":"local-metadata-committed"}\n', encoding="utf-8"
            )

            result = module.reindex_result_summary(
                {"state": "local-metadata-committed"}, output
            )
            expected = module.sha256(output)

        self.assertEqual(result["evidenceSha256"], expected)

    def test_reads_movie_nfo_without_episode_fields(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            video = pathlib.Path(directory) / "movie.mkv"
            video.touch()
            video.with_suffix(".nfo").write_text(
                "<movie><title>No Game No Life Zero</title><year>2017</year>"
                "<tmdbid>445030</tmdbid></movie>",
                encoding="utf-8",
            )

            values = module.nfo_identity(str(video), "movie")

        self.assertEqual(values["title"], "No Game No Life Zero")
        self.assertEqual(values["year"], 2017)
        self.assertEqual(values["providerId"], "445030")

    def test_maps_bundle_inventory_rows_and_targets_to_distinct_components(self):
        module = load_module()
        plan = {
            "workItemId": "media-047",
            "identity": {
                "mediaType": "bundle",
                "provider": "tmdb",
                "components": [
                    {
                        "componentId": "tv-tmdb-60808",
                        "mediaType": "tv",
                        "provider": "tmdb",
                        "providerId": "60808",
                        "targetRoot": "/media/TV/No Game No Life",
                        "videoCount": 12,
                    },
                    {
                        "componentId": "movie-tmdb-445030",
                        "mediaType": "movie",
                        "provider": "tmdb",
                        "providerId": "445030",
                        "targetRoot": "/media/Movies/No Game No Life Zero",
                        "videoCount": 1,
                    },
                ],
            },
            "execution": {"allowlists": {"localTargetRoot": "/media"}},
        }

        contracts = module.plan_identity_contracts(plan)

        self.assertEqual(set(contracts), {"media-047:tv-tmdb-60808", "media-047:movie-tmdb-445030"})
        self.assertEqual(
            module.component_key_for_inventory_row(
                contracts,
                {
                    "type": "Episode",
                    "grandparent_type": "TV",
                    "tmdb_id": 60808,
                },
            ),
            "media-047:tv-tmdb-60808",
        )
        self.assertEqual(
            module.component_key_for_inventory_row(
                contracts,
                {"type": "Movie", "tmdb_id": 445030},
            ),
            "media-047:movie-tmdb-445030",
        )
        self.assertEqual(
            module.component_key_for_target_path(
                contracts,
                "/media/Movies/No Game No Life Zero/movie.mkv",
            ),
            "media-047:movie-tmdb-445030",
        )

    def test_derives_tv_and_movie_root_without_falling_back_to_parent(self):
        module = load_module()
        self.assertEqual(
            module.root_guid_for_row(
                {
                    "type": "Episode",
                    "grandparent_type": "TV",
                    "grandparent_guid": "a" * 32,
                    "item_guid": "b" * 32,
                }
            ),
            "a" * 32,
        )
        self.assertEqual(
            module.root_guid_for_row({"type": "Movie", "item_guid": "c" * 32}),
            "c" * 32,
        )

    def test_rejects_unsupported_or_invalid_inventory_root(self):
        module = load_module()
        with self.assertRaisesRegex(RuntimeError, "supported TV/Movie root"):
            module.root_guid_for_row({"type": "Season", "item_guid": "a" * 32})
        with self.assertRaisesRegex(RuntimeError, "invalid root GUID"):
            module.root_guid_for_row(
                {
                    "type": "Episode",
                    "grandparent_type": "TV",
                    "grandparent_guid": "not-a-guid",
                }
            )

    def test_user_state_policy_discards_scoped_play_and_preserves_unrelated_rows(self):
        module = load_module()
        self.assertEqual(
            module.expected_global_after_delete(
                {"favorite": 11, "itemUser": 1, "play": 152},
                {"favorite": 1, "itemUser": 0, "play": 3},
            ),
            {"favorite": 10, "itemUser": 1, "play": 149},
        )
        self.assertEqual(
            module.expected_global_after_delete(
                {"favorite": 10, "itemUser": 1, "play": 149},
                {"favorite": 0, "itemUser": 0, "play": 17},
            ),
            {"favorite": 10, "itemUser": 1, "play": 132},
        )

    def test_resume_state_accounts_for_prior_orphan_cleanup_and_restored_favorite(self):
        module = load_module()

        self.assertEqual(
            module.expected_resume_user_state(
                {"favorite": 11, "itemUser": 1, "play": 128},
                deleted_old_state={"favorite": 1, "itemUser": 0, "play": 0},
                prior_orphan_state={"favorite": 0, "itemUser": 0, "play": 3},
                restored_favorite_count=1,
            ),
            {"favorite": 11, "itemUser": 1, "play": 125},
        )
        with self.assertRaisesRegex(RuntimeError, "restored favorite count"):
            module.expected_resume_user_state(
                {"favorite": 1, "itemUser": 0, "play": 0},
                deleted_old_state={"favorite": 0, "itemUser": 0, "play": 0},
                prior_orphan_state={"favorite": 0, "itemUser": 0, "play": 0},
                restored_favorite_count=2,
            )


if __name__ == "__main__":
    unittest.main()
