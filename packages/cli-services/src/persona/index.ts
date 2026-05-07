/**
 * @module persona
 *
 * Pure data services for in-memory persona rendering. The CLI's
 * `myclaude render persona` subcommand and the desktop daemon's
 * `persona.render` IPC handler both consume `personaRenderService`.
 */
export { personaRenderService, type PersonaRenderInput } from "./render.js";
export {
  personaPreviewService,
  type PersonaPreviewBasename,
  type PersonaPreviewCategory,
  type PersonaPreviewCategoryCount,
  type PersonaPreviewCollisionWarning,
  type PersonaPreviewFailure,
  type PersonaPreviewFileCategory,
  type PersonaPreviewInput,
  type PersonaPreviewMetrics,
  type PersonaPreviewMissingSourceWarning,
  type PersonaPreviewProjection,
  type PersonaPreviewResult,
} from "./preview.js";
