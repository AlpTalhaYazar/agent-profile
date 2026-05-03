import { createHash, randomBytes } from "node:crypto";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateCodeVerifier(length = 43): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    const char = CHARSET[byte % CHARSET.length];
    if (char === undefined) throw new Error("PKCE charset lookup failed");
    result += char;
  }
  return result;
}

export function computeCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  if (!CHARSET[0]) throw new Error("PKCE charset is empty");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}
