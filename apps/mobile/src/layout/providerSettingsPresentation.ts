import { StyleSheet } from 'react-native';
import { appColors } from './appColors';
import { COMPACT_APP_SYMBOL_POINT_SIZE } from './iconSizing';

export const providerCatalogContentInset = 16;
const catalogActionTargetSize = 44;

/** Filled grouping replaces decorative borders; option symbols still convey selection without color. */
export const providerSettingsStyles = StyleSheet.create({
  section: { gap: 12, marginTop: 22 },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.text,
    paddingHorizontal: 4,
  },
  account: {
    gap: 8,
    padding: 6,
    borderRadius: 20,
    borderWidth: 0,
    backgroundColor: appColors.surface,
  },
  // Catalog children own their 16pt inset; do not double-pad nested models.
  catalogAccount: {
    gap: 8,
    borderRadius: 20,
    backgroundColor: appColors.surface,
  },
  catalogContent: { gap: 8, padding: providerCatalogContentInset },
  // Match the model selection symbol's center without shrinking the touch target.
  // Keep the lane in the header so opening account details cannot move it.
  catalogActionLane: {
    width: catalogActionTargetSize,
    marginRight: (COMPACT_APP_SYMBOL_POINT_SIZE - catalogActionTargetSize) / 2,
    justifyContent: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: appColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '600', color: appColors.text },
  secondary: { fontSize: 13, color: appColors.secondary },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  action: {
    width: catalogActionTargetSize,
    height: catalogActionTargetSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 82,
    padding: providerCatalogContentInset,
    borderWidth: 0,
    borderRadius: 20,
    backgroundColor: appColors.surface,
  },
  detail: { color: appColors.secondary, fontSize: 14 },
});
