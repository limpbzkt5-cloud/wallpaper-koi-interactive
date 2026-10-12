/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    isElectron: boolean;
    onSuspend: (callback: () => void) => void;
    onResume: (callback: () => void) => void;
    toggleInteractiveMode: () => Promise<boolean>;
    toggleFullscreen: () => Promise<boolean>;
    minimize: () => Promise<void>;
    close: () => Promise<void>;
  };
  livelyPropertyListener?: (name: string, val: any) => void;
}
