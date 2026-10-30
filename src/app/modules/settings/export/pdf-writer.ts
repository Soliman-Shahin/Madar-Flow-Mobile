/**
 * Minimal PDF writer for pre-rendered pages.
 *
 * Each page is a full-bleed JPEG. Rendering the page to a canvas first lets the
 * browser do Arabic shaping and right-to-left layout with the app's own fonts,
 * which a hand-rolled PDF text writer cannot do. The trade-off is that the text
 * in the PDF is an image (not selectable).
 */
export interface PdfPage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

const encoder = new TextEncoder();

/** A4 in PDF points. */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

export function buildPdf(pages: PdfPage[]): Uint8Array {
  if (!pages.length) throw new Error('PDF_NO_PAGES');

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (id: number): void => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // Object layout: 1 catalog, 2 pages, then per page: page, content, image.
  const pageObj = (i: number) => 3 + i * 3;
  const contentObj = (i: number) => 4 + i * 3;
  const imageObj = (i: number) => 5 + i * 3;
  const totalObjects = 2 + pages.length * 3;

  push('%PDF-1.4\n%âãÏÓ\n');

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObject(2);
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    beginObject(pageObj(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
        `/Resources << /XObject << /Im${i} ${imageObj(i)} 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>\nendobj\n`
    );

    const draw = `q ${A4_WIDTH_PT} 0 0 ${A4_HEIGHT_PT} 0 0 cm /Im${i} Do Q`;
    beginObject(contentObj(i));
    push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);

    beginObject(imageObj(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpeg.length} >>\nstream\n`
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${totalObjects + 1}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id <= totalObjects; id++) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
