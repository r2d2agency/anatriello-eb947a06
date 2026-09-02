// Módulo de Ponto Eletrônico completo
// Cartão Ponto (grade Secullum), Banco de Horas 1:1, Feriados, Ajustes (RH + Colaborador)

import express from 'express';
import crypto from 'crypto';

import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logError } from '../logger.js';
import { recalcEmployeePeriod, parseWorkSchedule } from '../services/point-calculator.js';

const router = express.Router();
router.use(authenticate);

async function resolveOrgId(req) {
  if (req.query.org_id) return req.query.org_id;
  if (req.body?.organization_id) return req.body.organization_id;
  const r = await query(`SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`, [req.userId]);
  return r.rows[0]?.organization_id;
}

// ---- ensureSchema (JIT) ----
// IMPORTANTE: cada statement roda isolado (não como uma única transação).
// rh.js também cria/mantém a tabela `holidays` (com colunas name/type/state/city,
// sem company_id/description/scope) via ensureHolidaysInfrastructure(). Se qualquer
// statement aqui falhar (ex.: coluna de outra migração ainda não existe), os demais
// continuam — do contrário uma única falha em `holidays` derrubava a criação de
// TODAS as tabelas deste módulo (time_period_closings, work_schedules, etc), o que
// explicava 500 em praticamente toda rota de /api/timeclock/*.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS holidays (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      holiday_date DATE NOT NULL,
      description VARCHAR(255),
      scope VARCHAR(20) DEFAULT 'nacional',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  // Coexistência com a versão de `holidays` criada por rh.js (schema mais antigo)
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS description VARCHAR(255)`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'nacional'`,
  `ALTER TABLE holidays ALTER COLUMN name DROP NOT NULL`,
  `ALTER TABLE holidays ALTER COLUMN description DROP NOT NULL`,
  `UPDATE holidays SET description = name WHERE description IS NULL AND name IS NOT NULL`,
  `UPDATE holidays SET name = description WHERE name IS NULL AND description IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_holidays_org_date ON holidays(organization_id, holiday_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_org_comp_date ON holidays(organization_id, COALESCE(company_id::text,''), holiday_date)`,

  `CREATE TABLE IF NOT EXISTS time_bank_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      entry_date DATE NOT NULL,
      minutes INTEGER NOT NULL,
      kind VARCHAR(20) NOT NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'auto',
      description TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_tb_emp_date ON time_bank_entries(employee_id, entry_date)`,

  `CREATE TABLE IF NOT EXISTS punch_adjustment_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      punch_date DATE NOT NULL,
      requested_times TEXT,
      justification TEXT NOT NULL,
      attachment_url TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_par_org_status ON punch_adjustment_requests(organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_par_emp ON punch_adjustment_requests(employee_id)`,

  `CREATE TABLE IF NOT EXISTS time_period_closings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      closed_at TIMESTAMPTZ DEFAULT NOW(),
      notes TEXT
    )`,
  `CREATE INDEX IF NOT EXISTS idx_tpc_org_period ON time_period_closings(organization_id, period_end)`,

  `CREATE TABLE IF NOT EXISTS punch_edit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      punch_date DATE NOT NULL,
      action VARCHAR(20) NOT NULL,
      field_name VARCHAR(40),
      old_value TEXT,
      new_value TEXT,
      reason TEXT,
      edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      edited_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_pel_emp_date ON punch_edit_log(employee_id, punch_date)`,

  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'app'`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS edited_by UUID`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS original_time TIMESTAMPTZ`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS nsr BIGINT`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS signature_hash VARCHAR(128)`,
  `ALTER TABLE time_punches ADD COLUMN IF NOT EXISTS selfie_url TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_tp_org_nsr ON time_punches(organization_id, nsr)`,

  `CREATE TABLE IF NOT EXISTS time_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      record_date DATE NOT NULL,
      entry1 TIME, exit1 TIME, entry2 TIME, exit2 TIME, entry3 TIME, exit3 TIME,
      total_hours NUMERIC(6,2) DEFAULT 0,
      overtime_hours NUMERIC(6,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'normal',
      justification TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, record_date)
    )`,

  // ==== FASE 3: Jornadas reutilizáveis ====
  `CREATE TABLE IF NOT EXISTS work_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(30) NOT NULL DEFAULT 'fixa',
      -- schedule_json: { sun:"folga", mon:"08:00-12:00,13:00-17:00", ... }
      schedule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- Escalas rotativas: cycle_days_json = [{d:1,h:"07:00-19:00"},{d:2,h:"folga"},...]
      cycle_pattern JSONB,
      cycle_start_date DATE,
      -- Regras
      tolerance_minutes INTEGER DEFAULT 10,
      night_bonus_pct INTEGER DEFAULT 20,
      sunday_bonus_pct INTEGER DEFAULT 100,
      holiday_bonus_pct INTEGER DEFAULT 100,
      overtime_weekday_pct INTEGER DEFAULT 50,
      dsr_enabled BOOLEAN DEFAULT TRUE,
      night_reduced_hour BOOLEAN DEFAULT TRUE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_ws_org ON work_schedules(organization_id)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_schedule_id UUID REFERENCES work_schedules(id) ON DELETE SET NULL`,

  // ==== FASE 6: Banco de Horas com Compensação e Expiração ====
  `ALTER TABLE time_bank_entries ADD COLUMN IF NOT EXISTS expires_at DATE`,
  `ALTER TABLE time_bank_entries ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE time_bank_entries ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ`,
  `ALTER TABLE time_bank_entries ADD COLUMN IF NOT EXISTS compensation_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_tb_expires ON time_bank_entries(expires_at) WHERE expired = FALSE AND minutes > 0`,

  `CREATE TABLE IF NOT EXISTS time_bank_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      expiration_months INTEGER NOT NULL DEFAULT 12,
      allow_debit BOOLEAN DEFAULT TRUE,
      max_debit_hours NUMERIC(6,2) DEFAULT 40,
      notify_days_before INTEGER DEFAULT 30,
      compensation_requires_approval BOOLEAN DEFAULT TRUE,
      auto_expire_enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_tb_config_org_comp ON time_bank_config(organization_id, COALESCE(company_id::text,''))`,

  `CREATE TABLE IF NOT EXISTS time_bank_compensations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      planned_date DATE NOT NULL,
      minutes INTEGER NOT NULL CHECK (minutes > 0),
      description TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      review_note TEXT,
      executed_entry_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_tbc_org_status ON time_bank_compensations(organization_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tbc_emp ON time_bank_compensations(employee_id, planned_date)`,

  // Trigger para preencher expires_at automaticamente em créditos
  `CREATE OR REPLACE FUNCTION set_time_bank_expiration()
    RETURNS TRIGGER AS $$
    DECLARE
      cfg_months INTEGER;
    BEGIN
      IF NEW.minutes > 0 AND NEW.expires_at IS NULL THEN
        SELECT expiration_months INTO cfg_months
          FROM time_bank_config
         WHERE organization_id = NEW.organization_id
           AND (company_id = NEW.company_id OR company_id IS NULL)
         ORDER BY (company_id = NEW.company_id) DESC NULLS LAST
         LIMIT 1;
        NEW.expires_at := NEW.entry_date + ((COALESCE(cfg_months, 12)) || ' months')::interval;
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_set_tb_expiration ON time_bank_entries`,
  `CREATE TRIGGER trg_set_tb_expiration BEFORE INSERT ON time_bank_entries
      FOR EACH ROW EXECUTE FUNCTION set_time_bank_expiration()`,

  // ==== FASE 8: Espelho Digital com Aceite ====
  `CREATE TABLE IF NOT EXISTS time_mirror_acceptances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      reference_month VARCHAR(7) NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      totals_json JSONB DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      accepted_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      employee_comments TEXT,
      signature_hash VARCHAR(128),
      signature_ip VARCHAR(45),
      device_info JSONB,
      generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_mirror_org_month ON time_mirror_acceptances(organization_id, reference_month)`,
  `CREATE INDEX IF NOT EXISTS idx_mirror_emp ON time_mirror_acceptances(employee_id, reference_month)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_mirror_emp_month ON time_mirror_acceptances(employee_id, reference_month)`,
];

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await query(stmt);
    } catch (err) {
      logError('timeclock.ensureSchema.statement', err, { statement: stmt.slice(0, 120) });
    }
  }
  schemaReady = true;
}

router.use(async (_req, _res, next) => { try { await ensureSchema(); } catch {} next(); });


// ---- helpers: closing lock & notifications ----
export async function isPeriodClosed(orgId, employeeId, dateStr) {
  try {
    const emp = await query(`SELECT company_id FROM employees WHERE id = $1`, [employeeId]);
    const compId = emp.rows[0]?.company_id || null;
    const r = await query(
      `SELECT 1 FROM time_period_closings
        WHERE organization_id = $1
          AND (company_id = $2 OR company_id IS NULL)
          AND $3::date BETWEEN period_start AND period_end
        LIMIT 1`,
      [orgId, compId, dateStr]
    );
    return r.rowCount > 0;
  } catch { return false; }
}

async function notifyEmployee(orgId, employeeId, title, message, type = 'ponto', refType = null, refId = null) {
  try {
    await query(
      `INSERT INTO collaborator_notifications
       (organization_id, employee_id, title, message, type, reference_type, reference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, employeeId, title, message, type, refType, refId]
    );
  } catch (e) { logError('timeclock.notifyEmployee', e); }
}

