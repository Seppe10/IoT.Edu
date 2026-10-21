# Component catalogue

**Not implemented in Phase 0.** Local JSON manifests will be added in Phase 1. PostgreSQL and GitHub sync are out of scope.

## Intended schema

See the specification example for `iotedu-dht11`. Validate with Zod. Reject path traversal and paths outside `firmware/`.

## Status vocabulary

| Status | Meaning |
|---|---|
| Verified | Implemented and successfully built |
| Experimental | Implemented, not hardware-verified |
| Template | Structural example, not deployable |
| Planned | Not implemented |

DHT11 is the first verification candidate. After Phase 0 it remains **experimental at most** — the original driver exists and hashes are recorded, but this repo has not yet proven a local native build or hardware read.

Do not invent working LDR, PIR, or RGB drivers to fill the UI. Those entries may exist as Planned/Template only.

## Pins

GPIO conflict detection (DHT11 GPIO4 vs another driver on GPIO4) belongs in the firmware builder, not the catalogue UI.
