# Architecture and trust boundaries

## Ownership

IndexedDB `sfhs-library-v1` contains application records and library settings. Each application has actual retained version bytes, a deterministic executable capsule, two SHA-256 hashes, source/license facts, a save snapshot, and an active-version identity. Library organization and save writes use transactions. A save message cannot choose an application identity; that identity is bound by the host launch closure.

Portable backups use ZIP with a versioned `manifest.json`. Each retained version has `original.bin` and `capsule.html` entries. On import all payload hashes and structural limits are checked before one database transaction merges the library. Existing identities are preserved as separate copies rather than overwritten. Restored optional capabilities and network access are disabled pending explicit user review.

Original export returns the acquired file bytes. An acquired GitHub package is a locally constructed ZIP containing raw static files fetched at one immutable commit; this is recorded as acquisition provenance, not a signed or canonical upstream release.

## Isolation

Guest applications run in `iframe sandbox="allow-scripts"` with no `allow-same-origin`. Optional pointer lock and downloads require explicit settings. Host fullscreen surrounds the runtime; guest fullscreen/gamepad permissions are separate. Camera, microphone, location, clipboard, and additional powerful permissions are restricted.

An injected runtime prelude establishes synchronous per-app localStorage and sessionStorage adapters before guest application scripts execute. A fresh 256-bit session token and source-checked bootstrap transfer a private MessagePort. Broker operations are limited to validated managed state; app and version identities are never read from the guest. Close waits for a snapshot and a completed host write. Failed flushes are surfaced.

Imported HTML is parsed with parse5, never inserted into the host DOM. The guest receives CSP before code. The parent limits frame navigation to data/blob contexts; guest CSP blocks nested frames, objects, forms, and workers. Network origins are explicit and default denied. CSP is a resource policy, not a universal network firewall; WebRTC and unvirtualized protocols are refused where detected. The browser sandbox, not source analysis, protects host-origin data.

Static analysis cannot guarantee arbitrary JavaScript behavior. Dependencies or API names computed at runtime can evade inspection and later fail. App errors and blocked requests surface in the runtime. No unsupported app is retried without isolation. User-imported packages are not declared trusted or safe merely because they passed static analysis.

## Package transformation

Original bytes remain untouched. Capsule analysis checks ZIP paths/expansion bounds, selects an entry document, resolves supported package resources to deterministic data URLs, rewrites static module graphs, and injects a local asset adapter. The executable is hashed independently. Changes to compatibility logic do not silently recompile installed capsules.

## SFHS Save Bridge

An application may register the optional bridge:

```js
await window.SFHSLibrary.registerSaveBridge({
  schema: 'my-application/v1',
  exportState: () => ({ score }),
  importState: state => { score = state.score; render(); },
  validate: state => Number.isFinite(state.score)
});
```

State must be JSON-serializable and fit the managed save bound. The runtime awaits import and validation before export. Apps should await registration before rendering state that depends on restore. Inspect the runtime implementation for the precise callback contract; a native declaration alone does not establish save-restore verification.

## Offline and discovery

The launcher service worker caches only its generated distribution shell and catalog. It does not host arbitrary app code under the launcher's origin. Installed payloads come from IndexedDB and guest data URLs. The standalone HTML bundles all launcher runtime dependencies and the last indexed itch catalog. An HTTPS visit must finish caching before offline reopening.

GitHub REST requests are direct, unauthenticated, and bounded. Rate-limit errors remain visible. Repository license detection is not dependency license proof. itch discovery is a public RSS-derived index with timestamps and creator links; it does not bypass downloads or represent the entire itch catalog as live search.

## Primary references

- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [itch.io public RSS feeds](https://itch.io/docs/api/overview)
