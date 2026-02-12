// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { readImageAsBase64 } from "@/lib/image-storage";

type GeminiPlaywrightRequest = {
  mediaType: 'image' | 'video';
  prompt: string;
  aspectRatio?: string;
  referenceImageDataUrl?: string;
  firstFrameDataUrl?: string;
  timeoutMs?: number;
};

type GeminiPlaywrightResponse = {
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  sourceUrl?: string;
  error?: string;
  logs?: string;
};

async function invokeGeminiPlaywright(
  request: GeminiPlaywrightRequest
): Promise<GeminiPlaywrightResponse> {
  if (typeof window === "undefined" || !window.ipcRenderer?.invoke) {
    throw new Error("仅桌面版支持 Playwright 生成模式");
  }

  const result = await window.ipcRenderer.invoke(
    "gemini-playwright-generate",
    request
  ) as GeminiPlaywrightResponse;

  if (!result?.success || !result.dataUrl) {
    const logHint = result?.logs ? "\n\n调试日志:\n" + result.logs.slice(-1000) : "";
    throw new Error((result?.error || "Gemini Playwright 生成失败") + logHint);
  }

  return result;
}

export async function generateGeminiImageViaPlaywright(options: {
  prompt: string;
  aspectRatio: string;
  referenceImageUrl?: string;
  timeoutMs?: number;
}): Promise<string> {
  let referenceImageDataUrl: string | undefined;
  if (options.referenceImageUrl) {
    referenceImageDataUrl = await readImageAsBase64(options.referenceImageUrl) || undefined;
  }

  const result = await invokeGeminiPlaywright({
    mediaType: 'image',
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    referenceImageDataUrl,
    timeoutMs: options.timeoutMs,
  });
  return result.dataUrl!;
}

export async function generateGeminiVideoViaPlaywright(options: {
  prompt: string;
  aspectRatio: string;
  firstFrameUrl?: string;
  timeoutMs?: number;
}): Promise<string> {
  let firstFrameDataUrl: string | undefined;
  if (options.firstFrameUrl) {
    firstFrameDataUrl = await readImageAsBase64(options.firstFrameUrl) || undefined;
  }

  const result = await invokeGeminiPlaywright({
    mediaType: 'video',
    prompt: options.prompt,
    aspectRatio: options.aspectRatio,
    firstFrameDataUrl,
    timeoutMs: options.timeoutMs,
  });

  return result.dataUrl!;
}
