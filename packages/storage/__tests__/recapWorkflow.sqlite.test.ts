import { extractTranscriptRecap } from '@orot/agent-runtime';
import { extractionFixture } from '../../agent-runtime/__tests__/recap-fixtures';
import {
  bindRecordingToVisit,
  cacheRecapResult,
  loadCurrentRecapInput,
  markRecapSaved,
  readCurrentRecapResult,
} from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';
import type { SqlExecutor } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAutomaticRecapService } from '../../../apps/mobile/src/transcription/automaticRecapService';

jest.mock('../../../apps/mobile/src/aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));

it('automatically analyzes and saves through the app service without a confirmation action', async () => {
  const fixture = await setupAutomatic();
  try {
    const sourceId = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, sourceId, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, sourceId))!;
    const scripted = extractionFixture(input);
    const {
      resolveSelectedAiProvider,
    } = require('../../../apps/mobile/src/aiFeatures/integration/provider');
    resolveSelectedAiProvider.mockResolvedValue({
      status: 'ready',
      provider: scripted.options.provider,
      modelId: 'selected-model',
      recipient: 'synthetic',
      remoteProcessing: false,
    });
    const run = createAutomaticRecapService(fixture.database, scripted.consent);
    const signal = new AbortController().signal;
    const first = run(sourceId, input.segments, signal);
    const duplicate = run(sourceId, input.segments, signal);
    expect(await Promise.all([first, duplicate])).toEqual([
      { status: 'saved' },
      { status: 'saved' },
    ]);
    expect(await run(sourceId, input.segments, signal)).toEqual({ status: 'saved' });
    expect(scripted.generate).toHaveBeenCalledTimes(1);
    expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(1);
    expect((await fixture.database.execute('SELECT saved FROM recap_results')).rows[0].saved).toBe(
      1,
    );
  } finally {
    fixture.close();
  }
});

it('does not persist a late model response after cancellation', async () => {
  const fixture = await setupAutomatic();
  try {
    const sourceId = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, sourceId, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, sourceId))!;
    const scripted = extractionFixture(input);
    let started!: () => void;
    let release!: () => void;
    let finished!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finishedProvider = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const original = scripted.generate.getMockImplementation()!;
    scripted.generate.mockImplementationOnce(async (request) => {
      started();
      await gate;
      const response = await original(request);
      finished();
      return response;
    });
    const {
      resolveSelectedAiProvider,
    } = require('../../../apps/mobile/src/aiFeatures/integration/provider');
    resolveSelectedAiProvider.mockResolvedValue({
      status: 'ready',
      provider: scripted.options.provider,
      modelId: 'selected-model',
      recipient: 'synthetic',
      remoteProcessing: false,
    });
    const run = createAutomaticRecapService(fixture.database, scripted.consent);
    const controller = new AbortController();
    const pending = run(sourceId, input.segments, controller.signal);
    await entered;
    controller.abort();
    expect(await pending).toEqual({ status: 'cancelled' });
    release();
    await finishedProvider;
    expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(0);
    expect(
      (await fixture.database.execute('SELECT recording_id FROM recap_results')).rows,
    ).toHaveLength(0);
  } finally {
    fixture.close();
  }
});

it('rejects a late model result when the transcript changes during analysis', async () => {
  const fixture = await setupAutomatic();
  try {
    const sourceId = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, sourceId, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, sourceId))!;
    const scripted = extractionFixture(input);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = scripted.generate.getMockImplementation()!;
    scripted.generate.mockImplementationOnce(async (request) => {
      started();
      await gate;
      return original(request);
    });
    const {
      resolveSelectedAiProvider,
    } = require('../../../apps/mobile/src/aiFeatures/integration/provider');
    resolveSelectedAiProvider.mockResolvedValue({
      status: 'ready',
      provider: scripted.options.provider,
      modelId: 'selected-model',
      recipient: 'synthetic',
      remoteProcessing: false,
    });
    const run = createAutomaticRecapService(fixture.database, scripted.consent);
    const pending = run(sourceId, input.segments, new AbortController().signal);
    await entered;
    await fixture.records.transcripts.correct(
      input.segments[0].id,
      '수정된 전사',
      '2026-11-06T00:00:00Z',
    );
    release();
    expect(await pending).toEqual({ status: 'stale_source' });
    expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(0);
    expect(
      (await fixture.database.execute('SELECT recording_id FROM recap_results')).rows,
    ).toHaveLength(0);
  } finally {
    fixture.close();
  }
});

