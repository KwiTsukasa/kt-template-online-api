#!/usr/bin/env python3
"""验证 Admin 媒体运行时的固定 Mikan 描述文件获取边界。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).parents[1] / "media-admin-runtime.py"
TORRENT_PATH = "/Download/20260626/df8d16777f4eceb9d9acadab7b01d815ad9f517a.torrent"


def load_module():
    spec = importlib.util.spec_from_file_location("media_admin_runtime", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load media Admin runtime")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, url: str, body: bytes):
        self.url = url
        self.body = body
        self.headers = {"Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback):
        return False

    def geturl(self) -> str:
        return self.url

    def read(self, _limit: int) -> bytes:
        return self.body


class MediaAdminRuntimeTest(unittest.TestCase):
    def test_page_projection_exposes_exact_discard_contract(self) -> None:
        module = load_module()
        task = {
            "activeRunId": None,
            "agentSession": None,
            "closedAt": None,
            "id": "media-task-01234567-89ab-4cde-8fab-0123456789ab",
            "metadataIdentity": None,
            "metadataStatus": "pending",
            "payloadSeal": None,
            "runState": "draft",
            "sealedPlan": None,
            "sealedPlanSha256": None,
            "sources": [],
            "stage": "intake",
            "units": [
                {
                    "evidenceSha256": None,
                    "localAcceptedAt": None,
                    "subtitleContract": None,
                }
            ],
            "workItemId": None,
        }

        projected = module.project_page_task(task)

        self.assertTrue(projected["canDiscard"])
        self.assertEqual(projected["sourceCount"], 0)
        self.assertEqual(projected["sourceIds"], [])

        task["sources"] = [
            {"id": "media-source-01234567-89ab-4cde-8fab-0123456789ab"}
        ]
        projected = module.project_page_task(task)
        self.assertFalse(projected["canDiscard"])
        self.assertEqual(projected["sourceCount"], 1)
        self.assertEqual(
            projected["sourceIds"],
            ["media-source-01234567-89ab-4cde-8fab-0123456789ab"],
        )

    def test_task_discard_uses_delete_and_does_not_read_deleted_task(self) -> None:
        module = load_module()
        task_id = "media-task-01234567-89ab-4cde-8fab-0123456789ab"

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                if method == "GET":
                    return {"id": task_id, "revision": 7}
                return {"deletedTaskId": task_id}

        client = FakeClient()
        result = module.execute(
            client,
            {
                "expectedRevision": 7,
                "operation": "task-discard",
                "taskId": task_id,
            },
        )

        self.assertEqual(result["commandResult"], {"deletedTaskId": task_id})
        self.assertEqual(
            client.requests,
            [
                ("GET", f"/media-governance/tasks/{task_id}", None),
                (
                    "DELETE",
                    f"/media-governance/tasks/{task_id}?expectedRevision=7",
                    None,
                ),
            ],
        )

    def test_task_cleanup_removes_exact_sources_then_discards(self) -> None:
        module = load_module()
        task_id = "media-task-01234567-89ab-4cde-8fab-0123456789ab"
        source_id = "media-source-01234567-89ab-4cde-8fab-0123456789ab"
        input_sha = "a" * 64

        class FakeClient:
            def __init__(self):
                self.revision = 5
                self.source_present = True
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                if method == "POST":
                    self.revision += 1
                    self.source_present = False
                    return {"id": task_id}
                if method == "DELETE":
                    return {"deletedTaskId": task_id}
                return {
                    "activeRunId": None,
                    "agentSession": None,
                    "closedAt": None,
                    "closedMode": None,
                    "id": task_id,
                    "inputSnapshotSha256": input_sha,
                    "metadataIdentity": None,
                    "metadataStatus": "pending",
                    "payloadSeal": None,
                    "revision": self.revision,
                    "runState": "draft",
                    "sealedPlan": None,
                    "sealedPlanSha256": None,
                    "sources": [{"id": source_id}] if self.source_present else [],
                    "stage": "intake",
                    "units": [],
                    "workItemId": None,
                }

        client = FakeClient()
        result = module.execute_task_cleanup(
            client,
            [
                {
                    "expectedRevision": 5,
                    "inputSnapshotSha256": input_sha,
                    "sourceIds": [source_id],
                    "taskId": task_id,
                }
            ],
        )

        self.assertEqual(result["deletedTaskIds"], [task_id])
        self.assertEqual(result["removedSourceIds"], [source_id])
        self.assertEqual(result["state"], "complete")
        self.assertIn(
            (
                "POST",
                f"/media-governance/tasks/{task_id}/sources/{source_id}/remove",
                {"expectedRevision": 5},
            ),
            client.requests,
        )
        self.assertIn(
            (
                "DELETE",
                f"/media-governance/tasks/{task_id}?expectedRevision=6",
                None,
            ),
            client.requests,
        )

    def test_task_cleanup_returns_a_resumable_partial_receipt_at_deadline(self) -> None:
        module = load_module()
        task_id = "media-task-01234567-89ab-4cde-8fab-0123456789ab"
        source_id = "media-source-01234567-89ab-4cde-8fab-0123456789ab"
        input_sha = "a" * 64

        class FakeClient:
            def request(self, method, _path, _body=None):
                if method == "POST":
                    return {"id": task_id}
                return {
                    "activeRunId": "media-run-01234567-89ab-4cde-8fab-0123456789ab",
                    "agentSession": None,
                    "closedAt": None,
                    "closedMode": None,
                    "id": task_id,
                    "inputSnapshotSha256": input_sha,
                    "metadataIdentity": None,
                    "metadataStatus": "pending",
                    "payloadSeal": None,
                    "revision": 6 if method == "GET" else 5,
                    "runState": "running",
                    "sealedPlan": None,
                    "sealedPlanSha256": None,
                    "sources": [{"id": source_id}],
                    "stage": "intake",
                    "units": [],
                    "workItemId": None,
                }

        initial = {
            "activeRunId": None,
            "agentSession": None,
            "closedAt": None,
            "closedMode": None,
            "id": task_id,
            "inputSnapshotSha256": input_sha,
            "metadataIdentity": None,
            "metadataStatus": "pending",
            "payloadSeal": None,
            "revision": 5,
            "runState": "draft",
            "sealedPlan": None,
            "sealedPlanSha256": None,
            "sources": [{"id": source_id}],
            "stage": "intake",
            "units": [],
            "workItemId": None,
        }
        active = {
            **initial,
            "activeRunId": "media-run-01234567-89ab-4cde-8fab-0123456789ab",
            "revision": 6,
            "runState": "running",
        }
        client = FakeClient()
        with mock.patch.object(
            module,
            "read_task",
            side_effect=[initial, active],
        ), mock.patch.object(module.time, "monotonic", side_effect=[0, 91]):
            result = module.execute_task_cleanup(
                client,
                [
                    {
                        "expectedRevision": 5,
                        "inputSnapshotSha256": input_sha,
                        "sourceIds": [source_id],
                        "taskId": task_id,
                    }
                ],
            )

        self.assertEqual(result["state"], "partial")
        self.assertEqual(result["deletedTaskIds"], [])
        self.assertEqual(
            result["pending"],
            {
                "activeRunId": "media-run-01234567-89ab-4cde-8fab-0123456789ab",
                "revision": 6,
                "sourceId": source_id,
                "taskId": task_id,
            },
        )
    def test_identity_update_uses_the_fixed_pre_download_route(self) -> None:
        module = load_module()
        payload = {
            "expectedRevision": 7,
            "providerRef": {"provider": "tmdb", "providerId": "63145"},
            "releaseYear": 2015,
        }

        self.assertEqual(
            module.COMMAND_ROUTES["task-identity-update"],
            ("PUT", "identity"),
        )
        self.assertEqual(
            module.command_body("task-identity-update", payload),
            payload,
        )

    def test_identity_rebase_uses_the_revision_bound_governance_route(self) -> None:
        module = load_module()
        payload = {"expectedRevision": 21}

        self.assertEqual(
            module.COMMAND_ROUTES["governance-identity-rebase"],
            ("POST", "governance/identity-rebase"),
        )
        self.assertEqual(
            module.command_body("governance-identity-rebase", payload),
            payload,
        )

    def test_rss_context_repair_uses_the_exact_series_work_season_route(self) -> None:
        module = load_module()
        series_id = "media-series-f3a3ec81-042b-47aa-b2ef-f7d1140bc4fd"
        work_id = "media-work-059d5b12e0bdda5f7c73475e09acdb99d81c"
        source_work_id = "media-work-48c812c9-67cc-4b64-b443-d8bc4460d819"
        subscription_id = (
            "media-rss-subscription-2ac272e2-ed49-4b39-bde0-3fedf7ade4df"
        )
        task_id = "media-task-dc2af239-8af9-43f3-8f25-7a8abf3590c7"

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                return {"migratedTaskIds": [task_id]}

        client = FakeClient()
        result = module.execute(
            client,
            {
                "expectedRevision": 918,
                "identity": {
                    "provider": "bangumi",
                    "providerId": "457326",
                    "releaseYear": 2024,
                },
                "operation": "rss-subscription-context-repair",
                "seasonNumber": 2,
                "seriesId": series_id,
                "sourceWorkId": source_work_id,
                "subscriptionId": subscription_id,
                "tasks": [{"expectedRevision": 87, "taskId": task_id}],
                "workId": work_id,
            },
        )

        self.assertEqual(result["result"], {"migratedTaskIds": [task_id]})
        self.assertEqual(
            client.requests,
            [
                (
                    "PUT",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/2/rss-subscriptions/{subscription_id}/context-repair",
                    {
                        "expectedRevision": 918,
                        "identity": {
                            "provider": "bangumi",
                            "providerId": "457326",
                            "releaseYear": 2024,
                        },
                        "sourceWorkId": source_work_id,
                        "tasks": [{"expectedRevision": 87, "taskId": task_id}],
                    },
                )
            ],
        )

    def test_series_reconcile_preserves_canonical_seasons_and_task_ranges(self) -> None:
        module = load_module()
        task_id = "media-task-d6ea930d-42a6-433f-8819-a1f214361697"
        catalog = {
            "canonicalProviderRef": {"provider": "tmdb", "providerId": "30984"},
            "externalRefs": [
                {
                    "providerRef": {"provider": "bangumi", "providerId": "302286"},
                    "releaseYear": 2022,
                    "title": "死神 千年血战篇",
                }
            ],
            "originalTitle": "BLEACH",
            "releaseYear": 2004,
            "seasons": [
                {"episodeCount": 366, "seasonNumber": 1, "title": "本篇"},
                {"episodeCount": 50, "seasonNumber": 2, "title": "千年血战篇"},
            ],
            "taskBindings": [
                {
                    "episodeEnd": 13,
                    "episodeStart": 1,
                    "seasonNumber": 2,
                    "taskId": task_id,
                }
            ],
            "title": "死神",
        }

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                return {"series": {"canonicalProviderId": "30984"}}

        client = FakeClient()
        result = module.execute(
            client,
            {"operation": "series-reconcile", "seriesCatalog": catalog},
        )

        self.assertEqual(result["detail"]["series"]["canonicalProviderId"], "30984")
        self.assertEqual(
            client.requests,
            [
                (
                    "POST",
                    "/media-governance/series/reconcile",
                    module.normalize_series_catalog(catalog),
                )
            ],
        )

    def test_series_magnet_batch_keeps_fourteen_episode_sources_in_one_request(self) -> None:
        module = load_module()
        series_id = "media-series-01234567-89ab-4cde-8fab-0123456789ab"
        work_id = "media-work-01234567-89ab-4cde-8fab-0123456789ab"
        items = [
            {
                "episodeNumber": episode,
                "magnetUri": f"magnet:?xt=urn:btih:{episode:040x}",
            }
            for episode in range(27, 41)
        ]
        batch = {
            "contentKind": "bundled_sidecar_media",
            "items": items,
            "releaseGroup": "LoliHouse",
        }

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                return {"sources": [{"id": f"source-{index}"} for index in range(14)]}

        client = FakeClient()
        result = module.execute(
            client,
            {
                "magnetBatch": batch,
                "operation": "series-magnet-batch",
                "seasonNumber": 2,
                "seriesId": series_id,
                "workId": work_id,
            },
        )

        self.assertEqual(result["seasonNumber"], 2)
        self.assertEqual(len(result["result"]["sources"]), 14)
        self.assertEqual(
            client.requests,
            [
                (
                    "POST",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/2/magnet-batch",
                    batch,
                )
            ],
        )

    def test_series_work_create_binds_an_exact_theatrical_identity(self) -> None:
        module = load_module()
        series_id = "media-series-e5b7a3d4-d118-4a6e-81c3-a0d404047930"

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                return {"works": [{"canonicalProviderId": "810693"}]}

        client = FakeClient()
        result = module.execute(
            client,
            {
                "identity": {"provider": "tmdb", "providerId": "810693"},
                "operation": "series-work-create",
                "seriesId": series_id,
                "workType": "theatrical",
            },
        )

        self.assertEqual(
            result["detail"]["works"][0]["canonicalProviderId"],
            "810693",
        )
        self.assertEqual(
            client.requests,
            [
                (
                    "POST",
                    f"/media-governance/series/{series_id}/works",
                    {
                        "identity": {"provider": "tmdb", "providerId": "810693"},
                        "workType": "theatrical",
                    },
                )
            ],
        )

    def test_series_season_rebind_and_poll_use_work_scoped_routes(self) -> None:
        module = load_module()
        series_id = "media-series-f3a3ec81-042b-47aa-b2ef-f7d1140bc4fd"
        work_id = "media-work-xiangke-01234567-89ab-4cde-8fab-0123456789ab"
        subscription_id = (
            "media-rss-subscription-2ac272e2-ed49-4b39-bde0-3fedf7ade4df"
        )

        class FakeClient:
            def __init__(self):
                self.requests = []

            def request(self, method, path, body=None):
                self.requests.append((method, path, body))
                return {"ok": True}

        client = FakeClient()
        season = {
            "episodeCount": 14,
            "episodeStart": 27,
            "releaseYear": 2024,
            "seasonNumber": 1,
            "title": "死神 千年血战篇-相克谭-",
        }
        module.execute(
            client,
            {
                "operation": "series-season-create",
                "season": season,
                "seriesId": series_id,
                "workId": work_id,
            },
        )
        module.execute(
            client,
            {
                "expectedRevision": 669,
                "operation": "rss-subscription-rebind",
                "seasonNumber": 1,
                "seriesId": series_id,
                "subscriptionId": subscription_id,
                "workId": work_id,
            },
        )
        module.execute(
            client,
            {
                "operation": "rss-subscription-poll",
                "subscriptionId": subscription_id,
            },
        )

        self.assertEqual(
            client.requests,
            [
                (
                    "POST",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons",
                    season,
                ),
                (
                    "PUT",
                    f"/media-governance/series/{series_id}/works/{work_id}/seasons/1/rss-subscriptions/{subscription_id}/context",
                    {"expectedRevision": 669},
                ),
                (
                    "POST",
                    f"/media-governance/series/rss-subscriptions/{subscription_id}/poll",
                    None,
                ),
            ],
        )

    def test_mikan_fetch_falls_back_to_the_fixed_equivalent_origin(self) -> None:
        module = load_module()
        primary = f"https://mikanani.kas.pub{TORRENT_PATH}"
        fallback = f"https://mikanani.me{TORRENT_PATH}"
        opened: list[str] = []

        class FakeOpener:
            def open(self, request, timeout):
                self.assertEqual(timeout, 45)
                opened.append(request.full_url)
                if request.full_url == primary:
                    raise OSError("primary TLS route failed")
                return FakeResponse(fallback, b"sealed-torrent")

            def assertEqual(self, left, right):
                unittest.TestCase().assertEqual(left, right)

        with mock.patch.object(
            module.urllib.request,
            "build_opener",
            return_value=FakeOpener(),
        ):
            descriptor = module.fetch_mikan_torrent(primary)

        self.assertEqual(descriptor, b"sealed-torrent")
        self.assertEqual(opened, [primary, fallback])

    def test_mikan_fetch_rejects_untrusted_origins_before_network(self) -> None:
        module = load_module()
        with mock.patch.object(module.urllib.request, "build_opener") as opener:
            with self.assertRaisesRegex(RuntimeError, "not allowlisted"):
                module.fetch_mikan_torrent(
                    f"https://example.com{TORRENT_PATH}",
                )
        opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
