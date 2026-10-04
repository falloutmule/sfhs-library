# Real application compatibility evidence

This is bounded engineering evidence, not a claim of universal browser compatibility or physical-phone acceptance. The corpus uses unmodified third-party payload bytes and a read-only copy of the existing SNC artifact. Third-party software remains under ignored `test-results/`; it is not redistributed with the launcher repository or Pages site.

Latest final-artifact run: **PASS**, `sfhs-library-20261003-r1-130b323839`, launcher SHA-256 `eb0973a9e3644b0ef13bd3f76f062318e023affdf4d246d7ac8c74c4eb29f4b8`. The seven real cases and six-application empty-context recovery completed on 2026-10-03 (America/Denver); the timestamped UTC proof directory is `test-results/corpus-proof-2026-10-04T02-48-39-163Z/`.

The runner imports files through the real launcher's UI at a 412 × 915 Chromium viewport, disables browser networking, uses each application, exports a full library ZIP, closes that browser context, opens a separate empty context, restores without networking, and observes restored application state. Installed frames must have exactly `sandbox="allow-scripts"`. The served launcher bytes are frozen for the entire test and checked against `build-info.json`.

## Reproduce

```powershell
npm.cmd ci
npm.cmd run build
node tools/acquire-corpus.mjs --itch
# Optional on the author's existing workspace; reads SNC without changing it:
node tools/acquire-corpus.mjs --itch --include-local
node tests/corpus.mjs
```

Chromium must be available to Playwright (`npx.cmd playwright install chromium`). Public source acquisition needs networking; the application and recovery tests explicitly disable networking after loading the launcher. Acquired files are cached only when their saved SHA-256 agrees. GitHub inputs are pinned to the commits below. The itch demo uses its normal visible free download control; `--refresh` re-acquires and records whatever version the creator currently serves.

## Observed cases

| Actual software | Preserved input | Evidence observed in the isolated runtime | Save / recovery evidence |
| --- | --- | --- | --- |
| [2048](https://github.com/gabrielecirulli/2048/tree/478b6ec346e3787f589e4af751378d06ded4cbbc) | 32-file repository ZIP; MIT detected | Keyboard moves; displayed score and every saved cell agree with actual game state | Exact board and score rendered after close/relaunch and restoration into an empty browser context |
| [T-Rex Runner](https://github.com/wayou/t-rex-runner/tree/5455bfa408ec6b707c7300ff194b7390733a766d) | 19-file repository ZIP; BSD-3-Clause detected | Real canvas game starts and distance advances; archived sprite images decode | Original software bytes restored; managed save support remains unknown. Google font is unavailable offline; observed gameplay still works |
| [Timekeeper](https://github.com/williamjussiau/timekeeper/tree/d1fbdfb93169fa195b46d6b43eee26aa55af1016) | Original `timekeeper.html`; MIT detected | Creates and renders the named project “SFHS real restore proof” | Application renders that project after close/relaunch and restoration into an empty context |
| [TOMatoTimer](https://github.com/jonruark/TOMatoTimer/tree/875d8d02588a21e843969d5336c4241cbd71eb50) | Original `index.html`; MIT detected | Starts, counts down, and pauses with networking disabled | Original software bytes restored; persistent-save support is not claimed. Optional remote fonts remain classified as network use |
| Solidarity Not Charity Can Run | Read-only local root artifact; SHA-256 and checkout commit recorded | Imports and starts the existing canvas application in the opaque sandbox | Original software bytes restored. This smoke does not establish mobile feel or full in-game save recovery |
| [Silted Stacks — Free Demo](https://mikaelha.itch.io/silted-stacks) | Creator's normal free download, `Silted-Stacks-Free-Demo-1.0.0.zip`; 30,910 bytes | Real puzzle turn advances with Wait and returns with Undo while offline | Original software bytes restored. Creator explicitly states no persistent saves; no save protection is claimed |
| [Hourglass Fable5](https://github.com/khanmjk/Hourglass_Fable5/tree/91ee818bd2bf4e4e77648f5a8adbebeea360af6b) | Original repository file bytes in ZIP; MIT detected | Correctly refused for unsupported import maps, bare module specifiers, and dynamic import behavior | Not installed. This exercises a real Three.js/Rapier WASM application without inventing a compatible profile |

Repository license observations do not audit all dependencies. The itch creator describes personal-play permission and no source-code/commercial asset-reuse license; it is not classified as open source. Its bytes are retained only in local test output. The download was obtained by clicking the visible **Download** link under **Download demo**, not **Buy Now**, and did not extract a hosted iframe or bypass download controls.

## Proof contents and limits

Each `test-results/corpus-proof-<timestamp>/proof.json` records the exact launcher artifact SHA-256, `build-info.json`, original and executable payload hashes, source commit/provenance, compatibility decisions, application observations, and restoration results. Screenshots and the full portable backup accompany it. `test-results/corpus/*.provenance.json` records each acquired original independently. A successful seven-case run installs six applications, refuses Hourglass, exports/restores those six, checks their original hashes, and proves visible restored state for the two supported-save applications above.

Supplemental tests in `tests/runtime-unit.test.mjs` exercise isolated localStorage and SFHS Save Bridge restore, static ES-module graphs, package JSON fetch, WASM `instantiateStreaming`, image/audio decoding, hostile-origin access attempts, and denied networking. These small fixtures supplement the real corpus; they are not described as independent real applications. Broader library update/rollback, archive tampering, collections, and isolation workflows are covered by `tests/browser.mjs` and archive/store tests.

Remaining acceptance limits:

- A physical Android Chrome cycle on the deployed Pages build is still required.
- Successful execution of a substantial real WASM application and a real ES-module application is not established; the real Hourglass case is a refusal, and working API coverage is synthetic.
- This real corpus does not establish version-to-version update/rollback of a third-party release or a real server-dependent application. Those paths have focused supplemental coverage only.
- The unknown-license GitHub classification is tested with controlled API responses; this run does not assert a particular real public repository has no license.
- Network-denied launches establish only the interactions actually observed here. External authentication, direct IndexedDB/OPFS, service workers, and application workers remain unsupported.

The launcher does not automatically convert these engineering observations into global “Verified” badges for other installations.
