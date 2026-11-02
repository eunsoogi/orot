import { StyleSheet } from 'react-native';
import { hubSpacing } from '../layout/hubSpacing';
import { appColors } from '../layout/appColors';

/** Defines restrained cards, semantic body colors, and the scalable conversation layout. */
export const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: hubSpacing.item,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
    paddingBottom: hubSpacing.bottom,
    backgroundColor: appColors.background,
  },
  embedded: { alignSelf: 'stretch', gap: hubSpacing.item },
  panel: { minWidth: 0, gap: hubSpacing.item },
  headingGroup: { gap: 8 },
  heading: {
    color: appColors.text,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
  section: { gap: 12 },
  separatedSection: {
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: hubSpacing.item,
  },
  sectionHeading: {
    color: appColors.secondary,
    fontSize: 18,
    fontWeight: '600',
  },
  list: { gap: hubSpacing.item },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    minHeight: 80,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  conversationRow: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 8,
    minHeight: 104,
  },
  conversationContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  copy: { flex: 1, gap: 4, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  description: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
  conversationAction: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  conversationActionText: {
    color: appColors.primaryText,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
  },
  unavailable: { color: appColors.danger, padding: 14 },
  disclaimer: {
    flex: 1,
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
