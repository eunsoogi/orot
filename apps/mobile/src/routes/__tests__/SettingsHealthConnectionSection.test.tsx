import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { healthKit } from '../../healthkit';
import { t } from '../../i18n';
import { SettingsHealthConnectionSection } from '../SettingsHealthConnectionSection';

test('retains the device capability on OS return without asking for HealthKit access', async () => {
  const read = jest.spyOn(healthKit, 'getAvailability').mockResolvedValue({
    status: 'available',
  });
  let receive: Parameters<typeof AppState.addEventListener>[1] | undefined;
  const app = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      receive = listener;
      return { remove: jest.fn() };
    });
  try {
    const view = await render(<SettingsHealthConnectionSection />);
    const label = t('settings.healthData.connectionAvailable');
    expect(await screen.findByText(label)).toBeTruthy();
    await act(async () => {
      for (const phase of ['inactive', 'background', 'active'] as const)
        receive?.(phase);
    });
    expect(screen.getByText(label)).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
    await view.unmount();
  } finally {
    app.mockRestore();
    read.mockRestore();
  }
});
