// Point Calculator - motor de cálculo diário de ponto
// Cartão Ponto estilo Secullum: BH 1:1, tolerância, adicional noturno,
// domingo/feriado com adicional, DSR semanal, escalas rotativas 6x1 / 12x36.

import { query } from '../db.js';

// --- helpers de tempo ---
const toMin = (hhmm) => {
  if (!hhmm) return null;
  const s = String(hhmm).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
};

const fromMin = (mins) => {
  if (mins == null || Number.isNaN(mins)) return null;
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(Math.round(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const TIMEZONE = 'America/Sao_Paulo';

// Formata um instante (Date/timestamptz) no horário de São Paulo, independente
// do fuso horário configurado no servidor (que roda em UTC em produção).
const toHHMMSS = (dateOrString) => {
  if (!dateOrString) return null;
  if (typeof dateOrString === 'string' && /^\d{2}:\d{2}/.test(dateOrString)) return dateOrString.slice(0, 5);
  try {
    const d = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
    return new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch { return null; }
};

// Data (YYYY-MM-DD) de um instante, no calendário de São Paulo.
const toSPDateStr = (dateOrString) => {
  const d = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
};

// Constantes hora noturna (22h → 5h)
const NIGHT_START = 22 * 60;
const NIGHT_END = 5 * 60;

// Interseção do intervalo [a,b) com [nightStart,1440)+[0,nightEnd)
function nightMinutesInRange(startMin, endMin) {
  if (endMin <= startMin) return 0;
  let total = 0;
  // Janela 22-24
  const a1 = Math.max(startMin, NIGHT_START);
  const b1 = Math.min(endMin, 24 * 60);
  if (b1 > a1) total += b1 - a1;
  // Janela 0-5
  const a2 = Math.max(startMin, 0);
  const b2 = Math.min(endMin, NIGHT_END);
  if (b2 > a2) total += b2 - a2;
  return total;
}

// --- parsing da jornada ---
// Aceita:
//   - string simples: "08:00-12:00,13:00-17:00" ou "08:00-17:00"
//   - JSON semanal: { sun:"folga", mon:"08:00-17:00", ... }
//   - workScheduleObj: { schedule_json, kind, cycle_pattern, cycle_start_date, ...regras }
export function parseWorkSchedule(raw, dow, dateStr) {
  if (!raw) return { entries: [], expectedMin: 0, hasSchedule: false };

  let obj = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { obj = JSON.parse(s); } catch { obj = s; }
    }
  }

  // Caso 0: jornada individual do colaborador (tela RH > Colaboradores),
  // formato { days: {seg,ter,...}, entry, exit, lunch_start, lunch_end, per_day_enabled, per_day }
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.days && typeof obj.days === 'object') {
    const dayKey = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][dow];
    if (!obj.days[dayKey]) return { entries: [], expectedMin: 0, hasSchedule: false, isDayOff: true };
    const t = (obj.per_day_enabled && obj.per_day && obj.per_day[dayKey]) ? obj.per_day[dayKey] : obj;
    if (!t.entry || !t.exit) return { entries: [], expectedMin: 0, hasSchedule: false, isDayOff: true };
    const hasLunch = t.lunch_start && t.lunch_end && t.lunch_start !== t.lunch_end
      && !(t.lunch_start === '00:00' && t.lunch_end === '00:00');
    const str = hasLunch ? `${t.entry}-${t.lunch_start},${t.lunch_end}-${t.exit}` : `${t.entry}-${t.exit}`;
    return parseScheduleString(str);
  }

  // Caso 1: objeto de work_schedule vindo do banco
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && (obj.schedule_json || obj.kind)) {
    // Escala rotativa (6x1, 12x36, etc)
    if (obj.cycle_pattern && Array.isArray(obj.cycle_pattern) && obj.cycle_start_date && dateStr) {
      const start = new Date(obj.cycle_start_date + 'T12:00:00');
      const cur = new Date(dateStr + 'T12:00:00');
      const diffDays = Math.floor((cur - start) / 86400000);
      if (diffDays >= 0) {
        const idx = diffDays % obj.cycle_pattern.length;
        const slot = obj.cycle_pattern[idx];
        return parseScheduleString(slot?.h || slot?.hours || 'folga');
      }
    }
    // Fixa semanal
    return parseScheduleString(pickWeeklyDay(obj.schedule_json || {}, dow));
  }

  // Caso 2: JSON semanal direto
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return parseScheduleString(pickWeeklyDay(obj, dow));
  }

  // Caso 3: string simples
  return parseScheduleString(String(obj || ''));
}

function pickWeeklyDay(json, dow) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return json[keys[dow]] || json.default || json.padrao || '';
}

