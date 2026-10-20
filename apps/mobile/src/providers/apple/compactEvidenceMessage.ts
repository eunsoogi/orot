import { tabularHealthFacts } from './tabularHealthFacts';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inclusivePeriod(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const instants: number[] = [];
  for (const date of value) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(date))
      return undefined;
    const instant = Date.parse(date + 'T00:00:00Z');
    if (
      !Number.isFinite(instant) ||
      new Date(instant).toISOString().slice(0, 10) !== date
    )
      return undefined;
    instants.push(instant);
  }
  // These are calendar labels, not elapsed local-day durations. UTC is used
  // only to verify consecutive labels, preserving DST-specific source times.
  if (
    instants.some(
      (instant, index) =>
        index > 0 && instant - instants[index - 1]! !== 86400000,
    )
  )
    return undefined;
  return {
    fromInclusive: value[0],
    toInclusive: value[value.length - 1],
    calendarDays: value.length,
  };
}

function quantityFacts(value: unknown): unknown {
  const quantity = object(value);
  const comparison = object(quantity?.comparison);
  if (!quantity || !comparison) return value;
  const compacted = { ...comparison };
  for (const name of ['previous', 'recent']) {
    const dates = name + 'Dates',
      period = name + 'Period';
    const range = inclusivePeriod(comparison[dates]);
    // An unexpected existing field must never be overwritten during formatting.
    if (!range || Object.hasOwn(comparison, period)) continue;
    delete compacted[dates];
    compacted[period] = range;
  }
  return { ...quantity, comparison: compacted };
}

/** Lossless formatting for app-owned typed context, not model-written summaries.
 * Keep every topic, value, unit, source time, coverage and citation identity.
 * Decode nested JSON once instead of sending an escaped JSON document as text;
 * consecutive calendar lists become exact inclusive periods, never sampled dates.
 */
export function compactAppleEvidenceMessage(content: string): string {
  let body: Record<string, unknown> | undefined;
  try {
    body = object(JSON.parse(content));
  } catch {
    return content;
  }
  if (
    !body ||
    !Array.isArray(body.records) ||
    Object.hasOwn(body, 'healthContextTableEncoding')
  )
    return content;
  let changed = false;
  let usesTables = false;
  const records = body.records.map(value => {
    const record = object(value);
    if (
      !record ||
      typeof record.content !== 'string' ||
      !record.content.startsWith('health_context: ')
    )
      return value;
    let facts: Record<string, unknown> | undefined;
    try {
      facts = object(
        JSON.parse(record.content.slice('health_context: '.length)),
      );
    } catch {
      return value;
    }
    if (!facts) return value;
    changed = true;
    const projected = {
      ...facts,
      ...(Array.isArray(facts.quantities)
        ? { quantities: facts.quantities.map(quantityFacts) }
        : {}),
    };
    const compacted = tabularHealthFacts(projected);
    usesTables ||= JSON.stringify(compacted) !== JSON.stringify(projected);
    return {
      ...record,
      content: {
        kind: 'health_context',
        facts: compacted,
      },
    };
  });
  return changed
    ? JSON.stringify({
        ...body,
        records,
        ...(usesTables
          ? {
              healthContextTableEncoding:
                'Object arrays may use columns and rows. Each row follows column order; omittedCells lists absent [row,column] positions, distinct from explicit null values. All other values retain their source meaning.',
            }
          : {}),
      })
    : content;
}
