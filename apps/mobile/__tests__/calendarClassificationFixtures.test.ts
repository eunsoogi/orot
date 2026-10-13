import { createCalendarClassificationFixtures } from '../e2e/calendarClassificationFixtures';
import { saveCalendarCandidate } from '../src/medicalAppointments/saveCalendarCandidate';
import type { CandidateReview } from '../src/medicalAppointments/classificationWorkflow';

it('retains the original three Korean examples, occurrence times and complete Calendar query', async () => {
  const now = Date.parse('2035-06-01T12:00:00.000Z');
  const fixture = createCalendarClassificationFixtures(now);
  expect(
    fixture.events.map(event => event.calendarEventSnapshot.title),
  ).toEqual(['내과 진료', '팀 점심', '방문 일정']);
  expect(fixture.events.map(event => event.effectiveAt)).toEqual([
    '2035-06-02T00:00:00.000Z',
    '2035-06-03T00:00:00.000Z',
    '2035-06-04T00:00:00.000Z',
  ]);
  for (const event of fixture.events) {
    expect(Date.parse(event.endsAt) - Date.parse(event.effectiveAt)).toBe(
      3600000,
    );
    expect(event.calendarEventSnapshot.timeZoneIdentifier).toBe('Asia/Seoul');
    expect(event.calendarEventSnapshot.occurrenceDate).toBeNull();
    expect(
      (
        await fixture.bridge.findEvent(
          event.calendarEventIdentifier,
          null,
          null,
        )
      ).event,
    ).toEqual(event);
  }
  const source = await fixture.bridge.requestAccessAndListUpcomingEvents();
  expect(source.access).toBe('fullAccess');
  expect(source.query).toEqual({
    fromInclusive: new Date(now).toISOString(),
    toExclusive: new Date(now + 365 * 86400000).toISOString(),
    horizonYears: 1,
    resultLimit: null,
    complete: true,
    omittedEventCount: 0,
  });
});

it('uses the shipping save and domain update paths without duplicating the session occurrence', async () => {
  const fixture = createCalendarClassificationFixtures();
  const candidate: CandidateReview = {
    candidateId: 'calendar-candidate-1',
    event: fixture.events[0]!,
    status: 'classified',
    classification: 'medical',
    uncertainty: 'low',
    reason: 'Synthetic fixture only',
  };
  expect(
    await saveCalendarCandidate(candidate, fixture.repository, fixture.bridge),
  ).toBe('saved');
  expect(
    await saveCalendarCandidate(candidate, fixture.repository, fixture.bridge),
  ).toBe('saved');
  const saved = await fixture.repository.list();
  expect(saved).toHaveLength(1);
  expect(saved[0]?.id).toBe('synthetic-appointment-1');
  expect(saved[0]?.calendarEventIdentifier).toBe('synthetic-calendar-0');
  await fixture.repository.cancel(saved[0]!.id);
  expect(
    await saveCalendarCandidate(candidate, fixture.repository, fixture.bridge),
  ).toBe('preserved');
  expect(await fixture.repository.list()).toHaveLength(1);
  expect(
    await createCalendarClassificationFixtures().repository.list(),
  ).toEqual([]);
});
