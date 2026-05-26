export class IllegalTransitionError extends Error {}

/** True if `to` is a declared successor of `from` in the given table. */
export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  const allowed = table[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Throw IllegalTransitionError unless the transition is legal. */
export function assertTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) {
    throw new IllegalTransitionError(`Illegal transition: ${from} -> ${to}`);
  }
}
