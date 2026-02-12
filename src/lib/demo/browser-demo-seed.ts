// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Browser-mode demo seeding
 *
 * Why:
 * - Electron app seeds demo data via main process + file storage.
 * - MCP/Playwright opens plain browser mode (no window.fileStorage), so demo would be missing.
 *
 * Behavior:
 * - First browser run: ensure demo project exists in localStorage.
 * - Later runs: if user deleted demo project, do NOT auto-add it back.
 * - If demo project still exists, repair only missing per-project/shared keys.
 */

import demoProjectStore from "../../../demo-data/projects/moyin-project-store.json";
import demoCharacterLibrary from "../../../demo-data/projects/moyin-character-library.json";
import demoScript from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/script.json";
import demoDirector from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/director.json";
import demoCharacters from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/characters.json";
import demoScenes from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/scenes.json";
import demoMedia from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/media.json";
import demoSClass from "../../../demo-data/projects/_p/a4bbe260-0127-49c7-9230-e766402663c7/sclass.json";
import demoSharedCharacters from "../../../demo-data/projects/_shared/characters.json";
import demoSharedScenes from "../../../demo-data/projects/_shared/scenes.json";
import demoSharedMedia from "../../../demo-data/projects/_shared/media.json";

type ProjectEntry = {
  id: string;
  [key: string]: unknown;
};

type ProjectIndexState = {
  projects?: ProjectEntry[];
  activeProjectId?: string | null;
  [key: string]: unknown;
};

type ProjectIndexStore = {
  state?: ProjectIndexState;
  version?: number;
} & ProjectIndexState;

const BROWSER_SEED_MARKER_KEY = "mumu-browser-demo-seeded-v1";
const PROJECT_STORE_KEYS = ["mumu-project-store", "moyin-project-store"];
const CHARACTER_STORE_KEYS = ["mumu-character-library", "moyin-character-library"];
const DEMO_PROJECT_ID = "a4bbe260-0127-49c7-9230-e766402663c7";

const DEMO_PROJECT_PAYLOADS: Record<string, string> = {
  [`_p/${DEMO_PROJECT_ID}/script`]: JSON.stringify(demoScript),
  [`_p/${DEMO_PROJECT_ID}/director`]: JSON.stringify(demoDirector),
  [`_p/${DEMO_PROJECT_ID}/characters`]: JSON.stringify(demoCharacters),
  [`_p/${DEMO_PROJECT_ID}/scenes`]: JSON.stringify(demoScenes),
  [`_p/${DEMO_PROJECT_ID}/media`]: JSON.stringify(demoMedia),
  [`_p/${DEMO_PROJECT_ID}/sclass`]: JSON.stringify(demoSClass),
};

const DEMO_SHARED_PAYLOADS: Record<string, string> = {
  "_shared/characters": JSON.stringify(demoSharedCharacters),
  "_shared/scenes": JSON.stringify(demoSharedScenes),
  "_shared/media": JSON.stringify(demoSharedMedia),
};

function parseJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getFirstExisting(keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) return { key, value };
  }
  return null;
}

function writeCompat(keys: string[], payload: string): void {
  for (const key of keys) {
    localStorage.setItem(key, payload);
  }
}

function ensureCharacterStoreCompatibility(): void {
  const existing = getFirstExisting(CHARACTER_STORE_KEYS);
  const payload = existing?.value ?? JSON.stringify(demoCharacterLibrary);
  writeCompat(CHARACTER_STORE_KEYS, payload);
}

/**
 * Seed demo data for plain browser mode (non-Electron).
 */
export function seedDemoForBrowserMode(): void {
  if (typeof window === "undefined") return;
  if (window.fileStorage) return;

  try {
    const markerExists = !!localStorage.getItem(BROWSER_SEED_MARKER_KEY);
    const demoStore = demoProjectStore as ProjectIndexStore;
    const demoState = (demoStore.state || demoStore) as ProjectIndexState;
    const demoProjects = Array.isArray(demoState.projects) ? demoState.projects : [];
    if (demoProjects.length === 0) return;

    const existingStoreEntry = getFirstExisting(PROJECT_STORE_KEYS);
    const currentStore = parseJSON<ProjectIndexStore>(existingStoreEntry?.value ?? null) ?? {
      state: { projects: [], activeProjectId: null },
      version: 0,
    };
    const currentState = (currentStore.state || currentStore) as ProjectIndexState;
    const currentProjects = Array.isArray(currentState.projects) ? [...currentState.projects] : [];

    const demoIds = new Set(demoProjects.map((p) => p.id));
    const currentHasDemo = currentProjects.some((p) => demoIds.has(p.id));
    const allowAddDemo = !markerExists || currentHasDemo;
    const seen = new Set(currentProjects.map((p) => p.id));

    let addedCount = 0;
    if (allowAddDemo) {
      for (const project of demoProjects) {
        if (!seen.has(project.id)) {
          currentProjects.push(project);
          seen.add(project.id);
          addedCount++;
        }
      }
    }

    const mergedStore: ProjectIndexStore = {
      state: {
        ...currentState,
        projects: currentProjects,
        activeProjectId:
          currentState.activeProjectId || demoState.activeProjectId || currentProjects[0]?.id || null,
      },
      version:
        typeof currentStore.version === "number" ? currentStore.version : (demoStore.version ?? 0),
    };

    const hasCompatProjectStores = PROJECT_STORE_KEYS.every((key) => !!localStorage.getItem(key));
    if (addedCount > 0 || !hasCompatProjectStores) {
      writeCompat(PROJECT_STORE_KEYS, JSON.stringify(mergedStore));
    }

    ensureCharacterStoreCompatibility();

    // Repair only if demo project exists in index.
    const shouldRepairDemoKeys = currentProjects.some((p) => p.id === DEMO_PROJECT_ID);
    if (shouldRepairDemoKeys) {
      for (const [key, payload] of Object.entries(DEMO_PROJECT_PAYLOADS)) {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, payload);
        }
      }
      for (const [key, payload] of Object.entries(DEMO_SHARED_PAYLOADS)) {
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, payload);
        }
      }
    }

    if (!markerExists) {
      localStorage.setItem(
        BROWSER_SEED_MARKER_KEY,
        JSON.stringify({ seededAt: new Date().toISOString(), version: 1 }),
      );
    }
  } catch (error) {
    console.warn("[BrowserSeed] Failed to seed demo project:", error);
  }
}

