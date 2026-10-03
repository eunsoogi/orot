const unsafeInstruction = /(?:진단|확진).{0,16}(?:하세요|하십시오|해 주세요|해드릴게요|할게요)|(?:약(?:물)?|복용|용량).{0,20}(?:중단|변경|바꾸|늘리|줄이|증량|감량)(?:하(?:세요|십시오)|시키세요|해 주세요)/u;

export function readVisitQuestionOutput(value: unknown): { questionText: unknown; sourceId: unknown } {
  const output = asRecord(value);
  const question = asRecord(output.question);
  const source = asRecord(output.source);
  return { questionText: question.text, sourceId: source.id };
}

export function validateVisitQuestionOutput(value: unknown, sourceId: string): string {
  const output = readVisitQuestionOutput(value);
  if (output.sourceId !== sourceId) {
    throw new Error('Generated output did not preserve the synthetic source ID.');
  }
  return validateVisitQuestionText(output.questionText);
}

export function validateVisitQuestionText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Generated Korean question is empty.');
  }
  const text = value.trim();
  if (unsafeInstruction.test(text)) {
    throw new Error('Generated question contains diagnosis or medication-change recommendations.');
  }
  if (!/[가-힣]/u.test(text) || !/[?？]$/u.test(text)) {
    throw new Error('Generated output must be a Korean question. Actual synthetic output: ' + JSON.stringify(text));
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Generated output does not match the visit-question structure.');
  }
  return value as Record<string, unknown>;
}
