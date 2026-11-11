import type { ReactNode } from 'react';
import type {
  DailyReportIdentity,
  DailyReportContextRequest,
} from '@orot/domain';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { createDailyReportFeature } from './dailyReportFeature';
import type { AiFeatureServices } from './featureServices';
import type { ConversationEntryContext } from './conversationIntent';

/** Boundaries for displaying and retaining a report within a conversation. */
export interface DailyReportRouteProps {
  readonly feature: ReturnType<typeof createDailyReportFeature>;
  readonly initialIdentity?: DailyReportIdentity;
  readonly initialOperation?: ReturnType<
    ReturnType<typeof createDailyReportFeature>['start']
  >;
  readonly reminder?: boolean;
  readonly providerSelection: ReactNode;
  readonly onBack: () => void;
  readonly onSelectToday?: (
    request: DailyReportContextRequest,
  ) => Promise<void>;
  readonly onChat: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  readonly resolveSources?: AiFeatureServices['dailyReportSources'];
  readonly onOpenSource?: (source: EvidenceReference) => void;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: import('./useAiFeatureNavigationState').AiFeatureNavigationStateChange;
  readonly ownsOperation?: boolean;
  readonly inline?: boolean;
  readonly expectedReport?: NonNullable<
    ConversationEntryContext['dailyReport']
  >;
  readonly onTaskIdentity?: (identity: DailyReportIdentity) => Promise<void>;
  readonly onTaskResult?: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => Promise<void>;
  readonly taskRevision?: number;
}
