import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, Text, TextInput } from 'react-native';
import { useState } from 'react';
import { NavigationInlineTransition } from '../NavigationInlineTransition';
import { NavigationMotionContext } from '../NavigationMotionContext';

function Form() {
  const [draft, setDraft] = useState('initial input');
  return <TextInput testID="draft" value={draft} onChangeText={setDraft} />;
}
function content(key: string, label: string, reduced = false) {
  return (
    <NavigationMotionContext.Provider value={reduced}>
      <NavigationInlineTransition transitionKey={key}>
        <Text>{label}</Text>
        <Form />
      </NavigationInlineTransition>
    </NavigationMotionContext.Provider>
  );
}
afterEach(() => jest.restoreAllMocks());

test('replaces revoked content immediately without retaining outgoing children or remounting drafts', async () => {
  const stop = jest.fn();
  const animate = jest
    .spyOn(Animated, 'timing')
    .mockReturnValue({ start: jest.fn(), stop, reset: jest.fn() });
  const view = await render(content('form', 'Current source'));
  expect(animate).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByTestId('draft'), 'unsaved input');
  await view.rerender(content('sources', 'Allowed sources'));
  expect(screen.queryByText('Current source')).toBeNull();
  expect(screen.getByText('Allowed sources')).toBeVisible();
  expect(screen.getByTestId('draft').props.value).toBe('unsaved input');
  expect(screen.getByTestId('navigation-inline-transition')).toHaveStyle({
    opacity: 1,
  });
  await view.rerender(content('sources', 'Source revoked'));
  expect(screen.queryByText('Allowed sources')).toBeNull();
  expect(animate).toHaveBeenCalledTimes(1);
  await view.rerender(content('saved', 'Saved choices', true));
  expect(stop).toHaveBeenCalled();
  expect(animate).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Saved choices')).toBeVisible();
  await act(async () => view.unmount());
});
