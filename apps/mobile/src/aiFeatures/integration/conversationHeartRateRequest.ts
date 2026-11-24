import { TimestampSchema } from '@orot/domain';
import { localQueryTimestampKey } from '@orot/storage';
import type { EvidenceSearchRequest } from '@orot/agent-runtime';

export const conversationHeartRateCategories = [
  'ordinary_average',
  'resting_heart_rate',
  'walking_heart_rate_average',
  'workout_heart_rate',
] as const;
type Category = (typeof conversationHeartRateCategories)[number];

export interface ConversationHeartRateRequest {
  readonly category: Category;
  readonly fromInclusive: string;
  readonly toExclusive: string;
}

/** This extension accepts an exact period and one explicit category, never a broad search or raw workout ID. */
export function parseConversationHeartRateRequest(
  value: unknown,
): ConversationHeartRateRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const { category, fromInclusive, toExclusive } = v;
  if (
    Object.keys(v).some(
      key => !['category', 'fromInclusive', 'toExclusive'].includes(key),
    ) ||
    !conversationHeartRateCategories.includes(category as Category) ||
    typeof fromInclusive !== 'string' ||
    typeof toExclusive !== 'string' ||
    !TimestampSchema.safeParse(fromInclusive).success ||
    !TimestampSchema.safeParse(toExclusive).success
  )
    return;
  try {
    if (
      localQueryTimestampKey(fromInclusive) >=
      localQueryTimestampKey(toExclusive)
    )
      return;
  } catch {
    return;
  }
  return { category: category as Category, fromInclusive, toExclusive };
}

/** Result scope is tied to the originating text Conversation; arguments cannot enlarge its host grant. */
export function admitConversationHeartRateRequest(
  request: EvidenceSearchRequest,
  owner: {
    readonly operationRunId: string;
    readonly signal: AbortSignal;
    readonly scope: ConversationHeartRateRequest;
  },
): ConversationHeartRateRequest | undefined {
  const parsed = parseConversationHeartRateRequest(request.input);
  if (
    !parsed ||
    owner.scope.category !== parsed.category ||
    localQueryTimestampKey(owner.scope.fromInclusive) !==
      localQueryTimestampKey(parsed.fromInclusive) ||
    localQueryTimestampKey(owner.scope.toExclusive) !==
      localQueryTimestampKey(parsed.toExclusive) ||
    request.operationRunId !== owner.operationRunId ||
    owner.signal.aborted ||
    request.signal.aborted ||
    !request.allowedScope.sourceKinds.includes('personal_record') ||
    // Aggregate membership cannot be narrowed after reading values.
    request.allowedScope.sourceIds ||
    request.allowedScope.timeRange
  )
    return;
  return parsed;
}
