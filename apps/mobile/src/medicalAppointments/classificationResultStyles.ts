import { StyleSheet } from 'react-native';
import { appColors } from '../layout/appColors';
import { classificationEdgeTarget } from './ClassificationEdgeAction';
import { classificationResultRowBottomInset } from './useClassificationResultGroupTop';

export const classificationResultMaxWidth = 520;

export const classificationResultStyles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, width: '100%' },
  list: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    maxWidth: classificationResultMaxWidth,
    alignSelf: 'center',
  },
  sideList: { position: 'absolute', right: 0 },
  hidden: { opacity: 0 },
  viewport: { flex: 1, minHeight: 0 },
  rows: { paddingBottom: classificationResultRowBottomInset },
  compactHeader: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    maxWidth: classificationResultMaxWidth,
    width: '100%',
  },
  compactAction: {
    width: classificationEdgeTarget,
    height: classificationEdgeTarget,
  },
  result: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  time: { fontSize: 13, lineHeight: 17, color: appColors.secondary },
});
