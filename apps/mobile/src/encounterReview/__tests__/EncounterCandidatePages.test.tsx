import { fireEvent, render, screen } from '@testing-library/react-native';
import type { EncounterPending } from '@orot/agent-runtime';
import { EncounterCandidatePages } from '../EncounterCandidatePages';
import type { EncounterReviewController } from '../controller';

test('pages the complete local review without silently selecting off-screen rows', async () => {
  const candidates = Array.from({ length: 33 }, (_, i) => ({
    id: 'candidate-' + i,
    kind: 'plan' as const,
    speaker: 'unknown' as const,
    text: 'Synthetic plan ' + i,
    evidence: [],
  }));
  const pending: EncounterPending = {
    sourceId: 'synthetic',
    threadId: 'synthetic-review',
    segments: [],
    candidates,
    conflicts: [],
  };
  const toggle = jest.fn();
  const controller = { toggle } as unknown as EncounterReviewController;
  const renderPage = (selected: string[]) => (
    <EncounterCandidatePages
      pending={pending}
      state={{ status: 'pending', pending, candidates, selected }}
      controller={controller}
      disabled={false}
    />
  );
  const view = await render(renderPage([]));
  expect(screen.getByTestId('encounter-candidate-0')).toBeTruthy();
  expect(screen.queryByTestId('encounter-candidate-12')).toBeNull();
  await fireEvent.press(screen.getByTestId('encounter-candidates-next'));
  expect(screen.queryByTestId('encounter-candidate-0')).toBeNull();
  expect(screen.getByTestId('encounter-candidate-12')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('encounter-candidates-next'));
  expect(screen.getByTestId('encounter-candidate-32')).toBeTruthy();
  expect(screen.queryByTestId('encounter-candidates-next')).toBeNull();
  await fireEvent.press(screen.getByTestId('encounter-select-candidate-32'));
  expect(toggle).toHaveBeenCalledWith('candidate-32');
  await view.rerender(renderPage(['candidate-32']));
  expect(screen.getByTestId('encounter-select-candidate-32')).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: true }),
  );
});
