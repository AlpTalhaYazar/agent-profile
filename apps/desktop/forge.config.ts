/**
 * Electron Forge configuration for `@agent-profile/desktop`.
 *
 * Two plugins are wired here:
 *
 *  - `@electron-forge/plugin-vite` — bundles the Main process, preload, and the
 *    placeholder Renderer through Vite. The entries reflect the source layout
 *    in `src/main`, `src/preload`, and `src/renderer`.
 *  - `@electron-forge/plugin-fuses` — flips Electron Fuses at package time so
 *    the shipped binary cannot be repurposed as a generic Node runtime nor
 *    accept `--inspect` from a malicious caller. The fuse values match
 *    `docs/06-security.md` "Electron Fuses" exactly. They are re-verified at
 *    build time by `scripts/verify-fuses.mjs`.
 */
import MakerDeb from "@electron-forge/maker-deb";
import type { MakerDebConfig } from "@electron-forge/maker-deb";
import MakerDMG from "@electron-forge/maker-dmg";
import MakerRpm from "@electron-forge/maker-rpm";
import type { MakerRpmConfig } from "@electron-forge/maker-rpm";
import MakerSquirrel from "@electron-forge/maker-squirrel";
import type { MakerSquirrelConfig } from "@electron-forge/maker-squirrel";
import MakerZIP from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

type PackagerConfig = NonNullable<ForgeConfig["packagerConfig"]>;
type MacSigningConfig = Pick<PackagerConfig, "osxSign" | "osxNotarize">;
type OsxSignConfig = NonNullable<
  Exclude<PackagerConfig["osxSign"], true | undefined>
> & {
  continueOnError?: boolean;
};
type WindowsSigningConfig = Pick<PackagerConfig, "windowsSign">;
type ReleaseWindowsSignConfig = {
  certificateFile?: string;
  certificatePassword?: string;
  signToolPath?: string;
  signWithParams?: string;
  timestampServer?: string;
};

const isReleaseBuild = process.env.AGENT_PROFILE_RELEASE === "1";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name} for release signing.`,
    );
  }

  return value;
}

function buildMacSigningConfig(): MacSigningConfig | Record<string, never> {
  if (!isReleaseBuild || process.platform !== "darwin") {
    return {};
  }

  const osxSign: OsxSignConfig = {
    identity: requireEnv("APPLE_CODESIGN_IDENTITY"),
    keychain: requireEnv("APPLE_KEYCHAIN"),
    continueOnError: false,
  };

  return {
    osxSign,
    osxNotarize: {
      appleApiKey: requireEnv("APPLE_API_KEY_PATH"),
      appleApiKeyId: requireEnv("APPLE_API_KEY_ID"),
      appleApiIssuer: requireEnv("APPLE_API_ISSUER"),
    },
  };
}

function buildWindowsSignConfig(): ReleaseWindowsSignConfig | undefined {
  if (!isReleaseBuild || process.platform !== "win32") {
    return undefined;
  }

  const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
  const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
  const signWithParams = process.env.WINDOWS_SIGN_WITH_PARAMS;

  if ((!certificateFile || !certificatePassword) && !signWithParams) {
    throw new Error(
      "Missing required Windows release signing environment. Set WINDOWS_CERTIFICATE_FILE and WINDOWS_CERTIFICATE_PASSWORD for PFX signing, or WINDOWS_SIGN_WITH_PARAMS for EV/HSM signing.",
    );
  }

  return {
    ...(certificateFile ? { certificateFile } : {}),
    ...(certificatePassword ? { certificatePassword } : {}),
    ...(process.env.WINDOWS_SIGNTOOL_PATH
      ? { signToolPath: process.env.WINDOWS_SIGNTOOL_PATH }
      : {}),
    ...(signWithParams ? { signWithParams } : {}),
    ...(process.env.WINDOWS_TIMESTAMP_SERVER
      ? { timestampServer: process.env.WINDOWS_TIMESTAMP_SERVER }
      : {}),
  };
}

function buildWindowsSigningConfig(
  windowsSign: ReleaseWindowsSignConfig | undefined
): WindowsSigningConfig | Record<string, never> {
  if (!windowsSign) {
    return {};
  }

  return {
    windowsSign: {
      ...windowsSign,
      continueOnError: false,
    },
  };
}

const windowsSign = buildWindowsSignConfig();
const squirrelConfig: MakerSquirrelConfig = {
  name: "AgentProfile",
  ...(windowsSign ? { windowsSign } : {}),
};
const linuxPackageDescription =
  "Desktop host for the Agent Profile daemon and GUI.";
const debConfig: MakerDebConfig = {
  options: {
    name: "agent-profile-desktop",
    productName: "AgentProfile",
    genericName: "Developer Tool",
    description: linuxPackageDescription,
    productDescription: linuxPackageDescription,
    section: "devel",
    priority: "optional",
    maintainer: "Agent Profile maintainers",
    bin: "AgentProfile",
    categories: ["Development"],
  },
};
const rpmConfig: MakerRpmConfig = {
  options: {
    name: "agent-profile-desktop",
    productName: "AgentProfile",
    genericName: "Developer Tool",
    description: linuxPackageDescription,
    productDescription: linuxPackageDescription,
    license: "UNLICENSED",
    group: "Development/Tools",
    bin: "AgentProfile",
    categories: ["Development"],
  },
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/node_modules/@homebridge/node-pty-prebuilt-multiarch/**",
    },
    appBundleId: "com.agentprofile.desktop",
    appCategoryType: "public.app-category.developer-tools",
    name: "AgentProfile",
    ...buildMacSigningConfig(),
    ...buildWindowsSigningConfig(windowsSign),
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["darwin", "linux"]),
    new MakerDMG({}, ["darwin"]),
    new MakerSquirrel(squirrelConfig, ["win32"]),
    new MakerDeb(debConfig, ["linux"]),
    new MakerRpm(rpmConfig, ["linux"]),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          // Dedicated preload for the Main-owned secret-entry child window.
          // Phase 2 milestone 5 hybrid plaintext flow: `auth.add` opens this
          // modal so the Anthropic API key never crosses the Renderer.
          entry: "src/secret-dialog/preload.ts",
          config: "vite.secret-preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // The fuse values below mirror the table in `docs/06-security.md`.
    // CI runs `scripts/verify-fuses.mjs` against the packaged binary to confirm
    // the bits actually flipped — these declarations are the source of truth.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
