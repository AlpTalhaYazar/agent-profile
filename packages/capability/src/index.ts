/**
 * @module @agent-profile/capability
 *
 * Capability-token primitives shared by the CLI, helper, and the Electron
 * daemon. No runtime dependencies beyond Node built-ins; safe to import from
 * any side of the IPC seam.
 */

export { timingSafeEqualString } from "./compare.js";
export {
  generateCapabilityToken,
  generateSigningKey,
  signToken,
  verifyToken,
  type TokenPayload,
  type VerifyResult,
} from "./token.js";
export { RevocationRegistry } from "./revocation.js";
export {
  CapabilityIssuer,
  type CapabilityIssuerOptions,
  type IssueArgs,
  type IssuedToken,
} from "./issuer.js";
export {
  CapabilityVerifier,
  type CapabilityVerifierOptions,
  type VerifyOptions,
} from "./verifier.js";
