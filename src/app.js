/**
 * Omini Translator — interface.
 *
 * Depende do contrato acordado:
 *   translateText(text, { source, target, signal, onProgress }) => Promise<string>
 *   - resolve com a tradução completa; rejeita em erro ou cancelamento;
 *   - onProgress recebe { completed, total };
 *   - `source` e `target` são códigos explícitos (a interface resolve a detecção antes).
 */
import { translateText } from './translation.js';

/* ------------------------------------------------------------------ *
 * Constantes
 * ------------------------------------------------------------------ */

const MAX_CODEPOINTS = 5000;
const HISTORY_LIMIT = 12;
const FAVORITES_LIMIT = 8;
const AUTO = 'auto';

const STORAGE_KEYS = {
  prefs: 'omini.prefs.v1',
  history: 'omini.history.v1',
  favorites: 'omini.favorites.v1',
};

const LANGUAGES = [
  { code: 'en', name: 'Inglês', speech: 'en-US' },
  { code: 'pt', name: 'Português', speech: 'pt-BR' },
  { code: 'es', name: 'Espanhol', speech: 'es-ES' },
  { code: 'fr', name: 'Francês', speech: 'fr-FR' },
  { code: 'de', name: 'Alemão', speech: 'de-DE' },
  { code: 'it', name: 'Italiano', speech: 'it-IT' },
  { code: 'nl', name: 'Holandês', speech: 'nl-NL' },
  { code: 'ru', name: 'Russo', speech: 'ru-RU' },
  { code: 'ja', name: 'Japonês', speech: 'ja-JP' },
  { code: 'zh', name: 'Chinês (simplificado)', speech: 'zh-CN' },
];

const LANG_BY_CODE = new Map(LANGUAGES.map((lang) => [lang.code, lang]));
const isLangCode = (code) => LANG_BY_CODE.has(code);
const langName = (code) => (code === AUTO ? 'Detectar idioma' : LANG_BY_CODE.get(code)?.name ?? code);

const numberFormat = new Intl.NumberFormat('pt-BR');
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmt = (value) => numberFormat.format(value);

/* ------------------------------------------------------------------ *
 * Elementos
 * ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const els = {
  sourceLang: $('source-lang'),
  targetLang: $('target-lang'),
  swap: $('swap'),
  favoriteToggle: $('favorite-toggle'),
  favoriteLabel: $('favorite-label'),
  detectNote: $('detect-note'),
  detectPill: $('detect-pill'),

  source: $('source-text'),
  charCount: $('char-count'),
  limitMsg: $('limit-msg'),
  actionHint: $('action-hint'),
  clearSource: $('clear-source'),
  listenSource: $('listen-source'),
  translate: $('translate'),
  translateLabel: $('translate-label'),
  translateKbd: $('translate-kbd'),

  resultPane: $('result-pane'),
  resultBadge: $('result-badge'),
  resultOutput: $('result-output'),
  resultLoading: $('result-loading'),
  resultEmpty: $('result-empty'),
  emptyTitle: $('empty-title'),
  emptyText: $('empty-text'),
  resultMeta: $('result-meta'),
  listenResult: $('listen-result'),
  copyResult: $('copy-result'),
  copyLabel: $('copy-label'),
  staleNote: $('stale-note'),

  progress: $('progress'),
  progressTitle: $('progress-title'),
  progressDetail: $('progress-detail'),
  progressBar: $('progress-bar'),
  progressFill: $('progress-fill'),
  cancel: $('cancel'),

  notice: $('notice'),
  noticeText: $('notice-text'),
  noticeDismiss: $('notice-dismiss'),

  error: $('error'),
  errorTitle: $('error-title'),
  errorMessage: $('error-message'),
  errorDetail: $('error-detail'),
  retry: $('retry'),
  errorDismiss: $('error-dismiss'),

  favoritesList: $('favorites-list'),
  favoritesEmpty: $('favorites-empty'),
  historyEnabled: $('history-enabled'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  historyClear: $('history-clear'),
  libraryNotice: $('library-notice'),

  announcer: $('announcer'),
  tplFavorite: $('tpl-favorite'),
  tplHistory: $('tpl-history'),
};

/* ------------------------------------------------------------------ *
 * Armazenamento local tolerante a falhas
 * ------------------------------------------------------------------ */

