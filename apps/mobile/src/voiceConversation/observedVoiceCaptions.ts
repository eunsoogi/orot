import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import {
  apiCredentialMutation,
  voiceSelectionMutation,
} from '../voiceSettings/voiceConsentIdentity';

export function captureObservedVoiceCloseAuthority() {
  const credential = apiCredentialMutation.capture();
  const selection = voiceSelectionMutation.capture();
  const consent = consentRevision();
  return () =>
    credential?.() === true &&
    selection?.() === true &&
    canReuseConsent() &&
    consentRevision() === consent;
}

/** Bounded local display data. Transport fragments never become finalized turns. */
export type ObservedVoiceCaptions = Readonly<{
  callId: string;
  status: 'observed_incomplete';
  lines: readonly Readonly<{
    order: number;
    role: 'user' | 'assistant';
    text: string;
  }>[];
}>;

export function parseObservedVoiceCaptions(
  input: unknown,
  callId: string,
): ObservedVoiceCaptions | undefined {
  if (
    !/^live-\d{1,16}-\d{1,16}$/u.test(callId) ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    return;
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'callId,lines,status' ||
    value.callId !== callId ||
    value.status !== 'observed_incomplete' ||
    !Array.isArray(value.lines) ||
    value.lines.length === 0 ||
    value.lines.length > 48
  )
    return;
  const lines: Array<ObservedVoiceCaptions['lines'][number]> = [];
  let order = -1;
  let size = 0;
  for (const line of value.lines as unknown[]) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return;
    const item = line as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(',') !== 'order,role,text' ||
      typeof item.order !== 'number' ||
      !Number.isSafeInteger(item.order) ||
      item.order < 0 ||
      item.order <= order ||
      (item.role !== 'user' && item.role !== 'assistant') ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > 2000
    )
      return;
    order = item.order;
    size += item.text.length;
    if (size > 8000) return;
    lines.push({ order, role: item.role, text: item.text });
  }
  const result = { callId, status: 'observed_incomplete' as const, lines };
  // Escape-heavy content cannot exceed the SQL sidecar's serialized budget either.
  return JSON.stringify(result).length <= 24_000 ? result : undefined;
}

/** Distinct native graceful-close shape. Earlier native versions still return the
 * duration receipt alone. Caption corruption cannot erase a valid receipt. */
export function splitLiveVoiceClose(value: unknown, expectedCallId: string) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined;
  const close = value as Record<string, unknown>;
  if (
    Object.keys(close).length !== 3 ||
    close.kind !== 'live_observed_close' ||
    typeof close.duration !== 'object' ||
    close.duration === null
  )
    return undefined;
  return {
    duration: close.duration,
    captions: parseObservedVoiceCaptions(close.captions, expectedCallId),
  };
}
