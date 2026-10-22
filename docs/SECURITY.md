# Security

## Trust boundaries

- Local API binds to `127.0.0.1` only. Any other host is refused.
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

## Controller credentials

Live mode stores the Matter.js controller under `$DATA_DIR/matter-controller`. The directory is mode `0700` and the files inside are mode `0600`. That directory is gitignored because `data/` is gitignored. It holds the root key pair and the controller’s own commissioning passcode. Node JSON stores administrative attributes that the device returned, not the passcode.

Backup is a copy of that directory taken while IoT.Edu is stopped, kept outside the repository. Restore it to the same path while the application is stopped. A missing or unreadable store is not replaced automatically.

Pairing codes are removed from API error text and from Matter.js log lines. A commissioning code returned for a local sharing window is shown in that response and redacted everywhere else.

## Later requirements (not done)

Encrypted fabric backup, single-target OTA locking, and AI key storage on the server side. The local API already refuses hosts other than `127.0.0.1`.
