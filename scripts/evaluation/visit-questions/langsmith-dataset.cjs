'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { PROJECT_NAME, toLangSmithExample } = require('./privacy');

function datasetIdentity(fixtureSeed, testCases) {
  const content = testCases.map((testCase) => toLangSmithExample(testCase));
  const contentSha256 = createHash('sha256')
    .update(JSON.stringify({ fixtureSeed, examples: content }))
    .digest('hex');
  return {
    name: `${PROJECT_NAME}-${contentSha256.slice(0, 16)}`,
    contentSha256,
  };
}

async function listExamples(client, datasetId) {
  const examples = [];
  for await (const example of client.listExamples({ datasetId })) examples.push(example);
  return examples;
}

function sameFixtureData(actual, expected) {
  // API JSON object key order is not meaningful, but array order and values are.
  return (
    isDeepStrictEqual(actual.inputs, expected.inputs) &&
    isDeepStrictEqual(actual.outputs, expected.outputs)
  );
}

/** Creates or resumes a content-addressed synthetic dataset without overwriting existing rows. */
async function ensureSyntheticDataset(client, fixtureSeed, testCases) {
  const identity = datasetIdentity(fixtureSeed, testCases);
  const exists = await client.hasDataset({ datasetName: identity.name });
  const dataset = exists
    ? await client.readDataset({ datasetName: identity.name })
    : await client.createDataset(identity.name, {
        description: 'Generated Orot visit-question evaluation examples; synthetic data only.',
        dataType: 'kv',
        metadata: { fixtureSeed, fixtureContentSha256: identity.contentSha256 },
      });
  if (!dataset?.id) throw new Error('LangSmith did not return the synthetic dataset identity.');

  const expected = testCases.map((testCase) => toLangSmithExample(testCase, dataset.id));
  const expectedById = new Map(expected.map((example) => [example.id, example]));
  const existingExamples = await listExamples(client, dataset.id);
  const existingById = new Map(existingExamples.map((example) => [example.id, example]));

  for (const example of existingExamples) {
    const expectedExample = expectedById.get(example.id);
    if (!expectedExample || !sameFixtureData(example, expectedExample)) {
      throw new Error('The existing LangSmith dataset does not match this synthetic fixture.');
    }
  }

  const missing = expected.filter((example) => !existingById.has(example.id));
  if (missing.length) await client.createExamples(missing);

  const persisted = await listExamples(client, dataset.id);
  const persistedById = new Map(persisted.map((example) => [example.id, example]));
  if (
    persisted.length !== expected.length ||
    expected.some((example) => {
      const actual = persistedById.get(example.id);
      return !actual || !sameFixtureData(actual, example);
    })
  ) {
    throw new Error('LangSmith did not persist the complete synthetic fixture dataset.');
  }

  return {
    datasetId: dataset.id,
    datasetName: identity.name,
    contentSha256: identity.contentSha256,
    exampleCount: expected.length,
  };
}

module.exports = { datasetIdentity, ensureSyntheticDataset };
