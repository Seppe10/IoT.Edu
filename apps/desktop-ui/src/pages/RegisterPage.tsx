import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { registerFieldError } from "../auth-form";
import { SecretField } from "../components/SecretField";

function failure(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : "Unable to connect. Please try again.";
}

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    const message = registerFieldError({ displayName, email, password, confirmPassword });
    if (message) {
      setError(message);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const user = await auth.register({
        displayName: displayName.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      });
      navigate(user.role === "administrator" ? "/" : "/account", { replace: true });
    } catch (reason) {
      setError(failure(reason));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)} noValidate>
        <header>
          <h1>Create account</h1>
          <p>{auth.bootstrap ? "This first account is the administrator." : "Create an account to manage your IoT devices."}</p>
        </header>
        {auth.registrationOpen ? (
          <>
            {error && <p className="form-error" role="alert">{error}</p>}
            <label>
              Display name
              <input value={displayName} maxLength={80} autoComplete="name" disabled={pending} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              Email address
              <input type="email" value={email} maxLength={254} autoComplete="email" inputMode="email" spellCheck={false} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <SecretField label="Password" value={password} autoComplete="new-password" disabled={pending} onChange={setPassword} />
            <SecretField label="Confirm password" value={confirmPassword} autoComplete="new-password" disabled={pending} onChange={setConfirmPassword} />
            <button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Creating account…" : "Create account"}</button>
          </>
        ) : (
          <p className="form-error" role="alert">Account creation is closed. Ask an administrator for an account.</p>
        )}
        <p className="muted"><Link to="/login">Sign in</Link></p>
      </form>
    </main>
  );
}
