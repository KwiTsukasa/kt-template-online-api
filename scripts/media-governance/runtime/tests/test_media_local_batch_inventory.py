#!/usr/bin/env python3
"""批量本地媒体探针的纯逻辑与安全边界测试。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT_PATH = Path(__file__).parents[1] / "media-local-batch-inventory.py"
SINGLE_PATH = Path(__file__).parents[1] / "media-local-inventory.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_local_batch_inventory", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media local batch inventory script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    single_spec = importlib.util.spec_from_file_location("media_local_inventory", SINGLE_PATH)
    if single_spec is None or single_spec.loader is None:
        raise RuntimeError("cannot load media local inventory script")
    single = importlib.util.module_from_spec(single_spec)
    single_spec.loader.exec_module(single)
    return module, single


class MediaLocalBatchInventoryTest(unittest.TestCase):
    def test_partitions_stable_video_count_waves(self):
        module, _ = load_module()

        self.assertEqual(module.wave(13), "small")
        self.assertEqual(module.wave(14), "medium")
        self.assertEqual(module.wave(40), "medium")
        self.assertEqual(module.wave(41), "large")

    def test_fails_closed_without_exact_database_episode_identity(self):
        module, single = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "unknown.mkv"
            video.write_bytes(b"video")
            result = module.summarize_title(
                single,
                {
                    "inventoryState": "inventory_pending",
                    "priority": "P2",
                    "sourcePath": str(root),
                    "videoCount": 1,
                    "workItemId": "media-999",
                },
                [video],
                {
                    str(video): {
                        "audioStreamCount": 1,
                        "durationSeconds": 60,
                        "playable": True,
                        "subtitleStreamCount": 0,
                        "videoStreamCount": 1,
                    }
                },
                {"rows": []},
            )

        self.assertEqual(
            result["localFirstClassification"],
            "identity-resolution-required-local-reuse",
        )
        self.assertEqual(result["maximumGovernanceVideoDownloadCount"], 0)

    def test_allows_only_exact_corrupt_episode_after_identity_resolution(self):
        module, single = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            videos = [root / "S01E01.mkv", root / "S01E02.mkv"]
            for video in videos:
                video.write_bytes(b"video")
            probes = {
                str(videos[0]): {
                    "audioStreamCount": 1,
                    "durationSeconds": 60,
                    "playable": True,
                    "subtitleStreamCount": 1,
                    "videoStreamCount": 1,
                },
                str(videos[1]): {
                    "audioStreamCount": 0,
                    "durationSeconds": 0,
                    "playable": False,
                    "subtitleStreamCount": 0,
                    "videoStreamCount": 0,
                },
            }
            rows = [
                {
                    "episode_number": index,
                    "path": str(video),
                    "season_number": 1,
                    "tmdb_id": 123,
                    "type": "Episode",
                }
                for index, video in enumerate(videos, 1)
            ]
            result = module.summarize_title(
                single,
                {
                    "inventoryState": "inventory_pending",
                    "priority": "P2",
                    "sourcePath": str(root),
                    "videoCount": 2,
                    "workItemId": "media-998",
                },
                videos,
                probes,
                {"rows": rows},
            )

        self.assertEqual(result["identityResolution"], "resolved")
        self.assertEqual(result["localFirstClassification"], "gap-only-video-acquisition")
        self.assertEqual(result["maximumGovernanceVideoDownloadCount"], 1)


if __name__ == "__main__":
    unittest.main()
