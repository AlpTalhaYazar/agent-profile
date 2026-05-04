/**
 * @module sessions/handoff
 *
 * Local-only handoff summary generator for recorded Agent Profile sessions.
 *
 * The service is deliberately read-only: it reads the session registry,
 * optionally computes drift from the recorded launch hash, and returns a
 * copyable markdown packet plus structured fields. It never resolves secrets.
 */
import type { SessionRuntimePaths } from "@agent-profile/session-artifacts";
import { type GetEffectiveFn, driftService } from "./drift.js";
import { type SessionRecord, type SessionStatus, readSessionRecord } from "./registry.js";

const NOT_RECORDED = "not recorded";
const RECORDED = "recorded";
const REDACTED = "<redacted>";

export type HandoffVerificationStatus = "passed" | "failed" | "not-recorded";
export type HandoffOutcomeStatus =
  | "completed"
  | "blocked"
  | "discarded"
  | "needs-relaunch"
  | "not-recorded";
export type HandoffDriftStatus = "in sync" | "drifted" | "not recorded";
export type HandoffRecordedStatus = "recorded" | "not recorded";

export interface SessionsHandoffInput {
  sessionsRoot: string;
  sessionId: string;
  home: string;
  verificationStatus?: HandoffVerificationStatus;
  verificationCommand?: string;
  outcome?: HandoffOutcomeStatus;
  getEffective?: GetEffectiveFn;
}

export interface HandoffRuntimeArtifacts {
  sessionDir: string;
  claudeConfigDir: string;
  mcpConfig: string;
  settings: string;
  claudeMd: string;
  apiKeyHelper: string;
  headersHelper: string;
}

export interface HandoffSummary {
  sessionId: string;
  cwd: string;
  role: string;
  authProfileId: string;
  sessionStatus: SessionStatus;
  outcome: string;
  cleaned: "yes" | "no";
  verification: {
    drift: HandoffDriftStatus;
    verificationStatus: string;
    verificationCommand: string;
    launchHashBaseline: HandoffRecordedStatus;
    currentProvenance: string;
    scopesChanged: string[];
  };
  launch: {
    command: string;
    args: string[];
    argsText: string;
  };
  runtimeArtifacts: HandoffRuntimeArtifacts;
}

export interface SessionsHandoffResult {
  handoff: HandoffSummary;
  markdown: string;
}

export async function sessionsHandoffService(
  input: SessionsHandoffInput
): Promise<SessionsHandoffResult> {
  const record = await readSessionRecord({
    sessionsRoot: input.sessionsRoot,
    sessionId: input.sessionId,
  });

  const drift = await resolveDrift(record, input);
  const handoff = buildHandoff(record, input, drift);
  return {
    handoff,
    markdown: renderHandoffMarkdown(handoff),
  };
}

async function resolveDrift(
  record: SessionRecord,
  input: SessionsHandoffInput
): Promise<{ drift: HandoffDriftStatus; scopesChanged: string[] }> {
  if (!record.launchHash) return { drift: NOT_RECORDED, scopesChanged: [] };
  try {
    const driftInput: Parameters<typeof driftService>[0] = {
      sessionsRoot: input.sessionsRoot,
      sessionId: record.sessionId,
      home: input.home,
    };
    if (input.getEffective !== undefined) driftInput.getEffective = input.getEffective;
    const result = await driftService(driftInput);
    return {
      drift: result.drifted ? "drifted" : "in sync",
      scopesChanged: result.scopesChanged.map(redactText),
    };
  } catch {
    return { drift: NOT_RECORDED, scopesChanged: [] };
  }
}

function buildHandoff(
  record: SessionRecord,
  input: SessionsHandoffInput,
  drift: { drift: HandoffDriftStatus; scopesChanged: string[] }
): HandoffSummary {
  const args = redactArgs(record.spawn.args);
  return {
    sessionId: valueOrNotRecorded(record.sessionId),
    cwd: valueOrNotRecorded(record.cwd),
    role: valueOrNotRecorded(record.role),
    authProfileId: valueOrNotRecorded(record.authProfileId),
    sessionStatus: record.status,
    outcome: statusLabel(input.outcome ?? "not-recorded"),
    cleaned: record.cleaned ? "yes" : "no",
    verification: {
      drift: drift.drift,
      verificationStatus: statusLabel(input.verificationStatus ?? "not-recorded"),
      verificationCommand: valueOrNotRecorded(input.verificationCommand),
      launchHashBaseline: record.launchHash ? RECORDED : NOT_RECORDED,
      currentProvenance: currentProvenanceCommand(record),
      scopesChanged: drift.scopesChanged,
    },
    launch: {
      command: valueOrNotRecorded(record.spawn.command),
      args,
      argsText: args.length > 0 ? args.join(" ") : NOT_RECORDED,
    },
    runtimeArtifacts: runtimeArtifacts(record.runtimePaths),
  };
}

