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

test("splitText packs words into blocks instead of sending one word per request", () => {
  const input = "Good morning, team. The report is ready.";
  assert.deepEqual(splitText(input), [{ text: input, translate: true }]);
});

test("splitText keeps paragraphs apart and cuts long paragraphs at sentence ends", () => {
  const sentence = "Esta frase tem acentuação e fica inteira no bloco. ";
  const paragraph = sentence.repeat(20).trimEnd();
  const input = `  ${paragraph}\n\nSegundo parágrafo.\n`;
  const parts = splitText(input);
  const encoder = new TextEncoder();
  const blocks = parts.filter((part) => part.translate);

  assert.equal(parts.map((part) => part.text).join(""), input);
  assert.ok(blocks.every((part) => encoder.encode(part.text).length <= 500));
  assert.ok(blocks.length >= 3 && blocks.length <= 4, `unexpected block count ${blocks.length}`);
  assert.ok(blocks.every((part) => part.text === part.text.trim()));
  assert.ok(blocks.slice(0, -1).every((part) => /[.]$/u.test(part.text)), "blocks should end at a sentence");
  assert.equal(blocks.at(-1).text, "Segundo parágrafo.");
  assert.deepEqual(parts.filter((part) => !part.translate).map((part) => part.text).filter((s) => s.includes("\n")), ["\n\n", "\n"]);
});

test("splitText splits text without spaces, such as CJK, by grapheme within the limit", () => {
  const input = "日本語の文章です。".repeat(40);
  const parts = splitText(input);
  assert.equal(parts.map((part) => part.text).join(""), input);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => new TextEncoder().encode(part.text).length <= 500));
  assert.ok(parts.slice(0, -1).every((part) => part.text.endsWith("。")));
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
  const first = `${"word ".repeat(80)}end.`;
  const second = "Second paragraph.";
  const result = await translateText(`${first}\n\n${second}`, {
    source: "en", target: "pt", fetchImpl, onProgress: (value) => progress.push(value),
  });
  assert.equal(result, "<1>\n\n<2>");
  assert.deepEqual(queries, [first, second]);
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

test("reports an exhausted quota as an error with status 429", async () => {
  const warning = "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.";
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt", fetchImpl: async () => response(warning),
  }), { status: 429, message: /MYMEMORY WARNING/ });
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt",
    fetchImpl: async () => ({
      ok: true, status: 200,
      async json() { return { responseStatus: 200, quotaFinished: true, responseData: { translatedText: "olá" } }; },
    }),
  }), { status: 429 });
  await assert.rejects(translateText("hello", {
    source: "en", target: "pt", fetchImpl: async () => response("", 429),
  }), { status: 429 });
});

test("does not skip a failed block and propagates cancellation", async () => {
  let calls = 0;
  await assert.rejects(translateText("one\n\ntwo", {
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
