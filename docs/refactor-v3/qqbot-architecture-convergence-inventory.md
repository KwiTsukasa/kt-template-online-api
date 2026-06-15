# QQBot Architecture Convergence Inventory

This inventory freezes the current QQBot behavior before the strong convergence rewrite. It is a baseline for preserving behavior while deleting old structure.

## Repository Baseline

- API branch: `dev-api-architecture-convergence-v3`.
- Admin branch: `dev-admin-architecture-convergence-v3`.
- API package manager: `pnpm@9.15.9`.
- Admin package manager: `pnpm@10.28.2`, Node engine `>=20.19.0`.
- Current plugin source root: `src/modules/qqbot/plugins`.

## Built-In Plugin Matrix

| Current Dir | Platform Key | Legacy Key | Runtime Entry | Operations | Events |
| --- | --- | --- | --- | --- | --- |
| `bangDream` | `bangdream` | `bangDream` | `qqbot-bangdream.plugin.ts` | 15 | 0 |
| `ff14Market` | `ff14-market` | `ff14Market` | `qqbot-ff14-market.plugin.ts` | 2 | 0 |
| `fflogs` | `fflogs` | none | `qqbot-fflogs.plugin.ts` | 1 | 0 |
| `repeater` | `repeater` | none | `qqbot-repeater.plugin.ts` | 0 | 1 |

## BangDream Operation Matrix

| Operation Key | Name | Handler | Aliases |
| --- | --- | --- | --- |
| `bangdream.song.search` | 查曲 | `searchSong` | 查曲, bd, bangdream, bandori, 邦邦, 邦邦查歌 |
| `bangdream.song.chart` | 查谱面 | `getSongChart` | 查谱面, 谱面, bd谱面 |
| `bangdream.song.random` | 随机曲 | `randomSong` | 随机曲, 随机, bd随机 |
| `bangdream.song.meta` | 查询分数表 | `getSongMeta` | 查询分数表, 查分数表, 查询分数榜, 查分数榜, bd分数表 |
| `bangdream.card.search` | 查卡 | `searchCard` | 查卡, 查卡牌, bd查卡 |
| `bangdream.card.illustration` | 查卡面 | `getCardIllustration` | 查卡面, 查卡插画, 查插画, bd卡面 |
| `bangdream.character.search` | 查角色 | `searchCharacter` | 查角色, bd角色 |
| `bangdream.event.search` | 查活动 | `searchEvent` | 查活动, bd活动 |
| `bangdream.event.stage` | 查试炼 | `getEventStage` | 查试炼, 查stage, 查舞台, 查festival, 查5v5 |
| `bangdream.player.search` | 查玩家 | `searchPlayer` | 查玩家, 查询玩家, bd玩家 |
| `bangdream.gacha.search` | 查卡池 | `searchGacha` | 查卡池, bd卡池 |
| `bangdream.gacha.simulate` | 抽卡模拟 | `simulateGacha` | 抽卡模拟, bd抽卡 |
| `bangdream.cutoff.detail` | ycx | `getCutoffDetail` | ycx, 预测线, 查档线, bd档线 |
| `bangdream.cutoff.all` | ycxall | `getCutoffAll` | ycxall, myycx, 全部档线 |
| `bangdream.cutoff.recent` | lsycx | `getCutoffRecent` | lsycx, 历史档线, 近期档线 |

## Other Plugin Capability Matrix

| Operation/Event Key | Plugin | Type | Handler | Aliases |
| --- | --- | --- | --- | --- |
| `ff14.item.resolve` | `ff14-market` | operation | `resolveItem` | 物品, item, ff14item |
| `ff14.market.price` | `ff14-market` | operation | `getPrice` | 查价, price, ff14price |
| `fflogs.character.summary` | `fflogs` | operation | `getCharacterSummary` | fflogs, logs, 查logs, 查log |
| `repeater.message` | `repeater` | event | `handleMessage` | message event |

## Current Route And Contract Surface

- QQBot core compatibility routes remain under `/qqbot/account`, `/qqbot/command`, `/qqbot/rule`, `/qqbot/message`, `/qqbot/send`, and `/qqbot/dashboard`.
- Plugin compatibility routes remain under `/qqbot/plugin/*`, including list, operation list, operation page, and health.
- Plugin platform management routes remain under `/qqbot/plugin-platform/*`.
- NapCat login routes remain under QQBot account/login compatibility endpoints and must continue to expose scan create, refresh, status, captcha submit, SSE events, and runtime status.
- Admin current QQBot callers are concentrated in `apps/web-antdv-next/src/api/qqbot/index.ts`; the target split is `index.ts`, `plugin.ts`, and `napcat.ts`.

## Command Seed Linkage

- Current online command seed is `sql/qqbot-init.sql`.
- Current BangDream command rows use legacy plugin key `bangDream` and `bangdream.*` operation keys.
- Current FF14 market command row uses legacy plugin key `ff14Market` and operation key `ff14.market.price`.
- Current FFLogs command row uses plugin key `fflogs` and operation key `fflogs.character.summary`.
- Repeater is event-driven and has no command row.

## Obsolete File Groups To Delete After Replacement

- Core feature buckets that remain outside the approved layers: `core/account`, `core/command`, `core/config`, `core/connection`, `core/dashboard`, `core/dedupe`, `core/event`, `core/message`, `core/mqtt`, `core/permission`, `core/rule`, `core/send`.
- Plugin Platform buckets that remain outside the approved layers: `plugin-platform/manifest`, `plugin-platform/persistence`, `plugin-platform/registry`, `plugin-platform/runtime`, `plugin-platform/sdk`, root controller/service/module files.
- Plugin directories that must be replaced by package keys: `plugins/bangDream`, `plugins/ff14Market`.
- Plugin service files that must not survive the rewrite as runtime code: `qqbot-bangdream.plugin.ts`, `qqbot-ff14-market.plugin.ts`, `qqbot-fflogs.plugin.ts`, `qqbot-repeater.plugin.ts`, and companion Nest service files.
- NapCat buckets that remain outside the approved layers: `napcat/device`, `napcat/container`, `napcat/login`, `napcat/integration`, root service files, and `napcat/persistence.ts`.

## Verification

- `test/modules/qqbot/architecture/qqbot-current-operation-matrix.spec.ts` locks this matrix against current registry, manifests, and `sql/qqbot-init.sql`.
- Later rewrite batches must update the test only when the new package structure proves the same behavior through manifest-driven runtime contracts.
