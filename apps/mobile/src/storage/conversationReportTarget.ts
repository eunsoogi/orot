import { DailyReportIdentitySchema } from '@orot/domain';

/** Only the selected identity and revision may cross the encrypted artifact boundary. */
export function validConversationReportTarget(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    Object.keys(report).sort().join(',') === 'identity,revision,runId' &&
    DailyReportIdentitySchema.safeParse(report.identity).success &&
    typeof report.runId === 'string' &&
    report.runId.trim().length > 0 &&
    Number.isSafeInteger(report.revision) &&
    Number(report.revision) > 0
  );
}
