import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ProviderSelectionProbe } from '../providerSelectionProbe';

jest.mock(
  '../../src/providers/selection/ProviderSelectionFlow',
  () => (props: object) => {
    const R = require('react');
    const { View } = require('react-native');
    return R.createElement(View, { ...props, testID: 'synthetic-flow' });
  },
);
jest.mock(
  '../../src/providers/selection/ProviderSelectionScreen',
  () => (props: object) => {
    const R = require('react');
    const { View } = require('react-native');
    return R.createElement(View, { ...props, testID: 'synthetic-catalog' });
  },
);
jest.mock('../../src/providers/selection/keychainSelectionStore', () => ({
  providerSelectionStore: {},
}));
jest.mock('../providerSelectionSignOutFixture', () => ({}));

// Component wiring proves fixture ownership, not native scrolling or hit geometry.
test('bounds synthetic controls independently without changing the catalog screen', async () => {
  const view = await render(<ProviderSelectionProbe />);
  const controls = view.getByTestId('provider-selection-fixture-controls');
  expect(StyleSheet.flatten(controls.props.style)).toMatchObject({
    flexGrow: 0,
    maxHeight: '50%',
  });
  expect(view.getByTestId('synthetic-catalog')).toBeTruthy();
  expect(view.getByTestId('provider-selection-probe-reset')).toBeTruthy();
});

test('the revealed missing-scope control still opens the synthetic account flow', async () => {
  const view = await render(<ProviderSelectionProbe />);
  await fireEvent.press(
    view.getByTestId('provider-selection-account-missing-scope'),
  );
  expect(view.queryByTestId('provider-selection-fixture-controls')).toBeNull();
  const flow = view.getByTestId('synthetic-flow');
  const accounts = await flow.props.chatGPTServices.listAccounts();
  expect(accounts).toEqual([
    {
      issuedClientID: 'synthetic-missing-scope-account',
      requiresSignIn: false,
      hasDirectPlanAccess: false,
    },
  ]);
  await fireEvent(flow, 'back');
  expect(view.getByTestId('provider-selection-fixture-controls')).toBeTruthy();
});
