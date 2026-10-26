import { styles } from '../DiseaseHypothesesScreen.styles';
import { appColors, appColorPalettes } from '../../layout/appColors';

test('summary results and drafts use a filled surface distinct from the page canvas', () => {
  // An outline alone did not distinguish these cards from the light canvas.
  expect(styles.card.backgroundColor).toEqual(appColors.surface);
  expect(styles.draft.backgroundColor).toEqual(appColors.surface);
  for (const palette of Object.values(appColorPalettes)) {
    expect(palette.surface).not.toBe(palette.background);
  }
});
