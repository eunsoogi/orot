import { HealthReviewController } from '../controller';
import type { HealthReviewService } from '../service';
import { healthReviewSqlite, instant } from '../testing/sqlite';

describe('Retained operation ownership and deterministic guidance', () => {
  let f: Awaited<ReturnType<typeof healthReviewSqlite>>;
  beforeEach(async () => {
    f = await healthReviewSqlite();
  });
  afterEach(() => f.close());
  const consent = { authorize: async () => 'renewal_required' as const };
  it('publishes all local actions while clarification is pending before provider/service completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const source = await f.requests.create('検討');
    const service: HealthReviewService = {
      list: async () => [],
      delete: async () => undefined,
      continue: jest.fn(),
      start: jest.fn(async () => {
        await gate;
        return { source, result: { status: 'unavailable' as const } };
      }),
    };
    const controller = new HealthReviewController(service);
    controller.setName('내 검토');
    controller.setDraft({
      population: 'adult_not_pregnant',
      readingContext: 'current_measurement',
      symptoms: 'unknown',
      signs: [],
      upcomingVisit: 'unknown',
      readings: [
        {
          systolic: '190',
          diastolic: '125',
          measuredAt: instant,
          source: '내 혈압계',
        },
      ],
    });
    const run = controller.run(consent);
    expect(controller.snapshot().safety).toMatchObject({
      category: 'insufficient_information',
      requiredActions: [
        'confirm_warning_symptoms',
        'seek_immediate_emergency_help_if_warning_signs_are_present',
      ],
    });
    expect(controller.snapshot().busy).toBe(true);
    controller.cancel();
    release();
    await run;
    expect(controller.snapshot().result).toEqual({ status: 'cancelled' });
    expect(controller.snapshot().name).toBe('내 검토');
  });

  it('deletion cancels the owned signal and blocks a late completed result', async () => {
    const source = await f.requests.create('검토');
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let signal!: AbortSignal;
    const service: HealthReviewService = {
      list: async () => [],
      continue: jest.fn(),
      start: async (_name, _safety, _consent, owned) => {
        signal = owned;
        await gate;
        return {
          source,
          result: {
            status: 'safety_action',
            safety: {
              policyVersion: '1.0.0',
              category: 'no_triggered_action',
              requiredActions: [],
              matchedRuleIds: [],
              missingInputs: [],
            },
          },
        };
      },
      delete: jest.fn(async () => {
        expect(signal.aborted).toBe(true);
      }),
    };
    const controller = new HealthReviewController(service);
    controller.setName('검토');
    const run = controller.run(consent);
    await controller.delete(source.id);
    release();
    await run;
    expect(controller.snapshot().result?.status).not.toBe('safety_action');
    expect(controller.snapshot().invocation).toBeUndefined();
  });
});
