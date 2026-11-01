const path = require('node:path');
const base = require('../metro.config.js');

// Only the opt-in diagnostic bundle wraps the existing visit context loader.
module.exports = {
  ...base,
  resolver: {
    ...base.resolver,
    resolveRequest(context, moduleName, platform) {
      if (
        moduleName === './visitQuestionsContextLoader' &&
        context.originModulePath.endsWith(
          '/aiFeatures/integration/visitQuestionsRouteOperations.ts',
        )
      ) {
        return {
          type: 'sourceFile',
          filePath: path.join(__dirname, 'visitQuestionScopeContext.ts'),
        };
      }
      return base.resolver.resolveRequest(context, moduleName, platform);
    },
  },
};
