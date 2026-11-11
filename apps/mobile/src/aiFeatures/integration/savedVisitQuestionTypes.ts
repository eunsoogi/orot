import type { EvidenceItem } from '@orot/agent-runtime';
import type { SavedQuestionReadFailureReason } from '../../nextVisitQuestions/savedQuestionRecovery';

export interface RestoredVisitQuestion {
  readonly identity: { readonly id: string; readonly expectedRevision: string };
  readonly kind?: 'confirmed_fact' | 'clarification';
  readonly legacySource?: { readonly id: string; readonly revision: string };
  readonly questionText: string;
  readonly rationale: string;
  readonly priority: 'routine' | 'important';
  readonly position: number;
  readonly citations: readonly EvidenceItem[];
  readonly generatedArtifactContext?: readonly EvidenceItem[];
}

export interface RestoredSavedVisitQuestions {
  readonly appointmentId: string;
  readonly questions: readonly RestoredVisitQuestion[];
  readonly caveats: readonly [];
  /** Explains which source locations and generated metadata are absent from persisted questions. */
  readonly restorationNotice: string;
}

export type SavedVisitQuestionsLoadState =
  | ({ readonly status: 'ready' } & RestoredSavedVisitQuestions)
  | {
      readonly status: 'error';
      readonly appointmentId: string;
      readonly questions: readonly [];
      readonly message: string;
      /** Closed reason code lets callers offer recovery without exposing stored text. */
      readonly failureReason: SavedQuestionReadFailureReason;
    };
