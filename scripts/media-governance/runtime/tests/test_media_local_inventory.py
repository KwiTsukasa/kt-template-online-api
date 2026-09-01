#!/usr/bin/env python3
"""本地媒体只读清点器的边界与命名解析回归测试。"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-inventory.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_local_inventory", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media local inventory script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLocalInventoryTest(unittest.TestCase):
    def test_accepts_only_exact_media_and_evidence_roots(self):
        module = load_module()
        source = pathlib.Path(
            "/vol2/1000/Media/movie/Alya.Sometimes.Hides.Her.Feelings.in.Russian"
        )
        output = pathlib.Path(
            "/vol1/docker/kt-media-governance/evidence/media-001-v1/inventory.json"
        )

        module.validate_paths(source, output)

        with self.assertRaisesRegex(RuntimeError, "source root"):
            module.validate_paths(pathlib.Path("/vol2/1000/Other/title"), output)
        with self.assertRaisesRegex(RuntimeError, "output path"):
            module.validate_paths(source, pathlib.Path("/tmp/inventory.json"))

    def test_accepts_stdout_only_without_a_nas_evidence_path(self):
        module = load_module()
        source = pathlib.Path(
            "/vol2/1000/Media/movie/[BDrip] The Idolmaster Cinderella Girls U149 S01 [343-Labs]"
        )

        module.validate_paths(source, None)

    def test_extracts_episode_hints_without_duplicates(self):
        module = load_module()

        self.assertEqual(
            module.source_episode_hints("Title.S01E03.Episode-03.[03].mkv"),
            [3],
        )
        self.assertEqual(module.source_episode_hints("Title 12.mp4"), [])

    def test_extracts_release_style_dash_episode_hint(self):
        module = load_module()

        self.assertEqual(
            module.source_episode_hints(
                "[Nekomoe kissaten&LoliHouse] Dandadan - 01 [WebRip 1080p].mkv"
            ),
            [1],
        )

    def test_classifies_video_subtitle_and_asset_files(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            video = root / "episode.mkv"
            subtitle = root / "episode.zh-CN.ass"
            asset = root / "poster.jpg"
            for path in (video, subtitle, asset):
                path.write_bytes(b"test")

            result = module.classify_files([asset, subtitle, video])

        self.assertEqual(result["videos"], [video])
        self.assertEqual(result["subtitles"], [subtitle])
        self.assertEqual(result["assets"], [asset])

    def test_scopes_user_state_to_episode_season_and_tv_without_library_parent(self):
        module = load_module()
        rows = [
            {
                "item_guid": "episode-01",
                "parent_guid": "season-01",
                "parent_type": "Season",
                "grandparent_guid": "series",
                "grandparent_type": "TV",
            },
            {
                "item_guid": "episode-02",
                "parent_guid": "season-01",
                "parent_type": "Season",
                "grandparent_guid": "series",
                "grandparent_type": "TV",
            },
            {
                "item_guid": "movie",
                "parent_guid": "library",
                "parent_type": "Directory",
                "grandparent_guid": None,
                "grandparent_type": None,
            },
        ]

        self.assertEqual(
            module.scoped_user_state_item_guids(rows),
            ["episode-01", "episode-02", "movie", "season-01", "series"],
        )


if __name__ == "__main__":
    unittest.main()
