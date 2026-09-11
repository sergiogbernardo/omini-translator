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

/**
 * Splits text without changing it. Whitespace is kept in its own parts so
 * paragraph and word separators are never sent to the provider for translation.
 */
export function splitText(text, maxBytes = MAX_BYTES) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive integer");
  }

  const result = [];
  const matches = text.match(/\s+|\S+/gu) ?? [];
  for (const match of matches) {
    if (/^\s+$/u.test(match)) {
      result.push({ text: match, translate: false });
      continue;
    }
    const units = unitsForLimit(match, maxBytes);
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
      const cut = preferredEnd > start ? preferredEnd : end;
      result.push({ text: units.slice(start, cut).join(""), translate: true });
      start = cut;
    }
  }
  return result;
}

function abortError() {
  return new DOMException("The translation was cancelled", "AbortError");
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
      if (!response?.ok) throw new Error(`Translation request failed (HTTP ${response?.status ?? "unknown"})`);
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("Translation response was not valid JSON");
      }
      if (String(payload?.responseStatus) !== "200") {
        throw new Error(payload?.responseDetails || "Translation provider rejected the request");
      }
      const translated = payload?.responseData?.translatedText;
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
