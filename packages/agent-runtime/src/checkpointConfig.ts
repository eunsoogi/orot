import type { RunnableConfig } from '@langchain/core/runnables';
import type { CheckpointTuple } from '@langchain/langgraph/web';

export function readThreadId(config: RunnableConfig): string {
  const value = normalizeThreadId(config.configurable?.thread_id);
  if (value === undefined) {
    throw new Error('Missing thread_id in checkpoint config.');
  }
  return value;
}

/** Shares the saver key so equivalent numeric and string thread IDs use one lock. */
export function normalizeThreadId(value: unknown): string | undefined {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
    return undefined;
  }
  return String(value);
}

export function readNamespace(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_ns;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_ns in checkpoint config.');
  return value;
}

export function readOptionalNamespace(config: RunnableConfig): string | undefined {
  const value = config.configurable?.checkpoint_ns;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_ns in checkpoint config.');
  return value;
}

export function readOptionalCheckpointId(config: RunnableConfig): string | undefined {
  const value = config.configurable?.checkpoint_id;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('Invalid checkpoint_id in checkpoint config.');
  return value;
}

export function matchesFilter(
  metadata: CheckpointTuple['metadata'],
  filter: Record<string, unknown>,
): boolean {
  if (!metadata) return Object.keys(filter).length === 0;
  const values = metadata as Record<string, unknown>;
  return Object.entries(filter).every(([key, expected]) => valuesEqual(values[key], expected));
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (
    actual === null ||
    expected === null ||
    typeof actual !== 'object' ||
    typeof expected !== 'object'
  ) {
    return false;
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}
