import { act, render, fireEvent, screen } from '@testing-library/react-native';
import { SavedSummaryHistory } from '../SavedSummaryHistory';
import type { DiseaseHypothesisAnalysis } from '../types';

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
