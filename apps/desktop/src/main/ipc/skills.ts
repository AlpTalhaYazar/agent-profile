import { z } from "zod";
import { CHANNELS } from "../../shared/channels.js";
import {
  skillsAudit,
  skillsDetail,
  skillsInstall,
  skillsListInstalled,
  skillsSearch,
} from "../skills-service.js";
import { type RendererIpcBaseContext, registerSecureHandler } from "./secure-handler.js";

const SkillsSearchPayload = z
  .object({
    query: z.string().max(200),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const SkillIdPayload = z
  .object({
    id: z.string().min(1).max(240),
  })
  .strict();

const SkillsListInstalledPayload = z
  .object({
    scope: z.literal("global").optional(),
    agent: z.literal("claude-code").optional(),
  })
  .strict()
  .optional();

const SkillsInstallPayload = z
  .object({
    id: z.string().min(1).max(240),
    installUrl: z.string().min(1).max(500).optional(),
    slug: z.string().min(1).max(120),
    source: z.string().min(1).max(500),
  })
  .strict();

export function registerSkillsHandlers(context: RendererIpcBaseContext): void {
  registerSecureHandler({
    channel: CHANNELS.skills.search,
    schema: SkillsSearchPayload,
    context,
    handle: (parsed) =>
      skillsSearch({
        query: parsed.query,
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
      }),
  });

  registerSecureHandler({
    channel: CHANNELS.skills.detail,
    schema: SkillIdPayload,
    context,
    handle: (parsed) => skillsDetail(parsed.id),
  });

  registerSecureHandler({
    channel: CHANNELS.skills.audit,
    schema: SkillIdPayload,
    context,
    handle: (parsed) => skillsAudit(parsed.id),
  });

  registerSecureHandler({
    channel: CHANNELS.skills.listInstalled,
    schema: SkillsListInstalledPayload,
    context,
    handle: (parsed) =>
      skillsListInstalled(
        parsed
          ? {
              ...(parsed.scope !== undefined ? { scope: parsed.scope } : {}),
              ...(parsed.agent !== undefined ? { agent: parsed.agent } : {}),
            }
          : undefined
      ),
  });

  registerSecureHandler({
    channel: CHANNELS.skills.install,
    schema: SkillsInstallPayload,
    context,
    handle: (parsed) =>
      skillsInstall({
        id: parsed.id,
        slug: parsed.slug,
        source: parsed.source,
        ...(parsed.installUrl !== undefined ? { installUrl: parsed.installUrl } : {}),
      }),
  });
}
