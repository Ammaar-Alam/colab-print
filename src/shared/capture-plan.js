export function createCapturePositions({ scrollHeight, viewportHeight, overlap }) {
  const normalizedScrollHeight = Math.max(0, Math.floor(scrollHeight || 0));
  const normalizedViewportHeight = Math.max(1, Math.floor(viewportHeight || 1));
  const normalizedOverlap = Math.max(0, Math.min(Math.floor(overlap || 0), normalizedViewportHeight - 1));
  const maxScrollTop = Math.max(0, normalizedScrollHeight - normalizedViewportHeight);

  if (maxScrollTop === 0) {
    return [0];
  }

  const step = Math.max(1, normalizedViewportHeight - normalizedOverlap);
  const positions = [];

  for (let offset = 0; offset < maxScrollTop; offset += step) {
    positions.push(offset);
  }

  if (positions[positions.length - 1] !== maxScrollTop) {
    positions.push(maxScrollTop);
  }

  return [...new Set(positions)];
}

export function buildSliceCropRect({ captureRect, overlap, index }) {
  const rect = {
    left: Math.max(0, captureRect.left),
    top: Math.max(0, captureRect.top),
    width: Math.max(1, captureRect.width),
    height: Math.max(1, captureRect.height)
  };

  if (index > 0) {
    rect.top += overlap;
    rect.height = Math.max(1, rect.height - overlap);
  }

  return rect;
}
