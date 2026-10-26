import type { LibraryComponent } from "@iotedu/contracts";
import { filterFirmwareLibrary, type LibraryStatusFilter } from "../firmware-library-form";
import { useMemo, useState } from "react";

export interface PendingImport {
  id: string;
  name: string;
  description: string;
  type: "sensor" | "actuator";
  validationState: string;
  revision: number;
  gpio: { name: string; gpio: number | null; description: string }[];
  files: { path: string; bytes: number; role: string }[];
  summary: string;
}

export function FirmwareLibrarySection({
  components,
  pending = [],
  onEdit,
  onEditPending,
}: {
  components: LibraryComponent[];
  pending?: PendingImport[];
  onEdit: (component: LibraryComponent) => void;
  onEditPending?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visible = useMemo(() => filterFirmwareLibrary(components, query, status), [components, query, status]);

  return (
    <section className="stack" id="components">
      <header>
        <h2>Firmware Library</h2>
      </header>
      <div className="row">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as LibraryStatusFilter)}>
            <option value="all">All</option>
            <option value="custom">Custom Code</option>
            <option value="approved">Approved Code</option>
          </select>
        </label>
      </div>
      {components.length === 0 && <p>No validated firmware components are available yet.</p>}
      {pending.length > 0 && (
        <div className="stack">
          <h3>Pending imports</h3>
          <p>These records are in the catalogue for review. They are not build-ready and cannot be selected for installation.</p>
          {pending.map((item) => (
            <article className="panel stack" key={item.id}>
              <div className="row">
                <h3>{item.name}</h3>
                <span className="pill">Custom Code</span>
                <span className="pill">{item.type === "sensor" ? "Sensor" : "Actuator"}</span>
                <span className="pill">Not build-ready</span>
              </div>
              <p>{item.description}</p>
              <p>{item.summary}</p>
              <p>Revision {item.revision}. {item.files.map((file) => file.path).join(", ") || "No reusable source file."}</p>
              {item.gpio.length > 0 && <p>{item.gpio.map((pin) => `${pin.name}: GPIO ${pin.gpio ?? "unset"}`).join(". ")}.</p>}
              {onEditPending && (
                <button type="button" className="secondary" onClick={() => onEditPending(item.id)}>
                  Edit Firmware
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {components.length > 0 && visible.length === 0 && <p>No firmware components match this search.</p>}
      {visible.map((component) => {
        const open = expandedId === component.id;
        return (
          <article className="panel stack" key={component.id}>
            <div className="row">
              <h3>{component.name}</h3>
              <span className="pill">{component.provenance === "custom" ? "Custom Code" : "Approved Code"}</span>
              <span className="pill">{component.type === "sensor" ? "Sensor" : "Actuator"}</span>
            </div>
            <p>{component.description}</p>
            <div className="row">
              <button
                type="button"
                className="secondary"
                aria-expanded={open}
                aria-controls={`details-${component.id}`}
                onClick={() => setExpandedId(open ? null : component.id)}
              >
                Details
              </button>
              {component.provenance === "custom" && (
                <button type="button" className="secondary" onClick={() => onEdit(component)}>
                  Edit Firmware
                </button>
              )}
            </div>
            {open && (
              <div id={`details-${component.id}`} className="stack">
                <dl className="facts">
                  <div><dt>Firmware name</dt><dd>{component.name}</dd></div>
                  <div><dt>Description</dt><dd>{component.description}</dd></div>
                  <div><dt>Component type</dt><dd>{component.type === "sensor" ? "Sensor" : "Actuator"}</dd></div>
                  {component.provenance === "approved" && (
                    <>
                      <div><dt>Supported hardware</dt><dd>ESP32-H2</dd></div>
                      {component.compatibility && <div><dt>Compatibility</dt><dd>{component.compatibility}</dd></div>}
                    </>
                  )}
                </dl>
                {component.gpio.length === 0 ? (
                  <p>No GPIO pins are required.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Connection</th>
                        <th>GPIO</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {component.gpio.map((pin) => (
                        <tr key={`${pin.name}-${pin.gpio}`}>
                          <td>{pin.name}</td>
                          <td>{pin.gpio}</td>
                          <td>{pin.description || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
