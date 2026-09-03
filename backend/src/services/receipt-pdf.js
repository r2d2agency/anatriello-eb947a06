// Comprovante de Registro de Ponto (Portaria MTP 671/2021) + Espelho de Ponto
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import crypto from 'crypto';
import { query } from '../db.js';
import { recalcEmployeePeriod } from './point-calculator.js';

const PUNCH_LABELS = {
  entrada: 'Entrada',
  saida_intervalo: 'Início Intervalo',
  retorno_intervalo: 'Fim Intervalo',
  saida: 'Saída',
  extraordinaria: 'Extraordinária',
};

export function buildSignatureHash(punch, employee) {
  const canonical = [
    punch.nsr || punch.id,
    employee.cpf || employee.id,
    new Date(punch.punched_at).toISOString(),
    punch.punch_type || '',
  ].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export async function ensurePunchSignature(punchId) {
  const r = await query(
    `SELECT tp.*, e.cpf, e.full_name AS employee_name, e.pis_pasep AS pis, o.name AS org_name
     FROM time_punches tp
     JOIN employees e ON e.id = tp.employee_id
     LEFT JOIN organizations o ON o.id = tp.organization_id
     WHERE tp.id = $1`, [punchId]
  );
  const punch = r.rows[0];
  if (!punch) return null;
  if (!punch.nsr) {
    const nsrRes = await query(
      `SELECT COALESCE(MAX(nsr),0)+1 AS n FROM time_punches WHERE organization_id = $1`,
      [punch.organization_id]
    );
    punch.nsr = nsrRes.rows[0].n;
    const hash = buildSignatureHash(punch, punch);
    punch.signature_hash = hash;
    await query(
      `UPDATE time_punches SET nsr = $1, signature_hash = $2 WHERE id = $3`,
      [punch.nsr, hash, punch.id]
    ).catch(() => {});
  }
  return punch;
}

export async function generateReceiptPDF(punchId) {
  const punch = await ensurePunchSignature(punchId);
  if (!punch) throw new Error('Batida não encontrada');

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([320, 480]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const draw = (text, x, y, opts = {}) =>
    page.drawText(String(text ?? ''), { x, y, size: opts.size || 9, font: opts.bold ? bold : font, color: rgb(0, 0, 0) });

  let y = 455;
  draw('COMPROVANTE DE REGISTRO DE PONTO', 20, y, { bold: true, size: 10 }); y -= 12;
  draw('Portaria MTP nº 671/2021', 20, y, { size: 7 }); y -= 18;

  draw(`Empregador: ${punch.org_name || '-'}`, 20, y); y -= 12;
  draw(`Colaborador: ${punch.employee_name}`, 20, y); y -= 12;
  draw(`CPF: ${punch.cpf || '-'}    PIS: ${punch.pis || '-'}`, 20, y); y -= 18;

  const dt = new Date(punch.punched_at);
  const spParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(dt).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const dateStr = `${spParts.day}/${spParts.month}/${spParts.year}`;
  const timeStr = `${spParts.hour}:${spParts.minute}:${spParts.second}`;

  draw('Data/Hora da marcação:', 20, y, { bold: true }); y -= 12;
  draw(`${dateStr}  ${timeStr}  (GMT-3)`, 20, y, { size: 12, bold: true }); y -= 20;

  draw(`Tipo: ${PUNCH_LABELS[punch.punch_type] || punch.punch_type}`, 20, y); y -= 12;
  draw(`NSR: ${String(punch.nsr).padStart(9, '0')}`, 20, y); y -= 12;
  if (punch.latitude && punch.longitude) {
    draw(`GPS: ${Number(punch.latitude).toFixed(5)}, ${Number(punch.longitude).toFixed(5)}`, 20, y); y -= 12;
  }
  if (punch.geo_status) { draw(`Status: ${punch.geo_status}`, 20, y); y -= 12; }
  y -= 8;
  draw('Assinatura digital (SHA-256):', 20, y, { bold: true }); y -= 12;
  const h = punch.signature_hash || '';
  draw(h.slice(0, 32), 20, y, { size: 7 }); y -= 10;
  draw(h.slice(32), 20, y, { size: 7 }); y -= 20;

  draw('Guarde este comprovante. Ele é válido como prova', 20, y, { size: 7 }); y -= 10;
  draw('do registro conforme a Portaria MTP 671/2021.', 20, y, { size: 7 });

  return await pdf.save();
}

export async function generateMirrorPDF({ organizationId, employeeId, startDate, endDate }) {
  const emp = await query(
    `SELECT e.*, o.name AS org_name, c.name AS company_name, c.cnpj AS company_cnpj
     FROM employees e
     LEFT JOIN organizations o ON o.id = e.organization_id
     LEFT JOIN companies c ON c.id = e.company_id
     WHERE e.id = $1`, [employeeId]
  );
  const employee = emp.rows[0];
  if (!employee) throw new Error('Colaborador não encontrado');

  const { days } = await recalcEmployeePeriod({ organizationId, employeeId, startDate, endDate });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]); // A4
  let y = 810;
  const draw = (text, x, yy, opts = {}) =>
    page.drawText(String(text ?? ''), { x, y: yy, size: opts.size || 8, font: opts.bold ? bold : font, color: opts.color || rgb(0, 0, 0) });

  const header = () => {
    draw('ESPELHO DE PONTO', 40, 810, { bold: true, size: 13 });
    draw(`Período: ${startDate} a ${endDate}`, 40, 795, { size: 9 });
    draw(`Empresa: ${employee.company_name || employee.org_name || '-'}   CNPJ: ${employee.company_cnpj || '-'}`, 40, 782);
    draw(`Colaborador: ${employee.full_name}   CPF: ${employee.cpf || '-'}   PIS: ${employee.pis_pasep || '-'}`, 40, 770);
    y = 748;
    // Cabeçalho tabela
    const cols = ['Data', 'Dia', 'E1', 'S1', 'E2', 'S2', 'Prev.', 'Trab.', 'Saldo', 'Status'];
    const xs = [40, 85, 115, 150, 185, 220, 260, 300, 340, 385];
    cols.forEach((c, i) => draw(c, xs[i], y, { bold: true, size: 8 }));
    y -= 12;
    page.drawLine({ start: { x: 40, y: y + 6 }, end: { x: 555, y: y + 6 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    return xs;
  };
  let xs = header();

  const dowLabel = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  let totalCred = 0, totalDeb = 0, totalWorked = 0;

  for (const d of days) {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 810;
      xs = header();
    }
    const dt = new Date(d.date + 'T12:00:00');
    const row = [
      `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`,
      dowLabel[d.dow],
      d.entry1 || '--',
      d.exit1 || '--',
      d.entry2 || '--',
      d.exit2 || '--',
      d.expected || '00:00',
      d.total_worked || '00:00',
      d.balance || '00:00',
      d.status,
    ];
    row.forEach((v, i) => draw(v, xs[i], y, { size: 8, color: d.status === 'falta' ? rgb(0.8, 0, 0) : rgb(0, 0, 0) }));
    y -= 11;
    totalCred += d.credit_min || 0;
    totalDeb += d.debit_min || 0;
    totalWorked += d.total_worked_min || 0;
  }

  y -= 10;
  page.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.5 });
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  draw(`TOTAIS   Trabalhado: ${fmt(totalWorked)}   Créditos: +${fmt(totalCred)}   Débitos: -${fmt(totalDeb)}   Saldo: ${fmt(totalCred - totalDeb)}`, 40, y - 8, { bold: true, size: 9 });
  y -= 40;
  draw('Declaro que os registros acima refletem a jornada efetivamente realizada.', 40, y);
  y -= 30;
  draw('_____________________________________', 40, y);
  draw(`${employee.full_name}`, 40, y - 10, { size: 8 });
  draw('_____________________________________', 330, y);
  draw('Empregador', 330, y - 10, { size: 8 });

  return await pdf.save();
}
