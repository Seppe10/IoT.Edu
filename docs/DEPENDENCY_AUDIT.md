# Dependency audit

Recorded 2026-10-21 with `npm audit` (npm registry advisory endpoint) after `npm install`.

Classification uses the workspace `package.json` that declares the package. Transitive packages inherit that classification.

## Before the non-breaking upgrade

8 advisories: 1 moderate, 5 high, 2 critical.

| Package | Severity | Class | Installed before | Advisory (summary) | Fix applied |
|---|---|---|---|---|---|
| `fastify` | high | production (`@iotedu/local-api`) | 5.3.2 | DoS via `sendWebStream`; Content-Type tab and leading-space validation bypass; `X-Forwarded-*` host/protocol spoofing; primitive coercion mismatch; HTTP/2 trailer exception; async validation collision; malformed-URL auth bypass; skipped `false` schemas; header case normalization | 5.12.7 |
| `react-router-dom` | high | production (`@iotedu/desktop-ui`) | 7.5.0 | Inherits `react-router` | 7.18.4 |
| `react-router` | high | production, transitive of `react-router-dom` | pulled by 7.5.0 | SPA cache-poisoning DoS; XSS via open redirect; untrusted external redirect; pre-render data spoofing; turbo-stream constructor injection; `__manifest` path expansion; single-fetch DoS; CSRF on actions; backslash open redirect; `deserializeErrors` constructor injection; route-matching DoS; `//` open redirect; `ScrollRestoration` XSS | 7.18.4 via `react-router-dom` |
| `turbo-stream` | high | production, transitive of `react-router` | pulled by 7.5.0 | Single-fetch reflected-input DoS | cleared by `react-router-dom` 7.18.4 |
| `vite` | high | development (`@iotedu/desktop-ui`, and Vitest) | 6.2.5 | `server.fs.deny` bypasses; public-dir name prefix; HTML `server.fs` skip; Windows path and `launch-editor` command issues; dev-server websocket file read | 6.4.5 |
| `vitest` | critical | development (every workspace) | 3.0.9 | Vitest UI arbitrary file read/execute; path traversal via `@vitest/mocker`; `tinypool` prototype-pollution gadgets | 3.2.7, still inside the vulnerable range |
| `@vitest/mocker` | moderate | development, transitive of `vitest` | pulled by 3.0.9 | Path traversal / arbitrary file read via redirect mock | still present at 3.2.7 |
| `tinypool` | critical | development, transitive of `vitest` | pulled by 3.0.9 | Prototype-pollution gadgets in worker options leading to code execution | still present at 1.1.1 |

`npm audit fix --force` was not used. Every applied upgrade stays on the same major version.

## After the upgrade

`npm audit` reports 3 remaining advisories: 1 moderate, 2 critical. All three are development dependencies. Production `fastify` 5.12.7, production `react-router-dom` 7.18.4, and development `vite` 6.4.5 are clear.

| Package | Severity | Class | Installed | Why it remains |
|---|---|---|---|---|
| `vitest` | critical | development | 3.2.7 | Advisory range is `0.0.95 - 4.1.10`. The registry’s non-major suggestion during the first audit was 3.2.7; after installing it, the only published fix is `vitest@5.0.5`, a major upgrade. |
| `@vitest/mocker` | moderate | development, transitive | 3.2.7 | Same Vitest 5 upgrade. |
| `tinypool` | critical | development, transitive | 1.1.1 | Range `<=2.1.1`. Vitest 3.2.7 still depends on this release. |

These Vitest issues affect the test runner, not the Fastify server or the production UI bundle. Vitest 5 was left unapplied because it is a breaking upgrade.

## Runtime exposure

The desktop dev server and the API do not import Vitest. Vite’s dev-server file-read issues apply only while `npm run dev` is bound to `127.0.0.1`. The production UI build does not run the Vite dev server.
