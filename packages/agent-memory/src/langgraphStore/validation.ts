/** Validates a batch's full input before the backend applies any operation. */
import type { ListNamespacesOperation, Operation } from '@langchain/langgraph';
import { cloneJsonObject, validateFilter } from './filters';
import { validateMatchConditions, validateNamespace } from './namespace';

export function validateOperation(operation: Operation): void {
  if ('namespacePrefix' in operation) {
    validateNamespace(operation.namespacePrefix, true);
    validatePage(operation.limit, operation.offset);
    validateFilter(operation.filter);
    if (operation.query !== undefined && typeof operation.query !== 'string') {
      throw new Error('Search queries must be strings.');
    }
    return;
  }
  if ('value' in operation) {
    validateNamespace(operation.namespace);
    if (typeof operation.key !== 'string') throw new Error('Store keys must be strings.');
    if (operation.value !== null) cloneJsonObject(operation.value);
    if (
      operation.index !== undefined &&
      operation.index !== false &&
      !Array.isArray(operation.index)
    ) {
      throw new Error('Index must be false or an array of field paths.');
    }
    if (
      Array.isArray(operation.index) &&
      !operation.index.every((path) => typeof path === 'string')
    ) {
      throw new Error('Index paths must be strings.');
    }
    return;
  }
  if ('namespace' in operation && 'key' in operation) {
    validateNamespace(operation.namespace);
    if (typeof operation.key !== 'string') throw new Error('Store keys must be strings.');
    return;
  }
  if ('limit' in operation && 'offset' in operation) {
    const listOperation = operation as ListNamespacesOperation;
    validateMatchConditions(listOperation.matchConditions);
    validatePage(listOperation.limit, listOperation.offset);
    if (
      listOperation.maxDepth !== undefined &&
      (!Number.isInteger(listOperation.maxDepth) || listOperation.maxDepth < 0)
    ) {
      throw new Error('Namespace maxDepth must be a non-negative integer.');
    }
    return;
  }
  throw new Error('Unsupported LangGraph store operation.');
}

function validatePage(limit: number | undefined, offset: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error('Store limit must be a non-negative integer.');
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error('Store offset must be a non-negative integer.');
  }
}
