import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  SkillCatalogItem,
  SkillSearchInput,
  SkillsInstallInput,
  SkillsInstallResult,
  SkillsSearchResult,
} from "../shared/bridge.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

const SKILLS_API_BASE =
  process.env.MYCLAUDE_SKILLS_API_BASE ?? "https://skills.sh";
const DEFAULT_SEARCH_LIMIT = 20;

export async function skillsSearch(
  input: SkillSearchInput,
): Promise<SkillsSearchResult> {
  const url = new URL("/api/v1/skills/search", SKILLS_API_BASE);
  url.searchParams.set("q", input.query.trim());
  url.searchParams.set("limit", String(input.limit ?? DEFAULT_SEARCH_LIMIT));
  const json = await fetchJson(url);
  return {
    skills: normalizeSkillsPayload(json).slice(
      0,
      input.limit ?? DEFAULT_SEARCH_LIMIT,
    ),
  };
}

export async function skillsDetail(id: string): Promise<unknown> {
  return fetchJson(
    new URL(`/api/v1/skills/${encodeURIComponent(id)}`, SKILLS_API_BASE),
  );
}

export async function skillsAudit(id: string): Promise<unknown> {
  return fetchJson(
    new URL(`/api/v1/skills/audit/${encodeURIComponent(id)}`, SKILLS_API_BASE),
  );
}

export async function skillsListInstalled(args?: {
  scope?: "global";
  agent?: "claude-code";
  runner?: CommandRunner;
}): Promise<{ skills: SkillCatalogItem[] }> {
  const runner = args?.runner ?? runCommand;
  const output = await runSkillsList({
    agent: args?.agent ?? "claude-code",
    global: args?.scope === undefined || args.scope === "global",
    runner,
  });
  return { skills: normalizeInstalledSkills(output.stdout) };
}

