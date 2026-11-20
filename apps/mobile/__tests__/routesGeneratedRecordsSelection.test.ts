const mockRoutes = jest.fn();
const mockOrdinary = jest.fn();
jest.mock('../e2e/routesGeneratedRecordsProbeEntry', () => {
  mockRoutes();
  return {};
});
jest.mock('../e2e/aiFeatureVisitQuestionsProbeEntry', () => {
  mockOrdinary();
  return {};
});

test('only the exact Routes opt-in selects synthetic stored records; ordinary visit launch remains unchanged', () => {
  for (const enabled of [false, true]) {
    jest.isolateModules(() => {
      const {
        registerCapabilityTestEntry,
      } = require('../e2e/capabilityTestEntry');
      expect(
        registerCapabilityTestEntry('ai-feature-visit-questions', {
          OROT_TEST_SCENARIO: 'ai-feature-visit-questions',
          ...(enabled ? { OROT_ROUTES_GENERATED_RECORDS: 'synthetic' } : {}),
        }),
      ).toBe(true);
    });
  }
  expect(mockOrdinary).toHaveBeenCalledTimes(1);
  expect(mockRoutes).toHaveBeenCalledTimes(1);
  jest.isolateModules(() => {
    const {
      registerCapabilityTestEntry,
    } = require('../e2e/capabilityTestEntry');
    expect(
      registerCapabilityTestEntry('core', {
        OROT_TEST_SCENARIO: 'ai-feature-visit-questions',
        OROT_ROUTES_GENERATED_RECORDS: 'synthetic',
      }),
    ).toBe(false);
  });
  expect(mockRoutes).toHaveBeenCalledTimes(1);
});
