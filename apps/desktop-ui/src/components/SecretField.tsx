import { useState } from "react";

export function SecretField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <span className="secret-field">
        <input
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          spellCheck={false}
          maxLength={128}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="secondary" aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
