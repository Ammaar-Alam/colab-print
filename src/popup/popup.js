import { deriveNotebookTitle } from '../shared/filename.js';
import { getDefaultPaperId, getPaperOptions } from '../shared/paper.js';
import { isSupportedNotebookUrl } from '../shared/provider.js';

const titleElement = document.getElementById('title');
const statusElement = document.getElementById('status');
const exportButton = document.getElementById('export-button');
const paperOptionsElement = document.getElementById('paper-options');

let activeTabId = null;
let selectedPaperId = getDefaultPaperId();
let mode = 'idle';

initialize().catch((error) => {
  statusElement.textContent = error.message;
});

async function initialize() {
  renderPaperOptions();

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!activeTab) {
    statusElement.textContent = 'No active tab.';
    return;
  }

  activeTabId = activeTab.id;
  const supported = isSupportedNotebookUrl(activeTab.url);

  if (supported) {
    titleElement.textContent = deriveNotebookTitle(activeTab.title);
    statusElement.textContent = 'Ready on Google Colab';
    setMode('idle', { supported: true });
  } else {
    titleElement.textContent = 'Open a Colab notebook';
    statusElement.textContent = 'This tab isn\u2019t a supported notebook yet.';
    setMode('idle', { supported: false });
  }

  exportButton.addEventListener('click', handleButtonClick);
}

function renderPaperOptions() {
  for (const paper of getPaperOptions()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segmented__option';
    button.textContent = paper.label;
    button.dataset.paperId = paper.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(paper.id === selectedPaperId));
    button.addEventListener('click', () => {
      selectedPaperId = paper.id;
      syncPaperSelection();
    });
    paperOptionsElement.appendChild(button);
  }
}

function syncPaperSelection() {
  for (const button of paperOptionsElement.querySelectorAll('.segmented__option')) {
    button.setAttribute('aria-checked', String(button.dataset.paperId === selectedPaperId));
  }
}

async function handleButtonClick() {
  if (mode === 'idle') {
    await startExport();
    return;
  }

  if (mode === 'capturing') {
    await requestCancel();
  }
}

async function startExport() {
  if (!activeTabId) {
    return;
  }

  setMode('capturing');
  statusElement.textContent = 'Capturing · keep the tab active';

  const response = await chrome.runtime.sendMessage({
    type: 'COLAB_PRINT_START_EXPORT',
    tabId: activeTabId,
    options: { paper: selectedPaperId }
  });

  if (response?.ok) {
    window.close();
    return;
  }

  const error = response?.error || 'Export failed.';
  statusElement.textContent = /cancel/i.test(error) ? 'Cancelled' : error;
  setMode('idle', { supported: true });
}

async function requestCancel() {
  setMode('cancelling');
  statusElement.textContent = 'Stopping after the current step…';

  try {
    await chrome.runtime.sendMessage({
      type: 'COLAB_PRINT_CANCEL_EXPORT',
      tabId: activeTabId
    });
  } catch {
    // The service worker will still observe the flag on its next iteration.
  }
}

function setMode(next, context = {}) {
  mode = next;
  exportButton.dataset.mode = next;

  if (next === 'idle') {
    exportButton.textContent = 'Build PDF';
    exportButton.disabled = context.supported === false;
    return;
  }

  if (next === 'capturing') {
    exportButton.textContent = 'Cancel';
    exportButton.disabled = false;
    return;
  }

  if (next === 'cancelling') {
    exportButton.textContent = 'Stopping…';
    exportButton.disabled = true;
  }
}
