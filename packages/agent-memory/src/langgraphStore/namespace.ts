/** Applies LangGraph's namespace label rules and matching semantics to persisted items. */
import type { MatchCondition } from '@langchain/langgraph';

export class InvalidNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNamespaceError';
  }
}

export function validateNamespace(
  namespace: unknown,
  allowEmpty = false,
): asserts namespace is string[] {
  if (!Array.isArray(namespace) || (!allowEmpty && namespace.length === 0)) {
    throw new InvalidNamespaceError('Namespace must be a non-empty array of strings.');
  }
  namespace.forEach((part, index) => {
    if (
      typeof part !== 'string' ||
      part.length === 0 ||
      part.includes('.') ||
      (index === 0 && part === 'langgraph')
    ) {
      throw new InvalidNamespaceError(`Invalid namespace label: ${String(part)}.`);
    }
  });
}

export function validateMatchConditions(conditions: MatchCondition[] | undefined): void {
  if (conditions === undefined) return;
  if (!Array.isArray(conditions)) throw new Error('Namespace match conditions must be an array.');
  for (const condition of conditions) {
    if (condition.matchType !== 'prefix' && condition.matchType !== 'suffix') {
      throw new Error(`Unsupported namespace match type: ${String(condition.matchType)}.`);
    }
    if (
      !Array.isArray(condition.path) ||
      condition.path.some(
        (part) =>
          part !== '*' && (typeof part !== 'string' || part.length === 0 || part.includes('.')),
      )
    ) {
      throw new InvalidNamespaceError(
        'Namespace match paths must contain valid labels or wildcards.',
      );
    }
  }
}

export function matchesPath(
  namespace: readonly string[],
  path: readonly (string | '*')[],
  type: 'prefix' | 'suffix',
): boolean {
  if (path.length > namespace.length) return false;
  const start = type === 'prefix' ? 0 : namespace.length - path.length;
  return path.every((part, index) => part === '*' || namespace[start + index] === part);
}

export function compareNamespaces(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = left[index]!.localeCompare(right[index]!);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}
