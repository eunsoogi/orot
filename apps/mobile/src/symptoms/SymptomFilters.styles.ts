import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  filterCard: {
    backgroundColor: 'white',
    borderRadius: 10,
    gap: 10,
    padding: 14,
  },
  sectionTitle: { color: '#17212b', fontSize: 15, fontWeight: '600' },
  hint: { color: '#45515f', fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  input: {
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  halfInput: { flex: 1 },
  choice: {
    alignItems: 'center',
    borderColor: '#a8b3bf',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  selectedChoice: { backgroundColor: '#e8f1f8', borderColor: '#1f5c85' },
});
