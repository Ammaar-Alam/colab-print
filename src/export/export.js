import { deleteJob, getJob, getSlices } from '../shared/job-store.js';
import { getPdfLayout, getPaperSpec } from '../shared/paper.js';
import { buildPdfDocument } from '../shared/pdf-writer.js';

const titleElement = document.getElementById('title');
const statusElement = document.getElementById('status');
const progressElement = document.getElementById('progress');
const progressBarElement = document.getElementById('progress-bar');
const paperLabelElement = document.getElementById('paper-label');
const pageCountElement = document.getElementById('page-count');
const fileSizeElement = document.getElementById('file-size');
const downloadButton = document.getElementById('download-button');
const previewButton = document.getElementById('preview-button');
const sourceButton = document.getElementById('source-button');
const previewPanel = document.getElementById('preview-panel');
const previewMetaElement = document.getElementById('preview-meta');
const previewFrame = document.getElementById('preview-frame');
const hidePreviewButton = document.getElementById('hide-preview-button');

const searchParams = new URLSearchParams(window.location.search);
const jobId = searchParams.get('job');
const paperId = searchParams.get('paper') || 'a4';
const autoDownload = searchParams.get('autodownload') === '1';

let pdfBlob = null;
let pdfObjectUrl = null;
let cleanedUp = false;
let currentFilename = 'notebook-export.pdf';
let currentJob = null;

initialize().catch(handleError);

