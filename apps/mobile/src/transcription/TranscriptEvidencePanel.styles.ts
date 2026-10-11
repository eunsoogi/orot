import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';

// Dynamic palette tokens keep transcript copy readable when system appearance changes.
export const transcriptEvidenceStyles = StyleSheet.create({
  container: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
    paddingTop: 12,
  },
  title: { color: appColors.text, fontSize: 18, fontWeight: '700' },
  copy: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  segments: { gap: 12, paddingBottom: 4 },
  segment: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingTop: 10,
  },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  text: { color: appColors.text, fontSize: 16, lineHeight: 23 },
  metadata: { color: appColors.secondary, fontSize: 12 },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: appColors.border,
    borderRadius: 8,
    padding: 8,
    color: appColors.text,
    textAlignVertical: 'top',
  },
  history: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  error: { color: appColors.danger, fontSize: 14 },
});
