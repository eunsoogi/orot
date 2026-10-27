import { openLocalStorage } from '../storage/secureDatabase';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
} from '../agent/encounter/syntheticFixture';
import { createEncounterReviewService } from './service';
import { EncounterReviewController } from './controller';

/** Canonical native phases exercise the production service/controller with SQLCipher and real graph checkpoints.
 * Only model output is synthetic; no network or test replacement of persistence is used.
 */
export async function runEncounterReviewFixture(
  mode: unknown,
  fixture: unknown,
) {
  if (
    !['seed', 'resume', 'readback'].includes(String(mode)) ||
    typeof fixture !== 'string' ||
    !/^test-persistence-[a-f0-9-]{36}$/i.test(fixture)
  )
    throw new Error('An owned native persistence fixture is required.');
  const sourceId = fixture + ':review';
  const repository = await openLocalStorage();
  const synthetic = syntheticEncounterModel(sourceId, mode === 'seed');
  const service = createEncounterReviewService(async () => ({
    status: 'ready',
    selection: {
      providerId: synthetic.model.provider.id,
      modelId: 'synthetic',
    },
    option: {
      provider: synthetic.model.provider,
      modelId: 'synthetic',
      displayName: 'Synthetic',
      privacyBoundary: 'on-device',
      availability: { status: 'available' },
    },
    provider: synthetic.model.provider,
    modelId: 'synthetic',
    recipient: 'on-device',
    remoteProcessing: false,
  }));
  const controller = new EncounterReviewController(sourceId, service, () => {});
  const records = async () =>
    (await repository.list('health_observation')).filter(record =>
      record.provenance.sourceRecordIds.includes(sourceId),
    );
  if (mode === 'seed') {
    await seedSyntheticEncounter(repository, sourceId);
    await controller.restore();
    if (controller.state.status !== 'idle' || synthetic.calls() !== 0)
      throw new Error('Opening a recording initiated extraction.');
    await controller.start({ authorize: async () => 'renewal_required' });
    if (
      String(controller.state.status) !== 'pending' ||
      (await records()).length
    )
      throw new Error('Extraction must await explicit record approval.');
    return {
      status: controller.state.status,
      pending: controller.state.pending,
      modelCalls: synthetic.calls(),
      recordCount: (await records()).length,
    };
  }
  await controller.restore();
  if (synthetic.calls() !== 0) throw new Error('Restart dispatched a model.');
  if (mode === 'resume') {
    const restoredRecords = await records();
    if (controller.state.status !== 'pending' || restoredRecords.length)
      throw new Error('Restart lost pending review or approved automatically.');
    const restored = controller.state.pending!;
    controller.edit(
      restored.candidates[0].id,
      'text',
      '사용자가 검토한 합성약 언급',
    );
    await controller.decide('approve');
    if (String(controller.state.status) !== 'saved')
      throw new Error('Explicit Save failed.');
    return {
      status: controller.state.status,
      restored,
      restoredRecordCount: restoredRecords.length,
      modelCalls: synthetic.calls(),
      recordCount: (await records()).length,
    };
  }
  if (controller.state.status !== 'saved')
    throw new Error('Fresh-process saved readback failed.');
  const saved = await records();
  const evidence = await repository.evidenceSpans.listForSourceRecord(sourceId);
  if (
    saved.length !== 2 ||
    evidence.length !== 4 ||
    saved.some(
      record =>
        record.reviewState.status !== 'reviewed' ||
        record.provenance.origin !== 'derived' ||
        record.provenance.source?.sourceName !== 'speaker:unknown',
    )
  )
    throw new Error(
      'Reviewed encounter records or exact evidence did not survive.',
    );
  await repository.sourceRecords.delete(sourceId);
  const afterDelete = await service.restore(
    sourceId,
    new AbortController().signal,
  );
  if (
    afterDelete.status !== 'unavailable' ||
    (await repository.get('source_record', sourceId)) ||
    (await records()).length ||
    (await repository.evidenceSpans.listForSourceRecord(sourceId)).length
  )
    throw new Error(
      'Fixture deletion failed to clean discovery, records and evidence.',
    );
  controller.dispose();
  return {
    status: 'saved',
    records: saved,
    evidence,
    modelCalls: synthetic.calls(),
    cleanupVerified: true,
  };
}
