import { buildPdf } from './pdf-writer';

const text = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('pdf writer', () => {
  const page = (n: number) => ({
    jpeg: new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]),
    width: 100,
    height: 141,
  });

  it('produces a structurally valid PDF with one page per image', () => {
    const pdf = buildPdf([page(1), page(2)]);
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4')).toBeTrue();
    expect(s.trimEnd().endsWith('%%EOF')).toBeTrue();
    expect(s).toContain('/Count 2');
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(2);
    expect((s.match(/\/Filter \/DCTDecode/g) ?? []).length).toBe(2);
    // 2 fixed objects + 3 per page, plus the free entry.
    expect(s).toContain('xref\n0 9\n');
  });

  it('writes xref offsets that point at the matching objects', () => {
    const pdf = buildPdf([page(1)]);
    const s = text(pdf);
    const xref = s.slice(s.indexOf('xref\n'));
    const entries = [...xref.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBe(5);
    entries.forEach((offset, i) => {
      expect(s.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('embeds the JPEG bytes untouched', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0x11, 0x22, 0x33, 0xff, 0xd9]);
    const pdf = buildPdf([{ jpeg, width: 10, height: 10 }]);
    const s = text(pdf);
    expect(s).toContain(text(jpeg));
    expect(s).toContain(`/Length ${jpeg.length}`);
  });

  it('rejects an empty document', () => {
    expect(() => buildPdf([])).toThrowError('PDF_NO_PAGES');
  });
});
