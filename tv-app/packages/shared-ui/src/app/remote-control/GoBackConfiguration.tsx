import React, { useEffect, useCallback, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import RemoteControlManager from './RemoteControlManager';
import { SupportedKeys } from './SupportedKeys';

type BackHandlerFn = () => void;
const overrides: BackHandlerFn[] = [];

/**
 * Let a screen take over the Back key (e.g. the game pauses instead of leaving).
 * The most recently registered handler wins; it is removed on unmount / when `enabled` is false.
 */
export function useBackOverride(handler: BackHandlerFn, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const fn = () => ref.current();
    overrides.push(fn);
    // Hardware back on Fire TV / Android TV.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      fn();
      return true;
    });
    return () => {
      overrides.splice(overrides.indexOf(fn), 1);
      sub.remove();
    };
  }, [enabled]);
}

export const GoBackConfiguration: React.FC = () => {
  const navigation = useNavigation();

  const handleBackPress = useCallback(() => {
    const override = overrides[overrides.length - 1];
    if (override) return override();
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  useEffect(() => {
    const remoteControlListener = (pressedKey: SupportedKeys) => {
      if (pressedKey === SupportedKeys.Back) {
        handleBackPress();
      }
    };

    RemoteControlManager.addKeydownListener(remoteControlListener);
    return () => RemoteControlManager.removeKeydownListener(remoteControlListener);
  }, [handleBackPress]);

  return null;
};
