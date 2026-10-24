# Discover: browse software worth keeping

Discover opens with ranked shelves, without typing or making GitHub API requests. Four previews per shelf scroll horizontally on a phone; **See all** opens the full indexed selection, rendering 36 cards at a time. Shelves with fewer than two suitable entries disappear. Checked apps appear alongside other software, with an explicit badge and a source filter.

## Browse, filter and sort

**Filters** has independent dimensions: type (any selected type), Phone / Touch, Offline candidates, Open source, and source. Results must match every selected dimension. Games + Phone + Open source is a real intersection. The compact summary shows selections even when the panel is closed. Clear resets the query, filters, sort and shelf; Discover home returns to shelves.

Search retains filters and combines matching indexed/checked software with live public GitHub results (up to 30 per request). An exact `owner/repository` or GitHub URL still finds that repository directly. Duplicates merge by project identity. One source failure leaves other indexed results usable. Details returns to the current list, sort, focus and scroll position; horizontal shelf positions also survive card updates.

Sorting is within the available indexed/search selection, not a claim to rank every app on a platform:

- **Recommended** favors relevant end-user software, checked evidence, source-native prominence, requested phone support, explicit open licenses, usable web versions and activity. Developer frameworks/libraries receive a strong penalty; they remain findable through explicit search.
- **Top rated · itch.io** and **New & popular · itch.io** preserve the relevant source-feed order. Items without that evidence follow source-ranked entries. A shelf’s See all keeps its exact feed until the source/type/phone scope changes.
- **Popular** preserves itch Popular order and GitHub star order within each source. Mixed lists group itch before GitHub rather than presenting a fabricated shared popularity measurement.
- **Newest** uses creation dates; **Recently updated** uses source update/push dates. A sort appears only when the current data supplies the necessary evidence.

GitHub stars measure interest, **not user ratings**. Numeric itch ratings/counts render only if explicit source review data supplies them; the current RSS feeds supply none. The UI instead identifies itch’s native ordering. No common five-star score is synthesized.

## Indexed sources and bounds

`tools/update-catalog.mjs` indexes eight public itch HTML5 RSS slices: Popular, Top Rated, New & Popular, Newest, mobile Top Rated, mobile Popular, touchscreen Popular, and creator-tagged open source. Each currently returns up to 36 listings. The cap is therefore 288 before deduplication: enough for four-card previews and useful See all lists without copying thousands of projects into the standalone HTML. The October 23 refresh has 235 unique projects. Provenance retains each feed URL, native rank, ordering context, phone-tag evidence, source creation/update dates, and per-feed refresh times. Explicit adult listings are omitted while remaining original rank numbers are retained. Feed tags never establish a license.

The generator uses sequential bounded requests, atomic output, per-slice last-good fallback, and preserves the existing file if every feed fails. The successful phone Top Rated RSS acquisition used for this release was retained during a later HTTP 429; it was parsed by the same generator, without inventing or reordering entries.

`tools/update-github-catalog.mjs` refreshes a bounded selection of 15 known browser applications (editors, games, tools, music and maker software). Repository API metadata supplies descriptions, explicit SPDX licenses, topics, stars and activity dates. The small reviewed seed list establishes end-user/browser intent, **not installation compatibility**. Relevant HTTPS homepages receive bounded HTTP availability checks; failures do not become Play buttons. Partial failures retain each project’s older metadata; total metadata failure preserves the previous index. Ordinary browsing requires no account/token and no runtime GitHub lookup. The existing weekly workflow refreshes both catalogs; the latest bundle remains available offline.

Classification uses application context, categories, description and topic evidence. Framework7 and F2 are developer libraries/frameworks rather than default storefront apps. A library management application is not rejected just for the word “library.” Broad categories remain hints; unknown is acceptable. Itch game-feed membership establishes Games, not Tools/CAD merely because a game mentions making things.

The generated launcher is approximately 670 KiB, versus 535 KiB before this storefront. Data remains bundled for standalone/offline browsing. This is an indexed selection, **not live search of all itch.io**, and may miss software outside the retained feeds/projects. Freshness is shown compactly; source mechanics stay under About sources.

## Projects and usable representations

A project, public source tree, live web build and local browser package are separate things. Public source is not automatically open licensed. A release ZIP is not automatically a browser app. A homepage is not an acquired payload.

Details leads with what the app does, usable actions, local install verdict, local preservation and license. Technical details stays collapsed and retains exact reasons, entries/counts, commits, branch, releases, README and license caveats. GitHub inspection considers metadata, relevant HTTPS homepage, Pages where available, releases/assets, conventional built directories, root/source HTML and README. It attempts no speculative build.

Online links open separately with `noopener`, `noreferrer`, and no referrer. A responding website observation expires after seven days and establishes availability at that time, not safety, functionality, phone testing, offline use or source/build correspondence. Only confirmed installation retains original bytes, hashes and the separate executable capsule. Normal CORS, acquisition bounds, sandboxing, save rules and archive integrity remain unchanged. Unsupported packages remain refused, with specific explanations and usable alternatives.

Phone/touch metadata means **indicated**, never physically verified. Offline filtering requires a compatible analyzed candidate or explicit blocked-network test evidence; merely mentioning “offline” does not qualify. Open source requires a recognized explicit license. Checked by SFHS establishes the recorded source/package/website evidence, not blanket phone, safety, offline or save verification.

Cat Paw Air Hockey remains a phone-indicated two-player game with a separately checked Pages action, unknown license, and source that needs a build. It is not summarized as External only. Pete’s actual source still fails dynamic-code policy while its checked online version is offered separately. The recorded Mykonos 404 is not advertised as playable.

## Verification and physical acceptance

Run `npm run test:storefront`, `npm run test:storefront:browser`, the main `npm test` and `npm run test:browser`, build parity, and the real corpus. Tests cover actual catalogs, combined filters, native ranking, rating honesty, real Framework7/F2 metadata, source failures, mobile shelves/navigation, Cat Paw, strict install refusals, real pinned installs and recovery. Proofs are ignored under `test-results/`. Deployment publishes the actual commit/build/hash in `release.json`; verify live HTML bytes against that release.

Physical Galaxy acceptance remains outstanding. Open the deployed `start.html#discover`, browse Top phone games without typing, use See all, then combine Games + Phone / Touch + Open source. Check clear/reset, Details return, scroll/touch targets and source-aware sorts. Automated 320/390/412px and desktop checks are engineering evidence only.
