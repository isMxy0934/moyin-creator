// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { AIScene, AIScreenplay } from "@opencut/ai-core";
import { useAppSettingsStore } from "@/stores/app-settings-store";

const CAMERA_TYPES: AIScene["camera"][] = [
  "Wide Shot",
  "Medium Shot",
  "Close-up",
  "Tracking",
  "POV",
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function isTestModeEnabled(): boolean {
  return useAppSettingsStore.getState().testMode.enabled;
}

export function getTestModeLatencyMs(): number {
  return useAppSettingsStore.getState().testMode.latencyMs;
}

export async function waitForTestModeLatency(): Promise<void> {
  const latency = getTestModeLatencyMs();
  if (!latency || latency <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, latency));
}

export function createMockTaskId(prefix = "mock"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createMockVideoUrl(seed: string): string {
  void seed;
  // Keep this a strict, decodable data URL so downstream export logic can always decode it.
  return "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAAAAGlzb20=";
}

export function createMockImageDataUrl(
  seed: string,
  options?: {
    width?: number;
    height?: number;
    label?: string;
  }
): string {
  const width = options?.width ?? 1280;
  const height = options?.height ?? 720;
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const hue2 = (hue + 48) % 360;
  const label = options?.label ?? `Test Mode ${seed}`;
  const safeLabel = escapeXml(label);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="hsl(${hue},72%,38%)"/>
<stop offset="100%" stop-color="hsl(${hue2},72%,30%)"/>
</linearGradient>
</defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<rect x="${Math.floor(width * 0.06)}" y="${Math.floor(height * 0.12)}" width="${Math.floor(width * 0.88)}" height="${Math.floor(height * 0.76)}" rx="20" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" />
<text x="50%" y="45%" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${Math.max(
    24,
    Math.floor(width * 0.034)
  )}" font-weight="700">TEST MODE</text>
<text x="50%" y="57%" text-anchor="middle" fill="rgba(255,255,255,0.92)" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${Math.max(
    16,
    Math.floor(width * 0.02)
  )}">${safeLabel}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createMockScreenplay(params: {
  prompt: string;
  sceneCount: number;
  aspectRatio: "16:9" | "9:16";
}): AIScreenplay {
  const { prompt, sceneCount, aspectRatio } = params;
  const count = Math.max(1, Math.min(sceneCount || 5, 20));
  const now = Date.now();
  const scenes: AIScene[] = Array.from({ length: count }, (_, idx) => {
    const sceneId = idx + 1;
    const camera = CAMERA_TYPES[idx % CAMERA_TYPES.length];
    return {
      sceneId,
      narration: `（测试）第 ${sceneId} 场：基于你的故事描述生成的流程测试分镜。`,
      visualContent: `Test mode scene ${sceneId} environment inspired by: ${prompt.slice(0, 80)}.`,
      action: `Character performs a simple motion in scene ${sceneId}.`,
      camera,
      characterDescription: `Test character ${sceneId}, consistent style.`,
      status: "pending",
      mood: "test",
      emotionalHook: "pipeline verification",
    };
  });

  return {
    id: `test_${now}`,
    title: "测试模式剧本",
    genre: "测试",
    estimatedDurationSeconds: count * 5,
    emotionalArc: ["setup", "verify", "complete"],
    aspectRatio,
    orientation: aspectRatio === "9:16" ? "portrait" : "landscape",
    characters: [
      {
        id: "test_char_1",
        name: "测试角色",
        type: "human",
        visualTraits: "clean line art style, stable outfit",
        personality: "用于流程验证",
      },
    ],
    scenes,
    createdAt: now,
    updatedAt: now,
  };
}
