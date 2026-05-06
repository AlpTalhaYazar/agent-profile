import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createDesktopFixture, type DesktopFixture, launchDesktop, readText } from "./helpers.js";

async function seedLibraryFixture(fixture: DesktopFixture) {
  await writeFile(
    join(fixture.myClaudeHome, "config", "authProfiles.yml"),
    [
      "version: 1",
      "authProfiles:",
      "  work:",
      "    displayName: Work Claude",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/work",
      "    mcpSecretRefs:",
      "      github.pat: keyring://mcp/github",
      "  personal:",
      "    displayName: Personal Claude",
      "    anthropic:",
      "      mode: apiKey",
      "      secretRef: keyring://anthropic/personal",
      "    mcpSecretRefs: {}",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.myClaudeHome, "config", "global", "shared.yml"),
    [
      "version: 1",
      "mcpServers:",
      "  github:",
      "    type: http",
      "    url: https://github.example/mcp",
      "    headers:",
      "      Authorization: Bearer ${secret:github.pat}",
      "persona:",
      "  skills:",
      "    - skills/react/SKILL.md",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "backend-api-review.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Backend API Review",
      "  purpose: Review backend API changes before launch",
      "auth:",
      "  profileId: work",
      "persona:",
      "  agents:",
      "    - agents/reviewer.md",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: Frontend Polish",
      "  purpose: Tune UI details before handoff",
      "auth:",
      "  profileId: personal",
      "mcpServers:",
      "  browser:",
      "    type: stdio",
      "    command: npx",
      "    args:",
      "      - browser-mcp",
      "",
    ].join("\n")
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "legacy-audit.yml"),
    "version: 1\n"
  );
  await writeFile(
    join(fixture.projectDir, ".myclaude", "roles", "stale-review.yml"),
    [
      "version: 1",
      "profile:",
      "  displayName: keyring://anthropic/deleted",
      "  purpose: Bearer ${secret:github.pat}",
      "auth:",
      "  profileId: deleted-auth",
      "",
    ].join("\n")
  );
}

test("Agent Profiles library switches profiles, restores after reload, and hides raw internals", async () => {
  const fixture = await createDesktopFixture("agent-profile-library-");
  await seedLibraryFixture(fixture);
  const { app, page } = await launchDesktop(fixture);

  try {
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();

    const library = page.getByTestId("agent-profile-library");
    await expect(library).toBeVisible();
    await expect(library.getByTestId("agent-profile-library-item")).toHaveCount(4);
    await expect(library).toContainText("Backend API Review");
    await expect(library).toContainText("Review backend API changes before launch");
    await expect(library).toContainText("Frontend Polish");
    await expect(library).toContainText("Tune UI details before handoff");
    await expect(library).toContainText("Legacy Audit Agent");
    await expect(library).toContainText("Legacy Audit Claude profile");
    await expect(library).toContainText("Stale Review Agent");
    await expect(library).toContainText("Identity unavailable");

    const selectedMarker = library.getByTestId("agent-profile-library-selected");
    await expect(selectedMarker).toHaveCount(1);
    const backendItem = library
      .getByTestId("agent-profile-library-item")
      .filter({ hasText: "Backend API Review" });
    await expect(backendItem).toContainText("Selected profile");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Backend API Review");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Ready to launch");

    const homeText = await page.getByTestId("agent-profiles-home").innerText();
    expect(homeText).not.toContain("project-role");
    expect(homeText).not.toContain("global-shared");
    expect(homeText).not.toContain(".myclaude");
    expect(homeText).not.toContain("keyring://");
    expect(homeText).not.toContain("${secret:");
    expect(homeText).not.toContain("Bearer");
    expect(homeText).not.toContain("secretRef");
    expect(homeText).not.toContain("Authorization");

    const frontendItem = library
      .getByTestId("agent-profile-library-item")
      .filter({ hasText: "Frontend Polish" });
    await frontendItem.focus();
    await expect(frontendItem).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("agent-profile-card")).toContainText("Frontend Polish");
    await expect(page.getByTestId("agent-profile-card")).toContainText(
      "Tune UI details before handoff"
    );
    await expect(frontendItem).toContainText("Selected profile");
    await expect(page.getByTestId("agent-profile-library-error")).toHaveCount(0);

    await page.getByTestId("profile-basics-open").click();
    await expect(page.getByTestId("profile-basics-panel")).toBeVisible();
    await expect(page.getByTestId("profile-basics-panel")).toContainText(
      "Customize Frontend Polish"
    );
    await expect(page.getByTestId("profile-basics-preview")).not.toContainText("project-role");
    await expect(page.getByTestId("profile-basics-preview")).not.toContainText("keyring://");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-basics-panel")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Agent Profiles" })).toBeVisible();
    await expect(page.getByTestId("agent-profile-card")).toContainText("Frontend Polish");
    await expect(
      page.getByTestId("agent-profile-library-item").filter({ hasText: "Frontend Polish" })
    ).toContainText("Selected profile");

    const staleItem = page
      .getByTestId("agent-profile-library-item")
      .filter({ hasText: "Stale Review Agent" });
    await staleItem.click();
    await expect(page.getByTestId("agent-profile-library-error")).toContainText(
      "Claude identity that is not available"
    );
    await expect(page.getByTestId("agent-profile-library-error")).not.toContainText("deleted-auth");
    await expect(page.getByTestId("agent-profile-library-error")).not.toContainText("keyring://");
    await expect(page.getByTestId("agent-profile-card")).toContainText("Frontend Polish");

    const storedSelection = await page.evaluate(() =>
      window.localStorage.getItem("agent-profile.selectedProfile")
    );
    expect(storedSelection).toContain("frontend-polish");

    const frontendFile = await readText(
      join(fixture.projectDir, ".myclaude", "roles", "frontend-polish.yml")
    );
    expect(frontendFile).toContain("profile:");
    expect(frontendFile).toContain("displayName: Frontend Polish");
    expect(frontendFile).toContain("purpose: Tune UI details before handoff");
    expect(frontendFile).toContain("profileId: personal");
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
