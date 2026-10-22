import { SupportedKeys } from './SupportedKeys';

export type KeydownListener = (event: SupportedKeys) => void;

export interface RemoteControlManagerInterface {
  addKeydownListener: (listener: KeydownListener) => KeydownListener;
  removeKeydownListener: (listener: KeydownListener) => void;
  emitKeyDown: (event: SupportedKeys) => void;
}
