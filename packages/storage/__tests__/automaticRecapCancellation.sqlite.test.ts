import { bindRecordingToUnchangedVisit, readRecapBinding, unbindRecordingFromVisit } from '../src';
import type { SqlDatabase } from '../src';
import { setupAutomatic } from './visitQuestionAutomaticSupport';

it('an explicit unlink before the first binding prevents a delayed automatic association', async () => {
  const fixture = await setupAutomatic();
  try {
    const { recordingSourceId, appointmentId } = fixture.result;
    const original = (await fixture.records.get('appointment', appointmentId))!;
    await unbindRecordingFromVisit(fixture.database, recordingSourceId);
    const before = await fixture.database.execute(
      'SELECT * FROM recap_bindings WHERE recording_id = ?',
      [recordingSourceId],
    );
    expect(before.rows[0]).toMatchObject({
      appointment_id: null,
      version: 1,
      work_status: 'not_linked',
    });
    await unbindRecordingFromVisit(fixture.database, recordingSourceId);
    expect(
      await fixture.database.execute('SELECT * FROM recap_bindings WHERE recording_id = ?', [
        recordingSourceId,
      ]),
    ).toEqual(before);
    expect(
      await bindRecordingToUnchangedVisit(fixture.database, recordingSourceId, {
        id: appointmentId,
        effectiveAt: original.effectiveAt,
        status: 'scheduled',
      }),
    ).toBe(false);
    expect(await readRecapBinding(fixture.database, recordingSourceId)).toBeNull();
    expect(await fixture.records.get('source_record', recordingSourceId)).not.toBeNull();
    await unbindRecordingFromVisit(fixture.database, 'missing-source');
    expect(
      (
        await fixture.database.execute('SELECT * FROM recap_bindings WHERE recording_id = ?', [
          'missing-source',
        ])
      ).rows,
    ).toHaveLength(0);
  } finally {
    fixture.close();
  }
});

it.each(['before', 'transaction', 'queries', 'insert'])(
  'does not retain a late binding after expiry at %s',
  async (stage) => {
    const fixture = await setupAutomatic();
    try {
      const { recordingSourceId, appointmentId } = fixture.result;
      const original = (await fixture.records.get('appointment', appointmentId))!;
      let active = stage !== 'before';
      let inserts = 0;
      const database: SqlDatabase = {
        ...fixture.database,
        transaction: async (operation) => {
          if (stage === 'transaction') active = false;
          return fixture.database.transaction(async (sql) =>
            operation({
              ...sql,
              execute: async (query, parameters) => {
                const result = await sql.execute(query, parameters);
                if (stage === 'queries' && query.startsWith('SELECT id FROM appointments'))
                  active = false;
                if (query.includes('INSERT INTO recap_bindings')) {
                  inserts += 1;
                  if (stage === 'insert') active = false;
                }
                return result;
              },
            }),
          );
        },
      };
      expect(
        await bindRecordingToUnchangedVisit(
          database,
          recordingSourceId,
          {
            id: appointmentId,
            effectiveAt: original.effectiveAt,
            status: 'scheduled',
          },
          () => active,
        ),
      ).toBe(false);
      expect(inserts).toBe(stage === 'insert' ? 1 : 0);
      expect(
        (
          await fixture.database.execute('SELECT * FROM recap_bindings WHERE recording_id = ?', [
            recordingSourceId,
          ])
        ).rows,
      ).toHaveLength(0);
      expect(await fixture.records.get('source_record', recordingSourceId)).not.toBeNull();
    } finally {
      fixture.close();
    }
  },
);

it('propagates real transaction failures rather than treating them as expiry', async () => {
  const fixture = await setupAutomatic();
  try {
    const { recordingSourceId, appointmentId } = fixture.result;
    const original = (await fixture.records.get('appointment', appointmentId))!;
    const failure = new Error('storage failed');
    const database: SqlDatabase = {
      ...fixture.database,
      transaction: async () => {
        throw failure;
      },
    };
    await expect(
      bindRecordingToUnchangedVisit(database, recordingSourceId, {
        id: appointmentId,
        effectiveAt: original.effectiveAt,
        status: 'scheduled',
      }),
    ).rejects.toBe(failure);
  } finally {
    fixture.close();
  }
});
