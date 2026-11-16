/** Display metadata only: submission is local; accepted/read require actual provider observations. */
export interface ConversationMessageDelivery {
  readonly submittedAt: string;
  readonly acceptedAt?: string;
  readonly readAt?: string;
}

/** Invalid optional metadata is omitted, never repaired with invented historical times. */
export function parseConversationMessageDelivery(
  value: unknown,
): ConversationMessageDelivery | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const v = value as Record<string, unknown>;
  const valid = (at: unknown): at is string =>
    typeof at === 'string' &&
    at.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) &&
    Number.isFinite(Date.parse(at));
  if (
    !valid(v.submittedAt) ||
    Object.keys(v).some(
      key => !['submittedAt', 'acceptedAt', 'readAt'].includes(key),
    ) ||
    (v.acceptedAt !== undefined && !valid(v.acceptedAt)) ||
    (v.readAt !== undefined && !valid(v.readAt)) ||
    (v.readAt !== undefined && v.acceptedAt === undefined)
  )
    return undefined;
  // Wall-clock changes are possible; never invent a monotonic civil-time ordering.
  return {
    submittedAt: v.submittedAt,
    ...(v.acceptedAt ? { acceptedAt: v.acceptedAt as string } : {}),
    ...(v.readAt ? { readAt: v.readAt as string } : {}),
  };
}

/** Retain the first observation per phase; duplicate and later accepted events cannot undo read. */
export function observeConversationDelivery(
  current: ConversationMessageDelivery,
  receipt: 'accepted' | 'response_started',
  at: string,
): ConversationMessageDelivery {
  return {
    ...current,
    acceptedAt: current.acceptedAt ?? at,
    ...(receipt === 'response_started' ? { readAt: current.readAt ?? at } : {}),
  };
}
