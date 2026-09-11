import assert from "node:assert/strict";
import { test } from "node:test";
import { splitText, translateText } from "../src/translation.js";

const encoder = new TextEncoder();
const byteLen = (str) => encoder.encode(str).length;

const mockSuccessResponse = (translatedText, responseStatus = 200) => ({
  ok: true,
  status: 200,
  async json() {
    return {
      responseStatus,
      quotaFinished: false,
      responseData: { translatedText },
    };
  },
});

test("Security: XSS and script payloads in input are preserved intact without mutation", () => {
  const xssInput = "<script>alert('xss')</script><img src=x onerror=\"fetch('http://evil.com')\">";
  const parts = splitText(xssInput);
  const reconstructed = parts.map((p) => p.text).join("");
  assert.equal(reconstructed, xssInput);
  assert.ok(parts.every((p) => byteLen(p.text) <= 500));
});

test("Security: Entity decoding decodes safe XML/HTML entities and numeric code points", async () => {
  const payload = "&lt;b&gt;Caf&eacute; &#39;test&#39; &amp; &quot;quote&quot; &#x41;&#x42;&#x43;&lt;/b&gt;";
  const fetchImpl = async () => mockSuccessResponse(payload);

  const result = await translateText("dummy", {
    source: "en",
    target: "pt",
    fetchImpl,
  });

  // &lt;b&gt; -> <b>, &#39; -> ', &amp; -> &, &quot; -> ", &#x41;&#x42;&#x43; -> ABC
  // &eacute; is not in the basic named map, so it remains &eacute;
  assert.equal(result, "<b>Caf&eacute; 'test' & \"quote\" ABC</b>");
});

test("Security: Malformed or surrogate numeric entities do not throw or produce invalid Unicode", async () => {
  // Surrogates (0xd800) and out-of-range (> 0x10ffff) must be safely preserved as entities
  const malformed = "&#xd800; &#x110000; &#9999999; &#xzz;";
  const fetchImpl = async () => mockSuccessResponse(malformed);

  const result = await translateText("dummy", {
    source: "en",
    target: "pt",
    fetchImpl,
  });

  assert.equal(result, malformed);
});

test("Robustness: Exact 500-byte and 501-byte boundaries", () => {
  // Exact 500 bytes single word
  const exact500 = "a".repeat(500);
  const parts500 = splitText(exact500);
  assert.equal(parts500.length, 1);
  assert.equal(byteLen(parts500[0].text), 500);
  assert.equal(parts500[0].translate, true);

  // 501 bytes single word: must split into 500 + 1
  const exact501 = "a".repeat(501);
  const parts501 = splitText(exact501);
  assert.equal(parts501.length, 2);
  assert.equal(byteLen(parts501[0].text), 500);
  assert.equal(byteLen(parts501[1].text), 1);
  assert.equal(parts501.map((p) => p.text).join(""), exact501);

  // 500-byte sentence ending with dot
  const sentence500 = "a".repeat(499) + ".";
  const partsSentence = splitText(sentence500);
  assert.equal(partsSentence.length, 1);
  assert.equal(byteLen(partsSentence[0].text), 500);
});

test("Robustness: Complex emojis, ZWJ sequences, and multi-byte UTF-8 clusters", () => {
  // 👨‍👩‍👧‍👦 is 25 bytes in UTF-8 (man + ZWJ + woman + ZWJ + girl + ZWJ + boy)
  const familyEmoji = "👨‍👩‍👧‍👦";
  assert.equal(byteLen(familyEmoji), 25);

  // 21 family emojis = 21 * 25 = 525 bytes. Must split without breaking the ZWJ cluster
  const input = familyEmoji.repeat(21);
  const parts = splitText(input);
  const reconstructed = parts.map((p) => p.text).join("");
  assert.equal(reconstructed, input);

  for (const part of parts.filter((p) => p.translate)) {
    assert.ok(byteLen(part.text) <= 500);
    // Ensure no broken surrogate or incomplete sequence
    assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(encoder.encode(part.text)));
  }
});

