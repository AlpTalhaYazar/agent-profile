import { z } from "zod";

import { NonEmptyId, strictObject } from "./common.js";

/**
 * First-run bootstrap probe (Phase 2 milestone 7).
 *
 * The desktop renderer issues this once on startup to decide whether to show
 * the first-run wizard. The daemon owns the answer because it owns the
 * `~/.myclaude/` filesystem state.
 *
 * The response combines two signals:
 *
 *   - `profileCount` — number of auth profiles in `authProfiles.yml`.
 *   - `setupCompleteMarker` — whether `~/.myclaude/.setup-complete` exists.
 *
 * `firstRun = profileCount === 0 && !setupCompleteMarker`.
 *
 * Upgrade path: when the user already has profiles from a pre-M7 build, the
 * marker is absent but `profileCount > 0`, so `firstRun` is still `false` and
 * the wizard does not show. The marker stays absent for that user; the next
 * `setup.markComplete` call writes it. The daemon never synthesises the marker
 * on a read kind — bootstrap is pure read.
 *
 * The `.setup-complete` marker is GUI-only; the CLI never reads or writes it.
 */
export const ReqSystemBootstrap = strictObject({
  id: NonEmptyId,
  kind: z.literal("system.bootstrap"),
});

export const RespSystemBootstrapOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("system.bootstrap.ok"),
  firstRun: z.boolean(),
  profileCount: z.number().int().nonnegative(),
  setupCompleteMarker: z.boolean(),
});

/**
 * Mark first-run setup complete (Phase 2 milestone 7).
 *
 * Writes `~/.myclaude/.setup-complete` (mode 0600, contents = ISO timestamp)
 * so the next launch's `system.bootstrap` returns `setupCompleteMarker: true`
 * and `firstRun: false`. Idempotent: safe to call when the marker already
 * exists.
 *
 * Triggered by the GUI's first-run wizard on completion or dismissal. The
 * marker is GUI-only; the CLI never reads or writes it.
 */
export const ReqSetupMarkComplete = strictObject({
  id: NonEmptyId,
  kind: z.literal("setup.markComplete"),
});

export const RespSetupMarkCompleteOk = strictObject({
  id: NonEmptyId,
  kind: z.literal("setup.markComplete.ok"),
});

/** Static type for `system.bootstrap` requests. */
export type ReqSystemBootstrapT = z.infer<typeof ReqSystemBootstrap>;
/** Static type for `system.bootstrap.ok` responses. */
export type RespSystemBootstrapOkT = z.infer<typeof RespSystemBootstrapOk>;
/** Static type for `setup.markComplete` requests (write-side). */
export type ReqSetupMarkCompleteT = z.infer<typeof ReqSetupMarkComplete>;
/** Static type for `setup.markComplete.ok` responses. */
export type RespSetupMarkCompleteOkT = z.infer<typeof RespSetupMarkCompleteOk>;
