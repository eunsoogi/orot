import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from 'react-native';
import {
  NavigationPrimaryActionContext,
  useNavigationPrimaryActionHost,
} from '../useNavigationPrimaryAction';
import { useNavigationRouteActions } from '../useNavigationRouteActions';

function Publisher({
  id,
  onPress,
}: {
  id: string;
  onPress: () => Promise<void> | void;
}) {
  useNavigationRouteActions([
    { id, label: id, accessibilityLabel: id, testID: id, onPress },
  ]);
  return null;
}

function Fixture({
  focused,
  second,
  onFirst,
  onSecond,
  observe,
}: {
  focused: boolean;
  second: boolean;
  onFirst: () => Promise<void> | void;
  onSecond: () => Promise<void> | void;
  observe?: (action: (() => void | Promise<unknown>) | undefined) => void;
}) {
  const { host, actions } = useNavigationPrimaryActionHost('route');
  observe?.(actions[0]?.onPress);
  return (
    <NavigationPrimaryActionContext.Provider value={focused ? host : null}>
      <Publisher id="first" onPress={onFirst} />
      {second ? <Publisher id="second" onPress={onSecond} /> : null}
      {actions.map(action => (
        <Button
          key={action.id}
          title={action.label}
          onPress={() => {
            action.onPress();
          }}
        />
      ))}
    </NavigationPrimaryActionContext.Provider>
  );
}

test('keeps independent actions and removes only the departing publisher', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = await render(
    <Fixture focused second onFirst={first} onSecond={second} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'first' }));
  await fireEvent.press(screen.getByRole('button', { name: 'second' }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  await view.rerender(
    <Fixture focused second={false} onFirst={first} onSecond={second} />,
  );
  expect(screen.queryByRole('button', { name: 'second' })).toBeNull();
  expect(screen.getByRole('button', { name: 'first' })).toBeTruthy();
  await view.rerender(
    <Fixture
      focused={false}
      second={false}
      onFirst={first}
      onSecond={second}
    />,
  );
  expect(screen.queryByRole('button', { name: 'first' })).toBeNull();
});

test('invalidates a captured callback when the route loses focus', async () => {
  const action = jest.fn();
  let captured: (() => void | Promise<unknown>) | undefined;
  const observe = (next: typeof captured) => {
    if (next) captured = next;
  };
  const view = await render(
    <Fixture
      focused
      second={false}
      onFirst={action}
      onSecond={jest.fn()}
      observe={observe}
    />,
  );
  expect(captured).toBeDefined();
  await view.rerender(
    <Fixture
      focused={false}
      second={false}
      onFirst={action}
      onSecond={jest.fn()}
      observe={observe}
    />,
  );
  captured?.();
  expect(action).not.toHaveBeenCalled();
});

test('ignores repeated invocation until the first asynchronous action settles', async () => {
  let finish: () => void = () => undefined;
  const action = jest.fn(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  await render(
    <Fixture focused second={false} onFirst={action} onSecond={jest.fn()} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'first' }));
  await fireEvent.press(screen.getByRole('button', { name: 'first' }));
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await fireEvent.press(screen.getByRole('button', { name: 'first' }));
  expect(action).toHaveBeenCalledTimes(2);
});

test('coalesces immediate void invocations without blocking an independent cancel action', async () => {
  const start = jest.fn();
  const cancel = jest.fn();
  let first: (() => void | Promise<unknown>) | undefined;
  const view = await render(
    <Fixture
      focused
      second
      onFirst={start}
      onSecond={cancel}
      observe={next => {
        if (next) first = next;
      }}
    />,
  );
  expect(first).toBeDefined();
  await act(async () => {
    first?.();
    first?.();
    expect(start).toHaveBeenCalledTimes(1);
  });
  await fireEvent.press(screen.getByRole('button', { name: 'second' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  await view.unmount();
});

test('cancelled generation may restart before an older promise settles without unlocking the new invocation', async () => {
  const finish: Array<() => void> = [];
  const generate = jest.fn(
    () => new Promise<void>(resolve => finish.push(resolve)),
  );
  let invoke: (() => void | Promise<unknown>) | undefined;
  function Generation({ running }: { running: boolean }) {
    useNavigationRouteActions(
      running
        ? []
        : [
            {
              id: 'generate',
              label: 'Generate',
              accessibilityLabel: 'Generate',
              testID: 'generate',
              onPress: generate,
            },
          ],
    );
    return null;
  }
  function Host({ running }: { running: boolean }) {
    const { host, actions } = useNavigationPrimaryActionHost('generation');
    invoke = actions[0]?.onPress;
    return (
      <NavigationPrimaryActionContext.Provider value={host}>
        <Generation running={running} />
      </NavigationPrimaryActionContext.Provider>
    );
  }
  const view = await render(<Host running={false} />);
  await act(async () => {
    invoke?.();
  });
  await view.rerender(<Host running />);
  await view.rerender(<Host running={false} />);
  await act(async () => {
    invoke?.();
  });
  expect(generate).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish[0]?.();
  });
  await act(async () => {
    invoke?.();
  });
  expect(generate).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish[1]?.();
  });
  await act(async () => {
    invoke?.();
  });
  expect(generate).toHaveBeenCalledTimes(3);
});
