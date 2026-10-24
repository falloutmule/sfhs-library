# SFHS Library

**Your software. Your collection. Yours to keep.**

A phone-first, local-first library for compatible browser software. Browse ranked browser-software shelves, combine filters, search GitHub and indexed itch.io, import HTML or ZIP packages, launch isolated applications, retain versions, and export a portable archive containing the actual software and supported saves.

This is an **engineering candidate**, not a claim that every requirement in [the product constraints](docs/PRODUCT-CONSTRAINTS.md) has passed final acceptance. Android phone acceptance remains a release gate.

## Use it

1. Open the HTTPS Pages launcher in Android Chrome, or run it locally using the commands below.
2. Open **Discover**. Browse **Top phone games**, **Top rated games**, **Popular open-source apps**, tools, creative apps, and maker software. **See all** opens a ranked list. **Filters** combines type, Phone / Touch, Offline candidates, Open source, and source. Selections remain visible; **Clear filters** returns home.
3. Search for something specific, including a GitHub `owner/repository`. Sorting uses each source’s own evidence: itch browse order or actual GitHub stars. GitHub stars are interest, not review ratings; itch RSS supplies no numeric ratings. **Checked by SFHS** apps appear throughout the storefront and have their own source filter. Install on 2048 or Timekeeper acquires pinned, hashed files and checks them again before confirmation; then launch from Library. Online actions open the creator’s website separately and do not keep a local copy. **Details** explains each representation and any refusal.
4. Use **Details** for organization, permissions, app backup, exact original export, and retained versions.
5. Use **Backups → Export library** and keep the downloaded ZIP outside browser storage. Restore works into an empty library and validates every software checksum first.

No account, backend, runtime CDN library, proxy, API secret, analytics, or developer computer is required. Installed applications and usage metadata remain on the local device. GitHub Pages only distributes the launcher and discovery metadata.

## Development

Node 22 or newer:

```sh
npm ci
npx playwright install chromium
npm run build
npm run build:check
npm test
npm run test:browser
npm run dev
```

Open `http://127.0.0.1:4178`. On Windows PowerShell use `npm.cmd` and `npx.cmd` if script policy blocks their `.ps1` wrappers. `PLAYWRIGHT_BROWSERS_PATH` may point to an existing browser installation; the UI test also accepts `SFHS_BROWSER_EXECUTABLE`.

Canonical inputs are `src/`, `src/build-manifest.json`, `public/`, and `tools/`. Root `index.html`, its identical `start.html` recovery entry, `sw.js`, `catalog.json`, `icon.svg`, and `manifest.webmanifest` are generated. **Never hand-edit the root HTML.** The downloadable HTML bundles its code, styles, parser, ZIP library, and discovery index. `file://` storage behavior varies by browser; HTTPS is the recommended phone installation.

## Supported boundaries

- **Single HTML:** isolated execution, managed `localStorage`, in-session `sessionStorage`, and optional SFHS Save Bridge.
- **Static ZIP packages:** resolved classic scripts, CSS, images/audio, static ES-module graphs, and supported local fetch/WASM resources. Missing or unsupported resource patterns are refused.
- **Native bridge:** registered export/import/schema/validation callbacks, described in [the architecture guide](docs/ARCHITECTURE.md).
- **Network-dependent payloads:** retained locally; only reviewed declared origins may be allowed through capsule policy. Upstream CORS still applies.
- **Unsupported:** origin-dependent IndexedDB/OPFS, service workers, workers, unhandled dynamic imports/import maps, server backends, authentication/cookies, and other unsupported APIs. Static analysis is conservative and does not prove arbitrary applications compatible.

Limits: acquired app payload up to 32 MiB, expanded app package up to 64 MiB, managed save up to 4 MiB UTF-8, portable backup up to 150 MiB compressed and expanded. Export individual apps if a collection exceeds the archive cap. Synchronous ZIP work can take time on phones; phone responsiveness at these limits is unaccepted.

Original payload and executable hashes are separate. Public source is not automatically open source. Static inspection only labels an app **Offline candidate**. The launcher does not elevate per-app save restoration to **Verified** without application-level evidence. An export notification means the browser started a download, not proof that the user retained the file.

## Verification and release

`npm test` covers compatibility analysis, discovery, archive integrity, save validation, and focused Chromium isolation/runtime behavior. `npm run test:browser` covers UI install/relaunch, update and rollback, hostile-app attempts, complete storage destruction and restore, corrupt archive rejection, and offline launch/backup/restore. Evidence is written below ignored `test-results/`.

Real application corpus acquisition and results are documented in [COMPATIBILITY-CORPUS.md](docs/COMPATIBILITY-CORPUS.md). Purpose-built fixtures supplement real applications and are not represented as the whole compatibility corpus.

Pages deployment runs checks and publishes `release.json` with the deployed repository commit and HTML SHA-256. The catalog workflow refreshes bounded public itch RSS slices and selected GitHub application metadata, reports provenance/timestamps, and retains last good data on source failures. Browser discovery uses no scraping or CORS proxy.

If the phone still shows the original **Inspect / External only** interface, open [the updated Discover entry](https://falloutmule.github.io/sfhs-library/start.html#discover). This distinct path bypasses the original worker's old shell cache; it uses the same local library and does not clear apps or saves. Future online navigations fetch the current shell, with a verified cached shell as the offline fallback. Settings also offers **Check for Library update**; an available release has an explicit **Open updated Library** action. Running tabs are never reloaded automatically.

See [RELEASE-STATUS.md](docs/RELEASE-STATUS.md) for the exact unclosed gates and [PHONE-ACCEPTANCE.md](docs/PHONE-ACCEPTANCE.md) for the physical phone cycle.

The [Discover model and phone regression protocol](docs/DISCOVER.md) explain project-versus-version capabilities, metadata-derived browse filters, and the Cat Paw online/source-build distinction.
