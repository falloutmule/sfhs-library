# Physical Android acceptance — pending

Desktop Chromium and emulated phone viewports are engineering evidence. They do not establish physical Samsung acceptance.

Use the deployed HTTPS Pages build. Record the build ID and commit displayed in Settings, Android/Chrome version, and phone model. Use a normal browser profile, not incognito. Export any existing library before destructive operations.

1. Discover `gabrielecirulli/2048`, inspect its license/source and static root entry, download/analyze, then install.
2. Launch, make recognizable moves, exit, relaunch, and confirm the board/state remains.
3. Favorite the app and add it to a collection. Check search, collection selection, sorting, and app details.
4. Download a full library backup and locate the ZIP in phone storage.
5. Remove the app through its explicit Remove action.
6. Restore the ZIP from phone storage. Launch 2048 and confirm the saved board and organization are restored.
7. Import a downloaded single HTML utility and a legitimate itch HTML/ZIP through normal creator distribution. Record compatibility and failures accurately.
8. Verify an app requiring unsupported own-origin IndexedDB or a server is refused rather than falsely installed.
9. Install an update, test it before activating, then preview and activate the retained previous version. Check each version's save snapshot.
10. After the launcher finishes its first cache, disable networking. Reopen the launcher and check local search, collections, supported app launch, backup export, and backup restore.
11. Try fullscreen, back/close controls, portrait scrolling, file pickers, and downloads. Confirm no clipped buttons or inaccessible controls.

Report PASS/FAIL for each step and the exact failing action. Network-dependent apps are not expected to work offline. Save support is limited to managed localStorage and the documented bridge; remote/unsupported state is not backed up.

Final release remains blocked until this physical cycle and all required real-corpus categories have evidence. This document is a protocol, not a recorded pass.
