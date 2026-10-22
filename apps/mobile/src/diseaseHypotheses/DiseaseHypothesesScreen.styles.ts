import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

/** Shared layout for factual summaries and separately selected disease reviews. */
export const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  results: { gap: 12 },
  // Filled surfaces preserve the card/canvas hierarchy in both system appearances.
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  draft: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  title: { fontSize: 17, fontWeight: '700' },
  label: { fontWeight: '700', marginTop: 4 },
  error: { color: appColors.danger },
  section: { gap: 4 },
});
