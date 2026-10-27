import {
  sqliteReviewFixture,
  sourceId,
  consent,
} from '../__fixtures__/sqliteReview';
import { runEncounterReviewFixture } from '../nativeFixture';
import {
  createNativeReviewDiagnostics,
  readNativeReviewReport,
} from '../nativeDiagnostics';
import { openLocalStorage } from '../../storage/secureDatabase';
import * as composition from '../../agent/encounter/modelComposition';

const { repository, controllerFor } = sqliteReviewFixture();
const fixture = 'test-persistence-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const source = fixture + ':review';
const compose = composition.composeEncounterModel;
function injectInvalidOperation() {
  jest
    .spyOn(composition, 'composeEncounterModel')
    .mockImplementation((...args) => {
      const model = compose(...args);
      return {
        ...model,
        execution: { ...model.execution, operationRunId: 'invalid%synthetic' },
      };
    });
}
let log: jest.SpyInstance;
beforeEach(() => {
  log = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('original UUID-shaped seed reaches approval with diagnostics and survives restore and deletion', async () => {
  // Exercise the unchanged native fixture in Node SQLite; this does not prove Hermes execution.
  const seed = await runEncounterReviewFixture('seed', fixture);
  expect(seed).toMatchObject({
    status: 'pending',
    modelCalls: 1,
    recordCount: 0,
    diagnostic: {
      status: 'pending',
      modelCalls: 1,
      recordCount: 0,
      failure: { stage: 'UNKNOWN', category: 'UNKNOWN' },
    },
  });
  expect(await repository().list('health_observation')).toHaveLength(0);
  expect(await runEncounterReviewFixture('resume', fixture)).toMatchObject({
    status: 'saved',
    restoredRecordCount: 0,
    modelCalls: 0,
    recordCount: 2,
  });
  expect(await runEncounterReviewFixture('readback', fixture)).toMatchObject({
    status: 'saved',
    modelCalls: 0,
    cleanupVerified: true,
  });
  expect(await repository().list('health_observation')).toHaveLength(0);
});

test('a valid production review stays pending until explicit approval and snapshots only its scoped rows', async () => {
  const first = controllerFor(false, true, calls =>
    createNativeReviewDiagnostics(sourceId, calls),
  );
  await first.controller.restore();
  await first.controller.start(consent);
  const snapshot = await first.service.diagnostics!.snapshot();
  expect(snapshot).toMatchObject({
    attempt: 2,
    phase: 'running',
    status: 'pending',
    modelCalls: 1,
    recordCount: 0,
    failure: { stage: 'UNKNOWN', category: 'UNKNOWN' },
  });
  expect(first.controller.state.pending?.sourceId).toBe(sourceId);
  expect(await repository().list('health_observation')).toHaveLength(0);
  await first.controller.decide('approve');
  expect(await first.service.diagnostics!.snapshot()).toMatchObject({
    phase: 'saving',
    status: 'saved',
    recordCount: 2,
  });
  const restored = controllerFor(false, false, calls =>
    createNativeReviewDiagnostics(sourceId, calls),
  );
  await restored.controller.restore();
  expect(await restored.service.diagnostics!.snapshot()).toMatchObject({
    phase: 'loading',
    status: 'saved',
    recordCount: 2,
    modelCalls: 0,
  });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /synthetic-review-recording|합성약|quote|segment|userinfo|SQL/,
  );
});

test('an injected invalid operation retains the original seed assertion and independently measures zero rows and dispatches', async () => {
  injectInvalidOperation();
  let failure: Error | undefined;
  try {
    await runEncounterReviewFixture('seed', fixture);
  } catch (error) {
    failure = error as Error;
  }
  expect(failure?.message).toMatch(
    /^Extraction must await explicit record approval\. EncounterReviewDiagnostic /,
  );
  const snapshot = JSON.parse(
    failure!.message.split('EncounterReviewDiagnostic ')[1],
  );
  expect(snapshot).toMatchObject({
    phase: 'running',
    status: 'unavailable',
    modelCalls: 0,
    recordCount: 0,
    failure: {
      stage: 'extraction_result',
      category: 'workflow_invalid_output',
    },
  });
  expect(await repository().list('health_observation')).toHaveLength(0);
  expect(failure!.message).not.toContain(fixture);
});

test('scripted provider failure records its actual dispatch without approving or replacing unavailable', async () => {
  const failed = controllerFor(false, false, calls =>
    createNativeReviewDiagnostics(sourceId, calls),
  );
  await failed.controller.start(consent);
  expect(failed.controller.state.status).toBe('unavailable');
  expect(await failed.service.diagnostics!.snapshot()).toMatchObject({
    recordCount: 0,
    modelCalls: 1,
    status: 'unavailable',
  });
});

test('failed SQL readback resolves UNKNOWN even while the actual attempt is unsettled', async () => {
  const diagnostics = createNativeReviewDiagnostics(sourceId, () => 0);
  diagnostics.begin('running', sourceId);
  jest
    .mocked(openLocalStorage)
    .mockRejectedValue(new Error('private transcript SQL userinfo'));
  expect(await readNativeReviewReport(sourceId, () => 0, diagnostics)).toEqual({
    modelCalls: 0,
    diagnostic: {
      status: 'UNKNOWN',
      recordCount: 'UNKNOWN',
      modelCalls: 0,
      failure: { stage: 'record_count', category: 'UNKNOWN' },
    },
  });
  expect(log).not.toHaveBeenCalled();
});

test('independent row evidence still runs when the ORIGINAL assertion short-circuits on unavailable', async () => {
  injectInvalidOperation();
  const canonical = repository();
  const list = canonical.list.bind(canonical);
  jest.spyOn(canonical, 'list').mockImplementation(async kind => {
    const actual = await list(kind);
    if (kind !== 'health_observation') return actual;
    // Inject only the falsifying measurement; the original controller, graph and assertion still run.
    return [
      ...actual,
      { provenance: { sourceRecordIds: [source] } },
    ] as typeof actual;
  });
  jest.mocked(openLocalStorage).mockResolvedValue(canonical);
  await expect(runEncounterReviewFixture('seed', fixture)).rejects.toThrow(
    /Extraction must await explicit record approval.*"status":"unavailable","modelCalls":0.*"recordCount":1/,
  );
});
