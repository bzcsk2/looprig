/**
 * Integration test: fake ChatClient → ReasonixEngine.submit system prompt locale.
 *
 * Creates a real engine with a fake client, submits, and asserts the system prompt
 * language changes between zh-CN and en.
 */
import { describe, test, expect } from "bun:test";
import type { DeepSeekStreamEvent, DeepSeekClientOptions, ChatMessage, ChatClient, DeepreefConfig } from "../src/interface";
import { ReasonixEngine } from "../src/engine";
import { setPromptLocale, getPromptLocale } from "../src/prompt-locale";
import { buildSystemPrompt } from "../src/system-prompt";

function makeFakeClient(): { client: ChatClient; messages: ChatMessage[] } {
  const messages: ChatMessage[] = [];
  const client: ChatClient = {
    async *chatCompletionsStream(
      msgs: ChatMessage[],
      _opts: DeepSeekClientOptions,
    ): AsyncGenerator<DeepSeekStreamEvent> {
      messages.push(...msgs);
      yield { type: "text_delta", delta: "" };
      yield { type: "done", finishReason: "stop" };
    },
  };
  return { client, messages };
}

const MINIMAL_CONFIG: DeepreefConfig = {
  apiKey: "test-key",
  baseUrl: "http://localhost:9999",
  model: "test-model",
  maxTokens: 100,
  temperature: 0,
  provider: "openai-compatible",
};

describe("ReasonixEngine submit system prompt locale", () => {
  test("system prompt changes between zh-CN and en after setPromptLocale + setSystemPrompt", async () => {
    const { client, messages } = makeFakeClient();
    const engine = new ReasonixEngine(MINIMAL_CONFIG, undefined, undefined, client);

    // Set Chinese locale and base system prompt
    setPromptLocale("zh-CN");
    const zhPrompt = buildSystemPrompt(".", { locale: "zh-CN" });
    engine.setSystemPrompt(zhPrompt);

    // Submit and collect events
    const zhEvents: string[] = [];
    for await (const event of engine.submit("test input", undefined, "worker", "loop")) {
      zhEvents.push(event.role);
    }

    // The first message should be the system prompt
    const zhSystemMsg = messages.find((m) => m.role === "system");
    expect(zhSystemMsg).toBeDefined();
    expect(zhSystemMsg!.content).toContain("你是 Covalo");
    expect(zhSystemMsg!.content).toContain("## 循环模式 —— Worker");

    // Clear and switch to English
    messages.length = 0;
    setPromptLocale("en");
    const enPrompt = buildSystemPrompt(".", { locale: "en" });
    engine.setSystemPrompt(enPrompt);

    const enEvents: string[] = [];
    for await (const event of engine.submit("test input", undefined, "worker", "loop")) {
      enEvents.push(event.role);
    }

    const enSystemMsg = messages.find((m) => m.role === "system");
    expect(enSystemMsg).toBeDefined();
    expect(enSystemMsg!.content).toContain("You are Covalo");
    expect(enSystemMsg!.content).toContain("## Loop Mode — Worker");
    expect(enSystemMsg!.content).not.toContain("你是 Covalo");

    engine.shutdown().catch(() => {});
  });

  test("spawnSubagent child engine gets localized system prompt", async () => {
    const { client, messages } = makeFakeClient();
    const engine = new ReasonixEngine(MINIMAL_CONFIG, undefined, undefined, client);

    setPromptLocale("zh-CN");
    engine.setSystemPrompt(buildSystemPrompt(".", { locale: "zh-CN" }));

    let result = await engine.spawnSubagent({
      description: "test zh subagent",
      prompt: "do something",
      subagentType: "general-purpose",
    });
    expect(result.status).toBe("completed");

    // The child engine pushes messages to the shared client
    const zhMsg = messages.find((m) => m.role === "system");
    expect(zhMsg).toBeDefined();
    expect(zhMsg!.content).toContain("你是一个通用子代理");

    // Clear and switch to English
    messages.length = 0;
    setPromptLocale("en");
    engine.setSystemPrompt(buildSystemPrompt(".", { locale: "en" }));

    result = await engine.spawnSubagent({
      description: "test en subagent",
      prompt: "do something else",
      subagentType: "general-purpose",
    });
    expect(result.status).toBe("completed");

    const enMsg = messages.find((m) => m.role === "system");
    expect(enMsg).toBeDefined();
    expect(enMsg!.content).toContain("You are a general-purpose sub-agent");
    expect(enMsg!.content).not.toContain("你是一个");

    engine.shutdown().catch(() => {});
  });
});
