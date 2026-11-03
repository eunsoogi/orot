import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SymptomsRoute } from './SymptomsRoute';
import { symptomRouteDatabase } from './symptomRouteTestDatabase';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('real route creates, edits, and resolves one stored symptom with update metadata', async () => {
  const fixture = await symptomRouteDatabase();
  try {
    await render(
      <SymptomsRoute
        loadSymptoms={async () => fixture.journal}
        onBack={jest.fn()}
      />,
    );
    await screen.findByTestId('symptoms-empty');
    await fireEvent.press(screen.getByTestId('symptom-add'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      '합성 두통',
    );
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    await fireEvent.press(screen.getByTestId('symptom-save'));
    expect(
      await screen.findByTestId('symptom-synthetic-1-description'),
    ).toHaveTextContent('합성 두통');
    expect(await fixture.storage.getLastUpdatedAt?.('synthetic-1')).toBe(
      '2026-11-03T10:00:00.000Z',
    );
    await fireEvent.press(screen.getByTestId('symptom-select-synthetic-1'));
    await fireEvent.press(screen.getByTestId('symptom-edit-synthetic-1'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      '수정된 두통',
    );
    await fireEvent.press(screen.getByTestId('symptom-save'));
    expect(
      await screen.findByTestId('symptom-synthetic-1-description'),
    ).toHaveTextContent('수정된 두통');
    await fireEvent.press(screen.getByTestId('symptom-resolve-synthetic-1'));
    await waitFor(() =>
      expect(
        screen.getByTestId('symptom-synthetic-1-status'),
      ).toHaveTextContent('나아졌어요'),
    );
    expect(await fixture.storage.list()).toHaveLength(1);
    expect(await fixture.storage.get('synthetic-1')).toMatchObject({
      description: '수정된 두통',
      status: 'resolved',
    });
  } finally {
    fixture.close();
  }
});

test('failed transaction retains the draft, retries once, and discarded edits leave the row intact', async () => {
  const fixture = await symptomRouteDatabase();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await render(
      <SymptomsRoute
        loadSymptoms={async () => fixture.journal}
        onBack={jest.fn()}
      />,
    );
    await screen.findByTestId('symptoms-empty');
    await fireEvent.press(screen.getByTestId('symptom-add'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      '보존할 증상',
    );
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    fixture.failNextWrite();
    await fireEvent.press(screen.getByTestId('symptom-save'));
    expect(await screen.findByTestId('symptom-form-error')).toBeTruthy();
    expect(screen.getByTestId('symptom-description')).toHaveProp(
      'value',
      '보존할 증상',
    );
    expect(await fixture.storage.list()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('symptom-save'));
    expect(
      await screen.findByTestId('symptom-synthetic-2-description'),
    ).toHaveTextContent('보존할 증상');
    expect(await fixture.storage.list()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('symptom-select-synthetic-2'));
    await fireEvent.press(screen.getByTestId('symptom-edit-synthetic-2'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      '버릴 수정',
    );
    await fireEvent.press(screen.getByTestId('symptom-form-cancel'));
    expect(screen.getByTestId('symptom-description')).toHaveProp(
      'value',
      '버릴 수정',
    );
    await act(() => alert.mock.calls[0][2]?.[1]?.onPress?.());
    expect(
      await screen.findByTestId('symptom-synthetic-2-description'),
    ).toHaveTextContent('보존할 증상');
    expect((await fixture.storage.get('synthetic-2'))?.description).toBe(
      '보존할 증상',
    );
  } finally {
    alert.mockRestore();
    fixture.close();
  }
});

test('repeated save while a write is pending leaves exactly one row', async () => {
  const fixture = await symptomRouteDatabase();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const journal = {
    ...fixture.journal,
    create: async (...args: Parameters<typeof fixture.journal.create>) => {
      await gate;
      return fixture.journal.create(...args);
    },
  };
  try {
    await render(
      <SymptomsRoute loadSymptoms={async () => journal} onBack={jest.fn()} />,
    );
    await screen.findByTestId('symptoms-empty');
    await fireEvent.press(screen.getByTestId('symptom-add'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      '한 번 저장',
    );
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    await fireEvent.press(screen.getByTestId('symptom-save'));
    expect(screen.getByTestId('symptom-save')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('symptom-save'));
    await act(async () => {
      release();
      await gate;
    });
    expect(
      await screen.findByTestId('symptom-synthetic-1-description'),
    ).toHaveTextContent('한 번 저장');
    expect(await fixture.storage.list()).toHaveLength(1);
  } finally {
    fixture.close();
  }
});

test('a late filtered read cannot replace the newer filter results', async () => {
  const fixture = await symptomRouteDatabase();
  await fixture.journal.create({
    onsetAt: '2026-11-03T09:00:00Z',
    description: '활성 증상',
    status: 'active',
  });
  await fixture.journal.create({
    onsetAt: '2026-11-03T09:00:00Z',
    description: '해결된 증상',
    status: 'resolved',
    resolvedAt: '2026-11-03T09:30:00Z',
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const journal = {
    ...fixture.journal,
    list: async (...args: Parameters<typeof fixture.journal.list>) => {
      const rows = await fixture.journal.list(...args);
      if (args[0]?.status === 'active') await gate;
      return rows;
    },
  };
  try {
    await render(
      <SymptomsRoute loadSymptoms={async () => journal} onBack={jest.fn()} />,
    );
    await screen.findByTestId('symptom-synthetic-1-description');
    await fireEvent.press(screen.getByTestId('symptom-filter-active'));
    await fireEvent.press(screen.getByTestId('symptom-filter-resolved'));
    expect(
      await screen.findByTestId('symptom-synthetic-2-description'),
    ).toHaveTextContent('해결된 증상');
    await act(async () => {
      release();
      await gate;
    });
    expect(screen.queryByTestId('symptom-synthetic-1-description')).toBeNull();
    expect(screen.getByTestId('symptom-synthetic-2-description')).toBeTruthy();
  } finally {
    fixture.close();
  }
});
