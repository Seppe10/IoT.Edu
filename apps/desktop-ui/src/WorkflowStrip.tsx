import { Link } from "react-router-dom";
import { stateLabel, type SetupRecord } from "./setup";

const steps = [
  ["/setup", "Setup", "hardware"],
  ["/smart-home", "Smart Home Connection", "smartHome"],
  ["/pair", "Pair New Node", "management"],
] as const;

export function WorkflowStrip({ setup }: { setup: SetupRecord }) {
  return (
    <ol className="workflow" aria-label="Node setup">
      {steps.map(([to, label, key]) => (
        <li key={to}>
          <Link to={to}>{label}</Link>
          <span className={`pill ${setup[key]}`}>{stateLabel(setup[key])}</span>
        </li>
      ))}
    </ol>
  );
}
