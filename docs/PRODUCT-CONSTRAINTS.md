# SFHS Library / Launcher
## Final Product Constraints

## Product definition

SFHS Library is a phone-first personal software library for browser software.

The finished product must provide:

**discover → inspect → install → organize → launch → save → update → preserve → back up → restore**

It is not restricted to applications produced by SFHS tooling.

The launcher must handle compatible:

- SFHS applications
- standalone HTML applications
- HTML5 games
- multi-file browser packages
- Canvas applications
- DOM applications
- Three.js / Babylon / Pixi applications
- WebAssembly applications
- software imported from the device
- suitable GitHub-hosted software
- suitable itch.io software

Compatibility is established by actual behavior, not by naming or producer identity.

---

# 1. Final deployment

The canonical product must exist in a GitHub repository and be deployed through GitHub Pages over HTTPS.

The deployed Pages version must correspond to a known repository commit.

The repository must contain the source necessary to reproduce the deployed launcher.

The launcher itself should still have a downloadable standalone HTML artifact.

GitHub Pages may additionally serve generated discovery data, icons, a manifest, service-worker support, or other deployment infrastructure when genuinely required.

Those supporting files do not turn installed third-party applications into server-hosted applications.

User-installed software lives locally on the user's device.

GitHub Pages is the distribution point for the launcher, not the storage server for the user's library.

---

# 2. No required backend

Normal library operation must not require:

- an SFHS server;
- a database server;
- a proxy service;
- a user account;
- cloud storage;
- an API secret shipped in the browser;
- the developer's computer remaining online.

GitHub Actions may perform repository-side jobs such as generating discovery indexes or deploying Pages.

That is build/discovery infrastructure, not a runtime dependency for launching the user's installed library.

If GitHub disappears temporarily, already-installed offline-capable applications and local library management must continue working.

---

# 3. Local library ownership

Installed application payloads must be stored on the user's device.

The primary managed store should use appropriate browser storage such as OPFS and/or IndexedDB.

The launcher must request persistent storage when supported and report whether persistence was actually granted.

It must display estimated storage usage and available quota.

Browser storage must never be described as a backup.

Browser-managed data can be evicted in some circumstances unless persistence is granted, and even persistent data can be removed explicitly by the user.

Therefore every library must be exportable.

---

# 4. Built-in discovery browser

"Built-in browser" means an actual software discovery interface inside SFHS Library.

It does **not** mean wrapping GitHub or itch.io inside an iframe and calling that integration.

The launcher provides its own:

- search
- result cards
- filtering
- details
- compatibility analysis
- license information
- installability information
- source information
- install actions

External source pages remain available through an explicit **View Source** action.

Opening an external website is not equivalent to discovering or installing it.

---

# 5. GitHub discovery

GitHub discovery must work from inside the launcher.

GitHub's REST API supports browser CORS requests, so public GitHub discovery can operate directly from the Pages application.

No GitHub token may be compiled into the published launcher.

Unauthenticated operation is the baseline.

API rate limits must be handled explicitly. GitHub currently limits unauthenticated REST access to 60 requests/hour and gives search endpoints their own more restrictive budgets.

When rate-limited, the launcher must say so.

It must not silently switch to an undocumented scraping proxy.

GitHub results should inspect, where available:

- repository metadata
- releases
- repository contents
- Pages information
- downloadable artifacts
- entry HTML
- package layout
- README
- license
- recent activity

A repository link alone is not an installation.

---

# 6. itch.io discovery

itch.io must appear as a real discovery source.

itch.io officially supports both single HTML uploads and ZIP HTML applications containing `index.html`.

Its public API does not provide a general anonymous game-search API suitable for this launcher, but itch provides RSS feeds for browse pages and several global feeds.

Therefore the final implementation may use a GitHub Actions-generated itch discovery index based on publicly available itch discovery feeds and metadata.

The interface must clearly identify this as an **indexed itch.io catalog**, including its last refresh time.

It must not claim to search the entirety of itch.io live if it does not.

A full itch.io search may additionally open itch.io itself.

That external search does not count as built-in search.

---

# 7. Open software preference

Open software receives a genuine ranking preference.

Default discovery ranking should prefer, among similarly useful results:

**explicit open license → source-available → proprietary/freeware → unknown**

There must also be an **Open only** filter.

Closed or unknown-license applications are not hidden unless the user activates that filter.

Usefulness and compatibility still matter.

A broken MIT project should not outrank a working program solely because it is MIT.

---

# 8. No fake open-source classification

Public source code does not automatically mean open source.

A repository with no recognizable license must be classified:

**LICENSE UNKNOWN**

not:

**OPEN SOURCE**

If GitHub detects an SPDX license, display that information and its source.

