import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveClaudeCommand } from "../src/main/claude-command.js";

describe("resolveClaudeCommand", () => {
  it("honors an executable absolute override", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-command-"));
    const command = join(root, "claude");
    await writeFile(command, "#!/bin/sh\nexit 0\n");
    await chmod(command, 0o755);

    await expect(resolveClaudeCommand({ override: command, env: { PATH: "" } })).resolves.toBe(
      command
    );
  });

  it("resolves claude from PATH before shell fallbacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "claude-command-path-"));
    const bin = join(root, "bin");
    const command = join(bin, "claude");
    await mkdir(bin, { recursive: true });
    await writeFile(command, "#!/bin/sh\nexit 0\n");
    await chmod(command, 0o755);

    await expect(resolveClaudeCommand({ env: { PATH: bin, HOME: root } })).resolves.toBe(command);
  });

  it("rejects a relative override", async () => {
    await expect(resolveClaudeCommand({ override: "claude", env: { PATH: "" } })).rejects.toThrow(
      /absolute path/
    );
  });
});
