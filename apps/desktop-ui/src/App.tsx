import { NavLink, Route, Routes } from "react-router-dom";
import { AiPage } from "./pages/AiPage";
import { BuilderPage } from "./pages/BuilderPage";
import { CatalogPage } from "./pages/CatalogPage";
import { DeploymentPage } from "./pages/DeploymentPage";
import { HardwarePage } from "./pages/HardwarePage";
import { NodePage } from "./pages/NodePage";
import { OverviewPage } from "./pages/OverviewPage";
import { PairPage } from "./pages/PairPage";
import { PreflightPage } from "./pages/PreflightPage";
import { SettingsPage } from "./pages/SettingsPage";

const links = [
  ["/", "Overview"],
  ["/pair", "Pair New Node"],
  ["/library", "Component Library"],
  ["/builder", "Firmware Builder"],
  ["/ai", "AI-Assisted Development"],
  ["/ota", "OTA Preflight"],
  ["/verify", "Hardware verification"],
  ["/settings", "Settings"],
] as const;

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>IoT.Edu</strong>
          <span>Node management</span>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
            </NavLink>
          ))}
        </nav>
        <footer>Management fabric only. Sensor readings stay in the smart-home app.</footer>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/pair" element={<PairPage />} />
          <Route path="/nodes/:id" element={<NodePage />} />
          <Route path="/library" element={<CatalogPage />} />
          <Route path="/builder" element={<BuilderPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/ota" element={<PreflightPage />} />
          <Route path="/ota/jobs/:id" element={<DeploymentPage />} />
          <Route path="/verify" element={<HardwarePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
