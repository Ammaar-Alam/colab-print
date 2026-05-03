(() => {
  if (globalThis.__COLAB_PRINT_CONTENT__) {
    return;
  }

  globalThis.__COLAB_PRINT_CONTENT__ = true;

  const CAPTURE_CLASS = 'colabprint-capturing';
  const OVERLAY_ID = 'colabprint-overlay';
  const STYLE_ID = 'colabprint-style';
  const readyFrames = new WeakSet();

  const state = {
    prepared: false,
    restoreScrollTop: 0,
    provider: 'colab',
    backgroundColor: 'rgb(255, 255, 255)'
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case 'COLAB_PRINT_PING':
        return { ok: true };

      case 'COLAB_PRINT_DETECT_NOTEBOOK':
        return detectNotebook();

      case 'COLAB_PRINT_PREPARE_CAPTURE':
        return prepareCapture();

      case 'COLAB_PRINT_SHOW_PROGRESS':
        return showProgress(message);

      case 'COLAB_PRINT_SCROLL_TO':
        return scrollToPosition(message.position);

      case 'COLAB_PRINT_RESTORE_CAPTURE':
        return restoreCapture(message.finalState);

      default:
        return { ignored: true };
    }
  }

  function detectNotebook() {
    const scrollContainer = getScrollContainer();

    return {
      supported: Boolean(scrollContainer),
      provider: state.provider,
      title: getNotebookTitle()
    };
  }

  async function prepareCapture() {
    const scrollContainer = getRequiredScrollContainer();
    const activeElement = document.activeElement;

    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }

    document.getSelection()?.removeAllRanges();

    state.restoreScrollTop = scrollContainer.scrollTop;
    state.backgroundColor = getNotebookBackgroundColor();

    injectStyle();
    document.documentElement.classList.add(CAPTURE_CLASS);
    ensureOverlay();

    await settleLayout();

    const captureState = getCaptureState();
    state.prepared = true;

    return {
      provider: state.provider,
      title: getNotebookTitle(),
      scrollHeight: scrollContainer.scrollHeight,
      viewport: captureState.viewport,
      captureRect: captureState.captureRect,
      overlap: captureState.overlap,
      backgroundColor: state.backgroundColor
    };
  }

  async function showProgress({ current, total, label }) {
    const overlay = ensureOverlay();
    overlay.hidden = false;
    overlay.querySelector('[data-role="label"]').textContent = label || 'Preparing export';

    const progressValue = total > 0 ? Math.round((current / total) * 100) : 0;
    overlay.querySelector('[data-role="bar"]').style.width = `${progressValue}%`;

    return {};
  }

  async function scrollToPosition(position) {
    const scrollContainer = getRequiredScrollContainer();
    const overlay = ensureOverlay();
    overlay.hidden = true;

    scrollContainer.scrollTop = position;
    await settleLayout();

    const captureState = getCaptureState();

    return {
      viewport: captureState.viewport,
      captureRect: captureState.captureRect,
      position: scrollContainer.scrollTop
    };
  }

  async function restoreCapture(finalState) {
    const scrollContainer = getScrollContainer();

    if (scrollContainer) {
      scrollContainer.scrollTop = state.restoreScrollTop;
    }

    document.documentElement.classList.remove(CAPTURE_CLASS);

    const style = document.getElementById(STYLE_ID);

    if (style) {
      style.remove();
    }

    const overlay = document.getElementById(OVERLAY_ID);

    if (overlay) {
      if (finalState === 'cancelled') {
        overlay.hidden = false;
        overlay.querySelector('[data-role="label"]').textContent = 'Cancelled';
        overlay.querySelector('[data-role="bar"]').style.width = '0%';
        await delay(700);
      } else if (finalState === 'error') {
        overlay.hidden = false;
        overlay.querySelector('[data-role="label"]').textContent = 'Export stopped';
        overlay.querySelector('[data-role="bar"]').style.width = '0%';
        await delay(800);
      }

      overlay.remove();
    }

    state.prepared = false;

    return {};
  }

  function getCaptureState() {
    const scrollContainer = getRequiredScrollContainer();
    const contentRoot = getContentRoot() || scrollContainer;
    const containerRect = scrollContainer.getBoundingClientRect();
    const contentRect = contentRoot.getBoundingClientRect();

    const leftPadding = 20;
    const rightPadding = 20;
    const left = Math.max(containerRect.left, contentRect.left - leftPadding);
    const right = Math.min(containerRect.right, contentRect.right + rightPadding);

    return {
      viewport: {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight)
      },
      captureRect: {
        left,
        top: containerRect.top,
        width: Math.max(1, right - left),
        height: Math.max(1, containerRect.height)
      },
      overlap: 32
    };
  }

  function getNotebookTitle() {
    const titleElement = document.querySelector('input[aria-label*="Notebook"], input[aria-label*="Untitled"]');

    if (titleElement instanceof HTMLInputElement && titleElement.value.trim()) {
      return titleElement.value.trim();
    }

    return document.title
      .replace(/\s*-\s*Colab\s*$/i, '')
      .replace(/\s*-\s*Google Colaboratory\s*$/i, '')
      .trim() || 'Notebook';
  }

  function getScrollContainer() {
    return document.querySelector('colab-shaded-scroller.notebook-container, .notebook-container');
  }

  function getRequiredScrollContainer() {
    const scrollContainer = getScrollContainer();

    if (!scrollContainer) {
      throw new Error('Unable to find the notebook scroll container.');
    }

    return scrollContainer;
  }

  function getContentRoot() {
    return (
      document.querySelector('.notebook-content') ||
      document.querySelector('.notebook-cell-list') ||
      document.querySelector('[role="main"]')
    );
  }

  function getNotebookBackgroundColor() {
    const candidates = [
      getContentRoot(),
      getScrollContainer(),
      document.querySelector('body'),
      document.documentElement
    ].filter(Boolean);

    for (const element of candidates) {
      if (!(element instanceof Element)) {
        continue;
      }

      const color = getComputedStyle(element).backgroundColor;

      if (isSolidColor(color)) {
        return color;
      }
    }

    return 'rgb(255, 255, 255)';
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.${CAPTURE_CLASS}, html.${CAPTURE_CLASS} body {
        scroll-behavior: auto !important;
      }

      html.${CAPTURE_CLASS} #top-toolbar,
      html.${CAPTURE_CLASS} colab-left-pane,
      html.${CAPTURE_CLASS} .cell-toolbar,
      html.${CAPTURE_CLASS} .add-cell,
      html.${CAPTURE_CLASS} paper-tooltip,
      html.${CAPTURE_CLASS} #toggle-header-button-tooltip,
      html.${CAPTURE_CLASS} #toolbar-add-code-tooltip,
      html.${CAPTURE_CLASS} #toolbar-add-text-tooltip,
      html.${CAPTURE_CLASS} colab-help-button,
      html.${CAPTURE_CLASS} colab-snackbar,
      html.${CAPTURE_CLASS} .comment-button {
        display: none !important;
      }

      html.${CAPTURE_CLASS} * {
        caret-color: transparent !important;
      }

      html.${CAPTURE_CLASS} .notebook-container {
        scroll-behavior: auto !important;
      }

      #${OVERLAY_ID} {
        position: fixed;
        left: 24px;
        bottom: 24px;
        z-index: 2147483647;
        width: 248px;
        padding: 14px 16px;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(14px);
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${OVERLAY_ID}[hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} [data-role="title"] {
        margin: 0 0 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      #${OVERLAY_ID} [data-role="label"] {
        margin: 0 0 10px;
        font-size: 13px;
        font-weight: 500;
      }

      #${OVERLAY_ID} [data-role="track"] {
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
      }

      #${OVERLAY_ID} [data-role="bar"] {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        transition: width 120ms ease;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);

    if (overlay) {
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <div data-role="title">ColabPrint</div>
      <div data-role="label">Preparing notebook</div>
      <div data-role="track">
        <div data-role="bar"></div>
      </div>
    `;

    applyOverlayTheme(overlay);
    document.body.appendChild(overlay);
    return overlay;
  }

  function applyOverlayTheme(overlay) {
    const rgb = parseCssColor(state.backgroundColor);
    const isDark = rgb ? getPerceivedLuminance(rgb) < 0.45 : false;

    if (isDark) {
      overlay.style.border = '1px solid rgba(255, 255, 255, 0.08)';
      overlay.style.background = 'rgba(18, 21, 28, 0.9)';
      overlay.style.color = '#f8fafc';
      overlay.querySelector('[data-role="title"]').style.color = 'rgba(226, 232, 240, 0.72)';
      overlay.querySelector('[data-role="label"]').style.color = '#f8fafc';
      overlay.querySelector('[data-role="track"]').style.background = 'rgba(255, 255, 255, 0.1)';
      overlay.querySelector('[data-role="bar"]').style.background = '#f8fafc';
      return;
    }

    overlay.style.border = '1px solid rgba(15, 23, 42, 0.08)';
    overlay.style.background = 'rgba(255, 255, 255, 0.94)';
    overlay.style.color = '#0f172a';
    overlay.querySelector('[data-role="title"]').style.color = '#475569';
    overlay.querySelector('[data-role="label"]').style.color = '#0f172a';
    overlay.querySelector('[data-role="track"]').style.background = 'rgba(148, 163, 184, 0.24)';
    overlay.querySelector('[data-role="bar"]').style.background = '#111827';
  }

  async function settleLayout() {
    await nextFrame();
    await nextFrame();

    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => undefined);
    }

    await delay(220);
    await Promise.all([waitForVisibleImages(), waitForVisibleFrames()]);
    await nextFrame();
  }

  async function waitForVisibleImages() {
    const images = Array.from(document.images).filter((image) => {
      if (image.complete) {
        return false;
      }

      return isVisibleInViewport(image.getBoundingClientRect());
    });

    if (!images.length) {
      return;
    }

    await Promise.race([
      Promise.all(images.map(waitForImage)),
      delay(450)
    ]);
  }

  async function waitForVisibleFrames() {
    const frames = Array.from(document.querySelectorAll('iframe')).filter((frame) => {
      const rect = frame.getBoundingClientRect();
      return isVisibleInViewport(rect) && !readyFrames.has(frame);
    });

    if (!frames.length) {
      return;
    }

    await Promise.race([
      Promise.all(frames.map(waitForFrame)),
      delay(450)
    ]);
  }

  function waitForImage(image) {
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }

  function waitForFrame(frame) {
    return new Promise((resolve) => {
      let done = false;

      const handleDone = () => {
        if (done) {
          return;
        }

        done = true;
        readyFrames.add(frame);
        frame.removeEventListener('load', handleDone);
        frame.removeEventListener('error', handleDone);
        resolve();
      };

      frame.addEventListener('load', handleDone, { once: true });
      frame.addEventListener('error', handleDone, { once: true });
      delay(350).then(handleDone);
    });
  }

  function isVisibleInViewport(rect) {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const verticallyVisible = rect.bottom > 0 && rect.top < viewportHeight;
    const horizontallyVisible = rect.right > 0 && rect.left < viewportWidth;
    return verticallyVisible && horizontallyVisible;
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isSolidColor(value) {
    return typeof value === 'string' && !/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/i.test(value) && value !== 'transparent';
  }

  function parseCssColor(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const match = value.match(/rgba?\(([^)]+)\)/i);

    if (!match) {
      return null;
    }

    const [red, green, blue] = match[1]
      .split(',')
      .slice(0, 3)
      .map((channel) => Number.parseFloat(channel.trim()));

    if ([red, green, blue].some((channel) => Number.isNaN(channel))) {
      return null;
    }

    return { r: red, g: green, b: blue };
  }

  function getPerceivedLuminance(rgb) {
    return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  }
})();
