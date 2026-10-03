import { StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 20,
    backgroundColor: '#f7f8fa',
    minHeight: '100%',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  message: { color: '#45515f', fontSize: 15 },
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  clinic: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-start', gap: 16 },
  form: { backgroundColor: 'white', borderRadius: 10, gap: 10, padding: 14 },
  formTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  input: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  note: { minHeight: 48 },
  hint: { color: '#45515f', fontSize: 13 },
});

export default styles;
