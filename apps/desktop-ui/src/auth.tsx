import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "./api";
import { nextPathAfterLogin, type PublicUser } from "./auth-form";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";

export interface AuthState {
  status: "loading" | "offline" | "anonymous" | "ready";
  user: PublicUser | null;
  notice: string | null;
  registrationOpen: boolean;
  bootstrap: boolean;
}

interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface AuthContextValue extends AuthState {
  login: (input: { email: string; password: string; remember: boolean }) => Promise<PublicUser>;
  register: (input: RegisterInput) => Promise<PublicUser>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string) => Promise<PublicUser>;
  refresh: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY: AuthState = {
  status: "loading",
  user: null,
  notice: null,
  registrationOpen: false,
  bootstrap: false,
};

async function registrationState(): Promise<Pick<AuthState, "registrationOpen" | "bootstrap">> {
  try {
    const body = await api<{ open: boolean; bootstrap: boolean }>("/api/auth/registration");
    return { registrationOpen: body.open, bootstrap: body.bootstrap };
  } catch {
    return { registrationOpen: false, bootstrap: false };
  }
}

export function AuthProvider({ children, initial }: { children: ReactNode; initial?: AuthState }) {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthState>(initial ?? EMPTY);

  async function load(notice = state.notice) {
    try {
      const body = await api<{ user: PublicUser }>("/api/auth/me");
      setState({ status: "ready", user: body.user, notice: null, registrationOpen: false, bootstrap: false });
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        const registration = await registrationState();
        setState({ status: "anonymous", user: null, notice, ...registration });
        return;
      }
      setState({ status: "offline", user: null, notice: null, registrationOpen: false, bootstrap: false });
    }
  }

  useEffect(() => {
    if (initial) return;
    let live = true;
    void (async () => {
      try {
        const body = await api<{ user: PublicUser }>("/api/auth/me");
        if (live) setState({ status: "ready", user: body.user, notice: null, registrationOpen: false, bootstrap: false });
      } catch (reason) {
        if (!live) return;
        if (reason instanceof ApiError && reason.status === 401) {
          const registration = await registrationState();
          setState({ status: "anonymous", user: null, notice: null, ...registration });
          return;
        }
        setState({ status: "offline", user: null, notice: null, registrationOpen: false, bootstrap: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [initial]);

  useEffect(() => {
    if (initial) return;
    const onEnded = () => {
      setState((current) => ({
        ...current,
        status: "anonymous",
        user: null,
        notice: "Your session has ended. Sign in again.",
      }));
      navigate("/login", { replace: true });
    };
    window.addEventListener("iotedu-session-ended", onEnded);
    return () => window.removeEventListener("iotedu-session-ended", onEnded);
  }, [initial, navigate]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    async login(input) {
      const body = await api<{ user: PublicUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setState({ status: "ready", user: body.user, notice: null, registrationOpen: false, bootstrap: false });
      return body.user;
    },
    async register(input) {
      const body = await api<{ user: PublicUser }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setState({ status: "ready", user: body.user, notice: null, registrationOpen: false, bootstrap: false });
      return body.user;
    },
    async logout() {
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 401) throw reason;
      }
      const registration = await registrationState();
      setState({ status: "anonymous", user: null, notice: null, ...registration });
      navigate("/login", { replace: true });
    },
    async updateProfile(displayName) {
      const body = await api<{ user: PublicUser }>("/api/account", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      setState((current) => ({ ...current, user: body.user }));
      return body.user;
    },
    async refresh() {
      setState((current) => ({ ...current, status: "loading" }));
      await load(null);
    },
    clearNotice() {
      setState((current) => ({ ...current, notice: null }));
    },
  }), [navigate, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Authentication is unavailable.");
  return value;
}

function StatusCard({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>{title}</h1>
        <p>{body}</p>
        {action ? <button type="button" onClick={action.onClick}>{action.label}</button> : null}
      </section>
    </main>
  );
}

function ReturnHome() {
  const auth = useAuth();
  const location = useLocation();
  const from = nextPathAfterLogin((location.state as { from?: unknown } | null)?.from);
  return <Navigate to={auth.user?.role === "administrator" ? from : "/account"} replace />;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <StatusCard title="IoT.Edu" body="Checking session…" />;
  if (auth.status === "offline") {
    return <StatusCard title="IoT.Edu" body="Unable to connect. Please try again." action={{ label: "Try again", onClick: () => void auth.refresh() }} />;
  }
  if (!auth.user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />} />
      </Routes>
    );
  }
  return children;
}

export function HomeRedirect() {
  return <ReturnHome />;
}
