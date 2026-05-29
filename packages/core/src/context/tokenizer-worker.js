import { parentPort } from "node:worker_threads"
import { refinedEstimate } from "./token-estimator.js"

const MSG_OVERHEAD = 10

parentPort?.on("message", (msg) => {
  let total = 0
  for (const m of msg.messages) {
    total += MSG_OVERHEAD
    if (m.content) total += refinedEstimate(m.content)
    if (m.reasoning_content) total += refinedEstimate(m.reasoning_content)
  }
  parentPort?.postMessage({ id: msg.id, result: total })
})
