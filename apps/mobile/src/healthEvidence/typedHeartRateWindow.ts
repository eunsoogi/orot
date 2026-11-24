import { TimestampSchema } from '@orot/domain';
import { localQueryTimestampKey } from '@orot/storage';

export const typedHeartRateMaxDays = 31;
export const typedHeartRateMaxRows = 10_000;
export const typedHeartRateMaxSourceBytes = 8 * 1024 * 1024;

/** The dedicated tool bounds the whole read, not an arbitrary truncation of its evidence. */
export function supportedTypedHeartRatePeriod(
  fromInclusive: string,
  toExclusive: string,
) {
  try {
    const from = TimestampSchema.parse(fromInclusive);
    const to = TimestampSchema.parse(toExclusive);
    const end = localQueryTimestampKey(to);
    const fraction = from.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/)?.[1];
    const startSeconds = Math.floor(Date.parse(from) / 1000);
    const limit = new Date(
      (startSeconds + typedHeartRateMaxDays * 86_400) * 1000,
    )
      .toISOString()
      .replace(/\.000Z$/, fraction ? `.${fraction}Z` : 'Z');
    return (
      localQueryTimestampKey(from) < end && end <= localQueryTimestampKey(limit)
    );
  } catch {
    return false;
  }
}
