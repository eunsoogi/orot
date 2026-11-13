import { AppRegistry } from 'react-native';
import { name as appName } from '../app.json';
import App from '../App';
import { openAiFeatureLocalData } from '../src/aiFeatures/integration/localData';

// Keep the real protected store and hold only the synthetic availability query.
const loadLocalData = async () => {
  const data = await openAiFeatureLocalData();
  return {
    ...data,
    repository: new Proxy(data.repository, {
      get(target, property, receiver) {
        if (property === 'readInventory')
          return () => new Promise<never>(() => {});
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
};

// The test entry changes no store or gate; its owned container supplies isolation.
function AssistantAcceptanceApp() {
  return <App aiFeatureServiceDependencies={{ loadLocalData }} />;
}

AppRegistry.registerComponent(appName, () => AssistantAcceptanceApp);
