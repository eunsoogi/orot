/* global by, device, element */

describe('Orot mobile app', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  it('launches and renders the welcome screen', async () => {
    await expect(element(by.id('welcome-title'))).toBeVisible();
    await expect(element(by.id('get-started'))).toBeVisible();
  });
});
