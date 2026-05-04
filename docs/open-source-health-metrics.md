# Open-Source Health Metrics

## TL;DR

Agent Profile measures open-source health by tracking privacy-safe evidence of completed trusted repo handoffs, reliability, contributor readiness, and release confidence without adding runtime telemetry or SaaS-style finance metrics.

This document defines a measurement taxonomy only. It does not add analytics SDKs, Sentry, PostHog, Crashpad, network upload, runtime event logging, public API changes, IPC changes, or CLI/Desktop behavior changes. Current adoption baselines are not measured yet unless the signal is already available from local state, GitHub, CI, or release workflows.

## Purpose

Give Product and maintainers a privacy-safe way to reason about adoption, activation, retention, reliability, contributor health, and release confidence for an open-source developer tool.

## Non-Goals

- No analytics SDK, Sentry, PostHog, Crashpad, or network upload.
- No runtime event logging, schema change, public API change, or IPC contract change.
- No SaaS finance metrics such as ARR, CAC, payback, NRR, or conversion funnel claims.
- No claim that usage, adoption, retention, downloads, or contributor activation are currently measured unless the evidence is explicitly GitHub-derived or CI-derived.
- No collection of raw profile, repo, secret, command, MCP, or user identity data.

## North Star

**Completed trusted repo handoff:** a user launches Claude Code with the intended Agent Profile context, generates a handoff summary, and marks or reports the session outcome as completed.

This is the product proof point because it connects the current architecture to user-visible value: safe credentials, isolated session artifacts, launch provenance, drift visibility, and a copyable summary of what happened.

Current baseline: **not measured yet**.

## Metric Hierarchy

| Layer | Metric | Source | Baseline |
|---|---|---|---|
| North Star | Completed trusted repo handoff | Local session record plus handoff summary plus outcome status | not measured yet |
| Activation | First successful launch plus handoff generated | Local session registry and `sessions handoff` command | not measured yet |
| Trust outcome | Handoff outcome distribution: `completed`, `blocked`, `needs relaunch` | Local-only outcome marker or future opt-in aggregate | not measured yet |
| Reliability | Doctor pass/warn/fail code mix, launch failures, daemon reachability, drift/handoff availability | Local doctor JSON, session registry statuses, daemon status | partially local-only; not aggregated |
| Contributor health | Install/build/test success, first PR setup friction, CI pass/fail, review turnaround | GitHub Actions, issues, PRs, contributor docs feedback | CI-derived only |
| Release confidence | Signed artifact verification, release workflow pass/fail, release artifact completeness | GitHub Actions and release verification scripts | CI-derived only |

## Event Taxonomy Proposal

These are proposed measurement events for future implementation gates. They are not runtime events today.

| Event name | Trigger | Allowed fields | Forbidden fields | Collection mode | Confidence |
|---|---|---|---|---|---|
| `handoff.generated` | `myclaude sessions handoff <sessionId>` renders successfully | App version, platform, session status, outcome status, verification status, drift status bucket, launch hash recorded boolean | Session id, cwd, repo path, role name, auth profile id, runtime artifact paths, command args, profile contents | local-only now; future opt-in aggregate | High |
| `handoff.outcome_recorded` | User supplies outcome `completed`, `blocked`, or `needs-relaunch` | App version, platform, outcome status, verification status, session status | Session id, repo path, role/auth identifiers, verification command text | local-only now; future opt-in aggregate | High |
| `launch.succeeded` | Launch record reaches `exited` with exit code `0` or live session starts cleanly | App version, platform, launch mode bucket, daemon vs standalone bucket, retained boolean | Cwd, repo path, raw args, profile contents, secret refs, session id | local-only now; future opt-in aggregate | Medium |
| `launch.failed` | Launch record reaches `failed` or non-zero exit | App version, platform, failure code bucket, daemon vs standalone bucket | Raw error text if it may include paths/secrets, cwd, raw args, MCP bodies | local-only now; future opt-in aggregate after redaction tests | Medium |
| `doctor.check_completed` | `myclaude doctor --json` completes | App version, platform, pass/warn/fail, normalized diagnostic code | Scope file paths, usernames, secret names, role names, profile contents, raw command output | local-only now; future opt-in aggregate | High |
| `daemon.reachability_checked` | Doctor or daemon status probes daemon reachability | App version, platform, reachable boolean, transport kind, active/recent count buckets | Socket path, pid, username, session ids | local-only now; future opt-in aggregate | Medium |
| `contributor.ci_completed` | GitHub Actions CI completes on PR or main | Workflow name, job name, conclusion, platform, duration bucket | Contributor username in product analytics export, repo secrets, log bodies | GitHub-derived | High |
| `release.artifacts_verified` | Release workflow verification completes | Platform, arch, signature required boolean, notarization required boolean, verification conclusion | Signing certificate values, secret names, raw artifact paths outside repo-relative names | GitHub-derived | High |
| `update.channel_selected` | Future auto-update settings choose a release channel | App version, platform, channel, consent state | User id, machine id, repo path, exact install path | future opt-in aggregate only | Low |

