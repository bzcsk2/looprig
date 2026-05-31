export function plural(n: number, word: string): string {
  return n === 1 ? word : word + 's';
}
