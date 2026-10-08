import type { Appointment } from '@orot/domain';
import type { TextStyle } from 'react-native';
import type { ProviderSelection } from '../providers/selection/types';

/** A UI projection of an evidence link; the opaque citation remains intact for save and open callbacks. */
export interface NextVisitEvidenceReference {
  readonly sourceKind:
    'personal_record' | 'reviewed_memory' | 'external_medical';
  readonly sourceId: string;
  readonly effectiveTime: string | null;
  readonly reviewState: 'reviewed' | 'unreviewed' | 'unknown';
  readonly content: string;
}

/** The screen edits only question copy and priority; citation data is retained unchanged. */
export interface NextVisitQuestion<
  TReference extends NextVisitEvidenceReference = NextVisitEvidenceReference,
> {
  readonly questionText: string;
  readonly rationale: string;
  readonly priority: 'routine' | 'important';
  readonly citations: readonly TReference[];
}

export type NextVisitQuestionUpdate<
  TReference extends NextVisitEvidenceReference = NextVisitEvidenceReference,
> = Partial<
  Pick<NextVisitQuestion<TReference>, 'questionText' | 'rationale' | 'priority'>
>;

/** Colors and sizes are supplied by the shared design system at the app boundary. */
export interface NextVisitQuestionsTheme {
  readonly colors: {
    readonly canvas: string;
    readonly surface: string;
    readonly surfaceSubtle: string;
    readonly text: string;
    readonly textMuted: string;
    readonly border: string;
    readonly accent: string;
    readonly onAccent: string;
    readonly accentSubtle: string;
    readonly accentText: string;
    readonly warning: string;
    readonly warningSurface: string;
    readonly danger: string;
    readonly dangerSurface: string;
  };
  readonly tokens: {
    readonly spacing: {
      readonly xs: number;
      readonly sm: number;
      readonly md: number;
      readonly lg: number;
      readonly xl: number;
      readonly xxl: number;
    };
    readonly radii: { readonly control: number; readonly card: number };
    readonly typography: {
      readonly sizes: {
        readonly caption: number;
        readonly body: number;
        readonly heading: number;
        readonly title: number;
      };
      readonly weights: {
        readonly regular: NonNullable<TextStyle['fontWeight']>;
        readonly medium: NonNullable<TextStyle['fontWeight']>;
        readonly semibold: NonNullable<TextStyle['fontWeight']>;
        readonly bold: NonNullable<TextStyle['fontWeight']>;
      };
    };
    readonly minTouchTarget: number;
  };
}

export type AppointmentViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'error'; readonly message?: string }
  | { readonly status: 'ready'; readonly appointment: Appointment };

export type ProviderViewState =
  | { readonly status: 'loading'; readonly selection: null }
  | { readonly status: 'unselected'; readonly selection: null }
  | {
      readonly status: 'error';
      readonly selection: null;
      readonly message?: string;
    }
  | {
      readonly status: 'available';
      readonly selection: ProviderSelection;
      readonly displayName: string;
      readonly privacyBoundary: 'on-device' | 'selected-context-remote';
    }
  | {
      readonly status: 'unavailable';
      readonly selection: ProviderSelection;
      readonly displayName: string;
      readonly privacyBoundary: 'on-device' | 'selected-context-remote';
      readonly message: string;
    };

/** Ready questions carry their warnings through reload so uncertainty stays visible. */
export type SavedQuestionsState<TReference extends NextVisitEvidenceReference> =
  | { readonly status: 'loading'; readonly questions: readonly [] }
  | {
      readonly status: 'ready';
      readonly questions: readonly NextVisitQuestion<TReference>[];
      readonly caveats: readonly EvidenceCaveat[];
    }
  | {
      readonly status: 'error';
      readonly questions: readonly [];
      readonly message?: string;
    };

export type EvidenceCaveat =
  | 'incomplete_coverage'
  | 'truncated_results'
  | 'conflicting_records'
  | 'insufficient_evidence'
  | 'reviewed_memory_unavailable'
  | 'no_matching_reviewed_memory';

export type QuestionGenerationPhase =
  'idle' | 'generating' | 'reviewing' | 'saving' | 'saved' | 'error';

export type GenerationOutcome<TReference extends NextVisitEvidenceReference> =
  | {
      readonly status: 'ready';
      readonly questions: readonly NextVisitQuestion<TReference>[];
      readonly caveats: readonly EvidenceCaveat[];
    }
  | {
      readonly status:
        | 'needs_clarification'
        | 'refresh_required'
        | 'provider_unavailable'
        | 'consent_required'
        | 'unavailable';
      readonly message: string;
      readonly caveats?: readonly EvidenceCaveat[];
    }
  | { readonly status: 'cancelled' };

export interface SaveReviewedQuestionsResult<
  TReference extends NextVisitEvidenceReference,
> {
  readonly questions: readonly NextVisitQuestion<TReference>[];
  readonly caveats: readonly EvidenceCaveat[];
  readonly memoryStatus: 'saved' | 'retry_required';
}

export interface NextVisitQuestionsScreenProps<
  TReference extends NextVisitEvidenceReference,
> {
  readonly theme: NextVisitQuestionsTheme;
  readonly appointment: AppointmentViewState;
  readonly provider: ProviderViewState;
  readonly savedQuestions: SavedQuestionsState<TReference>;
  readonly onOpenProviderSelection: () => void;
  readonly onRefreshAppointment: () => void;
  readonly onRetrySavedQuestions: () => void;
  readonly onGenerate: (
    appointment: Appointment,
    selection: ProviderSelection,
    signal: AbortSignal,
  ) => Promise<GenerationOutcome<TReference>>;
  /** The adapter must retain these warnings beside questions because question records do not store them. */
  readonly onSaveReviewedQuestions: (
    appointment: Appointment,
    questions: readonly NextVisitQuestion<TReference>[],
    caveats: readonly EvidenceCaveat[],
  ) => Promise<SaveReviewedQuestionsResult<TReference>>;
  readonly onOpenSource?: (reference: TReference) => void;
}
