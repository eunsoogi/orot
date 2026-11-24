/** Keep real checkpoint reads while mocking only the expensive route chart. */
export function snapshotMock() {
  return {
    loadSelectedOverviewSnapshot: async (...args: unknown[]) => {
      const { openLocalStorage } = jest.requireMock(
        '../../storage/secureDatabase',
      );
      const { loadOverviewMetricSelection } = jest.requireActual(
        '../overview/metricSelection',
      );
      const { loadOverviewMetrics } = jest.requireMock(
        '../overview/metricLoader',
      );
      const selection = await loadOverviewMetricSelection(
        await openLocalStorage(),
      );
      return { selection, chart: await loadOverviewMetrics(...args) };
    },
  };
}
