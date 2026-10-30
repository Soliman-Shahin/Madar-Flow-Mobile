import { ExportRow, ExportSummary } from './export-data.util';
import { PdfPage } from './pdf-writer';

export interface ReportLabels {
  brand: string;
  title: string;
  period: string;
  generated: string;
  income: string;
  expenses: string;
  net: string;
  byCategory: string;
  byMonth: string;
  month: string;
  transactions: string;
  date: string;
  category: string;
  description: string;
  amount: string;
  noData: string;
  /** "Showing the latest {{shown}} of {{total}} transactions. Export CSV for all." */
  truncated: string;
  /** "Page 2 of 3" */
  page: (n: number, total: number) => string;
}

export interface ReportInput {
  summary: ExportSummary;
  rows: ExportRow[];
  labels: ReportLabels;
  /** Right-to-left layout (Arabic). */
  rtl: boolean;
  currency: string;
  periodLabel: string;
  generatedOn: string;
}

/** Logical page size (A4 at 72 dpi); rendered at 2x for sharpness. */
const W = 595;
const H = 842;
const SCALE = 2;
const MARGIN = 40;
/** Hard cap so a huge history cannot create an enormous document. */
export const MAX_PDF_TRANSACTIONS = 400;
const ROWS_PER_PAGE = 36;

const INK = '#101828';
const MUTED = '#667085';
const LINE = '#e4e7ec';
const INCOME = '#1d8a5b';
const EXPENSE = '#c0262e';
const PRIMARY = '#3b5bdb';
const SOFT = '#f2f4f7';
const FONT = '"IBM Plex Sans Arabic", "IBM Plex Sans", system-ui, sans-serif';

const num = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (v: number, currency: string): string =>
  `${v < 0 ? '−' : ''}${num.format(Math.abs(v))} ${currency}`;

type Align = 'start' | 'end';

class Painter {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly rtl: boolean
  ) {}

  /** Mirror an x coordinate (distance from the start edge) for RTL. */
  x(fromStart: number): number {
    return this.rtl ? W - fromStart : fromStart;
  }

  text(
    value: string,
    fromStart: number,
    y: number,
    opts: {
      size?: number;
      weight?: number;
      color?: string;
      align?: Align;
      maxWidth?: number;
      /** Force left-to-right (numbers, dates, currency). */
      ltr?: boolean;
    } = {}
  ): void {
    const { ctx } = this;
    const align = opts.align ?? 'start';
    ctx.font = `${opts.weight ?? 400} ${opts.size ?? 11}px ${FONT}`;
    ctx.fillStyle = opts.color ?? INK;
    ctx.textBaseline = 'alphabetic';
    // Base direction follows the text: Latin-only cells (codes, English notes)
    // stay left-to-right even inside an Arabic report so punctuation does not flip.
    const hasRtlScript = /[\u0590-\u08FF]/.test(value);
    const hasLatin = /[A-Za-z]/.test(value);
    ctx.direction = opts.ltr
      ? 'ltr'
      : this.rtl
      ? hasLatin && !hasRtlScript
        ? 'ltr'
        : 'rtl'
      : 'ltr';
    // Canvas 'left'/'right' are physical; derive from logical start/end.
    const startIsRight = this.rtl;
    const physicalRight = (align === 'start') === startIsRight;
    ctx.textAlign = physicalRight ? 'right' : 'left';
    const x = this.x(fromStart);
    ctx.fillText(this.fit(value, opts), x, y);
  }

  private fit(value: string, opts: { maxWidth?: number; size?: number; weight?: number }): string {
    const max = opts.maxWidth;
    if (!max) return value;
    const { ctx } = this;
    ctx.font = `${opts.weight ?? 400} ${opts.size ?? 11}px ${FONT}`;
    if (ctx.measureText(value).width <= max) return value;
    let s = value;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  rect(fromStart: number, y: number, w: number, h: number, color: string, r = 0): void {
    const { ctx } = this;
    const left = this.rtl ? W - fromStart - w : fromStart;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (r > 0 && (ctx as any).roundRect) (ctx as any).roundRect(left, y, w, h, r);
    else ctx.rect(left, y, w, h);
    ctx.fill();
  }

  hline(y: number, color = LINE): void {
    this.rect(MARGIN, y, W - MARGIN * 2, 0.7, color);
  }
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

async function toJpegPage(canvas: HTMLCanvasElement): Promise<PdfPage> {
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92)
  );
  if (!blob) throw new Error('CANVAS_EXPORT_FAILED');
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