async function notifyRhStaff(orgId, title, message, type = 'ponto', refType = null, refId = null) {
  try {
    await query(
      `INSERT INTO collaborator_notifications (organization_id, employee_id, title, message, type, reference_type, reference_id)
       SELECT $1, e.id, $2, $3, $4, $5, $6
         FROM employees e
        WHERE e.organization_id = $1
          AND e.status = 'ativo'
          AND e.worker_profile IN ('administrativo','supervisor')
        LIMIT 20`,
      [orgId, title, message, type, refType, refId]
    );
  } catch (e) { logError('timeclock.notifyRhStaff', e); }
}

// ============================================
// JORNADAS DE TRABALHO (Fase 3)
// ============================================
router.get('/work-schedules', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const r = await query(
      `SELECT ws.*, c.trade_name AS company_name,
              (SELECT COUNT(*)::int FROM employees WHERE work_schedule_id = ws.id) AS employees_count
       FROM work_schedules ws
       LEFT JOIN companies c ON c.id = ws.company_id
       WHERE ws.organization_id = $1
       ORDER BY ws.name`, [orgId]);
    res.json(r.rows);
  } catch (err) { logError('timeclock.ws.list', err); res.status(500).json({ error: 'Erro' }); }
});

// Garante a tabela de jornadas mesmo que o ensureSchema geral tenha falhado
async function ensureWorkSchedulesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS work_schedules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      company_id UUID,
      name VARCHAR(120) NOT NULL,
      kind VARCHAR(30) NOT NULL DEFAULT 'fixa',
      schedule_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      cycle_pattern JSONB,
      cycle_start_date DATE,
      tolerance_minutes INTEGER DEFAULT 10,
      night_bonus_pct INTEGER DEFAULT 20,
      sunday_bonus_pct INTEGER DEFAULT 100,
      holiday_bonus_pct INTEGER DEFAULT 100,
      overtime_weekday_pct INTEGER DEFAULT 50,
      dsr_enabled BOOLEAN DEFAULT TRUE,
      night_reduced_hour BOOLEAN DEFAULT TRUE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_schedule_id UUID`);
}

// Normaliza o schedule_json: aceita "8:00-17:00", "08h00 as 17h00", "folga", etc.
function normalizeScheduleJson(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const raw = String(v ?? '').trim();
    if (!raw) { out[k] = 'folga'; continue; }
    if (/^(folga|off|-)$/i.test(raw)) { out[k] = 'folga'; continue; }
    const parts = raw.split(/[,;]/).map(p => p.trim()).filter(Boolean).map(p => {
      const m = p.replace(/h/gi, ':').match(/^(\d{1,2}):?(\d{2})?\s*(?:-|–|as|às|a)\s*(\d{1,2}):?(\d{2})?$/i);
      if (!m) return null;
      const pad = (n) => String(Number(n)).padStart(2, '0');
      return `${pad(m[1])}:${m[2] || '00'}-${pad(m[3])}:${m[4] || '00'}`;
    }).filter(Boolean);
    out[k] = parts.length ? parts.join(',') : 'folga';
  }
  return out;
}

// cycle_pattern pode chegar como array, string JSON ou texto inválido (digitação em curso)
function normalizeCyclePattern(input) {
  if (!input) return null;
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }
  return null;
}

const intOr = (v, d) => (v === '' || v == null || Number.isNaN(Number(v))) ? d : Math.trunc(Number(v));

router.post('/work-schedules', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const b = req.body || {};
    if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    await ensureWorkSchedulesTable();
    const cycle = normalizeCyclePattern(b.cycle_pattern);
    const r = await query(
      `INSERT INTO work_schedules
       (organization_id, company_id, name, kind, schedule_json, cycle_pattern, cycle_start_date,
        tolerance_minutes, night_bonus_pct, sunday_bonus_pct, holiday_bonus_pct,
        overtime_weekday_pct, dsr_enabled, night_reduced_hour, active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [orgId, b.company_id || null, String(b.name).trim(), b.kind || 'fixa',
        JSON.stringify(normalizeScheduleJson(b.schedule_json)),
        cycle ? JSON.stringify(cycle) : null,
        b.cycle_start_date || null,
        intOr(b.tolerance_minutes, 10), intOr(b.night_bonus_pct, 20),
        intOr(b.sunday_bonus_pct, 100), intOr(b.holiday_bonus_pct, 100),
        intOr(b.overtime_weekday_pct, 50), b.dsr_enabled !== false,
        b.night_reduced_hour !== false, b.active !== false]);
    res.json(r.rows[0]);
  } catch (err) {
    logError('timeclock.ws.post', err);
    res.status(500).json({ error: err?.message || 'Erro ao salvar jornada' });
  }
});

