// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import {
  createMockImageDataUrl,
  createMockScreenplay,
  createMockTaskId,
  createMockVideoUrl,
  isTestModeEnabled,
  waitForTestModeLatency,
} from "@/lib/ai/test-mode";

let installed = false;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function shouldIntercept(url: URL): boolean {
  if (url.hostname === "mock.local") return true;
  if (url.pathname.startsWith("/api/ai/")) return true;
  if (url.pathname.startsWith("/api/upload")) return true;
  if (/\/v1\/(images|videos|tasks|chat)\//.test(url.pathname)) return true;
  if (url.pathname.endsWith("/query")) return true;
  return false;
}

function extractPromptText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  const prompt = typeof obj.prompt === "string" ? obj.prompt : "";
  const messages = Array.isArray(obj.messages) ? obj.messages : [];
  const textChunks: string[] = [];
  if (prompt) textChunks.push(prompt);
  for (const message of messages) {
    const content = message?.content;
    if (typeof content === "string") {
      textChunks.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === "string") textChunks.push(part.text);
      }
    }
  }
  return textChunks.join("\n");
}

function buildMockChatResponse(promptText: string): Response {
  const normalized = promptText.toLowerCase();

  if (
    normalized.includes("generate an image") ||
    normalized.includes("image with aspect ratio") ||
    normalized.includes("生图") ||
    normalized.includes("图片")
  ) {
    return jsonResponse({
      choices: [
        {
          message: {
            content: [
              {
                type: "image_url",
                image_url: {
                  url: createMockImageDataUrl(createMockTaskId("chat-image"), {
                    label: "Chat Image (Test Mode)",
                  }),
                },
              },
            ],
          },
        },
      ],
    });
  }

  // Generic JSON object response for structured extraction flows.
  return jsonResponse({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: "测试模式输出",
            genre: "测试",
            logline: "这是测试模式返回的结构化示例。",
            characters: [],
            episodes: [{ id: "ep_1", index: 1, title: "第1集", description: "测试集", sceneIds: ["scene_1"] }],
            scenes: [
              {
                id: "scene_1",
                episodeId: "ep_1",
                name: "测试场景",
                location: "测试地点",
                time: "day",
                atmosphere: "平稳",
                visualPrompt: "Test scene visual prompt.",
                tags: ["测试"],
                notes: "测试模式",
              },
            ],
            storyParagraphs: [{ id: 1, text: "测试段落", sceneRefId: "scene_1" }],
          }),
        },
      },
    ],
  });
}

async function buildMockResponse(request: Request, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  let body: Record<string, unknown> = {};

  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.clone().json();
    } catch {
      body = {};
    }
  }

  if (url.pathname.startsWith("/api/ai/screenplay")) {
    const screenplay = createMockScreenplay({
      prompt: typeof body.prompt === "string" ? body.prompt : "test",
      sceneCount: Number(body.sceneCount) || 5,
      aspectRatio: body.aspectRatio === "16:9" ? "16:9" : "9:16",
    });
    return jsonResponse(screenplay);
  }

  if (url.pathname.startsWith("/api/ai/image")) {
    return jsonResponse({
      status: "completed",
      imageUrl: createMockImageDataUrl(createMockTaskId("api-image"), {
        label: "API Image (Test Mode)",
      }),
    });
  }

  if (url.pathname.startsWith("/api/ai/video")) {
    return jsonResponse({
      status: "completed",
      videoUrl: createMockVideoUrl(createMockTaskId("api-video")),
    });
  }

  if (url.pathname.startsWith("/api/ai/task/")) {
    const taskId = url.pathname.split("/").pop() || createMockTaskId("task");
    const type = url.searchParams.get("type");
    const imageUrl = createMockImageDataUrl(taskId, { label: "Task Image (Test Mode)" });
    const videoUrl = createMockVideoUrl(taskId);
    const resultUrl = type === "video" ? videoUrl : imageUrl;
    return jsonResponse({
      taskId,
      status: "completed",
      result: {
        url: resultUrl,
        imageUrl,
        videoUrl,
      },
      resultUrl,
      progress: 100,
    });
  }

  if (url.pathname.startsWith("/api/ai/runninghub-test")) {
    return jsonResponse({ success: true, message: "Test mode: RunningHub connection OK" });
  }

  if (url.pathname.startsWith("/api/upload")) {
    return jsonResponse({
      success: true,
      url: createMockImageDataUrl(createMockTaskId("upload"), {
        label: "Uploaded (Test Mode)",
      }),
    });
  }

  if (url.pathname.endsWith("/query")) {
    return jsonResponse({
      status: "completed",
      data: { output: createMockImageDataUrl(createMockTaskId("runninghub"), { label: "RunningHub (Test Mode)" }) },
    });
  }

  if (/\/v1\/images\/generations$/.test(url.pathname)) {
    return jsonResponse({
      data: [
        {
          url: createMockImageDataUrl(createMockTaskId("v1-image"), {
            label: "Images API (Test Mode)",
          }),
        },
      ],
    });
  }

  if (/\/v1\/videos\/generations$/.test(url.pathname)) {
    return jsonResponse({
      data: [{ task_id: createMockTaskId("v1-video") }],
      estimated_time: 1,
    });
  }

  if (/\/v1\/tasks\/[^/]+$/.test(url.pathname)) {
    const taskId = url.pathname.split("/").pop() || createMockTaskId("v1-task");
    return jsonResponse({
      status: "completed",
      result: {
        images: [{ url: [createMockImageDataUrl(taskId, { label: "Task Image (Test Mode)" })] }],
        videos: [{ url: [createMockVideoUrl(taskId)] }],
      },
      output_url: createMockImageDataUrl(taskId, { label: "Task Output (Test Mode)" }),
    });
  }

  if (/\/v1\/chat\/completions$/.test(url.pathname)) {
    return buildMockChatResponse(extractPromptText(body));
  }

  // Fallback: respond with a generic success JSON to avoid accidental network.
  return jsonResponse({ success: true, message: "Test mode intercepted request" });
}

export function installTestModeFetchInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  if (typeof window.fetch !== "function") return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isTestModeEnabled()) {
      return originalFetch(input, init);
    }

    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(rawUrl, window.location.origin);

    if (!shouldIntercept(url)) {
      return originalFetch(input, init);
    }

    await waitForTestModeLatency();
    const request = new Request(input, init);
    return buildMockResponse(request, url);
  };

  installed = true;
}
