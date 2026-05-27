// Runtime wrapper for pi-ai.
// Pi: https://github.com/earendil-works/pi-mono
// Source: pi/packages/ai/src/stream.ts
//
// tsx resolves TypeScript imports from .js files, this re-exports from pi source.
// tsc uses pi.d.ts for type declarations and skips this .js file.
import { streamSimple, completeSimple } from "../../../pi/packages/ai/src/index.ts"

export { streamSimple, completeSimple }
