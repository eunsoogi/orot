import { waitFor } from '@testing-library/react-native';
import { classifyCalendarEvents } from '../../src/medicalAppointments/classificationWorkflow';
import {
  input,
  makeProvider,
} from '../../src/medicalAppointments/classificationWorkflowTestFixtures';
import {
  classificationStageEvents,
  createClassificationStageScenario,
} from '../classificationStageScenario';

it('holds real batch responses at 0/9, 8/9 and 9/9 before the synthetic save gate', async () => {
  const phases: ('model' | 'save' | null)[] = [];
  const scenario = createClassificationStageScenario(phase =>
    phases.push(phase),
  );
  const events = classificationStageEvents();
  const progress: number[] = [];
  const provider = makeProvider(jest.fn(scenario.generate));
  const options = input(events, {
    provider,
    onProgress: result =>
      progress.push(
        result.candidates.filter(candidate => candidate.status === 'classified')
          .length,
      ),
  });
  const run = classifyCalendarEvents(options);
  await waitFor(() => expect(phases).toEqual(['model']));
  expect(progress).toEqual([]);
  scenario.release();
  await waitFor(() => expect(phases).toEqual(['model', null, 'model']));
  expect(progress).toEqual([8]);
  scenario.release();
  const result = await run;
  expect(result.status).toBe('complete');
  expect(progress).toEqual([8, 9]);
  expect(
    result.candidates.every(
      candidate =>
        candidate.classification === 'medical' &&
        candidate.uncertainty === 'low',
    ),
  ).toBe(true);
  expect(provider.generate).toHaveBeenCalledTimes(2);
  expect(options.consent.authorize).toHaveBeenCalledTimes(2);
  let saved = false;
  const save = scenario.waitForSave().then(() => {
    saved = true;
  });
  expect(phases.at(-1)).toBe('save');
  expect(saved).toBe(false);
  scenario.release();
  await save;
  await scenario.waitForSave();
  expect(saved).toBe(true);
  scenario.dispose();
});

it.each(['abort', 'dispose'] as const)(
  'does not classify a response released after %s',
  async cancellation => {
    const waiting = jest.fn();
    const scenario = createClassificationStageScenario(waiting);
    const controller = new AbortController();
    const options = input(classificationStageEvents(), {
      provider: makeProvider(scenario.generate),
      signal: controller.signal,
    });
    const run = classifyCalendarEvents(options);
    await waitFor(() => expect(waiting).toHaveBeenCalledWith('model'));
    if (cancellation === 'abort') controller.abort();
    else scenario.dispose();
    scenario.release();
    const result = await run;
    expect(
      result.candidates.every(candidate => candidate.status === 'unclassified'),
    ).toBe(true);
    expect(result.completedBatches).toBe(0);
    scenario.dispose();
  },
);

it('replays setup after disposal without reviving a released old model response', async () => {
  const scenario = createClassificationStageScenario(jest.fn());
  const request = { messages: [] };
  const old = scenario.generate(request);
  scenario.release();
  scenario.dispose();
  scenario.activate();
  expect((await old).ok).toBe(false);
  const save = scenario.waitForSave();
  scenario.release();
  await expect(save).resolves.toBeUndefined();
  scenario.dispose();
});

it('does not complete a released save after teardown and a new activation', async () => {
  const scenario = createClassificationStageScenario(jest.fn());
  const old = scenario.waitForSave();
  scenario.release();
  scenario.dispose();
  scenario.activate();
  await expect(old).rejects.toThrow('Synthetic save cancelled');
  const fresh = scenario.waitForSave();
  scenario.release();
  await expect(fresh).resolves.toBeUndefined();
  scenario.dispose();
  await expect(scenario.waitForSave()).rejects.toThrow();
});