it('runs the runtime extractor with a scripted provider and commits its result to SQLite', async () => {
  const fixture = await setupAutomatic();
  const { database } = fixture;
  const sourceId = fixture.result.recordingSourceId;
  await bindRecordingToVisit(database, sourceId, fixture.result.appointmentId);
  const input = (await loadCurrentRecapInput(database, sourceId))!;
  const scripted = extractionFixture(input);
  const outcome = await extractTranscriptRecap({
    ...scripted.options,
    isCurrent: async (snapshot) =>
      JSON.stringify(snapshot) === JSON.stringify(await loadCurrentRecapInput(database, sourceId)),
  });
  expect(outcome.status).toBe('result');
  if (outcome.status !== 'result') throw new Error('Expected validated extraction');
  await cacheRecapResult(database, outcome.value);
  const guard = {
    loadCurrentInput: async (sql: SqlExecutor) => (await loadCurrentRecapInput(sql, sourceId))!,
  };
  const [saved] = await fixture.official.saveAutomatic(outcome.value, guard);
  expect(await fixture.official.saveAutomatic(outcome.value, guard)).toEqual([saved]);
  const edited = await fixture.official.edit({
    id: saved.id,
    expectedRevision: saved.revision,
    answer: '직접 수정',
  });
  expect(await fixture.official.saveAutomatic(outcome.value, guard)).toEqual([edited]);
  expect(await fixture.official.history(saved.id)).toEqual([saved, edited]);
  await markRecapSaved(database, outcome.value);
  expect(await readCurrentRecapResult(database, sourceId)).toEqual(outcome.value);
  expect(await fixture.official.listForAppointment(input.appointmentId)).toHaveLength(1);
  expect(scripted.generate).toHaveBeenCalledTimes(1);
  await fixture.records.transcripts.correct(
    input.segments[0].id,
    `${input.segments[0].text} 추가`,
    '2026-11-06T00:00:00Z',
  );
  const updatedInput = (await loadCurrentRecapInput(database, sourceId))!;
  const reanalysis = await extractTranscriptRecap(extractionFixture(updatedInput).options);
  if (reanalysis.status !== 'result') throw new Error('Expected validated reanalysis');
  await expect(fixture.official.saveAutomatic(reanalysis.value, guard)).rejects.toThrow(
    'preserve the user edit',
  );
  expect(await fixture.official.history(saved.id)).toEqual([saved, edited]);
  fixture.close();
});

it('reopens a committed result and its official record from a real SQLite file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-recap-test-'));
  const path = join(directory, 'records.sqlite');
  try {
    const fixture = await setupAutomatic(path);
    const sourceId = fixture.result.recordingSourceId;
    await bindRecordingToVisit(fixture.database, sourceId, fixture.result.appointmentId);
    const input = (await loadCurrentRecapInput(fixture.database, sourceId))!;
    const scripted = extractionFixture(input);
    const outcome = await extractTranscriptRecap(scripted.options);
    if (outcome.status !== 'result') throw new Error('Expected validated extraction');
    await cacheRecapResult(fixture.database, outcome.value);
    await fixture.official.saveAutomatic(outcome.value, {
      loadCurrentInput: async (sql) => (await loadCurrentRecapInput(sql, sourceId))!,
    });
    await markRecapSaved(fixture.database, outcome.value);
    fixture.close();
    const reopened = openSqliteTestDatabase(path);
    expect(await readCurrentRecapResult(reopened.database, sourceId)).toEqual(outcome.value);
    const rows = await reopened.database.execute('SELECT payload_json FROM visit_question_records');
    expect(rows.rows).toHaveLength(1);
    expect((await reopened.database.execute('SELECT saved FROM recap_results')).rows[0].saved).toBe(
      1,
    );
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