const storage = (() => {
  let area = null;
  try {
    const probe = '__omini_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    area = window.localStorage;
  } catch {
    area = null;
  }
  return {
    get available() {
      return area !== null;
    },
    read(key) {
      if (!area) return undefined;
      try {
        const raw = area.getItem(key);
        return raw === null ? undefined : JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    write(key, value) {
      if (!area) return false;
      try {
        area.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      if (!area) return false;
      try {
        area.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };
})();

function setLibraryNotice(message) {
  els.libraryNotice.textContent = message || '';
  els.libraryNotice.hidden = !message;
}

/* ------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------ */

const state = {
  phase: 'idle', // idle | running | cancelled | error | done
  run: null, // { id, controller, snapshot }
  progress: null, // { completed, total }
  result: null, // { text, input, sourceSel, source, target, estimated, fromHistory, at }
  notice: null,
  error: null, // { title, message, detail }
  detection: null,
};

let runSeq = 0;

let prefs = loadPrefs();
let favorites = loadFavorites();
let historyItems = loadHistory();

/* ------------------------------------------------------------------ *
 * Utilitários de texto
 * ------------------------------------------------------------------ */

function countCodepoints(text) {
  let total = 0;
  for (const _ of text) total += 1;
  return total;
}

function truncateCodepoints(text, max) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(flat);
  if (points.length <= max) return flat;
  return `${points.slice(0, max).join('')}…`;
}

function newId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ *
 * Detecção de idioma — estimativa local, nunca apresentada como exata
 * ------------------------------------------------------------------ */

const STOPWORDS = {
  en: ['the', 'and', 'is', 'are', 'of', 'to', 'in', 'that', 'it', 'for', 'with', 'was', 'you', 'this', 'have', 'not', 'be', 'what', 'from', 'they', 'about', 'would', 'hello', 'thanks', 'please'],
  pt: ['os', 'as', 'de', 'do', 'da', 'dos', 'das', 'que', 'não', 'uma', 'para', 'com', 'em', 'no', 'na', 'você', 'está', 'mas', 'por', 'isso', 'são', 'como', 'ele', 'ela', 'olá', 'obrigado', 'obrigada', 'muito', 'também'],
  es: ['el', 'la', 'los', 'las', 'del', 'que', 'es', 'una', 'para', 'con', 'en', 'por', 'está', 'pero', 'lo', 'muy', 'usted', 'como', 'esto', 'son', 'hola', 'gracias', 'también', 'porque'],
  fr: ['le', 'la', 'les', 'des', 'du', 'et', 'est', 'que', 'une', 'pour', 'avec', 'dans', 'pas', 'qui', 'sur', 'vous', 'nous', 'mais', 'sont', 'bonjour', 'merci', 'très', 'aussi'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'den', 'ich', 'sie', 'auf', 'für', 'von', 'dem', 'sind', 'auch', 'wir', 'hallo', 'danke', 'sehr'],
  it: ['il', 'la', 'le', 'di', 'che', 'non', 'una', 'per', 'con', 'del', 'della', 'sono', 'gli', 'lo', 'ma', 'questo', 'anche', 'io', 'ciao', 'grazie', 'molto', 'perché'],
  nl: ['het', 'een', 'en', 'is', 'van', 'niet', 'dat', 'ik', 'je', 'op', 'te', 'met', 'voor', 'zijn', 'er', 'ook', 'maar', 'wij', 'dit', 'wat', 'hallo', 'bedankt', 'heel'],
};

const STOPWORD_SETS = Object.entries(STOPWORDS).map(([code, words]) => [code, new Set(words)]);

const CHAR_HINTS = [
  { code: 'pt', re: /[ãõ]/g, weight: 3 },
  { code: 'es', re: /[ñ¿¡]/g, weight: 3 },
  { code: 'de', re: /[ßäöü]/g, weight: 2 },
  { code: 'fr', re: /[êëîïœùû]/g, weight: 2 },
  { code: 'it', re: /[ìò]/g, weight: 2 },
  { code: 'nl', re: /ij/g, weight: 1 },
];

const HINT_CAP = 6;

function countMatches(text, re) {
  const found = text.match(re);
  return found ? found.length : 0;
}

let detectionCache = { text: null, value: null };

function detectLanguage(text) {
  if (detectionCache.text === text) return detectionCache.value;
  const value = computeDetection(text);
  detectionCache = { text, value };
  return value;
}

function computeDetection(text) {
  const sample = text.slice(0, 4000);
  const kana = countMatches(sample, /[぀-ヿ]/g);
  const han = countMatches(sample, /[㐀-鿿]/g);
  const cyrillic = countMatches(sample, /[Ѐ-ӿ]/g);
  const latin = countMatches(sample, /[a-zA-ZÀ-ɏ]/g);
  const letters = kana + han + cyrillic + latin;
  if (letters < 3) return null;

  if (kana > 0 && kana + han >= letters * 0.3) {
    return { code: 'ja', confidence: 'média', note: 'presença de kana' };
  }
  if (han >= letters * 0.3) {
    return { code: 'zh', confidence: 'baixa', note: 'ideogramas sem kana; pode ser japonês' };
  }
  if (cyrillic >= letters * 0.5) {
    return { code: 'ru', confidence: 'baixa', note: 'alfabeto cirílico; pode ser outra língua eslava' };
  }
  if (latin < letters * 0.5) return null;

  const words = (sample.toLowerCase().match(/[\p{L}'’]+/gu) ?? []).slice(0, 600);
  const scores = new Map(STOPWORD_SETS.map(([code]) => [code, 0]));
  for (const word of words) {
    for (const [code, set] of STOPWORD_SETS) {
      if (set.has(word)) scores.set(code, scores.get(code) + 1);
    }
  }
  const lower = sample.toLowerCase();
  for (const hint of CHAR_HINTS) {
    const hits = countMatches(lower, hint.re);
    if (hits > 0) scores.set(hint.code, scores.get(hint.code) + Math.min(hits * hint.weight, HINT_CAP));
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestCode, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  if (bestScore < 1) return null;
  if (bestScore - secondScore < 1 || bestScore < secondScore * 1.5) return null;

  const confidence = bestScore >= 5 && bestScore >= secondScore * 2 ? 'média' : 'baixa';
  return { code: bestCode, confidence, note: 'palavras comuns do idioma' };
}

/* ------------------------------------------------------------------ *
 * Preferências, favoritos e histórico
 * ------------------------------------------------------------------ */

function loadPrefs() {
  const raw = storage.read(STORAGE_KEYS.prefs);
  const data = raw && typeof raw === 'object' ? raw : {};
  const source = data.source === AUTO || isLangCode(data.source) ? data.source : 'pt';
  let target = isLangCode(data.target) ? data.target : 'en';
  if (target === source) target = source === 'en' ? 'pt' : 'en';
  return {
    source,
    target,
    historyEnabled: storage.available && data.historyEnabled === true,
  };
}

function savePrefs() {
  if (!storage.available) return;
  if (!storage.write(STORAGE_KEYS.prefs, prefs)) {
    setLibraryNotice('Não foi possível salvar as preferências neste navegador.');
  }
}

function loadFavorites() {
  const raw = storage.read(STORAGE_KEYS.favorites);
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { source, target } = item;
    if (!(source === AUTO || isLangCode(source)) || !isLangCode(target)) continue;
    const key = `${source}>${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ source, target });
    if (list.length >= FAVORITES_LIMIT) break;
  }
  return list;
}

function saveFavorites() {
  if (!storage.available) {
    setLibraryNotice('Armazenamento local indisponível: favoritos e histórico valem apenas nesta sessão.');
    return;
  }
  if (!storage.write(STORAGE_KEYS.favorites, favorites)) {
    setLibraryNotice('Não foi possível salvar os favoritos neste navegador.');
  }
}

function isValidHistoryEntry(entry) {
  return Boolean(
    entry &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.input === 'string' &&
      typeof entry.text === 'string' &&
      entry.input.length > 0 &&
      entry.text.length > 0 &&
      entry.input.length <= 20000 &&
      entry.text.length <= 40000 &&
      isLangCode(entry.source) &&
      isLangCode(entry.target) &&
      Number.isFinite(entry.at),
  );
}

function loadHistory() {
  const raw = storage.read(STORAGE_KEYS.history);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isValidHistoryEntry)
    .map((entry) => ({
      id: entry.id,
      input: entry.input,
      text: entry.text,
      source: entry.source,
      target: entry.target,
      estimated: entry.estimated === true,
      at: entry.at,
    }))
    .slice(0, HISTORY_LIMIT);
}

/** Grava o histórico descartando entradas antigas se o navegador recusar o espaço. */
function persistHistory() {
  if (!storage.available) {
    setLibraryNotice('Armazenamento local indisponível: o histórico não será mantido ao fechar a página.');
    return false;
  }
  let candidate = historyItems.slice();
  let trimmed = false;
  while (candidate.length > 0) {
    if (storage.write(STORAGE_KEYS.history, candidate)) {
      historyItems = candidate;
      setLibraryNotice(trimmed ? 'Espaço do navegador limitado: entradas mais antigas do histórico foram descartadas.' : '');
      return true;
    }
    candidate = candidate.slice(0, -1);
    trimmed = true;
  }
  storage.remove(STORAGE_KEYS.history);
  historyItems = [];
  setLibraryNotice('O navegador recusou salvar o histórico (espaço cheio ou bloqueado). As traduções não foram gravadas.');
  return false;
}

function addToHistory(result) {
  if (!prefs.historyEnabled || result.fromHistory) return;
  const duplicate = (entry) => entry.input === result.input && entry.source === result.source && entry.target === result.target;
  historyItems = [
    {
      id: newId(),
      input: result.input,
      text: result.text,
      source: result.source,
      target: result.target,
      estimated: result.estimated,
      at: result.at,
    },
    ...historyItems.filter((entry) => !duplicate(entry)),
  ].slice(0, HISTORY_LIMIT);
  persistHistory();
  renderHistory();
}

/* ------------------------------------------------------------------ *
 * Ciclo da tradução
 * ------------------------------------------------------------------ */

function currentSelection() {
  return { sourceSel: els.sourceLang.value, target: els.targetLang.value };
}

/** Valida a entrada atual e resolve o idioma de origem (inclusive a estimativa). */
function validate() {
  const text = els.source.value;
  const { sourceSel, target } = currentSelection();
  const count = countCodepoints(text);

  if (!text.trim()) {
    return { ok: false, kind: 'empty', reason: 'Digite ou cole um texto para traduzir.' };
  }
  if (count > MAX_CODEPOINTS) {
    return {
      ok: false,
      kind: 'over',
      reason: `O limite por tradução é de ${fmt(MAX_CODEPOINTS)} caracteres. Remova ${fmt(count - MAX_CODEPOINTS)}.`,
    };
  }

  let source = sourceSel;
  let estimated = false;
  if (sourceSel === AUTO) {
    const detection = detectLanguage(text);
    if (!detection) {
      return {
        ok: false,
        kind: 'detect',
        reason: 'Não foi possível estimar o idioma de origem. Selecione-o manualmente em “De”.',
      };
    }
    source = detection.code;
    estimated = true;
  }

  if (source === target) {
    return {
      ok: false,
      kind: 'same',
      reason: estimated
        ? `O idioma estimado (${langName(source)}) é igual ao destino. Ajuste a origem ou o destino.`
        : 'Escolha idiomas de origem e destino diferentes.',
    };
  }

  return { ok: true, text, count, source, sourceSel, target, estimated };
}

/** Interrompe a requisição em andamento; o resultado tardio é descartado pelo id. */
function abortRun(message) {
  if (!state.run) return false;
  const { controller } = state.run;
  state.run = null;
  state.progress = null;
  state.phase = 'cancelled';
  state.notice = message;
  controller.abort();
  return true;
}

async function startTranslation() {
  const check = validate();
  if (!check.ok) {
    render();
    announce(check.reason);
    if (check.kind === 'empty' || check.kind === 'over') els.source.focus();
    return;
  }

  abortRun('Tradução anterior interrompida para iniciar uma nova.');
  stopSpeech();

  const id = (runSeq += 1);
  const controller = new AbortController();
  const snapshot = {
    input: check.text,
    sourceSel: check.sourceSel,
    source: check.source,
    target: check.target,
    estimated: check.estimated,
  };

  state.run = { id, controller, snapshot };
  state.phase = 'running';
  state.progress = null;
  state.error = null;
  state.notice = null;
  state.result = null;
  render();
  announce('Traduzindo.');

  try {
    const output = await translateText(snapshot.input, {
      source: snapshot.source,
      target: snapshot.target,
      signal: controller.signal,
      onProgress: (progress) => {
        if (state.run?.id !== id) return;
        state.progress = sanitizeProgress(progress);
        renderProgress();
      },
    });

    if (state.run?.id !== id || controller.signal.aborted) return; // resposta obsoleta
    if (typeof output !== 'string' || output.trim() === '') {
      throw new Error('O provedor devolveu uma resposta vazia.');
    }

    state.run = null;
    state.progress = null;
    state.phase = 'done';
    state.result = { ...snapshot, text: output, at: Date.now(), fromHistory: false };
    addToHistory(state.result);
    announce('Tradução concluída.');
  } catch (error) {
    if (state.run?.id !== id) return; // já cancelada/substituída: não sobrescreve o estado atual
    state.run = null;
    state.progress = null;
    if (controller.signal.aborted || error?.name === 'AbortError') {
      state.phase = 'cancelled';
      state.notice = state.notice ?? 'Tradução cancelada. Nenhum resultado parcial foi exibido.';
    } else {
      state.phase = 'error';
      state.error = describeError(error);
      announce(`Erro: ${state.error.title}`);
    }
  }
  render();
}

function sanitizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const total = Number(progress.total);
  const completed = Number(progress.completed);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(completed) || completed < 0) return null;
  return { completed: Math.min(completed, total), total };
}

function describeError(error) {
  const raw = typeof error?.message === 'string' ? error.message.trim() : '';
  const status = Number(error?.status ?? error?.code);
  const haystack = `${raw} ${error?.code ?? ''}`.toLowerCase();
  const detail = raw ? `Detalhe técnico: ${truncateCodepoints(raw, 240)}` : '';

  if (navigator.onLine === false) {
    return {
      title: 'Sem conexão com a internet',
      message: 'O texto original foi mantido. Reconecte e tente novamente.',
      detail,
    };
  }
  if (status === 429 || /quota|limit|excee|too many requests|mymemory warning/i.test(haystack)) {
    return {
      title: 'Limite do provedor atingido',
      message:
        'O MyMemory recusou o pedido por uso excessivo. A cota anônima é diária e controlada pelo provedor; este aplicativo não conhece o saldo. Tente novamente mais tarde ou com um texto menor.',
      detail,
    };
  }
  if (/timeout|tempo esgotado|timed out/i.test(haystack)) {
    return {
      title: 'Tempo de resposta esgotado',
      message: 'O provedor demorou demais para responder. O texto original foi mantido; tente novamente.',
      detail,
    };
  }
  if (error?.name === 'TypeError' || /network|failed to fetch|networkerror/i.test(haystack)) {
    return {
      title: 'Falha de rede ao falar com o MyMemory',
      message: 'Não foi possível completar a comunicação com o serviço. Verifique a conexão e tente novamente.',
      detail,
    };
  }
  return {
    title: 'Não foi possível concluir a tradução',
    message: 'Nenhum resultado parcial é exibido como completo. O texto original foi mantido; tente novamente.',
    detail,
  };
}

/** O resultado só vale para o texto e os idiomas que o geraram. */
function isResultCurrent() {
  const result = state.result;
  if (!result) return false;
  const { sourceSel, target } = currentSelection();
  return result.input === els.source.value && result.sourceSel === sourceSel && result.target === target;
}

/* ------------------------------------------------------------------ *
 * Renderização
 * ------------------------------------------------------------------ */

function announce(message) {
  els.announcer.textContent = '';
  window.setTimeout(() => {
    els.announcer.textContent = message;
  }, 60);
}

function render() {
  renderCounter();
  renderDetection();
  renderActions();
  renderProgress();
  renderNotice();
  renderError();
  renderResult();
  renderFavoriteToggle();
}

function renderCounter() {
  const count = countCodepoints(els.source.value);
  els.charCount.textContent = `${fmt(count)} / ${fmt(MAX_CODEPOINTS)}`;
  els.charCount.classList.toggle('counter--over', count > MAX_CODEPOINTS);
  els.charCount.classList.toggle('counter--near', count <= MAX_CODEPOINTS && count >= MAX_CODEPOINTS * 0.9);

  const over = count > MAX_CODEPOINTS;
  els.source.setAttribute('aria-invalid', over ? 'true' : 'false');
  els.limitMsg.hidden = !over;
  if (over) {
    els.limitMsg.textContent = `Excede o limite em ${fmt(count - MAX_CODEPOINTS)} caracteres. Reduza o texto para traduzir; nada é cortado automaticamente.`;
  }
}

function renderDetection() {
  const auto = els.sourceLang.value === AUTO;
  els.detectNote.hidden = !auto;

  if (!auto) {
    els.detectPill.hidden = true;
    els.source.lang = els.sourceLang.value;
    return;
  }
  const detection = els.source.value.trim() ? detectLanguage(els.source.value) : null;
  state.detection = detection;
  els.source.lang = detection?.code ?? '';
  els.detectPill.hidden = false;
  if (!els.source.value.trim()) {
    els.detectPill.className = 'pill pill--muted';
    els.detectPill.textContent = 'Sem texto para estimar';
  } else if (!detection) {
    els.detectPill.className = 'pill pill--muted';
    els.detectPill.textContent = 'Idioma não estimado — escolha manualmente';
  } else {
    els.detectPill.className = 'pill';
    els.detectPill.textContent = `Estimativa: ${langName(detection.code)} (confiança ${detection.confidence})`;
    els.detectPill.title = `Estimativa local por ${detection.note}. Não é uma detecção fornecida pelo provedor.`;
  }
}

function renderActions() {
  const running = state.phase === 'running';
  const check = validate();

  els.translate.disabled = running || !check.ok;
  els.translateLabel.textContent = running ? 'Traduzindo…' : 'Traduzir';
  els.actionHint.textContent = running ? 'Esc cancela a tradução em andamento.' : check.ok ? '' : check.reason;

  els.clearSource.disabled = els.source.value.length === 0;

  // Inverter exige um código explícito na origem.
  const canSwap = els.sourceLang.value !== AUTO || Boolean(state.detection);
  els.swap.disabled = !canSwap;
  els.swap.title = canSwap
    ? 'Inverter idiomas'
    : 'Estime ou escolha o idioma de origem para inverter';

  const resultReady = isResultCurrent() && state.phase !== 'running';
  els.copyResult.disabled = !resultReady;
  els.listenResult.disabled = !resultReady || !speech.supported;
  els.listenResult.title = speech.supported
    ? resultReady
      ? 'Ouvir a tradução'
      : 'Disponível quando houver uma tradução concluída e atual'
    : 'Este navegador não oferece leitura em voz alta';

  const sourceSpeechLang = els.sourceLang.value === AUTO ? state.detection?.code : els.sourceLang.value;
  els.listenSource.disabled = !speech.supported || !els.source.value.trim() || !sourceSpeechLang;
  els.listenSource.title = speech.supported
    ? 'Ouvir o texto original'
    : 'Este navegador não oferece leitura em voz alta';

  renderSpeechButtons();
}

function renderProgress() {
  const running = state.phase === 'running';
  els.progress.hidden = !running;
  els.resultPane.setAttribute('aria-busy', running ? 'true' : 'false');
  if (!running) return;

  const progress = state.progress;
  if (!progress) {
    els.progressTitle.textContent = 'Preparando envio…';
    els.progressDetail.textContent = 'O texto é dividido em blocos antes do envio ao MyMemory.';
    els.progressBar.classList.add('progress--indeterminate');
    els.progressBar.removeAttribute('aria-valuenow');
    els.progressFill.style.width = '';
    return;
  }

  const percent = Math.round((progress.completed / progress.total) * 100);
  const finishing = progress.completed >= progress.total;
  els.progressTitle.textContent = finishing ? 'Finalizando…' : 'Traduzindo…';
  els.progressDetail.textContent = `Bloco ${fmt(progress.completed)} de ${fmt(progress.total)} (${percent}%)`;
  els.progressBar.classList.remove('progress--indeterminate');
  els.progressBar.setAttribute('aria-valuenow', String(percent));
  els.progressFill.style.width = `${percent}%`;
}

function renderNotice() {
  const visible = Boolean(state.notice) && state.phase !== 'running';
  els.notice.hidden = !visible;
  if (visible) els.noticeText.textContent = state.notice;
}

function renderError() {
  const error = state.phase === 'error' ? state.error : null;
  els.error.hidden = !error;
  if (!error) return;
  els.errorTitle.textContent = error.title;
  els.errorMessage.textContent = error.message;
  els.errorDetail.textContent = error.detail;
  els.errorDetail.hidden = !error.detail;
}

function renderResult() {
  const running = state.phase === 'running';
  const result = state.result;
  const current = isResultCurrent();
  const stale = Boolean(result) && !current && !running;

  els.resultLoading.hidden = !running;
  els.resultOutput.hidden = running || !result;
  els.resultEmpty.hidden = running || Boolean(result);
  els.staleNote.hidden = !stale;

  if (result && !running) {
    els.resultOutput.textContent = result.text;
    els.resultOutput.lang = result.target;
    els.resultOutput.classList.toggle('result-output--stale', stale);
  }

  // Badge
  const badge = els.resultBadge;
  badge.className = 'badge';
  if (running) {
    badge.classList.add('badge--running');
    badge.textContent = 'Em andamento';
  } else if (stale) {
    badge.classList.add('badge--stale');
    badge.textContent = 'Desatualizada';
  } else if (result) {
    badge.classList.add('badge--done');
    badge.textContent = 'Concluída';
  } else if (state.phase === 'error') {
    badge.classList.add('badge--error');
    badge.textContent = 'Falhou';
  } else if (state.phase === 'cancelled') {
    badge.textContent = 'Cancelada';
  } else {
    badge.classList.add('badge--idle');
    badge.textContent = 'Pronto';
  }

  // Estado vazio
  if (!result && !running) {
    if (state.phase === 'error') {
      els.emptyTitle.textContent = 'Nenhuma tradução concluída';
      els.emptyText.textContent = 'Veja o erro acima. O texto original foi mantido para nova tentativa.';
    } else if (state.phase === 'cancelled') {
      els.emptyTitle.textContent = 'Nenhuma tradução concluída';
      els.emptyText.textContent = 'A operação foi interrompida. Clique em Traduzir para recomeçar.';
    } else {
      els.emptyTitle.textContent = 'A tradução aparecerá aqui';
      els.emptyText.textContent = 'Escolha os idiomas, digite o texto e clique em Traduzir. Nada é enviado antes disso.';
    }
  }

  // Rodapé do resultado
  if (running) {
    els.resultMeta.textContent = 'Enviando ao MyMemory…';
  } else if (result) {
    const parts = [
      `${langName(result.source)}${result.estimated ? ' (estimado)' : ''} → ${langName(result.target)}`,
      `${fmt(countCodepoints(result.text))} caracteres`,
      dateFormat.format(new Date(result.at)),
    ];
    if (result.fromHistory) parts.push('do histórico');
    els.resultMeta.textContent = parts.join(' · ');
  } else {
    els.resultMeta.textContent = '';
  }
}

/* ------------------------------------------------------------------ *
 * Favoritos
 * ------------------------------------------------------------------ */

function favoriteIndex() {
  const { sourceSel, target } = currentSelection();
  return favorites.findIndex((item) => item.source === sourceSel && item.target === target);
}

function renderFavoriteToggle() {
  const active = favoriteIndex() >= 0;
  els.favoriteToggle.setAttribute('aria-pressed', active ? 'true' : 'false');
  els.favoriteLabel.textContent = active ? 'Par favoritado' : 'Favoritar par';
}

function renderFavorites() {
  els.favoritesList.replaceChildren();
  for (const item of favorites) {
    const node = els.tplFavorite.content.firstElementChild.cloneNode(true);
    const label = `${langName(item.source)} → ${langName(item.target)}`;
    const apply = node.querySelector('.chip__apply');
    const remove = node.querySelector('.chip__remove');
    apply.textContent = label;
    apply.title = `Usar ${label}`;
    remove.setAttribute('aria-label', `Remover favorito ${label}`);
    apply.addEventListener('click', () => applyFavorite(item));
    remove.addEventListener('click', () => removeFavorite(item));
    els.favoritesList.append(node);
  }
  els.favoritesEmpty.hidden = favorites.length > 0;
  renderFavoriteToggle();
}

function applyFavorite(item) {
  els.sourceLang.value = item.source;
  els.targetLang.value = item.target;
  handleLanguageChange('Tradução interrompida porque os idiomas foram alterados. Clique em Traduzir para recomeçar.');
  els.source.focus();
}

function removeFavorite(item) {
  favorites = favorites.filter((fav) => !(fav.source === item.source && fav.target === item.target));
  saveFavorites();
  renderFavorites();
  announce('Favorito removido.');
}

function toggleFavorite() {
  const index = favoriteIndex();
  if (index >= 0) {
    favorites.splice(index, 1);
    announce('Par removido dos favoritos.');
  } else {
    if (favorites.length >= FAVORITES_LIMIT) {
      setLibraryNotice(`Limite de ${FAVORITES_LIMIT} pares favoritos. Remova um par para adicionar outro.`);
      return;
    }
    const { sourceSel, target } = currentSelection();
    favorites.unshift({ source: sourceSel, target });
    announce('Par salvo nos favoritos.');
  }
  saveFavorites();
  renderFavorites();
}

/* ------------------------------------------------------------------ *
 * Histórico
 * ------------------------------------------------------------------ */

function renderHistory() {
  els.historyList.replaceChildren();
  for (const entry of historyItems) {
    const node = els.tplHistory.content.firstElementChild.cloneNode(true);
    const pair = `${langName(entry.source)}${entry.estimated ? ' (est.)' : ''} → ${langName(entry.target)}`;
    node.querySelector('.history__pair').textContent = pair;
    node.querySelector('.history__time').textContent = dateFormat.format(new Date(entry.at));
    node.querySelector('.history__source').textContent = truncateCodepoints(entry.input, 110);
    node.querySelector('.history__result').textContent = truncateCodepoints(entry.text, 110);

    const open = node.querySelector('.history__open');
    open.setAttribute('aria-label', `Reabrir tradução ${pair}: ${truncateCodepoints(entry.input, 60)}`);
    open.addEventListener('click', () => restoreHistoryEntry(entry));

    const remove = node.querySelector('.history__remove');
    remove.setAttribute('aria-label', `Remover do histórico: ${truncateCodepoints(entry.input, 60)}`);
    remove.addEventListener('click', () => {
      historyItems = historyItems.filter((item) => item.id !== entry.id);
      persistHistory();
      renderHistory();
      announce('Entrada removida do histórico.');
    });

    els.historyList.append(node);
  }
  els.historyEmpty.hidden = historyItems.length > 0;
  els.historyEmpty.textContent = prefs.historyEnabled
    ? 'Nenhuma tradução salva ainda.'
    : 'O histórico está desativado. Ative acima para salvar as próximas traduções neste navegador.';
  els.historyClear.hidden = historyItems.length === 0;
  resetClearConfirm();
}

function restoreHistoryEntry(entry) {
  abortRun('Tradução interrompida para abrir um item do histórico.');
  stopSpeech();
  els.source.value = entry.input;
  els.sourceLang.value = entry.source;
  els.targetLang.value = entry.target;
  prefs.source = entry.source;
  prefs.target = entry.target;
  savePrefs();
  detectionCache = { text: null, value: null };
  state.phase = 'done';
  state.error = null;
  state.notice = null;
  state.progress = null;
  state.result = {
    input: entry.input,
    text: entry.text,
    source: entry.source,
    sourceSel: entry.source,
    target: entry.target,
    estimated: entry.estimated,
    at: entry.at,
    fromHistory: true,
  };
  render();
  els.resultOutput.focus();
  announce('Tradução do histórico aberta.');
}

let clearConfirmTimer = null;

function resetClearConfirm() {
  window.clearTimeout(clearConfirmTimer);
  clearConfirmTimer = null;
  els.historyClear.textContent = 'Apagar histórico';
  els.historyClear.dataset.confirm = 'false';
}

function handleClearHistory() {
  if (els.historyClear.dataset.confirm !== 'true') {
    els.historyClear.dataset.confirm = 'true';
    els.historyClear.textContent = 'Confirmar exclusão';
    clearConfirmTimer = window.setTimeout(resetClearConfirm, 5000);
    return;
  }
  historyItems = [];
  storage.remove(STORAGE_KEYS.history);
  renderHistory();
  announce('Histórico apagado.');
}

/* ------------------------------------------------------------------ *
 * Voz
 * ------------------------------------------------------------------ */

const speech = {
  supported: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
  active: null, // 'source' | 'result'
  token: 0,
};

function renderSpeechButtons() {
  const sourceActive = speech.active === 'source';
  const resultActive = speech.active === 'result';
  els.listenSource.setAttribute('aria-pressed', sourceActive ? 'true' : 'false');
  els.listenSource.querySelector('.tool-btn__label').textContent = sourceActive ? 'Parar' : 'Ouvir';
  els.listenResult.setAttribute('aria-pressed', resultActive ? 'true' : 'false');
  els.listenResult.querySelector('.tool-btn__label').textContent = resultActive ? 'Parar' : 'Ouvir';
}

function stopSpeech() {
  speech.token += 1;
  speech.active = null;
  if (speech.supported) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignorado: alguns navegadores recusam cancel fora de interação */
    }
  }
  renderSpeechButtons();
}

function packForSpeech(text, max = 200) {
  const pieces = text.replace(/\s+/g, ' ').trim().match(/[^.!?;。！？\n]+[.!?;。！？]*\s*/gu) ?? [];
  const chunks = [];
  let buffer = '';
  const push = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };
  for (const piece of pieces) {
    if ((buffer + piece).length <= max) {
      buffer += piece;
      continue;
    }
    push();
    if (piece.length <= max) {
      buffer = piece;
      continue;
    }
    let line = '';
    for (const word of piece.split(' ')) {
      if ((line + word).length + 1 > max) {
        if (line.trim()) chunks.push(line.trim());
        line = '';
      }
      if (word.length > max) {
        const points = Array.from(word);
        for (let i = 0; i < points.length; i += max) chunks.push(points.slice(i, i + max).join(''));
        continue;
      }
      line += `${word} `;
    }
    if (line.trim()) chunks.push(line.trim());
  }
  push();
  return chunks.filter(Boolean);
}

function speak(which) {
  if (!speech.supported) return;
  if (speech.active === which) {
    stopSpeech();
    return;
  }
  stopSpeech();

  const text = which === 'source' ? els.source.value : state.result?.text ?? '';
  const code = which === 'source' ? (els.sourceLang.value === AUTO ? state.detection?.code : els.sourceLang.value) : state.result?.target;
  if (!text.trim() || !code) return;

  const tag = LANG_BY_CODE.get(code)?.speech ?? code;
  const chunks = packForSpeech(text);
  if (chunks.length === 0) return;

  const token = (speech.token += 1);
  speech.active = which;
  renderSpeechButtons();

  const voices = window.speechSynthesis.getVoices?.() ?? [];
  const voice =
    voices.find((item) => item.lang?.toLowerCase() === tag.toLowerCase()) ??
    voices.find((item) => item.lang?.toLowerCase().startsWith(code.toLowerCase()));

  chunks.forEach((chunk, index) => {
    const utterance = new window.SpeechSynthesisUtterance(chunk);
    utterance.lang = tag;
    if (voice) utterance.voice = voice;
    if (index === chunks.length - 1) {
      utterance.onend = () => {
        if (speech.token !== token) return;
        speech.active = null;
        renderSpeechButtons();
      };
    }
    utterance.onerror = (event) => {
      if (speech.token !== token) return;
      speech.active = null;
      renderSpeechButtons();
      if (event?.error && event.error !== 'interrupted' && event.error !== 'canceled') {
        announce('Não foi possível reproduzir o áudio neste navegador.');
      }
    };
    window.speechSynthesis.speak(utterance);
  });
}

/* ------------------------------------------------------------------ *
 * Copiar
 * ------------------------------------------------------------------ */

let copyTimer = null;

async function copyResult() {
  if (!isResultCurrent()) return;
  const text = state.result.text;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacyCopy(text);
  }
  window.clearTimeout(copyTimer);
  els.copyLabel.textContent = ok ? 'Copiado' : 'Falhou';
  copyTimer = window.setTimeout(() => {
    els.copyLabel.textContent = 'Copiar';
  }, 1800);
  announce(ok ? 'Tradução copiada.' : 'Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
}

function legacyCopy(text) {
  try {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    const ok = document.execCommand('copy');
    helper.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

function handleLanguageChange(message) {
  abortRun(message);
  if (speech.active) stopSpeech();
  prefs.source = els.sourceLang.value;
  prefs.target = els.targetLang.value;
  savePrefs();
  render();
}

function swapLanguages() {
  const target = els.targetLang.value;
  let source = els.sourceLang.value;
  if (source === AUTO) {
    if (!state.detection) return;
    source = state.detection.code;
  }
  const carry = isResultCurrent() && state.phase !== 'running' ? state.result.text : null;

  abortRun('Tradução interrompida pela inversão de idiomas. Clique em Traduzir para recomeçar.');
  if (speech.active) stopSpeech();

  els.sourceLang.value = target;
  els.targetLang.value = source;

  if (carry !== null) {
    els.source.value = carry;
    state.result = null;
    state.phase = 'idle';
    state.notice = null;
    detectionCache = { text: null, value: null };
  }

  prefs.source = els.sourceLang.value;
  prefs.target = els.targetLang.value;
  savePrefs();
  render();
  announce(`Idiomas invertidos: ${langName(els.sourceLang.value)} para ${langName(els.targetLang.value)}.`);
}

function clearSource() {
  abortRun('Tradução interrompida porque o texto foi limpo.');
  if (speech.active) stopSpeech();
  els.source.value = '';
  state.result = null;
  state.error = null;
  state.notice = null;
  state.progress = null;
  state.phase = 'idle';
  render();
  els.source.focus();
}

function bindEvents() {
  els.source.addEventListener('input', () => {
    abortRun('Tradução interrompida porque o texto foi editado. Clique em Traduzir para recomeçar.');
    if (speech.active === 'source' || (speech.active === 'result' && !isResultCurrent())) stopSpeech();
    render();
  });

  els.sourceLang.addEventListener('change', () =>
    handleLanguageChange('Tradução interrompida porque o idioma de origem mudou. Clique em Traduzir para recomeçar.'),
  );
  els.targetLang.addEventListener('change', () =>
    handleLanguageChange('Tradução interrompida porque o idioma de destino mudou. Clique em Traduzir para recomeçar.'),
  );

  els.swap.addEventListener('click', swapLanguages);
  els.favoriteToggle.addEventListener('click', toggleFavorite);
  els.clearSource.addEventListener('click', clearSource);
  els.translate.addEventListener('click', startTranslation);
  els.retry.addEventListener('click', startTranslation);

  els.cancel.addEventListener('click', () => {
    if (abortRun('Tradução cancelada por você. Nenhum resultado parcial foi exibido.')) {
      render();
      announce('Tradução cancelada.');
    }
  });

  els.noticeDismiss.addEventListener('click', () => {
    state.notice = null;
    if (state.phase === 'cancelled') state.phase = 'idle';
    render();
  });

  els.errorDismiss.addEventListener('click', () => {
    state.error = null;
    if (state.phase === 'error') state.phase = 'idle';
    render();
  });

  els.listenSource.addEventListener('click', () => speak('source'));
  els.listenResult.addEventListener('click', () => speak('result'));
  els.copyResult.addEventListener('click', copyResult);

  els.historyEnabled.addEventListener('change', () => {
    prefs.historyEnabled = els.historyEnabled.checked;
    savePrefs();
    renderHistory();
    announce(
      prefs.historyEnabled
        ? 'Histórico ativado: as próximas traduções ficam salvas neste navegador.'
        : 'Histórico desativado: novas traduções não serão salvas.',
    );
  });

  els.historyClear.addEventListener('click', handleClearHistory);

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      startTranslation();
      return;
    }
    if (event.key === 'Escape' && state.phase === 'running') {
      event.preventDefault();
      if (abortRun('Tradução cancelada por você. Nenhum resultado parcial foi exibido.')) {
        render();
        announce('Tradução cancelada.');
      }
    }
  });

  window.addEventListener('pagehide', () => {
    abortRun(null);
    stopSpeech();
  });

  // Outra aba pode alterar o armazenamento; recarrega listas sem perder o estado atual.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.history) {
      historyItems = loadHistory();
      renderHistory();
    } else if (event.key === STORAGE_KEYS.favorites) {
      favorites = loadFavorites();
      renderFavorites();
    }
  });

  if (speech.supported && typeof window.speechSynthesis.addEventListener === 'function') {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      /* vozes carregadas de forma assíncrona; nada a fazer além de mantê-las disponíveis */
    });
  }
}

/* ------------------------------------------------------------------ *
 * Início
 * ------------------------------------------------------------------ */

function fillSelects() {
  const auto = document.createElement('option');
  auto.value = AUTO;
  auto.textContent = 'Detectar idioma (estimativa)';
  els.sourceLang.append(auto);
  for (const lang of LANGUAGES) {
    const source = document.createElement('option');
    source.value = lang.code;
    source.textContent = lang.name;
    els.sourceLang.append(source);

    const target = document.createElement('option');
    target.value = lang.code;
    target.textContent = lang.name;
    els.targetLang.append(target);
  }
  els.sourceLang.value = prefs.source;
  els.targetLang.value = prefs.target;
}

function init() {
  if (typeof translateText !== 'function') {
    $('boot-error').hidden = false;
    return;
  }

  fillSelects();
  els.translateKbd.textContent = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘ Enter' : 'Ctrl Enter';

  els.historyEnabled.checked = prefs.historyEnabled;
  els.historyEnabled.disabled = !storage.available;
  if (!storage.available) {
    setLibraryNotice(
      'O armazenamento local está indisponível neste navegador (modo privado ou bloqueio). Favoritos valem só nesta sessão e o histórico não pode ser salvo.',
    );
  }

  bindEvents();
  renderFavorites();
  renderHistory();
  render();

  document.documentElement.setAttribute('data-app-ready', 'true');
}

init();
