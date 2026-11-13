import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared layout for the visit record panel and its inline editor. */
export const styles = StyleSheet.create({
  panel: { padding: 20, gap: 12 },
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
