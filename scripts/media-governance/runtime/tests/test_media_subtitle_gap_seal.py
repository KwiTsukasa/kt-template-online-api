#!/usr/bin/env python3
"""逐季字幕缺口密封器的纯函数回归测试。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-subtitle-gap-seal.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_subtitle_gap_seal", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load subtitle gap seal script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: pathlib.Path, payload: dict) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MediaSubtitleGapSealTest(unittest.TestCase):
    def fixture(self):
        module = load_module()
        root = pathlib.Path(tempfile.mkdtemp()) / "evidence"
        module.EVIDENCE_PARENT = root
        inventory_run = "remaining-one-20260811-v1"
        output_run = "media-043-local-closeout-v1"
        work_item = "media-043"
        info_hash = "c49280b76cbcbe9305bddaa9292dcfa6ac2529e2"
        inventory_path = root / inventory_run / f"{work_item}-local-inventory.json"
        videos = [
            {"path": f"/vol2/1000/Media/movie/旋转少女/E{episode:02d}.mkv"}
            for episode in (1, 2)
        ]
        inventory_sha = write_json(
            inventory_path,
            {
                "database": {
                    "rows": [
                        {
                            "episode_number": episode,
                            "parent_season": 1,
                            "path": videos[index]["path"],
                            "type": "Episode",
                        }
                        for index, episode in enumerate((1, 2))
                    ]
                },
                "files": {"videos": videos},
                "mode": "local-only-readonly",
                "workItemId": work_item,
            },
        )
        candidate_run = "media-043-probe-c492-v1"
        candidate_path = (
            root
            / candidate_run
            / f"{work_item}-s01-{info_hash}-subtitle-metadata.json"
        )
        candidate = {
            "infoHash": info_hash,
            "mutationBoundaries": {
                "cloudWrites": 0,
                "databaseDirectWrite": False,
                "formalMediaWrites": 0,
                "mechanicalScanTriggered": False,
                "payloadDownloads": 0,
                "uiWrites": 0,
            },
            "payloadDownloadedBytes": 0,
            "officialTaskRemoved": True,
            "schemaVersion": "media-subtitle-source-metadata-v1",
            "season": 1,
            "status": "metadata-ready",
            "subtitleFileCount": 0,
            "videoDownloadCount": 0,
            "videoFileCount": 12,
            "workItemId": work_item,
        }
        candidate_sha = write_json(candidate_path, candidate)
        contract_path = (
            root / output_run / f"{work_item}-s01-subtitle-gap-contract.json"
        )
        output_path = root / output_run / f"{work_item}-s01-subtitle-gap.json"
        contract = {
            "candidates": [
                {
                    "evidencePath": str(candidate_path),
                    "evidenceRunId": candidate_run,
                    "evidenceSha256": candidate_sha,
                    "infoHash": info_hash,
                    "sourceGroup": "漏勺rip",
                }
            ],
            "inventoryPath": str(inventory_path),
            "inventorySha256": inventory_sha,
            "outputPath": str(output_path),
            "requiredEpisodeCount": 2,
            "schemaVersion": "media-subtitle-gap-seal-contract-v1",
            "searches": [
                {"candidateCount": 10, "provider": "mikanani", "providerResultCount": 80, "query": "旋转少女"},
                {"candidateCount": 0, "provider": "bangumi-moe", "providerResultCount": 0, "query": "旋转少女"},
                {"candidateCount": 10, "provider": "nyaa", "providerResultCount": 53, "query": "The Rolling Girls"},
            ],
            "seasonNumber": 1,
            "workItemId": work_item,
        }
        write_json(contract_path, contract)
        return module, contract_path, contract, candidate_path

    def test_seals_complete_fixed_tier_failure_evidence(self):
        module, contract_path, _, _ = self.fixture()

        result = module.seal_gap(contract_path)

        self.assertEqual(result["payload"]["status"], "source-blocked")
        self.assertEqual(result["payload"]["requiredEpisodeCount"], 2)
        self.assertEqual(result["payload"]["selectedSource"], None)
        self.assertEqual(
            result["payload"]["candidates"][0]["outcome"],
            "metadata-ready-no-sidecar",
        )
        self.assertEqual(
            {row["provider"] for row in result["payload"]["fallbackSearch"]["queries"]},
            {"mikanani", "bangumi-moe", "nyaa"},
        )
        self.assertRegex(result["evidenceSha256"], r"^[a-f0-9]{64}$")

    def test_rejects_a_candidate_that_contains_downloadable_subtitles(self):
        module, contract_path, contract, candidate_path = self.fixture()
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        candidate["subtitleFileCount"] = 1
        contract["candidates"][0]["evidenceSha256"] = write_json(
            candidate_path, candidate
        )
        write_json(contract_path, contract)

        with self.assertRaisesRegex(RuntimeError, "downloadable subtitle"):
            module.seal_gap(contract_path)

    def test_rejects_an_incomplete_fixed_provider_set(self):
        module, contract_path, contract, _ = self.fixture()
        contract["searches"] = contract["searches"][:-1]
        write_json(contract_path, contract)

        with self.assertRaisesRegex(RuntimeError, "fixed provider set"):
            module.seal_gap(contract_path)


if __name__ == "__main__":
    unittest.main()
