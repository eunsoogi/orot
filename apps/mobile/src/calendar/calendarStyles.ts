import { StyleSheet } from 'react-native';

export const calendarStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  message: { color: '#45515f', fontSize: 15 },
  card: { backgroundColor: 'white', borderRadius: 10, gap: 8, padding: 14 },
  eventTitle: { color: '#17212b', fontSize: 17, fontWeight: '600' },
  warning: { color: '#8a4b08', fontSize: 15 },
  error: { color: '#a12b25', fontSize: 15 },
});
