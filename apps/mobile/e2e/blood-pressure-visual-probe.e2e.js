/* global by, describe, device, element, it, waitFor */

const { tapNativeNavigationAction } = require('./smokeHelpers');

describe('Blood-pressure import completion on Release', () => {
  it('renders the real completion hierarchy with display-only result counts', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({ newInstance: false });
    await device.disableSynchronization();

    await waitFor(element(by.id('welcome-title')))
      .toHaveText('오롯')
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-tab-records');
    await waitFor(element(by.id('records-title')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('records-open-blood-pressure')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toHaveText('혈압 기록')
      .withTimeout(30000);

    await element(by.id('blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-result-saved-count')))
      .toHaveText('3개')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-result-deleted-count')))
      .toHaveText('1개')
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-status')))
      .toHaveText('가져오기가 끝났어요')
      .withTimeout(30000);

    // Counts come from a display-only callback; the Debug probe covers native fixture persistence.
    await device.takeScreenshot('blood-pressure-import-completion-release');
  });
});
