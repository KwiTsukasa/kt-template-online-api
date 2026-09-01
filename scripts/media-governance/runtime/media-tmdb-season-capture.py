#!/usr/bin/env python3
"""只读采集一个已确认 TMDB 剧集季的中文元数据与映射边界。"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import html
import json
import os
import pathlib
import re
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter


EVIDENCE_ROOT = pathlib.Path("/vol1/docker/kt-media-governance/evidence")
USER_AGENT = "Mozilla/5.0 (compatible; KT media metadata governance/1.0)"
TMDB_HOSTS = {"image.tmdb.org", "media.themoviedb.org"}
PAGE_FETCH_ATTEMPTS = 5
PAGE_FETCH_DEFAULT_TLS_ATTEMPTS = 3
PAGE_FETCH_RETRY_DELAYS_SECONDS = (1, 2, 4, 8)
PAGE_FETCH_SUCCESS_DELAY_SECONDS = 0.25
PAGE_FETCH_TIMEOUT_SECONDS = 20
PAGE_FETCH_MAX_BYTES = 8 * 1024 * 1024
TMDB_PAGE_HOSTS = {"www.themoviedb.org"}
CURL_PATH = pathlib.Path("/usr/bin/curl")


class TmdbHttpError(RuntimeError):
    def __init__(self, status_code: int, url: str) -> None:
        super().__init__(f"TMDB request returned HTTP {status_code}: {url}")
        self.status_code = status_code


def fail(message: str) -> None:
    raise RuntimeError(message)


def utc_now() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def is_descendant(path: pathlib.Path, root: pathlib.Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return path != root


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_output(output_path: pathlib.Path | None) -> None:
    if output_path is None:
        return
    if not output_path.is_absolute():
        fail("output path must be absolute")
    output = output_path.resolve(strict=False)
    if not is_descendant(output, EVIDENCE_ROOT) or output.suffix != ".json":
        fail("output path must be a JSON file below the governance evidence root")


def tag_attributes(tag: str) -> dict[str, str]:
    return {
        name.lower(): html.unescape(value)
        for name, _, value in re.findall(
            r"([:\w-]+)\s*=\s*([\"'])(.*?)\2", tag, flags=re.DOTALL
        )
    }


def clean_text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.IGNORECASE)
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()


def first_tag_text(fragment: str, pattern: str) -> str | None:
    match = re.search(pattern, fragment, flags=re.IGNORECASE | re.DOTALL)
    return clean_text(match.group(1)) if match else None


def meta_values(page: str, *, key: str, value: str) -> list[str]:
    results = []
    for raw_tag in re.findall(r"<meta\b[^>]*>", page, flags=re.IGNORECASE):
        attributes = tag_attributes(raw_tag)
        if attributes.get(key) == value and attributes.get("content"):
            results.append(attributes["content"])
    return results


def original_artwork_url(url: str | None) -> str | None:
    if not url:
        return None
    match = re.fullmatch(
        r"https://(?:media\.themoviedb\.org|image\.tmdb\.org)/t/p/[^/]+/([^?#]+)(?:[?#].*)?",
        url,
    )
    if not match:
        return None
    return f"https://image.tmdb.org/t/p/original/{match.group(1)}"


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    localized = re.fullmatch(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", value)
    if localized:
        return f"{int(localized.group(1)):04d}-{int(localized.group(2)):02d}-{int(localized.group(3)):02d}"
    iso = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", value)
    return iso.group(1) if iso else None


def parse_episode_image(fragment: str) -> str | None:
    for tag in re.findall(r"<img\b[^>]*>", fragment, flags=re.IGNORECASE):
        attributes = tag_attributes(tag)
        if "backdrop" not in attributes.get("class", "").split():
            continue
        return original_artwork_url(attributes.get("src"))
    return None


def parse_overview(fragment: str) -> str:
    match = re.search(
        r'<div\s+class=["\']overview["\'][^>]*>(.*?)</div>',
        fragment,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return ""
    paragraphs = [
        clean_text(value)
        for value in re.findall(
            r"<p\b[^>]*>(.*?)</p>", match.group(1), flags=re.IGNORECASE | re.DOTALL
        )
    ]
    return "\n".join(value for value in paragraphs if value)


def parse_season_page(page: str, *, season_number: int) -> dict:
    card_pattern = re.compile(
        rf'<div\s+class=["\']card["\'][^>]*data-url=["\'][^"\']*'
        rf'/season/{season_number}/episode/(\d+)[^"\']*["\'][^>]*>',
        flags=re.IGNORECASE,
    )
    cards = list(card_pattern.finditer(page))
    episodes = []
    for index, match in enumerate(cards):
        fragment = page[match.end() : cards[index + 1].start() if index + 1 < len(cards) else len(page)]
        episode_number = int(match.group(1))
        displayed_number = first_tag_text(
            fragment,
            r'<span\s+class=["\']episode_number["\'][^>]*>(.*?)</span>',
        )
        if displayed_number and displayed_number.isdigit() and int(displayed_number) != episode_number:
            fail(f"TMDB episode card number mismatch for episode {episode_number}")
        title = first_tag_text(
            fragment,
            r'<div\s+class=["\']episode_title["\'][^>]*>.*?<h3>\s*<a\b[^>]*>(.*?)</a>\s*</h3>',
        )
        if not title:
            fail(f"TMDB episode {episode_number} title is missing")
        episodes.append(
            {
                "aired": parse_date(
                    first_tag_text(
                        fragment,
                        r'<span\s+class=["\']date["\'][^>]*>(.*?)</span>',
                    )
                ),
                "episode": episode_number,
                "imageUrl": parse_episode_image(fragment),
                "overview": parse_overview(fragment),
                "runtime": first_tag_text(
                    fragment,
                    r'<span\s+class=["\']runtime["\'][^>]*>(.*?)</span>',
                ),
                "title": title,
            }
        )
    if not episodes:
        fail("TMDB season page contains no episode cards")
    if len({entry["episode"] for entry in episodes}) != len(episodes):
        fail("TMDB season page contains duplicate episode numbers")
    season_images = [
        original_artwork_url(value)
        for value in meta_values(page, key="property", value="og:image")
    ]
    raw_page_title = first_tag_text(page, r"<title>(.*?)</title>") or ""
    page_title = re.sub(
        r"\s+(?:—|-)\s+The Movie Database \(TMDB\)\s*$",
        "",
        raw_page_title,
        flags=re.IGNORECASE,
    ).strip()
    season_title = re.sub(r"\s*\(\d{4}\)\s*$", "", page_title).strip()
    title_parts = re.split(r"\s*[:：]\s*", season_title, maxsplit=1)
    if len(title_parts) == 2:
        season_title = title_parts[1].strip()
    return {
        "episodes": episodes,
        "seasonArtworkUrl": next((value for value in season_images if value), None),
        "seasonTitle": season_title or None,
    }


def parse_series_page(page: str) -> dict:
    raw_title = first_tag_text(page, r"<title>(.*?)</title>") or ""
    year_match = re.search(r"\(TV Series\s+(\d{4})", raw_title)
    title = re.sub(r"\s*\(TV Series.*$", "", raw_title).strip()
    descriptions = meta_values(page, key="name", value="description")
    artwork = []
    for value in meta_values(page, key="property", value="og:image"):
        original = original_artwork_url(value)
        if original and original not in artwork:
            artwork.append(original)
    season_numbers = sorted(
        {
            int(value)
            for value in re.findall(
                r'href=["\'][^"\']*/season/(\d+)(?:[?/"\'])',
                page,
                flags=re.IGNORECASE,
            )
        }
    )
    return {
        "artworkUrls": artwork,
        "description": descriptions[0] if descriptions else "",
        "seasonNumbers": season_numbers,
        "title": title,
        "year": int(year_match.group(1)) if year_match else None,
    }


def parse_movie_page(page: str) -> dict:
    raw_title = first_tag_text(page, r"<title>(.*?)</title>") or ""
    page_title = re.sub(
        r"\s+(?:—|-)\s+The Movie Database \(TMDB\)\s*$",
        "",
        raw_title,
        flags=re.IGNORECASE,
    ).strip()
    year_match = re.search(r"\((\d{4})\)\s*$", page_title)
    title = re.sub(r"\s*\(\d{4}\)\s*$", "", page_title).strip()
    descriptions = meta_values(page, key="name", value="description")
    artwork = []
    for value in meta_values(page, key="property", value="og:image"):
        original = original_artwork_url(value)
        if original and original not in artwork:
            artwork.append(original)
    return {
        "artworkUrls": artwork,
        "description": descriptions[0] if descriptions else "",
        "title": title,
        "year": int(year_match.group(1)) if year_match else None,
    }


def classify_mapping(*, local_video_count: int, provider_episode_count: int) -> dict:
    count_matches = local_video_count == provider_episode_count
    return {
        "countMatches": count_matches,
        "localVideoCount": local_video_count,
        "maximumGovernanceVideoDownloadCount": 0,
        "providerEpisodeCount": provider_episode_count,
        "route": (
            "one-video-per-provider-episode"
            if count_matches
            else "requires-provider-coverage-review"
        ),
        "videoDownloadDecision": (
            "not-needed" if count_matches else "closed-pending-coverage-review"
        ),
    }


def parse_runtime_minutes(value: str | None) -> int | None:
    match = re.search(r"(\d+)", value or "")
    return int(match.group(1)) if match else None


def classify_episode_coverage(
    local_episode_durations: dict[int, float], provider_episodes: list[dict]
) -> dict:
    provider_by_episode = {entry["episode"]: entry for entry in provider_episodes}
    if len(provider_by_episode) != len(provider_episodes):
        fail("provider metadata contains duplicate episode numbers")
    local_episodes = set(local_episode_durations)
    provider_episode_numbers = set(provider_by_episode)
    missing_from_provider = sorted(local_episodes - provider_episode_numbers)
    if missing_from_provider:
        fail(f"provider metadata is missing local episode numbers: {missing_from_provider}")
    for episode, duration_seconds in local_episode_durations.items():
        provider_runtime = parse_runtime_minutes(
            provider_by_episode[episode].get("runtime")
        )
        if (
            provider_runtime is None
            or abs(float(duration_seconds) - provider_runtime * 60) > 180
        ):
            fail(f"local/provider runtime mismatch for episode {episode}")
    provider_only = sorted(provider_episode_numbers - local_episodes)
    return {
        "countMatches": not provider_only,
        "localEpisodes": sorted(local_episodes),
        "localVideoCount": len(local_episodes),
        "maximumGovernanceVideoDownloadCount": 0,
        "providerEpisodeCount": len(provider_episode_numbers),
        "providerOnlyEpisodes": provider_only,
        "route": (
            "explicit-local-episode-subset"
            if provider_only
            else "one-video-per-provider-episode"
        ),
        "videoDownloadDecision": "not-needed",
    }


def provider_id_from_row(row: dict) -> int | None:
    value = row.get("grandparent_tmdb_id") or row.get("parent_tmdb_id") or row.get("tmdb_id")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def select_provider_episode_row(rows: list[dict], provider_id: int) -> dict | None:
    matching = [
        row
        for row in rows
        if row.get("type") == "Episode" and provider_id_from_row(row) == provider_id
    ]
    if not matching:
        identifiable = [
            row
            for row in rows
            if row.get("type") in {"Episode", "Movie"}
            and provider_id_from_row(row) is not None
        ]
        if rows and len(identifiable) == len(rows):
            return None
        fail("local video has no complete provider identity")
    if len(matching) != len(rows):
        fail("local video has conflicting provider rows")
    identities = {
        (
            row.get("parent_season")
            if row.get("parent_season") is not None
            else row.get("season_number"),
            row.get("episode_number"),
        )
        for row in matching
    }
    if len(identities) != 1:
        fail("conflicting provider episode rows")
    return matching[0]


def load_inventory_episode_durations(
    path: pathlib.Path, *, work_item: str, provider_id: int, season: int
) -> tuple[dict[int, float], dict]:
    if (
        not path.is_absolute()
        or not path.is_file()
        or path.is_symlink()
        or path.suffix != ".json"
        or not is_descendant(path.resolve(strict=True), EVIDENCE_ROOT)
    ):
        fail("inventory must be an existing regular JSON file below the evidence root")
    inventory = json.loads(path.read_text(encoding="utf-8"))
    if inventory.get("workItemId") != work_item or inventory.get("mode") != "local-only-readonly":
        fail("inventory identity or mode does not match the requested work item")
    rows_by_path: dict[str, list[dict]] = {}
    for row in inventory.get("database", {}).get("rows", []):
        rows_by_path.setdefault(str(row.get("path") or ""), []).append(row)
    durations = {}
    for video in inventory.get("files", {}).get("videos", []):
        rows = rows_by_path.get(str(video.get("path") or ""), [])
        row = select_provider_episode_row(rows, provider_id)
        if row is None:
            continue
        row_season = row.get("parent_season")
        if row_season is None:
            row_season = row.get("season_number")
        episode = row.get("episode_number")
        duration = video.get("durationSeconds")
        if (
            row.get("type") != "Episode"
            or provider_id_from_row(row) != provider_id
            or not isinstance(episode, int)
            or episode < 1
            or not isinstance(duration, (int, float))
            or duration <= 0
        ):
            fail("local inventory episode identity is incomplete or duplicated")
        if row_season != season:
            continue
        if episode in durations:
            fail("local inventory episode identity is incomplete or duplicated")
        durations[episode] = float(duration)
    if not durations:
        fail("inventory contains no local videos")
    return durations, inventory


def subtitle_release_group(credit_lines: list[str]) -> str:
    text = re.sub(r"\{[^}]*\}", "", "\n".join(credit_lines)).lower()
    if any(marker in text for marker in ("桜都", "樱都", "sakurato")):
        return "Sakurato"
    if any(marker in text for marker in ("beansub", "fzsd", "豌豆", "风之圣殿")):
        return "BeanSub&FZSD"
    return "unknown"


def classify_subtitle_coverage(inventory: dict) -> dict:
    sidecars = inventory.get("files", {}).get("subtitles", [])
    if not sidecars:
        return {
            "releaseGroupCounts": {},
            "replacementEpisodes": [],
            "selectedSeasonReleaseGroup": None,
            "status": "no-sidecars",
        }
    by_episode = {}
    for sidecar in sidecars:
        hints = sidecar.get("sourceEpisodeHints", [])
        if len(hints) != 1 or not isinstance(hints[0], int) or hints[0] < 1:
            fail("subtitle sidecar must resolve to exactly one episode")
        episode = hints[0]
        if episode in by_episode:
            fail("subtitle sidecars contain duplicate episode coverage")
        by_episode[episode] = subtitle_release_group(sidecar.get("creditLines", []))
    counts = Counter(by_episode.values())
    highest = max(counts.values())
    candidates = sorted(group for group, count in counts.items() if count == highest)
    selected = candidates[0] if len(candidates) == 1 and candidates[0] != "unknown" else None
    replacement = sorted(
        episode for episode, group in by_episode.items() if selected is None or group != selected
    )
    return {
        "releaseGroupCounts": dict(sorted(counts.items())),
        "replacementEpisodes": replacement,
        "selectedSeasonReleaseGroup": selected,
        "status": (
            "single-season-release-group"
            if len(counts) == 1 and selected is not None
            else "mixed-season-release-groups"
        ),
    }


def page_ssl_context(attempt: int) -> ssl.SSLContext:
    context = ssl.create_default_context()
    if attempt >= PAGE_FETCH_DEFAULT_TLS_ATTEMPTS:
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.maximum_version = ssl.TLSVersion.TLSv1_2
    return context


def curl_fetch_page(url: str) -> dict:
    if not CURL_PATH.is_file() or CURL_PATH.is_symlink():
        fail("TMDB curl transport is unavailable")
    with tempfile.TemporaryDirectory(prefix="kt-tmdb-page-") as temporary:
        output = pathlib.Path(temporary) / "response.html"
        command = [
            os.fspath(CURL_PATH),
            "--fail-with-body",
            "--silent",
            "--show-error",
            "--http1.1",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "10",
            "--max-time",
            "30",
            "--max-filesize",
            str(PAGE_FETCH_MAX_BYTES),
            "--retry",
            "1",
            "--retry-all-errors",
            "--retry-delay",
            "1",
            "--user-agent",
            USER_AGENT,
            "--header",
            "Accept: text/html,application/xhtml+xml",
            "--header",
            "Accept-Language: zh-CN,zh;q=0.9",
            "--output",
            os.fspath(output),
            "--write-out",
            "%{http_code}\n%{url_effective}",
            url,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=40,
        )
        lines = completed.stdout.splitlines()
        status = int(lines[0]) if lines and lines[0].isdigit() else 0
        if status == 404:
            raise TmdbHttpError(status, url)
        if completed.returncode != 0 or status != 200 or len(lines) != 2:
            error = " ".join(completed.stderr.split())[:240]
            fail(f"TMDB curl transport failed with HTTP {status}: {error}")
        final_url = lines[1]
        final = urllib.parse.urlsplit(final_url)
        if final.scheme != "https" or final.hostname not in TMDB_PAGE_HOSTS:
            fail("TMDB curl transport escaped the fixed HTTPS host")
        if not output.is_file() or output.is_symlink():
            fail("TMDB curl transport produced no page")
        body = output.read_bytes()
        if not body or len(body) > PAGE_FETCH_MAX_BYTES:
            fail("TMDB curl transport returned an invalid page size")
        return {
            "body": body.decode("utf-8", errors="replace"),
            "bytes": len(body),
            "finalUrl": final_url,
            "sha256": hashlib.sha256(body).hexdigest(),
            "status": status,
            "transport": "curl-http1.1",
            "url": url,
        }


def fetch_page(url: str) -> dict:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in TMDB_PAGE_HOSTS:
        fail("TMDB page request URL is outside the fixed HTTPS host")
    request_identity = f"{parsed.hostname}{parsed.path}"
    language = urllib.parse.parse_qs(parsed.query).get("language")
    if language and len(language) == 1:
        request_identity = f"{request_identity}?language={language[0]}"
    last_error: Exception | None = None
    for attempt in range(PAGE_FETCH_ATTEMPTS):
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "zh-CN,zh;q=0.9",
                "Connection": "close",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=PAGE_FETCH_TIMEOUT_SECONDS,
                context=page_ssl_context(attempt),
            ) as response:
                final = urllib.parse.urlsplit(response.url)
                if final.scheme != "https" or final.hostname not in TMDB_PAGE_HOSTS:
                    fail("TMDB urllib transport escaped the fixed HTTPS host")
                body = response.read(PAGE_FETCH_MAX_BYTES + 1)
                if not body or len(body) > PAGE_FETCH_MAX_BYTES:
                    fail("TMDB urllib transport returned an invalid page size")
                result = {
                    "body": body.decode("utf-8", errors="replace"),
                    "bytes": len(body),
                    "finalUrl": response.url,
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "status": response.status,
                    "url": url,
                }
                time.sleep(PAGE_FETCH_SUCCESS_DELAY_SECONDS)
                return result
        except urllib.error.HTTPError as error:
            if error.code == 404:
                raise TmdbHttpError(error.code, url) from error
            last_error = error
            if attempt < len(PAGE_FETCH_RETRY_DELAYS_SECONDS):
                time.sleep(PAGE_FETCH_RETRY_DELAYS_SECONDS[attempt])
        except (OSError, urllib.error.URLError) as error:
            last_error = error
            if attempt < len(PAGE_FETCH_RETRY_DELAYS_SECONDS):
                time.sleep(PAGE_FETCH_RETRY_DELAYS_SECONDS[attempt])
    try:
        result = curl_fetch_page(url)
        time.sleep(PAGE_FETCH_SUCCESS_DELAY_SECONDS)
        return result
    except TmdbHttpError:
        raise
    except Exception as curl_error:
        fail(
            f"TMDB request failed for {request_identity} after "
            f"{PAGE_FETCH_ATTEMPTS} urllib attempts "
            f"(default TLS={PAGE_FETCH_DEFAULT_TLS_ATTEMPTS}, "
            f"TLS 1.2={PAGE_FETCH_ATTEMPTS - PAGE_FETCH_DEFAULT_TLS_ATTEMPTS}) "
            f"and one curl transport: urllib={last_error}; curl={curl_error}"
        )


def page_evidence(result: dict) -> dict:
    return {key: result[key] for key in ("bytes", "finalUrl", "sha256", "status", "url")}


def write_atomic_json(output_path: pathlib.Path, payload: dict) -> None:
    if output_path.exists():
        fail("TMDB capture evidence already exists")
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)


def capture(args: argparse.Namespace) -> dict:
    output_path = pathlib.Path(args.output) if args.output else None
    validate_output(output_path)
    if not re.fullmatch(r"media-\d{3}", args.work_item):
        fail("work item ID must match media-NNN")
    if args.provider_id < 1 or args.season < 0:
        fail("provider ID or season is invalid")
    inventory_path = pathlib.Path(args.inventory) if args.inventory else None
    inventory = None
    local_episode_durations = None
    if inventory_path is not None:
        local_episode_durations, inventory = load_inventory_episode_durations(
            inventory_path,
            work_item=args.work_item,
            provider_id=args.provider_id,
            season=args.season,
        )
    elif args.local_video_count < 1:
        fail("local video count is invalid")
    series_url = f"https://www.themoviedb.org/tv/{args.provider_id}?language=zh-CN"
    season_url = (
        f"https://www.themoviedb.org/tv/{args.provider_id}/season/{args.season}?language=zh-CN"
    )
    series_page = fetch_page(series_url)
    season_page = fetch_page(season_url)
    series = parse_series_page(series_page["body"])
    season = parse_season_page(season_page["body"], season_number=args.season)
    mapping = (
        classify_episode_coverage(local_episode_durations, season["episodes"])
        if local_episode_durations is not None
        else classify_mapping(
            local_video_count=args.local_video_count,
            provider_episode_count=len(season["episodes"]),
        )
    )
    payload = {
        "capturedAt": utc_now(),
        "episodes": season["episodes"],
        "identity": {
            "canonicalTitle": args.canonical_title,
            "observedProviderTitle": series["title"],
            "observedProviderYear": series["year"],
            "provider": "tmdb",
            "providerId": args.provider_id,
            "season": args.season,
            "type": "TV",
            "year": args.year,
        },
        "mapping": mapping,
        "mutationBoundaries": {
            "cloudWrites": 0,
            "databaseDirectWrite": False,
            "evidenceWrites": int(output_path is not None),
            "formalMediaWrites": 0,
            "mediaOrSubtitlePayloadDownloads": 0,
            "serviceMutation": False,
            "uiWrites": 0,
        },
        "pages": {
            "season": page_evidence(season_page),
            "series": page_evidence(series_page),
        },
        "schemaVersion": "tmdb-tv-season-readonly-v1",
        "series": {
            "artworkUrls": series["artworkUrls"],
            "description": series["description"],
        },
        "seasonArtworkUrl": season["seasonArtworkUrl"],
        "status": "tmdb-season-captured",
        "subtitleCoverage": (
            classify_subtitle_coverage(inventory) if inventory is not None else None
        ),
        "workItemId": args.work_item,
    }
    if inventory_path is not None:
        payload["inputEvidence"] = {
            "inventoryPath": os.fspath(inventory_path),
            "inventorySha256": sha256_file(inventory_path),
        }
    if output_path is not None:
        write_atomic_json(output_path, payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture one confirmed TMDB TV season without mutating media state."
    )
    parser.add_argument("--work-item", required=True)
    parser.add_argument("--provider-id", required=True, type=int)
    parser.add_argument("--season", required=True, type=int)
    parser.add_argument("--canonical-title", required=True)
    parser.add_argument("--year", required=True, type=int)
    local = parser.add_mutually_exclusive_group(required=True)
    local.add_argument("--local-video-count", type=int)
    local.add_argument("--inventory")
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--output")
    output.add_argument("--stdout", action="store_true")
    return parser.parse_args()


def capture_result_summary(payload: dict, output_path: pathlib.Path) -> dict:
    if not output_path.is_file() or output_path.is_symlink():
        fail("TMDB capture output is unavailable")
    return {
        "evidenceSha256": sha256_file(output_path),
        "mapping": payload["mapping"],
        "mutationBoundaries": payload["mutationBoundaries"],
        "observedProviderTitle": payload["identity"]["observedProviderTitle"],
        "outputPath": os.fspath(output_path),
        "status": payload["status"],
        "workItemId": payload["workItemId"],
    }


def main() -> None:
    args = parse_args()
    payload = capture(args)
    if args.stdout:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return
    print(
        json.dumps(
            capture_result_summary(payload, pathlib.Path(args.output)),
            ensure_ascii=False,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error), "ok": False}, ensure_ascii=False))
        raise
