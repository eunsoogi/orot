import { registerReportCalendarCitation } from '../dailyReportCalendarCitation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import type { DailyReportLookup } from '../../../storage/dailyReportStorageTypes';

test.each(['validate', 'readSource'] as const)(
  'calendar citation %s rejects a lookup that resolves after cancellation',
  async method => {
    // Only the citation envelope is needed: no personal data or native query is used.
    const saved = {
      status: 'saved',
      runId: 'synthetic-report',
      revision: 1,
      context: {
        interval: { fromInclusive: '2035-01-01T00:00:00Z' },
        provider: { providerId: 'fake', modelId: 'fake' },
      },
      report: {
        observations: [],
        supportedContext: [],
        generatedAt: '2035-01-01T12:00:00Z',
      },
      lineage: [],
    } as unknown as Extract<DailyReportLookup, { status: 'saved' }>;
    const revision = fingerprint({
      runId: saved.runId,
      revision: saved.revision,
      context: saved.context,
      report: saved.report,
      lineage: saved.lineage,
    });
    const registry = new LocalEvidenceReferenceRegistry();
    const add = jest.spyOn(registry, 'add');
    let finish!: (value: DailyReportLookup) => void;
    const lookup = jest.fn(
      (_signal?: AbortSignal) =>
        new Promise<DailyReportLookup>(resolve => {
          finish = resolve;
        }),
    );
    registerReportCalendarCitation(saved, revision, registry, lookup);
    const entry = add.mock.calls[0]![0];
    const controller = new AbortController();
    const pending =
      method === 'validate'
        ? entry.validate(controller.signal, { once: (_key, load) => load() })
        : entry.readSource(controller.signal);
    expect(lookup).toHaveBeenCalledWith(controller.signal);
    controller.abort();
    finish(saved);
    expect(await pending).toEqual(
      method === 'validate' ? false : { status: 'changed' },
    );
  },
);
