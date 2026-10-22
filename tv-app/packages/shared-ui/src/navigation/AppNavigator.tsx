import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { Platform } from 'react-native';
import { GoBackConfiguration } from '../app/remote-control/GoBackConfiguration';
import { RoomProvider } from '../rc/RoomContext';
import { palette } from '../rc/config';
import RootNavigator from './RootNavigator';
import { ObjectArrival } from '../rc/ObjectArrival';
import { HelpOverlay } from '../rc/HelpOverlay';
import { AlertOverlay } from '../rc/AlertOverlay';
import { RecoverOverlay } from '../rc/RecoverOverlay';

export interface AppNavigatorProps {
  fontsLoaded?: boolean;
  onReady?: () => void;
}

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: palette.bg, card: palette.bg } };

export default function AppNavigator({ fontsLoaded = true, onReady }: AppNavigatorProps) {
  useEffect(() => {
    // Import remote control config for TV platforms
    if (Platform.isTV) {
      try {
        require('../app/configureRemoteControl');
      } catch (error) {
        console.warn('Remote control configuration not available:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (fontsLoaded && onReady) {
      onReady();
    }
  }, [fontsLoaded, onReady]);

  if (!fontsLoaded) {
    return null;
  }

  // Note: no StrictMode wrapper — its double-invoked effects would open two rooms on start.
  return (
    <NavigationContainer theme={theme}>
      <RoomProvider>
        <GoBackConfiguration />
        <RootNavigator />
        <ObjectArrival />
        <RecoverOverlay />
        <AlertOverlay />
        <HelpOverlay />
      </RoomProvider>
    </NavigationContainer>
  );
}
