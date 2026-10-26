/**
 * @vitest-environment happy-dom
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { App } from "./App";
import type { AuthState } from "./auth";
import { loginFieldError, nextPathAfterLogin, registerFieldError } from "./auth-form";

const src = path.dirname(fileURLToPath(import.meta.url));
const admin = {
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  role: "administrator" as const,
  createdAt: "2026-10-25T00:00:00.000Z",
  lastLoginAt: "2026-10-25T01:00:00.000Z",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function render(pathName: string, props: { initial?: AuthState } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[pathName]}>
        <App {...props} />
      </MemoryRouter>,
    );
  });
  return { host, root };
}

describe("authentication interface", () => {
  const roots: Root[] = [];

  afterEach(() => {
    while (roots.length > 0) roots.pop()?.unmount();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("checks the session before showing the application", async () => {
    let releaseSession: (response: Response) => void = () => {};
    const session = new Promise<Response>((resolve) => {
      releaseSession = resolve;
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/me") return session;
      return Promise.resolve(json(404, { error: { message: "Missing" } }));
    }));
    const loading = document.createElement("div");
    document.body.append(loading);
    const root = createRoot(loading);
    roots.push(root);
    await act(async () => {
      root.render(<MemoryRouter><App /></MemoryRouter>);
    });
    expect(document.body.textContent).toContain("Checking session…");
    expect(document.body.textContent).not.toContain("Management fabric only");
    await act(async () => {
      releaseSession(json(200, { user: admin }));
      await session;
    });
    expect(document.body.textContent).toContain("Overview");
    expect(document.body.textContent).toContain("Ada Lovelace");
    const footer = document.querySelector("footer");
    expect(footer?.textContent).toBe("Management fabric only. Sensor readings stay in the smart-home app.");
    expect(footer?.previousElementSibling?.getAttribute("aria-label")).toBe("Account");
    expect(footer?.parentElement?.className).toBe("sidebar-end");
  });

  it("shows login and registration, and keeps protected pages hidden", async () => {
    const anonymous = { status: "anonymous" as const, user: null, notice: "Your session has ended. Sign in again.", registrationOpen: true, bootstrap: true };
    const login = await render("/login", { initial: anonymous });
    roots.push(login.root);
    expect(document.body.textContent).toContain("IoT.Edu");
    expect(document.body.textContent).toContain("Sign in to manage your IoT devices.");
    expect(document.body.textContent).toContain("Create account");
    expect(document.body.textContent).toContain("Your session has ended. Sign in again.");
    expect(document.body.textContent).not.toContain("Forgot");
    expect(document.body.textContent).not.toContain("OTA Updating");
    login.root.unmount();

    const register = await render("/register", { initial: anonymous });
    roots.push(register.root);
    expect(document.body.textContent).toContain("This first account is the administrator.");
    expect(document.body.textContent).toContain("Confirm password");
    register.root.unmount();

    const closed = await render("/register", { initial: { ...anonymous, registrationOpen: false, bootstrap: false, notice: null } });
    roots.push(closed.root);
    expect(document.body.textContent).toContain("Account creation is closed. Ask an administrator for an account.");
    expect(document.body.textContent).not.toContain("Confirm password");
    closed.root.unmount();

    const blocked = await render("/settings", { initial: { ...anonymous, notice: null } });
    roots.push(blocked.root);
    expect(document.body.textContent).not.toContain("OTA Updating");
    expect(document.body.textContent).not.toContain("Management fabric only");
  });

  it("places Account above the management-fabric footer and logs out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/users") return json(200, { users: [{ ...admin, status: "active" }] });
      if (url === "/api/auth/policy") return json(200, { selfRegistration: false });
      if (url === "/api/auth/logout" && init?.method === "POST") return json(200, { ok: true });
      if (url === "/api/auth/registration") return json(200, { open: false, bootstrap: false });
      return json(404, { error: { message: "Missing" } });
    }));
    const view = await render("/account", {
      initial: { status: "ready", user: admin, notice: null, registrationOpen: false, bootstrap: false },
    });
    roots.push(view.root);
    expect(document.body.textContent).toContain("Change password");
    expect(document.body.textContent).toContain("Log out");
    expect(document.body.textContent).toContain("Email address changes are not available.");
    expect(document.body.textContent).not.toContain("password_hash");
    const footer = document.querySelector("footer");
    expect(footer?.previousElementSibling?.textContent).toContain("Account");
    expect(footer?.textContent).toContain("Management fabric only. Sensor readings stay in the smart-home app.");
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "Log out");
    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Sign in to manage your IoT devices.");
    view.root.unmount();

    const userView = await render("/", {
      initial: {
        status: "ready",
        user: { ...admin, role: "user", displayName: "Grace Hopper" },
        notice: null,
        registrationOpen: false,
        bootstrap: false,
      },
    });
    roots.push(userView.root);
    expect(document.body.textContent).not.toContain("OTA Updating");
    expect(document.body.textContent).toContain("Account");
    expect(document.querySelector("footer")?.textContent).toContain("Management fabric only");
  });

  it("keeps the navigation labels and validates return paths", async () => {
    const app = await readFile(path.join(src, "App.tsx"), "utf8");
    const css = await readFile(path.join(src, "styles.css"), "utf8");
    const api = await readFile(path.join(src, "api.ts"), "utf8");
    expect(app).not.toContain("<svg");
    expect(app.indexOf("Account")).toBeLessThan(app.indexOf("Management fabric only. Sensor readings stay in the smart-home app."));
    expect(css).toContain(".sidebar-end");
    expect(css).toContain(".account-grid");
    expect(api).toContain('credentials: "include"');
    expect(api).not.toContain("localStorage");
    expect(nextPathAfterLogin("/settings")).toBe("/settings");
    expect(nextPathAfterLogin("//evil.example")).toBe("/");
    expect(nextPathAfterLogin("/login")).toBe("/");
    expect(loginFieldError("", "secret")).toBe("Enter your email address.");
    expect(loginFieldError("ada@example.com", "")).toBe("Enter your password.");
    expect(registerFieldError({ displayName: "Ada", email: "ada@example.com", password: "short", confirmPassword: "short" })).toBe("Use at least 12 characters.");
    expect(registerFieldError({ displayName: "Ada", email: "ada@example.com", password: "horse battery staple", confirmPassword: "horse battery staple " })).toBe("Passwords do not match.");
  });
});
