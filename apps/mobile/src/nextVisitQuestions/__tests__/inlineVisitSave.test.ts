import {
  createInlineVisitReview,
  inlineReviewToggle,
} from '../inlineVisitReview';
import { createInlineVisitSave } from '../inlineVisitSave';
import { questions } from '../testSupport/fixtures';

test('zero selection does not save and an in-flight commit cannot be misreported as cancelled', async () => {
  let finish!: (value: {
    questions: typeof questions;
    caveats: [];
    memoryStatus: 'saved';
  }) => void;
  const persist = jest.fn(
    () =>
      new Promise<{
        questions: typeof questions;
        caveats: [];
        memoryStatus: 'saved';
      }>(resolve => {
        finish = resolve;
      }),
  );
  let current = true;
  const save = createInlineVisitSave(
    'session-a:turn-a',
    persist,
    () => current,
  );
  const empty = createInlineVisitReview(
    'session-a:turn-a',
    [],
    [questions[0]!],
    [],
    () => 'new-question',
  );
  expect(await save(empty)).toEqual({ status: 'no_selection' });
  expect(persist).not.toHaveBeenCalled();
  const review = inlineReviewToggle(empty, 'new-question');
  const abort = new AbortController();
  const pending = save(review, abort.signal);
  expect(await save(review)).toEqual({ status: 'busy' });
  abort.abort();
  current = false;
  finish({ questions, caveats: [], memoryStatus: 'saved' });
  expect(await pending).toMatchObject({
    status: 'committed',
    ownerKey: 'session-a:turn-a',
    deliverToOwner: false,
  });
  expect(persist).toHaveBeenCalledTimes(1);
});
