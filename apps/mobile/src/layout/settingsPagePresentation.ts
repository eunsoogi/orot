import { StyleSheet } from 'react-native';

const horizontal = 20;
const top = 24;

export const settingsPageStyles = StyleSheet.create({
  inset: { paddingHorizontal: horizontal, paddingTop: top },
  title: { fontSize: 34, fontWeight: '700' },
});

/** Direct scroll owners add the same page gutter to the shell clearance.
 * Nested scroll owners get that clearance on their parent instead. */
export function settingsPageInsets(
  inset: {
    paddingTop?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingBottom: number;
  },
  pageHorizontal = horizontal,
) {
  return {
    paddingTop: top + (inset.paddingTop ?? 0),
    paddingLeft: pageHorizontal + (inset.paddingLeft ?? 0),
    paddingRight: pageHorizontal + (inset.paddingRight ?? 0),
    paddingBottom: inset.paddingBottom,
  };
}
