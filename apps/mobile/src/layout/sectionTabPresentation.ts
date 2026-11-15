import { StyleSheet } from 'react-native';
import { appColors } from './appColors';

/** Records and settings share the same segmented control geometry and contrast. */
export const sectionTabStyles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.background,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
  },
  selectedTab: { backgroundColor: appColors.text },
  label: {
    color: appColors.secondary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  selectedLabel: { color: appColors.background },
});