Repository-level license detection must not be represented as proof that every bundled dependency uses that same license.

---

# 9. Installation has a strict meaning

An application may be labeled **INSTALLED** only when the launcher possesses the application payload needed to run that installed version locally.

These do not count as installations:

- bookmarks
- external URLs
- iframe links to the original site
- repository links
- itch project links
- cached thumbnails
- metadata records

If removing network connectivity prevents the launcher from locating the application payload itself, it was not installed.

A network-dependent installed application may still require networking for its own operation, but its local application payload must exist.

---

# 10. Preserve the original

When software is imported or downloaded, the launcher preserves the original acquired payload.

If compatibility requires rewriting, bundling, injecting a storage adapter, changing paths, or producing a launcher-specific capsule, the system must preserve both:

**ORIGINAL PAYLOAD**

and

**EXECUTABLE CAPSULE**

Each receives its own hash.

The transformed application must never silently replace the source bytes in the archive.

---

# 11. Application compatibility profiles

The launcher must not pretend every web application can run safely under the same mechanism.

Every installed application receives an explicit runtime profile.

### Native SFHS profile

Applications intentionally supporting launcher interoperability.

Best support for:

- saves
- backup
- restore
- lifecycle
- fullscreen
- capability declaration

### Isolated single-file profile

Self-contained HTML executed inside an isolated application capsule.

Appropriate browser capabilities may be granted deliberately.

### Isolated packaged profile

Multi-file static application converted into or served through a launcher-managed isolated runtime.

Installation succeeds only if required resources can be resolved reliably.

### Network-dependent profile

Application payload is local but requires declared network services or remote assets.

### External-only profile

Software cannot safely or correctly run from the launcher.

It may remain in Discover or bookmarks but cannot be called installed.

---

# 12. Security isolation is mandatory

Arbitrary downloaded JavaScript must not execute unrestricted in the launcher's own origin.

Running app A at:

`/apps/A/`

and app B at:

`/apps/B/`

does **not** create security isolation because browser origins are based on scheme, host, and port—not path.

Likewise, simply creating a blob URL does not create a new independent origin; blob URLs retain the creator origin when derived from HTTP/HTTPS.

Untrusted applications therefore require a genuine isolation boundary.

A sandboxed iframe without `allow-same-origin` receives an opaque origin, which provides useful isolation but also removes normal origin storage access.

This tradeoff must be solved deliberately rather than ignored.

---

# 13. Storage virtualization

Because arbitrary applications cannot safely share the launcher's origin, the launcher needs per-application managed state where compatibility permits.

The isolated application environment may provide adapters for supported persistence mechanisms.

At minimum, the finished system should pursue reliable isolation for the storage mechanisms actually demonstrated in the supported application profiles.

The implementation must not claim transparent support for APIs that were not successfully virtualized.

Particularly difficult cases include:

- IndexedDB-heavy applications
- service workers
- workers loading relative files
- dynamic imports
- arbitrary `fetch()` paths
- OPFS used directly by the application
- browser-managed authentication
- third-party cookies
- DRM
- server-side saves

An application requiring unsupported behavior receives a lower compatibility profile rather than an unsafe fallback.

---

# 14. No unsafe same-origin fallback

The implementation must not solve incompatibility by quietly launching arbitrary downloaded code unsandboxed in the launcher's origin.

That would give the application an opportunity to interfere with launcher data or other applications.

Likewise, `sandbox="allow-scripts allow-same-origin"` must not be treated as meaningful protection for same-origin untrusted content; MDN specifically warns against that combination for same-origin embedded resources.

If safe isolation makes a particular application impossible to run, the correct result is:

**UNSUPPORTED**

not:

**INSTALL SUCCESSFUL**

---

# 15. Software backup

Software backup means preservation of the actual executable payload.

A software backup must contain enough material to reconstruct exactly the archived version.

Its checksum must match after restoration.

Metadata-only backup does not count.

A link to GitHub or itch.io does not count.

---

# 16. Save backup

Save backup is a separate property from software backup.

Each application shows independently:

**SOFTWARE PROTECTED**

and

**SAVE PROTECTED**

Possible save states:

- Verified
- Supported
- Partial
- External/remote
- Unsupported
- Unknown

"Verified" has a strict meaning.

The system must demonstrate:

save state → backup → remove state → restore → application observes restored state.

Merely reading a storage key does not constitute verified restore.

---

# 17. SFHS Save Bridge

SFHS applications may optionally use a formal save interface.

The bridge should support concepts equivalent to:

- export state
- import state
- schema/version identification
- validation after import

Using the bridge gives the strongest compatibility level.

The bridge remains optional.

Non-SFHS applications are not rejected solely for lacking it.

