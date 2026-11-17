import ts from 'typescript';
import { displayCopyAliases } from './ui-copy-aliases.mjs';

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
  const alias = displayCopyAliases(parsed);
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
  // Follow only display-producing scalar branches, not conditions, call arguments or object fields.
  function scalar(node) {
    literal(node);
    const value = alias(node);
    if (value) scalar(value);
    if (ts.isConditionalExpression(node)) {
      scalar(node.whenTrue);
      scalar(node.whenFalse);
    } else if (ts.isTemplateExpression(node)) {
      literal(node.head);
      for (const span of node.templateSpans) {
        scalar(span.expression);
        literal(span.literal);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.PlusToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(node.operatorToken.kind)
    ) {
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) scalar(node.left);
      scalar(node.right);
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      scalar(node.expression);
    }
  }
  function expression(node, resolveAliases = true) {
    // Nested JSX is visited separately so event handlers remain excluded.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    literal(node);
    const value = resolveAliases ? alias(node) : undefined;
    if (value) scalar(value);
    // A member name or object initializer is not the displayed property's value.
    const opaque =
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node) ||
      ts.isNewExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node) ||
      ts.isTypeOfExpression(node) ||
      ts.isVoidExpression(node) ||
      ts.isDeleteExpression(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node);
    ts.forEachChild(node, (child) => {
      let follow = resolveAliases && !opaque;
      if (ts.isConditionalExpression(node) && child === node.condition) follow = false;
      if (ts.isBinaryExpression(node)) {
        const kind = node.operatorToken.kind;
        follow &&= [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
        ].includes(kind);
        if (kind === ts.SyntaxKind.AmpersandAmpersandToken && child === node.left) follow = false;
      }
      expression(child, follow);
    });
  }
  // JSX object spreads bypass JsxAttribute nodes. Inspect only explicit display fields;
  // never resolve a props object, computed key, getter or nested spread as user-facing copy.
  function displaySpread(node) {
    let value = node.expression;
    while (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isNonNullExpression(value)
    )
      value = value.expression;
    if (!ts.isObjectLiteralExpression(value)) return;
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
        continue;
      if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue;
      if (!displayAttributes.has(property.name.text)) continue;
      scalar(ts.isPropertyAssignment(property) ? property.initializer : property.name);
    }
  }
  function visit(node) {
    if (ts.isJsxText(node)) literal(node);
    if (ts.isJsxSpreadAttribute(node)) displaySpread(node);
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
