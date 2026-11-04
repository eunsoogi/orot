import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { SavedSummaryHistory } from '../SavedSummaryHistory';
import type { DiseaseHypothesisAnalysis } from '../types';

test('explains why an older summary cannot be opened while preserving its history row', async () => {
  const history = {
    list: async () => [
      {
        id: 'old',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        inputLineage: 'unknown' as const,
      },
    ],
    read: jest.fn(async () => null),
  };
  await render(
    <SavedSummaryHistory
      expanded
      history={history}
      disabled={false}
      onRestore={jest.fn()}
    />,
  );
  expect(await screen.findByText(/원본은 보관되어 있어요/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Synthetic/ })).toBeDisabled();
  expect(history.read).not.toHaveBeenCalled();
});

test('distinguishes an unavailable cited source from a storage write failure', async () => {
  const history = {
    list: jest.fn(async () => []),
    read: jest.fn(async () => null),
    retrySave: jest.fn(async () => null),
  };
  await render(
    <SavedSummaryHistory
      history={history}
      current={{ status: 'source_unavailable' }}
      disabled={false}
      expanded={false}
      onRestore={jest.fn()}
    />,
  );
  expect(
    screen.getByText('근거를 다시 확인하지 못해 요약을 저장하지 못했어요.'),
  ).toBeTruthy();
  expect(
    screen.queryByText('요약을 기기에 저장하지 못했어요. 다시 저장해 주세요.'),
  ).toBeNull();
  expect(screen.getByRole('button', { name: '다시 저장' })).toBeTruthy();
});

test('reopens a saved result without generating another model response', async () => {
  const value: DiseaseHypothesisAnalysis = {
    presentation: 'symptom_summary',
    hypotheses: [],
  };
  const history = {
    list: jest.fn(async () => [
      {
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
      },
    ]),
    read: jest.fn(async () => value),
  };
  const restore = jest.fn();
  await render(
    <SavedSummaryHistory
      expanded
      history={history}
      disabled={false}
      onRestore={restore}
    />,
  );
  await fireEvent.press(await screen.findByText(/Synthetic/));
  expect(history.read).toHaveBeenCalledWith('saved');
  expect(restore).toHaveBeenCalledWith(value);
  expect(history.list).toHaveBeenCalledTimes(1);
});

test('ignores a pending read after leaving history', async () => {
  let finish!: (value: DiseaseHypothesisAnalysis) => void;
  const history = {
    list: async () => [
      {
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
      },
    ],
    read: jest.fn(
      () =>
        new Promise<DiseaseHypothesisAnalysis>(resolve => {
          finish = resolve;
        }),
    ),
  };
  const restore = jest.fn();
  const view = await render(
    <SavedSummaryHistory
      expanded
      history={history}
      disabled={false}
      onRestore={restore}
    />,
  );
  const row = await screen.findByRole('button', { name: /Synthetic/ });
  // Deliberately leave the read pending while exercising native Back's unmount boundary.
  await fireEvent.press(row);
  await view.unmount();
  await act(async () => {
    finish({ presentation: 'symptom_summary', hypotheses: [] });
  });
  expect(restore).not.toHaveBeenCalled();
});

test('keeps saved content available while explaining a known prescription interpretation error', async () => {
  const history = {
    list: jest.fn(async () => []),
    read: jest.fn(async () => null),
  };
  await render(
    <SavedSummaryHistory
      history={history}
      expanded={false}
      disabled={false}
      onRestore={jest.fn()}
      current={{
        status: 'saved',
        id: 'saved',
        createdAt: '2035-01-01T00:00:00Z',
        modelName: 'Synthetic',
        contentReviewIssues: ['prescription'],
      }}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    /일정 등록만으로 처방 여부/u,
  );
  expect(screen.getByTestId('symptom-summary-saved')).toHaveTextContent(
    /Synthetic/u,
  );
  expect(history.list).not.toHaveBeenCalled();
});
