import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared layout for the visit record panel and its inline editor. */
export const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12 },
  // Overview owns the outer gutter; the embedded checklist shares one semantic surface.
  embeddedPanel: {
    backgroundColor: appColors.surface,
    borderRadius: 20,
    padding: 16,
    gap: 0,
  },
  embeddedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingBottom: 14,
  },
  embeddedIcon: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: appColors.primarySoft,
  },
  embeddedHeading: { flex: 1, minWidth: 0, gap: 4 },
  embeddedInstructions: {
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 21,
  },
  embeddedRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  embeddedQuestion: { fontSize: 16, lineHeight: 24 },
  trailingAction: { alignSelf: 'flex-end', maxWidth: '100%' },
  title: { fontSize: 18, fontWeight: '700' },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  confirmationButton: { alignSelf: 'flex-start' },
  // Keep enlarged Korean status labels inside the card instead of widening the row.
  confirmedStatus: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.primarySoft,
  },
  confirmedStatusText: {
    color: appColors.primaryText,
    fontWeight: '600',
    flexShrink: 1,
  },
  confirmationStatus: { color: appColors.secondary },
  editor: { gap: 8 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    padding: 10,
    color: appColors.text,
  },
});
