# AGENTS.md

Everything a fresh agent needs to work on this repository. Read it fully before changing anything.

**This file is public.** Anyone can view, clone or fork this repo. Never put anything here (or in
commits, comments, tests or workflows) that identifies a person or their accounts, devices or
servers. See [Keeping this file public-safe](#keeping-this-file-public-safe).

**Keep it current.** When you learn something a future agent would need, or change something this
file describes, update this file in the same change. Add a line to the
[change log](#change-log) at the bottom. Remove or correct anything that stops being true; a wrong
line here is worse than a missing one.

## 0. Current status and next steps (handoff)

Update this section whenever you stop, so the next agent resumes exactly here. If you are about to
run out of budget, update this section before anything else.

- **Active work:** the iOS "playback never starts" investigation (section 10).
- **Last change pushed to `main`:** the shareable playback log (sections 5 and 7). Its iOS and
  Android CI builds passed, so the patched `NitroPlayerLogger.swift` compiles.
- **Waiting on:** the owner to install that build, reproduce (one direct stream and one downloaded
  track, ~30 s each) and send the output of Settings > Developer > Share playback log.
- **Next step when the log arrives:** find, for each case, where the chain in section 5 stops:
  was a URL requested, did media info fail (and why), did a URL reach native, what does the
  native snapshot show, and what the native log says about the AVPlayerItem (status, errors,
  `automaticallyWaitsToMinimizeStalling`, rate). Fix the verified cause with a test, build once.
- **After playback works:** bring in the newer upstream changes the owner wants, one reviewed
  batch at a time, re-testing playback after each.

---

## 1. What this is

A fork of **Jellify**, a free, open-source React Native music player for
[Jellyfin](https://jellyfin.org/) servers (iOS and Android). The fork exists to fix bugs and to
build installable test builds automatically in CI.

- Upstream: `Jellify-Music/App`. This fork has the upstream branches and tags.
- Version at time of writing: 1.2.7 (`package.json`). Bundle ID in source:
  `com.cosmonautical.jellify` (re-signing for sideloading changes it, see section 8).
- Stack: React Native 0.86 (new architecture), React 19, TypeScript, Bun, Tamagui, Reanimated 4 +
  Worklets, TanStack Query, Zustand, MMKV, `@jellyfin/sdk`, and
  [`react-native-nitro-player`](https://github.com/riteshshukla04/react-native-nitro-player) for audio.
- Other docs worth knowing: `README.md`, `CONTRIBUTING.md`, `src/player/README.md`,
  `maestro/README.md` (end-to-end tests, upstream-only).

## 2. Repository map

```
src/
  api/             Jellyfin API calls and TanStack Query definitions
  components/      UI. Player/ (scrubber, mini player), Queue/, Library/, Settings/, ...
  configs/         App config. configs/styling/tamagui.ts = Tamagui + animation driver
  player/          Player business logic as plain functions (not hooks)
    controls/      play/pause, skip, seek, shuffle, repeat
    queuing/       load a queue, play next, play later, reorder
    utils/         queue helpers (e.g. findCurrentTrackIndex)
    index.ts       useProgress(), usePlaybackState()
  services/player/ Native player setup + event handlers (the bridge from native to JS)
  stores/          Zustand stores. stores/player/{queue,playback,duration,engine}.ts
  utils/           mapping (Jellyfin item -> track), audio profiles, logging
ios/ android/      Native projects. ios/fastlane and android/fastlane are upstream release tooling
jest/              functional/ (unit) and contextual/ (component) tests, setup/ = mocks
patches/           patch-package patches applied to node_modules on install (see section 7)
.github/workflows/ CI (see section 8)  .github/actions/ composite actions
```

## 3. Commands

Always use **Bun**. Node 22+.

```sh
bun install --frozen-lockfile      # install. Do NOT use --ignore-scripts (see below)
bunx tsc --noEmit                  # typecheck
CI=true bunx jest --forceExit      # all tests (--forceExit: open handles keep Jest alive)
bunx jest path/to/file.test.ts     # one test file
bunx eslint src jest               # lint (one pre-existing warning is expected)
bunx prettier --check .            # formatting (CI runs this)
```

Gotchas that have already cost time:

- **`postinstall` matters.** It runs `generate-config` (creates the typed `react-native-superconfig`
  config from `.env`) and `patch-package`. With `--ignore-scripts`, `tsc` fails with
  `Property 'GLITCHTIP_DSN' does not exist on type 'SuperConfig'`. Fix: `bun run generate-config`.
- **Bun hard-links packages from its global cache, and patch-package edits files in place, so
  patching also patches the cache.** A later clean install from that cache then fails to apply the
  patches (`Failed to apply patch for package react-native-carplay`). If local installs start
  failing that way: `rm -rf node_modules ~/.bun/install/cache` and reinstall. CI must never cache
  `~/.bun/install/cache` (the Jest workflow did, and broke; fixed).
- **`patch-package` cannot create patches in this repo** (it requires an npm/yarn lockfile, this
  repo uses `bun.lock`). Applying works fine. See section 7 for how patches are made.
- A **pre-commit hook** (husky + lint-staged) runs `prettier --write` and `eslint --fix` on staged
  `.ts/.tsx/.js/.jsx` files and re-stages them. It can change your files, so re-check the diff of
  files you restored verbatim from another revision.
- `.env` is **tracked**. It controls build-time config (see OTA below).

## 4. Code conventions

From `CONTRIBUTING.md`, enforced by ESLint/Prettier/TS:

- Tabs, **no semicolons**, single quotes. `@typescript-eslint/no-explicit-any` is an error.
- The React Compiler is on: **do not use `useMemo` / `useCallback`**.
- Reanimated shared values: use `.get()` / `.set()`, never `.value`.
- Prefer plain functions in `src/player/` over hooks.
- Add tests for behaviour changes (`jest/functional/...`). A test that only passes with the fix is
  the standard here: show it failing without the fix, then passing.

## 5. How playback works (read before touching `src/player` or `src/services/player`)

1. UI calls `loadNewQueue()` (`src/player/queuing`). It maps Jellyfin items to `TrackItem`s via
   `src/utils/mapping/item-to-track.ts`, creates a native playlist and loads it.
2. **Tracks are queued with an empty `url` on purpose.** The native player notices tracks that
   need a URL and fires `onTracksNeedUpdate` (many places: queue load, play, every track change,
   queue edits, failed-item recovery, so events overlap constantly).
3. JS handles it in `services/player/utils/event-handlers.ts` -> `track-media-info.ts` ->
   `utils/fetching/track-media-info.ts` (`resolveTrackUrls`). That asks Jellyfin for PlaybackInfo
   (`api/queries/media`, cached by TanStack Query for a day) and builds either a direct stream URL
   (`/Audio/{id}/stream?...&static=true`) or the server's transcoding URL, then calls
   `TrackPlayer.updateTracks()`. Native ignores URL-less tracks, so a track without a URL never plays.
4. Native events flow back: `onChangeTrack` (updates `currentIndex`, reports playback), 
   `onPlaybackProgress` (position + native duration), `onPlaybackStateChange`, `onSeek`.
5. State lives in Zustand: `stores/player/queue.ts` (queue, `currentIndex`, shuffle; persisted),
   `playback.ts` (position; persisted), `duration.ts` (native-measured duration; not persisted).
   The JS queue mirrors the native playlist, kept in sync via `TrackPlayer.getActualQueue()`.

Important facts and traps:

- **A shared, de-duplicated query + AbortSignal = broken retries.** The iOS-only abort of stale
  `onTracksNeedUpdate` calls must never pass its signal into the cached media-info query.
  (Fixed; regression test: `jest/functional/Player/tracks-need-update-race.test.ts`.)
- **Displayed length must come from the player, not Jellyfin metadata.** `useProgress()` prefers
  the native duration and falls back to `RunTimeTicks` only until it is known.
- **The native library identifies tracks by `id`.** A song queued twice cannot be told apart
  natively; reorder/remove by id may hit the wrong copy. JS side picks the right copy for the
  current index with `findCurrentTrackIndex`. Making ids unique is NOT safe: downloads, offline
  lookup, reporting and media-info all use `track.id` as the real Jellyfin item id.
- `handleLibraryShuffle` must queue `DownloadedTrack.originalTrack`, not the `DownloadedTrack`.
- Auth headers: `mapDtoToTrack` sets a top-level `headers` on the track, but the native `TrackItem`
  has no such field (the bridge drops it); native reads `extraPayload.headers`. Streams currently
  work without it, so the server evidently accepts the stream URL as built. Unverified edge case.
- Playback diagnostics: `services/player/utils/playback-diagnostics.ts` shows a message when the
  player errors or buffers for 20s, naming the codec and whether the server is transcoding
  ("unknown format, direct" means the JS copy of the track never got media info, i.e. its URL was
  never resolved and applied). When stuck it also logs a snapshot of the native player's state.
- **Playback log** (`src/utils/diagnostics/playback-log.ts`): JS writes `Caches/jellify-playback.log`
  (URL requests, media-info failures with their reason, URLs handed to native, track and state
  changes); the patched native logger writes `Caches/nitroplayer.log`. Settings > Developer
  (enable Developer Options) > **Share playback log** shares the tail of both. `redact()` strips the
  server address, API keys and tokens; keep it that way, and never commit a shared log.

## 6. Animation driver and dependency pins

- `src/configs/styling/tamagui.ts` takes `animations` from `@tamagui/config/v4` and **Tamagui is
  pinned to 2.7.4**. Upstream's unreleased commit `fea92ff` switched to
  `@tamagui/config/v5-reanimated` + Tamagui 2.7.7; as a release build that crashed on launch
  (iOS 26.x): an uncaught JS exception inside the Worklets animation frame loop, aborting ~0.2s in.
  Do not re-adopt that without testing a **release build on a real device from a fresh install**.
- The last JavaScript upstream actually shipped is the tag `1.2.7-ota.0`. If a regression appears,
  diffing against that tag is a good first bisect.
- `ios/Podfile.lock` pins the native pod versions upstream built with; keep it in sync.

## 7. Patches (`patches/`)

Applied automatically by `postinstall`. Patch filenames carry the package version.

| Patch | Why |
| --- | --- |
| `react-native-nitro-player+1.5.0.patch` | Native iOS fixes, below |
| `react-native-carplay+2.4.1-beta.0.patch` | Upstream's. Contains stray compiled Android build outputs; fragile |
| `react-native-drax+1.1.0.patch` | Upstream's |
| `react-native-screens+4.26.2.patch` | Upstream's. Installed version is 4.27.0: applies with a harmless warning |

The nitro-player patch (`ios/core/*.swift`) contains:

1. **Stall handling.** Upstream turns off AVPlayer's `automaticallyWaitsToMinimizeStalling` after
   the first item is ready; a network underrun then left playback stopped and pressing play
   re-stalled instantly. Now only downloaded (file URL) items skip stall waiting.
2. **Logging in release builds:** `NitroPlayerLogger` is enabled and also appends to
   `Caches/nitroplayer.log` (capped at ~1 MB), read by the in-app log sharing (section 5). It was
   compiled out of release builds before, which made device problems undiagnosable.
3. **Thread-safety ports from upstream `1.6.1`:** `preloadUpcomingTracks` snapshots
   `currentTracks`/`preloadedAssets` on the player queue before using them on the preload queue
   (crashed when switching tracks quickly); the buffer-empty KVO callback hops to the player queue;
   discarded preloaded assets are `cancelLoading()`ed.

Upstream `1.6.1` also reworks command ordering and queue windowing. It is a candidate upgrade,
untested here; the JS API changes are additive.

**Making or changing a patch** (patch-package can't create it here): put the pristine package
version in a throwaway `git init` repo at the same `node_modules/<pkg>/...` paths (get it with
`npm pack <pkg>@<version>`), commit, copy in your edited files, and `git diff >
patches/<pkg>+<version>.patch`. Verify it from a clean install (`rm -rf node_modules
~/.bun/install/cache && bun install --frozen-lockfile`) and look for `<pkg> ✔`.
Native Swift/Kotlin can't be compiled in a Linux sandbox; the iOS CI build is the compile check.

## 8. CI / builds (`.github/workflows`)

| Workflow | Runs on | When |
| --- | --- | --- |
| `build-android.yml` | ubuntu | push to `main`, PRs (paths), manual |
| `build-ios.yml` | macos | push to `main`, PRs (paths), manual |
| `run-jest-test-suite.yml` | ubuntu | push to any branch except `main` |
| `build-bundle.yml` | ubuntu | PRs |
| `publish-*`, `maestro-test.yml` | | Upstream release tooling; gated to the upstream repo or manual. Needs secrets this fork lacks |

- **Artifacts** (kept 14 days) are named `jellify-ios-unsigned-<version>-run<N>` (contains
  `Jellify-unsigned.ipa`) and `jellify-android-<version>-run<N>` (arm64 release APK, debug-signed).
  A manual run of the Android workflow can build all CPU types.
- **iOS is built unsigned** (`CODE_SIGNING_ALLOWED=NO`, `-sdk iphoneos`). The project's signing is
  hard-wired to the upstream maintainer's team, which can't be used here. Install by re-signing
  with a sideloading tool and a personal Apple ID (free accounts expire after 7 days). The re-signer
  changes the bundle ID. The CarPlay entitlement is not available to free accounts.
- The iOS job has an **"Inspect built app"** step: prints frameworks, Info.plist keys, executable
  arch/min OS and linked libraries, and **fails the build if `main.jsbundle` is missing**.
- **Build once.** Each build workflow starts with a cheap `check` job (`.github/actions/skip-if-built`)
  that skips the build if a successful run of the same workflow already built the identical git
  *tree* within 13 days. Manual runs always build. Pushes touching only `android/` skip iOS and
  vice versa, as do doc-only pushes. macOS minutes are expensive: batch changes and push `main` once
  per verified set. Don't push `main` just to retry.
- New workflow files on a non-default branch are not runnable until they exist on the default branch.
  To test one early, temporarily add the branch to its `push` trigger (and remove it after).
- GitHub Actions is **disabled by default on forks**; the owner must enable it.
- **OTA updates are disabled** in `.env` (`OTA_UPDATE_ENABLED=false`). With it on, release builds
  download upstream's JS bundle at launch and silently replace this fork's code. Leave it off.
- `.env` is read at install time by `generate-config`; `OTA_UPDATE_ENABLED` is compiled in.

## 9. Debugging guide

- **Reading an iOS crash log (`.ips`)**: find the faulting thread (`"triggered":true` /
  `faultingThread`) and its `queue` / frames. Known signatures:
  - Abort inside `worklets::AnimationFrameBatchinator::flush` -> `HermesRuntimeImpl::throwPendingError`:
    uncaught JS exception in a Reanimated/Worklets UI-thread callback (the Tamagui driver issue, section 6).
  - `EXC_BAD_ACCESS` at a tiny address on queue `com.nitroplayer.preload` in `preloadUpcomingTracks`
    while another thread is in `cleanupPreloadedAssets`: the data race fixed by the patch in section 7.
  - Release builds strip `console.*`, so JS error text is usually absent from crash logs.
- **Crash on launch, build looks fine**: check the CI "Inspect built app" output first (bundle
  present? frameworks embedded?). If those are fine it's a runtime JS error, not packaging.
- Agent sandboxes may block the hosts that serve CI artifacts and raw job logs. Job log *tails*
  through the GitHub API still work, which is why CI steps print what you'd want to inspect.

## 10. Known issues and open questions

- **iOS: music never starts on fresh installs of this fork's builds: UNRESOLVED.** Upstream's
  official build plays the same library *sometimes*; the official Jellyfin app always works.
  Observed with a mostly-FLAC library: direct streams sit buffering with "unknown format, direct"
  (the URL is never resolved/applied); with a lower streaming quality the URL does resolve
  ("flac, transcoded") but it still sits buffering; a **downloaded** track (local file, no URL
  lookup) also sits buffering. So there are likely two problems: URL resolution for direct
  streams, and the native player not starting even with a playable source. Ruled out by reading
  code: `URLSearchParams` (polyfilled), a periodic URL-request loop (requests are event-driven),
  the stall patch for local files. Next step: read a shared playback log (section 5).
- The race and stall fixes in section 7, the queue-duplicate fixes, and the launch-crash fix are
  verified by tests and CI compile only. **On-device confirmation is still pending** for
  stall-recovery behaviour and rapid-switching stability.
- Queue persistence (`stores/player/queue.ts`) `JSON.stringify`s up to 500 tracks (each carrying
  large JSON strings) on every queue state change. That blocks the JS thread during rapid track
  changes. Not yet addressed.
- Native duplicates limitation (section 5). Reordering/removing one copy of a repeated song can affect another.
- The streaming-quality profiles and `static=true` URLs are unmodified from upstream.

## 11. Working agreements

- Verify, don't assume. Reproduce a bug (a failing test, or a CI log) before fixing, and show the
  fix flips it. State plainly what is unverified, especially anything that needs a real device.
- Smallest change that fixes the verified cause. Prefer upstream-tested fixes over inventing new ones.
- Before pushing: `tsc`, full Jest, `eslint`, `prettier --check .` all pass.
- Branches: develop on the branch you were assigned. This fork's owner has allowed direct pushes to
  `main` for verified work; if you are unsure whether that applies to you, ask. Never force-push.
  Do not open PRs unless asked.
- Don't commit generated or private material: build outputs, `.env` secrets, keystores, crash logs
  with identifiers, tokens.

## Keeping this file public-safe

Do **not** write any of these here, in code, tests, workflows, or commit messages:

- Names, emails, usernames or other identifiers of the people using the fork (use "the owner").
- Apple/Google account details: team IDs, Apple IDs, certificate or provisioning profile details,
  signing keys, keystores or their passwords, App Store Connect keys.
- Secrets, tokens, API keys, `.env` values beyond the public defaults, secret *values* of any kind.
- Server addresses, domains, library contents, or anything revealing someone's Jellyfin setup.
- Device identifiers (UDIDs, vendor IDs), exact device models/OS builds tied to a person, crash-log
  incident IDs, install paths containing UUIDs.
- Links to private chat/agent sessions, CI run URLs or IDs, and artifact download links.

Describe problems by their *shape* ("a JS exception in the Worklets frame loop on a recent iOS 26")
and keep logs generic. If a crash log or CI log is pasted into a task, summarise the relevant frames
here; never paste the log. Before committing changes to this file, search it for the items above.

## Change log

Newest first. One line per change that alters what a future agent should know.

- Added section 0 (current status / handoff); keep it current, especially before running out of budget.

- Added the playback log (JS + native, shareable from Settings > Developer) and recorded the
  current state of the iOS "never starts playing" investigation.
- Initial version. Records: build/CI setup for the fork, the iOS URL-resolution race fix, native
  duration for progress, library-shuffle fix, queue duplicate fixes, stall-handling and
  thread-safety patch for nitro-player 1.5.0, launch-crash fix (Tamagui pinned to 2.7.4), and the
  open playback investigation.
