import { act, render, screen } from '@testing-library/react-native';
import { SavedConversationAnswerDetail } from '../SavedConversationAnswerDetail';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';

jest.mock('../openSavedGeneratedReportReferences', () => ({
  openSavedGeneratedReportReferences: jest.fn(),
}));

test('opens one original under the current Memory detail owner', async () => {
  const read = jest.fn(async () => 'Synthetic protected original.');
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue({
    readSavedConversationAnswer: read,
  } as never);
  await render(
    <SavedConversationAnswerDetail
      artifactId="synthetic-answer"
      isReadCurrent={() => true}
    />,
  );
  expect(await screen.findByText('Synthetic protected original.')).toBeTruthy();
  expect(read).toHaveBeenCalledWith('synthetic-answer', expect.any(Function));
});

test('does not display an answer whose detail owner retired while loading', async () => {
  let owned = true;
  let resolve!: (answer: string) => void;
  const read = jest.fn(
    () =>
      new Promise<string>(finish => {
        resolve = finish;
      }),
  );
  jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue({
    readSavedConversationAnswer: read,
  } as never);
  await act(async () => {
    render(
      <SavedConversationAnswerDetail
        artifactId="synthetic-answer"
        isReadCurrent={() => owned}
      />,
    );
  });
  owned = false;
  await act(async () => resolve('Late synthetic answer.'));
  expect(screen.queryByText('Late synthetic answer.')).toBeNull();
});
