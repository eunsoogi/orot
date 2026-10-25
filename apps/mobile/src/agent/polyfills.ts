// LangGraph's checkpoint serializer decodes persisted UTF-8 JSON through TextDecoder.
import 'fast-text-encoding';
import 'web-streams-polyfill/polyfill';
import 'react-native-get-random-values';

// LangSmith's runtime detection calls navigator.userAgent.includes('jsdom')
// when React Native exposes navigator without a userAgent string.
if (
  typeof navigator !== 'undefined' &&
  typeof navigator.userAgent !== 'string'
) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'React Native',
  });
}
