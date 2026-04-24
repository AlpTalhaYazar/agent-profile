# @agent-profile/session-artifacts

Pure I/O package that emits Claude Code runtime artifacts from an
`@agent-profile/core` effective config and an existing session directory.

## What it does

- Writes `mcp.json` for `claude --mcp-config`
- Writes `settings.json` for `claude --settings`
- Writes POSIX helper wrappers (`apiKeyHelper.sh`, `headersHelper.sh`)
- Delegates persona materialization to `@agent-profile/persona-deployer`

## What it does not do

- Does not resolve secrets
- Does not read the keychain
- Does not spawn `claude`
- Does not create, clean up, or retain sessions
- Does not write top-level `effective.env`

## API

```ts
import { emitSessionArtifacts } from "@agent-profile/session-artifacts";
```

All output files are written atomically with sibling temp files and rename.
