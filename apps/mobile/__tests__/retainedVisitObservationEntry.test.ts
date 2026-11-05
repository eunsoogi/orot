const mockRetained = jest.fn();
const mockProduction = jest.fn();
jest.mock('../e2e/nextVisitQuestionsProbeEntry', () => {
  mockRetained();
  return {};
});
jest.mock('../e2e/aiFeatureVisitQuestionsProbeEntry', () => {
  mockProduction();
  return {};
});

test('the visit scenario uses the retained editor only for the explicit observation flag', () => {
  jest.isolateModules(() => {
    const {
      registerCapabilityTestEntry,
    } = require('../e2e/capabilityTestEntry');
    expect(registerCapabilityTestEntry('ai-feature-visit-questions', {})).toBe(
      true,
    );
  });
  expect(mockProduction).toHaveBeenCalledTimes(1);
  expect(mockRetained).not.toHaveBeenCalled();
  jest.isolateModules(() => {
    const {
      registerCapabilityTestEntry,
    } = require('../e2e/capabilityTestEntry');
    expect(
      registerCapabilityTestEntry('ai-feature-visit-questions', {
        OROT_TEST_RETAINED_VISIT_OBSERVATION: 'YES',
      }),
    ).toBe(true);
  });
  expect(mockRetained).toHaveBeenCalledTimes(1);
  jest.isolateModules(() => {
    const {
      registerCapabilityTestEntry,
    } = require('../e2e/capabilityTestEntry');
    expect(
      registerCapabilityTestEntry('core', {
        OROT_TEST_RETAINED_VISIT_OBSERVATION: 'YES',
      }),
    ).toBe(false);
  });
  expect(mockRetained).toHaveBeenCalledTimes(1);
});
