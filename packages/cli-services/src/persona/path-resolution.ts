import { isAbsolute, resolve } from "node:path";
import type { EffectiveSessionConfig } from "@agent-profile/core";

type PersonaRefs = EffectiveSessionConfig["effective"]["persona"];

export function resolvePersonaRefsForRender(
  persona: PersonaRefs,
  cwd: string,
): PersonaRefs {
  return {
    claudeMd: persona.claudeMd.map((ref) =>
      resolvePersonaRefForRender(ref, cwd),
    ),
    agents: persona.agents.map((ref) => resolvePersonaRefForRender(ref, cwd)),
    skills: persona.skills.map((ref) => resolvePersonaRefForRender(ref, cwd)),
    slashCmds: persona.slashCmds.map((ref) =>
      resolvePersonaRefForRender(ref, cwd),
    ),
    memory: persona.memory.map((ref) => resolvePersonaRefForRender(ref, cwd)),
  };
}

export function resolvePersonaProvenanceMapForRender(
  provenanceMap: Record<string, string>,
  cwd: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(provenanceMap).map(([sourcePath, source]) => [
      resolvePersonaRefForRender(sourcePath, cwd),
      source,
    ]),
  );
}

export function resolvePersonaRefSetForRender(
  refs: ReadonlySet<string>,
  cwd: string,
): Set<string> {
  return new Set(
    Array.from(refs, (ref) => resolvePersonaRefForRender(ref, cwd)),
  );
}

function resolvePersonaRefForRender(ref: string, cwd: string): string {
  const trimmed = ref.trim();
  if (
    !trimmed ||
    isAbsolute(trimmed) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)
  ) {
    return ref;
  }
  return resolve(cwd, trimmed);
}
