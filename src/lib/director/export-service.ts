// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { SplitScene } from "@/stores/director-store";
import type { TimelineClip } from "@/stores/simple-timeline-store";

export interface ExportableVideoClip {
  id: string;
  name: string;
  url: string;
  duration: number;
  source: "timeline" | "split-scene";
}

interface MasterExportProgress {
  current: number;
  total: number;
  message: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "mumu_project";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex <= 0) {
    return new Blob([dataUrl], { type: "application/octet-stream" });
  }
  const meta = dataUrl.slice(0, commaIndex);
  let data = dataUrl.slice(commaIndex + 1);
  const isBase64 = /;base64/i.test(meta);
  const mimeMatch = meta.match(/^data:([^;,]+)?/i);
  const mime = mimeMatch?.[1] || "application/octet-stream";

  // Some providers append hash fragments to data URLs; strip it before decode.
  const hashIndex = data.indexOf("#");
  if (hashIndex >= 0) {
    data = data.slice(0, hashIndex);
  }

  if (isBase64) {
    try {
      // Normalize URL-safe base64 and missing padding.
      const normalized = data.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const bytes = atob(padded);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        arr[i] = bytes.charCodeAt(i);
      }
      return new Blob([arr], { type: mime });
    } catch {
      // If payload is malformed, still produce a blob so export flow can continue.
      return new Blob([data], { type: mime });
    }
  }

  try {
    return new Blob([decodeURIComponent(data)], { type: mime });
  } catch {
    return new Blob([data], { type: mime });
  }
}

async function fetchClipAsBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    return dataUrlToBlob(url);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch clip: ${response.status}`);
  }
  return response.blob();
}

function detectExtension(url: string): string {
  const withoutQuery = url.split("?")[0].split("#")[0];
  const idx = withoutQuery.lastIndexOf(".");
  if (idx === -1) return "mp4";
  const ext = withoutQuery.slice(idx + 1).toLowerCase();
  return ext || "mp4";
}

function secondsToTimecode(seconds: number, fps = 25): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return [h, m, s, frames].map((n) => String(n).padStart(2, "0")).join(":");
}

function buildEdlText(projectName: string, clips: ExportableVideoClip[]): string {
  const lines: string[] = [];
  lines.push(`TITLE: ${projectName}`);
  lines.push("FCM: NON-DROP FRAME");
  lines.push("");

  let recordCursor = 0;

  clips.forEach((clip, index) => {
    const clipDuration = Math.max(1, clip.duration || 5);
    const srcIn = secondsToTimecode(0);
    const srcOut = secondsToTimecode(clipDuration);
    const recIn = secondsToTimecode(recordCursor);
    const recOut = secondsToTimecode(recordCursor + clipDuration);
    const eventNo = String(index + 1).padStart(3, "0");
    const reel = `AX${String(index + 1).padStart(3, "0")}`.slice(0, 8);

    lines.push(`${eventNo}  ${reel.padEnd(8, " ")} V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);
    lines.push(`* FROM CLIP NAME: ${clip.name}`);
    lines.push(`* URL: ${clip.url}`);
    lines.push("");

    recordCursor += clipDuration;
  });

  return lines.join("\n");
}

function buildXmlText(projectName: string, clips: ExportableVideoClip[]): string {
  const fps = 25;
  let timelineFrames = 0;
  const clipItems: string[] = [];

  clips.forEach((clip, index) => {
    const durationSec = Math.max(1, clip.duration || 5);
    const durationFrames = Math.round(durationSec * fps);
    const start = timelineFrames;
    const end = timelineFrames + durationFrames;
    timelineFrames = end;

    clipItems.push(`      <clipitem id="clip-${index + 1}">
        <name>${clip.name}</name>
        <duration>${durationFrames}</duration>
        <start>${start}</start>
        <end>${end}</end>
        <in>0</in>
        <out>${durationFrames}</out>
        <file id="file-${index + 1}">
          <name>${clip.name}</name>
          <pathurl>${clip.url}</pathurl>
        </file>
      </clipitem>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${projectName}</name>
    <duration>${timelineFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <media>
      <video>
        <track>
${clipItems.join("\n")}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;
}

export function resolveExportableVideoClips(
  splitScenes: SplitScene[],
  timelineClips: TimelineClip[]
): ExportableVideoClip[] {
  if (timelineClips.length > 0) {
    return timelineClips
      .filter((clip) => !!clip.url)
      .map((clip, index) => ({
        id: clip.id || `timeline-${index + 1}`,
        name: clip.name || `clip_${index + 1}`,
        url: clip.url,
        duration: Math.max(1, clip.duration || 5),
        source: "timeline" as const,
      }));
  }

  return splitScenes
    .filter((scene) => !!scene.videoUrl)
    .sort((a, b) => a.id - b.id)
    .map((scene, index) => ({
      id: `scene-${scene.id}`,
      name: `scene_${String(index + 1).padStart(3, "0")}`,
      url: scene.videoUrl!,
      duration: Math.max(1, scene.duration || 5),
      source: "split-scene" as const,
    }));
}

export async function exportSingleMasterVideo(
  projectName: string,
  clip: ExportableVideoClip
): Promise<void> {
  const blob = await fetchClipAsBlob(clip.url);
  const ext = detectExtension(clip.url);
  triggerDownload(blob, `${sanitizeFilename(projectName)}_master.${ext}`);
}

export async function exportMasterPackage(
  projectName: string,
  clips: ExportableVideoClip[],
  onProgress?: (progress: MasterExportProgress) => void
): Promise<void> {
  const safeProject = sanitizeFilename(projectName);
  const manifest = {
    version: "0.1.0",
    exportedAt: new Date().toISOString(),
    projectName: safeProject,
    mode: "clips-package",
    clips: clips.map((clip, index) => ({
      index: index + 1,
      name: clip.name,
      duration: clip.duration,
      source: clip.source,
      originalUrl: clip.url,
      outputFilename: `${safeProject}_clip_${String(index + 1).padStart(3, "0")}.${detectExtension(clip.url)}`,
    })),
  };

  const total = clips.length + 1;
  onProgress?.({ current: 0, total, message: "写入 manifest" });
  triggerDownload(
    new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    `${safeProject}_master_manifest.json`
  );

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const ext = detectExtension(clip.url);
    const filename = `${safeProject}_clip_${String(i + 1).padStart(3, "0")}.${ext}`;
    onProgress?.({
      current: i + 1,
      total,
      message: `下载 ${filename}`,
    });
    const blob = await fetchClipAsBlob(clip.url);
    triggerDownload(blob, filename);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  onProgress?.({ current: total, total, message: "导出完成" });
}

export function exportEdl(projectName: string, clips: ExportableVideoClip[]): void {
  const edlText = buildEdlText(sanitizeFilename(projectName), clips);
  triggerDownload(new Blob([edlText], { type: "text/plain;charset=utf-8" }), `${sanitizeFilename(projectName)}.edl`);
}

export function exportXml(projectName: string, clips: ExportableVideoClip[]): void {
  const xmlText = buildXmlText(sanitizeFilename(projectName), clips);
  triggerDownload(new Blob([xmlText], { type: "application/xml;charset=utf-8" }), `${sanitizeFilename(projectName)}.xml`);
}
