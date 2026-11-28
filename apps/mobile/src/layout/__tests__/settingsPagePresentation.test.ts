import {
  settingsPageInsets,
  settingsPageStyles,
} from '../settingsPagePresentation';

test('uses the same title gutter before adding each shell reservation', () => {
  const inner = settingsPageStyles.inset;
  expect(settingsPageInsets({ paddingBottom: 12 })).toEqual({
    paddingTop: inner.paddingTop,
    paddingLeft: inner.paddingHorizontal,
    paddingRight: inner.paddingHorizontal,
    paddingBottom: 12,
  });
  expect(
    settingsPageInsets({
      paddingTop: 56,
      paddingLeft: 12,
      paddingRight: 84,
      paddingBottom: 28,
    }),
  ).toEqual({
    paddingTop: inner.paddingTop + 56,
    paddingLeft: inner.paddingHorizontal + 12,
    paddingRight: inner.paddingHorizontal + 84,
    paddingBottom: 28,
  });
});
