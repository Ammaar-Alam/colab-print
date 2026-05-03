const INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*\x00-\x1F]/g;
const COLLAPSE_WHITESPACE = /\s+/g;
const COLLAPSE_DASHES = /-+/g;

export function deriveNotebookTitle(tabTitle, fallback = 'Notebook') {
  if (!tabTitle || typeof tabTitle !== 'string') {
    return fallback;
  }

  const title = tabTitle
    .replace(/\s*-\s*Colab\s*$/i, '')
    .replace(/\s*-\s*Google Colaboratory\s*$/i, '')
    .trim();

  return title || fallback;
}

export function slugifyFilename(title, fallback = 'notebook-export') {
  const value = (title || fallback)
    .toLowerCase()
    .replace(INVALID_FILENAME_CHARACTERS, ' ')
    .replace(/['’]/g, '')
    .replace(COLLAPSE_WHITESPACE, '-')
    .replace(COLLAPSE_DASHES, '-')
    .replace(/^-|-$/g, '');

  return value || fallback;
}

export function buildExportFilename(title) {
  return `${slugifyFilename(title)}.pdf`;
}