function parseScheduleString(str) {
  const s = String(str || '').trim();
  if (!s || s.toLowerCase() === 'folga' || s.toLowerCase() === 'off') {
    return { entries: [], expectedMin: 0, hasSchedule: false, isDayOff: true };
  }
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  const entries = [];
  let totalMin = 0;
  for (const p of parts) {
    const m = p.match(/^(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})$/);
    if (!m) continue;
    const startMin = toMin(m[1]);
    let endMin = toMin(m[2]);
    if (startMin == null || endMin == null) continue;
    // Turno cruza meia-noite (ex: 19:00-07:00) → soma 24h no fim
    if (endMin <= startMin) endMin += 24 * 60;
    const dur = endMin - startMin;
    entries.push({ start: m[1], end: m[2], startMin, endMin, durationMin: dur });
    totalMin += dur;
  }
  if (entries.length === 1 && totalMin > 6 * 60) totalMin -= 60; // almoço implícito
  return { entries, expectedMin: totalMin, hasSchedule: entries.length > 0, isDayOff: false };
}

// --- cálculo de um dia ---
export function calculateDay({ punches = [], schedule, isHoliday = false, isSunday = false, rules = {} }) {
  const tolerance = rules.tolerance_minutes ?? 10;
  const nightBonusPct = rules.night_bonus_pct ?? 20;
  const sundayBonusPct = rules.sunday_bonus_pct ?? 100;
  const holidayBonusPct = rules.holiday_bonus_pct ?? 100;
  const overtimePct = rules.overtime_weekday_pct ?? 50;

  const sorted = [...punches]
    .filter(p => p && p.punched_at)
    .sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));

  const times = sorted.map(p => toHHMMSS(p.punched_at));
  const pairs = { entry1: null, exit1: null, entry2: null, exit2: null, entry3: null, exit3: null, entry4: null, exit4: null };
  ['entry1', 'exit1', 'entry2', 'exit2', 'entry3', 'exit3', 'entry4', 'exit4'].forEach((k, i) => {
    pairs[k] = times[i] || null;
  });

  // Minutos trabalhados e minutos noturnos.
  // Regra: somamos SEMPRE os pares entrada→saída do dia.
  // O café (saida_cafe → retorno_cafe) NÃO é descontado e NÃO tem limite fixo:
  // seja 15, 20 ou 25 minutos, conta integralmente como tempo trabalhado.
  const IN_TYPES = new Set(['entrada', 'retorno_intervalo', 'retorno_cafe', 'retorno', 'entrada_extra']);
  const OUT_TYPES = new Set(['saida', 'saida_intervalo', 'saida_cafe', 'saida_extra']);

  // Intervalos "abertos" = pares (in → out). Café conta como trabalhado (integral).
  const segments = [];
  const typed = sorted.every(p => IN_TYPES.has(p.punch_type) || OUT_TYPES.has(p.punch_type));

  if (typed && sorted.length > 1) {
    let openAt = null;
    for (const p of sorted) {
      const t = toMin(toHHMMSS(p.punched_at));
      if (t == null) continue;
      if (IN_TYPES.has(p.punch_type)) {
        if (openAt == null) openAt = t;
      } else if (openAt != null) {
        segments.push([openAt, t]);
        openAt = null;
      }
    }
    // Café: soma integralmente o tempo entre saida_cafe e o próximo retorno_cafe
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].punch_type === 'saida_cafe' && sorted[i + 1]?.punch_type === 'retorno_cafe') {
        const a = toMin(toHHMMSS(sorted[i].punched_at));
        const b = toMin(toHHMMSS(sorted[i + 1].punched_at));
        if (a != null && b != null) segments.push([a, b]);
      }
    }
  } else {
    // Fallback: alterna par a par pela ordem das batidas
    for (let i = 0; i < times.length - 1; i += 2) {
      const a = toMin(times[i]);
      const b = toMin(times[i + 1]);
      if (a == null || b == null) continue;
      segments.push([a, b]);
    }
  }

  let workedMin = 0;
  let nightMin = 0;
  for (const [start, rawEnd] of segments) {
    let a = start;
    let b = rawEnd;
    if (b <= a) b += 24 * 60; // turno cruzando meia-noite
    if (b > a) {
      workedMin += (b - a);
      nightMin += nightMinutesInRange(a, b);
    }
  }


  const oddPunch = times.length % 2 === 1;
  const expectedMin = schedule?.expectedMin || 0;
  const isDayOff = schedule?.isDayOff || false;

  let status = 'normal';
  let balanceMin = 0;
  let overtimeMin = 0;
  let overtimeBonusMin = 0;   // minutos de adicional (50%/100%)
  let nightBonusMin = 0;      // adicional noturno

  if (isHoliday || (isSunday && expectedMin === 0)) {
    status = isHoliday ? 'feriado' : 'folga';
    balanceMin = workedMin;
    overtimeMin = workedMin;
    overtimeBonusMin = Math.round(workedMin * (isHoliday ? holidayBonusPct : sundayBonusPct) / 100);
  } else if (isDayOff) {
    status = 'folga';
    balanceMin = workedMin;
    overtimeMin = workedMin;
    overtimeBonusMin = Math.round(workedMin * sundayBonusPct / 100);
  } else if (times.length === 0) {
    status = expectedMin > 0 ? 'falta' : 'folga';
    balanceMin = expectedMin > 0 ? -expectedMin : 0;
  } else {
    const rawBal = workedMin - expectedMin;
    if (Math.abs(rawBal) <= tolerance) balanceMin = 0;
    else balanceMin = rawBal;
    if (rawBal < -tolerance) status = 'atraso';
    else if (rawBal > tolerance) {
      status = 'extra';
      overtimeMin = rawBal;
      overtimeBonusMin = Math.round(rawBal * overtimePct / 100);
    }
  }

  nightBonusMin = Math.round(nightMin * nightBonusPct / 100);

  const creditMin = balanceMin > 0 ? balanceMin : 0;
  const debitMin = balanceMin < 0 ? -balanceMin : 0;

  return {
    ...pairs,
    total_worked_min: workedMin,
    total_worked: fromMin(workedMin),
    expected_min: expectedMin,
    expected: fromMin(expectedMin),
    balance_min: balanceMin,
    balance: fromMin(balanceMin),
    credit_min: creditMin,
    credit: fromMin(creditMin),
    debit_min: debitMin,
    debit: fromMin(debitMin),
    overtime_min: overtimeMin,
    overtime: fromMin(overtimeMin),
    overtime_bonus_min: overtimeBonusMin,
    overtime_bonus: fromMin(overtimeBonusMin),
    night_min: nightMin,
    night: fromMin(nightMin),
    night_bonus_min: nightBonusMin,
    night_bonus: fromMin(nightBonusMin),
    status,
    is_holiday: isHoliday,
    is_sunday: isSunday,
    is_day_off: isDayOff,
    odd_punch: oddPunch,
    punch_count: times.length,
  };
}

