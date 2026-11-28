import { pageHeadingStyles } from './pageHeadingPresentation';

const { paddingHorizontal: horizontal, paddingTop: top } =
  pageHeadingStyles.inset;
export const settingsPageStyles = { inset: pageHeadingStyles.inset };

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
