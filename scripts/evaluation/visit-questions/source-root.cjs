'use strict';

const path = require('node:path');

/** Allows a detached #30 checkout to supply the graph while this checkout owns the evaluator. */
function getWorkflowSourceRoot(repositoryRoot, env = process.env) {
  const configuredRoot = env.OROT_VISIT_QUESTION_SOURCE_ROOT?.trim();
  return path.resolve(repositoryRoot, configuredRoot || '.');
}

module.exports = { getWorkflowSourceRoot };
