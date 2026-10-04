import { StyleSheet } from 'react-native';

export const recordingControlStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  back: { alignSelf: 'flex-start' },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  copy: { color: '#45515f', fontSize: 16, lineHeight: 22 },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { color: '#17212b', fontSize: 22 },
  status: { color: '#17212b', fontSize: 18, fontWeight: '700' },
  duration: { color: '#45515f', fontSize: 16 },
  result: { gap: 8 },
  error: { color: '#9f1d1d', fontSize: 15 },
  probe: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
