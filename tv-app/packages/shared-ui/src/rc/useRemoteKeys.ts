import { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { useRoom } from './RoomContext';

/** Raw remote keys for a screen that is not a list of buttons (the captions view). Only while the screen is focused. */
export function useRemoteKeys(handler: (key: SupportedKeys) => void) {
  const focused = useIsFocused();
  const { helpOpen: help, alertOpen, recoverOpen } = useRoom();
  const helpOpen = help || alertOpen || recoverOpen;
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    // The help screen owns the remote while it is up.
    if (!focused || helpOpen) return;
    const listener = RemoteControlManager.addKeydownListener((k) => ref.current(k));
    return () => RemoteControlManager.removeKeydownListener(listener);
  }, [focused, helpOpen]);
}

export { SupportedKeys };
