import { StyleSheet } from 'react-native';

export const pageHeadingHorizontalInset = 20;

/** Native page title and leading/top gutters shared by the app's tab headers. */
export const pageHeadingStyles = StyleSheet.create({
  inset: { paddingHorizontal: pageHeadingHorizontalInset, paddingTop: 24 },
  title: { fontSize: 34, fontWeight: '700' },
});
