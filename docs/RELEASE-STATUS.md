# Release status — October 3, 2026

**PASS: engineering candidate. Final product acceptance remains pending.**

The launcher is implemented as a reproducible standalone HTML with optional GitHub Pages offline infrastructure. The authoritative local artifact fingerprint is `build-info.json`; deployment adds `release.json` with the actual checked-out Git commit. The runtime only attributes that commit to its loaded build when the source-derived build identity matches.

## Verified

- Build parity from canonical source.
- 25 focused automated tests, including archive integrity and hostile runtime behavior.
- 18 complete Chromium UI checks: HTML installation, explicit network permissions, exit/relaunch saves, organization, update and rollback, isolation, refusal, destructive full recovery, corruption rejection, offline operation, phone-width layout, indexed itch discovery, and standalone `file://` use.
- Opaque sandbox isolation, source-bound MessagePort broker, cross-app save protection, blocked parent storage/DOM access, and blocked unauthenticated messages.
- Actual application-level recovery from a portable ZIP after the browser library was removed, not just storage key detection.
- Six genuinely acquired apps installed and exercised in the real corpus, including an itch.io free demo downloaded using its normal visible Download link. One incompatible real WASM/module application is refused. See [the corpus evidence](COMPATIBILITY-CORPUS.md) for exact coverage and hashes.
- Separate supplemental runtime proofs cover static ES modules, local JSON, WASM, SVG images, WAV audio, and the formal native save bridge.
- Responsive visual inspection at 320, 390, 768, and 1440 pixels. Emulation does not count as physical phone acceptance.

## Limits and unclosed gates

- Physical Android Chrome acceptance has not occurred. Follow [the phone protocol](PHONE-ACCEPTANCE.md) using the final deployed build.
- The real WASM/module project in the corpus is correctly refused; successful WASM/module and native Save Bridge proofs currently use controlled fixtures. These are not represented as successful compatibility with every real WASM framework.
- Save protection is limited to the demonstrated managed localStorage and Save Bridge behavior. IndexedDB/OPFS-heavy, worker/service-worker, server-authentication, and unsupported dynamic resource apps remain refused or unsupported.
- Per-app UI stays at **Offline candidate** and **Supported/Unknown** unless there is per-app proof. No batch classification silently promotes installed apps to verified.
- Restored archives reset network and optional capability permissions for review. Remote saves are not present in the backup merely because the software is.
- Large imports/backups are bounded and processed in memory. Physical phone responsiveness near the documented size limits is not accepted.
- The first Pages deployment and immutable live-byte check must complete before giving the production URL to the user as deployed.

The product constraints' strict final-release gate remains open until these relevant coverage and physical phone checks are satisfied. A green GitHub Actions run alone will not change that status.
