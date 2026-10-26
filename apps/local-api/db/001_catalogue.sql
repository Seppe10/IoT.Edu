CREATE TABLE components (
  component_id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  component_type text NOT NULL CHECK (component_type IN ('matter_core', 'sensor', 'actuator', 'shared_library')),
  provenance text NOT NULL CHECK (provenance IN ('custom_code', 'approved_code')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE component_versions (
  component_version_id text PRIMARY KEY,
  component_id text NOT NULL REFERENCES components (component_id),
  revision integer NOT NULL CHECK (revision > 0),
  content_fingerprint char(64) NOT NULL,
  esp_idf_target text NOT NULL DEFAULT 'esp32h2',
  integration jsonb,
  validation_state text NOT NULL CHECK (validation_state IN ('draft', 'validation_required', 'validated', 'incompatible')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (component_id, revision)
);

CREATE TABLE source_blobs (
  sha256_hash char(64) PRIMARY KEY,
  content text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0 AND byte_size <= 200000),
  encoding text NOT NULL DEFAULT 'utf8',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE component_files (
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  relative_path text NOT NULL,
  source_hash char(64) NOT NULL REFERENCES source_blobs (sha256_hash),
  file_role text NOT NULL CHECK (file_role IN ('source', 'header', 'build', 'config', 'host_snapshot')),
  PRIMARY KEY (component_version_id, relative_path)
);

CREATE TABLE component_dependencies (
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  dependency_component_id text NOT NULL REFERENCES components (component_id),
  dependency_version_constraint text NOT NULL,
  dependency_type text NOT NULL CHECK (dependency_type IN ('matter_core', 'shared_library', 'idf_component')),
  PRIMARY KEY (component_version_id, dependency_component_id, dependency_type)
);

CREATE TABLE gpio_requirements (
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  connection_name text NOT NULL,
  peripheral_function text NOT NULL,
  default_gpio integer,
  allowed_gpio_constraints text NOT NULL,
  optional boolean NOT NULL DEFAULT false,
  description text NOT NULL,
  PRIMARY KEY (component_version_id, connection_name)
);

CREATE TABLE matter_requirements (
  component_version_id text PRIMARY KEY REFERENCES component_versions (component_version_id),
  endpoint_types text[] NOT NULL,
  clusters text[] NOT NULL,
  attributes text[] NOT NULL,
  endpoint_owned_by text NOT NULL CHECK (endpoint_owned_by IN ('host', 'component', 'none')),
  initialisation_interface text,
  notes text NOT NULL
);

CREATE TABLE validation_runs (
  validation_run_id text PRIMARY KEY,
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  content_fingerprint char(64) NOT NULL,
  error_count integer NOT NULL,
  warning_count integer NOT NULL,
  issues jsonb NOT NULL,
  native_compile text NOT NULL,
  integration_compile text NOT NULL,
  toolchain text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE firmware_recipes (
  recipe_id text PRIMARY KEY,
  name text NOT NULL,
  target text NOT NULL DEFAULT 'esp32h2',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recipe_components (
  recipe_id text NOT NULL REFERENCES firmware_recipes (recipe_id),
  component_version_id text NOT NULL REFERENCES component_versions (component_version_id),
  gpio_assignments jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (recipe_id, component_version_id)
);

CREATE TABLE build_artifacts (
  build_id text PRIMARY KEY,
  recipe_id text REFERENCES firmware_recipes (recipe_id),
  target text NOT NULL,
  software_version integer,
  software_version_string text,
  esp_idf_version text,
  input_fingerprint char(64),
  image_sha256 char(64),
  artifact_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE import_audits (
  import_id text PRIMARY KEY,
  archive_name text NOT NULL,
  archive_sha256 char(64),
  component_version_id text REFERENCES component_versions (component_version_id),
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX component_files_hash_idx ON component_files (source_hash);
CREATE INDEX component_versions_component_idx ON component_versions (component_id);
CREATE INDEX validation_runs_version_idx ON validation_runs (component_version_id);
