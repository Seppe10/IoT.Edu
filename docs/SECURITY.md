# Security

## Trust boundaries

- Local API binds to `127.0.0.1` only (not implemented yet).
- Browser components must not spawn OS commands.
- Custom/AI firmware is untrusted until explicit user acceptance.
- Matter keys, Thread datasets, and API tokens never go in ordinary JSON records, logs, or git.

## Phase 0 observations

Imported allowlisted sources have no credentials or absolute home paths.

The original zip’s generated `sdkconfig` (not imported) contains:

- Matter test VID/PID (`0xFFF1` / `0x8000`)
- `CONFIG_ENABLE_TEST_SETUP_PARAMS`
- Default OpenThread test network parameters (name, PAN ID, master key, PSKc)

Treat those as prototype-only. They are not a production provisioning story.

`docs/source-import-report.json` stores archive **filename** and relative destinations, not a developer home path.

Build logs may contain absolute toolchain paths from the host. `docs/baseline-build.log` is gitignored.

## Later requirements (not done)

Protected controller storage, encrypted fabric backup, log redaction, subprocess argument arrays, single-target OTA locking, AI key storage on the server side.
