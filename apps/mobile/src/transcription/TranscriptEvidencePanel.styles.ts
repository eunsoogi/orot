import { StyleSheet } from 'react-native';

export const transcriptEvidenceStyles = StyleSheet.create({
  container: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#b9c3ce',
    paddingTop: 12,
  },
  title: { color: '#17212b', fontSize: 18, fontWeight: '700' },
  copy: { color: '#45515f', fontSize: 14, lineHeight: 20 },
  segments: { gap: 12, paddingBottom: 4 },
  segment: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#d2d9e0',
    paddingTop: 10,
  },
  actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  text: { color: '#17212b', fontSize: 16, lineHeight: 23 },
  metadata: { color: '#45515f', fontSize: 12 },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: '#8996a5',
    borderRadius: 8,
    padding: 8,
    color: '#17212b',
    textAlignVertical: 'top',
  },
  history: { color: '#596675', fontSize: 13, lineHeight: 19 },
  error: { color: '#9f1d1d', fontSize: 14 },
});
