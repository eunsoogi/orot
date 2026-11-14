import { createEuropePmcEvidenceSearchTool } from '../src';
import type { EvidenceSearchRequest } from '../src';

function fixture() {
  const controller = new AbortController();
  const search = jest.fn(async () => ({ status: 'empty' as const }));
  const authorize = jest.fn(async () => 'authorized' as const);
  const tool = createEuropePmcEvidenceSearchTool({ service: { search }, consent: { authorize } });
  const request: EvidenceSearchRequest = {
    operationRunId: 'synthetic-run',
    operationKey: 'tool-1',
    input: { query: 'synthetic query' },
    allowedScope: { sourceKinds: ['external_medical'] },
    resultLimit: 1,
    maxPayloadBytes: 65536,
    signal: controller.signal,
  };
  return { tool, request, search, authorize, controller };
}

test('prepared external approval dispatches once and never authorizes a second query', async () => {
  const f = fixture();
  const grant = await f.tool.prepareAuthorizedSearch!(f.request);
  if (grant.status !== 'authorized') throw new Error('Expected one-shot grant');
  expect(f.search).not.toHaveBeenCalled();
  expect(await grant.dispatch()).toHaveProperty('items');
  expect(await grant.dispatch()).toEqual({ status: 'consent_required' });
  expect(f.search).toHaveBeenCalledTimes(1);
});

test('query mutation after approval consumes the grant without dispatch', async () => {
  const f = fixture();
  const grant = await f.tool.prepareAuthorizedSearch!(f.request);
  if (grant.status !== 'authorized') throw new Error('Expected one-shot grant');
  f.request.input.query = 'changed query';
  expect(await grant.dispatch()).toEqual({ status: 'consent_required' });
  f.request.input.query = 'synthetic query';
  expect(await grant.dispatch()).toEqual({ status: 'consent_required' });
  expect(f.search).not.toHaveBeenCalled();
});

test('Stop after approval invalidates the live grant', async () => {
  const f = fixture();
  const grant = await f.tool.prepareAuthorizedSearch!(f.request);
  if (grant.status !== 'authorized') throw new Error('Expected one-shot grant');
  f.controller.abort();
  expect(await grant.dispatch()).toEqual({ status: 'consent_required' });
  expect(f.search).not.toHaveBeenCalled();
});
