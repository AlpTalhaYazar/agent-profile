/**
 * @file provenance-inspector.spec.ts
 *
 * Smoke coverage for the Phase 2 milestone 6 Provenance Inspector screen:
 *  - Sidebar nav switches to "Provenance" and the screen renders.
 *  - When a role + auth are selected, the section selector lists the cascade
 *    fields (mcpServers / env / settings).
 *  - Clicking a field surfaces its provenance chain in the detail panel.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import electronExecutable from "electron";

const electronExecutablePath = electronExecutable as unknown as string;

test("provenance inspector lists cascade fields and shows the chain detail", async () => {
  const launchEnv = { ...process.env };
  launchEnv.ELECTRON_RUN_AS_NODE = undefined;

  const root = await mkdtemp(join(tmpdir(), "agent-profile-provenance-"));
  const myClaudeHome = join(root, "home", ".myclaude");
  const projectDir = join(root, "project");
  const appDir = join(root, "app");
  const socketPath = join(root, "myclaude.sock");

  await mkdir(join(myClaudeHome, "config", "global", "roles"), { recursive: true });
  await mkdir(join(projectDir, ".myclaude", "roles"), { recursive: true });

  await writeFile(
    join(myClaudeHome, "config", "authProfiles.yml"),
    `
version: 1
authProfiles:
  work:
    displayName: Work (Acme)
    anthropic:
      mode: apiKey
      secretRef: keyring://anthropic/work
    mcpSecretRefs: {}
`.trimStart()
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "shared.yml"),
    `
version: 1
env:
  EDITOR: nvim
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem"]
    env:
      ROOTS: /tmp
`.trimStart()
  );
  await writeFile(
    join(myClaudeHome, "config", "global", "roles", "backend.yml"),
    `
version: 1
env:
  NODE_ENV: development
mcpServers:
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      TOKEN: \${secret:github.pat}
`.trimStart()
  );
  await writeFile(join(projectDir, ".myclaude", "roles", "backend.yml"), "version: 1\n");

  expect(
    existsSync(electronExecutablePath),
    `missing Electron executable at ${electronExecutablePath}`
  ).toBe(true);
  await cp(join(process.cwd(), ".vite"), join(appDir, ".vite"), { recursive: true });
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify({ name: "agent-profile-e2e", version: "0.0.1", main: ".vite/build/main.cjs" })
  );

  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir],
    cwd: projectDir,
    env: {
      ...launchEnv,
      MYCLAUDE_HOME: myClaudeHome,
      MYCLAUDE_SOCKET: socketPath,
      PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? "1",
    },
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Profile Explorer" })).toBeVisible();

    // Wait for the cascade to resolve. Profile Editor's effective preview
    // shows "Resolved for <role> @ <auth>" once profile.show returns; that
    // is the unambiguous signal that effectiveStateAtom (which the
    // Provenance Inspector reads) is populated.
    await expect(page.getByText("Resolved for backend @ work")).toBeVisible();

    // Switch to the Provenance screen from the shell sidebar.
    await page.getByTestId("sidebar-provenance").click();
    await expect(page.getByRole("heading", { name: "Provenance Inspector" })).toBeVisible();

    // The section selector lists every cascade field; the seeded MCP servers
    // and env vars must appear (filesystem, github, EDITOR, NODE_ENV).
    const selector = page.getByTestId("provenance-selector");
    await expect(selector.getByText(/MCP Servers/)).toBeVisible();
    await expect(selector.getByTestId("provenance-entry-mcpServers-filesystem")).toBeVisible();
    await expect(selector.getByTestId("provenance-entry-mcpServers-github")).toBeVisible();
    await expect(selector.getByTestId("provenance-entry-env-EDITOR")).toBeVisible();

    // Click the env EDITOR entry and verify the detail pane renders the chain.
    await selector.getByTestId("provenance-entry-env-EDITOR").click();
    const detail = page.getByTestId("provenance-detail");
    await expect(detail.getByRole("heading", { name: "EDITOR" })).toBeVisible();
    await expect(detail.getByText("Contributing scopes")).toBeVisible();

    // Click an mcpServers entry and verify the chain table renders.
    await selector.getByTestId("provenance-entry-mcpServers-github").click();
    await expect(detail.getByRole("heading", { name: "mcpServers.github" })).toBeVisible();
    await expect(detail.getByText("Chain")).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
