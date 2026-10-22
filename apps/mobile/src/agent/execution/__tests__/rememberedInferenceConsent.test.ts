import { createHash } from '../consentHashTestSupport';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createRememberedInferenceConfirmation } from '../rememberedInferenceConsent';
import { createExecutionConsentRegistry } from '../consentRegistry';
import { beginConsentReset, finishConsentReset } from '../consentRevision';

const digest = async (value: string) =>
  createHash('sha256').update(value).digest('hex');
const request = (
  overrides: Partial<OutboundProcessingRequest> = {},
): OutboundProcessingRequest => ({
  operationRunId: 'first-run',
  providerId: 'synthetic-provider',
  modelId: 'gpt-6-luna',
  recipient: 'synthetic-account',
  remoteProcessing: true,
  consentScope: {
    purpose: 'calendar_classification',
    dataCategories: ['calendar_title_time'],
    policyVersion: 'upcoming-year-v1',
  },
  allowedScope: {
    sourceKinds: ['personal_record'],
    sourceIds: ['synthetic-record'],
  },
  payload: { messages: [{ role: 'user', content: 'Synthetic private input' }] },
  signal: new AbortController().signal,
  ...overrides,
});
function setup() {
  const values = new Set<string>();
  const receipts = {
    has: jest.fn(async (key: string) => values.has(key)),
    save: jest.fn(async (key: string, valid: () => boolean) => {
      if (valid()) values.add(key);
    }),
    clear: jest.fn(async () => {
      values.clear();
    }),
  };
  const confirm = jest.fn(async (_request: OutboundProcessingRequest) => true);
  const create = () =>
    createExecutionConsentRegistry(
      createRememberedInferenceConfirmation(confirm, { receipts, digest }),
    );
  return { values, receipts, confirm, create };
}
afterEach(() => finishConsentReset());

test('reuses an identical request in a new registry/run and stores only a SHA-256 digest', async () => {
  const s = setup();
  expect(await s.create().authorize(request())).toBe('authorized');
  expect(
    await s.create().authorize(request({ operationRunId: 'second-run' })),
  ).toBe('authorized');
  expect(s.confirm).toHaveBeenCalledTimes(1);
  expect([...s.values]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
  expect([...s.values].join()).not.toContain('Synthetic private input');
});

test.each([
  { providerId: 'another-provider' },
  { modelId: 'another-model' },
  { recipient: 'another-account' },
  {
    consentScope: {
      purpose: 'another-feature',
      dataCategories: ['calendar_title_time'],
      policyVersion: 'upcoming-year-v1',
    },
  },
  {
    consentScope: {
      purpose: 'calendar_classification',
      dataCategories: ['calendar_title_time', 'health_records'],
      policyVersion: 'upcoming-year-v1',
    },
  },
  {
    consentScope: {
      purpose: 'calendar_classification',
      dataCategories: ['calendar_title_time'],
      policyVersion: 'expanded-window-v2',
    },
  },
])(
  'requires fresh approval when destination or declared permission expands: %p',
  async change => {
    const s = setup();
    await s.create().authorize(request());
    await s.create().authorize(request(change));
    expect(s.confirm).toHaveBeenCalledTimes(2);
  },
);

test('new calendar values and batch IDs reuse the same declared permission across runs', async () => {
  const s = setup();
  await s.create().authorize(request());
  expect(
    await s.create().authorize(
      request({
        operationRunId: 'another-batch',
        allowedScope: {
          sourceKinds: ['personal_record'],
          sourceIds: ['another-record'],
        },
        payload: {
          messages: [
            { role: 'user', content: 'Another synthetic calendar batch' },
          ],
        },
      }),
    ),
  ).toBe('authorized');
  expect(s.confirm).toHaveBeenCalledTimes(1);
});

test('undeclared permission boundaries are never remembered', async () => {
  const s = setup();
  await s.create().authorize(request({ consentScope: undefined }));
  await s
    .create()
    .authorize(request({ consentScope: undefined, operationRunId: 'new-run' }));
  expect(s.confirm).toHaveBeenCalledTimes(2);
  expect(s.receipts.save).not.toHaveBeenCalled();
});

test('denial and cancellation do not create receipts', async () => {
  const s = setup();
  s.confirm.mockResolvedValueOnce(false);
  expect(await s.create().authorize(request())).toBe('renewal_required');
  const controller = new AbortController();
  s.confirm.mockImplementationOnce(async () => {
    controller.abort();
    return true;
  });
  expect(
    await s.create().authorize(request({ signal: controller.signal })),
  ).toBe('renewal_required');
  expect(s.receipts.save).not.toHaveBeenCalled();
});

test('does not authorize a payload changed during asynchronous receipt lookup', async () => {
  const s = setup();
  await s.create().authorize(request());
  const selected = request();
  s.receipts.has.mockImplementationOnce(async () => {
    Object.assign(selected.payload, {
      messages: [{ role: 'user', content: 'Changed during lookup' }],
    });
    return true;
  });
  expect(await s.create().authorize(selected)).toBe('renewal_required');
});

test('revocation invalidates existing in-memory approval as well as durable receipts', async () => {
  const s = setup();
  const registry = s.create();
  await registry.authorize(request());
  beginConsentReset();
  await s.receipts.clear();
  finishConsentReset();
  await registry.authorize(request());
  expect(s.confirm).toHaveBeenCalledTimes(2);
});

test('receipt read failure falls back to explicit consent without saving', async () => {
  const s = setup();
  s.receipts.has.mockRejectedValueOnce(
    new Error('Synthetic unavailable storage'),
  );
  expect(await s.create().authorize(request())).toBe('authorized');
  expect(s.confirm).toHaveBeenCalledTimes(1);
  expect(s.receipts.save).not.toHaveBeenCalled();
});
