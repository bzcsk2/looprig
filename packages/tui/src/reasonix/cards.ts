/** Card type definitions — aligned with Reasonix cards.ts */

export interface CardBase {
  id: string;
  ts: number;
}

export interface UserCard extends CardBase {
  kind: 'user';
  text: string;
}

export interface ReasoningCard extends CardBase {
  kind: 'reasoning';
  text: string;
  streaming: boolean;
  aborted?: boolean;
  endedAt?: number;
}

export interface StreamingCard extends CardBase {
  kind: 'streaming';
  text: string;
  done: boolean;
  aborted?: boolean;
  model?: string;
  endedAt?: number;
}

export interface ToolCard extends CardBase {
  kind: 'tool';
  name: string;
  args: Record<string, unknown>;
  output: string;
  done: boolean;
  exitCode?: number;
  elapsedMs: number;
  aborted?: boolean;
  rejected?: boolean;
}

export interface ErrorCard extends CardBase {
  kind: 'error';
  title: string;
  message: string;
}

export interface WarnCard extends CardBase {
  kind: 'warn';
  title: string;
  message: string;
}

export interface UsageCard extends CardBase {
  kind: 'usage';
  tokens: { input: number; output: number; cacheHit: number };
  cost?: number;
  elapsedMs?: number;
}

export type Card =
  | UserCard
  | ReasoningCard
  | StreamingCard
  | ToolCard
  | ErrorCard
  | WarnCard
  | UsageCard;

export type CardKind = Card['kind'];

let _nextId = 0;
export function nextId(prefix = 'card'): string {
  return `${prefix}-${++_nextId}`;
}
