import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { loginFieldError, nextPathAfterLogin } from "../auth-form";
import { SecretField } from "../components/SecretField";

function failure(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : "Unable to connect. Please try again.";
}

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pendingRef.current) return;
    const message = loginFieldError(email, password);
    if (message) {
      setError(message);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError(null);
    auth.clearNotice();
    try {
      const user = await auth.login({ email: email.trim(), password, remember });
      const from = nextPathAfterLogin((location.state as { from?: unknown } | null)?.from);
      navigate(user.role === "user" ? "/account" : from, { replace: true });
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
          <h1>IoT.Edu</h1>
          <p>Sign in to manage your IoT devices.</p>
        </header>
        {(auth.notice || error) && <p className="form-error" role="alert">{error ?? auth.notice}</p>}
        <label>
          Email address
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
            maxLength={254}
            value={email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <SecretField label="Password" value={password} autoComplete="current-password" disabled={pending} onChange={setPassword} />
        <label className="check-row">
          <input type="checkbox" checked={remember} disabled={pending} onChange={(event) => setRemember(event.target.checked)} />
          Remember this session
        </label>
        <button type="submit" disabled={pending} aria-busy={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        {auth.registrationOpen ? <p className="muted"><Link to="/register">Create account</Link></p> : null}
      </form>
    </main>
  );
}
