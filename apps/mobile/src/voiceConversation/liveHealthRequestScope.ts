export function parseLiveHealthRequestScope(args: string) {
  if (typeof args !== 'string' || args.length > 1_024) return;
  let value: unknown;
  try {
    value = JSON.parse(args);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'topic') ||
    !Object.hasOwn(record, 'days') ||
    record.topic !== 'measurements' ||
    typeof record.days !== 'number' ||
    !Number.isInteger(record.days) ||
    record.days < 3 ||
    record.days > 31
  )
    return undefined;
  return Object.freeze({
    topic: record.topic as 'measurements',
    days: record.days,
  });
}
