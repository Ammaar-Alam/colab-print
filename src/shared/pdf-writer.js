const encoder = new TextEncoder();

export function buildPdfDocument({ title, producer = 'ColabPrint', pages }) {
  if (!Array.isArray(pages) || !pages.length) {
    throw new Error('Cannot build a PDF without pages.');
  }

  const objects = [];
  const reserveObject = () => {
    objects.push(null);
    return objects.length;
  };

  const catalogObjectId = reserveObject();
  const pagesObjectId = reserveObject();
  const infoObjectId = reserveObject();
  const pageObjectIds = [];

  let imageCounter = 0;

  for (const page of pages) {
    const contentObjectId = reserveObject();
    const pageObjectId = reserveObject();
    const xObjectEntries = [];
    const commands = [];

    commands.push('q');
    commands.push(
      `${toPdfNumber(page.backgroundRgb.r / 255)} ${toPdfNumber(page.backgroundRgb.g / 255)} ${toPdfNumber(page.backgroundRgb.b / 255)} rg`
    );
    commands.push(`0 0 ${toPdfNumber(page.widthPt)} ${toPdfNumber(page.heightPt)} re f`);
    commands.push('Q');

    for (const image of page.images) {
      imageCounter += 1;
      const imageName = `Im${imageCounter}`;
      const imageObjectId = reserveObject();

      xObjectEntries.push(`/${imageName} ${imageObjectId} 0 R`);
      objects[imageObjectId - 1] = createStreamObject(
        `<< /Type /XObject /Subtype /Image /Width ${image.widthPx} /Height ${image.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpegBytes.length} >>`,
        image.jpegBytes
      );

      commands.push('q');
      commands.push(
        `${toPdfNumber(image.widthPt)} 0 0 ${toPdfNumber(image.heightPt)} ${toPdfNumber(image.xPt)} ${toPdfNumber(image.yPt)} cm`
      );
      commands.push(`/${imageName} Do`);
      commands.push('Q');
    }

    const contentBytes = encoder.encode(`${commands.join('\n')}\n`);
    objects[contentObjectId - 1] = createStreamObject(
      `<< /Length ${contentBytes.length} >>`,
      contentBytes
    );

    const resources = xObjectEntries.length
      ? `<< /XObject << ${xObjectEntries.join(' ')} >> >>`
      : '<< >>';

    objects[pageObjectId - 1] = createStringObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${toPdfNumber(page.widthPt)} ${toPdfNumber(page.heightPt)}] /Resources ${resources} /Contents ${contentObjectId} 0 R >>`
    );

    pageObjectIds.push(pageObjectId);
  }

  objects[catalogObjectId - 1] = createStringObject(
    `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`
  );

  objects[pagesObjectId - 1] = createStringObject(
    `<< /Type /Pages /Kids [${pageObjectIds.map((pageId) => `${pageId} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`
  );

  objects[infoObjectId - 1] = createStringObject(
    `<< /Title ${encodePdfText(title || 'Notebook Export')} /Producer ${encodePdfText(producer)} /Creator ${encodePdfText(producer)} >>`
  );

  return assemblePdf({
    objects,
    rootObjectId: catalogObjectId,
    infoObjectId
  });
}

function createStringObject(body) {
  return {
    type: 'string',
    body
  };
}

function createStreamObject(dictionary, streamBytes) {
  return {
    type: 'stream',
    dictionary,
    streamBytes
  };
}

function assemblePdf({ objects, rootObjectId, infoObjectId }) {
  const header = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 255, 255, 255, 255, 10]);
  const chunks = [header];
  const offsets = [0];
  let byteOffset = header.length;

  for (let index = 0; index < objects.length; index += 1) {
    const objectId = index + 1;
    const object = objects[index];

    if (!object) {
      throw new Error(`Missing PDF object ${objectId}.`);
    }

    offsets[objectId] = byteOffset;

    const prefix = encoder.encode(`${objectId} 0 obj\n`);
    chunks.push(prefix);
    byteOffset += prefix.length;

    if (object.type === 'string') {
      const bodyBytes = encoder.encode(`${object.body}\nendobj\n`);
      chunks.push(bodyBytes);
      byteOffset += bodyBytes.length;
      continue;
    }

    const dictionaryBytes = encoder.encode(`${object.dictionary}\nstream\n`);
    chunks.push(dictionaryBytes);
    byteOffset += dictionaryBytes.length;

    chunks.push(object.streamBytes);
    byteOffset += object.streamBytes.length;

    const suffix = encoder.encode(`\nendstream\nendobj\n`);
    chunks.push(suffix);
    byteOffset += suffix.length;
  }

  const xrefOffset = byteOffset;
  const xrefHeader = encoder.encode(`xref\n0 ${objects.length + 1}\n`);
  chunks.push(xrefHeader);
  byteOffset += xrefHeader.length;

  const freeEntry = encoder.encode('0000000000 65535 f \n');
  chunks.push(freeEntry);
  byteOffset += freeEntry.length;

  for (let objectId = 1; objectId <= objects.length; objectId += 1) {
    const entry = encoder.encode(`${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`);
    chunks.push(entry);
    byteOffset += entry.length;
  }

  const trailer = encoder.encode(
    `trailer\n<< /Size ${objects.length + 1} /Root ${rootObjectId} 0 R /Info ${infoObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );
  chunks.push(trailer);

  return new Blob(chunks, { type: 'application/pdf' });
}

function encodePdfText(text) {
  const bytes = [];

  for (const codePoint of text) {
    const value = codePoint.codePointAt(0);

    if (typeof value !== 'number') {
      continue;
    }

    if (value > 0xffff) {
      const adjusted = value - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      bytes.push(high >> 8, high & 0xff, low >> 8, low & 0xff);
      continue;
    }

    bytes.push(value >> 8, value & 0xff);
  }

  const hex = ['FEFF', ...bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())].join('');
  return `<${hex}>`;
}

function toPdfNumber(value) {
  return Number.parseFloat(value.toFixed(3)).toString();
}
