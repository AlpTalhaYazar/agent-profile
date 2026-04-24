import { spawn } from "node:child_process";
import { constants } from "node:os";
import { CliError, EXIT_GENERIC, EXIT_SPAWN_FAILURE } from "../../errors.js";
import {
  type BuildClaudeLaunchArgsOptions,
  type BuildClaudeLaunchEnvInput,
  type ClaudeLaunchRuntimePaths,
  buildClaudeLaunchArgs,
  buildClaudeLaunchEnv,
} from "./env.js";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const SIGNAL_NUMBERS = constants.signals as Readonly<Partial<Record<NodeJS.Signals, number>>>;

/** Spawn options used for Claude Code launches. */
export interface ClaudeSpawnOptions {
  env: NodeJS.ProcessEnv;
  stdio: "inherit";
}

/** Child-process surface needed by the launcher. */
export interface ClaudeChildProcess {
  kill(signal: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

/** Injectable spawn function for focused tests. */
export type ClaudeSpawnFn = (
  command: string,
  args: string[],
  options: ClaudeSpawnOptions
) => ClaudeChildProcess;

/** Injectable spawn implementation used by launch orchestration. */
export type SpawnImpl = ClaudeSpawnFn;

/** Process signal surface needed by the launcher. */
export interface SignalProcess {
  on(signal: NodeJS.Signals, listener: NodeJS.SignalsListener): this;
  off(signal: NodeJS.Signals, listener: NodeJS.SignalsListener): this;
}

/** Inputs for spawning Claude Code. */
export interface SpawnClaudeInput extends BuildClaudeLaunchEnvInput, BuildClaudeLaunchArgsOptions {
  command?: string;
  spawnFn?: ClaudeSpawnFn;
  signalProcess?: SignalProcess;
}

/** Inputs for running Claude with precomputed argv and env. */
export interface RunClaudeInput {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  spawn?: SpawnImpl;
  signalProcess?: SignalProcess;
}

const defaultSpawnFn: ClaudeSpawnFn = (command, args, options) => spawn(command, args, options);

/**
 * Build the Claude Code argv for runtime artifact paths.
 */
export function buildClaudeArgs(
  runtimePaths: Pick<ClaudeLaunchRuntimePaths, "mcpConfig" | "settings">,
  options: BuildClaudeLaunchArgsOptions = {}
): string[] {
  return buildClaudeLaunchArgs(runtimePaths, options);
}

/**
 * Run Claude Code with precomputed argv and environment.
 */
export function runClaude(input: RunClaudeInput): Promise<number> {
  let child: ClaudeChildProcess;
  try {
    child = (input.spawn ?? defaultSpawnFn)(input.command, input.args, {
      env: input.env,
      stdio: "inherit",
    });
  } catch (err) {
    throw spawnError(err);
  }

  return waitForChildClose(child, input.signalProcess ?? process);
}

/**
 * Spawn Claude Code and resolve to the child exit code.
 */
export function spawnClaude(input: SpawnClaudeInput): Promise<number> {
  const command = input.command ?? "claude";
  const argOptions: BuildClaudeLaunchArgsOptions = {};
  if (input.strict !== undefined) argOptions.strict = input.strict;
  if (input.bare !== undefined) argOptions.bare = input.bare;
  if (input.addDirs !== undefined) argOptions.addDirs = input.addDirs;
  if (input.passthroughArgs !== undefined) argOptions.passthroughArgs = input.passthroughArgs;
  if (input.settingSources !== undefined) argOptions.settingSources = input.settingSources;
  const args = buildClaudeLaunchArgs(input.runtimePaths, argOptions);
  const env = buildClaudeLaunchEnv(input);
  return runClaude({
    command,
    args,
    env,
    ...(input.spawnFn ? { spawn: input.spawnFn } : {}),
    ...(input.signalProcess ? { signalProcess: input.signalProcess } : {}),
  });
}

function waitForChildClose(
  child: ClaudeChildProcess,
  signalProcess: SignalProcess
): Promise<number> {
  const signalListeners: Array<[NodeJS.Signals, NodeJS.SignalsListener]> = [];

  const removeSignalListeners = () => {
    for (const [signal, listener] of signalListeners) {
      signalProcess.off(signal, listener);
    }
  };

  for (const signal of FORWARDED_SIGNALS) {
    const listener: NodeJS.SignalsListener = () => {
      child.kill(signal);
    };
    signalListeners.push([signal, listener]);
    signalProcess.on(signal, listener);
  }

  return new Promise((resolve, reject) => {
    child.on("error", (err) => {
      removeSignalListeners();
      reject(spawnError(err));
    });

    child.on("close", (code, signal) => {
      removeSignalListeners();
      resolve(exitCodeForClose(code, signal));
    });
  });
}

function exitCodeForClose(code: number | null, signal: NodeJS.Signals | null): number {
  if (signal) {
    const signalNumber = SIGNAL_NUMBERS[signal];
    return typeof signalNumber === "number" ? 128 + signalNumber : EXIT_GENERIC;
  }

  return code ?? EXIT_GENERIC;
}

function spawnError(err: unknown): CliError {
  const message = err instanceof Error ? err.message : String(err);
  return new CliError(`Failed to launch claude: ${message}`, EXIT_SPAWN_FAILURE);
}
