# Release status — October 23, 2026

**PASS: storefront engineering checks. Physical Galaxy acceptance remains pending.**

The launcher remains a generated standalone HTML with GitHub Pages distribution and offline shell recovery. `build-info.json` identifies the tested artifact; deployment adds `release.json` with its actual commit and SHA-256. A release is verified against the live bytes, not a query-string cache change.

## Storefront evidence

- Ranked shelves open from bounded indexed data without typing or GitHub API requests. Independent type/device/offline/license/source filters genuinely intersect.
- Native itch Top Rated/Popular/New & Popular order is retained. No numeric reviews are fabricated. GitHub stars remain labeled as GitHub interest, not app ratings.
- End-user app selection and contextual classification keep Framework7/F2 out of default recommendations while preserving explicit search.
- 23 focused storefront model/catalog checks, within 67 unit/runtime checks; 19 focused storefront browser checks, within the full browser suite (81 local checks, 80 when the optional ignored historical baseline is absent).
- Automated portraits at 320, 390 and 412 px plus desktop cover shelves, combined filters, sorting, source errors, long text, Details return and navigation clearance.
- Full browser checks retain real installation, unsupported refusals, exact originals/hashes, opaque runtime isolation, supported saves, update/rollback, portable backup, destructive empty-library recovery, offline operation, standalone HTML and launcher cache migration.
- Seven real corpus cases: six apps acquired/installed/restored offline; the known incompatible WASM/module app remains refused. Real 2048 and Timekeeper also receive a separate source-hash/install/save/backup/restore proof. Cat Paw keeps online availability separate from source needing a build and an unknown license; Pete remains refused locally and the recorded Mykonos 404 remains unavailable.

## Remaining limits

Physical phone acceptance is outstanding. Follow the storefront steps in [PHONE-ACCEPTANCE.md](PHONE-ACCEPTANCE.md) on the exact deployed build. Desktop and emulation success do not establish physical phone usability or performance.

The indexed storefront is bounded, not a complete platform index or live itch search. Source metadata may be missing or stale. HTTP website observations expire after seven days and do not establish full functionality, safety or physical phone support. Public source does not establish an open license. Creator-tagged open source still has unknown licensing until an explicit recognized license is recorded.

Storefront prominence does not grant compatibility or preservation. Required unsupported APIs, dynamic resource behavior, workers, server authentication and unsupported persistent stores remain refused/limited. Save support remains limited to the demonstrated managed localStorage and Save Bridge behavior. Original payloads and executable capsules remain separate, with exact hashes and the existing archive/restore rules.

The strict final product release gate remains open; a green workflow does not close physical acceptance.
