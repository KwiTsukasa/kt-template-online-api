#!/usr/bin/env python3
"""TMDB 季元数据只读采集器的解析与边界回归测试。"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest
import urllib.error
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).parents[1] / "media-tmdb-season-capture.py"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "media_tmdb_season_capture", SCRIPT_PATH
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load TMDB season capture script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SEASON_HTML = """
<html><head>
<title>示例剧集: 第一季 (2024) — The Movie Database (TMDB)</title>
<meta property="og:image" content="https://media.themoviedb.org/t/p/w500/season.jpg">
</head><body><div class="episode_list">
<div class="card" data-url="/tv/1-title/season/1/episode/1?language=zh-CN">
  <img class="backdrop w-full" src="https://media.themoviedb.org/t/p/w227_and_h127_face/e01.jpg">
  <span class="episode_number">1</span>
  <div class="episode_title"><h3><a>第一集</a></h3>
  <span class="date">2024 年 01 月 02 日</span><span class="runtime">24m</span></div>
  <div class="overview"><p>第一段。</p><p>第二段。</p><a>展开</a></div>
</div>
<div class="card" data-url="/tv/1-title/season/1/episode/2?language=zh-CN">
  <img class="backdrop" src="https://media.themoviedb.org/t/p/w227_and_h127_face/e02.jpg">
  <span class="episode_number">2</span>
  <div class="episode_title"><h3><a>第二集</a></h3>
  <span class="date">2024 年 01 月 09 日</span></div>
  <div class="overview"><p>简介。</p></div>
