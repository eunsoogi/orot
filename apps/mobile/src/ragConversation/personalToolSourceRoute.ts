import type {
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import { beginSourceOpenTiming } from '../providers/sourceOpenDiagnostic';
import { createContext } from 'react';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';

export type PersonalSourceLease = {
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
) {
  return {
    sessionId,
    ...(source.sourceKind === 'personal_record' && { durableMessageId }),
    operationRunId: event.operationRunId,
    callId: event.callId,
  };
}
