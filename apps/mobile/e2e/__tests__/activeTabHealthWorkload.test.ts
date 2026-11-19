import { runMigrations } from '@orot/storage';
import { openOpSqliteWorker } from '../../test-support/opSqliteWorkerFixture';
import { runActiveTabHealthWorkload } from '../activeTabHealthWorkload';
import { healthObservation } from '../../../../packages/storage/__tests__/localQueryTestSupport';

const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');

test('runs the real local health tool on an isolated database and honours cancellation', async () => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'active-tab-tool-'));
  const fixture = openOpSqliteWorker(
    path.join(directory, 'fixture.sqlite'),
    false,
  );
  const window = {
    fromInclusive: '2026-01-01T00:00:00Z',
    toExclusive: '2026-01-02T00:00:00Z',
    timeZone: 'UTC',
  };
  try {
    await runMigrations(fixture.database);
    const rows = Array.from({ length: 1000 }, (_, index) =>
      healthObservation(
        `synthetic-heart-${index}`,
        'heart_rate',
        new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString(),
      ),
    );
    await fixture.database.execute(
      `INSERT INTO health_observations (id, effective_at, recorded_at, ingested_at, payload_json)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.effectiveAt'),
       json_extract(value, '$.recordedAt'), json_extract(value, '$.ingestedAt'), value
       FROM json_each(?)`,
      [JSON.stringify(rows)],
    );
    let aggregates = 0;
    fixture.observe(event => {
      if (event.kind === 'aggregate' && event.phase === 'start') aggregates++;
    });
    const events: string[] = [];
    expect(
      await runActiveTabHealthWorkload(
        fixture.database,
        window,
        new AbortController().signal,
        event => events.push(event),
      ),
    ).toBe(1000);
    expect(aggregates).toBeGreaterThan(0);
    expect(events).toEqual(
      expect.arrayContaining([
        'transaction-requested',
        'transaction-admitted',
        'transaction-settled',
        'aggregate-requested',
        'aggregate-settled',
      ]),
    );
    expect(events.indexOf('transaction-requested')).toBeLessThan(
      events.indexOf('transaction-admitted'),
    );
    expect(events.indexOf('aggregate-requested')).toBeLessThan(
      events.indexOf('aggregate-settled'),
    );
    const running = new AbortController();
    fixture.observe(event => {
      if (event.kind === 'aggregate' && event.phase === 'start') {
        fixture.observe();
        running.abort();
      }
    });
    await expect(
      runActiveTabHealthWorkload(fixture.database, window, running.signal),
    ).rejects.toThrow(/cancel/i);
    expect(running.signal.aborted).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runActiveTabHealthWorkload(fixture.database, window, controller.signal),
    ).rejects.toThrow(/cancel/i);
  } finally {
    try {
      expect(await fixture.close()).toBe(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}, 30000);
