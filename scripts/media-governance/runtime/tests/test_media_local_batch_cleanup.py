#!/usr/bin/env python3
"""本地媒体批次清理脚本的最小回归测试。"""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-local-batch-cleanup.py"


def load_module():
    spec = importlib.util.spec_from_file_location("media_local_batch_cleanup", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load media local batch cleanup script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MediaLocalBatchCleanupTest(unittest.TestCase):
    def test_prunes_empty_staging_ancestors_without_removing_fixed_parent(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            parent = pathlib.Path(temporary) / "staging"
            leaf = parent / "run" / "work-item"
            leaf.mkdir(parents=True)

            module.prune_empty_ancestors(leaf, parent)

            self.assertTrue(parent.is_dir())
            self.assertFalse((parent / "run").exists())

    def test_requires_specific_child_of_fixed_parent(self):
        module = load_module()
        module.require_child(
            pathlib.Path("/vol2/1000/.kt-media-governance-staging/item"),
            module.STAGING_PARENT,
            "test",
        )
        with self.assertRaisesRegex(RuntimeError, "outside"):
            module.require_child(
                pathlib.Path("/vol2/1000/Media/item"),
                module.STAGING_PARENT,
                "test",
            )

    def test_removes_only_explicit_tree_entries(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "exact"
            file_path = root / "child" / "file.txt"
            file_path.parent.mkdir(parents=True)
            file_path.write_text("x", encoding="utf-8")
            files, directories = module.tree_entries(root)
            module.remove_tree(root, files, directories)
            self.assertFalse(root.exists())

    def test_accepts_omitted_acquisition_pair_and_rejects_partial_pair(self):
        module = load_module()

        self.assertFalse(module.has_acquisition_bundle(None, None))
        with self.assertRaisesRegex(RuntimeError, "supplied together"):
            module.has_acquisition_bundle("/tmp/acquisition", None)
        with self.assertRaisesRegex(RuntimeError, "supplied together"):
            module.has_acquisition_bundle(None, "a" * 64)

    def test_bundle_canonical_roots_do_not_expand_to_library_root(self):
        module = load_module()
        plan = {
            "identity": {
                "mediaType": "bundle",
                "components": [
                    {"targetRoot": "/media/TV/Series"},
                    {"targetRoot": "/media/Movies/Movie"},
                ],
            },
            "execution": {"allowlists": {"localTargetRoot": "/media"}},
        }

        roots = module.canonical_target_roots(plan)

        self.assertEqual(
            roots,
            [pathlib.Path("/media/TV/Series"), pathlib.Path("/media/Movies/Movie")],
        )

    def test_discard_tree_digest_changes_with_file_content(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "discard"
            path = root / "nested" / "file.ass"
            path.parent.mkdir(parents=True)
            path.write_text("first", encoding="utf-8")
            files, _directories = module.tree_entries(root)
            first = module.tree_digest(root, files)
            path.write_text("second", encoding="utf-8")
            files, _directories = module.tree_entries(root)
            second = module.tree_digest(root, files)

        self.assertNotEqual(first, second)
        self.assertEqual(len(first), 64)
        self.assertEqual(len(second), 64)


if __name__ == "__main__":
    unittest.main()
