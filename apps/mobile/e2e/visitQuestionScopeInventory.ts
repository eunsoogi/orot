import type { Appointment } from '@orot/domain';
import type { RecordKind } from '@orot/storage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { auditVisitQuestionScope } from './visitQuestionScopeAudit';
import { expectedEvent, expectedSymptoms } from './visitQuestionScopeGuard';

const otherKinds: readonly RecordKind[] = [
  'source_record',
  'evidence_span',
  'encounter',
  'health_observation',
  'medication_definition',
  'medication_assertion',
  'dose_event',
  'transcript_segment',
];

export async function audit(selected: Appointment) {
  const repository = await openLocalStorage();
  const database = await openLocalAgentMemoryDatabase();
  const [appointments, symptoms, ...others] = await Promise.all([
    repository.list('appointment'),
    repository.list('symptom_entry'),
    ...otherKinds.map(kind => repository.list(kind)),
  ]);
  const tables = await database.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('manual_history_entries', 'agent_memory_records')",
  );
  const names = new Set(tables.rows.map(row => row.name));
  const manual = names.has('manual_history_entries')
    ? await database.execute('SELECT id FROM manual_history_entries')
    : { rows: [] };
  const memory = names.has('agent_memory_records')
    ? await database.execute('SELECT record_json FROM agent_memory_records')
    : { rows: [] };
  const memorySourceIds = memory.rows.map(row => {
    if (typeof row.record_json !== 'string') return [];
    try {
      const sources: unknown = JSON.parse(row.record_json).meta?.provenance
        ?.sourceIds;
      return Array.isArray(sources) &&
        sources.every(id => typeof id === 'string')
        ? (sources as string[])
        : [];
    } catch {
      return [];
    }
  });
  return auditVisitQuestionScope(
    {
      appointments,
      symptomIds: symptoms.map(item => item.id),
      otherCounts: Object.fromEntries([
        ...otherKinds.map((kind, index) => [kind, others[index]!.length]),
        ['manual_history', manual.rows.length],
      ]),
      memorySourceIds,
    },
    selected,
    expectedEvent,
    expectedSymptoms,
  );
}
