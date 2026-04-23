import type {
  FieldProvenance,
  McpServerProvenance,
  PersonaProvenance,
  Provenance,
  ScopeName,
} from "../utils/types.js";

/**
 * Mutable working state for provenance tracking during cascade reduction.
 * Converted to the immutable `Provenance` shape at the end of `resolve()`.
 */
export interface ProvenanceState {
  mcpServers: Record<string, McpServerProvenance>;
  env: Record<string, FieldProvenance>;
  settings: Record<string, FieldProvenance>;
  persona: PersonaProvenance[];
}

/**
 * Creates an empty provenance state to be mutated during cascade.
 */
export function createProvenanceState(): ProvenanceState {
  return {
    mcpServers: {},
    env: {},
    settings: {},
    persona: [],
  };
}

/**
 * Records the introduction or update of an MCP server in provenance.
 *
 * @param state - The mutable provenance state.
 * @param serverName - Name of the MCP server.
 * @param scopeName - The scope contributing the change.
 * @param event - The type of event being recorded.
 * @param overriddenFields - Fields overridden by this event (for 'replaced'/'deep-merged').
 */
export function recordMcpServerEvent(
  state: ProvenanceState,
  serverName: string,
  scopeName: ScopeName,
  event: McpServerProvenance["chain"][number]["event"],
  overriddenFields?: string[]
): void {
  const existing = state.mcpServers[serverName];
  if (existing) {
    existing.source = scopeName;
    existing.chain.push({ scope: scopeName, event });
    if (overriddenFields && overriddenFields.length > 0) {
      existing.overriddenFields = overriddenFields;
    }
  } else {
    state.mcpServers[serverName] = {
      source: scopeName,
      chain: [{ scope: scopeName, event }],
      ...(overriddenFields && overriddenFields.length > 0 ? { overriddenFields } : {}),
    };
  }
}

/**
 * Records a tombstone (suppression) event for an MCP server.
 */
export function recordMcpServerSuppressed(
  state: ProvenanceState,
  serverName: string,
  scopeName: ScopeName
): void {
  const existing = state.mcpServers[serverName];
  if (existing) {
    existing.suppressedBy = scopeName;
    existing.chain.push({ scope: scopeName, event: "suppressed" });
  } else {
    state.mcpServers[serverName] = {
      source: scopeName,
      suppressedBy: scopeName,
      chain: [{ scope: scopeName, event: "suppressed" }],
    };
  }
}

/**
 * Records the introduction or override of a scalar env var.
 */
export function recordEnvField(state: ProvenanceState, key: string, scopeName: ScopeName): void {
  const existing = state.env[key];
  if (existing) {
    // later layer is the new source (last-wins)
    existing.source = scopeName;
    existing.chain.push(scopeName);
  } else {
    state.env[key] = { source: scopeName, chain: [scopeName] };
  }
}

/**
 * Records the introduction or override of a settings key.
 */
export function recordSettingsField(
  state: ProvenanceState,
  key: string,
  scopeName: ScopeName
): void {
  const existing = state.settings[key];
  if (existing) {
    existing.source = scopeName;
    existing.chain.push(scopeName);
  } else {
    state.settings[key] = { source: scopeName, chain: [scopeName] };
  }
}

/**
 * Records persona files contributed by a scope.
 */
export function recordPersona(state: ProvenanceState, scopeName: ScopeName, files: string[]): void {
  if (files.length > 0) {
    state.persona.push({ source: scopeName, files });
  }
}

/**
 * Converts the mutable working state to the final immutable `Provenance` shape.
 */
export function finalizeProvenance(state: ProvenanceState): Provenance {
  return {
    mcpServers: { ...state.mcpServers },
    env: { ...state.env },
    settings: { ...state.settings },
    persona: [...state.persona],
  };
}
