import { StyleSheet } from 'react-native';

export const recordingLibraryStyles = StyleSheet.create({
  container: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#b9c3ce',
    paddingTop: 12,
  },
  title: { color: '#17212b', fontSize: 18, fontWeight: '700' },
  copy: { color: '#45515f', fontSize: 14, lineHeight: 20 },
  list: { gap: 8 },
  item: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#d2d9e0',
    paddingTop: 10,
  },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  detail: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#b9c3ce',
    paddingTop: 12,
  },
  confirmation: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#9f1d1d',
    borderRadius: 8,
    padding: 12,
  },
  confirmationTitle: { color: '#17212b', fontSize: 16, fontWeight: '700' },
  error: { color: '#9f1d1d', fontSize: 14 },
});
