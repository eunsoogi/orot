import { homeConversationVisitFixture } from '../e2e/homeConversationVisitFixture';
import { canGenerateHomeVisit } from '../src/routes/HomeVisitQuestionsRoute';

test('opts in to one future confirmed visit eligible for the Home conversation route', () => {
  const now = Date.parse('2035-01-01T00:00:00.000Z');
  expect(homeConversationVisitFixture(undefined, now)).toEqual([]);
  const appointments = homeConversationVisitFixture('YES', now);
  expect(appointments).toHaveLength(1);
  expect(canGenerateHomeVisit(appointments[0]!, now)).toBe(true);
});
