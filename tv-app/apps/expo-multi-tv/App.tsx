import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppNavigator } from '@multi-tv/shared-ui';
import { LogBox } from 'react-native';
import '../../packages/shared-ui/src/app/configureRemoteControl';

// Suppress specific deprecation warnings that don't affect functionality
// These warnings come from libraries using deprecated React methods
if (__DEV__) {
  // Suppress in LogBox
  LogBox.ignoreLogs([
    /findNodeHandle is deprecated/,
    /findHostInstance_DEPRECATED is deprecated/,
  ]);

  // Also suppress at console level for warnings that slip through
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args[0]?.toString() || '';
    if (
      message.includes('findNodeHandle is deprecated') ||
      message.includes('findHostInstance_DEPRECATED is deprecated')
    ) {
      return;
    }
    originalWarn(...args);
  };
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function App() {
  // One family name per weight file (fontWeight with custom fonts is unreliable on Android).
  // Static instances of the OFL fonts from github.com/google/fonts; see assets/fonts/README.txt.
  const [loaded, error] = useFonts({
    SpaceMono: require('./assets/fonts/SpaceMono-Regular.ttf'),
    'Baloo2-Bold': require('./assets/fonts/Baloo2-Bold.ttf'),
    'Baloo2-ExtraBold': require('./assets/fonts/Baloo2-ExtraBold.ttf'),
    'NotoSans-Regular': require('./assets/fonts/NotoSans-Regular.ttf'),
    'NotoSans-SemiBold': require('./assets/fonts/NotoSans-SemiBold.ttf'),
    'NotoSans-Bold': require('./assets/fonts/NotoSans-Bold.ttf'),
    'NotoSansDevanagari-Regular': require('./assets/fonts/NotoSansDevanagari-Regular.ttf'),
    'NotoSansDevanagari-SemiBold': require('./assets/fonts/NotoSansDevanagari-SemiBold.ttf'),
    'NotoSansDevanagari-Bold': require('./assets/fonts/NotoSansDevanagari-Bold.ttf'),
    'NotoSansTamil-Regular': require('./assets/fonts/NotoSansTamil-Regular.ttf'),
    'NotoSansTamil-SemiBold': require('./assets/fonts/NotoSansTamil-SemiBold.ttf'),
    'NotoSansTamil-Bold': require('./assets/fonts/NotoSansTamil-Bold.ttf'),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
      if (error) {
        console.warn(`Error in loading fonts: ${error}`);
      }
    }
  }, [loaded, error]);

  return <AppNavigator fontsLoaded={loaded || !!error} />;
}