async function initialize() {
  if (!jobId) {
    throw new Error('Missing export job identifier.');
  }

  const paper = getPaperSpec(paperId);
  const layout = getPdfLayout(paperId);
  paperLabelElement.textContent = paper.label;
  updateProgress(0.04);

  const [job, slices] = await Promise.all([getJob(jobId), getSlices(jobId)]);

  if (!job) {
    throw new Error('This export job is no longer available.');
  }

  if (!slices.length) {
    throw new Error('No captured content was found for this export.');
  }

  currentJob = job;
  currentFilename = job.filename || currentFilename;
  document.title = `${job.title} · ColabPrint`;
  titleElement.textContent = job.title;

  if (job.sourceUrl) {
    sourceButton.hidden = false;
    sourceButton.addEventListener('click', () => window.open(job.sourceUrl, '_blank', 'noopener'));
  }

  updateStatus('Preparing pages for a direct PDF export.', 0.12);

  const appearance = await resolveAppearance(job, slices[0]?.blob);
  applyAppearance(appearance);

  const pages = await buildPages({
    slices,
    layout,
    backgroundRgb: appearance.backgroundRgb,
    onProgress: ({ value, label }) => updateStatus(label, value)
  });

  pageCountElement.textContent = String(pages.length);
  updateStatus('Assembling PDF.', 0.94);

  pdfBlob = buildPdfDocument({
    title: job.title,
    pages
  });

  pdfObjectUrl = URL.createObjectURL(pdfBlob);
  fileSizeElement.textContent = formatBytes(pdfBlob.size);
  previewMetaElement.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · ${formatBytes(pdfBlob.size)}`;

  downloadButton.disabled = false;
  previewButton.disabled = false;
  downloadButton.addEventListener('click', () => triggerDownload());
  previewButton.addEventListener('click', showPreview);
  hidePreviewButton.addEventListener('click', hidePreview);

  await deleteJob(jobId).catch(() => undefined);
  cleanedUp = true;

  updateStatus(
    `Ready · ${pages.length} page${pages.length === 1 ? '' : 's'} · ${formatBytes(pdfBlob.size)}`,
    1
  );
  titleElement.textContent = `${job.title} · ready`;
  progressElement?.setAttribute('data-state', 'done');

  if (autoDownload) {
    window.setTimeout(() => triggerDownload(), 120);
  }

  window.addEventListener('beforeunload', revokeObjectUrl);
}

async function buildPages({ slices, layout, backgroundRgb, onProgress }) {
  const pages = [];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });

  if (!context) {
    throw new Error('Unable to create an export canvas.');
  }

  let page = createEmptyPage(layout, backgroundRgb);
  let usedHeightPt = 0;

  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
    const slice = slices[sliceIndex];
    const bitmap = await createImageBitmap(slice.blob);
    const scale = layout.contentWidthPt / bitmap.width;
    const fullPageHeightPx = Math.max(1, Math.floor(layout.contentHeightPt / scale));
    let sourceY = 0;

    try {
      while (sourceY < bitmap.height) {
        let remainingHeightPt = layout.contentHeightPt - usedHeightPt;

        if (remainingHeightPt < MIN_FRAGMENT_HEIGHT_PT) {
          finalizePage();
          continue;
        }

        const remainingHeightPx = bitmap.height - sourceY;
        const pageRemainingPx = Math.max(1, Math.floor(remainingHeightPt / scale));
        const tinyTailPx = remainingHeightPx - pageRemainingPx;

        if (
          usedHeightPt > 0 &&
          remainingHeightPx <= fullPageHeightPx &&
          remainingHeightPx > pageRemainingPx &&
          tinyTailPx > 0 &&
          tinyTailPx < TINY_TAIL_THRESHOLD_PX
        ) {
          finalizePage();
          continue;
        }

        const fragmentHeightPx = Math.min(remainingHeightPx, pageRemainingPx);

        if (fragmentHeightPx < 1) {
          finalizePage();
          continue;
        }

        const fragmentHeightPt = fragmentHeightPx * scale;
        const jpegBytes = await renderFragmentToJpegBytes({
          bitmap,
          sourceY,
          sourceHeightPx: fragmentHeightPx,
          canvas,
          context,
          backgroundRgb
        });

        page.images.push({
          jpegBytes,
          widthPx: bitmap.width,
          heightPx: fragmentHeightPx,
          widthPt: layout.contentWidthPt,
          heightPt: fragmentHeightPt,
          xPt: layout.marginPt,
          yPt: layout.heightPt - layout.marginPt - usedHeightPt - fragmentHeightPt
        });

        usedHeightPt += fragmentHeightPt;
        sourceY += fragmentHeightPx;

        const progressBase = 0.14;
        const progressRange = 0.76;
        const sliceProgress = (sliceIndex + sourceY / bitmap.height) / slices.length;

        onProgress({
          value: progressBase + sliceProgress * progressRange,
          label: `Rendering PDF pages (${sliceIndex + 1} of ${slices.length})`
        });

        if (usedHeightPt >= layout.contentHeightPt - 0.5) {
          finalizePage();
        }
      }
    } finally {
      bitmap.close?.();
    }
  }

  if (page.images.length) {
    pages.push(page);
  }

  return pages;

  function finalizePage() {
    if (page.images.length) {
      pages.push(page);
    }

    page = createEmptyPage(layout, backgroundRgb);
    usedHeightPt = 0;
  }
}

async function renderFragmentToJpegBytes({
  bitmap,
  sourceY,
  sourceHeightPx,
  canvas,
  context,
  backgroundRgb
}) {
  canvas.width = bitmap.width;
  canvas.height = sourceHeightPx;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = rgbToCss(backgroundRgb);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    bitmap,
    0,
    sourceY,
    bitmap.width,
    sourceHeightPx,
    0,
    0,
    bitmap.width,
    sourceHeightPx
  );

  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  return new Uint8Array(await blob.arrayBuffer());
}

function createEmptyPage(layout, backgroundRgb) {
  return {
    widthPt: layout.widthPt,
    heightPt: layout.heightPt,
    backgroundRgb,
    images: []
  };
}

async function resolveAppearance(job, fallbackBlob) {
  const storedBackground = parseCssColor(job?.appearance?.backgroundColor);

  if (storedBackground) {
    return finalizeAppearance(storedBackground);
  }

  if (fallbackBlob) {
    const sampled = await sampleBlobBackground(fallbackBlob);

    if (sampled) {
      return finalizeAppearance(sampled);
    }
  }

  return finalizeAppearance({ r: 255, g: 255, b: 255 });
}

function finalizeAppearance(backgroundRgb) {
  const isDark = getPerceivedLuminance(backgroundRgb) < 0.45;
  return {
    backgroundRgb,
    isDark
  };
}

function applyAppearance(appearance) {
  const rootStyle = document.documentElement.style;

  if (appearance.isDark) {
    const background = mixRgb(appearance.backgroundRgb, { r: 7, g: 10, b: 15 }, 0.28);
    const panel = mixRgb(appearance.backgroundRgb, { r: 20, g: 24, b: 34 }, 0.46);
    const panelMuted = mixRgb(appearance.backgroundRgb, { r: 12, g: 16, b: 24 }, 0.4);

    rootStyle.setProperty('color-scheme', 'dark');
    rootStyle.setProperty('--ui-background', rgbToCss(background));
    rootStyle.setProperty('--ui-background-grad',
      'radial-gradient(120% 80% at 100% 0%, rgba(99, 102, 241, 0.12), transparent 60%),' +
      'radial-gradient(80% 60% at 0% 100%, rgba(14, 165, 233, 0.08), transparent 60%)');
    rootStyle.setProperty('--ui-panel', rgbaToCss(panel, 0.9));
    rootStyle.setProperty('--ui-panel-muted', rgbaToCss(panelMuted, 0.7));
    rootStyle.setProperty('--ui-panel-border', 'rgba(255, 255, 255, 0.08)');
    rootStyle.setProperty('--ui-foreground', '#f8fafc');
    rootStyle.setProperty('--ui-muted', 'rgba(226, 232, 240, 0.72)');
    rootStyle.setProperty('--ui-subtle', 'rgba(255, 255, 255, 0.06)');
    rootStyle.setProperty('--ui-button', '#f8fafc');
    rootStyle.setProperty('--ui-button-text', '#0b1220');
    rootStyle.setProperty('--ui-track', 'rgba(255, 255, 255, 0.08)');
    rootStyle.setProperty('--ui-accent-grad', 'linear-gradient(180deg, #f8fafc, #e2e8f0)');
    rootStyle.setProperty('--ui-focus', 'rgba(226, 232, 240, 0.45)');
    rootStyle.setProperty('--ui-shadow', '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 28px 80px rgba(0, 0, 0, 0.35)');
    return;
  }

  const background = mixRgb(appearance.backgroundRgb, { r: 244, g: 246, b: 251 }, 0.72);
  const panel = mixRgb(appearance.backgroundRgb, { r: 255, g: 255, b: 255 }, 0.92);
  const panelMuted = mixRgb(appearance.backgroundRgb, { r: 243, g: 245, b: 250 }, 0.88);

  rootStyle.setProperty('color-scheme', 'light');
  rootStyle.setProperty('--ui-background', rgbToCss(background));
  rootStyle.setProperty('--ui-panel', rgbaToCss(panel, 1));
  rootStyle.setProperty('--ui-panel-muted', rgbaToCss(panelMuted, 1));
  rootStyle.setProperty('--ui-panel-border', 'rgba(15, 23, 42, 0.08)');
  rootStyle.setProperty('--ui-foreground', '#0b1220');
  rootStyle.setProperty('--ui-muted', '#475569');
  rootStyle.setProperty('--ui-subtle', 'rgba(15, 23, 42, 0.06)');
  rootStyle.setProperty('--ui-button', '#0b1220');
  rootStyle.setProperty('--ui-button-text', '#f8fafc');
  rootStyle.setProperty('--ui-track', 'rgba(15, 23, 42, 0.08)');
  rootStyle.setProperty('--ui-accent-grad', 'linear-gradient(90deg, #1f2937, #0b1220)');
}

function updateStatus(message, progressValue) {
  statusElement.textContent = message;
  updateProgress(progressValue);
}

function updateProgress(progressValue) {
  const normalizedValue = Math.min(1, Math.max(0, progressValue));
  progressBarElement.style.width = `${Math.round(normalizedValue * 100)}%`;
}

function triggerDownload() {
  if (!pdfObjectUrl) {
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = pdfObjectUrl;
  anchor.download = currentFilename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function showPreview() {
  if (!pdfObjectUrl) {
    return;
  }

  previewFrame.src = pdfObjectUrl;
  previewPanel.hidden = false;
  previewButton.textContent = 'Preview shown';
}

function hidePreview() {
  previewPanel.hidden = true;
  previewButton.textContent = 'Show preview';
}

function handleError(error) {
  titleElement.textContent = currentJob?.title || 'Export unavailable';
  statusElement.textContent = error instanceof Error ? error.message : 'Unable to build this export.';
  updateProgress(0);
}

async function sampleBlobBackground(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    bitmap.close?.();
    return null;
  }

  const sampleWidth = 32;
  const sampleHeight = 32;
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
  bitmap.close?.();

  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const points = [
    [2, 2],
    [sampleWidth - 3, 2],
    [2, sampleHeight - 3],
    [sampleWidth - 3, sampleHeight - 3],
    [2, Math.floor(sampleHeight / 2)],
    [sampleWidth - 3, Math.floor(sampleHeight / 2)]
  ];

  const reds = [];
  const greens = [];
  const blues = [];

  for (const [x, y] of points) {
    const index = (y * sampleWidth + x) * 4;
    reds.push(data[index]);
    greens.push(data[index + 1]);
    blues.push(data[index + 2]);
  }

  return {
    r: medianChannel(reds),
    g: medianChannel(greens),
    b: medianChannel(blues)
  };
}

function medianChannel(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
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

  return {
    r: clampChannel(red),
    g: clampChannel(green),
    b: clampChannel(blue)
  };
}

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
}

function rgbaToCss(rgb, alpha) {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`;
}

function mixRgb(left, right, ratio) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return {
    r: Math.round(left.r * (1 - clampedRatio) + right.r * clampedRatio),
    g: Math.round(left.g * (1 - clampedRatio) + right.g * clampedRatio),
    b: Math.round(left.b * (1 - clampedRatio) + right.b * clampedRatio)
  };
}

function getPerceivedLuminance(rgb) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function formatBytes(byteCount) {
  if (!Number.isFinite(byteCount) || byteCount <= 0) {
    return '—';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(byteCount) / Math.log(1024)), units.length - 1);
  const value = byteCount / 1024 ** exponent;
  const fractionDigits = exponent === 0 ? 0 : exponent === 1 ? 1 : 2;
  return `${value.toFixed(fractionDigits)} ${units[exponent]}`;
}

function revokeObjectUrl() {
  if (pdfObjectUrl) {
    URL.revokeObjectURL(pdfObjectUrl);
    pdfObjectUrl = null;
  }

  if (!cleanedUp && jobId) {
    deleteJob(jobId).catch(() => undefined);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Unable to create an export image.'));
    }, type, quality);
  });
}

const MIN_FRAGMENT_HEIGHT_PT = 18;
const TINY_TAIL_THRESHOLD_PX = 48;
