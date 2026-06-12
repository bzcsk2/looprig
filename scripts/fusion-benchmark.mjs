#!/usr/bin/env node
/**
 * DRF-80：Fusion Benchmark 根目录入口
 *
 * 委托 packages/core/scripts/benchmark-matrix.ts 执行矩阵 benchmark。
 *
 * 用法：
 *   node scripts/fusion-benchmark.mjs
 *   node scripts/fusion-benchmark.mjs --release-gate-only
 *   node scripts/fusion-benchmark.mjs --overnight
 */

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, "../packages/core/scripts/benchmark-matrix.ts")
const extraArgs = process.argv.slice(2)

const bun = spawnSync("bun", ["run", scriptPath, ...extraArgs], {
  stdio: "inherit",
  cwd: join(__dirname, ".."),
})

process.exit(bun.status ?? 1)
