import { createCapturePositions, buildSliceCropRect } from '../shared/capture-plan.js';
import { buildExportFilename, deriveNotebookTitle } from '../shared/filename.js';
import { putJob, putSlice, deleteJob } from '../shared/job-store.js';
import { getDefaultPaperId } from '../shared/paper.js';
import { isSupportedNotebookUrl } from '../shared/provider.js';

const CONTENT_SCRIPT_FILES = ['src/content/main.js'];
const CAPTURE_INTERVAL_MS = 600;
const activeExports = new Map();
let lastCaptureTimestamp = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'COLAB_PRINT_START_EXPORT') {
    startExport({
      tabId: message.tabId,
      options: message.options || {}
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === 'COLAB_PRINT_CANCEL_EXPORT') {
    const targetTabId = message.tabId ?? sender.tab?.id;
    const state = targetTabId != null ? activeExports.get(targetTabId) : null;
    if (state) {
      state.cancelled = true;
    }
    sendResponse({ ok: Boolean(state) });
    return false;
  }

  return false;
});

async function startExport({ tabId, options }) {
  if (!tabId) {
    throw new Error('No active tab available.');
  }

  if (activeExports.has(tabId)) {
    throw new Error('An export is already running for this tab.');
  }

  const tab = await chrome.tabs.get(tabId);

  if (!isSupportedNotebookUrl(tab.url)) {
    throw new Error('Open a Google Colab notebook first.');
  }

  const paper = options.paper || getDefaultPaperId();
  const exportState = { cancelled: false };
  activeExports.set(tabId, exportState);

  try {
    await ensureContentScript(tabId);

    const detection = await sendToTab(tabId, {
      type: 'COLAB_PRINT_DETECT_NOTEBOOK'
    });

    if (!detection?.supported) {
      throw new Error('This page is not a supported notebook.');
    }

    const preparation = await sendToTab(tabId, {
      type: 'COLAB_PRINT_PREPARE_CAPTURE'
    });

    const notebookTitle = preparation.title || deriveNotebookTitle(tab.title);
    const positions = createCapturePositions({
      scrollHeight: preparation.scrollHeight,
      viewportHeight: preparation.captureRect.height,
      overlap: preparation.overlap
    });

    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await putJob({
      id: jobId,
      provider: preparation.provider,
      title: notebookTitle,
      filename: buildExportFilename(notebookTitle),
      sourceUrl: tab.url || '',
      createdAt,
      sliceCount: positions.length,
      appearance: {
        backgroundColor: preparation.backgroundColor || 'rgb(255, 255, 255)'
      }
    });

    let completed = false;

    try {
      for (let index = 0; index < positions.length; index += 1) {
        if (exportState.cancelled) {
          throw new Error('Export cancelled.');
        }

        await assertTabIsStillActive(tab.windowId, tabId);

        await sendToTab(tabId, {
          type: 'COLAB_PRINT_SHOW_PROGRESS',
          phase: 'capture',
          current: index + 1,
          total: positions.length,
          label: `Capturing ${index + 1} of ${positions.length}`
        });

        const stepState = await sendToTab(tabId, {
          type: 'COLAB_PRINT_SCROLL_TO',
          position: positions[index]
        });

        if (
          stepState.viewport.width !== preparation.viewport.width ||
          stepState.viewport.height !== preparation.viewport.height
        ) {
          throw new Error('Window size changed during export. Please try again.');
        }

        await respectCaptureRateLimit();

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const cropRect = buildSliceCropRect({
          captureRect: stepState.captureRect,
          overlap: preparation.overlap,
          index
        });

        const blob = await cropScreenshotToBlob({
          dataUrl,
          cropRect,
          viewport: stepState.viewport
        });

        await putSlice(jobId, {
          index,
          blob,
          width: cropRect.width,
          height: cropRect.height
        });
      }

      await sendToTab(tabId, {
        type: 'COLAB_PRINT_SHOW_PROGRESS',
        phase: 'finalize',
        current: positions.length,
        total: positions.length,
        label: 'Opening direct PDF export'
      });

      completed = true;
    } finally {
      const finalState = completed
        ? 'success'
        : exportState.cancelled
          ? 'cancelled'
          : 'error';

      await sendToTab(tabId, {
        type: 'COLAB_PRINT_RESTORE_CAPTURE',
        finalState
      }).catch(() => undefined);

      if (!completed) {
        await deleteJob(jobId).catch(() => undefined);
      }
    }

    const exportUrl = chrome.runtime.getURL(
      `src/export/export.html?job=${encodeURIComponent(jobId)}&paper=${encodeURIComponent(paper)}&autodownload=1`
    );

    await chrome.tabs.create({
      url: exportUrl
    });

    return { jobId, title: notebookTitle };
  } finally {
    activeExports.delete(tabId);
  }
}

async function ensureContentScript(tabId) {
  try {
    const ping = await sendToTab(tabId, { type: 'COLAB_PRINT_PING' });

    if (ping?.ok) {
      return;
    }
  } catch {
    // The content script is not injected yet.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });

  const ping = await sendToTab(tabId, { type: 'COLAB_PRINT_PING' });

  if (!ping?.ok) {
    throw new Error('Unable to initialize the page helper.');
  }
}

async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function assertTabIsStillActive(windowId, tabId) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId
  });

  if (!activeTab || activeTab.id !== tabId) {
    throw new Error('Keep the notebook tab active while the export is running.');
  }
}

async function respectCaptureRateLimit() {
  const elapsed = Date.now() - lastCaptureTimestamp;

  if (elapsed < CAPTURE_INTERVAL_MS) {
    await delay(CAPTURE_INTERVAL_MS - elapsed);
  }

  lastCaptureTimestamp = Date.now();
}

async function cropScreenshotToBlob({ dataUrl, cropRect, viewport }) {
  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;

  const sourceX = clamp(Math.round(cropRect.left * scaleX), 0, bitmap.width - 1);
  const sourceY = clamp(Math.round(cropRect.top * scaleY), 0, bitmap.height - 1);
  const sourceWidth = clamp(Math.round(cropRect.width * scaleX), 1, bitmap.width - sourceX);
  const sourceHeight = clamp(Math.round(cropRect.height * scaleY), 1, bitmap.height - sourceY);

  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to create an export canvas.');
  }

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  bitmap.close?.();
  return canvas.convertToBlob({ type: 'image/png' });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