export async function skillsInstall(
  input: SkillsInstallInput,
  runner: CommandRunner = runCommand,
): Promise<SkillsInstallResult> {
  const packageRef = input.installUrl?.trim() || input.source.trim();
  const slug = input.slug.trim();
  if (!packageRef) {
    throw new Error("Skill install source is required.");
  }
  if (!slug) {
    throw new Error("Skill slug is required.");
  }
  assertSafeCliValue(packageRef, "Skill install source");
  assertSafeCliValue(slug, "Skill slug");

  const addArgs = [
    "-y",
    "skills",
    "add",
    packageRef,
    "--skill",
    slug,
    "--agent",
    "claude-code",
    "-g",
    "-y",
  ];
  const installOutput = await runner("npx", addArgs);
  const listOutput = await runSkillsList({
    agent: "claude-code",
    global: true,
    runner,
  });
  const installed = findInstalledSkill(
    normalizeInstalledSkills(listOutput.stdout),
    {
      id: input.id,
      slug,
    },
  );
  if (!installed?.source) {
    const fallbackPath = resolveInstalledSkillFallback(slug);
    if (!fallbackPath) {
      throw new Error(`Installed skill "${slug}" could not be located.`);
    }
    return {
      installed: true,
      name: slug,
      path: fallbackPath,
      output: [installOutput.stdout, installOutput.stderr]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return {
    installed: true,
    name: installed.slug,
    path: installed.source,
    output: [installOutput.stdout, installOutput.stderr]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function runSkillsList(args: {
  agent: "claude-code";
  global: boolean;
  runner: CommandRunner;
}): Promise<CommandResult> {
  const cliArgs = ["-y", "skills", "list", "--json"];
  if (args.global) cliArgs.push("-g");
  cliArgs.push("-a", args.agent);
  return args.runner("npx", cliArgs);
}

export function normalizeSkillsPayload(payload: unknown): SkillCatalogItem[] {
  const rawItems =
    getArray(payload, "skills") ??
    getArray(payload, "results") ??
    getArray(payload, "data") ??
    (Array.isArray(payload) ? payload : []);

  return rawItems
    .map((item) => normalizeSkillItem(item))
    .filter((item): item is SkillCatalogItem => item !== null);
}

export function normalizeInstalledSkills(stdout: string): SkillCatalogItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rawItems =
    getArray(parsed, "skills") ??
    getArray(parsed, "items") ??
    getArray(parsed, "data") ??
    (Array.isArray(parsed) ? parsed : []);
  return rawItems
    .map((item) => normalizeInstalledSkillItem(item))
    .filter((item): item is SkillCatalogItem => item !== null);
}

export function findInstalledSkill(
  installed: SkillCatalogItem[],
  input: Pick<SkillsInstallInput, "id" | "slug">,
): SkillCatalogItem | null {
  const slug = input.slug.toLowerCase();
  const id = input.id.toLowerCase();
  return (
    installed.find((skill) => skill.slug.toLowerCase() === slug) ??
    installed.find((skill) => skill.id.toLowerCase() === id) ??
    installed.find((skill) =>
      skill.source.toLowerCase().endsWith(`/${slug}`),
    ) ??
    null
  );
}

export async function runCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const chunks: string[] = [];
    const errChunks: string[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out.`));
    }, 120_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr.on("data", (chunk) => errChunks.push(String(chunk)));
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stdout = chunks.join("");
      const stderr = errChunks.join("");
      if (code !== 0) {
        reject(
          new Error(
            stderr ||
              stdout ||
              `${command} exited with code ${code ?? "unknown"}.`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`skills.sh request failed (${response.status})`);
  }
  return response.json();
}

function normalizeSkillItem(item: unknown): SkillCatalogItem | null {
  if (!isRecord(item)) return null;
  const id =
    stringValue(item.id) ?? stringValue(item.slug) ?? stringValue(item.name);
  const slug = stringValue(item.slug) ?? id;
  const name = stringValue(item.name) ?? slug;
  const source =
    stringValue(item.source) ??
    stringValue(item.package) ??
    stringValue(item.repository) ??
    stringValue(item.repo) ??
    stringValue(item.installUrl) ??
    "";
  if (!id || !slug || !name) return null;
  const normalized: SkillCatalogItem = {
    id,
    slug,
    name,
    source,
  };
  const description =
    stringValue(item.description) ?? stringValue(item.summary);
  const installUrl =
    stringValue(item.installUrl) ?? stringValue(item.install_url);
  const url = stringValue(item.url) ?? stringValue(item.html_url);
  const installs =
    numberValue(item.installs) ?? numberValue(item.install_count);
  const duplicate =
    booleanValue(item.duplicate) ?? booleanValue(item.is_duplicate);
  const auditStatus =
    stringValue(item.auditStatus) ??
    stringValue(item.audit_status) ??
    stringValue(isRecord(item.audit) ? item.audit.status : undefined);
  if (description !== undefined) normalized.description = description;
  if (installUrl !== undefined) normalized.installUrl = installUrl;
  if (url !== undefined) normalized.url = url;
  if (installs !== undefined) normalized.installs = installs;
  if (duplicate !== undefined) normalized.duplicate = duplicate;
  if (auditStatus !== undefined) normalized.auditStatus = auditStatus;
  return normalized;
}

function normalizeInstalledSkillItem(item: unknown): SkillCatalogItem | null {
  if (!isRecord(item)) return null;
  const id =
    stringValue(item.id) ?? stringValue(item.slug) ?? stringValue(item.name);
  const slug = stringValue(item.slug) ?? stringValue(item.name) ?? id;
  const source = stringValue(item.path) ?? stringValue(item.source) ?? "";
  if (!id || !slug || !source) return null;
  const normalized: SkillCatalogItem = {
    id,
    slug,
    name: stringValue(item.name) ?? slug,
    source,
  };
  const description = stringValue(item.description);
  if (description !== undefined) normalized.description = description;
  return normalized;
}

function resolveInstalledSkillFallback(slug: string): string | null {
  const home = homedir();
  const candidates = [
    join(home, ".claude", "skills", slug),
    join(home, ".agents", "skills", slug),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, "SKILL.md"))) ??
    null
  );
}

function getArray(record: unknown, key: string): unknown[] | null {
  if (!isRecord(record)) return null;
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function assertSafeCliValue(value: string, label: string): void {
  if (value.startsWith("-")) {
    throw new Error(`${label} must not start with "-".`);
  }
  if (hasControlCharacter(value)) {
    throw new Error(`${label} must not contain control characters.`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
