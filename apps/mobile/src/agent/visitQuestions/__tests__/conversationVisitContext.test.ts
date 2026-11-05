import { prepareVisitQuestionContext } from '../evidenceService';
import { runVisitQuestionWorkflow } from '../workflow';
import { appointment, now, ports } from '../testing/evidenceServiceFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

test('pins the selected visit and rejects later changes without selecting the next visit', async () => {
  const dependencies = ports();
  let selected = { ...appointment, id: 'selected-visit' };
  const repository = {
    ...dependencies.repository,
    get: jest.fn(async () => selected),
  } as unknown as typeof dependencies.repository;
  const result = await prepareVisitQuestionContext({
    ...dependencies,
    repository,
    now,
    maxEvidenceItems: 8,
    buildChunks: async () => [],
    currentTime: () => now,
    appointmentId: selected.id,
  });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('selected visit unavailable');
  expect(result.appointment.id).toBe('selected-visit');
  expect(
    dependencies.queryService.queryNextConfirmedCalendarAppointment,
  ).not.toHaveBeenCalled();
  expect(await result.revalidateEvidence([], { allowEmpty: true })).toBe(true);
  selected = { ...selected, note: 'changed' };
  expect(await result.revalidateEvidence([], { allowEmpty: true })).toBe(false);
});

test('a missing selected visit never falls back to another appointment', async () => {
  const dependencies = ports();
  const result = await prepareVisitQuestionContext({
    ...dependencies,
    now,
    maxEvidenceItems: 8,
    appointmentId: 'missing-visit',
    buildChunks: async () => [],
  });
  expect(result.status).toBe('no_confirmed_upcoming_appointment');
  expect(
    dependencies.queryService.queryNextConfirmedCalendarAppointment,
  ).not.toHaveBeenCalled();
});

test('passes the actual edited conversation request into visit question generation', async () => {
  const prepared = preparedContext();
  const { provider, requests } = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider, 'on-device');
  const request =
    '다음 진료에서 약 복용 시간에 관해 물어볼 질문을 준비해 주세요.';
  await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    request,
  });
  expect(JSON.stringify(requests)).toContain(request);
});
