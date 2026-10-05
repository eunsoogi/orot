import type { ProviderError } from '@orot/model-runtime';
import type { ChatGPTPlanNativeError } from './native-contract';

export function toProviderError(value: unknown): ProviderError {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const nested =
    typeof record.error === 'object' && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record;
  const userInfo =
    typeof nested.userInfo === 'object' && nested.userInfo !== null
      ? (nested.userInfo as Record<string, unknown>)
      : {};
  const nestedCode = typeof nested.code === 'string' ? nested.code : undefined;
  const details: ChatGPTPlanNativeError = {
    kind:
      typeof nested.kind === 'string'
        ? (nested.kind as ChatGPTPlanNativeError['kind'])
        : typeof userInfo.kind === 'string'
          ? (userInfo.kind as ChatGPTPlanNativeError['kind'])
          : undefined,
    httpStatusCode:
      typeof nested.httpStatusCode === 'number'
        ? nested.httpStatusCode
        : typeof userInfo.httpStatusCode === 'number'
          ? userInfo.httpStatusCode
          : undefined,
    code:
      nestedCode && nestedCode !== 'CHATGPT_PROVIDER_ERROR'
        ? nestedCode
        : typeof userInfo.code === 'string'
          ? userInfo.code
          : nestedCode,
  };
  if (
    details.kind === 'usage_limit' ||
    details.code === 'rate_limited' ||
    details.code === 'subscription_sharing_usage_limit_exceeded' ||
    details.httpStatusCode === 429
  ) {
    return {
      code: 'rate_limited',
      message: 'The ChatGPT plan usage limit was reached.',
      retryable: false,
    };
  }
  if (
    details.kind === 'unsupported_capability' ||
    details.code === 'subscription_sharing_unsupported_capability'
  ) {
    return {
      code: 'unsupported_capability',
      message: 'This request uses a capability unavailable on the ChatGPT plan route.',
      retryable: false,
    };
  }
  if (details.kind === 'unsupported_input') {
    return {
      code: 'unsupported_input',
      message: 'This input type is unavailable on the ChatGPT plan route.',
      retryable: false,
    };
  }
  if (
    details.kind === 'authentication' ||
    details.httpStatusCode === 401 ||
    details.code === 'subscription_sharing_invalid_user' ||
    details.code === 'chatpass_v2_scope_not_authorized' ||
    details.code === 'chatpass_v2_invalid_authorization_context'
  ) {
    return {
      code: 'authentication_required',
      message: 'The selected ChatGPT account did not authorize this request.',
      retryable: false,
    };
  }
  if (details.kind === 'invalid_request' || details.httpStatusCode === 400) {
    return {
      code: 'invalid_request',
      message: 'The ChatGPT request is invalid for the selected route.',
      retryable: false,
    };
  }
  if (
    details.kind === 'transport' ||
    details.kind === 'usage_unavailable' ||
    details.httpStatusCode === 503 ||
    (details.httpStatusCode !== undefined && details.httpStatusCode >= 500) ||
    details.httpStatusCode === 500 ||
    details.code === 'subscription_sharing_usage_unavailable' ||
    details.code === 'subscription_sharing_user_unavailable'
  ) {
    return {
      code: 'provider_unavailable',
      message: 'ChatGPT plan inference is temporarily unavailable.',
      retryable: true,
    };
  }
  const retryable = details.kind !== 'incomplete' && details.kind !== 'interrupted';
  return {
    code: 'provider_unavailable',
    message: retryable
      ? 'ChatGPT could not complete the request.'
      : 'ChatGPT ended before completing the response.',
    retryable,
  };
}
