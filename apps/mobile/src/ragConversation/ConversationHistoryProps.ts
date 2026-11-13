import type { ReactNode } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { DisplayMessage } from './ConversationMessage';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import type { ConversationActivitySnapshot } from './conversationActivity';
import type { ConversationSession } from './conversationSessionTypes';

/** Inputs shared by the transcript, activity indicator, and retained reply focus. */
export interface ConversationHistoryProps {
  readonly messages: readonly DisplayMessage[];
  readonly pendingMessage: ConversationSession['pendingMessage'];
  readonly error: string;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly bottomInset?: number;
  readonly header?: ReactNode;
  readonly beforeMessages?: ReactNode;
  readonly footer?: ReactNode;
  readonly compact?: boolean;
  readonly unsavedCount?: number;
  readonly retryingSave?: boolean;
  readonly onRetrySave?: () => void;
  readonly restoreFailed?: boolean;
  readonly onRetryRestore?: () => void;
  readonly toolSourceSessionId?: string | null;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly renderVisitQuestions?: (message: DisplayMessage) => ReactNode;
  readonly replyFocus?: { messageId: string; done(): void };
  readonly requestSessionId?: number;
  readonly requestActivity?: ConversationActivitySnapshot | null;
}
