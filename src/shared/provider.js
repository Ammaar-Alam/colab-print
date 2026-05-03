const COLAB_HOST = 'colab.research.google.com';

export function isSupportedNotebookUrl(rawUrl) {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return url.hostname === COLAB_HOST;
  } catch {
    return false;
  }
}

export function getProviderName(rawUrl) {
  return isSupportedNotebookUrl(rawUrl) ? 'colab' : null;
}

export function getProviderLabel(rawUrl) {
  return isSupportedNotebookUrl(rawUrl) ? 'Google Colab' : 'Unsupported page';
}
