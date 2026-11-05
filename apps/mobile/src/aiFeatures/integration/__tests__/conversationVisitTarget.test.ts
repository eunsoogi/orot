import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';
import { prepareConversationVisitTarget } from '../conversationVisitTarget';

test('binds the exact current appointment, redacts its identifiers and rejects later changes', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const records = createRecordRepository(connection.database);
    const appointment = {
      id: 'private-appointment-id',
      effectiveAt: '2035-06-02T09:30:00.000Z',
      recordedAt: '2035-01-01T00:00:00.000Z',
      ingestedAt: '2035-01-01T00:00:00.000Z',
      provenance: {
        origin: 'user_reported' as const,
        sourceRecordIds: ['private-source-id'],
      },
      reviewState: { status: 'unreviewed' as const },
      status: 'scheduled' as const,
      clinicLabel: '합성 진료',
      calendarEventIdentifier: 'private-calendar-id',
      calendarEventSnapshot: {
        title: '합성 예약',
        timeZoneIdentifier: 'Asia/Seoul',
        isAllDay: false,
        occurrenceDate: null,
        isDetached: false,
        recurrenceRules: [],
      },
    };
    const source = {
      id: 'private-source-id',
      sourceKind: 'user_note' as const,
      effectiveAt: '2035-01-01T00:00:00.000Z',
      recordedAt: '2035-01-01T00:00:00.000Z',
      ingestedAt: '2035-01-01T00:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
    };
    await records.put('source_record', source);
    await records.put('appointment', appointment);
    const data = {
      ...localData([]).data,
      ...createLocalEvidenceData(connection.database),
      repository: createLocalHealthEvidenceRepository(connection.database),
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const now = () => Date.parse('2035-06-01T00:00:00.000Z');
    const item = await prepareConversationVisitTarget({
      data,
      registry,
      appointmentId: appointment.id,
      signal,
      now,
    });
    expect(item).not.toBeNull();
    if (!item) throw new Error('Expected a target');
    expect(JSON.stringify(item)).not.toContain(appointment.id);
    expect(JSON.stringify(item)).not.toContain(
      appointment.calendarEventIdentifier,
    );
    expect(JSON.stringify(item)).not.toContain(source.id);
    expect(await registry.revalidateEvidence([item], signal)).toBe(true);
    expect((await registry.readSource(item, signal)).status).toBe('available');
    await records.put('appointment', { ...appointment, status: 'cancelled' });
    expect(await registry.revalidateEvidence([item], signal)).toBe(false);
    expect(
      await prepareConversationVisitTarget({
        data,
        registry,
        appointmentId: appointment.id,
        signal,
        now,
      }),
    ).toBeNull();
    await records.put('appointment', appointment);
    expect(await registry.revalidateEvidence([item], signal)).toBe(true);
    await records.put('appointment', {
      ...appointment,
      clinicLabel: '가'.repeat(10_000),
    });
    await expect(
      prepareConversationVisitTarget({
        data,
        registry,
        appointmentId: appointment.id,
        signal,
        now,
      }),
    ).rejects.toThrow('could not be read safely');
    await records.put('appointment', appointment);
    await records.delete('source_record', source.id);
    expect(await registry.revalidateEvidence([item], signal)).toBe(false);
    expect((await registry.readSource(item, signal)).status).toBe('missing');
    expect(
      await prepareConversationVisitTarget({
        data,
        registry,
        appointmentId: 'missing',
        signal,
        now,
      }),
    ).toBeNull();
  } finally {
    connection.close();
  }
});
