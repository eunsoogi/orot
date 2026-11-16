import ts from 'typescript';

const displayAttributes = new Set([
  'title',
  'label',
  'accessibilityLabel',
  'accessibilityHint',
  'placeholder',
  'message',
  'status',
  'pipeline',
]);

/** This is a direct-TSX copy guard, not a translator or an audit of model/serialized text. */
export function isShippingTsx(file) {
  const normalized = file.replaceAll('\\', '/');
  return (
    normalized.startsWith('apps/mobile/src/') &&
    normalized.endsWith('.tsx') &&
    !/\.(?:test|spec)\.tsx$/u.test(normalized) &&
    !/(?:^|\/)(?:__tests__|__fixtures__|testSupport|testing|i18n)\//u.test(normalized) &&
    // Explicit development-only probe. Do not exempt arbitrary files named "Probe".
    normalized !== 'apps/mobile/src/encounterReview/NativeReviewProbe.tsx'
  );
}

/** Return locations only. Comments, regular expressions and event-handler strings are not UI copy. */
export function findDirectKoreanCopy(source, file = 'screen.tsx') {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (parsed.parseDiagnostics.length) throw new Error('Cannot audit invalid TSX: ' + file);
  const findings = new Map();
  function literal(node) {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      /[가-힣]/u.test(node.text)
    ) {
      const position = node.getStart(parsed);
      const { line, character } = parsed.getLineAndCharacterOfPosition(position);
      findings.set(position, { line: line + 1, column: character + 1 });
    }
  }
  function expression(node) {
    // Nested JSX is visited separately so event handlers remain excluded.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    literal(node);
    ts.forEachChild(node, expression);
  }
  function visit(node) {
    if (ts.isJsxText(node)) literal(node);
    if (
      ts.isJsxAttribute(node) &&
      displayAttributes.has(node.name.getText(parsed)) &&
      node.initializer
    ) {
      expression(node.initializer);
    }
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression
    ) {
      expression(node.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return [...findings.values()];
}