---

# 18. Full application backup

A full app backup includes, when available:

- original payload
- executable capsule
- current version
- archived versions selected for preservation
- save data
- metadata
- source information
- license information
- hashes
- icon/artwork needed by the library

The backup format must be versioned.

---

# 19. Full library backup

A Full Library Backup must contain enough information to recreate the user's local library without retrieving the installed software again from the Internet.

It includes:

- applications
- supported saves
- versions
- categories
- collections
- favorites
- usage metadata
- source provenance
- compatibility profiles
- hashes
- license metadata

The backup should be one portable archive.

A ZIP-compatible container with a versioned manifest is acceptable.

---

# 20. Full library restore

A restore must work into an empty SFHS Library.

It may not rely upon the previous browser database surviving.

It must rebuild the library from the exported archive.

Applications whose saves cannot be backed up must remain explicitly identified as such after restoration.

---

# 21. Updates

Applications are never silently replaced.

An update performs:

current save snapshot where supported → preserve old application → acquire new payload → analyze new payload → install → verify → make active.

The previous working version remains available for rollback until explicitly removed.

An "update" is not merely reloading an upstream website.

---

# 22. Version history

A displayed archived version must correspond to bytes actually retained locally or inside a backup.

Recording only:

`Version 1.4`

without retaining version 1.4 does not count as version preservation.

---

# 23. Offline classification

Applications receive one of:

**OFFLINE VERIFIED**

**OFFLINE CANDIDATE**

**USES NETWORK**

**UNKNOWN**

"Offline Verified" requires a real launch with networking disabled or blocked.

Static inspection alone may produce a candidate classification, not verification.

---

# 24. Network behavior

The launcher itself may access the network for:

- discovery
- source metadata
- downloads
- update checks

Installed applications may use networking when their compatibility record says so.

Unexpected network activity discovered during testing changes the application's classification.

No analytics or telemetry should be required for the launcher to function.

---

# 25. Capability control

Downloaded applications do not automatically receive powerful browser capabilities.

Capabilities such as:

- microphone
- camera
- location
- clipboard
- fullscreen
- downloads
- gamepad
- pointer lock
- networking

must be governed by the application's runtime profile and user interaction.

Where the browser itself controls permission, the launcher must not imply that it has granted or denied more than it actually can.

---

# 26. Search and organization

The finished library includes:

- global search
- categories
- user collections
- favorites
- recent
- most used
- newly installed
- archived versions
- source filtering
- license filtering
- compatibility filtering
- offline filtering

Usage metadata remains local by default.

---

# 27. Phone-first requirement

All primary workflows must work on Android Chrome without requiring desktop-only APIs.

This includes:

- finding software
- importing HTML
- importing ZIP
- installing from compatible URL
- launching
- fullscreen
- browsing collections
- backup
- downloading backup
- selecting backup from phone storage
- full restore
- app restore
- rollback
- updating
- removing

The user must not need a PC to operate the finished library.

---

# 28. Desktop remains engineering evidence

Desktop Chromium automation should be used extensively.

It does not constitute final user acceptance.

The user's phone is the acceptance route.

---

# 29. GitHub Pages size constraint

The Pages repository must not become a warehouse containing every application in the user's collection.

GitHub currently limits a published Pages site to 1 GB and applies a soft 100 GB/month bandwidth limit.

Therefore:

**Launcher code/catalog → GitHub Pages**

**User's installed library → local device**

**Portable backup → user's chosen file storage**

That separation is architectural, not temporary.

---

# 30. Direct-download constraint

The browser can only directly retrieve remote software when normal web security permits it.

If an upstream server blocks CORS or otherwise prevents programmatic retrieval, SFHS Library must not use an untrusted public CORS proxy merely to make installation appear universal.

The supported fallback is:

**download normally → import local file**

That is not failure of the launcher; it is an upstream/browser boundary.

---

# 31. itch.io ownership constraint

The launcher must respect software distribution terms.

It must not scrape around download controls, purchase requirements, access controls, or creator restrictions.

For software the user legitimately downloads from itch.io, local import may then install the obtained HTML/ZIP if compatible.

---

# 32. Exact provenance

Every application should preserve:

- source
- source URL
- repository/project
- acquisition time
- original filename
- original hash
- executable hash if transformed
- upstream version when available
- license information seen at acquisition

These are provenance facts.

They must not be embellished into claims such as canonical build, reproducibility, signed release, or trusted upstream unless those claims were actually verified.

---

# 33. Discovery ranking

Default discovery should balance:

relevance → installability → mobile usability → explicit open license → offline capability → artifact simplicity → maintenance/freshness.

Open licensing receives a meaningful preference without overwhelming basic usefulness.

