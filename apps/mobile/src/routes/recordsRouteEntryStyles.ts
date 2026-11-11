import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';
import { hubSpacing } from '../layout/hubSpacing';

export const styles = StyleSheet.create({
  container: {
    gap: hubSpacing.item,
    minWidth: 0,
  },
  title: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 22 },
  captureActions: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: hubSpacing.item,
  },
  stackedActions: { flexDirection: 'column' },
  captureAction: {
    alignItems: 'flex-start',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: hubSpacing.item,
    paddingVertical: hubSpacing.item,
  },
  captureIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    flexShrink: 0,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  // Match the neighboring Records rows while letting scaled labels wrap and grow.
  captureContent: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 12,
  },
  captureActionTitle: {
    color: appColors.text,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
    lineHeight: 21,
    minWidth: 0,
  },
  materials: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  materialsTitle: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: appColors.text,
    fontSize: 21,
    fontWeight: '700',
    paddingBottom: 10,
  },
  materialRows: { minWidth: 0 },
  materialRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    minWidth: 0,
    paddingVertical: 9,
  },
  rowDivider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  materialIcon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardCopy: { flex: 1, gap: 3, minWidth: 0 },
  cardTitle: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  cardSummary: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
});
