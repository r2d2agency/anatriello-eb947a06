import jsPDF from 'jspdf';

export interface MirrorPdfDay {
  date: string; // YYYY-MM-DD
  dow: number; // 0-6, 0=domingo
  entry1?: string | null;
  exit1?: string | null;
  entry2?: string | null;
  exit2?: string | null;
  expected_min?: number | null;
  total_worked_min?: number | null;
  balance_min?: number | null;
  status: string;
}

export interface MirrorPdfEmployee {
  full_name: string;
  cpf?: string | null;
  pis_pasep?: string | null;
  company_name?: string | null;
  company_cnpj?: string | null;
}

export interface MirrorPdfTotals {
  worked_min: number;
  credit_min: number;
  debit_min: number;
  balance_min: number;
}

export interface MirrorPdfData {
  employee: MirrorPdfEmployee;
  days: MirrorPdfDay[];
  totals: MirrorPdfTotals;
  periodLabel: string; // ex.: "01/08/2026 a 31/08/2026"
}

type Rgb = [number, number, number];

const ORANGE: Rgb = [217, 119, 6];
const ORANGE_DARK: Rgb = [180, 83, 9];
const TABLE_HEADER_BG: Rgb = [194, 88, 24];
const INK: Rgb = [30, 26, 22];
const MUTED: Rgb = [110, 104, 96];
const CARD_BG: Rgb = [250, 248, 244];
const CARD_BORDER: Rgb = [228, 220, 208];
const PAGE_BG: Rgb = [253, 251, 247];
const FRAME_BORDER: Rgb = [40, 34, 26];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const STATUS_META: Record<string, { label: string; bg: Rgb; text: Rgb; dot: Rgb }> = {
  normal: { label: 'Normal', bg: [220, 252, 231], text: [21, 128, 61], dot: [34, 197, 94] },
  extra: { label: 'Hora extra', bg: [219, 234, 254], text: [29, 78, 216], dot: [37, 99, 235] },
  atraso: { label: 'Débito', bg: [254, 226, 226], text: [185, 28, 28], dot: [220, 38, 38] },
  falta: { label: 'Falta', bg: [254, 226, 226], text: [185, 28, 28], dot: [220, 38, 38] },
  feriado: { label: 'Feriado', bg: [243, 232, 255], text: [126, 34, 206], dot: [147, 51, 234] },
  folga: { label: 'Folga', bg: [241, 245, 249], text: [71, 85, 105], dot: [148, 163, 184] },
};
const DEFAULT_STATUS_META = { label: 'Sem registro', bg: [241, 245, 249] as Rgb, text: [100, 116, 139] as Rgb, dot: [148, 163, 184] as Rgb };