router.put('/work-schedules/:id', async (req, res) => {
  try {
    const b = req.body || {};
    await ensureWorkSchedulesTable();
    const cycle = normalizeCyclePattern(b.cycle_pattern);
    const r = await query(
      `UPDATE work_schedules SET
         name=COALESCE($2,name), kind=COALESCE($3,kind),
         schedule_json=COALESCE($4::jsonb,schedule_json),
         cycle_pattern=$5::jsonb, cycle_start_date=$6,
         tolerance_minutes=COALESCE($7,tolerance_minutes),
         night_bonus_pct=COALESCE($8,night_bonus_pct),
         sunday_bonus_pct=COALESCE($9,sunday_bonus_pct),
         holiday_bonus_pct=COALESCE($10,holiday_bonus_pct),
         overtime_weekday_pct=COALESCE($11,overtime_weekday_pct),
         dsr_enabled=COALESCE($12,dsr_enabled),
         night_reduced_hour=COALESCE($13,night_reduced_hour),
         active=COALESCE($14,active), company_id=$15,
         updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, b.name ? String(b.name).trim() : null, b.kind,
        b.schedule_json ? JSON.stringify(normalizeScheduleJson(b.schedule_json)) : null,
        cycle ? JSON.stringify(cycle) : null,
        b.cycle_start_date || null,
        intOr(b.tolerance_minutes, null), intOr(b.night_bonus_pct, null),
        intOr(b.sunday_bonus_pct, null), intOr(b.holiday_bonus_pct, null),
        intOr(b.overtime_weekday_pct, null),
        typeof b.dsr_enabled === 'boolean' ? b.dsr_enabled : null,
        typeof b.night_reduced_hour === 'boolean' ? b.night_reduced_hour : null,
        typeof b.active === 'boolean' ? b.active : null,
        b.company_id || null]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Jornada não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    logError('timeclock.ws.put', err);
    res.status(500).json({ error: err?.message || 'Erro ao salvar jornada' });
  }
});


router.delete('/work-schedules/:id', async (req, res) => {
  try {
    await query(`UPDATE employees SET work_schedule_id = NULL WHERE work_schedule_id = $1`, [req.params.id]);
    await query(`DELETE FROM work_schedules WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// Vincular colaboradores em massa
router.post('/work-schedules/:id/assign', async (req, res) => {
  try {
    const { employee_ids = [] } = req.body || {};
    if (!Array.isArray(employee_ids) || !employee_ids.length) return res.status(400).json({ error: 'employee_ids obrigatório' });
    await query(`UPDATE employees SET work_schedule_id = $1 WHERE id = ANY($2::uuid[])`, [req.params.id, employee_ids]);
    res.json({ ok: true, count: employee_ids.length });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ============================================
// FASE 7: Escalas Avançadas — Templates + Forecast
// ============================================
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const SCHEDULE_TEMPLATES = [
  {
    id: '5x2_comercial', name: 'Comercial 5x2 (Seg–Sex 8h–17h)', kind: 'fixa',
    description: 'Segunda a sexta, com 1h de almoço. Folga sáb/dom.',
    schedule_json: {
      mon: '08:00-12:00,13:00-17:00', tue: '08:00-12:00,13:00-17:00',
      wed: '08:00-12:00,13:00-17:00', thu: '08:00-12:00,13:00-17:00',
      fri: '08:00-12:00,13:00-17:00', sat: 'folga', sun: 'folga',
    },
  },
  {
    id: '6x1_varejo', name: 'Varejo 6x1', kind: 'escala_6x1',
    description: 'Seis dias trabalhados, um de folga. Rotação semanal.',
    cycle_pattern: [
      { d: 1, h: '09:00-13:00,14:00-18:00' }, { d: 2, h: '09:00-13:00,14:00-18:00' },
      { d: 3, h: '09:00-13:00,14:00-18:00' }, { d: 4, h: '09:00-13:00,14:00-18:00' },
      { d: 5, h: '09:00-13:00,14:00-18:00' }, { d: 6, h: '09:00-13:00,14:00-18:00' },
      { d: 7, h: 'folga' },
    ],
  },
  {
    id: '5x1_operacional', name: 'Operacional 5x1', kind: 'ciclica',
    description: 'Cinco dias corridos de trabalho e um de folga.',
    cycle_pattern: [
      { d: 1, h: '07:00-11:00,12:00-16:00' }, { d: 2, h: '07:00-11:00,12:00-16:00' },
      { d: 3, h: '07:00-11:00,12:00-16:00' }, { d: 4, h: '07:00-11:00,12:00-16:00' },
      { d: 5, h: '07:00-11:00,12:00-16:00' }, { d: 6, h: 'folga' },
    ],
  },
  {
    id: '4x2_industrial', name: 'Industrial 4x2', kind: 'ciclica',
    description: 'Quatro dias de trabalho por dois de folga (turnos de 8h).',
    cycle_pattern: [
      { d: 1, h: '06:00-14:00' }, { d: 2, h: '06:00-14:00' },
      { d: 3, h: '06:00-14:00' }, { d: 4, h: '06:00-14:00' },
      { d: 5, h: 'folga' }, { d: 6, h: 'folga' },
    ],
  },
  {
    id: '12x36_plantao', name: 'Plantão 12x36', kind: 'escala_12x36',
    description: '12 horas trabalhadas, 36 de descanso. Comum em saúde e segurança.',
    cycle_pattern: [
      { d: 1, h: '07:00-19:00' }, { d: 2, h: 'folga' }, { d: 3, h: 'folga' },
    ],
  },
  {
    id: '24x48_plantao', name: 'Plantão 24x48', kind: 'ciclica',
    description: '24 horas trabalhadas, 48 de descanso.',
    cycle_pattern: [
      { d: 1, h: '00:00-23:59' }, { d: 2, h: 'folga' }, { d: 3, h: 'folga' },
    ],
  },
  {
    id: 'noturno_6x1', name: 'Noturno 6x1 (22h–06h)', kind: 'escala_6x1',
    description: 'Escala noturna com adicional de 20%.',
    cycle_pattern: [
      { d: 1, h: '22:00-06:00' }, { d: 2, h: '22:00-06:00' }, { d: 3, h: '22:00-06:00' },
      { d: 4, h: '22:00-06:00' }, { d: 5, h: '22:00-06:00' }, { d: 6, h: '22:00-06:00' },
      { d: 7, h: 'folga' },
    ],
  },
];

router.get('/work-schedules/templates', (_req, res) => {
  res.json(SCHEDULE_TEMPLATES);
});

// Calcula minutos de uma string tipo "08:00-12:00,13:00-17:00"
function shiftMinutes(shift) {
  if (!shift || shift === 'folga' || shift === 'off') return 0;
  return String(shift).split(',').reduce((sum, part) => {
    const [a, b] = part.trim().split('-');
    if (!a || !b) return sum;
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    let mins = (bh * 60 + bm) - (ah * 60 + am);
    if (mins < 0) mins += 24 * 60; // atravessa meia-noite
    return sum + mins;
  }, 0);
}

// Expande uma escala em N dias a partir de startDate
function expandSchedule(ws, startDateStr, days) {
  const startDate = new Date(startDateStr + 'T00:00:00Z');
  const result = [];
  const kind = ws.kind || 'fixa';
  const scheduleJson = ws.schedule_json || {};
  const cycle = ws.cycle_pattern || [];
  const cycleStart = ws.cycle_start_date
    ? new Date(ws.cycle_start_date + 'T00:00:00Z')
    : startDate;
  const cycleLen = Array.isArray(cycle) ? cycle.length : 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    let shift = 'folga';

    if (kind === 'fixa') {
      const wk = WEEKDAY_KEYS[d.getUTCDay()];
      shift = scheduleJson[wk] || 'folga';
    } else if (cycleLen > 0) {
      const diffDays = Math.floor((d - cycleStart) / 86400000);
      const idx = ((diffDays % cycleLen) + cycleLen) % cycleLen;
      shift = cycle[idx]?.h || 'folga';
    }

    const minutes = shiftMinutes(shift);
    result.push({
      date: dateStr,
      weekday: d.getUTCDay(),
      shift,
      minutes,
      is_off: minutes === 0,
    });
  }
  return result;
}

// GET forecast de uma escala existente
router.get('/work-schedules/:id/forecast', async (req, res) => {
  try {
    const { start, days } = req.query;
    const n = Math.min(Number(days) || 30, 400);
    if (!start) return res.status(400).json({ error: 'start obrigatório' });
    const r = await query(`SELECT * FROM work_schedules WHERE id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Escala não encontrada' });
    const days_list = expandSchedule(r.rows[0], start, n);
    const totalMin = days_list.reduce((s, d) => s + d.minutes, 0);
    const workDays = days_list.filter(d => !d.is_off).length;
    res.json({
      schedule: r.rows[0],
      start, days: n,
      days_list,
      totals: {
        work_days: workDays,
        off_days: days_list.length - workDays,
        total_minutes: totalMin,
        avg_daily_minutes: workDays ? Math.round(totalMin / workDays) : 0,
        weekly_hours: Math.round((totalMin / n) * 7 / 60 * 100) / 100,
      },
    });
  } catch (err) { logError('timeclock.ws.forecast', err); res.status(500).json({ error: 'Erro' }); }
});

// POST preview (para escalas ainda não salvas)
router.post('/work-schedules/preview', async (req, res) => {
  try {
    const { schedule, start, days } = req.body || {};
    if (!schedule || !start) return res.status(400).json({ error: 'schedule e start obrigatórios' });
    const n = Math.min(Number(days) || 30, 400);
    const days_list = expandSchedule(schedule, start, n);
    const totalMin = days_list.reduce((s, d) => s + d.minutes, 0);
    const workDays = days_list.filter(d => !d.is_off).length;
    res.json({
      days_list,
      totals: {
        work_days: workDays,
        off_days: days_list.length - workDays,
        total_minutes: totalMin,
        avg_daily_minutes: workDays ? Math.round(totalMin / workDays) : 0,
        weekly_hours: Math.round((totalMin / n) * 7 / 60 * 100) / 100,
      },
    });
  } catch (err) { logError('timeclock.ws.preview', err); res.status(500).json({ error: 'Erro' }); }
});



// ============================================
// CARTÃO PONTO (grade estilo Secullum)
// ============================================

// GET /api/timeclock/cartao-ponto?employee_id=..&start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/cartao-ponto', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, start, end } = req.query;
    if (!orgId || !employee_id || !start || !end) return res.status(400).json({ error: 'org_id, employee_id, start, end obrigatórios' });

    let empRow = null;
    try {
      const emp = await query(
        `SELECT e.id, e.full_name, e.cpf, e.registration_number, e.work_schedule, e.work_schedule_id, e.company_id,
                c.trade_name AS company_name, c.cnpj AS company_cnpj,
                d.name AS department_name, e.position
         FROM employees e
         LEFT JOIN companies c ON c.id = e.company_id
         LEFT JOIN rh_departments d ON d.id = e.department_id
         WHERE e.id = $1`,
        [employee_id]
      );
      empRow = emp.rows[0] || null;
    } catch (e) {
      // fallback sem join em rh_departments (tabela pode não existir)
      try {
        const emp2 = await query(
          `SELECT e.id, e.full_name, e.cpf, e.registration_number, e.work_schedule, e.work_schedule_id, e.company_id,
                  c.trade_name AS company_name, c.cnpj AS company_cnpj,
                  NULL::text AS department_name, e.position
           FROM employees e
           LEFT JOIN companies c ON c.id = e.company_id
           WHERE e.id = $1`,
          [employee_id]
        );
        empRow = emp2.rows[0] || null;
      } catch (_) { empRow = null; }
    }
    if (!empRow) return res.status(404).json({ error: 'Colaborador não encontrado' });

    // Recalcular tudo antes de retornar — tolerante a falhas de esquema
    let days = [];
    let recalcError = null;
    try {
      const r = await recalcEmployeePeriod({ organizationId: orgId, employeeId: employee_id, startDate: start, endDate: end });
      days = r.days || [];
    } catch (e) {
      recalcError = e.message || String(e);
      logError('timeclock.cartao-ponto.recalc', e);
      // Fallback: gera grade vazia com apenas as batidas do período
      try {
        const punchRes = await query(
          `SELECT id, punch_type, punched_at
           FROM time_punches
           WHERE employee_id = $1 AND (punched_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
           ORDER BY punched_at`,
          [employee_id, start, end]
        ).catch(() => ({ rows: [] }));
        const byDate = new Map();
        for (const p of punchRes.rows) {
          const d = new Date(p.punched_at).toISOString().slice(0, 10);
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d).push(p);
        }
        const s = new Date(start + 'T12:00:00');
        const e2 = new Date(end + 'T12:00:00');
        for (let d = new Date(s); d <= e2; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          const punches = byDate.get(dateStr) || [];
          days.push({
            date: dateStr, dow: d.getDay(),
            entry1: null, exit1: null, entry2: null, exit2: null, entry3: null, exit3: null,
            total_worked_min: 0, expected_min: 0, credit_min: 0, debit_min: 0, balance_min: 0,
            overtime_min: 0, status: punches.length ? 'ok' : 'sem_registro',
            punches,
          });
        }
      } catch (_) { days = []; }
    }

    const totals = days.reduce((acc, d) => {
      acc.worked_min += d.total_worked_min || 0;
      acc.expected_min += d.expected_min || 0;
      acc.credit_min += d.credit_min || 0;
      acc.debit_min += d.debit_min || 0;
      acc.balance_min += d.balance_min || 0;
      if (d.status === 'falta') acc.absences++;
      if (d.status === 'atraso') acc.lates++;
      return acc;
    }, { worked_min: 0, expected_min: 0, credit_min: 0, debit_min: 0, balance_min: 0, absences: 0, lates: 0 });

    res.json({ employee: empRow, days, totals, ...(recalcError ? { warning: 'Cálculo parcial', detail: recalcError } : {}) });
  } catch (err) {
    logError('timeclock.cartao-ponto', err);
    res.status(500).json({ error: 'Erro ao carregar cartão ponto', detail: err.message });
  }
});


// PUT /api/timeclock/cartao-ponto — editar batidas de um dia (RH)
// body: { employee_id, date, times: ["08:00","12:00","13:00","17:00"], reason }
router.put('/cartao-ponto', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, date, times = [], reason } = req.body || {};
    if (!orgId || !employee_id || !date) return res.status(400).json({ error: 'Dados obrigatórios' });

    // Bloqueio por fechamento
    if (await isPeriodClosed(orgId, employee_id, date)) {
      return res.status(423).json({ error: 'Período fechado. Reabra o fechamento para editar.', code: 'PERIOD_CLOSED' });
    }

    // Buscar batidas atuais do dia
    const current = await query(
      `SELECT id, punched_at FROM time_punches WHERE employee_id = $1 AND (punched_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date ORDER BY punched_at`,
      [employee_id, date]
    );
    const oldTimes = current.rows.map(r => new Date(r.punched_at).toISOString().slice(11, 16));

    // Estratégia: apagar e recriar como source='manual'
    if (current.rows.length) {
      await query(`DELETE FROM time_punches WHERE id = ANY($1::uuid[])`, [current.rows.map(r => r.id)]);
    }

    const cleanTimes = times.filter(t => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 8);
    for (let i = 0; i < cleanTimes.length; i++) {
      const t = cleanTimes[i];
      const punchType = i === 0 ? 'entrada' : (i === cleanTimes.length - 1 ? 'saida' : (i % 2 === 1 ? 'saida_intervalo' : 'retorno_intervalo'));
      await query(
        `INSERT INTO time_punches (organization_id, employee_id, punch_type, punched_at, source, edited_by, edited_at)
         VALUES ($1, $2, $3, (($4::date + $5::time) AT TIME ZONE 'America/Sao_Paulo'), 'manual', $6, NOW())`,
        [orgId, employee_id, punchType, date, t + ':00', req.userId]
      );
    }

    // Log de edição
    await query(
      `INSERT INTO punch_edit_log (organization_id, employee_id, punch_date, action, field_name, old_value, new_value, reason, edited_by)
       VALUES ($1,$2,$3,'edit','times',$4,$5,$6,$7)`,
      [orgId, employee_id, date, oldTimes.join(', '), cleanTimes.join(', '), reason || null, req.userId]
    );

    // Recalcular
    await recalcEmployeePeriod({ organizationId: orgId, employeeId: employee_id, startDate: date, endDate: date });

    // Notificar colaborador
    await notifyEmployee(orgId, employee_id, 'Ponto ajustado pelo RH',
      `Suas batidas de ${date} foram alteradas para: ${cleanTimes.join(' · ') || '(sem batidas)'}${reason ? '. Motivo: ' + reason : ''}`,
      'ponto_ajuste', 'punch_date', null);

    res.json({ ok: true });
  } catch (err) {
    logError('timeclock.cartao-ponto.put', err);
    res.status(500).json({ error: 'Erro ao editar cartão ponto' });
  }
});

// GET log de edições de um dia
router.get('/cartao-ponto/audit', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, date } = req.query;
    const r = await query(
      `SELECT pel.*, u.name AS editor_name FROM punch_edit_log pel
       LEFT JOIN users u ON u.id = pel.edited_by
       WHERE pel.organization_id = $1 AND pel.employee_id = $2 AND pel.punch_date = $3
       ORDER BY pel.edited_at DESC`,
      [orgId, employee_id, date]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// GET /api/timeclock/punches/daily-grid?start=&end=&company_id=&employee_id=
// Retorna lista de colaboradores com resumo diário de batidas + total do dia
router.get('/punches/daily-grid', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.json({ employees: [], days: [] });
    const { start, end, company_id, employee_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start e end são obrigatórios' });

    const filters = ['e.organization_id = $1', "e.status = 'ativo'"];
    const params = [orgId, start, end];
    if (company_id) { params.push(company_id); filters.push(`e.company_id = $${params.length}`); }
    if (employee_id) { params.push(employee_id); filters.push(`e.id = $${params.length}`); }

    const sql = `
      WITH days AS (
        SELECT generate_series($2::date, $3::date, interval '1 day')::date AS d
      ),
      emp_days AS (
        SELECT e.id AS employee_id, e.full_name, e.photo_url, e.company_id,
               c.trade_name AS company_name,
               d.d AS record_date
        FROM employees e
        LEFT JOIN companies c ON c.id = e.company_id
        CROSS JOIN days d
        WHERE ${filters.join(' AND ')}
      ),
      punches AS (
        SELECT tp.employee_id,
               (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date AS record_date,
               tp.punched_at
        FROM time_punches tp
        WHERE tp.organization_id = $1
          AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
      ),
      day_punches AS (
        SELECT employee_id, record_date,
               array_agg(to_char(punched_at AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ORDER BY punched_at) AS times_arr,
               array_agg(punched_at ORDER BY punched_at) AS ts_arr
        FROM punches
        GROUP BY employee_id, record_date
      )
      SELECT ed.employee_id, ed.full_name, ed.photo_url, ed.company_id, ed.company_name,
             ed.record_date,
             COALESCE(dp.times_arr, ARRAY[]::text[]) AS times,
             dp.ts_arr AS timestamps
      FROM emp_days ed
      LEFT JOIN day_punches dp ON dp.employee_id = ed.employee_id AND dp.record_date = ed.record_date
      ORDER BY ed.full_name, ed.record_date
    `;
    const r = await query(sql, params);

    // Agrupar por colaborador; calcular minutos por par (entrada/saída)
    const byEmp = new Map();
    for (const row of r.rows) {
      if (!byEmp.has(row.employee_id)) {
        byEmp.set(row.employee_id, {
          employee_id: row.employee_id,
          full_name: row.full_name,
          photo_url: row.photo_url,
          company_id: row.company_id,
          company_name: row.company_name,
          days: {},
          total_minutes: 0,
        });
      }
      const emp = byEmp.get(row.employee_id);
      const times = row.times || [];
      const ts = (row.timestamps || []).map(t => new Date(t));
      let minutes = 0;
      for (let i = 0; i + 1 < ts.length; i += 2) {
        minutes += Math.max(0, Math.round((ts[i + 1] - ts[i]) / 60000));
      }
      const dateKey = new Date(row.record_date).toISOString().slice(0, 10);
      emp.days[dateKey] = { times, minutes, punch_count: times.length };
      emp.total_minutes += minutes;
    }

    // Lista de datas do intervalo
    const days = [];
    const s = new Date(start); const e = new Date(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    res.json({ days, employees: Array.from(byEmp.values()) });
  } catch (err) {
    logError('timeclock.punches.daily-grid', err);
    res.status(500).json({ error: 'Erro ao carregar registros', detail: String(err?.message || err) });
  }
});


// ============================================
// BANCO DE HORAS
// ============================================
router.get('/time-bank/summary', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.json([]);
    const { employee_id, company_id } = req.query;
    const notifyDays = 30;
    // Verifica se as tabelas existem (evita 500 quando o schema ainda não foi criado)
    const tbCheck = await query(
      `SELECT to_regclass('public.time_bank_entries') AS tb, to_regclass('public.time_bank_compensations') AS tbc`
    );
    const hasTb = !!tbCheck.rows[0]?.tb;
    const hasTbc = !!tbCheck.rows[0]?.tbc;
    const tbJoin = hasTb ? `LEFT JOIN time_bank_entries tb ON tb.employee_id = e.id` : '';
    const balExpr = hasTb ? `COALESCE(SUM(tb.minutes),0)::int` : `0::int`;
    const availExpr = hasTb ? `COALESCE(SUM(CASE WHEN tb.expired = FALSE THEN tb.minutes ELSE 0 END),0)::int` : `0::int`;
    const expiringExpr = hasTb ? `COALESCE(SUM(CASE WHEN tb.minutes > 0 AND tb.expired = FALSE AND tb.expires_at IS NOT NULL AND tb.expires_at <= (CURRENT_DATE + ($X || ' days')::interval) THEN tb.minutes ELSE 0 END),0)::int` : `0::int`;
    const expiredExpr = hasTb ? `COALESCE(SUM(CASE WHEN tb.expired = TRUE THEN tb.minutes ELSE 0 END),0)::int` : `0::int`;
    const pendCompExpr = hasTbc
      ? `COALESCE((SELECT SUM(minutes) FROM time_bank_compensations WHERE employee_id = e.id AND status = 'pending'),0)::int`
      : `0::int`;

    let sql, params;
    if (employee_id) {
      sql = `SELECT e.id, e.full_name,
                    ${balExpr} AS balance_min,
                    ${availExpr} AS available_min,
                    ${expiringExpr.replace('$X', '$2')} AS expiring_soon_min,
                    ${expiredExpr} AS expired_min,
                    ${pendCompExpr} AS pending_comp_min
             FROM employees e
             ${tbJoin}
             WHERE e.id = $1
             GROUP BY e.id, e.full_name`;
      params = [employee_id, notifyDays];
    } else {
      const compFilter = company_id ? ` AND e.company_id = $3` : '';
      sql = `SELECT e.id, e.full_name, e.photo_url,
                    ${balExpr} AS balance_min,
                    ${availExpr} AS available_min,
                    ${expiringExpr.replace('$X', '$2')} AS expiring_soon_min,
                    ${expiredExpr} AS expired_min,
                    ${pendCompExpr} AS pending_comp_min
             FROM employees e
             ${tbJoin}
             WHERE e.organization_id = $1 AND e.status = 'ativo'${compFilter}
             GROUP BY e.id, e.full_name, e.photo_url
             ORDER BY e.full_name`;
      params = company_id ? [orgId, notifyDays, company_id] : [orgId, notifyDays];
    }
    res.json((await query(sql, params)).rows);
  } catch (err) {
    logError('timeclock.tb.summary', err);
    res.status(500).json({ error: 'Erro ao carregar banco de horas', detail: String(err?.message || err) });
  }
});


router.get('/time-bank/entries', async (req, res) => {
  try {
    const { employee_id, start, end } = req.query;
    const r = await query(
      `SELECT tb.*, u.name AS created_by_name FROM time_bank_entries tb
       LEFT JOIN users u ON u.id = tb.created_by
       WHERE tb.employee_id = $1 AND tb.entry_date BETWEEN $2 AND $3
       ORDER BY tb.entry_date, tb.created_at`,
      [employee_id, start, end]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/time-bank/manual', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, entry_date, minutes, description } = req.body || {};
    if (!employee_id || !entry_date || minutes == null) return res.status(400).json({ error: 'Dados obrigatórios' });
    const emp = await query(`SELECT company_id FROM employees WHERE id = $1`, [employee_id]);
    const r = await query(
      `INSERT INTO time_bank_entries (organization_id, company_id, employee_id, entry_date, minutes, kind, source, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7,$8) RETURNING *`,
      [orgId, emp.rows[0]?.company_id || null, employee_id, entry_date, minutes,
        minutes > 0 ? 'credit' : 'debit', description || 'Ajuste manual', req.userId]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.tb.manual', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/time-bank/entries/:id', async (req, res) => {
  try {
    await query(`DELETE FROM time_bank_entries WHERE id = $1 AND source = 'manual'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ---------- CONFIG BANCO DE HORAS ----------
router.get('/time-bank/config', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { company_id } = req.query;
    const r = await query(
      `SELECT * FROM time_bank_config
        WHERE organization_id = $1
          AND (company_id = $2 OR ($2::uuid IS NULL AND company_id IS NULL))
        ORDER BY (company_id IS NOT NULL) DESC LIMIT 1`,
      [orgId, company_id || null]
    );
    res.json(r.rows[0] || {
      organization_id: orgId, company_id: company_id || null,
      expiration_months: 12, allow_debit: true, max_debit_hours: 40,
      notify_days_before: 30, compensation_requires_approval: true, auto_expire_enabled: true,
    });
  } catch (err) { logError('timeclock.tb.config.get', err); res.status(500).json({ error: 'Erro' }); }
});

router.put('/time-bank/config', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { company_id, expiration_months, allow_debit, max_debit_hours,
            notify_days_before, compensation_requires_approval, auto_expire_enabled } = req.body || {};
    const months = [6, 12, 18].includes(Number(expiration_months)) ? Number(expiration_months) : 12;
    const r = await query(
      `INSERT INTO time_bank_config
         (organization_id, company_id, expiration_months, allow_debit, max_debit_hours,
          notify_days_before, compensation_requires_approval, auto_expire_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (organization_id, COALESCE(company_id::text,''))
       DO UPDATE SET expiration_months = EXCLUDED.expiration_months,
                     allow_debit = EXCLUDED.allow_debit,
                     max_debit_hours = EXCLUDED.max_debit_hours,
                     notify_days_before = EXCLUDED.notify_days_before,
                     compensation_requires_approval = EXCLUDED.compensation_requires_approval,
                     auto_expire_enabled = EXCLUDED.auto_expire_enabled,
                     updated_at = NOW()
       RETURNING *`,
      [orgId, company_id || null, months, allow_debit !== false, max_debit_hours ?? 40,
       notify_days_before ?? 30, compensation_requires_approval !== false, auto_expire_enabled !== false]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.tb.config.put', err); res.status(500).json({ error: 'Erro ao salvar configuração' }); }
});

// ---------- ENTRIES EXPIRANDO ----------
router.get('/time-bank/expiring', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const days = Number(req.query.days) || 30;
    const { employee_id, company_id } = req.query;
    const filters = ['tb.organization_id = $1', 'tb.expired = FALSE', 'tb.minutes > 0',
                     'tb.expires_at IS NOT NULL',
                     `tb.expires_at <= (CURRENT_DATE + ($2 || ' days')::interval)`];
    const params = [orgId, days];
    if (employee_id) { params.push(employee_id); filters.push(`tb.employee_id = $${params.length}`); }
    if (company_id) { params.push(company_id); filters.push(`tb.company_id = $${params.length}`); }
    const r = await query(
      `SELECT tb.*, e.full_name, e.registration_number,
              (tb.expires_at - CURRENT_DATE) AS days_remaining
         FROM time_bank_entries tb
         JOIN employees e ON e.id = tb.employee_id
        WHERE ${filters.join(' AND ')}
        ORDER BY tb.expires_at ASC, e.full_name`,
      params
    );
    res.json(r.rows);
  } catch (err) { logError('timeclock.tb.expiring', err); res.status(500).json({ error: 'Erro' }); }
});

// Executa expiração (marca créditos vencidos e gera débito compensatório)
router.post('/time-bank/expire-run', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const expired = await query(
      `SELECT id, organization_id, company_id, employee_id, minutes, expires_at
         FROM time_bank_entries
        WHERE organization_id = $1 AND expired = FALSE AND minutes > 0
          AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE`,
      [orgId]
    );
    let processed = 0;
    for (const row of expired.rows) {
      await query(
        `UPDATE time_bank_entries SET expired = TRUE, expired_at = NOW() WHERE id = $1`,
        [row.id]
      );
      await query(
        `INSERT INTO time_bank_entries
           (organization_id, company_id, employee_id, entry_date, minutes, kind, source, description, expires_at)
         VALUES ($1,$2,$3,CURRENT_DATE,$4,'debit','expiration',$5,NULL)`,
        [row.organization_id, row.company_id, row.employee_id, -row.minutes,
         `Expiração automática do crédito de ${row.expires_at.toISOString().slice(0, 10)}`]
      );
      processed++;
    }
    res.json({ ok: true, processed });
  } catch (err) { logError('timeclock.tb.expire', err); res.status(500).json({ error: 'Erro ao executar expiração' }); }
});

// ---------- COMPENSAÇÕES ----------
router.get('/time-bank/compensations', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { status, employee_id } = req.query;
    const filters = ['c.organization_id = $1'];
    const params = [orgId];
    if (status) { params.push(status); filters.push(`c.status = $${params.length}`); }
    if (employee_id) { params.push(employee_id); filters.push(`c.employee_id = $${params.length}`); }
    const r = await query(
      `SELECT c.*, e.full_name, e.registration_number,
              ur.name AS requested_by_name, ua.name AS reviewed_by_name
         FROM time_bank_compensations c
         JOIN employees e ON e.id = c.employee_id
         LEFT JOIN users ur ON ur.id = c.requested_by
         LEFT JOIN users ua ON ua.id = c.reviewed_by
        WHERE ${filters.join(' AND ')}
        ORDER BY c.planned_date DESC, c.created_at DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) { logError('timeclock.tb.comp.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/time-bank/compensations', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, planned_date, minutes, description } = req.body || {};
    if (!employee_id || !planned_date || !minutes || minutes <= 0) {
      return res.status(400).json({ error: 'Dados obrigatórios (minutos deve ser positivo)' });
    }
    const emp = await query(`SELECT company_id FROM employees WHERE id = $1`, [employee_id]);
    const cfg = await query(
      `SELECT compensation_requires_approval FROM time_bank_config
        WHERE organization_id = $1 AND (company_id = $2 OR company_id IS NULL)
        ORDER BY (company_id IS NOT NULL) DESC LIMIT 1`,
      [orgId, emp.rows[0]?.company_id || null]
    );
    const requiresApproval = cfg.rows[0]?.compensation_requires_approval !== false;
    const status = requiresApproval ? 'pending' : 'approved';
    const r = await query(
      `INSERT INTO time_bank_compensations
         (organization_id, company_id, employee_id, planned_date, minutes, description, status, requested_by, reviewed_by, reviewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7='approved' THEN $8 ELSE NULL END, CASE WHEN $7='approved' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [orgId, emp.rows[0]?.company_id || null, employee_id, planned_date, minutes,
       description || null, status, req.userId]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.tb.comp.create', err); res.status(500).json({ error: 'Erro' }); }
});

router.patch('/time-bank/compensations/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { status, review_note } = req.body || {};
    if (!['approved', 'rejected', 'cancelled', 'executed'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    const cur = await query(
      `SELECT * FROM time_bank_compensations WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId]
    );
    if (!cur.rowCount) return res.status(404).json({ error: 'Não encontrado' });
    const comp = cur.rows[0];
    let executed_entry_id = comp.executed_entry_id;

    if (status === 'executed' && !executed_entry_id) {
      const ent = await query(
        `INSERT INTO time_bank_entries
           (organization_id, company_id, employee_id, entry_date, minutes, kind, source, description, compensation_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,'debit','compensation',$6,$7,NULL) RETURNING id`,
        [comp.organization_id, comp.company_id, comp.employee_id, comp.planned_date,
         -comp.minutes, comp.description || 'Compensação de horas', comp.id]
      );
      executed_entry_id = ent.rows[0].id;
    }
    if (status === 'cancelled' && executed_entry_id) {
      await query(`DELETE FROM time_bank_entries WHERE id = $1`, [executed_entry_id]);
      executed_entry_id = null;
    }
    const r = await query(
      `UPDATE time_bank_compensations
          SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW(), executed_entry_id = $4
        WHERE id = $5 RETURNING *`,
      [status, review_note || null, req.userId, executed_entry_id, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.tb.comp.patch', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/time-bank/compensations/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const cur = await query(
      `SELECT executed_entry_id FROM time_bank_compensations WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId]
    );
    if (cur.rows[0]?.executed_entry_id) {
      await query(`DELETE FROM time_bank_entries WHERE id = $1`, [cur.rows[0].executed_entry_id]);
    }
    await query(`DELETE FROM time_bank_compensations WHERE id = $1 AND organization_id = $2 AND status = 'pending'`,
      [req.params.id, orgId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ============================================
// FASE 8: ESPELHO DIGITAL COM ACEITE
// ============================================


async function buildMirrorSnapshot({ orgId, employeeId, start, end }) {
  const emp = await query(
    `SELECT e.id, e.full_name, e.cpf, e.registration_number, e.position,
            c.trade_name AS company_name
       FROM employees e
       LEFT JOIN companies c ON c.id = e.company_id
      WHERE e.id = $1 AND e.organization_id = $2`,
    [employeeId, orgId]
  );
  if (!emp.rowCount) throw new Error('Colaborador não encontrado');
  const rows = await buildEmployeesReport({ orgId, start, end, employeeId });
  const totals = rows[0] || {};
  return {
    employee: emp.rows[0],
    period: { start, end },
    totals: {
      worked_min: totals.worked_min || 0,
      expected_min: totals.expected_min || 0,
      overtime_min: totals.overtime_min || 0,
      night_min: totals.night_min || 0,
      credit_min: totals.credit_min || 0,
      debit_min: totals.debit_min || 0,
      balance_min: totals.balance_min || 0,
      absences: totals.absences || 0,
      lates: totals.lates || 0,
    },
    days: (totals.detail || []),
  };
}

// GET /mirror-acceptance?month=YYYY-MM&status=&company_id=
router.get('/mirror-acceptance', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { month, status, company_id, employee_id } = req.query;
    const filters = ['m.organization_id = $1'];
    const params = [orgId];
    if (month) { params.push(month); filters.push(`m.reference_month = $${params.length}`); }
    if (status) { params.push(status); filters.push(`m.status = $${params.length}`); }
    if (company_id) { params.push(company_id); filters.push(`m.company_id = $${params.length}`); }
    if (employee_id) { params.push(employee_id); filters.push(`m.employee_id = $${params.length}`); }
    const r = await query(
      `SELECT m.*, e.full_name, e.registration_number, e.cpf,
              u.name AS generated_by_name
         FROM time_mirror_acceptances m
         JOIN employees e ON e.id = m.employee_id
         LEFT JOIN users u ON u.id = m.generated_by
        WHERE ${filters.join(' AND ')}
        ORDER BY m.reference_month DESC, e.full_name`,
      params
    );
    res.json(r.rows);
  } catch (err) { logError('timeclock.mirror.list', err); res.status(500).json({ error: 'Erro' }); }
});

// GET /mirror-acceptance/:id
router.get('/mirror-acceptance/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const r = await query(
      `SELECT m.*, e.full_name, e.cpf, e.registration_number
         FROM time_mirror_acceptances m
         JOIN employees e ON e.id = m.employee_id
        WHERE m.id = $1 AND m.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// POST /mirror-acceptance/generate — gera espelhos para colaboradores do mês
router.post('/mirror-acceptance/generate', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { reference_month, company_id, employee_ids } = req.body || {};
    if (!reference_month || !/^\d{4}-\d{2}$/.test(reference_month)) {
      return res.status(400).json({ error: 'reference_month (YYYY-MM) obrigatório' });
    }
    const [y, m] = reference_month.split('-').map(Number);
    const periodStart = `${reference_month}-01`;
    const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

    let empList;
    if (Array.isArray(employee_ids) && employee_ids.length) {
      empList = { rows: employee_ids.map(id => ({ id })) };
    } else {
      const params = [orgId];
      let filter = 'organization_id = $1 AND status = \'ativo\'';
      if (company_id) { params.push(company_id); filter += ` AND company_id = $2`; }
      empList = await query(`SELECT id FROM employees WHERE ${filter}`, params);
    }

    let created = 0, skipped = 0;
    for (const e of empList.rows) {
      const existing = await query(
        `SELECT id, status FROM time_mirror_acceptances
          WHERE employee_id = $1 AND reference_month = $2`,
        [e.id, reference_month]
      );
      if (existing.rowCount && existing.rows[0].status !== 'rejected') {
        skipped++;
        continue;
      }
      try {
        const snap = await buildMirrorSnapshot({ orgId, employeeId: e.id, start: periodStart, end: periodEnd });
        if (existing.rowCount) {
          await query(
            `UPDATE time_mirror_acceptances
                SET snapshot_json = $1::jsonb, totals_json = $2::jsonb,
                    status = 'pending', period_start = $3, period_end = $4,
                    generated_by = $5, generated_at = NOW(),
                    accepted_at = NULL, rejected_at = NULL, rejection_reason = NULL,
                    signature_hash = NULL, signature_ip = NULL, device_info = NULL
              WHERE id = $6`,
            [JSON.stringify(snap), JSON.stringify(snap.totals), periodStart, periodEnd, req.userId, existing.rows[0].id]
          );
        } else {
          const empRow = await query(`SELECT company_id FROM employees WHERE id = $1`, [e.id]);
          await query(
            `INSERT INTO time_mirror_acceptances
               (organization_id, company_id, employee_id, reference_month, period_start, period_end,
                snapshot_json, totals_json, generated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
            [orgId, empRow.rows[0]?.company_id || null, e.id, reference_month,
             periodStart, periodEnd, JSON.stringify(snap), JSON.stringify(snap.totals), req.userId]
          );
        }
        created++;
        try {
          await notifyEmployee(orgId, e.id,
            'Espelho de Ponto disponível',
            `Seu espelho de ${reference_month} está disponível para conferência e aceite`,
            'espelho', 'mirror', null);
        } catch {}
      } catch (err) {
        logError('timeclock.mirror.generate.item', err, { employee_id: e.id });
      }
    }
    res.json({ ok: true, created, skipped, total: empList.rows.length });
  } catch (err) { logError('timeclock.mirror.generate', err); res.status(500).json({ error: 'Erro ao gerar espelhos' }); }
});

// DELETE /mirror-acceptance/:id (só permite excluir pending)
router.delete('/mirror-acceptance/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const r = await query(
      `DELETE FROM time_mirror_acceptances
        WHERE id = $1 AND organization_id = $2 AND status IN ('pending','rejected')`,
      [req.params.id, orgId]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// Helper compartilhado (usado por promotor.js)
export async function signMirrorAcceptance({ orgId, mirrorId, employeeId, action, comments, reason, ip, device }) {
  const cur = await query(
    `SELECT * FROM time_mirror_acceptances
      WHERE id = $1 AND organization_id = $2 AND employee_id = $3`,
    [mirrorId, orgId, employeeId]
  );
  if (!cur.rowCount) throw new Error('Espelho não encontrado');
  const mirror = cur.rows[0];
  if (mirror.status === 'accepted') throw new Error('Espelho já aceito');

  if (action === 'accept') {
    const payload = JSON.stringify({
      id: mirror.id, employee_id: employeeId, ref: mirror.reference_month,
      snapshot: mirror.snapshot_json, accepted_at: new Date().toISOString(),
    });
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const r = await query(
      `UPDATE time_mirror_acceptances
          SET status = 'accepted', accepted_at = NOW(),
              employee_comments = $1, signature_hash = $2,
              signature_ip = $3, device_info = $4::jsonb
        WHERE id = $5 RETURNING *`,
      [comments || null, hash, ip || null, device ? JSON.stringify(device) : null, mirrorId]
    );
    return r.rows[0];
  }
  if (action === 'reject') {
    if (!reason) throw new Error('Motivo obrigatório');
    const r = await query(
      `UPDATE time_mirror_acceptances
          SET status = 'rejected', rejected_at = NOW(), rejection_reason = $1
        WHERE id = $2 RETURNING *`,
      [reason, mirrorId]
    );
    return r.rows[0];
  }
  throw new Error('Ação inválida');
}


// ============================================
// FERIADOS
// ============================================
router.get('/holidays', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { company_id, year } = req.query;
    let sql = `SELECT h.*, c.trade_name AS company_name FROM holidays h
               LEFT JOIN companies c ON c.id = h.company_id
               WHERE h.organization_id = $1`;
    const params = [orgId];
    let i = 2;
    if (company_id) { sql += ` AND (h.company_id = $${i++} OR h.company_id IS NULL)`; params.push(company_id); }
    if (year) { sql += ` AND EXTRACT(YEAR FROM h.holiday_date) = $${i++}`; params.push(year); }
    sql += ` ORDER BY h.holiday_date`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('timeclock.holidays.get', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/holidays', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { holiday_date, description, scope, company_id } = req.body || {};
    if (!holiday_date || !description) return res.status(400).json({ error: 'Dados obrigatórios' });
    const r = await query(
      `INSERT INTO holidays (organization_id, company_id, holiday_date, description, scope)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, COALESCE(company_id::text,''), holiday_date)
       DO UPDATE SET description = EXCLUDED.description, scope = EXCLUDED.scope
       RETURNING *`,
      [orgId, company_id || null, holiday_date, description, scope || 'nacional']
    );
    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.holidays.post', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/holidays/:id', async (req, res) => {
  try { await query(`DELETE FROM holidays WHERE id = $1`, [req.params.id]); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// Importar feriados nacionais brasileiros para o ano
router.post('/holidays/import-national', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { year, company_id } = req.body || {};
    const y = parseInt(year, 10) || new Date().getFullYear();
    // Datas fixas nacionais
    const nationals = [
      [`${y}-01-01`, 'Confraternização Universal'],
      [`${y}-04-21`, 'Tiradentes'],
      [`${y}-05-01`, 'Dia do Trabalho'],
      [`${y}-09-07`, 'Independência do Brasil'],
      [`${y}-10-12`, 'Nossa Senhora Aparecida'],
      [`${y}-11-02`, 'Finados'],
      [`${y}-11-15`, 'Proclamação da República'],
      [`${y}-12-25`, 'Natal'],
    ];
    // Móveis (Páscoa - algoritmo)
    const easter = calcEaster(y);
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    nationals.push([addDays(easter, -48), 'Carnaval']);
    nationals.push([addDays(easter, -47), 'Carnaval']);
    nationals.push([addDays(easter, -2), 'Sexta-feira Santa']);
    nationals.push([addDays(easter, 60), 'Corpus Christi']);

    let inserted = 0;
    for (const [date, desc] of nationals) {
      await query(
        `INSERT INTO holidays (organization_id, company_id, holiday_date, description, scope)
         VALUES ($1,$2,$3,$4,'nacional')
         ON CONFLICT (organization_id, COALESCE(company_id::text,''), holiday_date) DO NOTHING`,
        [orgId, company_id || null, date, desc]
      );
      inserted++;
    }
    res.json({ ok: true, count: inserted });
  } catch (err) { logError('timeclock.holidays.import', err); res.status(500).json({ error: 'Erro' }); }
});

function calcEaster(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ============================================
// SOLICITAÇÕES DE AJUSTE (colaborador → RH)
// ============================================
router.get('/adjustment-requests', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { status, employee_id } = req.query;
    let sql = `SELECT par.*, e.full_name AS employee_name, e.photo_url,
                      u.name AS reviewer_name, c.trade_name AS company_name
               FROM punch_adjustment_requests par
               JOIN employees e ON e.id = par.employee_id
               LEFT JOIN users u ON u.id = par.reviewed_by
               LEFT JOIN companies c ON c.id = par.company_id
               WHERE par.organization_id = $1`;
    const params = [orgId]; let i = 2;
    if (status) { sql += ` AND par.status = $${i++}`; params.push(status); }
    if (employee_id) { sql += ` AND par.employee_id = $${i++}`; params.push(employee_id); }
    sql += ` ORDER BY par.created_at DESC LIMIT 200`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('timeclock.adj.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.patch('/adjustment-requests/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { status, review_note } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const cur = await query(`SELECT * FROM punch_adjustment_requests WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Solicitação não encontrada' });
    const reqRow = cur.rows[0];
    const dateStr = new Date(reqRow.punch_date).toISOString().slice(0, 10);

    if (status === 'approved' && await isPeriodClosed(orgId, reqRow.employee_id, dateStr)) {
      return res.status(423).json({ error: 'Período fechado — reabra para aprovar.', code: 'PERIOD_CLOSED' });
    }

    await query(
      `UPDATE punch_adjustment_requests SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW() WHERE id = $4`,
      [status, review_note || null, req.userId, req.params.id]
    );

    // Se aprovado, aplicar batidas
    if (status === 'approved' && reqRow.requested_times) {
      const times = String(reqRow.requested_times).split(',').map(s => s.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t)).slice(0, 8);
      await query(`DELETE FROM time_punches WHERE employee_id = $1 AND (punched_at AT TIME ZONE 'America/Sao_Paulo')::date = $2::date`, [reqRow.employee_id, dateStr]);
      for (let idx = 0; idx < times.length; idx++) {
        const t = times[idx];
        const punchType = idx === 0 ? 'entrada' : (idx === times.length - 1 ? 'saida' : (idx % 2 === 1 ? 'saida_intervalo' : 'retorno_intervalo'));
        await query(
          `INSERT INTO time_punches (organization_id, employee_id, punch_type, punched_at, source, edited_by, edited_at, justification)
           VALUES ($1, $2, $3, (($4::date + $5::time) AT TIME ZONE 'America/Sao_Paulo'), 'request', $6, NOW(), $7)`,
          [orgId, reqRow.employee_id, punchType, dateStr, t + ':00', req.userId, reqRow.justification]
        );
      }
      await query(
        `INSERT INTO punch_edit_log (organization_id, employee_id, punch_date, action, field_name, new_value, reason, edited_by)
         VALUES ($1,$2,$3,'request_approved','times',$4,$5,$6)`,
        [orgId, reqRow.employee_id, dateStr, times.join(', '), reqRow.justification, req.userId]
      );
      await recalcEmployeePeriod({ organizationId: orgId, employeeId: reqRow.employee_id, startDate: dateStr, endDate: dateStr });
    }

    // Notificar colaborador
    await notifyEmployee(orgId, reqRow.employee_id,
      status === 'approved' ? 'Ajuste de ponto aprovado' : 'Ajuste de ponto reprovado',
      `Data ${dateStr}${review_note ? ' — ' + review_note : ''}`,
      'ponto_ajuste', 'adjustment', req.params.id);

    res.json({ ok: true });
  } catch (err) { logError('timeclock.adj.patch', err); res.status(500).json({ error: 'Erro ao processar solicitação' }); }
});

// ============================================
// FECHAMENTO DE PERÍODO
// ============================================
router.get('/closings', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const r = await query(
      `SELECT tpc.*, c.trade_name AS company_name, u.name AS closed_by_name
       FROM time_period_closings tpc
       LEFT JOIN companies c ON c.id = tpc.company_id
       LEFT JOIN users u ON u.id = tpc.closed_by
       WHERE tpc.organization_id = $1
       ORDER BY tpc.period_end DESC LIMIT 50`, [orgId]);
    res.json(r.rows);
  } catch (err) { logError('timeclock.closings.get', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/closings', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { period_start, period_end, company_id, notes } = req.body || {};
    if (!period_start || !period_end) return res.status(400).json({ error: 'Período obrigatório' });
    const r = await query(
      `INSERT INTO time_period_closings (organization_id, company_id, period_start, period_end, closed_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [orgId, company_id || null, period_start, period_end, req.userId, notes || null]
    );

    // Notifica colaboradores afetados
    try {
      const empQ = company_id
        ? await query(`SELECT id FROM employees WHERE organization_id = $1 AND company_id = $2 AND status = 'ativo'`, [orgId, company_id])
        : await query(`SELECT id FROM employees WHERE organization_id = $1 AND status = 'ativo'`, [orgId]);
      for (const e of empQ.rows) {
        await notifyEmployee(orgId, e.id, 'Período de ponto fechado',
          `Espelho de ${period_start} a ${period_end} foi encerrado pelo RH.`,
          'ponto_fechamento', 'closing', r.rows[0].id);
      }
    } catch (e) { logError('timeclock.closings.notify', e); }

    res.json(r.rows[0]);
  } catch (err) { logError('timeclock.closings.post', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/closings/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    await query(`DELETE FROM time_period_closings WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    res.json({ ok: true });
  } catch (err) { logError('timeclock.closings.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// ============================================
// RELATÓRIOS OPERACIONAIS
// ============================================
async function buildEmployeesReport({ orgId, companyId, start, end, employeeId }) {
  const params = [orgId];
  let sql = `SELECT id, full_name, cpf, registration_number, company_id
             FROM employees WHERE organization_id = $1 AND status = 'ativo'`;
  let i = 2;
  if (companyId) { sql += ` AND company_id = $${i++}`; params.push(companyId); }
  if (employeeId) { sql += ` AND id = $${i++}`; params.push(employeeId); }
  sql += ` ORDER BY full_name`;
  const emps = (await query(sql, params)).rows;

  const rows = [];
  for (const emp of emps) {
    let result = { days: [] };
    try {
      result = await recalcEmployeePeriod({ organizationId: orgId, employeeId: emp.id, startDate: start, endDate: end });
    } catch (err) { logError('reports.recalc', err); }

    let workedMin = 0, expectedMin = 0, overtimeMin = 0, overtimeBonusMin = 0;
    let nightMin = 0, nightBonusMin = 0, creditMin = 0, debitMin = 0;
    let absences = 0, lates = 0, incomplete = 0, holidaysWorked = 0, sundaysWorked = 0, dsrLost = 0;
    const detail = [];

    for (const d of result.days || []) {
      workedMin += d.total_worked_min || 0;
      expectedMin += d.expected_min || 0;
      overtimeMin += d.overtime_min || 0;
      overtimeBonusMin += d.overtime_bonus_min || 0;
      nightMin += d.night_min || 0;
      nightBonusMin += d.night_bonus_min || 0;
      creditMin += d.credit_min || 0;
      debitMin += d.debit_min || 0;
      if (d.status === 'falta') absences++;
      if (d.status === 'atraso') lates++;
      if (d.odd_punch) incomplete++;
      if (d.is_holiday && (d.total_worked_min || 0) > 0) holidaysWorked++;
      if (d.is_sunday && (d.total_worked_min || 0) > 0) sundaysWorked++;
      if (d.dsr_lost) dsrLost++;
      if (['falta', 'atraso'].includes(d.status) || d.odd_punch) {
        detail.push({
          date: d.date, status: d.status, odd_punch: !!d.odd_punch,
          worked_min: d.total_worked_min || 0, expected_min: d.expected_min || 0,
          balance_min: d.balance_min || 0,
        });
      }
    }

    const tbBal = await query(
      `SELECT COALESCE(SUM(minutes),0)::int AS bal FROM time_bank_entries WHERE employee_id = $1`,
      [emp.id]
    );

    rows.push({
      employee_id: emp.id, full_name: emp.full_name, cpf: emp.cpf,
      registration_number: emp.registration_number,
      worked_min: workedMin, expected_min: expectedMin,
      overtime_min: overtimeMin, overtime_bonus_min: overtimeBonusMin,
      night_min: nightMin, night_bonus_min: nightBonusMin,
      credit_min: creditMin, debit_min: debitMin,
      balance_min: workedMin - expectedMin,
      tb_balance_min: tbBal.rows[0]?.bal || 0,
      absences, lates, incomplete, holidays_worked: holidaysWorked,
      sundays_worked: sundaysWorked, dsr_lost: dsrLost,
      detail,
    });
  }
  return rows;
}

// Extrato consolidado (banco de horas + horas do período)
router.get('/reports/summary', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { start, end, company_id, employee_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Período obrigatório' });
    const rows = await buildEmployeesReport({ orgId, companyId: company_id, start, end, employeeId: employee_id });
    res.json({ start, end, rows });
  } catch (err) { logError('reports.summary', err); res.status(500).json({ error: 'Erro ao gerar relatório' }); }
});

// Faltas e atrasos detalhado
router.get('/reports/absences-lates', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { start, end, company_id, employee_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Período obrigatório' });
    const rows = await buildEmployeesReport({ orgId, companyId: company_id, start, end, employeeId: employee_id });
    const items = [];
    for (const r of rows) {
      for (const d of r.detail) {
        items.push({
          employee_id: r.employee_id, full_name: r.full_name, cpf: r.cpf,
          registration_number: r.registration_number, ...d,
        });
      }
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.full_name.localeCompare(b.full_name)));
    res.json({ start, end, items });
  } catch (err) { logError('reports.abslates', err); res.status(500).json({ error: 'Erro' }); }
});

// Extrato banco de horas por colaborador (movimentações)
router.get('/reports/time-bank-statement', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, start, end } = req.query;
    if (!employee_id || !start || !end) return res.status(400).json({ error: 'Parâmetros obrigatórios' });
    const r = await query(
      `SELECT tb.*, u.name AS created_by_name
       FROM time_bank_entries tb
       LEFT JOIN users u ON u.id = tb.created_by
       WHERE tb.organization_id = $1 AND tb.employee_id = $2 AND tb.entry_date BETWEEN $3 AND $4
       ORDER BY tb.entry_date, tb.created_at`,
      [orgId, employee_id, start, end]
    );
    const prev = await query(
      `SELECT COALESCE(SUM(minutes),0)::int AS bal FROM time_bank_entries
       WHERE employee_id = $1 AND entry_date < $2`,
      [employee_id, start]
    );
    res.json({ opening_min: prev.rows[0]?.bal || 0, entries: r.rows });
  } catch (err) { logError('reports.tb.statement', err); res.status(500).json({ error: 'Erro' }); }
});

function toCsv(headers, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\r\n');
}
const minToHours = (min) => (Math.round((min || 0) / 60 * 100) / 100).toFixed(2).replace('.', ',');

// Export CSV para folha
router.get('/reports/payroll.csv', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { start, end, company_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Período obrigatório' });
    const rows = await buildEmployeesReport({ orgId, companyId: company_id, start, end });
    const headers = [
      'Matricula', 'CPF', 'Colaborador', 'Horas Trabalhadas', 'Horas Previstas',
      'HE 50%', 'Adic. HE 50%', 'Adic. Noturno', 'Horas Noturnas',
      'Domingos Trab.', 'Feriados Trab.', 'DSR Perdidos',
      'Faltas', 'Atrasos', 'Incompletos', 'Saldo Periodo', 'Saldo Banco Horas'
    ];
    const csvRows = rows.map(r => [
      r.registration_number || '', r.cpf || '', r.full_name,
      minToHours(r.worked_min), minToHours(r.expected_min),
      minToHours(r.overtime_min), minToHours(r.overtime_bonus_min),
      minToHours(r.night_bonus_min), minToHours(r.night_min),
      r.sundays_worked, r.holidays_worked, r.dsr_lost,
      r.absences, r.lates, r.incomplete,
      minToHours(r.balance_min), minToHours(r.tb_balance_min),
    ]);
    const csv = '\uFEFF' + toCsv(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="folha-${start}_${end}.csv"`);
    res.send(csv);
  } catch (err) { logError('reports.payroll.csv', err); res.status(500).json({ error: 'Erro ao gerar CSV' }); }
});

// Export CSV faltas/atrasos
router.get('/reports/absences-lates.csv', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { start, end, company_id, employee_id } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Período obrigatório' });
    const rows = await buildEmployeesReport({ orgId, companyId: company_id, start, end, employeeId: employee_id });
    const items = [];
    for (const r of rows) for (const d of r.detail) items.push({ ...r, ...d });
    const headers = ['Data', 'Matricula', 'CPF', 'Colaborador', 'Status', 'Batidas Impares', 'Trabalhado', 'Previsto', 'Saldo'];
    const csvRows = items.map(it => [
      it.date, it.registration_number || '', it.cpf || '', it.full_name,
      it.status, it.odd_punch ? 'Sim' : 'Nao',
      minToHours(it.worked_min), minToHours(it.expected_min), minToHours(it.balance_min),
    ]);
    const csv = '\uFEFF' + toCsv(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="faltas-atrasos-${start}_${end}.csv"`);
    res.send(csv);
  } catch (err) { logError('reports.abslates.csv', err); res.status(500).json({ error: 'Erro' }); }
});

// ==== ESPELHO DE PONTO (PDF) - RH ====
import { generateMirrorPDF, generateReceiptPDF } from '../services/receipt-pdf.js';

router.get('/mirror.pdf', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { employee_id, start, end } = req.query;
    if (!employee_id || !start || !end) return res.status(400).json({ error: 'Parâmetros obrigatórios' });
    const bytes = await generateMirrorPDF({ organizationId: orgId, employeeId: employee_id, startDate: start, endDate: end });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="espelho-${employee_id}-${start}_${end}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) { logError('timeclock.mirror.pdf', err); res.status(500).json({ error: err.message || 'Erro ao gerar espelho' }); }
});

router.get('/receipt/:punchId.pdf', async (req, res) => {
  try {
    const bytes = await generateReceiptPDF(req.params.punchId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="comprovante-${req.params.punchId}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (err) { logError('timeclock.receipt.pdf', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// ============ AFD / AEJ (Portaria 671/2021 - Compliance) ============
import { generateAFD, generateAEJ } from '../services/afd-generator.js';

router.get('/afd.txt', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { company_id, employee_id, start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start e end são obrigatórios' });
    await ensureSchema();
    const { content, filename } = await generateAFD({
      organizationId: orgId, companyId: company_id || null,
      employeeId: employee_id || null, startDate: start, endDate: end,
    });
    res.setHeader('Content-Type', 'text/plain; charset=us-ascii');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) { logError('timeclock.afd', err); res.status(500).json({ error: err.message || 'Erro ao gerar AFD' }); }
});

router.get('/aej.txt', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    const { company_id, employee_id, start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start e end são obrigatórios' });
    await ensureSchema();
    const { content, filename } = await generateAEJ({
      organizationId: orgId, companyId: company_id || null,
      employeeId: employee_id || null, startDate: start, endDate: end,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) { logError('timeclock.aej', err); res.status(500).json({ error: err.message || 'Erro ao gerar AEJ' }); }
});

export default router;


