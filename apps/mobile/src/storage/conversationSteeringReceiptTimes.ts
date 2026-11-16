import type { SqlValue } from '@orot/storage';

/** Optional display metadata cannot turn an old or malformed clock value into a new receipt. */
export function steeringReceiptTimes(row: Record<string, SqlValue>) {
  const valid = (value: SqlValue | undefined): value is string =>
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  return {
    ...(valid(row.submitted_at) ? { submittedAt: row.submitted_at } : {}),
    ...(valid(row.sent_at) ? { sentAt: row.sent_at } : {}),
    ...(valid(row.read_at) ? { readAt: row.read_at } : {}),
  };
}