## Collection Modes

| Mode | Definition | Allowed Use |
|---|---|---|
| `local-only` | Stored or computed on the user's machine; no network upload. | Default for handoff, launch, doctor, daemon, and session trust signals. |
| `opt-in aggregate` | User explicitly consents; upload contains only schema-approved aggregate fields. | Future telemetry only after privacy gates pass. Default consent is unchecked. |
| `GitHub-derived` | Computed from public or maintainer-visible GitHub Actions, releases, issues, and PR metadata. | Contributor health and release confidence. Avoid exporting identities into product analytics unless explicitly reviewed. |

## Privacy And Security Policy

Measurement must never collect:

- Secret values.
- Sensitive secret names or secret references.
- Raw profile contents.
- Repo paths, cwd values, usernames, home directories, or raw file paths.
- Raw command args or raw error text that may contain secrets.
- MCP config bodies, headers, environment values, or server definitions.
- Auth profile identifiers, role names, session IDs, capability tokens, socket paths, or keychain contents.
- Full verification command text unless it stays local-only.

Policy defaults:

- `DO_NOT_TRACK=1` is a hard refusal and overrides any product consent state.
- `MYCLAUDE_TELEMETRY=0` is the app-level kill switch for any future telemetry path.
- Any future telemetry consent UI is opt-in and default unchecked.
- Redaction must run before validation and transport; validation must reject unknown fields.
- Local-only exports should label unknown baselines as `not measured yet`, not `0`.

## Local-First Measurement Options

The first implementation should stay local-first and can be built without telemetry:

- A local command or maintainer script can summarize session registry counts by status, handoff generated count, and outcome labels.
- `myclaude doctor --json` can be reviewed manually or summarized locally by diagnostic code.
- Release confidence can come from `.github/workflows/release-desktop.yml` conclusions and `verify-release` output.
- Contributor health can come from GitHub Actions pass/fail, issue labels, PR feedback, and setup-doc pain points.
- Product reviews should combine these local/GitHub signals with qualitative user interviews until opt-in telemetry is approved.

## Future Telemetry Gates

Full telemetry, Sentry, PostHog, Crashpad, or any network-uploaded diagnostic path remains deferred until all gates pass:

1. Event taxonomy reviewed and narrowed to the minimum useful fields.
2. Privacy review confirms the forbidden-field list and threat model.
3. User-facing consent copy is written, reviewed, and defaults to unchecked.
4. Tests prove redaction for secrets, paths, usernames, raw args, MCP bodies, and profile contents.
5. `DO_NOT_TRACK=1` and `MYCLAUDE_TELEMETRY=0` kill switches are verified in tests.
6. Unknown-field rejection is tested for every telemetry payload.
7. Maintainers document where uploaded data goes, how long it is retained, and how users can disable it.

## Roadmap Decision Use

Use this taxonomy to make roadmap decisions without pretending adoption is already measured:

- Continue core handoff work when activation and trust outcomes are still `not measured yet`.
- Start auto-update when release confidence is high and public beta friction is mostly distribution-related.
- Start monorepo support when doctor reports, issues, or user interviews show workspace selection is blocking handoff completion.
- Keep enterprise mode deferred until design-partner evidence asks for managed configuration or audit export.
- Keep plugin SDK deferred until core handoff usage or agent-builder demand is validated.
- Keep full telemetry/Sentry deferred until the future telemetry gates are complete.

## Related Documents

- [Roadmap](08-roadmap.md)
- [Open questions](09-open-questions.md)
- [Security model](06-security.md)
- [Desktop signing and notarization runbook](release/desktop-signing-notarization.md)
