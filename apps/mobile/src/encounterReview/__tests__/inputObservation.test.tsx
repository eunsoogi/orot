import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { CandidatePanel } from '../CandidatePanel';
import { pending } from '../__fixtures__/pending';

const run = 'a17ce200-1234-4321-abcd-123456789012';
const privateText = 'private-health-text-😀';

function panel(text: string, edit: (field: string, value: string) => void) {
  return (
    <CandidatePanel
      candidate={{ ...pending.candidates[0], text }}
      pending={pending}
      selected
      onToggle={() => {}}
      onEdit={edit}
    />
  );
}

afterEach(() => {
  delete NativeModules.OrotEncounterInputObservation;
});

test.each([undefined, { run: 'invalid-private-id', record: jest.fn() }])(
  'missing or invalid native gate preserves controlled edits without observations',
  async module => {
    NativeModules.OrotEncounterInputObservation = module;
    const edit = jest.fn();
    const view = await render(panel(privateText, edit));
    await fireEvent.changeText(
      screen.getByTestId('encounter-text-candidate-0'),
      '',
    );
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledWith('text', '');
    expect(screen.getByTestId('encounter-text-candidate-0')).toHaveProp(
      'value',
      privateText,
    );
    await view.rerender(panel('', edit));
    expect(screen.getByTestId('encounter-text-candidate-0')).toHaveProp(
      'value',
      '',
    );
    if (module) expect(module.record).not.toHaveBeenCalled();
  },
);

test('callback precedes original edit and commits export only UTF-16 lengths and increasing ordinals', async () => {
  const order: string[] = [];
  const record = jest.fn((event: string) => order.push(event));
  NativeModules.OrotEncounterInputObservation = { run, record };
  const edit = jest.fn(() => order.push('edit'));
  const view = await render(panel(privateText, edit));
  await fireEvent.changeText(
    screen.getByTestId('encounter-text-candidate-0'),
    '',
  );
  await view.rerender(panel('', edit));
  await view.rerender(panel('', edit));
  expect(order).toEqual([
    'controlledCommit',
    'changeText',
    'edit',
    'controlledCommit',
  ]);
  const calls = record.mock.calls as unknown as [string, number, number][];
  expect(calls.map(([event, , length]) => [event, length])).toEqual([
    ['controlledCommit', privateText.length],
    ['changeText', 0],
    ['controlledCommit', 0],
  ]);
  expect(
    calls.every(
      ([, sequence], index) => index === 0 || sequence > calls[index - 1][1],
    ),
  ).toBe(true);
  expect(JSON.stringify(calls)).not.toContain(privateText);
  expect(JSON.stringify(calls)).not.toContain(pending.sourceId);
  expect(JSON.stringify(calls)).not.toContain('candidate-0');
  expect(edit).toHaveBeenCalledTimes(1);
});

test('throwing observation cannot mask the edit or its original error', async () => {
  NativeModules.OrotEncounterInputObservation = {
    run,
    record: () => {
      throw new Error(privateText);
    },
  };
  const failure = new Error('original callback');
  const edit = jest.fn(() => {
    throw failure;
  });
  await render(panel(privateText, edit));
  await expect(
    fireEvent.changeText(screen.getByTestId('encounter-text-candidate-0'), ''),
  ).rejects.toBe(failure);
  expect(edit).toHaveBeenCalledTimes(1);
});
