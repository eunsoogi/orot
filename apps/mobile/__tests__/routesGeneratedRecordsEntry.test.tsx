import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { RoutesGeneratedRecordsApp } from '../e2e/routesGeneratedRecordsProbeEntry';
// Host component test: native random/polyfill setup is outside this mount-order contract.
jest.mock('../src/agent/polyfills', () => ({}));
const mockMounted = jest.fn();
jest.mock('../App', () => ({
  __esModule: true,
  default: () => {
    mockMounted();
    return null;
  },
}));
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../e2e/routesGeneratedRecordsFixture', () => ({
  seedRoutesGeneratedRecords: jest.fn(),
}));

beforeEach(() => mockMounted.mockClear());
test('production App cannot mount before the synthetic commit finishes', async () => {
  let release!: () => void;
  const prepare = jest.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  await render(<RoutesGeneratedRecordsApp prepareFixture={prepare} />);
  expect(
    screen.getByTestId('routes-generated-records-fixture-state'),
  ).toHaveTextContent('preparing');
  expect(mockMounted).not.toHaveBeenCalled();
  await act(async () => release());
  expect(mockMounted).toHaveBeenCalledTimes(1);
});
test('preparation failure leaves App closed and a late unmounted commit cannot mount it', async () => {
  const view = await render(
    <RoutesGeneratedRecordsApp
      prepareFixture={async () => {
        throw new Error('write failed');
      }}
    />,
  );
  expect(
    screen.getByTestId('routes-generated-records-fixture-state'),
  ).toHaveTextContent('failed');
  expect(mockMounted).not.toHaveBeenCalled();
  await view.unmount();
  let release!: () => void;
  const pending = await render(
    <RoutesGeneratedRecordsApp
      prepareFixture={() =>
        new Promise(resolve => {
          release = resolve;
        })
      }
    />,
  );
  await pending.unmount();
  await act(async () => release());
  expect(mockMounted).not.toHaveBeenCalled();
});
