# Discover: software first, evidence available

Discover answers what a project does and which actions are available. Descriptions come from repository/catalog metadata or a bounded README summary. Missing descriptions are explicitly identified. Compact category glyphs replace decorative monogram artwork in discovery results; installed Library cards retain their existing design.

## Checked apps before untested search

Physical phone feedback rejected the previous UX: a homepage led to a Netlify 404, and an incompatible install ended with only Cancel. Discover now starts with a small checked shelf. Two packages, 2048 and Timekeeper, have pinned source commits and per-file SHA-256 hashes in `public/checked-apps.json`. Clicking Install acquires the original files directly from immutable GitHub raw URLs, checks every hash and existing size/path limit, then performs normal capsule analysis and user confirmation. No app code is bundled into the trusted launcher, hosted as an installed app on Pages, or installed merely because a catalog entry exists. The checked shelf works without a GitHub API lookup; acquisition still requires a connection until the app is installed.

The default phone view shows both install choices and their descriptions without expanding a form. Search and filters are disclosed on demand. Search the web explicitly selects the broader, untested GitHub/itch results and their existing category/filter controls. Card descriptions, touch targets, licensing, and compatibility distinctions remain readable while owner/source mechanics move into Details.

Website evidence is independent. A relevant homepage alone stays unverified and cannot create a Play online action. Explicit HTTP observations are labeled with their check time; a known failure is shown as unavailable. A responding check expires after seven days and falls back to unverified. `tools/check-discover.mjs --websites-only` updates the three bounded URLs through the existing weekly catalog workflow. These checks establish that a website responded, not safety, complete functionality, local preservation, offline operation, source correspondence, or physical phone support.

`falloutmule/pete-hegseths-drunken-space-force` has a checked published Pages route even when GitHub's unauthenticated Pages metadata endpoint is unavailable and the repository has no homepage. Its pinned source still fails the dynamic-code policy. Details states the specific reason and offers Play online and browsing installable apps. A rejected package from web search uses that same detail screen rather than a Cancel-only modal. Runtime restrictions are unchanged. `boona13/mykonos-island-voxels` returned HTTP 404 at the recorded check; it is not advertised with a Play button.

`npm run test:checked` downloads the real pinned files and tests the product's actual install flow with original raw URLs and CORS. It exercises both real apps, saved state, exact originals in a portable backup, and empty-library restoration with networking disabled. A separate fixture changes a source byte without changing its size and verifies refusal before installation. Playwright itself aborts intercepted `/favicon.ico` fetches; only that tampering fixture uses a query on the same immutable favicon URL to avoid a harness artifact. Positive installs have no request interception.

## Projects and representations

These are separate facts:

| Representation | What it establishes | What it does not establish |
| --- | --- | --- |
| Project | Name, description, topic/category hints | Compatibility or preservation |
| Public source tree | Repository and source information can be viewed | An explicit open license, a ready browser build, or a local installation |
| Listed live web build | A relevant HTTPS homepage/Pages route can be opened separately | Local app bytes, safe import, supported saves, offline use, or correspondence to source |
| Static browser package candidate | A bounded HTML entry and its directory can be acquired at a specific commit | Successful package analysis or runtime compatibility |
| Checked browser package | The acquired bytes passed the existing package checks | Installation until confirmed, phone verification, or offline verification |
| HTML/ZIP release download | A normal creator download route exists for that file | A browser-compatible release merely because its filename ends in ZIP |
| External-only representation | That representation cannot be acquired/run safely by the local runtime | That every other form of the project is unusable |

GitHub inspection considers repository metadata, a relevant HTTPS homepage, Pages information when available, published releases/assets, conventional built directories (`dist`, `build`, `docs`, `public`), root HTML, source HTML, and README/use instructions. Up to six bounded eligible HTML entries are inspected; uninspected alternatives cannot be selected for acquisition. Development-source detection remains conservative. No build is attempted and no hosted site is crawled into an installation.

Acquisition remains limited to supported static repository packages. HTML/ZIP release assets are offered as normal external downloads followed by local import; format and compatibility are checked on the acquired file. They are never labeled ready solely from release metadata. CORS failures remain visible and do not trigger a proxy or unsafe runtime fallback.

## Independent user-facing states

`discover-model.js` derives online-use, local-install, download/import, source, license, phone, and offline states independently. A card has one visually primary action based on the available representation, plus Details. Source code is secondary. Details starts with the description, usable actions, an installation verdict, local preservation, and license. Technical details is collapsed by default and retains exact reasons, entries, counts, commit, branch, release metadata, README, and license caveats.

