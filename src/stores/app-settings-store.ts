// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";

export interface ResourceSharingSettings {
  shareCharacters: boolean;
  shareScenes: boolean;
  shareMedia: boolean;
}

export interface StoragePathSettings {
  basePath: string;
}

export interface CacheSettings {
  autoCleanEnabled: boolean;
  autoCleanDays: number;
}

export interface TestModeSettings {
  enabled: boolean;
  latencyMs: number;
}

interface AppSettingsState {
  resourceSharing: ResourceSharingSettings;
  storagePaths: StoragePathSettings;
  cacheSettings: CacheSettings;
  testMode: TestModeSettings;
}

interface AppSettingsActions {
  setResourceSharing: (settings: Partial<ResourceSharingSettings>) => void;
  setStoragePaths: (paths: Partial<StoragePathSettings>) => void;
  setCacheSettings: (settings: Partial<CacheSettings>) => void;
  setTestMode: (settings: Partial<TestModeSettings>) => void;
}

const defaultState: AppSettingsState = {
  resourceSharing: {
    shareCharacters: false,
    shareScenes: false,
    shareMedia: false,
  },
  storagePaths: {
    basePath: "",
  },
  cacheSettings: {
    autoCleanEnabled: false,
    autoCleanDays: 30,
  },
  testMode: {
    enabled: false,
    latencyMs: 400,
  },
};

export const useAppSettingsStore = create<AppSettingsState & AppSettingsActions>()(
  persist(
    (set) => ({
      ...defaultState,
      setResourceSharing: (settings) =>
        set((state) => ({
          resourceSharing: { ...state.resourceSharing, ...settings },
        })),
      setStoragePaths: (paths) =>
        set((state) => ({
          storagePaths: { ...state.storagePaths, ...paths },
        })),
      setCacheSettings: (settings) =>
        set((state) => ({
          cacheSettings: { ...state.cacheSettings, ...settings },
        })),
      setTestMode: (settings) =>
        set((state) => ({
          testMode: { ...state.testMode, ...settings },
        })),
    }),
    {
      name: "mumu-app-settings",
      storage: createJSONStorage(() => fileStorage),
      version: 2,
      migrate: (persisted: unknown, version) => {
        const persistedState =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<AppSettingsState>)
            : {};

        const merged: AppSettingsState = {
          ...defaultState,
          ...persistedState,
          resourceSharing: {
            ...defaultState.resourceSharing,
            ...(persistedState.resourceSharing || {}),
          },
          storagePaths: {
            ...defaultState.storagePaths,
            ...(persistedState.storagePaths || {}),
          },
          cacheSettings: {
            ...defaultState.cacheSettings,
            ...(persistedState.cacheSettings || {}),
          },
          testMode: {
            ...defaultState.testMode,
            ...(persistedState.testMode || {}),
          },
        };

        // v2: isolate resources by default to avoid cross-project data leakage.
        // Users can still re-enable sharing in Settings.
        if ((version ?? 0) < 2) {
          merged.resourceSharing = { ...defaultState.resourceSharing };
        }

        return merged;
      },
    }
  )
);
