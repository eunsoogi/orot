/** Keep shape validation separate from clinical and source-fact checks; no coercion of provider values. */
export function asQuestionObject(
  value: unknown,
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

export function hasOnlyQuestionKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function readKoreanQuestionText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 1 &&
    normalized.length <= maximumLength &&
    /[\uac00-\ud7a3]/u.test(normalized)
    ? normalized
    : null;
}
