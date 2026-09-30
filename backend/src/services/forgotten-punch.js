import { query } from '../db.js';
import { parseWorkSchedule } from './point-calculator.js';

export async function ensureForgottenPunchSchema() {
  await query(`CREATE TABLE IF NOT EXISTS forgotten_punch_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, alert_date DATE NOT NULL,
    entry_index INTEGER NOT NULL, expected_at TIMESTAMPTZ NOT NULL, kind VARCHAR(20) NOT NULL DEFAULT 'missing',
    status VARCHAR(20) NOT NULL DEFAULT 'open', metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ,
    UNIQUE (organization_id, employee_id, alert_date, entry_index, kind)
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_forgotten_punch_alerts_org ON forgotten_punch_alerts(organization_id, alert_date, status)`);
}

const spDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const minutes = t => { const [h,m] = String(t).split(':').map(Number); return h * 60 + m; };

export async function scanForgottenPunches({ organizationId, date = spDate(new Date()), now = new Date(), graceMinutes = 15 } = {}) {
  await ensureForgottenPunchSchema();
  const employees = await query(`SELECT e.id, e.full_name, e.work_schedule, ws.schedule_json, ws.kind, ws.cycle_pattern, ws.cycle_start_date
    FROM employees e LEFT JOIN work_schedules ws ON ws.id = e.work_schedule_id
    WHERE e.organization_id = $1 AND COALESCE(e.status, 'active') NOT IN ('inactive','terminated')`, [organizationId]);
  let created = 0;
  for (const employee of employees.rows) {
    const schedule = employee.work_schedule_id ? { schedule_json: employee.schedule_json, kind: employee.kind, cycle_pattern: employee.cycle_pattern, cycle_start_date: employee.cycle_start_date } : employee.work_schedule;
    const dow = new Date(`${date}T12:00:00-03:00`).getDay();
    const planned = parseWorkSchedule(schedule, dow, date);
    const punches = await query(`SELECT punched_at FROM time_punches WHERE employee_id=$1 AND (punched_at AT TIME ZONE 'America/Sao_Paulo')::date=$2::date ORDER BY punched_at`, [employee.id, date]);
    const punchTimes = punches.rows.map(p => new Date(p.punched_at).getTime());
    for (let i = 0; i < planned.entries.length; i++) {
      const entry = planned.entries[i];
      const expected = new Date(`${date}T${entry.start}:00-03:00`);
      if (expected.getTime() + graceMinutes * 60000 > now.getTime()) continue;
      const window = punchTimes.some(t => Math.abs(t - expected.getTime()) <= 3 * 3600000);
      if (!window) {
        const r = await query(`INSERT INTO forgotten_punch_alerts (organization_id,employee_id,alert_date,entry_index,expected_at,metadata)
          VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id,employee_id,alert_date,entry_index,kind) DO NOTHING RETURNING id`,
          [organizationId, employee.id, date, i, expected.toISOString(), JSON.stringify({ employee_name: employee.full_name, expected: entry.start })]);
        created += r.rowCount;
      }
    }
  }
  return { organizationId, date, created };
}

export async function listForgottenPunchAlerts({ organizationId, start, end, status } = {}) {
  await ensureForgottenPunchSchema();
  const r = await query(`SELECT a.*, e.full_name FROM forgotten_punch_alerts a JOIN employees e ON e.id=a.employee_id
    WHERE a.organization_id=$1 AND a.alert_date BETWEEN COALESCE($2::date, CURRENT_DATE-30) AND COALESCE($3::date, CURRENT_DATE)
    AND ($4::text IS NULL OR a.status=$4) ORDER BY a.alert_date DESC, e.full_name`, [organizationId, start || null, end || null, status || null]);
  return r.rows;
}

export async function resolveForgottenPunchAlert(id, organizationId) {
  const r = await query(`UPDATE forgotten_punch_alerts SET status='resolved', resolved_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING *`, [id, organizationId]);
  return r.rows[0];
}
