import type {
  ChatGPTAccountSetup,
  ProviderSelectionOption,
} from '../providers/selection/types';

/** Presentation inputs remain independent from the context-owned storage services. */
export type CalendarModelSettingsPanelProps = {
  readonly options: readonly ProviderSelectionOption[];
  readonly chatGPTSetup?: ChatGPTAccountSetup;
  readonly onStateChange?: (
    state: { hasPendingSelection: boolean; isSavingSelection: boolean },
    inputChanged?: boolean,
  ) => void;
  readonly onBusyChange: (busy: boolean) => void;
};
