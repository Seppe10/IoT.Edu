const SOURCE_EXTENSIONS = new Set([".c", ".h", ".cpp", ".hpp"]);
const SOURCE_BASENAMES = new Set(["CMakeLists.txt", "Kconfig", "Kconfig.projbuild"]);

export function safeRelativePath(name: string): string | null {
  if (!name || name.length > 240 || name.includes("\0") || name.includes("\\")) return null;
  if (name.startsWith("/") || name.includes("..")) return null;
  const parts = name.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.length > 8) return null;
  if (parts.some((part) => part === "." || part === ".." || part.startsWith(".") || !/^[A-Za-z0-9._-]+$/.test(part))) return null;
  const base = parts[parts.length - 1] ?? "";
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (!SOURCE_BASENAMES.has(base) && !SOURCE_EXTENSIONS.has(extension)) return null;
  return parts.join("/");
}

export function safeUploadName(name: string): string | null {
  if (!name || name.includes("\\") || name.includes("..") || name.includes("\0")) return null;
  const base = name.split("/").filter((part) => part.length > 0).pop() ?? "";
  if (base.toLowerCase().endsWith(".zip")) {
    if (name.includes("/") || !/^[A-Za-z0-9._-]{1,80}$/.test(base) || base.startsWith(".")) return null;
    return base;
  }
  return safeRelativePath(name);
}