async function ensureFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 12px "IBM Plex Sans Arabic"`),
      document.fonts.load(`600 12px "IBM Plex Sans Arabic"`),
      document.fonts.load(`400 12px "IBM Plex Sans"`),
      document.fonts.load(`600 12px "IBM Plex Sans"`),
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

function header(p: Painter, input: ReportInput, y: number): number {
  const { labels } = input;
  p.rect(0, 0, W, 6, PRIMARY);
  p.text(labels.brand, MARGIN, y + 6, { size: 11, weight: 600, color: PRIMARY });
  p.text(labels.title, MARGIN, y + 34, { size: 22, weight: 600 });
  p.text(`${labels.period}: ${input.periodLabel}`, MARGIN, y + 54, { size: 11, color: MUTED });
  p.text(`${labels.generated}: ${input.generatedOn}`, MARGIN, y + 70, { size: 10, color: MUTED });
  p.hline(y + 84);
  return y + 106;
}

function summaryCards(p: Painter, input: ReportInput, y: number): number {
  const { summary, labels, currency } = input;
  const gap = 12;
  const cardW = (W - MARGIN * 2 - gap * 2) / 3;
  const cards = [
    { label: labels.income, value: summary.income, color: INCOME },
    { label: labels.expenses, value: summary.expense, color: EXPENSE },
    { label: labels.net, value: summary.net, color: summary.net >= 0 ? INCOME : EXPENSE },
  ];
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    p.rect(x, y, cardW, 62, SOFT, 8);
    p.text(c.label, x + 12, y + 20, { size: 10, color: MUTED, maxWidth: cardW - 24 });
    p.text(money(c.value, currency), x + 12, y + 44, {
      size: 14,
      weight: 600,
      color: c.color,
      ltr: true,
      maxWidth: cardW - 24,
    });
  });
  return y + 62 + 28;
}

function categoryBars(p: Painter, input: ReportInput, y: number): number {
  const { summary, labels, currency } = input;
  p.text(labels.byCategory, MARGIN, y, { size: 13, weight: 600 });
  y += 14;
  const top = summary.expenseByCategory.slice(0, 8);
  if (!top.length) {
    p.text(labels.noData, MARGIN, y + 14, { size: 10, color: MUTED });
    return y + 36;
  }
  const trackW = 200;
  const nameW = 130;
  top.forEach((c) => {
    p.text(c.category, MARGIN, y + 12, { size: 10.5, maxWidth: nameW - 8 });
    p.rect(MARGIN + nameW, y + 3, trackW, 9, SOFT, 4.5);
    p.rect(MARGIN + nameW, y + 3, Math.max(2, trackW * c.share), 9, PRIMARY, 4.5);
    p.text(`${(c.share * 100).toFixed(0)}%`, MARGIN + nameW + trackW + 10, y + 12, {
      size: 9.5,
      color: MUTED,
      ltr: true,
    });
    p.text(money(c.total, currency), W - MARGIN, y + 12, {
      size: 10.5,
      align: 'end',
      ltr: true,
    });
    y += 22;
  });
  return y + 14;
}

function monthTable(p: Painter, input: ReportInput, y: number): number {
  const { summary, labels, currency } = input;
  if (summary.byMonth.length < 2) return y;
  p.text(labels.byMonth, MARGIN, y, { size: 13, weight: 600 });
  y += 16;
  const cols = [
    { key: 'month', x: MARGIN, align: 'start' as Align },
    { key: 'income', x: 290, align: 'end' as Align },
    { key: 'expense', x: 400, align: 'end' as Align },
    { key: 'net', x: W - MARGIN, align: 'end' as Align },
  ];
  const head = [labels.month, labels.income, labels.expenses, labels.net];
  cols.forEach((c, i) =>
    p.text(head[i], c.x, y, { size: 9.5, color: MUTED, align: c.align })
  );
  y += 6;
  p.hline(y);
  y += 14;
  // Latest months first, as many as fit on the summary page.
  const months = [...summary.byMonth].reverse().slice(0, 8);
  for (const m of months) {
    p.text(m.month, cols[0].x, y, { size: 10, ltr: true });
    p.text(money(m.income, currency), cols[1].x, y, { size: 10, align: 'end', ltr: true, color: INCOME });
    p.text(money(m.expense, currency), cols[2].x, y, { size: 10, align: 'end', ltr: true, color: EXPENSE });
    const net = m.income - m.expense;
    p.text(money(net, currency), cols[3].x, y, { size: 10, align: 'end', ltr: true, color: net >= 0 ? INCOME : EXPENSE });
    y += 18;
  }
  return y;
}

function footer(p: Painter, labels: ReportLabels, n: number, total: number): void {
  p.hline(H - 36);
  p.text(labels.brand, MARGIN, H - 20, { size: 9, color: MUTED });
  p.text(labels.page(n, total), W - MARGIN, H - 20, { size: 9, color: MUTED, align: 'end', ltr: true });
}

function transactionsPage(
  p: Painter,
  input: ReportInput,
  rows: ExportRow[],
  first: boolean,
  note: string | null
): void {
  const { labels, currency } = input;
  let y = MARGIN + 10;
  if (first) {
    p.text(labels.transactions, MARGIN, y, { size: 13, weight: 600 });
    y += 22;
  }
  const cols = {
    date: MARGIN,
    category: MARGIN + 74,
    description: MARGIN + 190,
  };
  p.text(labels.date, cols.date, y, { size: 9.5, color: MUTED });
  p.text(labels.category, cols.category, y, { size: 9.5, color: MUTED });
  p.text(labels.description, cols.description, y, { size: 9.5, color: MUTED });
  p.text(labels.amount, W - MARGIN, y, { size: 9.5, color: MUTED, align: 'end' });
  y += 6;
  p.hline(y);
  y += 16;
  for (const r of rows) {
    p.text(r.date, cols.date, y, { size: 9.5, ltr: true });
    p.text(r.category, cols.category, y, { size: 9.5, maxWidth: 108 });
    p.text(r.description, cols.description, y, { size: 9.5, color: MUTED, maxWidth: 200 });
    const signed = r.type === 'income' ? r.amount : -r.amount;
    p.text(money(signed, currency), W - MARGIN, y, {
      size: 9.5,
      align: 'end',
      ltr: true,
      color: r.type === 'income' ? INCOME : EXPENSE,
    });
    y += 18.5;
  }
  if (note) p.text(note, MARGIN, y + 8, { size: 9, color: MUTED });
}

/** Render the report as JPEG pages ready for `buildPdf`. */
export async function renderReportPages(input: ReportInput): Promise<PdfPage[]> {
  await ensureFonts();
  const shown = input.rows.slice(0, MAX_PDF_TRANSACTIONS);
  const chunks: ExportRow[][] = [];
  for (let i = 0; i < shown.length; i += ROWS_PER_PAGE) {
    chunks.push(shown.slice(i, i + ROWS_PER_PAGE));
  }
  const total = 1 + chunks.length;
  const pages: PdfPage[] = [];

  // Page 1: summary.
  {
    const { canvas, ctx } = newCanvas();
    const p = new Painter(ctx, input.rtl);
    let y = header(p, input, MARGIN);
    y = summaryCards(p, input, y);
    y = categoryBars(p, input, y);
    monthTable(p, input, y);
    footer(p, input.labels, 1, total);
    pages.push(await toJpegPage(canvas));
  }

  // Following pages: the transactions list.
  for (let i = 0; i < chunks.length; i++) {
    const { canvas, ctx } = newCanvas();
    const p = new Painter(ctx, input.rtl);
    const last = i === chunks.length - 1;
    const note =
      last && input.rows.length > shown.length
        ? input.labels.truncated
            .replace('{{shown}}', String(shown.length))
            .replace('{{total}}', String(input.rows.length))
        : null;
    transactionsPage(p, input, chunks[i], i === 0, note);
    footer(p, input.labels, i + 2, total);
    pages.push(await toJpegPage(canvas));
  }
  return pages;
}
