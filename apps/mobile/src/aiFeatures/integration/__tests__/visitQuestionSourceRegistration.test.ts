import type { Appointment } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';
import type { RecordKind, RecordRepository } from '@orot/storage';
import { createVisitQuestionEvidenceRevalidator } from '../../../agent/visitQuestions/evidenceRevalidation';
import { createVisitQuestionEvidenceCollection } from '../../../agent/visitQuestions/evidenceCollection';
import {
  appointment as appointmentFixture,
  now,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import type { AiFeatureLocalData } from '../localData';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';

// A valid #30 Calendar citation can point to its own appointment when no SourceRecord exists.
describe('visit-question source registration', () => {
  it('opens the typed appointment record mapped by #30', async () => {
    const scenario = await sourceScenario();
    const controller = new AbortController();

    await expect(
      scenario.registry.readSource(scenario.registered, controller.signal),
    ).resolves.toEqual({
      status: 'available',
      document: {
        sourceKind: 'personal_record',
        records: [{ kind: 'appointment', record: appointmentFixture }],
      },
    });
    expect(scenario.citation).toMatchObject({
      sourceId: appointmentFixture.id,
      evidenceId: appointmentFixture.id,
      locator: {
        kind: 'structured_record',
        recordId: appointmentFixture.id,
      },
    });
    expect(scenario.readRecord).toHaveBeenCalledWith(
      'appointment',
      appointmentFixture.id,
      controller.signal,
    );
  });

  it('refuses a citation after the current appointment revision changes', async () => {
    const scenario = await sourceScenario();
    scenario.setCurrentAppointment({
      ...appointmentFixture,
      effectiveAt: '2026-11-02T09:00:00+09:00',
    });

    await expect(
      scenario.registry.readSource(
        scenario.registered,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'changed' });
    expect(scenario.querySource).not.toHaveBeenCalled();
  });

  it('refuses a citation after the appointment has been deleted', async () => {
    const scenario = await sourceScenario();
    scenario.setCurrentAppointment(null);

    await expect(
      scenario.registry.readSource(
        scenario.registered,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ status: 'changed' });
    expect(scenario.querySource).not.toHaveBeenCalled();
  });
});

async function sourceScenario() {
  let currentAppointment: Appointment | null = appointmentFixture;
  const recordRepository = {
    get: jest.fn(async (kind: RecordKind, id: string) =>
      kind === 'appointment' && id === appointmentFixture.id
        ? currentAppointment
        : null,
    ),
  } as unknown as Pick<RecordRepository, 'get'>;
  const initialChunk = chunkStructuredRecord('appointment', appointmentFixture);
  const collection = await createVisitQuestionEvidenceCollection({
    repository: recordRepository,
    recordHits: [
      { chunk: initialChunk, score: 1, lexicalRank: 1, vectorRank: 1 },
    ],
    transcriptHits: [],
    recordResultLimit: 1,
    transcriptResultLimit: 1,
    memoryResultLimit: 1,
    maxEvidenceItems: 1,
  });
  const citation = collection.batch.items[0];
  if (!citation)
    throw new Error('Expected #30 to map the appointment citation.');

  const revalidate = createVisitQuestionEvidenceRevalidator({
    appointment: appointmentFixture,
    query: '다음 진료에서 확인할 질문',
    metadataByCitation: collection.metadataByCitation,
    queryService: {
      queryNextConfirmedCalendarAppointment: jest.fn(async () => ({
        status: currentAppointment ? 'available' : 'missing',
        appointment: currentAppointment,
      })),
      searchMemory: jest.fn(),
    } as never,
    repository: recordRepository as never,
    buildChunks: jest.fn(async () =>
      currentAppointment
        ? [chunkStructuredRecord('appointment', currentAppointment)]
        : [],
    ),
    currentTime: () => now,
  });
  const readRecord = jest.fn(async (kind: RecordKind, id: string) =>
    kind === 'appointment' && id === appointmentFixture.id
      ? currentAppointment
      : null,
  );
  const querySource = jest.fn(async (sourceRecordId: string) => ({
    status: 'source_missing' as const,
    sourceRecordId,
    records: [],
    queriedKinds: ['source_record'] as RecordKind[],
    availableKinds: [] as RecordKind[],
    truncatedKinds: [] as RecordKind[],
    complete: true,
  }));
  const registry = new LocalEvidenceReferenceRegistry();
  const sourceService = createVisitQuestionSourceService(
    registry,
    async () =>
      ({
        repository: { readInventory: jest.fn(), readRecord, querySource },
      }) as unknown as AiFeatureLocalData,
  );
  const registered = sourceService.registerVisitQuestionSource(
    citation,
    async signal => !signal.aborted && (await revalidate([citation])),
  );

  return {
    citation,
    registered,
    registry,
    querySource,
    readRecord,
    setCurrentAppointment(value: Appointment | null) {
      currentAppointment = value;
    },
  };
}
