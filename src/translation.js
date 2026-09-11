const MAX_BYTES = 500;
const MAX_CODEPOINTS = 5000;
const API_URL = "https://api.mymemory.translated.net/get";
const TIMEOUT_MS = 30000;
const LANGUAGES = new Set(["en", "pt", "es", "fr", "de", "it", "nl", "ru", "ja", "zh"]);
const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).length;
}

function graphemes(value) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
      .map(({ segment }) => segment);
  }
  return Array.from(value);
}

function unitsForLimit(value, maxBytes) {
  return graphemes(value).flatMap((cluster) =>
    byteLength(cluster) <= maxBytes ? [cluster] : Array.from(cluster));
}

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*\s*$/u;

/**
 * Splits text without changing it. Paragraph breaks and the whitespace between
 * blocks are kept as separate parts, never sent to the provider. Within a
 * paragraph, words are packed into blocks of at most `maxBytes`, cutting at a
 * sentence end when possible so the provider receives whole sentences.
 */
export function splitText(text, maxBytes = MAX_BYTES) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  const result = [];
  for (const segment of text.split(/(\s*\n\s*)/u)) {
    if (!segment) continue;
    if (/^\s+$/u.test(segment)) {
      pushSeparator(result, segment);
      continue;
    }
    const [, lead, core, trail] = segment.match(/^(\s*)([\s\S]*?)(\s*)$/u);
    pushSeparator(result, lead);
    packParagraph(core, maxBytes, result);
    pushSeparator(result, trail);
  }
  return result;
}

function pushSeparator(result, value) {
  if (value) result.push({ text: value, translate: false });
}

function packParagraph(core, maxBytes, result) {
  let chunk = [];
  let sentenceEnd = 0;

  const emit = (count) => {
    const joined = chunk.slice(0, count).join("");
    const body = joined.trimEnd();
    result.push({ text: body, translate: true });
    pushSeparator(result, joined.slice(body.length));
    chunk = chunk.slice(count);
    sentenceEnd = 0;
    chunk.forEach((word, index) => { if (SENTENCE_END.test(word)) sentenceEnd = index + 1; });
  };
  const fits = (word) => byteLength((chunk.join("") + word).trimEnd()) <= maxBytes;

  for (const word of core.match(/\S+\s*/gu) ?? []) {
    const body = word.trimEnd();
    if (byteLength(body) > maxBytes) {
      if (chunk.length) emit(chunk.length);
      splitOversized(body, maxBytes, result);
      pushSeparator(result, word.slice(body.length));
      continue;
    }
    if (chunk.length && !fits(word)) {
      emit(sentenceEnd > 0 ? sentenceEnd : chunk.length);
      if (chunk.length && !fits(word)) emit(chunk.length);
    }
    chunk.push(word);
    if (SENTENCE_END.test(word)) sentenceEnd = chunk.length;
  }
  if (chunk.length) emit(chunk.length);
}

/** Splits a run without spaces (long URL, CJK paragraph) by grapheme, preferring sentence ends. */
function splitOversized(value, maxBytes, result) {
  const units = unitsForLimit(value, maxBytes);
  let start = 0;
  while (start < units.length) {
    let end = start;
    let bytes = 0;
    let preferredEnd = -1;
    while (end < units.length) {
      const nextBytes = byteLength(units[end]);
      if (bytes + nextBytes > maxBytes) break;
      bytes += nextBytes;
      end += 1;
      if (/[.!?。！？]$/u.test(units[end - 1])) preferredEnd = end;
    }
    if (end === start) throw new Error("A Unicode code point exceeds maxBytes");
    const cut = preferredEnd > start && end < units.length ? preferredEnd : end;
    result.push({ text: units.slice(start, cut).join(""), translate: true });
    start = cut;
  }
}

function abortError() {
  return new DOMException("The translation was cancelled", "AbortError");
}

function providerError(message, status) {
  const error = new Error(message);
  if (status !== undefined) error.status = status;
  return error;
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, body) => {
    if (body.toLowerCase().startsWith("#x")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : entity;
    }
    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

async function requestTranslation(query, source, target, signal, fetchImpl) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timer;
  let rejectCancellation;
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancellation(abortError());
  };
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  timer = setTimeout(() => {
    controller.abort();
    rejectCancellation(new Error("Translation request timed out"));
  }, TIMEOUT_MS);

  try {
    const request = fetchImpl(
      `${API_URL}?${new URLSearchParams({ q: query, langpair: `${source}|${target}` })}`,
      { signal: controller.signal },
    ).then(async (response) => {
      if (!response?.ok) {
        throw providerError(`Translation request failed (HTTP ${response?.status ?? "unknown"})`, response?.status);
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Translation response was not valid JSON");
      }
      const translated = payload?.responseData?.translatedText;
      // MyMemory may report an exhausted quota with a warning in place of the translation.
      if (payload?.quotaFinished === true || /^\s*MYMEMORY WARNING/i.test(translated ?? "")) {
        throw providerError(payload?.responseDetails || translated || "MyMemory daily quota finished", 429);
      }
      if (String(payload?.responseStatus) !== "200") {
        throw providerError(
          payload?.responseDetails || "Translation provider rejected the request",
          Number(payload?.responseStatus) || undefined,
        );
      }
      if (typeof translated !== "string" || translated.length === 0) {
        throw new Error("Translation provider returned an empty result");
      }
      return decodeEntities(translated);
    });
    return await Promise.race([request, cancellation]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function translateText(
  text,
  { source, target, signal, onProgress, fetchImpl = globalThis.fetch } = {},
) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (!LANGUAGES.has(source) || !LANGUAGES.has(target)) {
    throw new RangeError("source and target must be supported language codes");
  }
  if (Array.from(text).length > MAX_CODEPOINTS) {
    throw new RangeError("Text exceeds the 5,000 Unicode code point limit");
  }
  if (text.trim() === "" || source === target) return text;
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  const parts = splitText(text);
  const translatable = parts.filter((part) => part.translate);
  const total = translatable.length;
  let completed = 0;
  onProgress?.({ completed, total });
  const translations = new Map();

  for (const [index, part] of parts.entries()) {
    if (!part.translate) continue;
    translations.set(index, await requestTranslation(part.text, source, target, signal, fetchImpl));
    completed += 1;
    onProgress?.({ completed, total });
  }

  return parts.map((part, index) => part.translate ? translations.get(index) : part.text).join("");
}
