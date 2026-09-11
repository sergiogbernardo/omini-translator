import assert from "node:assert/strict";
import { test } from "node:test";
import { splitText, translateText } from "../src/translation.js";

const response = (translatedText, responseStatus = 200) => ({
  ok: true,
  status: 200,
  async json() {
    return { responseStatus, responseData: { translatedText } };
  },
});

test("splitText preserves content, separators, Unicode, and byte limits", () => {
  const input = "Olá 👩‍💻!\n\n日本語  café";
  const parts = splitText(input, 10);
  assert.equal(parts.map((part) => part.text).join(""), input);
  assert.ok(parts.filter((part) => part.translate).every((part) => new TextEncoder().encode(part.text).length <= 10));
  assert.deepEqual(parts.filter((part) => !part.translate).map((part) => part.text), [" ", "\n\n", "  "]);
  assert.ok(parts.every((part) => !/[\uD800-\uDFFF]/u.test(part.text) || [...part.text].length === 1));
});

test("empty and whitespace-only input do not call the provider", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  assert.equal(await translateText(" \n\t", { source: "en", target: "pt", fetchImpl }), " \n\t");
  assert.equal(calls, 0);
});

test("same-language input is returned without a request", async () => {
  let calls = 0;
  const result = await translateText("hello", {
    source: "en", target: "en", fetchImpl: async () => { calls += 1; },
  });
  assert.equal(result, "hello");
  assert.equal(calls, 0);
});

test("translation is sequential, reports progress, preserves separators, and decodes entities", async () => {
  const queries = [];
  const progress = [];
  const fetchImpl = async (url) => {
    queries.push(new URL(url).searchParams.get("q"));
    return response(`&lt;${queries.length}&gt;`);
  };
  const result = await translateText("one two", {
    source: "en", target: "pt", fetchImpl, onProgress: (value) => progress.push(value),
  });
  assert.equal(result, "<1> <2>");
  assert.deepEqual(queries, ["one", "two"]);
  assert.deepEqual(progress, [{ completed: 0, total: 2 }, { completed: 1, total: 2 }, { completed: 2, total: 2 }]);
});

test("sends only requests within the provider byte limit", async () => {
  const queries = [];
  const result = await translateText("a".repeat(1200), {
    source: "en",
    target: "pt",
    fetchImpl: async (url) => {
      queries.push(new URL(url).searchParams.get("q"));
      return response("x");
    },
  });
  assert.equal(result, "x".repeat(3));
  assert.ok(queries.length > 1);
  assert.ok(queries.every((query) => new TextEncoder().encode(query).length <= 500));
});

test("rejects oversized input and invalid language codes", async () => {
  await assert.rejects(translateText("😀".repeat(5001), { source: "en", target: "pt" }), /5,000/);
  await assert.rejects(translateText("hello", { source: "xx", target: "pt" }), /supported/);
});

test("checks HTTP, provider, and empty-result errors", async () => {
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt", fetchImpl: async () => ({ ok: false, status: 503 }),
  }), /HTTP 503/);
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt", fetchImpl: async () => response("", 429),
  }), /rejected/);
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt", fetchImpl: async () => response(""),
  }), /empty/);
});

test("does not skip a failed block and propagates cancellation", async () => {
  let calls = 0;
  await assert.rejects(translateText("one two", {
    source: "en", target: "pt",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 2) throw new Error("second block failed");
      return response("ok");
    },
  }), /second block failed/);
  assert.equal(calls, 2);

  const controller = new AbortController();
  const pending = translateText("hello", {
    source: "en", target: "pt", signal: controller.signal,
    fetchImpl: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
