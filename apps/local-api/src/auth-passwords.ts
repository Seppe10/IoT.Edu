import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

export const PASSWORD_HASH = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const SESSION_LIMITS = {
  idleSeconds: 2 * 60 * 60,
  absoluteSeconds: 12 * 60 * 60,
  rememberIdleSeconds: 7 * 24 * 60 * 60,
  rememberAbsoluteSeconds: 14 * 24 * 60 * 60,
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "1234567890123",
  "123123123123",
  "000000000000",
  "111111111111",
  "1qaz2wsx3edc",
  "1q2w3e4r5t6y",
  "abcdefghijkl",
  "abcdefg12345",
  "access123456",
  "adminadmin12",
  "adminadminadmin",
  "andrew123456",
  "asdfghjkl123",
  "ashley123456",
  "baseball1234",
  "batman123456",
  "buster123456",
  "changeme1234",
  "computer1234",
  "correcthorsebatterystaple",
  "dragon123456",
  "football1234",
  "freedom12345",
  "george123456",
  "hockey123456",
  "hunter123456",
  "iloveyou1234",
  "iloveyou12345",
  "internet1234",
  "jessica12345",
  "jordan123456",
  "letmeinletmein",
  "letmeinplease",
  "master123456",
  "michael12345",
  "michelle1234",
  "p@ssw0rd1234",
  "pa$$w0rd1234",
  "passw0rd1234",
  "passw0rdpass",
  "password password",
  "password!234",
  "password1234",
  "password12345",
  "passwordpassword",
  "pepper123456",
  "princess1234",
  "qwerty123456",
  "qwertyqwerty",
  "qwertyuiop12",
  "qwertyuiopas",
  "ranger123456",
  "secret123456",
  "shadow123456",
  "soccer123456",
  "starwars1234",
  "summer123456",
  "sunshine1234",
  "superman1234",
  "thomas123456",
  "trustno1trust",
  "welcome12345",
  "whatever1234",
  "winter123456",
  "zxcvbnm12345",
]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailError(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "Enter your email address.";
  const email = value.trim();
  if (email.length > 254 || !EMAIL.test(email)) return "Enter a valid email address.";
  return null;
}

export function displayNameError(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return "Enter a display name.";
  if (value.trim().length > 80) return "Use a shorter display name.";
  return null;
}

export function passwordError(password: unknown, email = ""): string | null {
  if (typeof password !== "string" || password.length === 0) return "Enter your password.";
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  const folded = password.toLowerCase();
  if (COMMON_PASSWORDS.has(folded) || /^(.)\1+$/u.test(password)) {
    return "Choose a password that is not commonly used.";
  }
  const normalized = email.trim().toLowerCase();
  const local = normalized.split("@")[0] ?? "";
  if ((normalized.length > 0 && folded === normalized) || (local.length >= 12 && folded === local)) {
    return "Choose a password that does not match your email address.";
  }
  return null;
}

export function confirmationError(password: unknown, confirm: unknown): string | null {
  if (typeof confirm !== "string" || confirm.length === 0) return "Confirm your password.";
  if (confirm !== password) return "Passwords do not match.";
  return null;
}

export function loginInputError(email: unknown, password: unknown): string | null {
  const emailMessage = emailError(email);
  if (emailMessage) return emailMessage;
  if (typeof password !== "string" || password.length === 0) return "Enter your password.";
  if (password.length > 128) return "Invalid email or password.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_HASH);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSessionToken(token) };
}

let dummyHash: Promise<string> | null = null;

export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword("not-a-real-account-password");
  return dummyHash;
}
