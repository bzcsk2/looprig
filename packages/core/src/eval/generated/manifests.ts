import type { EvalCaseManifest } from "../types";
import { loadTerminalBenchManifests } from "../sources/terminal-bench";
import { loadSweBenchManifests } from "../sources/swe-bench";

let _cached: EvalCaseManifest[] | null = null;

export function getRealManifests(): EvalCaseManifest[] {
  if (!_cached) {
    const manifests: EvalCaseManifest[] = [];
    try {
      manifests.push(...loadTerminalBenchManifests());
    } catch (e) {
      console.error("[manifests] Failed to load Terminal-Bench manifests:", e);
    }
    try {
      manifests.push(...loadSweBenchManifests());
    } catch (e) {
      console.error("[manifests] Failed to load SWE-bench manifests:", e);
    }
    _cached = manifests;
  }
  return _cached;
}
