import type { SandboxProvider, SandboxCapabilities, EvalEnvironmentId, SandboxProviderId } from "./types";
import { SoftWorkspaceProvider } from "./soft-workspace";
import { BwrapProvider } from "./bwrap";

const providers: Map<SandboxProviderId, SandboxProvider> = new Map();

export function registerProvider(provider: SandboxProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: SandboxProviderId): SandboxProvider | undefined {
  return providers.get(id);
}

export function listProviders(): SandboxProvider[] {
  return Array.from(providers.values());
}

export async function detectBestProvider(
  environmentId: EvalEnvironmentId,
): Promise<{ provider: SandboxProvider; capabilities: SandboxCapabilities }> {
  if (environmentId === "sandbox.local") {
    const order: SandboxProviderId[] = ["bwrap", "soft-workspace"];
    for (const id of order) {
      const p = providers.get(id);
      if (!p) continue;
      const caps = await p.canRun();
      if (caps.available) {
        return {
          provider: p,
          capabilities: {
            ...caps,
            official: false,
            reason: id === "bwrap"
              ? "sandbox.local: OS-level sandbox with host/local toolchain. Scores are diagnostic only."
              : caps.reason ?? "sandbox.local: soft workspace fallback. Scores are diagnostic only.",
          },
        };
      }
    }
  }

  if (environmentId === "diagnostic") {
    const soft = providers.get("soft-workspace");
    if (soft) {
      const caps = await soft.canRun();
      return { provider: soft, capabilities: caps };
    }
  }

  if (environmentId === "sandbox.benchmark") {
    const order: SandboxProviderId[] = ["bwrap", "soft-workspace"];
    for (const id of order) {
      const p = providers.get(id);
      if (!p) continue;
      const caps = await p.canRun();
      if (caps.available) {
        return { provider: p, capabilities: caps };
      }
    }
  }

  const fallback = providers.get("soft-workspace");
  if (fallback) {
    const caps = await fallback.canRun();
    return { provider: fallback, capabilities: { ...caps, official: false, reason: `${environmentId}: no preferred provider available, falling back to soft-workspace` } };
  }

  throw new Error(`No provider available for environment: ${environmentId}`);
}

export function initDefaultProviders(): void {
  registerProvider(new SoftWorkspaceProvider());
  registerProvider(new BwrapProvider());
}

export function clearProviders(): void {
  providers.clear();
}
