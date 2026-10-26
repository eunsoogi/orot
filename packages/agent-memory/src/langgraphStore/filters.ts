/** Evaluates LangGraph comparison filters against JSON metadata stored on each item. */
const FILTER_OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') throw new Error('Values must be JSON-compatible.');
  if (ancestors.has(value)) throw new Error('Values must not contain cycles.');
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new Error('Values must be plain JSON objects.');
  }
  ancestors.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  children.forEach((child) => assertJsonValue(child, ancestors));
  ancestors.delete(value);
}

export function validateFilter(filter: Record<string, unknown> | undefined): void {
  if (filter === undefined) return;
  if (!isPlainObject(filter)) throw new Error('Search filters must be plain objects.');
  for (const value of Object.values(filter)) {
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.some((key) => key.startsWith('$'))) {
        if (keys.some((key) => !FILTER_OPERATORS.has(key))) {
          throw new Error('Search filter contains an unsupported operator.');
        }
        if (keys.some((key) => (key === '$in' || key === '$nin') && !Array.isArray(value[key]))) {
          throw new Error('$in and $nin filters require arrays.');
        }
      }
    }
    assertJsonValue(value);
  }
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalJson(item, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && equalJson(left[key], right[key]),
    )
  );
}

function compareValue(value: unknown, condition: unknown): boolean {
  if (!isPlainObject(condition) || !Object.keys(condition).some((key) => key.startsWith('$'))) {
    return equalJson(value, condition);
  }
  return Object.entries(condition).every(([operator, expected]) => {
    if (operator === '$eq') return equalJson(value, expected);
    if (operator === '$ne') return !equalJson(value, expected);
    if (operator === '$in')
      return Array.isArray(expected) && expected.some((item) => equalJson(value, item));
    if (operator === '$nin')
      return Array.isArray(expected) && expected.every((item) => !equalJson(value, item));
    const left = Number(value);
    const right = Number(expected);
    if (operator === '$gt') return left > right;
    if (operator === '$gte') return left >= right;
    if (operator === '$lt') return left < right;
    if (operator === '$lte') return left <= right;
    return false;
  });
}

export function matchesFilter(
  value: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
): boolean {
  return (
    filter === undefined ||
    Object.entries(filter).every(([key, expected]) => compareValue(value[key], expected))
  );
}

export function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error('LangGraph values must be plain JSON objects.');
  assertJsonValue(value);
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
