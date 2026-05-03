import { execFile } from "node:child_process";
import { platform } from "node:os";
import * as os from "node:os";
import { promisify } from "node:util";
import type { DetectedCredentials } from "./types.js";

const execFileAsync = promisify(execFile);

const CLAUDE_CODE_SERVICE = "Claude Code-credentials";

interface ClaudeCodeOAuthPayload {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
  };
}

async function readKeychainPassword(service: string, account: string): Promise<string | null> {
  if (platform() !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account,
      "-w",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function detectClaudeCodeCredentials(): Promise<DetectedCredentials> {
  try {
    const username = os.userInfo().username;
    const raw = await readKeychainPassword(CLAUDE_CODE_SERVICE, username);
    if (!raw) return { detected: false };

    const data: ClaudeCodeOAuthPayload = JSON.parse(raw);
    const oauth = data.claudeAiOauth;
    if (!oauth?.accessToken) return { detected: false };

    const accessTokenExpiresAt = oauth.expiresAt
      ? new Date(oauth.expiresAt).toISOString()
      : undefined;

    const result: DetectedCredentials = { detected: true, accessToken: oauth.accessToken };
    if (oauth.refreshToken) result.refreshToken = oauth.refreshToken;
    if (accessTokenExpiresAt) result.accessTokenExpiresAt = accessTokenExpiresAt;
    if (oauth.subscriptionType) result.planType = oauth.subscriptionType;
    return result;
  } catch {
    return { detected: false };
  }
}
