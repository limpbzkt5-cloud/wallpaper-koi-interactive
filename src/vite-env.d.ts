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
  wallpaperPropertyListener?: {
    applyUserProperties?: (properties: Record<string, { value: any }>) => void;
    applyGeneralProperties?: (properties: Record<string, any>) => void;
    setPaused?: (isPaused: boolean) => void;
  };
  _pendingWallpaperProperties?: Record<string, { value: any }> | null;
  _pendingGeneralProperties?: Record<string, any> | null;
  _pendingWallpaperPaused?: boolean | null;
  _pendingLivelyProperties?: Array<{ name: string; val: any }>;
  _onWallpaperProperties?: (properties: Record<string, { value: any }>) => void;
  _onGeneralProperties?: (properties: Record<string, any>) => void;
  _onWallpaperPaused?: (isPaused: boolean) => void;
  _onLivelyProperty?: (name: string, val: any) => void;
}