</div></div></body></html>
"""


SERIES_HTML = """
<html><head>
<title>示例剧集 (TV Series 2024) — The Movie Database (TMDB)</title>
<meta name="description" content="剧集简介">
<meta property="og:image" content="https://media.themoviedb.org/t/p/w500/poster.jpg">
<meta property="og:image" content="https://media.themoviedb.org/t/p/w780/backdrop.jpg">
</head><body>
<a href="/tv/1/season/1?language=zh-CN">第 1 季</a>
<a href="/tv/1/season/1/episode/2?language=zh-CN">第 2 集</a>
</body></html>
"""


MOVIE_HTML = """
<html><head>
<title>咒术回战0 (2022) — The Movie Database (TMDB)</title>
<meta name="description" content="乙骨忧太与诅咒的故事。">
<meta property="og:image" content="https://media.themoviedb.org/t/p/w500/movie-poster.jpg">
</head></html>
"""


class MediaTmdbSeasonCaptureTest(unittest.TestCase):
    def test_parses_a_movie_identity_and_original_poster(self):
        module = load_module()

        self.assertEqual(
            module.parse_movie_page(MOVIE_HTML),
            {
                "artworkUrls": [
                    "https://image.tmdb.org/t/p/original/movie-poster.jpg"
                ],
                "description": "乙骨忧太与诅咒的故事。",
                "title": "咒术回战0",
                "year": 2022,
            },
        )

    def test_surfaces_a_permanent_404_without_three_identical_retries(self):
        module = load_module()
        error = urllib.error.HTTPError(
            "https://www.themoviedb.org/tv/1/season/0",
            404,
            "Not Found",
            {},
            None,
        )
        with mock.patch.object(
            module.urllib.request, "urlopen", side_effect=error
        ) as urlopen:
            with self.assertRaises(module.TmdbHttpError) as raised:
                module.fetch_page("https://www.themoviedb.org/tv/1/season/0")

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(urlopen.call_count, 1)

    def test_retries_transient_tls_eof_with_a_bounded_backoff(self):
        module = load_module()
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = b"ok"
        response.status = 200
        response.url = "https://www.themoviedb.org/tv/1"
        transient = urllib.error.URLError(
            "TLS/SSL connection has been closed (EOF)"
        )
        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=[transient, transient, response],
        ) as urlopen, mock.patch.object(module.time, "sleep") as sleep:
            result = module.fetch_page("https://www.themoviedb.org/tv/1")

        self.assertEqual(result["status"], 200)
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(
            [call.args[0] for call in sleep.call_args_list],
            [1, 2, module.PAGE_FETCH_SUCCESS_DELAY_SECONDS],
        )
        response.read.assert_called_once_with(module.PAGE_FETCH_MAX_BYTES + 1)

    def test_rejects_a_urllib_redirect_outside_the_fixed_tmdb_host(self):
        module = load_module()
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = b"ok"
        response.status = 200
        response.url = "https://example.invalid/movie/810693"
        with mock.patch.object(
            module.urllib.request, "urlopen", return_value=response
        ), mock.patch.object(module.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "escaped the fixed HTTPS host"):
                module.fetch_page(
                    "https://www.themoviedb.org/movie/810693?language=zh-CN"
                )

    def test_switches_to_tls12_after_three_default_tls_failures(self):
        module = load_module()
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = b"ok"
        response.status = 200
        response.url = "https://www.themoviedb.org/tv/31910"
        transient = urllib.error.URLError(
            "TLS/SSL connection has been closed (EOF)"
        )
        contexts = [mock.MagicMock() for _ in range(4)]
        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=[transient, transient, transient, response],
        ), mock.patch.object(
            module.ssl,
            "create_default_context",
            side_effect=contexts,
        ), mock.patch.object(module.time, "sleep"):
            result = module.fetch_page("https://www.themoviedb.org/tv/31910")

        self.assertEqual(result["status"], 200)
        self.assertEqual(contexts[3].minimum_version, module.ssl.TLSVersion.TLSv1_2)
        self.assertEqual(contexts[3].maximum_version, module.ssl.TLSVersion.TLSv1_2)

    def test_tls_failure_names_the_exact_tmdb_page_without_query_spill(self):
        module = load_module()
        transient = urllib.error.URLError(
            "TLS/SSL connection has been closed (EOF)"
        )
        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=transient,
        ), mock.patch.object(
            module,
            "curl_fetch_page",
            side_effect=RuntimeError("curl TLS EOF"),
        ), mock.patch.object(module.time, "sleep"):
            with self.assertRaisesRegex(
                RuntimeError,
                r"www\.themoviedb\.org/tv/31910/season/2\?language=zh-CN",
            ):
                module.fetch_page(
                    "https://www.themoviedb.org/tv/31910/season/2"
                    "?language=zh-CN&ignored=not-reported"
                )

    def test_falls_back_to_bounded_curl_after_urllib_tls_exhaustion(self):
        module = load_module()
        transient = urllib.error.URLError(
            "TLS/SSL connection has been closed (EOF)"
        )
        fallback = {
            "body": "ok",
            "bytes": 2,
            "finalUrl": "https://www.themoviedb.org/tv/31910",
            "sha256": "0" * 64,
            "status": 200,
            "transport": "curl-http1.1",
            "url": "https://www.themoviedb.org/tv/31910",
        }
        with mock.patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=transient,
        ) as urlopen, mock.patch.object(
            module, "curl_fetch_page", return_value=fallback
        ) as curl_fetch, mock.patch.object(module.time, "sleep"):
            result = module.fetch_page("https://www.themoviedb.org/tv/31910")

        self.assertEqual(urlopen.call_count, module.PAGE_FETCH_ATTEMPTS)
        curl_fetch.assert_called_once_with("https://www.themoviedb.org/tv/31910")
        self.assertEqual(result["transport"], "curl-http1.1")

    def test_curl_transport_keeps_the_fixed_https_host_and_output_bound(self):
        module = load_module()

        def run(command, **_kwargs):
            output = pathlib.Path(command[command.index("--output") + 1])
            output.write_bytes(b"<html>ok</html>")
            return module.subprocess.CompletedProcess(
                command,
                0,
                stdout="200\nhttps://www.themoviedb.org/tv/31910",
                stderr="",
            )

        with mock.patch.object(module.subprocess, "run", side_effect=run) as execute:
            result = module.curl_fetch_page(
                "https://www.themoviedb.org/tv/31910"
            )

        command = execute.call_args.args[0]
        self.assertIn("--max-filesize", command)
        self.assertIn(str(module.PAGE_FETCH_MAX_BYTES), command)
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["transport"], "curl-http1.1")

    def test_rejects_non_tmdb_page_hosts_before_network_access(self):
        module = load_module()
        with mock.patch.object(module.urllib.request, "urlopen") as urlopen:
            with self.assertRaisesRegex(RuntimeError, "fixed HTTPS host"):
                module.fetch_page("https://example.com/tv/31910")

        urlopen.assert_not_called()

    def test_reports_the_written_metadata_digest_for_pipeline_chaining(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            output = pathlib.Path(temporary) / "metadata.json"
            output.write_text('{"status":"tmdb-season-captured"}\n', encoding="utf-8")
            payload = {
                "identity": {"observedProviderTitle": "示例剧集"},
                "mapping": {"localVideoCount": 12},
                "mutationBoundaries": {"formalMediaWrites": 0},
                "status": "tmdb-season-captured",
                "workItemId": "media-001",
            }

            result = module.capture_result_summary(payload, output)

            self.assertEqual(result["evidenceSha256"], module.sha256_file(output))
            self.assertEqual(result["outputPath"], str(output))

    def test_parses_episode_cards_and_original_artwork_urls(self):
        module = load_module()

        result = module.parse_season_page(SEASON_HTML, season_number=1)

        self.assertEqual(result["seasonArtworkUrl"], "https://image.tmdb.org/t/p/original/season.jpg")
        self.assertEqual(result["seasonTitle"], "第一季")
        self.assertEqual(
            result["episodes"],
            [
                {
                    "aired": "2024-01-02",
                    "episode": 1,
                    "imageUrl": "https://image.tmdb.org/t/p/original/e01.jpg",
                    "overview": "第一段。\n第二段。",
                    "runtime": "24m",
                    "title": "第一集",
                },
                {
                    "aired": "2024-01-09",
                    "episode": 2,
                    "imageUrl": "https://image.tmdb.org/t/p/original/e02.jpg",
                    "overview": "简介。",
                    "runtime": None,
                    "title": "第二集",
                },
            ],
        )

    def test_parses_series_identity_hints(self):
        module = load_module()

        result = module.parse_series_page(SERIES_HTML)

        self.assertEqual(result["title"], "示例剧集")
        self.assertEqual(result["year"], 2024)
        self.assertEqual(result["description"], "剧集简介")
        self.assertEqual(result["seasonNumbers"], [1])
        self.assertEqual(
            result["artworkUrls"],
            [
                "https://image.tmdb.org/t/p/original/poster.jpg",
                "https://image.tmdb.org/t/p/original/backdrop.jpg",
            ],
        )

    def test_classifies_provider_episode_count_mismatch_without_download(self):
        module = load_module()

        result = module.classify_mapping(local_video_count=13, provider_episode_count=28)

        self.assertEqual(result["route"], "requires-provider-coverage-review")
        self.assertEqual(result["videoDownloadDecision"], "closed-pending-coverage-review")
        self.assertEqual(result["maximumGovernanceVideoDownloadCount"], 0)

    def test_classifies_exact_local_episode_subset_without_video_download(self):
        module = load_module()
        local = {1: 1422.0, 2: 1422.0}
        provider = [
            {"episode": 1, "runtime": "24m"},
            {"episode": 2, "runtime": "24m"},
            {"episode": 3, "runtime": "24m"},
        ]

        result = module.classify_episode_coverage(local, provider)

        self.assertEqual(result["route"], "explicit-local-episode-subset")
        self.assertEqual(result["localEpisodes"], [1, 2])
        self.assertEqual(result["providerOnlyEpisodes"], [3])
        self.assertEqual(result["videoDownloadDecision"], "not-needed")
        self.assertEqual(result["maximumGovernanceVideoDownloadCount"], 0)

    def test_rejects_missing_provider_episode_or_duration_mismatch(self):
        module = load_module()

        with self.assertRaisesRegex(RuntimeError, "missing local episode"):
            module.classify_episode_coverage(
                {1: 1440.0, 2: 1440.0},
                [{"episode": 1, "runtime": "24m"}],
            )

        with self.assertRaisesRegex(RuntimeError, "runtime"):
            module.classify_episode_coverage(
                {1: 1440.0},
                [{"episode": 1, "runtime": "12m"}],
            )

    def test_identifies_one_mixed_sidecar_episode_against_season_majority(self):
        module = load_module()
        inventory = {
            "files": {
                "subtitles": [
                    {
                        "creditLines": ["本字幕由{\\c&HFFFFFF&}桜{\\c&H000000&}都字幕组制作"],
                        "sourceEpisodeHints": [1],
                    },
                    {
                        "creditLines": ["Original Script: BeanSub&FZSD"],
                        "sourceEpisodeHints": [2],
                    },
                    {
                        "creditLines": ["本字幕由樱都字幕组制作"],
                        "sourceEpisodeHints": [3],
                    },
                ]
            }
        }

        result = module.classify_subtitle_coverage(inventory)

        self.assertEqual(result["status"], "mixed-season-release-groups")
        self.assertEqual(result["selectedSeasonReleaseGroup"], "Sakurato")
        self.assertEqual(result["replacementEpisodes"], [2])

    def test_filters_a_multi_season_inventory_to_the_requested_season(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = root
            path = root / "inventory.json"
            videos = []
            rows = []
            for season, episode in ((1, 1), (1, 2), (2, 1)):
                video_path = f"/vol2/1000/Media/movie/Title/S{season:02d}E{episode:02d}.mkv"
                videos.append({"durationSeconds": 1440, "path": video_path})
                rows.append(
                    {
                        "episode_number": episode,
                        "grandparent_tmdb_id": 123,
                        "parent_season": season,
                        "path": video_path,
                        "type": "Episode",
                    }
                )
            path.write_text(
                json.dumps(
                    {
                        "database": {"rows": rows},
                        "files": {"videos": videos},
                        "mode": "local-only-readonly",
                        "workItemId": "media-001",
                    }
                ),
                encoding="utf-8",
            )

            durations, _inventory = module.load_inventory_episode_durations(
                path,
                work_item="media-001",
                provider_id=123,
                season=2,
            )

        self.assertEqual(durations, {1: 1440.0})

    def test_selects_target_provider_and_collapses_identical_official_rows(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            module.EVIDENCE_ROOT = root
            path = root / "inventory.json"
            target_path = "/vol2/1000/Media/movie/Collection/target.mkv"
            other_path = "/vol2/1000/Media/movie/Collection/movie.mkv"
            path.write_text(
                json.dumps(
                    {
                        "database": {
                            "rows": [
                                {
                                    "episode_number": 1,
                                    "grandparent_tmdb_id": 123,
                                    "parent_season": 1,
                                    "path": target_path,
                                    "type": "Episode",
                                },
                                {
                                    "episode_number": 1,
                                    "season_number": 1,
                                    "tmdb_id": 123,
                                    "path": target_path,
                                    "type": "Episode",
                                },
                                {
                                    "tmdb_id": 456,
                                    "path": other_path,
                                    "type": "Movie",
                                },
                            ]
                        },
                        "files": {
                            "videos": [
                                {"durationSeconds": 1440, "path": target_path},
                                {"durationSeconds": 7200, "path": other_path},
                            ]
                        },
                        "mode": "local-only-readonly",
                        "workItemId": "media-001",
                    }
                ),
                encoding="utf-8",
            )

            durations, _inventory = module.load_inventory_episode_durations(
                path,
                work_item="media-001",
                provider_id=123,
                season=1,
            )

            self.assertEqual(durations, {1: 1440.0})

            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["database"]["rows"].append(
                {"path": target_path, "tmdb_id": 456, "type": "Movie"}
            )
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "conflicting provider rows"):
                module.load_inventory_episode_durations(
                    path,
                    work_item="media-001",
                    provider_id=123,
                    season=1,
                )
            payload["database"]["rows"].pop()
            payload["database"]["rows"][1]["episode_number"] = 2
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "conflicting provider episode rows"):
                module.load_inventory_episode_durations(
                    path,
                    work_item="media-001",
                    provider_id=123,
                    season=1,
                )


if __name__ == "__main__":
    unittest.main()
