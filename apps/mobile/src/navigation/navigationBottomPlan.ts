import type { NavigationGlassAction } from './NavigationGlassSurface';

/** Keeps primary controls direct and moves only remaining controls into More. */
export function navigationBottomPlan({
  width,
  navigation,
  navigationWidths,
  pageWidths,
  moreWidth,
  primaryPageIndices = [],
}: {
  width: number;
  navigation: readonly NavigationGlassAction[];
  navigationWidths: readonly number[];
  pageWidths: readonly number[];
  moreWidth: number;
  primaryPageIndices?: readonly number[];
}) {
  const dimensions = [width, moreWidth, ...navigationWidths, ...pageWidths];
  if (
    navigationWidths.length !== navigation.length ||
    !dimensions.every(value => Number.isFinite(value) && value > 0) ||
    [...navigationWidths, ...pageWidths, moreWidth].some(value => value < 44)
  )
    return null;
  const root = navigation.some(action => action.rootTab);
  const rowWidth = Math.max(0, width - 16);
  // Root tabs previously divided the full bar equally. Keep that hit width
  // when fewer destinations share the bar with page controls or More.
  const baseline =
    root && navigation.length
      ? Math.max(
          0,
          (rowWidth - 32 - Math.max(0, navigation.length - 1) * 4) /
            navigation.length,
        )
      : 0;
  const allNavigation = navigation.map((_, index) => index);
  const allPages = pageWidths.map((_, index) => index);
  const geometry = (
    nav: readonly number[],
    pages: readonly number[],
    overflow: boolean,
  ) => {
    const navCount = nav.length + (root && overflow ? 1 : 0);
    const rootSlot = root
      ? Math.max(baseline, ...navigationWidths, overflow ? moreWidth : 0)
      : 0;
    const navWidth = root
      ? 32 + rootSlot * navCount + Math.max(0, navCount - 1) * 4
      : rowWidth;
    const pageCount = pages.length + (!root && overflow ? 1 : 0);
    const pageWidth = pageCount
      ? 4 +
        pageCount * 12 +
        pages.reduce((sum, index) => sum + pageWidths[index]!, 0) +
        (!root && overflow ? moreWidth : 0)
      : 0;
    const back = nav.find(index => navigation[index]?.id === 'back');
    const home = nav.find(index => navigation[index]?.id === 'home');
    const left = 16 + (back === undefined ? 0 : navigationWidths[back]!);
    const right = 16 + (home === undefined ? 0 : navigationWidths[home]!);
    const remaining = rowWidth - left - right - 8 - pageWidth;
    return {
      navWidth,
      pageWidth,
      pageLeft: left + 4 + Math.max(0, remaining) / 2,
      fits: root
        ? navWidth + (pageCount ? pageWidth + 8 : 0) <= rowWidth + 0.01
        : pageCount === 0
          ? left + right <= rowWidth
          : remaining >= 0,
    };
  };
  const full = geometry(allNavigation, allPages, false);
  if (full.fits)
    return {
      ...full,
      navigationIndices: allNavigation,
      pageIndices: allPages,
      overflowNavigation: [],
      overflowPages: [],
    };

  const selected = navigation.findIndex(
    action => action.rootTab && action.selected,
  );
  const back = navigation.findIndex(action => action.id === 'back');
  const requiredNavigation = root
    ? selected >= 0
      ? [selected]
      : allNavigation.slice(0, 1)
    : back >= 0
      ? [back]
      : [];
  const visibleNavigation = [...requiredNavigation];
  const visiblePages = [...new Set(primaryPageIndices)].filter(index =>
    allPages.includes(index),
  );
  if (!visiblePages.length && allPages.length) visiblePages.push(0);
  // On a root row, More can retain ordinary page actions when the selected tab
  // and a direct page action cannot both fit; explicit primary actions stay direct.
  if (
    root &&
    primaryPageIndices.length === 0 &&
    !geometry(visibleNavigation, visiblePages, true).fits
  )
    visiblePages.length = 0;
  if (!geometry(visibleNavigation, visiblePages, true).fits) return null;
  const candidates = [
    ...allNavigation
      .filter(
        index =>
          !requiredNavigation.includes(index) &&
          navigation[index]?.id === 'home',
      )
      .map(index => ({ kind: 'navigation' as const, index })),
    ...allPages
      .filter(index => !visiblePages.includes(index))
      .map(index => ({ kind: 'page' as const, index })),
    ...allNavigation
      .filter(
        index =>
          !requiredNavigation.includes(index) &&
          navigation[index]?.id !== 'home',
      )
      .map(index => ({ kind: 'navigation' as const, index })),
  ];
  for (const candidate of candidates) {
    const nav =
      candidate.kind === 'navigation'
        ? [...visibleNavigation, candidate.index]
        : visibleNavigation;
    const pages =
      candidate.kind === 'page'
        ? [...visiblePages, candidate.index]
        : visiblePages;
    if (geometry(nav, pages, true).fits) {
      if (candidate.kind === 'navigation')
        visibleNavigation.push(candidate.index);
      else visiblePages.push(candidate.index);
    }
  }
  visibleNavigation.sort((a, b) => a - b);
  visiblePages.sort((a, b) => a - b);
  return {
    ...geometry(visibleNavigation, visiblePages, true),
    navigationIndices: visibleNavigation,
    pageIndices: visiblePages,
    overflowNavigation: allNavigation.filter(
      index => !visibleNavigation.includes(index),
    ),
    overflowPages: allPages.filter(index => !visiblePages.includes(index)),
  };
}
