export type AccountRole = "administrator" | "user";
export type AccountStatus = "active" | "disabled";

export interface PublicAccount {
  displayName: string;
  email: string;
  role: AccountRole;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ListedAccount extends PublicAccount {
  status: AccountStatus;
}

export interface SessionAccount extends PublicAccount {
  id: string;
}

export interface NewAccount {
  displayName: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
}

export interface LoginRecord {
  id: string;
  passwordHash: string;
  status: AccountStatus;
  account: PublicAccount;
}

export interface RegistrationPolicy {
  open: boolean;
  bootstrap: boolean;
  selfRegistration: boolean;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export function publicAccount(account: PublicAccount): PublicAccount {
  return {
    displayName: account.displayName,
    email: account.email,
    role: account.role,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  };
}
