# Future PostgreSQL / GitHub integration

**Design only. Do not implement in the initial release.**

```text
Public GitHub repository
          |
          v
GitHub API / snapshot importer
          |
          v
Reviewed component source files
          |
          v
Catalogue validation and indexing
          |
          v
PostgreSQL component catalogue
          |
          v
Local application API
          |
          v
Firmware Builder
```

The importer must not have permission to modify the protected main branch. Integration is read-only, with reviewed source versions and explicit provenance.

The migration boundary is `CatalogRepository`. Phase 1 uses local files. Do not add a hidden PostgreSQL client, unused migration framework, or GitHub catalogue calls now.
