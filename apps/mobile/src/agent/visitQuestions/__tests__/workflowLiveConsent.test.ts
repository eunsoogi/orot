import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';
import { runVisitQuestionWorkflow } from '../workflow';

test('the actual visit consent port can revoke an authorized request before any provider dispatch', async () => {
  const prepared = preparedContext();
  const { provider, requests } = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider);
  let approved: OutboundProcessingRequest | undefined;
  const consent: ExecutionConsentPort = {
    authorize: jest.fn(async request => {
      approved = request;
      return 'authorized';
    }),
    isAuthorizationCurrent: jest.fn(request => {
      expect(request).toBe(approved);
      return false;
    }),
  };
  const fallback = jest.fn(async () => true);
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    recipient: 'synthetic selected account',
    consent,
    confirmConsent: fallback,
  });
  expect(result.status).not.toBe('ready');
  expect(consent.authorize).toHaveBeenCalled();
  expect(consent.isAuthorizationCurrent).toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  expect(requests).toHaveLength(0);
});

test('the visit workflow preserves exact-request subscriptions from the actual port', async () => {
  const prepared = preparedContext();
  const { provider, requests } = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider);
  const approved = new WeakSet<OutboundProcessingRequest>();
  const unsubscribe = jest.fn();
  const consent: ExecutionConsentPort = {
    authorize: async request => {
      approved.add(request);
      return 'authorized';
    },
    isAuthorizationCurrent: request => approved.has(request),
    subscribeAuthorizationInvalidation: jest.fn((request, invalidated) => {
      expect(approved.has(request)).toBe(true);
      approved.delete(request);
      invalidated();
      return unsubscribe;
    }),
  };
  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    recipient: 'synthetic selected account',
    consent,
  });
  expect(result.status).not.toBe('ready');
  expect(consent.subscribeAuthorizationInvalidation).toHaveBeenCalled();
  expect(requests).toHaveLength(0);
  expect(unsubscribe).toHaveBeenCalled();
});
