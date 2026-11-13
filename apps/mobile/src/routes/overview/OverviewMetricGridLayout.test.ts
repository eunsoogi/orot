import { resolveOverviewMetricGridLayout } from './overviewMetricLayout';

test.each([280, 348, 440, 600, 647])(
  'keeps one full-width card at %ipt measured content width',
  width => {
    expect(resolveOverviewMetricGridLayout(width, 4, 1)).toEqual({
      columns: 1,
      cardWidth: width,
    });
  },
);

test.each([
  [648, 1, 320],
  [808, 1.25, 400],
  [1288, 2, 640],
])(
  'fits two readable cards at %ipt and %f scale',
  (width, scale, cardWidth) => {
    expect(resolveOverviewMetricGridLayout(width - 1, 4, scale).columns).toBe(
      1,
    );
    expect(resolveOverviewMetricGridLayout(width, 4, scale)).toEqual({
      columns: 2,
      cardWidth,
    });
  },
);

test('uses available content rather than the device model or full window width', () => {
  expect(resolveOverviewMetricGridLayout(900, 2, 1)).toEqual({
    columns: 2,
    cardWidth: 446,
  });
  expect(resolveOverviewMetricGridLayout(440, 2, 1)).toEqual({
    columns: 1,
    cardWidth: 440,
  });
});

test('fills the grid before measurement and when only one metric is selected', () => {
  expect(resolveOverviewMetricGridLayout(0, 4, 1)).toEqual({
    columns: 1,
    cardWidth: '100%',
  });
  expect(resolveOverviewMetricGridLayout(900, 1, 1)).toEqual({
    columns: 1,
    cardWidth: 900,
  });
});
