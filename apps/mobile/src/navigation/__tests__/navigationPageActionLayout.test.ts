import {
  pageActionRailLayout,
  splitPageActions,
} from '../navigationPageActionLayout';

test('places page actions above a centered root group without consuming the content lane', () => {
  const layout = pageActionRailLayout({
    height: 678,
    top: 30,
    bottom: 30,
    rootTabs: true,
    navigationCount: 5,
    actionCount: 2,
  });
  const rootTop = 30 + (618 - 276) / 2;
  expect(layout.fits).toBe(true);
  expect(678 - layout.pageBottomInset).toBeLessThan(rootTop);
  expect(layout.capacity).toBe(2);
});

test('reserves room above contextual navigation and falls back when no page action fits', () => {
  const input = {
    height: 400,
    top: 20,
    bottom: 20,
    rootTabs: false,
    navigationCount: 2,
    actionCount: 2,
  };
  const layout = pageActionRailLayout(input);
  expect(layout.navigationTopInset).toBeGreaterThan(
    400 - layout.pageBottomInset,
  );
  expect(layout.fits).toBe(true);
  expect(pageActionRailLayout({ ...input, height: 150 }).fits).toBe(false);
});

test('reserves a reachable overflow slot while preserving action order', () => {
  expect(splitPageActions(['add', 'save', 'cancel'], 2)).toEqual({
    visible: ['add'],
    overflow: ['save', 'cancel'],
  });
  expect(splitPageActions(['add', 'save'], 1)).toEqual({
    visible: [],
    overflow: ['add', 'save'],
  });
});
