# Component catalogue

Phase 1 stores the catalogue as read-only JSON under `catalog/manifests/`. `LocalCatalogRepository` validates each file with Zod. There is no PostgreSQL adapter and no GitHub client.

## Entries

| Id | Status | Selectable | Source |
|---|---|---|---|
| `iotedu-core` | experimental | yes (base firmware) | `reference/matter-dht11` |
| `iotedu-dht11` | experimental | yes, mock packages only | `reference/matter-dht11/main/drivers` |
| `iotedu-endpoint-templates` | template | no | none |
| `iotedu-ldr` | planned | no | none |
| `iotedu-pir` | planned | no | none |
| `iotedu-rgb` | planned | no | none |

DHT11 stays **experimental**. The driver exists in the audited sources and the Phase 0 baseline compiled the original project, but `registerFunction` is null, so a native modular build is rejected. LDR, PIR, and RGB have no drivers and cannot be selected.

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