// --- recalcular todos os dias do colaborador no período ---
export async function recalcEmployeePeriod({ organizationId, employeeId, startDate, endDate }) {
  let emp;
  try {
    emp = await query(
      `SELECT e.id, e.work_schedule, e.work_schedule_id, e.company_id,
              ws.schedule_json, ws.kind AS ws_kind, ws.cycle_pattern, ws.cycle_start_date,
              ws.tolerance_minutes AS ws_tol, ws.night_bonus_pct, ws.sunday_bonus_pct,
              ws.holiday_bonus_pct, ws.overtime_weekday_pct, ws.dsr_enabled, ws.night_reduced_hour
       FROM employees e
       LEFT JOIN work_schedules ws ON ws.id = e.work_schedule_id
       WHERE e.id = $1`,
      [employeeId]
    );
  } catch (_) {
    // work_schedules pode não existir
    emp = await query(
      `SELECT e.id, e.work_schedule, NULL::uuid AS work_schedule_id, e.company_id,
              NULL::jsonb AS schedule_json, NULL::text AS ws_kind, NULL::text AS cycle_pattern, NULL::date AS cycle_start_date,
              NULL::int AS ws_tol, NULL::int AS night_bonus_pct, NULL::int AS sunday_bonus_pct,
              NULL::int AS holiday_bonus_pct, NULL::int AS overtime_weekday_pct, NULL::bool AS dsr_enabled, NULL::int AS night_reduced_hour
       FROM employees e WHERE e.id = $1`,
      [employeeId]
    ).catch(() => ({ rows: [] }));
  }
  if (!emp.rows[0]) return { days: [] };
  const row = emp.rows[0];
  const companyId = row.company_id;

  const workScheduleData = row.work_schedule_id ? {
    schedule_json: row.schedule_json,
    kind: row.ws_kind,
    cycle_pattern: row.cycle_pattern,
    cycle_start_date: row.cycle_start_date ? new Date(row.cycle_start_date).toISOString().slice(0, 10) : null,
  } : row.work_schedule;

  let rules = {
    tolerance_minutes: row.ws_tol ?? 10,
    night_bonus_pct: row.night_bonus_pct ?? 20,
    sunday_bonus_pct: row.sunday_bonus_pct ?? 100,
    holiday_bonus_pct: row.holiday_bonus_pct ?? 100,
    overtime_weekday_pct: row.overtime_weekday_pct ?? 50,
    dsr_enabled: row.dsr_enabled ?? true,
  };

  if (!row.work_schedule_id) {
    const tolRes = await query(
      `SELECT late_tolerance_minutes FROM time_rules WHERE organization_id = $1 AND (employee_id = $2 OR employee_id IS NULL) ORDER BY employee_id NULLS LAST LIMIT 1`,
      [organizationId, employeeId]
    ).catch(() => ({ rows: [] }));
    rules.tolerance_minutes = tolRes.rows[0]?.late_tolerance_minutes ?? 10;
  }

  const holRes = await query(
    `SELECT holiday_date FROM holidays WHERE organization_id = $1 AND (company_id = $2 OR company_id IS NULL) AND holiday_date BETWEEN $3 AND $4`,
    [organizationId, companyId, startDate, endDate]
  ).catch(() => ({ rows: [] }));
  const holidaySet = new Set(holRes.rows.map(r => new Date(r.holiday_date).toISOString().slice(0, 10)));

  const punchRes = await query(
    `SELECT id, punch_type, punched_at, geo_status, is_offline
     FROM time_punches
     WHERE employee_id = $1 AND (punched_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3
     ORDER BY punched_at`,
    [employeeId, startDate, endDate]
  ).catch(() => ({ rows: [] }));


  const byDate = new Map();
  for (const p of punchRes.rows) {
    const d = toSPDateStr(p.punched_at);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(p);
  }

  // Iterar dias
  const days = [];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const schedule = parseWorkSchedule(workScheduleData, dow, dateStr);
    const punches = byDate.get(dateStr) || [];
    const isHoliday = holidaySet.has(dateStr);
    const isSunday = dow === 0;
    const calc = calculateDay({ punches, schedule, isHoliday, isSunday, rules });
    days.push({ date: dateStr, dow, ...calc, punches });
  }

  // ==== DSR (Descanso Semanal Remunerado) ====
  // Se colaborador faltou/atrasou em dia útil, perde DSR proporcional da semana.
  // Cálculo simplificado: para cada semana (dom-sáb) do período,
  // se HÁ faltas em dias úteis, marcamos o débito do DSR = horas do domingo previstas.
  // (Compensação positiva de DSR fica para o cálculo de folha.)
  if (rules.dsr_enabled) {
    const weeks = new Map();
    for (const day of days) {
      const dObj = new Date(day.date + 'T12:00:00');
      const weekStart = new Date(dObj);
      weekStart.setDate(dObj.getDate() - dObj.getDay());
      const wk = weekStart.toISOString().slice(0, 10);
      if (!weeks.has(wk)) weeks.set(wk, []);
      weeks.get(wk).push(day);
    }
    for (const [, wkDays] of weeks) {
      const hasAbsence = wkDays.some(d => d.status === 'falta');
      const sunday = wkDays.find(d => d.dow === 0);
      if (hasAbsence && sunday) sunday.dsr_lost = true;
    }
  }

  // Persistir time_records + time_bank_entries
  for (const day of days) {
    await query(
      `INSERT INTO time_records (organization_id, employee_id, record_date, entry1, exit1, entry2, exit2, entry3, exit3, total_hours, overtime_hours, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (employee_id, record_date) DO UPDATE SET
         entry1=EXCLUDED.entry1, exit1=EXCLUDED.exit1, entry2=EXCLUDED.entry2, exit2=EXCLUDED.exit2,
         entry3=EXCLUDED.entry3, exit3=EXCLUDED.exit3,
         total_hours=EXCLUDED.total_hours, overtime_hours=EXCLUDED.overtime_hours,
         status=EXCLUDED.status, updated_at=NOW()`,
      [organizationId, employeeId, day.date, day.entry1, day.exit1, day.entry2, day.exit2, day.entry3, day.exit3,
        (day.total_worked_min / 60).toFixed(2), (day.overtime_min / 60).toFixed(2), day.status]
    ).catch(() => {});

    await query(
      `DELETE FROM time_bank_entries WHERE employee_id = $1 AND entry_date = $2 AND source = 'auto'`,
      [employeeId, day.date]
    ).catch(() => {});
    if (day.balance_min !== 0) {
      await query(
        `INSERT INTO time_bank_entries (organization_id, company_id, employee_id, entry_date, minutes, kind, source, description)
         VALUES ($1,$2,$3,$4,$5,$6,'auto',$7)`,
        [organizationId, companyId, employeeId, day.date, day.balance_min,
          day.balance_min > 0 ? 'credit' : 'debit',
          `Cálculo automático (${day.status})`]
      ).catch(() => {});
    }
  }

  return { days };
}

export default { calculateDay, parseWorkSchedule, recalcEmployeePeriod };
