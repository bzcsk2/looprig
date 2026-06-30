import type { EvalSandboxProfile, ToolchainFingerprint, EvalEnvironmentId } from "../../sandbox/types";
import { execSync } from "node:child_process";
import { getInstalledBinaryPath, getInstalledVersion, getToolchainPath } from "./installer";

function buildBenchmarkPath(): string[] {
  const managed = getToolchainPath();
  if (managed.length > 0) {
    return managed;
  }
  return [];
}

const BENCHMARK_NODE_PROFILE: EvalSandboxProfile = {
  id: "sandbox.benchmark",
  toolchainProfile: "node",
  officialScore: true,
  path: [],
  toolchainFingerprint: null,
  networkPolicy: { setup: true, agent: false, verifier: false },
};

const LOCAL_NODE_PROFILE: EvalSandboxProfile = {
  id: "sandbox.local",
  toolchainProfile: "node",
  officialScore: false,
  path: [],
  toolchainFingerprint: null,
  networkPolicy: { setup: true, agent: false, verifier: false },
};

function detectHostTool(name: string): { version: string; path: string } | null {
  try {
    const out = execSync(`command -v ${name} 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).toString().trim();
    if (!out) return null;
    let version = "";
    try {
      const v = execSync(`${name} --version 2>/dev/null`, { encoding: "utf-8", stdio: "pipe" }).toString().trim();
      version = v;
    } catch {}
    return { version, path: out };
  } catch {
    return null;
  }
}

export function buildToolchainFingerprint(
  environmentId: EvalEnvironmentId,
  tools: string[],
): ToolchainFingerprint {
  const detected = tools.map((name) => {
    const managed = getInstalledVersion(name);
    const host = managed ? null : detectHostTool(name);
    const managedPath = managed ? getInstalledBinaryPath(name) : null;
    return {
      name,
      version: managed ?? host?.version ?? "unknown",
      source: managed ? ("managed" as const) : host ? ("host" as const) : ("fallback" as const),
      path: managedPath ?? host?.path ?? "",
    };
  });

  return {
    profile: environmentId,
    tools: detected,
    path: detected.map((t) => t.path).filter(Boolean),
    createdAt: new Date().toISOString(),
  };
}

export function resolveProfile(
  environmentId: EvalEnvironmentId,
  toolchainProfile?: string,
): EvalSandboxProfile {
  if (environmentId === "sandbox.benchmark") {
    return { ...BENCHMARK_NODE_PROFILE, toolchainProfile: toolchainProfile ?? "node", path: buildBenchmarkPath() };
  }
  return { ...LOCAL_NODE_PROFILE, toolchainProfile: toolchainProfile ?? "node" };
}

export function listProfiles(): EvalSandboxProfile[] {
  return [BENCHMARK_NODE_PROFILE, LOCAL_NODE_PROFILE];
}