---

# 34. User control

The launcher may suggest updates.

It does not:

- automatically replace software
- automatically delete old versions
- automatically delete backups
- automatically upload software
- automatically publish the user's collection
- automatically modify categories
- automatically change application code without retaining the original

Destructive operations require clear user action.

---

# 35. No central lock-in

A user must be able to export the software they installed.

SFHS Library must not become the only way to access an SFHS artifact.

A single-file application remains a single-file application.

The launcher adds management around it rather than converting ownership into dependence on the launcher.

---

# 36. Anti-cheating rules

The project is **not complete** if any of these substitutions occur:

**Bookmark ≠ installed application**

**Remote iframe ≠ local application**

**Metadata ≠ software backup**

**Browser storage ≠ portable backup**

**Save detection ≠ save restoration**

**Public repository ≠ open source**

**Repository license ≠ dependency-license proof**

**Source URL ≠ retained version**

**Version number ≠ version archive**

**Application opens ≠ application is safely isolated**

**Application opens once ≠ compatible**

**Static inspection ≠ offline verified**

**Desktop test ≠ phone acceptance**

**External itch search ≠ built-in itch discovery**

**GitHub result card ≠ GitHub installer**

**Previous-version metadata ≠ rollback**

**Refreshing upstream ≠ updating**

**Reinstalling current upstream version ≠ restoring**

**Same Pages path ≠ separate origin**

**A sandbox that breaks saves ≠ save-compatible isolation**

**A proxy that bypasses CORS ≠ legitimate universal downloading**

**A screenshot/demo ≠ working product**

---

# 37. Required proof corpus

Before release, the launcher must be tested against materially different real applications rather than only purpose-built demo fixtures.

The corpus must exercise:

- strict SFHS single-file app
- ordinary non-SFHS single HTML
- HTML game using local persistence
- multi-file HTML package
- application with images/audio
- WASM application
- ES-module application
- network-dependent application
- intentionally incompatible/server-dependent application
- explicitly open-license GitHub project
- public GitHub project with unknown license
- itch.io HTML/ZIP acquired through a legitimate path
- application update and rollback
- application whose save cannot be backed up

Purpose-built fixtures may supplement this corpus but cannot replace it.

---

# 38. Backup proof

Release verification must include a destructive recovery test.

Create a populated library.

Export a Full Library Backup.

Record hashes/state.

Remove the library from the test browser environment.

Start from an empty launcher.

Import the backup.

Verify:

- application count
- exact application payload hashes
- collections
- favorites
- metadata
- archived versions
- supported saves
- launchability

Without this test, Full Library Backup is not considered complete.

---

# 39. Save proof

For each advertised save-support profile:

create recognizable state → close app → backup → delete application/state → reinstall/restore → reopen → verify expected state.

This needs actual application-level observation.

Database existence alone is insufficient.

---

# 40. Update proof

At least one release candidate must prove:

version A installed → save created → version B discovered → update performed → B launched → rollback to A → A launched → associated state remains coherent.

---

# 41. Isolation proof

Testing must attempt to make an installed hostile fixture:

- read launcher storage
- modify launcher metadata
- read another application's save
- overwrite another application's files
- escape its intended frame/runtime boundary

A successful attack is a release blocker.

---

# 42. Offline proof

With networking disabled:

- launcher library opens
- metadata remains visible
- search works locally
- collections work
- offline-verified applications launch
- backups can be created
- backups can be restored

Discover naturally reports that networking is unavailable rather than failing ambiguously.

---

# 43. Phone acceptance

The production GitHub Pages build must be tested from the user's phone.

Acceptance must include a real cycle of:

Discover → install/import → launch → save → exit → relaunch → backup → remove → restore → launch restored application.

At least one non-SFHS application must complete the cycle.

At least one unsupported application must be correctly refused or downgraded instead of being falsely reported as compatible.

---

# 44. Release state

The project is finished only when:

repository state is known;
main contains the release;
Pages is deployed;
Pages serves the intended commit;
automated verification passes;
compatibility corpus passes;
backup destructive recovery passes;
security/isolation tests pass;
the actual phone workflow passes.

A green CI build by itself does not establish completion.

---

# 45. Final product identity

The finished experience should feel like:

**Steam library + software archive + offline collection manager for browser software**

but without:

- accounts
- DRM
- mandatory cloud
- proprietary library lock-in
- forced marketplace
- dependence on SFHS-produced applications

Its distinctive promise is:

> If compatible browser software is worth keeping, SFHS Library can help you find it, understand what it is, preserve the version you actually used, launch it easily, preserve supported state, and restore your collection later.

The system must clearly say when any part of that promise cannot be made for a particular application.