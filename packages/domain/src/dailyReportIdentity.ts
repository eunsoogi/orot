import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);

function resolvedTimeZone(timeZone: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** A Gregorian civil date; it has no implicit timezone or time of day. */
export const DailyReportLocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(0);
    date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10) === value;
  }, 'A valid calendar date is required.');

/** Validate against the timezone database supplied by the current app runtime. */
export const DailyReportTimeZoneSchema = NonEmptyTextSchema.refine((value) => {
  return resolvedTimeZone(value) !== undefined;
}, 'An IANA time zone is required.');

/** Regeneration changes a revision, while this key stays fixed for date and zone. */
export function dailyReportIdentityKey(localDate: string, timeZone: string): string {
  return 'daily-report:' + localDate + '@' + timeZone;
}

export function createDailyReportIdentity(localDate: string, timeZone: string) {
  const date = DailyReportLocalDateSchema.parse(localDate);
  const zone = DailyReportTimeZoneSchema.parse(timeZone);
  const canonicalZone = resolvedTimeZone(zone)!;
  return {
    kind: 'daily_report' as const,
    localDate: date,
    timeZone: canonicalZone,
    key: dailyReportIdentityKey(date, canonicalZone),
  };
}

export const DailyReportContextRequestSchema = z.strictObject({
  /** The explicitly selected civil date; never infer it from a rolling duration. */
  localDate: DailyReportLocalDateSchema,
  timeZone: DailyReportTimeZoneSchema,
  /** Captured when the person explicitly asks to generate, not when a reminder is set. */
  requestedAt: z.iso.datetime({ offset: true }),
});

export const DailyReportIdentitySchema = z
  .strictObject({
    kind: z.literal('daily_report'),
    localDate: DailyReportLocalDateSchema,
    timeZone: DailyReportTimeZoneSchema,
    key: NonEmptyTextSchema,
  })
  .superRefine((identity, context) => {
    if (resolvedTimeZone(identity.timeZone) !== identity.timeZone) {
      context.addIssue({
        code: 'custom',
        path: ['timeZone'],
        message: 'A report identity must use the canonical IANA time zone.',
      });
    }
    if (identity.key !== dailyReportIdentityKey(identity.localDate, identity.timeZone)) {
      context.addIssue({
        code: 'custom',
        path: ['key'],
        message: 'The daily report key must match its date and timezone.',
      });
    }
  });

export type DailyReportContextRequest = z.infer<typeof DailyReportContextRequestSchema>;
export type DailyReportIdentity = z.infer<typeof DailyReportIdentitySchema>;
