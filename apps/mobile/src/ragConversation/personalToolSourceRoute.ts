import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { beginSourceOpenTiming } from '../providers/sourceOpenDiagnostic';
import { createContext } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ToolCallScope } from '../aiFeatures/integration/toolReferenceIndex';

export type ResolveConversationToolSource = (
  reference: ToolSourceReference,
  signal: AbortSignal,
  scope: ToolCallScope & { readonly durableMessageId?: string },
) => Promise<EvidenceReference | undefined>;

export type PreparedPersonalSource = {
  readonly reference: EvidenceReference;
  readonly read: (
    signal: AbortSignal,
  ) => Promise<
    import('../aiFeatures/integration/evidenceSourceDocument').EvidenceSourceReadResult
  >;
};

type PreparePersonalSource = (
  source: Parameters<ResolveConversationToolSource>[0],
) => PreparedPersonalSource | undefined;

// Only the canonical feature-services registry can prepare the warm locator.
export const preparePersonalSourceByResolver = new WeakMap<
  ResolveConversationToolSource,
  PreparePersonalSource
>();

export type PersonalSourceLease = {
  readonly prepare?: () => PreparedPersonalSource | undefined;
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly retire: () => void;
  readonly admit: () => ReturnType<ResolveConversationToolSource>;
};

type Capture = (
  source: Parameters<ResolveConversationToolSource>[0],
  scope: Parameters<ResolveConversationToolSource>[2],
) => PersonalSourceLease | undefined;

// Only the store-bound resolver issues an admission capability; raw aliases do not.
export const personalSourceCaptures = new WeakMap<
  ResolveConversationToolSource,
  Capture
>();

export const PersonalToolSourceRoute = createContext<
  ((lease: PersonalSourceLease) => boolean) | null
>(null);

export function tryOpenPersonalSource(
  open: React.ContextType<typeof PersonalToolSourceRoute>,
  resolver: ResolveConversationToolSource,
  source: Parameters<ResolveConversationToolSource>[0],
  scope: Parameters<ResolveConversationToolSource>[2],
) {
  const capture = personalSourceCaptures.get(resolver);
  if (source.sourceKind !== 'personal_record' || !open || !capture)
    return false;
  const lease = capture(source, scope);
  if (!lease) return true;
  const timing = beginSourceOpenTiming(lease.signal, 'source_open_local_tap');
  if (
    !open({
      ...lease,
      async admit() {
        const reference = await lease.admit();
        if (reference) timing?.mark('source_open_local_admission');
        return reference;
      },
    })
  )
    lease.retire();
  return true;
}

export function toolSourceScope(
  sessionId: string,
  durableMessageId: string,
  event: Pick<ConversationToolEvent, 'operationRunId' | 'callId'>,
  source: ToolSourceReference,
  resolver: ResolveConversationToolSource,
) {
  // Only the store-bound live resolver consumes a durable row locator.
  return {
    sessionId,
    ...(source.sourceKind === 'personal_record' &&
      personalSourceCaptures.has(resolver) && { durableMessageId }),
    operationRunId: event.operationRunId,
    callId: event.callId,
  };
}
