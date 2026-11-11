import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { SavedTreatmentChoice } from './treatmentSavedLibrary';
import type { VerifiedTreatmentSource } from './treatmentSourceLinks';

export interface TreatmentActionResultState {
  readonly answer: string;
  readonly verified: boolean;
  readonly links?: readonly VerifiedTreatmentSource[];
  readonly general?: readonly string[];
}

/** Presentation callbacks preserve the session ownership of saved treatment artifacts. */
export interface TreatmentActionProps {
  readonly ownership: ConversationSessions['treatment'];
  readonly sessionId: number;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly initialSaved?: SavedTreatmentChoice;
  readonly onSavedItem?: (item: SavedTreatmentChoice) => void;
  readonly onDeletedItem?: (item: SavedTreatmentChoice) => void;
}
