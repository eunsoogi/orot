import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SettingsSearchConsentChoices } from '../SettingsSearchConsentChoices';

it('keeps independent recipients off until separately selected, and never invents a local web provider', async () => {
  const onChange = jest.fn();
  const view = await render(
    <SettingsSearchConsentChoices
      value={{ web: false, medical: false }}
      onChange={onChange}
      disabled={false}
    />,
  );
  expect(view.queryByTestId('settings-consent-web')).toBeNull();
  expect(view.getByTestId('settings-consent-medical').props.value).toBe(false);
  await fireEvent(
    view.getByTestId('settings-consent-medical'),
    'valueChange',
    true,
  );
  expect(onChange).toHaveBeenCalledWith({ web: false, medical: true });
});

it('identifies web recipient separately and locks both controls during a save', async () => {
  const onChange = jest.fn();
  const view = await render(
    <SettingsSearchConsentChoices
      value={{ web: true, medical: false }}
      onChange={onChange}
      disabled
      webRecipient="Synthetic public search"
    />,
  );
  expect(
    view.getByTestId('settings-consent-web').props.accessibilityLabel,
  ).toContain('Synthetic public search');
  expect(
    view.getByTestId('settings-consent-medical').props.accessibilityLabel,
  ).toContain('Europe PMC');
  for (const id of ['settings-consent-web', 'settings-consent-medical']) {
    expect(view.getByTestId(id).props.disabled).toBe(true);
    await fireEvent(view.getByTestId(id), 'valueChange', true);
  }
  expect(onChange).not.toHaveBeenCalled();
});
