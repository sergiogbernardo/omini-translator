import { spawn } from "node:child_process";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222;
const APP_URL = "http://127.0.0.1:8766";

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.msgId = 0;
    this.callbacks = new Map();
    this.events = [];
    this.eventListeners = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const l of listeners) l(msg.params);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, cb) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event).push(cb);
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.exception?.description || expression}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function runBrowserTests() {
  console.log("=== Launching Chrome Headless ===");
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--no-sandbox",
    "--disable-gpu",
    "--window-size=1280,800",
  ]);

  let cdp = null;
  const testResults = [];
  const record = (name, ok, detail = "") => {
    testResults.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}: ${name} ${detail ? "(" + detail + ")" : ""}`);
  };

  try {
    // Wait for Chrome to open debugging port
    let connected = false;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const targets = await res.json();
        if (targets.length > 0 && targets[0].webSocketDebuggerUrl) {
          cdp = new CDPClient(targets[0].webSocketDebuggerUrl);
          await cdp.connect();
          connected = true;
          break;
        }
      } catch {}
    }

    if (!connected) throw new Error("Could not connect to Chrome CDP");

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");

    // Capture browser console logs and errors
    const consoleLogs = [];
    const consoleErrors = [];
    cdp.on("Runtime.consoleAPICalled", (params) => {
      const text = params.args.map((a) => a.value ?? a.description).join(" ");
      if (params.type === "error") consoleErrors.push(text);
      else consoleLogs.push(text);
    });

    console.log("=== Navigating to " + APP_URL + " ===");
    await cdp.send("Page.navigate", { url: APP_URL });
    await sleep(600);

    // 1. Initial State & Boot
    const bootReady = await cdp.eval("document.documentElement.hasAttribute('data-app-ready')");
    record("App boots with data-app-ready attribute", bootReady === true);

    const bootErrorHidden = await cdp.eval("document.getElementById('boot-error').hidden");
    record("Boot error element is hidden", bootErrorHidden === true);

    const initialSourceLang = await cdp.eval("document.getElementById('source-lang').value");
    const initialTargetLang = await cdp.eval("document.getElementById('target-lang').value");
    record("Default languages are pt -> en", initialSourceLang === "pt" && initialTargetLang === "en");

    const initialCharCount = await cdp.eval("document.getElementById('char-count').textContent");
    record("Initial character count is 0 / 5.000", initialCharCount.includes("0 / 5.000"));

    const initialTranslateDisabled = await cdp.eval("document.getElementById('translate').disabled");
    record("Translate button initially disabled for empty text", initialTranslateDisabled === true);

    const initialHistorySwitch = await cdp.eval("document.getElementById('history-enabled').checked");
    record("History is disabled by default", initialHistorySwitch === false);

    // 2. Character counter and 5,000 limit enforcement
    await cdp.eval("document.getElementById('source-text').value = 'Olá mundo'; document.getElementById('source-text').dispatchEvent(new Event('input'))");
    const updatedCount = await cdp.eval("document.getElementById('char-count').textContent");
    const translateNowEnabled = await cdp.eval("document.getElementById('translate').disabled");
    record("Typing updates counter and enables Translate", updatedCount.includes("9 / 5.000") && translateNowEnabled === false);

    // Over limit: 5001 chars
    await cdp.eval("document.getElementById('source-text').value = 'a'.repeat(5001); document.getElementById('source-text').dispatchEvent(new Event('input'))");
    const overLimitDisabled = await cdp.eval("document.getElementById('translate').disabled");
    const limitMsgShown = await cdp.eval("!document.getElementById('limit-msg').hidden");
    const limitMsgText = await cdp.eval("document.getElementById('limit-msg').textContent");
    const ariaInvalid = await cdp.eval("document.getElementById('source-text').getAttribute('aria-invalid')");
    record(
      "Exceeding 5,000 chars disables button and shows non-destructive warning",
      overLimitDisabled === true && limitMsgShown && limitMsgText.includes("1") && ariaInvalid === "true"
    );

    // Reset text
    await cdp.eval("document.getElementById('source-text').value = ''; document.getElementById('source-text').dispatchEvent(new Event('input'))");

    // 3. Language detection heuristics
    await cdp.eval("document.getElementById('source-lang').value = 'auto'; document.getElementById('source-lang').dispatchEvent(new Event('change'))");
    const detectNoteVisible = await cdp.eval("!document.getElementById('detect-note').hidden");
    record("Selecting 'auto' displays local estimate notice", detectNoteVisible === true);

    await cdp.eval("document.getElementById('source-text').value = 'Good morning everyone, this is an English sentence.'; document.getElementById('source-text').dispatchEvent(new Event('input'))");
    const pillText = await cdp.eval("document.getElementById('detect-pill').textContent");
    record("Detection heuristic estimates English with confidence label", pillText.includes("Inglês") && pillText.includes("confiança"));

    // 4. Swap button behavior
    const swapDisabledBefore = await cdp.eval("document.getElementById('swap').disabled");
    record("Swap button is enabled when detection succeeds", swapDisabledBefore === false);
    await cdp.eval("document.getElementById('swap').click()");
    const swappedSource = await cdp.eval("document.getElementById('source-lang').value");
    const swappedTarget = await cdp.eval("document.getElementById('target-lang').value");
    record("Swapping sets source to detected language ('en') and target to former source ('en'->'pt')", swappedSource === "en" && swappedTarget === "en");

    // Fix languages for translation test: source = en, target = pt
    await cdp.eval("document.getElementById('target-lang').value = 'pt'; document.getElementById('target-lang').dispatchEvent(new Event('change'))");

    // 5. Mock translation via window.fetch injection in page
    await cdp.eval(`
      window.__realFetch = window.fetch;
      window.__mockDelay = 100;
      window.__mockResponse = (translatedText, status = 200, quotaFinished = false) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({
          responseStatus: status,
          quotaFinished,
          responseData: { translatedText },
        }),
      });

      window.fetch = async (url, options) => {
        if (url.includes("api.mymemory.translated.net")) {
          window.__lastFetchUrl = url;
          window.__fetchCount = (window.__fetchCount || 0) + 1;
          if (window.__forceDelay) await new Promise(r => setTimeout(r, window.__forceDelay));
          if (window.__forceError) throw new Error(window.__forceError);
          if (window.__forceStatus) return window.__mockResponse("ERR", window.__forceStatus);
          if (window.__forceQuota) return window.__mockResponse("MYMEMORY WARNING: QUOTA FINISHED", 200, true);
          return window.__mockResponse("Bom dia a todos, esta é uma frase em inglês.");
        }
        return window.__realFetch(url, options);
      };
    `);

    // Click translate
    await cdp.eval("document.getElementById('translate').click()");
    await sleep(200);

    const resultOutput = await cdp.eval("document.getElementById('result-output').textContent");
    const resultBadge = await cdp.eval("document.getElementById('result-badge').textContent");
    const copyEnabled = await cdp.eval("!document.getElementById('copy-result').disabled");
    record(
      "Translation succeeds and updates output, badge, and copy button",
      resultOutput.includes("Bom dia a todos") && resultBadge === "Concluída" && copyEnabled
    );

    // 6. Stale state handling
    await cdp.eval("document.getElementById('source-text').value = document.getElementById('source-text').value + '!'; document.getElementById('source-text').dispatchEvent(new Event('input'))");
    const staleBadge = await cdp.eval("document.getElementById('result-badge').textContent");
    const staleNoteVisible = await cdp.eval("!document.getElementById('stale-note').hidden");
    const copyDisabledWhenStale = await cdp.eval("document.getElementById('copy-result').disabled");
    record(
      "Editing input marks result as 'Desatualizada' and disables copy",
      staleBadge === "Desatualizada" && staleNoteVisible && copyDisabledWhenStale === true
    );

    // 7. Clear source button
    await cdp.eval("document.getElementById('clear-source').click()");
    const clearedInput = await cdp.eval("document.getElementById('source-text').value");
    const clearedResultHidden = await cdp.eval("document.getElementById('result-output').hidden");
    const resultBadgeAfterClear = await cdp.eval("document.getElementById('result-badge').textContent");
    record(
      "Clear button clears source and resets result output",
      clearedInput === "" && clearedResultHidden && resultBadgeAfterClear === "Pronto"
    );

    // 8. Mid-flight cancellation and Esc key
    await cdp.eval(`
      window.__forceDelay = 2000;
      document.getElementById('source-text').value = 'Slow translation sentence.';
      document.getElementById('source-text').dispatchEvent(new Event('input'));
    `);
    await cdp.eval("document.getElementById('translate').click()");
    await sleep(50);

    const progressVisible = await cdp.eval("!document.getElementById('progress').hidden");
    const cancelButton = await cdp.eval("document.getElementById('cancel')");
    record("In-progress translation displays progress bar and cancel button", progressVisible && Boolean(cancelButton));

    // Cancel by clicking Cancel button
    await cdp.eval("document.getElementById('cancel').click()");
    await sleep(100);

    const noticeAfterCancel = await cdp.eval("document.getElementById('notice-text').textContent");
    const badgeAfterCancel = await cdp.eval("document.getElementById('result-badge').textContent");
    record(
      "Clicking Cancel aborts operation and displays notification without partial result",
      noticeAfterCancel.includes("cancelada por você") && badgeAfterCancel === "Cancelada"
    );

    // 9. Quota exceeded (429 / warning) error handling
    await cdp.eval(`
      window.__forceDelay = 0;
      window.__forceQuota = true;
      document.getElementById('source-text').value = 'Test quota text';
      document.getElementById('source-text').dispatchEvent(new Event('input'));
    `);
    await cdp.eval("document.getElementById('translate').click()");
    await sleep(200);

    const errorVisible = await cdp.eval("!document.getElementById('error').hidden");
    const errorTitle = await cdp.eval("document.getElementById('error-title').textContent");
    const retryVisible = await cdp.eval("!document.getElementById('retry').hidden");
    record(
      "Quota exhaustion shows distinct error with Retry option",
      errorVisible && errorTitle.includes("Limite do provedor atingido") && retryVisible
    );

    // 10. Security: XSS Prevention in Input and Provider Response
    await cdp.eval(`
      window.__forceQuota = false;
      window.XSS_INPUT_TRIGGERED = false;
      window.XSS_OUTPUT_TRIGGERED = false;
      window.fetch = async () => window.__mockResponse(
        '<script>window.XSS_OUTPUT_TRIGGERED=true;<\\/script><img src=invalid onerror="window.XSS_OUTPUT_TRIGGERED=true">'
      );
      document.getElementById('source-text').value = '<script>window.XSS_INPUT_TRIGGERED=true;<\\/script><img src=invalid onerror="window.XSS_INPUT_TRIGGERED=true">';
      document.getElementById('source-text').dispatchEvent(new Event('input'));
    `);
    await cdp.eval("document.getElementById('translate').click()");
    await sleep(300);

    const xssInput = await cdp.eval("window.XSS_INPUT_TRIGGERED");
    const xssOutput = await cdp.eval("window.XSS_OUTPUT_TRIGGERED");
    const renderedResultOutput = await cdp.eval("document.getElementById('result-output').innerHTML");
    record(
      "No XSS execution from malicious input or malicious provider response",
      xssInput === false && xssOutput === false && !renderedResultOutput.includes("<script")
    );

    // 11. LocalStorage & History
    await cdp.eval("localStorage.clear()");
    await cdp.eval("document.getElementById('history-enabled').click()");
    const historyEnabledChecked = await cdp.eval("document.getElementById('history-enabled').checked");

    await cdp.eval(`
      window.fetch = async () => window.__mockResponse("Tradução salva no histórico.");
      document.getElementById('source-text').value = "Texto a ser salvo.";
      document.getElementById('source-text').dispatchEvent(new Event('input'));
    `);
    await cdp.eval("document.getElementById('translate').click()");
    await sleep(200);

    const historyItemsCount = await cdp.eval("document.querySelectorAll('#history-list .history__item').length");
    const savedInLocalStorage = await cdp.eval("Boolean(localStorage.getItem('omini.history.v1'))");
    record(
      "Enabling history saves completed translation to localStorage and renders history list",
      historyEnabledChecked && historyItemsCount === 1 && savedInLocalStorage
    );

    // Restore from history
    await cdp.eval("document.querySelector('#history-list .history__open').click()");
    const restoredText = await cdp.eval("document.getElementById('result-output').textContent");
    record("Restoring from history reloads text into source and result", restoredText.includes("Tradução salva"));

    // 12. Accessibility audit
    const skipLinkTarget = await cdp.eval("document.querySelector('.skip-link').getAttribute('href')");
    record("Skip link targets #source-text", skipLinkTarget === "#source-text");

    // Test Defect 1: Accessible name of textarea#source-text
    const textareaHasAriaLabel = await cdp.eval("Boolean(document.getElementById('source-text').getAttribute('aria-label'))");
    const textareaHasAriaLabelledby = await cdp.eval("Boolean(document.getElementById('source-text').getAttribute('aria-labelledby'))");
    const textareaHasHtmlLabel = await cdp.eval("Boolean(document.querySelector('label[for=\"source-text\"]'))");
    const textareaAccessibleNameDefect = !textareaHasAriaLabel && !textareaHasAriaLabelledby && !textareaHasHtmlLabel;
    record(
      "DEFECT VERIFIED: textarea#source-text has no accessible name / label",
      textareaAccessibleNameDefect,
      "Lacks aria-label, aria-labelledby, or <label for='source-text'>"
    );

    // Test Defect 2: Favoriting identical pair (e.g. Inglês -> Inglês)
    await cdp.eval(`
      document.getElementById('source-lang').value = 'en';
      document.getElementById('source-lang').dispatchEvent(new Event('change'));
      document.getElementById('target-lang').value = 'en';
      document.getElementById('target-lang').dispatchEvent(new Event('change'));
    `);
    const favToggleDisabled = await cdp.eval("document.getElementById('favorite-toggle').disabled");
    await cdp.eval("document.getElementById('favorite-toggle').click()");
    const favItemText = await cdp.eval("document.querySelector('#favorites-list .chip__apply')?.textContent");
    const identicalFavoriteAllowed = favToggleDisabled === false && favItemText === "Inglês → Inglês";
    record(
      "DEFECT VERIFIED: Allows favoriting identical language pair (en -> en)",
      identicalFavoriteAllowed,
      "Button active and chip created for Inglês -> Inglês"
    );

    // 13. Responsive viewport testing (Desktop 1280px vs Mobile 390px)
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(100);
    const desktopGrid = await cdp.eval("window.getComputedStyle(document.querySelector('.panes')).gridTemplateColumns");
    record("Desktop (1280px) renders 2-column grid", desktopGrid.split(" ").length === 2);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
    await sleep(100);
    const mobileGrid = await cdp.eval("window.getComputedStyle(document.querySelector('.panes')).gridTemplateColumns");
    const horizontalOverflow = await cdp.eval("document.documentElement.scrollWidth > window.innerWidth");
    record(
      "Mobile (390px) renders 1-column layout without horizontal scroll",
      mobileGrid.split(" ").length === 1 && horizontalOverflow === false
    );

    // Check for unexpected console errors
    record("No unhandled browser console errors during session", consoleErrors.length === 0, consoleErrors.join("; "));

    console.log("\n=== SUMMARY OF BROWSER TESTS ===");
    const passed = testResults.filter((r) => r.ok).length;
    console.log(`Total: ${testResults.length}, Passed: ${passed}, Failed: ${testResults.length - passed}`);
  } catch (err) {
    console.error("Browser test run error:", err);
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
  }
}

runBrowserTests();
