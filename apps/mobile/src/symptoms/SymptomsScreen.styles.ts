import { Platform, StyleSheet } from 'react-native';

export default StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  container: {
    gap: 12,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 64 : 20,
    backgroundColor: '#f7f8fa',
    minHeight: '100%',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  sectionTitle: { color: '#17212b', fontSize: 15, fontWeight: '600' },
  message: { color: '#45515f', fontSize: 15 },
  hint: { color: '#45515f', fontSize: 13 },
});
