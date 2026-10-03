import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  form: { backgroundColor: 'white', borderRadius: 10, gap: 10, padding: 14 },
  formTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  fieldLabel: { color: '#17212b', fontSize: 14, fontWeight: '500' },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  halfInput: { flex: 1 },
  description: { minHeight: 72, textAlignVertical: 'top' },
  choice: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  selectedChoice: { backgroundColor: '#e8f1f8', borderColor: '#1f5c85' },
  hint: { color: '#45515f', fontSize: 13 },
});
