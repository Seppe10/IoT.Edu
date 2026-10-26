-- Additive development-catalogue table. Binaries stay in application artifact storage.
CREATE TABLE IF NOT EXISTS firmware_releases (
  release_id text PRIMARY KEY,
  build_id text NOT NULL,
  recipe_id text,
  recipe_fingerprint char(64) NOT NULL,
  state text NOT NULL,
  software_version integer NOT NULL,
  software_version_string text NOT NULL,
  vendor_id integer NOT NULL,
  product_id integer NOT NULL,
  hardware_target text NOT NULL DEFAULT 'esp32h2',
  partition_layout_id text,
  application_sha256 char(64),
  ota_sha256 char(64),
  component_revisions jsonb NOT NULL DEFAULT '[]',
  validation jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CONSTRAINT firmware_releases_state CHECK (
    state IN ('draft','build_failed','build_successful','release_candidate','published','superseded')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS firmware_release_version_uidx
  ON firmware_releases (vendor_id, product_id, software_version)
  WHERE state <> 'build_failed';
