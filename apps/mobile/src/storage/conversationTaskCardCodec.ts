import { DailyReportIdentitySchema } from '@orot/domain';
import type { DailyReportIdentity } from '@orot/domain';
import { validConversationReportTarget } from './conversationReportTarget';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';

/** Only stable identifiers are retained; form inputs, prompts and model output stay in their owners. */
export type ConversationTaskCard =
  | {
      readonly kind: 'daily_report';
      readonly identity: DailyReportIdentity;
      readonly report?: NonNullable<ConversationEntryContext['dailyReport']>;
    }
  | {
      readonly kind: 'treatment';
      readonly artifactId: string;
      readonly artifactRevision?: string;
    };

export function parseTask(value: unknown): ConversationTaskCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'treatment')
    return ['artifactId,kind', 'artifactId,artifactRevision,kind'].includes(
      Object.keys(v).sort().join(','),
    ) &&
      typeof v.artifactId === 'string' &&
      v.artifactId.length > 0 &&
      v.artifactId.length <= 200 &&
      (v.artifactRevision === undefined ||
        (typeof v.artifactRevision === 'string' &&
          /^[0-9a-f]{1,16}$/u.test(v.artifactRevision)))
      ? (v as unknown as ConversationTaskCard)
      : null;
  if (
    v.kind !== 'daily_report' ||
    !['identity,kind', 'identity,kind,report'].includes(
      Object.keys(v).sort().join(','),
    )
  )
    return null;
  const identity = DailyReportIdentitySchema.safeParse(v.identity);
  if (
    !identity.success ||
    (v.report !== undefined &&
      (!validConversationReportTarget(v.report) ||
        (v.report as NonNullable<ConversationEntryContext['dailyReport']>)
          .identity.key !== identity.data.key))
  )
    return null;
  return v as unknown as ConversationTaskCard;
}
