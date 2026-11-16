import { KeychainProviderSelectionStore } from '../providers/selection/keychainSelectionStore';

/** Start unselected instead of silently inheriting a conversation processing destination. */
export const calendarModelStore = new KeychainProviderSelectionStore(
  'com.orot.mobile.calendar-classification-selection.v1',
);