const fmtHM = (min?: number | null) => {
  const abs = Math.abs(Math.round(min || 0));
  return `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};
const fmtSigned = (min?: number | null) => `${(min || 0) < 0 ? '-' : ''}${fmtHM(min)}`;

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch('/anatriello-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function setFill(doc: jsPDF, c: Rgb) { doc.setFillColor(c[0], c[1], c[2]); }
function setDraw(doc: jsPDF, c: Rgb) { doc.setDrawColor(c[0], c[1], c[2]); }
function setText(doc: jsPDF, c: Rgb) { doc.setTextColor(c[0], c[1], c[2]); }

function drawBuildingIcon(doc: jsPDF, cx: number, cy: number, r: number) {
  setFill(doc, ORANGE);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.35);
  const w = r * 0.9, h = r * 1.05;
  doc.rect(cx - w / 2, cy - h / 2, w, h, 'S');
  doc.line(cx - w / 2, cy - h / 6, cx + w / 2, cy - h / 6);
  doc.line(cx, cy - h / 2, cx, cy + h / 2);
}

function drawPersonIcon(doc: jsPDF, cx: number, cy: number, r: number) {
  setFill(doc, ORANGE);
  doc.circle(cx, cy, r, 'F');
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy - r * 0.32, r * 0.3, 'F');
  doc.ellipse(cx, cy + r * 0.55, r * 0.5, r * 0.4, 'F');
}

function drawClockIcon(doc: jsPDF, cx: number, cy: number, r: number, color: Rgb) {
  setFill(doc, color);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.4);
  doc.line(cx, cy, cx, cy - r * 0.55);
  doc.line(cx, cy, cx + r * 0.4, cy);
}

function drawArrowIcon(doc: jsPDF, cx: number, cy: number, r: number, color: Rgb, up: boolean) {
  setFill(doc, color);
  doc.circle(cx, cy, r, 'F');
  doc.setFillColor(255, 255, 255);
  const s = r * 0.5;
  if (up) doc.triangle(cx - s, cy + s * 0.4, cx + s, cy + s * 0.4, cx, cy - s * 0.6, 'F');
  else doc.triangle(cx - s, cy - s * 0.4, cx + s, cy - s * 0.4, cx, cy + s * 0.6, 'F');
}

function drawScaleIcon(doc: jsPDF, cx: number, cy: number, r: number, color: Rgb) {
  setFill(doc, color);
  doc.circle(cx, cy, r, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.35);
  doc.line(cx - r * 0.55, cy, cx + r * 0.55, cy);
  doc.line(cx, cy - r * 0.15, cx, cy + r * 0.4);
  doc.circle(cx - r * 0.55, cy + r * 0.15, r * 0.18, 'S');
  doc.circle(cx + r * 0.55, cy + r * 0.15, r * 0.18, 'S');
}

function drawCalendarIcon(doc: jsPDF, cx: number, cy: number, size: number, color: Rgb) {
  setDraw(doc, color);
  doc.setLineWidth(0.3);
  doc.roundedRect(cx - size / 2, cy - size / 2, size, size, 0.5, 0.5, 'S');
  doc.line(cx - size / 2, cy - size / 6, cx + size / 2, cy - size / 6);
  doc.line(cx - size / 4, cy - size / 2 - size / 8, cx - size / 4, cy - size / 2 + size / 8);
  doc.line(cx + size / 4, cy - size / 2 - size / 8, cx + size / 4, cy - size / 2 + size / 8);
}

export async function generateTimeclockMirrorPdf(data: MirrorPdfData): Promise<jsPDF> {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = 210, pageH = 297;
  const margin = 12;
  const contentW = pageW - margin * 2;
  const logoDataUrl = await loadLogoDataUrl();

  const paintBackground = () => {
    setFill(doc, PAGE_BG);
    doc.rect(0, 0, pageW, pageH, 'F');
    setDraw(doc, FRAME_BORDER);
    doc.setLineWidth(0.5);
    doc.rect(6, 6, pageW - 12, pageH - 12, 'S');
  };

  const cols = [
    { key: 'date', label: 'DATA', w: 16, align: 'left' as const },
    { key: 'dia', label: 'DIA', w: 13, align: 'left' as const },
    { key: 'entry1', label: 'ENT. 1', w: 15, align: 'center' as const },
    { key: 'exit1', label: 'SAÍDA 1', w: 17, align: 'center' as const },
    { key: 'entry2', label: 'ENT. 2', w: 15, align: 'center' as const },
    { key: 'exit2', label: 'SAÍDA 2', w: 17, align: 'center' as const },
    { key: 'expected', label: 'PREV.', w: 14, align: 'center' as const },
    { key: 'worked', label: 'TRAB.', w: 14, align: 'center' as const },
    { key: 'balance', label: 'SALDO', w: 16, align: 'center' as const },
    { key: 'status', label: 'SITUAÇÃO', w: 0, align: 'left' as const },
  ];
  const fixedW = cols.reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1].w = contentW - fixedW;
  const colX: number[] = [];
  { let x = margin; for (const c of cols) { colX.push(x); x += c.w; } }

  const rowH = 5.3;

  const drawTableHeaderRow = (y: number) => {
    setFill(doc, TABLE_HEADER_BG);
    doc.rect(margin, y, contentW, 6.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.6);
    setText(doc, [255, 255, 255]);
    cols.forEach((c, i) => {
      const tx = c.align === 'center' ? colX[i] + c.w / 2 : colX[i] + 1.5;
      doc.text(c.label, tx, y + 4.3, { align: c.align === 'left' ? 'left' : 'center' });
    });
    return y + 6.5;
  };

  paintBackground();
  let y = margin + 4;

  // ─── Cabeçalho ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  setText(doc, ORANGE);
  doc.text('CONTROLE DE JORNADA', margin, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  setText(doc, INK);
  doc.text('ESPELHO DE PONTO', margin, y);

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', pageW - margin - 16, margin + 2, 16, 16); } catch { /* ignora logo inválido */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setText(doc, INK);
  doc.text('ANATRIELLO', pageW - margin - 18, margin + 24, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setText(doc, MUTED);
  doc.text('F A C I L I T I E S', pageW - margin - 18, margin + 28, { align: 'right' });

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(doc, MUTED);
  doc.text('Período de apuração:', margin, y);
  doc.setFont('helvetica', 'bold');
  setText(doc, INK);
  doc.text(data.periodLabel, margin + 32, y);

  y += 4;
  setDraw(doc, ORANGE);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ─── Cards Empresa / Colaborador ───
  const cardH = 20;
  const cardGap = 4;
  const cardW = (contentW - cardGap) / 2;

  const drawInfoCard = (x: number, icon: (cx: number, cy: number, r: number) => void, label: string, title: string, detail: string) => {
    setFill(doc, CARD_BG);
    setDraw(doc, CARD_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
    icon(x + 10, y + cardH / 2, 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    setText(doc, ORANGE);
    doc.text(label, x + 19, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    setText(doc, INK);
    doc.text(doc.splitTextToSize(title, cardW - 22)[0] || title, x + 19, y + 12.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText(doc, MUTED);
    doc.text(detail, x + 19, y + 17);
  };

  drawInfoCard(
    margin, drawBuildingIcon, 'EMPRESA',
    data.employee.company_name || 'ANATRIELLO FACILITIES LTDA',
    `CNPJ: ${data.employee.company_cnpj || '-'}`
  );
  drawInfoCard(
    margin + cardW + cardGap, drawPersonIcon, 'COLABORADOR',
    data.employee.full_name,
    `CPF: ${data.employee.cpf || '-'}   PIS: ${data.employee.pis_pasep || '-'}`
  );
  y += cardH + 6;

  // ─── Tabela ───
  y = drawTableHeaderRow(y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);

  data.days.forEach((d, idx) => {
    if (y + rowH > pageH - margin - 6) {
      doc.addPage();
      paintBackground();
      y = margin + 4;
      y = drawTableHeaderRow(y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
    }

    const isWeekend = d.dow === 0 || d.dow === 6;
    setFill(doc, isWeekend ? [244, 240, 233] : (idx % 2 === 0 ? [255, 255, 255] : [250, 248, 244]));
    doc.rect(margin, y, contentW, rowH, 'F');

    const [yy, mm, dd] = d.date.split('-');
    const dateLabel = `${dd}/${mm}`;
    const meta = STATUS_META[d.status] || DEFAULT_STATUS_META;
    const balance = d.balance_min ?? 0;
    const balanceColor: Rgb = balance < 0 ? [185, 28, 28] : (balance > 0 ? [29, 78, 216] : [100, 116, 139]);

    setText(doc, INK);
    doc.setFont('helvetica', 'bold');
    doc.text(dateLabel, colX[0] + 1.5, y + rowH - 1.6);
    doc.setFont('helvetica', 'normal');
    setText(doc, MUTED);
    doc.text(WEEKDAYS[d.dow] || '', colX[1] + 1.5, y + rowH - 1.6);

    setText(doc, INK);
    const centerText = (i: number, val: string) => doc.text(val, colX[i] + cols[i].w / 2, y + rowH - 1.6, { align: 'center' });
    centerText(2, d.entry1 || '--');
    centerText(3, d.exit1 || '--');
    centerText(4, d.entry2 || '--');
    centerText(5, d.exit2 || '--');
    setText(doc, MUTED);
    centerText(6, fmtHM(d.expected_min));
    setText(doc, INK);
    doc.setFont('helvetica', 'bold');
    centerText(7, fmtHM(d.total_worked_min));

    setText(doc, balanceColor);
    centerText(8, fmtSigned(balance));

    // Badge de situação
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    const badgeText = meta.label;
    const badgeW = doc.getTextWidth(badgeText) + 4;
    const badgeX = colX[9] + 1.5;
    const badgeY = y + 1.1;
    setFill(doc, meta.bg);
    doc.roundedRect(badgeX, badgeY, badgeW, 3.6, 1.2, 1.2, 'F');
    setText(doc, meta.text);
    doc.text(badgeText, badgeX + badgeW / 2, badgeY + 2.6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);

    y += rowH;
  });

  y += 4;

  // ─── Totais ───
  const footerBlockH = 66;
  if (y + footerBlockH > pageH - margin) {
    doc.addPage();
    paintBackground();
    y = margin + 6;
  }

  const totalsH = 20;
  const totalsW = contentW / 4;
  const totalsItems: Array<{ label: string; value: string; color: Rgb; icon: (cx: number, cy: number, r: number) => void }> = [
    { label: 'HORAS TRABALHADAS', value: fmtHM(data.totals.worked_min), color: INK, icon: (cx, cy, r) => drawClockIcon(doc, cx, cy, r, ORANGE) },
    { label: 'CRÉDITOS', value: `+${fmtHM(data.totals.credit_min)}`, color: [29, 78, 216], icon: (cx, cy, r) => drawArrowIcon(doc, cx, cy, r, [37, 99, 235], true) },
    { label: 'DÉBITOS', value: `-${fmtHM(data.totals.debit_min)}`, color: [185, 28, 28], icon: (cx, cy, r) => drawArrowIcon(doc, cx, cy, r, [220, 38, 38], false) },
    { label: 'SALDO DO PERÍODO', value: fmtSigned(data.totals.balance_min), color: (data.totals.balance_min || 0) < 0 ? [185, 28, 28] : [21, 128, 61], icon: (cx, cy, r) => drawScaleIcon(doc, cx, cy, r, ORANGE_DARK) },
  ];

  setDraw(doc, CARD_BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, totalsH, 1.5, 1.5, 'S');
  totalsItems.forEach((item, i) => {
    const x = margin + totalsW * i;
    if (i > 0) doc.line(x, y, x, y + totalsH);
    item.icon(x + 9, y + totalsH / 2, 4.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.4);
    setText(doc, MUTED);
    doc.text(item.label, x + 16, y + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    setText(doc, item.color);
    doc.text(item.value, x + 16, y + 15);
  });
  y += totalsH + 5;

  // ─── Legenda ───
  const legendItems: Array<{ dot: Rgb; text: string }> = [
    { dot: STATUS_META.normal.dot, text: 'Normal: jornada dentro do previsto' },
    { dot: STATUS_META.extra.dot, text: 'Hora extra: horas trabalhadas além do previsto' },
    { dot: STATUS_META.atraso.dot, text: 'Débito: horas não trabalhadas / atrasos' },
    { dot: STATUS_META.folga.dot, text: 'Folga: dia de descanso / sem expediente' },
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  let lx = margin;
  legendItems.forEach((item) => {
    setFill(doc, item.dot);
    doc.circle(lx + 1, y - 1, 1, 'F');
    setText(doc, MUTED);
    doc.text(item.text, lx + 3.5, y);
    lx += doc.getTextWidth(item.text) + 12;
  });
  y += 7;

  // ─── Declaração ───
  setDraw(doc, CARD_BORDER);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setText(doc, MUTED);
  doc.text('Declaro que os registros apresentados neste espelho refletem a jornada de trabalho registrada no período acima indicado.', margin, y);
  y += 14;

  const sigW = (contentW - 16) / 2;
  setDraw(doc, [120, 110, 96]);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + sigW, y);
  doc.line(margin + sigW + 16, y, margin + contentW, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  setText(doc, INK);
  doc.text(data.employee.full_name, margin, y + 4);
  doc.text('Empregador / Responsável', margin + sigW + 16, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  setText(doc, MUTED);
  doc.text('Colaborador', margin, y + 8);
  doc.text('Empresa', margin + sigW + 16, y + 8);
  y += 14;

  // ─── Rodapé ───
  drawCalendarIcon(doc, margin + 2, pageH - margin - 4, 3, MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  setText(doc, MUTED);
  doc.text('Documento gerado eletronicamente pelo sistema de controle de ponto.', pageW / 2, pageH - margin - 3, { align: 'center' });

  return doc;
}

export async function downloadTimeclockMirrorPdf(data: MirrorPdfData, filename?: string) {
  const doc = await generateTimeclockMirrorPdf(data);
  const safeName = filename || `espelho-${data.employee.full_name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
  doc.save(safeName);
}
