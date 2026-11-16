import {
  bindRecordingToUnchangedVisit,
  bindRecordingToVisit,
  readRecapBinding,
  unbindRecordingFromVisit,
} from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';

it.each(['unchanged', 'cancelled', 'completed', 'rescheduled', 'time', 'deleted'])(
  'atomically checks the original visit when it is %s',
  async (change) => {
    const fixture = await setupAutomatic();
    try {
      const { recordingSourceId, appointmentId } = fixture.result;
      const original = (await fixture.records.get('appointment', appointmentId))!;
      const selected = {
        id: appointmentId,
        effectiveAt: original.effectiveAt,
        status: 'scheduled' as const,
      };
      if (change === 'deleted') {
        await fixture.database.execute('DELETE FROM appointments WHERE id = ?', [appointmentId]);
      } else if (change !== 'unchanged') {
        await fixture.database.execute(
          `UPDATE appointments SET payload_json = json_set(payload_json, ?, ?) WHERE id = ?`,
          [
            change === 'time' ? '$.effectiveAt' : '$.status',
            change === 'time' ? '2026-11-06T00:00:00Z' : change,
            appointmentId,
          ],
        );
      }
      expect(
        await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, selected),
      ).toBe(change === 'unchanged');
      const linked = await readRecapBinding(fixture.database, recordingSourceId);
      if (change === 'unchanged') {
        expect(linked?.appointmentId).toBe(appointmentId);
        expect(
          await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, selected),
        ).toBe(true);
        expect(await readRecapBinding(fixture.database, recordingSourceId)).toEqual(linked);
      } else expect(linked).toBeNull();
      expect(await fixture.records.get('source_record', recordingSourceId)).not.toBeNull();
    } finally {
      fixture.close();
    }
  },
);

it('never overwrites a manual choice or revives its explicit unlink', async () => {
  const fixture = await setupAutomatic();
  try {
    const { recordingSourceId, appointmentId } = fixture.result;
    const original = (await fixture.records.get('appointment', appointmentId))!;
    const selected = {
      id: appointmentId,
      effectiveAt: original.effectiveAt,
      status: 'scheduled' as const,
    };
    await fixture.records.put('appointment', { ...original, id: 'manual-visit' });
    await bindRecordingToVisit(fixture.database, recordingSourceId, 'manual-visit');
    expect(await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, selected)).toBe(
      false,
    );
    expect((await readRecapBinding(fixture.database, recordingSourceId))?.appointmentId).toBe(
      'manual-visit',
    );
    await unbindRecordingFromVisit(fixture.database, recordingSourceId);
    expect(await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, selected)).toBe(
      false,
    );
    expect(await readRecapBinding(fixture.database, recordingSourceId)).toBeNull();
  } finally {
    fixture.close();
  }
});

it('does not bind a deleted audio source', async () => {
  const fixture = await setupAutomatic();
  try {
    const { recordingSourceId, appointmentId } = fixture.result;
    const original = (await fixture.records.get('appointment', appointmentId))!;
    await fixture.database.execute('DELETE FROM source_records WHERE id = ?', [recordingSourceId]);
    expect(
      await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, {
        id: appointmentId,
        effectiveAt: original.effectiveAt,
        status: 'scheduled',
      }),
    ).toBe(false);
    expect(await readRecapBinding(fixture.database, recordingSourceId)).toBeNull();
  } finally {
    fixture.close();
  }
});

it('rejects a visit changed after selection but immediately before the binding transaction', async () => {
  const fixture = await setupAutomatic();
  try {
    const { recordingSourceId, appointmentId } = fixture.result;
    const original = (await fixture.records.get('appointment', appointmentId))!;
    const guarded = {
      ...fixture.database,
      transaction: async (operation: Parameters<typeof fixture.database.transaction>[0]) => {
        await fixture.database.execute(
          "UPDATE appointments SET payload_json = json_set(payload_json, '$.status', 'cancelled') WHERE id = ?",
          [appointmentId],
        );
        return fixture.database.transaction(operation);
      },
    };
    expect(
      await bindRecordingToUnchangedVisit(guarded, recordingSourceId, {
        id: appointmentId,
        effectiveAt: original.effectiveAt,
        status: 'scheduled',
      }),
    ).toBe(false);
    expect(await readRecapBinding(fixture.database, recordingSourceId)).toBeNull();
    expect(await fixture.records.get('source_record', recordingSourceId)).not.toBeNull();
  } finally {
    fixture.close();
  }
});
