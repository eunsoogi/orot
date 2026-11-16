import {
  classifyCalendarDecisions,
  validateCalendarDecisionCandidates,
} from '../src/calendarDecisions';
const candidates = [
  {
    candidateId: 'calendar-candidate-1',
    event: {
      candidateId: 'calendar-candidate-1',
      title: 'Synthetic clinic appointment',
      startsAt: '2026-11-18T10:00:00Z',
      endsAt: '2026-11-18T11:00:00Z',
      isAllDay: false,
      timeZone: 'UTC',
    },
  },
];
const answer = {
  model: 'gpt-6-luna',
  answers: [{ type: 'choice', name: 'calendar-candidate-1', choice: 'medical_low' }],
};
it('sends only bounded candidate evidence and nine fixed choices', async () => {
  const transport = jest.fn(async () => answer);
  await expect(classifyCalendarDecisions(candidates, transport)).resolves.toEqual({
    classifications: [{ candidateId: 'calendar-candidate-1', decision: 'medical_low' }],
  });
  const body = JSON.parse(transport.mock.calls[0]![0] as string);
  expect(body.model).toBe('gpt-6-luna');
  expect(body.questions[0]).toMatchObject({ type: 'choice', name: 'calendar-candidate-1' });
  expect(body.questions[0].choices).toHaveLength(9);
  expect(Object.keys(body).sort()).toEqual(['input', 'model', 'questions']);
});
it('rejects extra private fields, duplicated IDs and oversized evidence before transport', async () => {
  const transport = jest.fn();
  expect(validateCalendarDecisionCandidates([...candidates, ...candidates])).toBe(false);
  await expect(
    classifyCalendarDecisions([{ ...candidates[0]!, privateId: 'forbidden' }] as never, transport),
  ).rejects.toThrow();
  await expect(
    classifyCalendarDecisions(
      [{ ...candidates[0]!, event: { ...candidates[0]!.event, title: 'x'.repeat(2001) } }],
      transport,
    ),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it.each([
  { ...answer, model: 'different' },
  { ...answer, answers: [] },
  { ...answer, answers: [{ type: 'refusal', name: 'calendar-candidate-1' }] },
  { ...answer, answers: [{ type: 'choice', name: 'unknown', choice: 'medical_low' }] },
  { ...answer, answers: [{ type: 'choice', name: 'calendar-candidate-1', choice: 'invented' }] },
])('fails closed for incomplete, refused or mismatched answers', async (payload) => {
  await expect(classifyCalendarDecisions(candidates, async () => payload)).rejects.toThrow(
    'response invalid',
  );
});
it('does not expose provider errors or publish a late aborted response', async () => {
  await expect(
    classifyCalendarDecisions(candidates, async () => {
      throw new Error('secret-private-title');
    }),
  ).rejects.toThrow('Calendar decision transport unavailable');
  const controller = new AbortController();
  await expect(
    classifyCalendarDecisions(
      candidates,
      async () => {
        controller.abort();
        return answer;
      },
      controller.signal,
    ),
  ).rejects.toThrow();
});