function currentProvenanceCommand(record: SessionRecord): string {
  return redactText(
    `myclaude profile show ${record.role} --auth ${record.authProfileId} --cwd ${record.cwd} --provenance`
  );
}

function runtimeArtifacts(paths: SessionRuntimePaths): HandoffRuntimeArtifacts {
  return {
    sessionDir: valueOrNotRecorded(paths.sessionDir),
    claudeConfigDir: valueOrNotRecorded(paths.claudeConfigDir),
    mcpConfig: valueOrNotRecorded(paths.mcpConfig),
    settings: valueOrNotRecorded(paths.settings),
    claudeMd: valueOrNotRecorded(paths.claudeMd),
    apiKeyHelper: valueOrNotRecorded(paths.apiKeyHelper),
    headersHelper: valueOrNotRecorded(paths.headersHelper),
  };
}

function renderHandoffMarkdown(handoff: HandoffSummary): string {
  return [
    "# Agent Profile Handoff Summary",
    "",
    "## Repo Context",
    `- Session id: ${code(handoff.sessionId)}`,
    `- Cwd: ${code(handoff.cwd)}`,
    `- Role: ${code(handoff.role)}`,
    `- Auth profile id: ${code(handoff.authProfileId)}`,
    `- Session status: ${code(handoff.sessionStatus)}`,
    `- Outcome: ${code(handoff.outcome)}`,
    "",
    "## Verification",
    `- Drift: ${code(handoff.verification.drift)}`,
    `- Verification status: ${code(handoff.verification.verificationStatus)}`,
    `- Verification command: ${code(handoff.verification.verificationCommand)}`,
    `- Launch hash baseline: ${code(handoff.verification.launchHashBaseline)}`,
    `- Current provenance: ${code(handoff.verification.currentProvenance)}`,
    "",
    "## Launch",
    `- Command: ${code(handoff.launch.command)}`,
    `- Args: ${code(handoff.launch.argsText)}`,
    "",
    "## Runtime Artifacts",
    `- Session dir: ${code(handoff.runtimeArtifacts.sessionDir)}`,
    `- Claude config dir: ${code(handoff.runtimeArtifacts.claudeConfigDir)}`,
    `- MCP config: ${code(handoff.runtimeArtifacts.mcpConfig)}`,
    `- Settings: ${code(handoff.runtimeArtifacts.settings)}`,
    `- CLAUDE.md: ${code(handoff.runtimeArtifacts.claudeMd)}`,
    `- API key helper: ${code(handoff.runtimeArtifacts.apiKeyHelper)}`,
    `- Headers helper: ${code(handoff.runtimeArtifacts.headersHelper)}`,
    `- Cleaned: ${code(handoff.cleaned)}`,
  ].join("\n");
}

function valueOrNotRecorded(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) return NOT_RECORDED;
  return redactText(value);
}

function statusLabel(value: string): string {
  return value.replace(/-/g, " ");
}

function code(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function redactArgs(args: string[]): string[] {
  const result: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      result.push(REDACTED);
      redactNext = false;
      continue;
    }

    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0 && isSensitiveKey(arg.slice(0, eqIndex))) {
      result.push(`${arg.slice(0, eqIndex + 1)}${REDACTED}`);
      continue;
    }

    const redacted = redactText(arg);
    result.push(redacted);
    if (isSensitiveKey(arg)) redactNext = true;
  }
  return result;
}

function redactText(value: string): string {
  return value
    .replace(/keyring:\/\/[^\s`'")]+/gi, REDACTED)
    .replace(/\$\{secret:[^}]+\}/gi, REDACTED)
    .replace(
      /((?:api[-_]?key|token|secret|password|credential|capability[-_]?token)\s*=)[^\s`'")]+/gi,
      `$1${REDACTED}`
    )
    .replace(/\bsk-ant-[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, REDACTED)
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, REDACTED)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+\b/g, REDACTED)
    .replace(/\bnpm_[A-Za-z0-9_]+\b/g, REDACTED);
}

function isSensitiveKey(value: string): boolean {
  return /(api[-_]?key|token|secret|password|credential|auth|capability[-_]?token)/i.test(value);
}
