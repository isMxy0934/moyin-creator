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

function buildMockCreativeScriptText(): string {
  return `《测试模式剧本》

**大纲：**
这是用于功能完整性测试的示例剧本，围绕“接收任务 -> 执行任务 -> 输出结果”展开。

**人物小传：**
测试员：冷静、执行力强，负责确认流程是否可用。
助手：提供信息支持，帮助推进任务。

**第1集：流程验证**

**1-1 日 内 测试控制室**
人物：测试员、助手
△测试员查看控制台日志，助手同步任务状态，屏幕上显示“流程初始化完成”。
测试员：（平静）开始第一轮功能验证。

**1-2 日 外 测试走廊**
人物：测试员
△测试员沿走廊快速前进，准备到下一站点确认导出链路是否正常。
测试员：（坚定）继续下一步，检查导出与回传结果。`;
}

function buildMockViewpointJson(promptText: string): string {
  const shotMatches = [...promptText.matchAll(/【分镜(\d+)】/g)];
  const maxShot = shotMatches.length > 0
    ? Math.max(...shotMatches.map((m) => Number(m[1]) || 1))
    : 1;
  const mid = Math.max(1, Math.ceil(maxShot / 2));
  return JSON.stringify({
    viewpoints: [
      {
        id: "overview",
        name: "全景",
        nameEn: "Overview",
        description: "展示空间关系",
        descriptionEn: "Show overall spatial relationship",
        keyProps: ["主环境"],
        keyPropsEn: ["main environment"],
        shotIndexes: [1, mid],
      },
      {
        id: "detail",
        name: "细节",
        nameEn: "Detail",
        description: "突出动作细节",
        descriptionEn: "Highlight action details",
        keyProps: ["关键道具"],
        keyPropsEn: ["key prop"],
        shotIndexes: [maxShot],
      },
    ],
    analysisNote: "测试模式：已返回稳定视角结构",
  });
}

function buildMockSynopsesJson(promptText: string): string {
  const episodeMatches = [...promptText.matchAll(/第(\d+)集/g)];
  const indexes = Array.from(new Set(episodeMatches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0)));
  const targets = indexes.length > 0 ? indexes : [1];
  const synopses: Record<string, { synopsis: string; keyEvents: string[] }> = {};
  for (const idx of targets) {
    synopses[String(idx)] = {
      synopsis: `第${idx}集测试大纲：角色接收任务、推进流程并完成结果确认。`,
      keyEvents: ["接收任务", "执行流程", "结果确认"],
    };
  }
  return JSON.stringify({ synopses });
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

  if (
    promptText.includes("请根据以下创意输入生成完整剧本") ||
    promptText.includes("生成完整剧本，包含")
  ) {
    return jsonResponse({
      choices: [
        {
          message: {
            content: buildMockCreativeScriptText(),
          },
        },
      ],
    });
  }

  if (
    promptText.includes("分析该场景需要哪些不同的视角") ||
    (promptText.includes("\"viewpoints\"") && promptText.includes("shotIndexes"))
  ) {
    return jsonResponse({
      choices: [
        {
          message: {
            content: buildMockViewpointJson(promptText),
          },
        },
      ],
    });
  }

  if (
    promptText.includes("请为以下集数生成大纲和关键事件") ||
    promptText.includes("\"synopses\"")
  ) {
    return jsonResponse({
      choices: [
        {
          message: {
            content: buildMockSynopsesJson(promptText),
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
