/* global jest */
import { performance } from 'node:perf_hooks';
import * as diagnostics from '../../../providers/diagnostics';
import * as projection from '../../../healthEvidence/healthContext/projection';
import * as revisions from '../../../healthEvidence/healthContext/scope';
import {
  dayFormatter,
  shiftDate,
} from '../../../healthEvidence/healthContext/calendarDate';
import { validateHealthContextCalendar } from '../../../healthEvidence/healthContext/calendarValidation';

/** Use the production restore path and measure real SQLite calls without logging
 * query bindings, result rows, identifiers or source payloads. */
export function coldConversationProfile(database) {
  // Fixture writes validate the same windows. Replace those validation entries
  // and formatters before restoring so the measured route begins cold.
  for (let offset = 0; offset < 33; offset++) {
    const date = shiftDate('2031-01-01', offset);
    validateHealthContextCalendar({
      fromInclusive: `${date}T00:00:00Z`,
      toExclusive: `${date}T12:00:00Z`,
      timeZone: 'UTC',
    });
  }
  for (const zone of ['UTC', 'Asia/Tokyo', 'Pacific/Apia', 'Europe/London'])
    dayFormatter(zone);
  const formatter = dayFormatter('Asia/Seoul');
  const format = formatter.formatToParts;
  let intlCalls = 0;
  formatter.formatToParts = instant => {
    intlCalls++;
    return format.call(formatter, instant);
  };
  const started = new Map();
  const stages = {};
  const sql = {};
  const stats = {
    revisionMs: 0,
    projectionMs: 0,
    revisionCalls: 0,
    projectionCalls: 0,
  };
  let timelineStart;
  let timelineToRecheckMs;
  const diagnostic = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, stage, outcome) => {
      const now = performance.now();
      if (outcome === 'started') {
        started.set(stage, now);
        if (stage === 'history_timeline') timelineStart = now;
        return;
      }
      if (outcome !== 'completed' || !started.has(stage)) return;
      const entry = (stages[stage] ??= { calls: 0, ms: 0 });
      entry.calls++;
      entry.ms += now - started.get(stage);
      started.delete(stage);
      if (stage === 'history_recheck')
        timelineToRecheckMs = now - timelineStart;
    });
  const observe = (module, name, key) => {
    const work = module[name];
    return jest.spyOn(module, name).mockImplementation((...args) => {
      if (!started.has('artifact_source_hydration')) return work(...args);
      const before = performance.now();
      try {
        return work(...args);
      } finally {
        stats[key + 'Ms'] += performance.now() - before;
        stats[key + 'Calls']++;
      }
    });
  };
  const revision = observe(revisions, 'healthContextRevision', 'revision');
  const project = observe(projection, 'projectHealthContext', 'projection');
  const transaction = database.transaction.bind(database);
  database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (query, parameters) => {
        const start = performance.now();
        const result = await execute(query, parameters);
        const group = query.includes('workouts AS MATERIALIZED')
          ? 'heart'
          : query.includes('observations AS MATERIALIZED')
            ? query.includes(
                "AND lower(json_extract(r.payload_json, '$.concept')) IN",
              )
              ? 'activity'
              : 'measurement'
            : 'other';
        const entry = (sql[group] ??= { calls: 0, ms: 0 });
        entry.calls++;
        entry.ms += performance.now() - start;
        return result;
      };
      await work(tx);
    });
  return {
    read() {
      return {
        ...stats,
        intlCalls,
        stages,
        timelineToRecheckMs,
        sql,
      };
    },
    dispose() {
      diagnostic.mockRestore();
      revision.mockRestore();
      project.mockRestore();
      formatter.formatToParts = format;
      database.transaction = transaction;
    },
  };
}
