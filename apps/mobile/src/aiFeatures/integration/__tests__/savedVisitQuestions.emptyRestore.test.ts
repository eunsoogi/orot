import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { restoreSavedVisitQuestions } from '../savedVisitQuestions';
import {
  question,
  repositories,
} from '../testSupport/savedVisitQuestionsTestSupport';

/** A different appointment's saved rows must not create a restoration warning for this empty list. */
test.each([false, true])(
  'does not warn about absent metadata when the current appointment has no saved questions (other rows: %s)',
  async hasOtherRows => {
    const { records, sourceReader } = repositories({
      questions: hasOtherRows
        ? [question('other-question', 'other-appointment', 1, [])]
        : [],
      spans: [],
      sources: [],
    });
    const restored = await restoreSavedVisitQuestions({
      appointmentId: 'appointment-without-questions',
      records,
      sourceReader,
      registry: new LocalEvidenceReferenceRegistry(),
    });
    expect(restored.questions).toEqual([]);
    expect(restored.restorationNotice).toBe('');
  },
);