Online links use a separate tab with `noopener`, `noreferrer`, and no referrer. They never enter the isolated local runtime and never add an application record. Only the existing confirmed install flow retains original bytes, hashes, and an executable capsule. A changed source entry invalidates the previous check; a package checked for one entry is not reused for another.

Rejected package checks retain their negative verdict and exact reasons for that inspected commit/entry even after another app is checked. Only one acquired payload is retained in the pending-install cache; keeping a rejection does not retain additional executable files or convert it into an installation.

Metadata such as `android`, `mobile`, `phone`, or `touch` yields **Phone / touch indicated**, never verified. An offline topic/description can help filter results, but the offline state remains unknown until actual package analysis yields Candidate or Network. No discovery metadata creates Offline verified. Explicit recognized open licenses keep their ranking preference and the Open licenses only filter; unknown licenses remain unknown.

Browse categories use small, explicit term rules over supplied descriptions/topics/titles. They are hints, not a compatibility taxonomy. Unknown is allowed. itch games-feed membership establishes a game listing, while the indexed catalog date and limited coverage remain visible through a compact status and About sources disclosure. GitHub rate limits, offline state, unavailable catalogs, and source failures receive visible error messages.

## Cat Paw regression

Cat Paw remains on the checked shelf as an online option. Its website opens separately and is never added to Library by that action. Details still performs normal source inspection and exposes the negative build verdict. Open licenses only excludes it because the license is unknown. Empty Library leads with Find an app and retains file import as a secondary choice.

`falloutmule/cat-paw-air-hockey` is described by its repository as “Local two-player cat-paw air hockey for one shared phone.” Its Pages homepage is a separate **Play online** action. Android/two-player metadata yields phone indication and a two-player tag. Its unknown license stays unknown.

The inspected `src/index.html` requires a browser build, so the repository representation receives **Source needs a build**. Its entry path, count, exact refusal reason, and commit are available under Technical details. The project is not summarized as External only. Opening the online version does not create local software or save protection.

## Verification and phone acceptance

```powershell
npm.cmd run build
npm.cmd run build:check
npm.cmd run test:discover
npm.cmd run test:discover:browser
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:corpus
npm.cmd run test:updates
```

The normal Pages workflow already runs `npm test` and `test:browser`; the latter includes the focused Discover browser suite. Existing runtime, archive, save, and standalone checks remain in that path. Discovery UI fixtures supplement live repository inspection and the existing real-app corpus.

Phone-oriented Chromium evidence covers 412×915, 390px, and 320px portraits plus desktop, long content, source-build/online-only/ready/refused cases, release import, itch, no results, errors, keyboard focus, and touch targets. In the controlled Cat Paw comparison, the result card fell from about 358px to 278px while its description uses 14px text, actions remain at least 44px high, and the first Play action is clear of the bottom navigation. Proofs and screenshots are under ignored `test-results/discover-ux/` with the tested `build-info.json` identity.

**Physical phone acceptance remains outstanding.** On the production Pages URL:

The new revision responds to the user's physical rejection of the previous result list and dead-end failure screen. Automated success is not a physical acceptance verdict. First try installing 2048 or Timekeeper from Checked apps, launching it, and reopening saved state. Then open Pete's Details and the broader web search. The reported dead website must not be presented as playable.

The reported phone screenshots still showed the pre-redesign cached shell. Use `https://falloutmule.github.io/sfhs-library/start.html#discover` to reach the new opening screen without clearing local data. The upgrade browser regression first installs an actual app and saves progress, recreates the original cache-first behavior (including ineffective query changes), then verifies the new route, byte-for-byte retained app records, managed save recovery offline, sibling-cache preservation, and subsequent visible updates. Automated phone-sized checks do not close physical acceptance.

1. Open Discover and search `cat paw air hockey`; the description and Play online action should be understandable immediately.
2. Open Details. Confirm that online use, source needing a build, unknown license, and unverified phone/offline status remain distinct. Expand Technical details and return without losing your place.
3. Browse Games, Tools, Phone / Touch, and an itch listing. Read descriptions and check that buttons remain visible above the navigation bar.
4. Check/install a compatible static app, then confirm that online use of a different project does not add it to Library.
5. Report whether the result density and wording now explain what each app does on the actual Galaxy phone. Desktop and emulation success do not close this gate.
