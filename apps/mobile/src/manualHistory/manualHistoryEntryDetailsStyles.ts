import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Keep the standalone Memory reading layout separate from the editable History list detail. */
export const manualHistoryEntryDetailsStyles = StyleSheet.create({
  container: {
    backgroundColor: appColors.surface,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 16,
    paddingTop: 16,
  },
  reading: { gap: 12, minWidth: 0 },
  standardFacts: { gap: 16 },
  readingFacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
  },
  readingBody: { color: appColors.text, fontSize: 18, lineHeight: 29 },
  readingMetadata: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  readingVersion: { gap: 6, paddingVertical: 6 },
  standardActions: { gap: 16 },
  readingActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  // The existing scroll owner renders a quiet inline prompt, not a nested warning card.
  readingConfirmation: { flexBasis: '100%', gap: 8 },
  readingDestructive: { borderWidth: 0 },
  confirmationPrompt: { color: appColors.text, fontSize: 16, lineHeight: 24 },
  confirmationActions: { gap: 8 },
  sectionTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  entryTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  history: { gap: 8, paddingTop: 8 },
  version: {
    borderLeftColor: appColors.border,
    borderLeftWidth: 2,
    gap: 6,
    paddingLeft: 10,
  },
  confirmation: {
    backgroundColor: appColors.warningSurface,
    borderRadius: 8,
    gap: 8,
    padding: 12,
  },
});
