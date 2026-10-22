const SECRET_PATTERNS = [
  /MT:[A-Z0-9.-]+/gi,
  /\b\d{4}-\d{3}-\d{4}\b/g,
  /\b\d{21}\b/g,
  /\b\d{11}\b/g,
  /(passcode|pincode|pin code|discriminator|setup pin|spake2p|salt|verifier|private key)\s*[:=]\s*\S+/gi,
];

/** Remove commissioning secrets from a log or error string. */
export function redactSecrets(text: string): string {
  let output = text;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, "[redacted]");
  return output;
}
