import { NAVIGATION_MINIMUM_COLUMN_WIDTH } from '../../navigation/navigationRootLayout';
import { resolveAdaptiveColumns } from '../adaptiveColumnsPlan';

const clearInsets = { top: 0, right: 0, bottom: 0, left: 0 };

test('uses the minimum panel width, gap, and text scale to select columns', () => {
  const base = {
    windowWidth: NAVIGATION_MINIMUM_COLUMN_WIDTH * 2 + 24,
    fontScale: 1,
    systemInsets: clearInsets,
    viewportInsets: clearInsets,
    hasSecondary: true,
  };

  expect(resolveAdaptiveColumns({ ...base, windowWidth: 663 }).columns).toBe(1);
  expect(resolveAdaptiveColumns(base).columns).toBe(2);
  expect(
    resolveAdaptiveColumns({ ...base, windowWidth: 983, fontScale: 1.5 })
      .columns,
  ).toBe(1);
});

test('subtracts safe edges and the right rail once when no parent measurement exists', () => {
  const plan = resolveAdaptiveColumns({
    windowWidth: 1000,
    fontScale: 1,
    systemInsets: { ...clearInsets, left: 10, right: 20 },
    viewportInsets: { ...clearInsets, right: 80 },
    hasSecondary: true,
  });

  expect(plan).toMatchObject({
    columns: 2,
    contentWidth: 910,
    primaryWidth: 443,
    secondaryWidth: 443,
  });
});

test('pairs native regions and clips the rail from measured content only once', () => {
  const plan = resolveAdaptiveColumns({
    windowWidth: 1000,
    measuredWidth: 940,
    fontScale: 1,
    systemInsets: clearInsets,
    viewportInsets: { ...clearInsets, right: 60 },
    safeAreaFrame: { x: 0, y: 0, width: 1000, height: 800 },
    usableRegions: [
      { x: 0, y: 0, width: 500, height: 800 },
      { x: 500, y: 0, width: 500, height: 800 },
    ],
    hasNativeDivision: true,
    hasSecondary: true,
  });

  expect(plan).toMatchObject({
    columns: 2,
    primaryWidth: 488,
    secondaryWidth: 428,
    columnGap: 24,
  });
});

test('falls back to one native region when two readable panels do not fit', () => {
  const plan = resolveAdaptiveColumns({
    windowWidth: 900,
    fontScale: 1.5,
    systemInsets: clearInsets,
    viewportInsets: clearInsets,
    usableRegions: [
      { x: 0, y: 0, width: 450, height: 800 },
      { x: 450, y: 0, width: 450, height: 800 },
    ],
    hasNativeDivision: true,
    hasSecondary: true,
  });

  expect(plan).toMatchObject({
    columns: 1,
    primaryWidth: 450,
    secondaryWidth: 450,
  });
});

test('keeps a single route panel within its measured parent until a second panel exists', () => {
  const plan = resolveAdaptiveColumns({
    windowWidth: 1000,
    fontScale: 1,
    systemInsets: clearInsets,
    viewportInsets: { ...clearInsets, right: 80 },
    usableRegions: [
      { x: 0, y: 0, width: 500, height: 800 },
      { x: 500, y: 0, width: 500, height: 800 },
    ],
    hasNativeDivision: true,
    hasSecondary: false,
  });

  expect(plan).toMatchObject({
    columns: 1,
    contentWidth: 920,
    primaryWidth: 920,
  });
});
