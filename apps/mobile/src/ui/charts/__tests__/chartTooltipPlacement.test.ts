import {
  placeChartTooltip,
  visibleChartTooltipPane,
} from '../chartTooltipPlacement';

test('compact right rail and bottom bar bound the floating viewport; large text falls below without touching the plot', () => {
  const route = { x: 0, y: 20, width: 382, height: 630 };
  const host = { x: 0, y: -150, width: 382, height: 1000 };
  const plot = { x: 20, y: 60, width: 340, height: 160 };
  const anchor = { x: 358, y: 100 };
  const pane = visibleChartTooltipPane(
    route,
    host,
    anchor,
    undefined,
    580,
    34,
  )!;
  expect(pane).toEqual({ x: 0, y: 20, width: 382, height: 560 });
  expect(placeChartTooltip(pane, plot, anchor, 340, 70)).toEqual({
    x: 34,
    y: 228,
  });
  expect(placeChartTooltip(pane, plot, anchor, 360, 400)).toBeUndefined();
});

test('wide Duo stays inside the owning pane instead of crossing an active seam or rail', () => {
  const route = { x: 0, y: 0, width: 867, height: 669 };
  const panes = [
    { x: 0, y: 0, width: 455, height: 635 },
    { x: 496, y: 0, width: 455, height: 635 },
  ];
  const host = { x: 0, y: -20, width: 867, height: 1000 };
  const plot = { x: 510, y: 240, width: 320, height: 180 };
  const anchor = { x: 820, y: 280 };
  const pane = visibleChartTooltipPane(
    route,
    host,
    anchor,
    panes,
    undefined,
    34,
  )!;
  expect(pane).toEqual({ x: 496, y: 0, width: 371, height: 635 });
  expect(placeChartTooltip(pane, plot, anchor, 240, 50)).toEqual({
    x: 619,
    y: 182,
  });
  expect(
    visibleChartTooltipPane(
      route,
      host,
      { x: 470, y: 280 },
      panes,
      undefined,
      34,
    ),
  ).toBeUndefined();
});
