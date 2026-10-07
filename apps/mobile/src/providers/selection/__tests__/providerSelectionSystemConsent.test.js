const {
  tapLoopbackConsentContinue,
} = require('../../../../e2e/providerSelectionSystemConsent');

describe('provider selection system consent helper', () => {
  it('taps the observed Continue button by position, regardless of system language', async () => {
    const tap = jest.fn().mockResolvedValue(undefined);
    const atIndex = jest.fn().mockReturnValue({ tap });
    const consentSheetButtons = { atIndex };
    const typeMatcher = jest.fn().mockReturnValue('system-button-matcher');
    const system = {
      element: jest.fn().mockReturnValue(consentSheetButtons),
    };
    const by = { system: { type: typeMatcher } };

    await tapLoopbackConsentContinue({ by, system });

    expect(typeMatcher).toHaveBeenCalledWith('button');
    expect(system.element).toHaveBeenCalledWith('system-button-matcher');
    expect(atIndex).toHaveBeenCalledWith(1);
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('propagates a missing or changed consent control instead of swallowing the failure', async () => {
    const failure = new Error('Consent Continue button was not available');
    const tap = jest.fn().mockRejectedValue(failure);
    const by = {
      system: { type: jest.fn().mockReturnValue('system-button-matcher') },
    };
    const system = {
      element: jest.fn().mockReturnValue({
        atIndex: jest.fn().mockReturnValue({ tap }),
      }),
    };

    await expect(tapLoopbackConsentContinue({ by, system })).rejects.toBe(
      failure,
    );
    expect(tap).toHaveBeenCalledTimes(1);
  });
});