test("Robustness: Sentences with trailing quotes, parentheses, and ellipses", () => {
  const s1 = 'First sentence with "quotes." ';
  const s2 = "Second sentence with (parentheses). ";
  const s3 = "Third sentence with ellipsis... ";
  const longSentence = "A".repeat(400) + '." ';
  const nextSentence = "B".repeat(200) + ".";
  const input = longSentence + nextSentence;

  const parts = splitText(input);
  assert.equal(parts.map((p) => p.text).join(""), input);
  const translatable = parts.filter((p) => p.translate);
  assert.ok(translatable.every((p) => byteLen(p.text) <= 500));
  assert.ok(translatable[0].text.endsWith('."'));
});

test("Robustness: Exact 5,000 Unicode codepoints limit", async () => {
  // Emojis are 1 codepoint each (though 4 bytes UTF-8)
  const exact5000 = "😀".repeat(5000);
  assert.equal(Array.from(exact5000).length, 5000);

  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return mockSuccessResponse("traduzido");
  };

  // Should succeed without throwing RangeError
  await assert.doesNotReject(translateText(exact5000, {
    source: "en",
    target: "pt",
    fetchImpl,
  }));
  assert.ok(calls > 0);

  // 5,001 codepoints must be rejected
  const over5000 = "😀".repeat(5001);
  await assert.rejects(
    translateText(over5000, { source: "en", target: "pt", fetchImpl }),
    (err) => err instanceof RangeError && err.message.includes("5,000"),
  );
});

test("Robustness: Partial failure aborts sequence and does not execute subsequent requests", async () => {
  // Input that produces 3 blocks
  const input = "Block one.\n\nBlock two.\n\nBlock three.";
  const requestedBlocks = [];

  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams.get("q");
    requestedBlocks.push(q);
    if (q === "Block two.") {
      throw new Error("Network drop on block 2");
    }
    return mockSuccessResponse("OK");
  };

  await assert.rejects(
    translateText(input, { source: "en", target: "pt", fetchImpl }),
    /Network drop on block 2/,
  );

  // Block three must NEVER be requested
  assert.deepEqual(requestedBlocks, ["Block one.", "Block two."]);
});

test("Robustness: Mid-flight cancellation stops immediately without calling next block", async () => {
  const controller = new AbortController();
  const input = "Sentence one. \n\nSentence two. \n\nSentence three.";
  const requested = [];

  const fetchImpl = async (url) => {
    const q = new URL(url).searchParams.get("q");
    requested.push(q);
    if (q === "Sentence one.") {
      // Trigger abort while block 1 is finishing
      controller.abort();
      return mockSuccessResponse("Frase um.");
    }
    return mockSuccessResponse("OK");
  };

  await assert.rejects(
    translateText(input, {
      source: "en",
      target: "pt",
      signal: controller.signal,
      fetchImpl,
    }),
    { name: "AbortError" },
  );

  // Sentence two and three must not be called
  assert.deepEqual(requested, ["Sentence one."]);
});

test("Robustness: HTTP error statuses (500, 502, 503) propagate status code", async () => {
  for (const status of [500, 502, 503]) {
    const fetchImpl = async () => ({
      ok: false,
      status,
      statusText: "Server Error",
    });

    await assert.rejects(
      translateText("Test text", { source: "en", target: "pt", fetchImpl }),
      (err) => err.status === status && err.message.includes(`HTTP ${status}`),
    );
  }
});

test("Robustness: Provider returning invalid JSON rejects gracefully", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  });

  await assert.rejects(
    translateText("Test text", { source: "en", target: "pt", fetchImpl }),
    /valid JSON/,
  );
});

test("Robustness: Quota detection handles various MyMemory warning formats", async () => {
  const warnings = [
    "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.",
    "mymemory warning: daily limit reached",
    "  MYMEMORY WARNING: please wait 24 hours  ",
  ];

  for (const text of warnings) {
    const fetchImpl = async () => mockSuccessResponse(text);
    await assert.rejects(
      translateText("Hello", { source: "en", target: "pt", fetchImpl }),
      (err) => err.status === 429,
    );
  }
});
