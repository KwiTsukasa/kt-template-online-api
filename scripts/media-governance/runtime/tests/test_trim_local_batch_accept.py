#!/usr/bin/env python3
"""trim.media 本地批次独立验收脚本的最小回归测试。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "trim-local-batch-accept.py"


def load_module():
    spec = importlib.util.spec_from_file_location("trim_local_batch_accept", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load trim local batch acceptance script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TrimLocalBatchAcceptTest(unittest.TestCase):
    def test_projects_sha_bound_sidecar_source_hashes_for_owned_cleanup(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            manifest = pathlib.Path(directory) / "subtitle-manifest.json"
            info_hash = "0123456789abcdef0123456789abcdef01234567"
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": "subtitle-package-manifest-v1",
                        "sourceUrl": f"urn:btih:{info_hash}",
                        "workItemId": "media-057",
                    }
                ),
                encoding="utf-8",
            )
            plans = {
                "media-057": {
                    "subtitleEvidence": [
                        {
                            "evidenceMethod": "subtitle-package-manifest-sha256-v1",
                            "manifestPath": str(manifest),
                            "manifestSha256": module.sha256(manifest),
                        }
                    ],
                    "workItemId": "media-057",
                }
            }

            result = module.subtitle_source_info_hashes(plans)

        self.assertEqual(result, [info_hash])

    def test_reports_the_written_acceptance_digest_for_owned_cleanup(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "acceptance.json"
            output.write_text('{"state":"local-batch-accepted"}\n', encoding="utf-8")

            result = module.acceptance_result_summary(
                {"state": "local-batch-accepted"}, output
            )

            self.assertEqual(result["evidenceSha256"], module.sha256(output))
            self.assertEqual(result["state"], "local-batch-accepted")

    def test_maps_bundle_targets_to_tv_and_movie_contracts(self):
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

        self.assertEqual(
            module.component_key_for_target_path(
                contracts,
                "/media/TV/No Game No Life/Season 01/episode.mkv",
            ),
            "media-047:tv-tmdb-60808",
        )
        self.assertEqual(
            module.component_key_for_target_path(
                contracts,
                "/media/Movies/No Game No Life Zero/movie.mkv",
            ),
            "media-047:movie-tmdb-445030",
        )

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

            values = module.nfo_values(str(video), "movie")

        self.assertEqual(values["title"], "No Game No Life Zero")
        self.assertEqual(values["year"], 2017)
        self.assertEqual(values["providerId"], "445030")

    def test_rejects_tv_nfo_without_complete_episode_metadata(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            video = pathlib.Path(directory) / "Title - S01E01.mkv"
            video.touch()
            video.with_suffix(".nfo").write_text(
                "<episodedetails><season>1</season><episode>1</episode>"
                "<thumb>Title - S01E01.jpg</thumb></episodedetails>",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "episode LocalNFO"):
                module.nfo_values(str(video), "tv")

    def test_projects_provider_and_display_episode_numbers_separately(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            video = pathlib.Path(directory) / "Title - S02E01.mkv"
            video.touch()
            video.with_suffix(".jpg").write_bytes(b"poster")
            video.with_suffix(".nfo").write_text(
                "<episodedetails><title>归乡</title><season>2</season>"
                "<episode>33</episode><displayseason>2</displayseason>"
                "<displayepisode>1</displayepisode><aired>2007-11-08</aired>"
                "<plot>剧情简介</plot><thumb>Title - S02E01.jpg</thumb>"
                "</episodedetails>",
                encoding="utf-8",
            )

            values = module.nfo_values(str(video), "tv")

        self.assertEqual(values["season"], 2)
        self.assertEqual(values["episode"], 1)
        self.assertEqual(values["providerSeason"], 2)
        self.assertEqual(values["providerEpisode"], 33)

    def test_normalizes_explicit_simplified_and_traditional_titles(self):
        module = load_module()
        self.assertEqual(module.stream_language({"title": "chs"}), "zh-CN")
        self.assertEqual(module.stream_language({"title": "简日"}), "zh-CN")
        self.assertEqual(module.stream_language({"title": "繁日"}), "zh-TW")
        self.assertEqual(module.stream_language({"language": "chi"}), "zh")

    def test_rejects_non_json_object(self):
        module = load_module()
        self.assertTrue(callable(module.validate_playback))

    def test_accepts_official_explicit_simplified_chinese_stream(self):
        module = load_module()
        api_streams = [
            {"guid": "zh", "is_default": False, "title": "Simplified"},
            {"guid": "en", "is_default": True, "language": "eng"},
        ]
        source_streams = [
            {"default": 0, "language": "chi", "title": "Simplified"},
            {"default": 1, "language": "eng", "title": "English"},
        ]

        preferred, explicit = module.preferred_embedded_subtitle(
            api_streams,
            source_streams,
            selected_guid="zh",
        )

        self.assertEqual(preferred["guid"], "zh")
        self.assertTrue(explicit)

    def test_derives_exact_path_readd_count_from_every_plan(self):
        module = load_module()

        class Readd:
            @staticmethod
            def target_records(plan):
                return [{}] * plan["videoCount"]

        plans = {
            "media-046": {"videoCount": 37},
            "media-048": {"videoCount": 35},
            "media-059": {"videoCount": 52},
        }

        self.assertEqual(module.expected_exact_path_readd_count(plans, Readd), 124)

    def test_accepts_one_external_ass_beside_sealed_embedded_streams(self):
        module = load_module()
        streams = [
            {
                "codec_name": "hdmv_pgs_subtitle",
                "guid": "embedded-en",
                "is_external": False,
                "language": "eng",
            },
            {
                "codec_name": "ass",
                "guid": "external-zh",
                "is_external": True,
                "title": "zh-CN",
            },
        ]
        source_streams = [{"codec_name": "hdmv_pgs_subtitle", "language": "eng"}]

        preferred, embedded_count, external_count = module.preferred_external_subtitle(
            streams, source_streams
        )

        self.assertEqual(preferred["guid"], "external-zh")
        self.assertEqual(embedded_count, 1)
        self.assertEqual(external_count, 1)

    def test_accepts_external_subrip_but_rejects_unsealed_webvtt(self):
        module = load_module()
        subrip = [
            {
                "codec_name": "subrip",
                "guid": "external-zh-srt",
                "is_external": True,
                "title": "zh-CN",
            }
        ]

        preferred, embedded_count, external_count = module.preferred_external_subtitle(
            subrip, []
        )

        self.assertEqual(preferred["guid"], "external-zh-srt")
        self.assertEqual((embedded_count, external_count), (0, 1))
        with self.assertRaisesRegex(RuntimeError, "contract changed"):
            module.preferred_external_subtitle(
                [
                    {
                        "codec_name": "webvtt",
                        "guid": "external-zh-vtt",
                        "is_external": True,
                        "title": "zh-CN",
                    }
                ],
                [],
            )

    def test_accepts_one_sha_gated_hidden_subtitle_preference(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            database = root / "trimmedia.db"
            with sqlite3.connect(database) as connection:
                connection.executescript(
                    """
                    CREATE TABLE item_user_favorite (value TEXT);
                    CREATE TABLE item_user (value TEXT);
                    CREATE TABLE item_user_play (
                        item_guid TEXT,
                        media_guid TEXT,
                        video_guid TEXT,
                        audio_guid TEXT,
                        subtitle_guid TEXT,
                        resolution TEXT,
                        bitrate INTEGER,
                        direct_link_audio_index INTEGER,
                        ts INTEGER,
                        visible INTEGER,
                        watched INTEGER
                    );
                    """
                )
                connection.execute(
                    "INSERT INTO item_user_play VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        "item-guid",
                        "media-guid",
                        "video-guid",
                        "audio-guid",
                        "external-zh",
                        "1080P",
                        8_000_000,
                        -1,
                        0,
                        0,
                        0,
                    ),
                )
            evidence = {
                "schemaVersion": "trim-local-hidden-subtitle-preference-v1",
                "state": "hidden-subtitle-preference-established",
                "priorGlobalUserState": {"favorite": 0, "itemUser": 0, "play": 0},
                "finalGlobalUserState": {"favorite": 0, "itemUser": 0, "play": 1},
                "visiblePlaybackHistoryCount": 0,
                "mutationBoundaries": {
                    "cloudWrites": 0,
                    "databaseDirectWrite": False,
                    "officialPlayRecordDeleteCount": 1,
                    "officialPlayRecordPostCount": 1,
                    "uiWrites": 0,
                },
                "seeds": [
                    {
                        "audioGuid": "audio-guid",
                        "bitrate": 8_000_000,
                        "directLinkAudioIndex": -1,
                        "itemGuid": "item-guid",
                        "mediaGuid": "media-guid",
                        "resolution": "1080P",
                        "subtitleGuid": "external-zh",
                        "ts": 0,
                        "videoGuid": "video-guid",
                        "visible": 0,
                        "watched": 0,
                        "workItemId": "media-058",
                    }
                ],
            }
            evidence_path = root / "preference.json"
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            evidence_sha = hashlib.sha256(evidence_path.read_bytes()).hexdigest()
            original_connect_readonly = module.connect_readonly
            module.connect_readonly = lambda path=database: original_connect_readonly(database)
            try:
                result = module.validate_hidden_preference_evidence(
                    evidence_path,
                    evidence_sha,
                    {"media-058": {}},
                    {
                        "media-058": [
                            {"item_guid": "item-guid", "media_guid": "media-guid"}
                        ]
                    },
                    evidence["priorGlobalUserState"],
                )
                evidence["visiblePlaybackHistoryCount"] = 1
                evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
                changed_sha = hashlib.sha256(evidence_path.read_bytes()).hexdigest()
                with self.assertRaisesRegex(RuntimeError, "boundary changed"):
                    module.validate_hidden_preference_evidence(
                        evidence_path,
                        changed_sha,
                        {"media-058": {}},
                        {
                            "media-058": [
                                {"item_guid": "item-guid", "media_guid": "media-guid"}
                            ]
                        },
                        evidence["priorGlobalUserState"],
                    )
            finally:
                module.connect_readonly = original_connect_readonly

        self.assertEqual(result["hiddenPreferenceCount"], 1)
        self.assertEqual(result["playByWorkItem"], {"media-058": 1})
        self.assertEqual(result["visiblePlaybackHistoryCount"], 0)
        self.assertEqual(result["finalGlobalUserState"]["play"], 1)

    def test_external_contract_rejects_unsealed_extra_embedded_stream(self):
        module = load_module()
        streams = [
            {"codec_name": "subrip", "is_external": False, "language": "eng"},
            {"codec_name": "ass", "is_external": True, "title": "zh-CN"},
        ]

        with self.assertRaisesRegex(RuntimeError, "contract changed"):
            module.preferred_external_subtitle(streams, [])

    def test_accepts_mixed_external_and_explicit_gap_bundle_components(self):
        module = load_module()

        class Helper:
            @staticmethod
            def request(path, method="GET", payload=None):
                if path.endswith("external-item"):
                    data = {
                        "subtitle_streams": [
                            {
                                "codec_name": "ass",
                                "guid": "external-zh",
                                "is_external": True,
                                "media_guid": "external-media",
                                "title": "zh-CN",
                            }
                        ]
                    }
                elif path.endswith("gap-item"):
                    data = {"subtitle_streams": []}
                elif path == "/v/api/v1/play/info":
                    item_guid = payload["item_guid"]
                    data = {
                        "media_guid": (
                            "external-media" if item_guid == "external-item" else "gap-media"
                        ),
                        "subtitle_guid": "",
                    }
                else:
                    raise AssertionError(path)
                return {"body": {"code": 0, "data": data}, "httpStatus": 200}

            @staticmethod
            def require_ok(response, _label):
                return response["body"]["data"]

        plan = {
            "workItemId": "media-039",
            "identity": {
                "mediaType": "bundle",
                "provider": "tmdb",
                "components": [
                    {
                        "componentId": "external-component",
                        "mediaType": "movie",
                        "provider": "tmdb",
                        "providerId": "1",
                        "targetRoot": "/target/external",
                    },
                    {
                        "componentId": "gap-component",
                        "mediaType": "movie",
                        "provider": "tmdb",
                        "providerId": "2",
                        "targetRoot": "/target/gap",
                    },
                ],
            },
            "execution": {"allowlists": {"localTargetRoot": "/target"}},
            "manifests": {
                "local": {
                    "forward": [
                        {
                            "evidenceId": "external-video",
                            "fileKind": "video",
                            "targetPath": "/target/external/movie.mkv",
                        },
                        {
                            "evidenceId": "external-subtitle",
                            "fileKind": "subtitle",
                            "targetPath": "/target/external/movie.zh-CN.ass",
                        },
                        {
                            "evidenceId": "gap-video",
                            "fileKind": "video",
                            "targetPath": "/target/gap/movie.mkv",
                        },
                    ]
                }
            },
            "sourceEvidence": [
                {"evidenceId": "external-video", "path": "/source/external.mkv"},
                {"evidenceId": "gap-video", "path": "/source/gap.mkv"},
            ],
            "subtitleDecision": {
                "gapComponents": [{"componentId": "gap-component"}]
            },
            "subtitleEvidence": [
                {"evidenceMethod": "subtitle-package-manifest-sha256-v1"}
            ],
        }
        plan["_identityContracts"] = module.plan_identity_contracts(plan)
        inventory = {
            "files": {
                "videos": [
                    {"path": "/source/external.mkv", "streams": []},
                    {"path": "/source/gap.mkv", "streams": []},
                ]
            }
        }
        rows = {
            "media-039:external-component": [
                {
                    "item_guid": "external-item",
                    "media_guid": "external-media",
                    "path": "/target/external/movie.mkv",
                }
            ],
            "media-039:gap-component": [
                {
                    "item_guid": "gap-item",
                    "media_guid": "gap-media",
                    "path": "/target/gap/movie.mkv",
                }
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            bundle = pathlib.Path(directory) / "player.js"
            bundle.write_text(module.PLAYER_FALLBACK_CONTRACT, encoding="utf-8")
            original = module.PLAYER_BUNDLE
            module.PLAYER_BUNDLE = bundle
            try:
                result = module.validate_playback(
                    Helper(),
                    {"media-039": plan},
                    {"media-039": inventory},
                    rows,
                )
            finally:
                module.PLAYER_BUNDLE = original

        self.assertEqual(result["automaticSimplifiedChineseCount"], 1)
        self.assertEqual(result["explicitSubtitleGapCount"], 1)
        self.assertEqual(result["externalSubtitleStreamCount"], 1)
        self.assertEqual(result["fallbackSelectionCount"], 1)

    def test_standard_tv_season_gap_is_treated_as_a_gap_component(self):
        module = load_module()
        plan = {
            "workItemId": "media-035",
            "identity": {
                "canonicalTitle": "Title",
                "mediaType": "tv",
                "provider": "tmdb",
                "providerId": "69292",
                "year": 2017,
            },
            "execution": {
                "allowlists": {
                    "localTargetRoot": "/target/Title (2017) [tmdbid-69292]"
                }
            },
            "manifests": {"local": {"forward": []}},
            "subtitleDecision": {
                "assignments": [],
                "gapSeasons": [1],
                "mode": "season-gap",
            },
            "subtitleEvidence": [],
        }

        contracts = module.plan_identity_contracts(plan)

        self.assertEqual(module.subtitle_gap_component_ids(plan), {"media-035"})
        self.assertEqual(
            module.subtitle_delivery_mode(plan, contracts["media-035"]),
            "gap",
        )

    def test_accepts_sealed_burned_in_episode_without_subtitle_streams(self):
        module = load_module()

        class Helper:
            @staticmethod
            def request(path, method="GET", payload=None):
                if path.startswith("/v/api/v1/stream/list/"):
                    data = {"subtitle_streams": []}
                elif path == "/v/api/v1/play/info":
                    data = {"media_guid": "media-guid", "subtitle_guid": ""}
                else:
                    raise AssertionError(path)
                return {"body": {"code": 0, "data": data}, "httpStatus": 200}

            @staticmethod
            def require_ok(response, _label):
                return response["body"]["data"]

        plan = {
            "manifests": {
                "local": {
                    "forward": [
                        {
                            "evidenceId": "video-evidence",
                            "fileKind": "video",
                            "targetPath": "/target/episode-01.mkv",
                        }
                    ]
                }
            },
            "sourceEvidence": [
                {
                    "evidenceId": "video-evidence",
                    "path": "/source/episode-01.mkv",
                }
            ],
            "subtitleEvidence": [
                {"evidenceMethod": "burned-in-frame-manifest-sha256-v1"}
            ],
        }
        inventory = {
            "files": {
                "videos": [
                    {"path": "/source/episode-01.mkv", "streams": []}
                ]
            }
        }
        rows = {
            "media-031": [
                {
                    "item_guid": "item-guid",
                    "media_guid": "media-guid",
                    "path": "/target/episode-01.mkv",
                }
            ]
        }
        with tempfile.TemporaryDirectory() as directory:
            bundle = pathlib.Path(directory) / "player.js"
            bundle.write_text(module.PLAYER_FALLBACK_CONTRACT, encoding="utf-8")
            original = module.PLAYER_BUNDLE
            module.PLAYER_BUNDLE = bundle
            try:
                result = module.validate_playback(
                    Helper(),
                    {"media-031": plan},
                    {"media-031": inventory},
                    rows,
                )
            finally:
                module.PLAYER_BUNDLE = original

        self.assertEqual(result["automaticSimplifiedChineseCount"], 1)
        self.assertEqual(result["burnedInSubtitleEpisodeCount"], 1)
        self.assertEqual(result["embeddedSubtitleStreamCount"], 0)
        self.assertEqual(result["externalSubtitleStreamCount"], 0)
        self.assertEqual(result["fallbackSelectionCount"], 0)


if __name__ == "__main__":
    unittest.main()
