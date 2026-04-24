# @agent-profile/persona-deployer

Pure I/O package that materializes the `persona` section from `@agent-profile/core`'s
`EffectiveSessionConfig` into an ephemeral session directory structured for Claude Code's
`CLAUDE_CONFIG_DIR`.

## What it does

- Creates an ephemeral session directory under `~/.myclaude/sessions/<uuid>/`
- Concatenates CLAUDE.md fragments with source markers
- Copies agents, skills, slash commands, and memory seed files
- Records filename collisions (later wins)
- Cleans up session directories safely

## API

```ts
import {
  deployPersona,
  createSessionDir,
  cleanupSession,
  listOrphanedSessions,
  sessionsRootDefault,
  isPathWithinRoot,
  PersonaDeployError,
  SessionPathUnsafeError,
  SourceFileNotFoundError,
} from "@agent-profile/persona-deployer";
```

## Constraints

- Pure file I/O — no process spawn, no network, no env mutation
- All writes via `atomicWrite` (temp + rename)
- All deletion via `cleanupSession` with `assertInsideRoot`
- Tests run in `os.tmpdir()` — no writes under `~/.myclaude/`
