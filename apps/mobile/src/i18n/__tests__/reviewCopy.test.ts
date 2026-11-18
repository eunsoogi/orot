import {
  nextVisitQuestionsCopy,
  evidenceCaveatCopy,
} from '../../nextVisitQuestions/copy';
import { reviewCopy } from '../../encounterReview/strings';

// These UI notices describe clinical uncertainty and consent; migration must not
// turn a reviewed transcript into a diagnosis or a confirmed prescription.
test('review copy retains safety and consent boundaries', () => {
  expect(nextVisitQuestionsCopy.clinicalNotice).toBe(
    '이 질문은 진단이 아니며, 의학적 판단을 대신하지 않아요. 정확한 답변은 의료진과 상담하세요.',
  );
  expect(nextVisitQuestionsCopy.generation.consentRequired).toBe(
    '모델 설정에서 선택한 제공자의 전송 범위를 확인하고 동의해 주세요.',
  );
  expect(reviewCopy.boundary).toBe(
    '전사를 검토해 저장하는 기록이에요. 현재 복용 중인 약이나 의사가 발행한 처방으로 확인하지 않으며, 화자는 알 수 없어요.',
  );
  expect(evidenceCaveatCopy.public_search_not_retained).toBe(
    '공개 웹검색은 실행됐지만, 검색 결과는 이 질문에 반영하거나 저장하지 않았어요.',
  );
});

test('question accessibility labels preserve numeric interpolation', () => {
  expect(nextVisitQuestionsCopy.review.questionLabel(2)).toBe('질문 2');
  expect(nextVisitQuestionsCopy.review.rationaleLabel(2)).toBe('질문 2의 이유');
  expect(nextVisitQuestionsCopy.review.remove(2)).toBe('질문 2 삭제');
  expect(nextVisitQuestionsCopy.review.moveUp(2)).toBe('질문 2 위로 이동');
  expect(nextVisitQuestionsCopy.review.moveDown(2)).toBe('질문 2 아래로 이동');
  expect(nextVisitQuestionsCopy.review.count(2)).toBe('2개 질문');
});
