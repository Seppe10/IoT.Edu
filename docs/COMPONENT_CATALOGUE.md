# Component catalogue

Phase 1 stores the catalogue as read-only JSON under `catalog/manifests/`. `LocalCatalogRepository` validates each file with Zod. There is no PostgreSQL adapter and no GitHub client.

## Entries

| Id | Status | Selectable | Source |
|---|---|---|---|
| `iotedu-core` | experimental | yes (base firmware) | `firmware/components/iotedu_core` (`iotedu_core_prepare`) |
| `iotedu-dht11` | experimental | yes, mock packages only | `firmware/components/iotedu_dht11` (`iotedu_dht11_register`) |
| `iotedu-endpoint-templates` | template | no | none |
| `iotedu-ldr` | planned | no | none |
| `iotedu-pir` | planned | no | none |
| `iotedu-rgb` | planned | no | none |

DHT11 stays **experimental**. The driver is an ESP-IDF component and `registerFunction` is `iotedu_dht11_register`. The desktop can compile that package when the ESP-IDF v5.4.1 environment is configured. Compilation is not a hardware check, so the catalogue status is not verified. Simulated packages remain available and are not firmware images. LDR, PIR, and RGB have no drivers and cannot be selected. Docker builds are unavailable.

## Status vocabulary

| Status | Meaning |
|---|---|
| Verified | Implemented, built, and hardware-checked. None of the current entries qualify. A verified entry also needs a register function. |
| Experimental | Source exists and may be selected for a simulated package. Not hardware-verified. |
| Template | Structural notes only. Not selectable. |
| Planned | Not implemented. Not selectable. |

## Validation

- Manifest file names cannot contain `..`, `/`, or `\`.
- Component directories must be relative paths inside the repository. Absolute paths and `..` are errors.
- Duplicate ids are errors.
- Planned and template entries cannot set `selectableForBuild`.
- Search matches id, name, description, type, clusters, and endpoints, case-insensitively. Cluster names are catalogue metadata. The desktop UI does not subscribe to them or plot readings.
