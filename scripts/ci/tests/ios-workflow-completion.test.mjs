import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { environment } from './probe-test-environment.mjs';

const mobile = new URL('../../../apps/mobile/', import.meta.url);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const turn = () => new Promise(setImmediate);

const source = (file) => readFileSync(new URL(file, mobile), 'utf8');

test('controlled source modules reject dependencies that were not supplied', () => {
  assert.throws(
    () => environment("import value from './unsupplied'; export { value };"),
    /Unexpected probe dependency: .\/unsupplied/,
  );
});

test('Apple workflow waits beyond the former 90-second probe cap without manufacturing a terminal result', async () => {
  const full = source('e2e/appleWorkflowProbe.ts');
  const match = /async function (\w+)<T>/.exec(full);
  assert.ok(match, 'Expected the workflow observation boundary');
  const helper = full.slice(match.index);
  const clock = environment(helper + '\nexports.run = ' + match[1] + ';');
  const work = deferred();
  let settled = false;
  const pending = clock.exports
    .run(() => work.promise)
    .then((value) => {
      settled = true;
      return value;
    });
  try {
    clock.advance(90_001);
    await turn();
    assert.equal(settled, false);
  } finally {
    work.resolve('actual workflow completion');
  }
  assert.equal(await pending, 'actual workflow completion');
});

test('Calendar import is not aborted by the former 120-second test-only cap', async () => {
  const started = deferred(),
    work = deferred();
  let calls = 0,
    signal;
  const clock = environment(source('e2e/calendarClassificationTestOperation.ts'), {
    '@orot/provider-apple': {
      AppleFoundationModelsProvider: class {
        async getAvailability() {
          return { status: 'available' };
        }
      },
    },
    './appleModelMockBridge': { appleFoundationModelsProbeBridge: {} },
    '../src/medicalAppointments/classificationWorkflow': {
      async classifyCalendarEvents(input) {
        calls += 1;
        signal = input.signal;
        started.resolve();
        if (calls === 1) await work.promise;
        return { status: 'complete', candidates: [{ candidateId: 'calendar-candidate-1' }] };
      },
    },
    '../src/medicalAppointments/saveCalendarCandidate': {
      isConfidentMedical: () => true,
      saveCalendarCandidate: async () => 'saved',
    },
    './calendarClassificationFixtures': {
      createCalendarClassificationFixtures: () => ({
        bridge: {},
        events: [],
        repository: { list: async () => ['saved'] },
      }),
    },
  });
  const pending = clock.exports.runCalendarClassificationTestOperation();
  await started.promise;
  try {
    clock.advance(120_001);
    await turn();
    assert.equal(signal.aborted, false);
  } finally {
    work.resolve();
  }
  assert.equal((await pending).runs.length, 2);
});

function ragFixture(availability = 'available') {
  const started = deferred(),
    work = deferred();
  let signal, forwardedBudget, question;
  // Evaluate real fixture exports through the same closed dependency boundary as the probe.
  const fixture = environment(source('e2e/appleModelMockFixtures.ts')).exports;
  // Resolve the real budget chain; only the extra test-probe deadline is under test.
  const contracts = '../../packages/agent-runtime/src/multiAgent/evidenceContracts.ts';
  const runtime = environment(source(contracts)).exports;
  const shared = environment(source('src/agent/evidenceWorkflowBudget.ts'), {
    '@orot/agent-runtime': runtime,
  }).exports;
  const budget = environment(source('src/ragConversation/budget.ts'), {
    '../agent/evidenceWorkflowBudget': shared,
  }).exports.RAG_CONVERSATION_BUDGET;
  const clock = environment(source('e2e/ragWorkflowProbe.ts'), {
    './appleModelMockFixtures': fixture,
    // This suite observes workflow scheduling; provider transport has its own behavioral tests.
    './europePmcMockTransport': {
      createEuropePmcMockTransport: () => ({ assertComplete() {} }),
      SYNTHETIC_RETRIEVAL_TIME: '2026-10-07T03:00:00.000Z',
    },
    '../src/ragConversation/budget': { RAG_CONVERSATION_BUDGET: budget },
    '@orot/provider-apple': {
      AppleFoundationModelsProvider: class {
        async getAvailability() {
          return { status: availability };
        }
      },
    },
    './appleModelMockBridge': { appleFoundationModelsProbeBridge: {} },
    '../src/externalMedicalEvidence/europePmc': {
      createEuropePmcMedicalEvidenceService: () => ({}),
    },
    '../src/aiFeatures/integration/externalConversationEvidence': {
      createExternalConversationEvidence: () => ({ tool: {}, validates: () => true }),
    },
    '../src/ragConversation/service': {
      async runRagConversationTurn(input, options) {
        question = input.question;
        signal = options.signal;
        forwardedBudget = input.workflow.execution.budget;
        signal.addEventListener('abort', () => work.reject(new Error('owner cancelled work')), {
          once: true,
        });
        started.resolve();
        return work.promise;
      },
    },
  });
  const owner = new AbortController();
  const pending = clock.exports.runRagWorkflowProbe(() => {}, owner.signal);
  return {
    clock,
    owner,
    pending,
    work,
    started,
    signal: () => signal,
    budget,
    fixture,
    question: () => question,
    forwardedBudget: () => forwardedBudget,
  };
}

test('RAG probe preserves the shipping budget and waits beyond its former outer diagnostic cap', async () => {
  const value = ragFixture();
  let settled = false;
  value.pending.then(() => {
    settled = true;
  });
  await value.started.promise;
  try {
    value.clock.advance(120_001);
    await turn();
    assert.equal(settled, false);
    assert.equal(value.signal().aborted, false);
    assert.equal(value.forwardedBudget(), value.budget);
    assert.equal(typeof value.fixture.RAG_WORKFLOW_PUBLIC_QUERY, 'string');
    assert.ok(value.question().includes(`"${value.fixture.RAG_WORKFLOW_PUBLIC_QUERY}"`));
    // The shared shipping policy removed elapsed cutoff; count/size limits and abort still apply.
    assert.equal(value.budget.timeoutMs, null);
  } finally {
    value.work.resolve({ status: 'complete' });
  }
  assert.equal((await value.pending).terminal, 'complete');
});

test('RAG owner cancellation still reaches real work and remains a failed observation', async () => {
  const value = ragFixture();
  await value.started.promise;
  value.owner.abort();
  const result = await value.pending;
  assert.equal(value.signal().aborted, true);
  assert.equal(result.parentAborted, true);
  assert.equal(result.terminal, 'cancelled');
  assert.match(result.failure, /owner cancelled work/);
});

test('unavailable RAG models retain an explicit report without starting workflow work', async () => {
  const value = ragFixture('modelNotReady');
  const result = await value.pending;
  assert.equal(result.availability, 'modelNotReady');
  assert.equal(result.terminal, 'provider-unavailable');
  assert.equal(value.signal(), undefined);
});

test('RAG workflow errors remain failed reports rather than completion', async () => {
  const value = ragFixture();
  await value.started.promise;
  value.work.reject(new Error('actual workflow failure'));
  const result = await value.pending;
  assert.equal(result.terminal, 'probe-error');
  assert.match(result.failure, /actual workflow failure/);
});
