import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { callAI } from '../lib/ai-caller.js';
import { logInfo, logError } from '../logger.js';
import {
  ensureHistoryTables, recordEvent, openPeriod, closePeriod, getOpenPeriod, trackEmployeeChanges,
} from '../lib/rh-history.js';



const router = express.Router();
router.use(authenticate);

const BR_GEOCODE_USER_AGENT = 'Ayratech/1.0 (suporte@ayratech.app.br)';

function splitAddressAndNumber(address = '') {
  const normalized = String(address || '').trim().replace(/\s+/g, ' ');
  const match = normalized.match(/^(.*?)(?:,\s*|\s+)(?:n[ºo°.]?\s*)?(\d{1,6}[a-zA-Z]?)\s*$/i);
  if (!match) return { street: normalized, number: '' };
  return {
    street: String(match[1] || '').trim().replace(/,$/, ''),
    number: String(match[2] || '').trim(),
  };
}

function normalizeGeocodeInput({ address, address_number, complement, neighborhood, city, state, zip_code, requireComplete = false }) {
  const parsed = splitAddressAndNumber(address);
  const cleanZip = String(zip_code || '').replace(/\D/g, '');
  const street = String(parsed.street || '').trim();
  const number = String(address_number || parsed.number || '').trim();
  const normalized = {
    street,
    number,
    complement: String(complement || '').trim(),
    neighborhood: String(neighborhood || '').trim(),
    city: String(city || '').trim(),
    state: String(state || '').trim().toUpperCase(),
    cleanZip,
  };

  if (requireComplete) {
    if (!street || !number || !normalized.neighborhood || !normalized.city || !normalized.state || cleanZip.length !== 8) {
      return {
        normalized,
        validationError: 'Endereço incompleto: informe rua, número, bairro, cidade, UF e CEP válido (8 dígitos).',
      };
    }
  }

  return { normalized, validationError: null };
}

function buildGeocodeCandidates(normalized) {
  const { street, number, complement, neighborhood, city, state, cleanZip } = normalized;
  const streetWithNumber = [street, number].filter(Boolean).join(', ');
  const streetWithComplement = [streetWithNumber, complement].filter(Boolean).join(', ');

  return [
    [streetWithComplement, neighborhood, `${city} - ${state}`, cleanZip, 'Brasil'].filter(Boolean).join(', '),
    [streetWithComplement, neighborhood, city, state, cleanZip, 'Brasil'].filter(Boolean).join(', '),
    [streetWithComplement, neighborhood, city, state, 'Brasil'].filter(Boolean).join(', '),
    [streetWithNumber, neighborhood, `${city} - ${state}`, cleanZip, 'Brasil'].filter(Boolean).join(', '),
    [streetWithNumber, neighborhood, city, state, cleanZip, 'Brasil'].filter(Boolean).join(', '),
    [streetWithNumber, neighborhood, city, state, 'Brasil'].filter(Boolean).join(', '),
    [street, neighborhood, city, state, cleanZip, 'Brasil'].filter(Boolean).join(', '),
  ].filter((candidate, index, arr) => candidate && arr.indexOf(candidate) === index);
}

async function geocodeAddressWithFallback(input, options = {}) {
  const { requireComplete = false } = options;
  const { normalized, validationError } = normalizeGeocodeInput({ ...input, requireComplete });
  const candidates = buildGeocodeCandidates(normalized);

  if (validationError) {
    return {
      geo: null,
      validationError,
      attemptedAddress: candidates[0] || [normalized.street, normalized.number, normalized.complement, normalized.neighborhood, normalized.city, normalized.state, normalized.cleanZip, 'Brasil'].filter(Boolean).join(', '),
    };
  }

  for (const candidate of candidates) {
    try {
      const q = encodeURIComponent(candidate);
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${q}`;
      const res = await fetch(url, { headers: { 'User-Agent': BR_GEOCODE_USER_AGENT } });
      const data = await res.json();
      if (Array.isArray(data) && data[0]) {
        return {
          geo: {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon),
            display_name: data[0].display_name,
          },
          validationError: null,
          attemptedAddress: candidate,
        };
      }
    } catch (_) {}
  }

  return { geo: null, validationError: null, attemptedAddress: candidates[0] || '' };
}

// Auto-geocode using canonical Brazilian address + Nominatim
async function autoGeocodeAddress(address, city, state, zip_code, neighborhood, address_number = null, complement = null) {
  const result = await geocodeAddressWithFallback({ address, address_number, complement, neighborhood, city, state, zip_code });
  return result.geo;
}

let holidaysInfraPromise = null;
const seededHolidayYears = new Set();

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function formatHolidayDate(year, month, day) {
  return `${year}-${padDatePart(month)}-${padDatePart(day)}`;
}

function calculateEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function toIsoDate(date) {
  return formatHolidayDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getBrazilNationalHolidays(year) {
  const safeYear = Number(year);
  if (!Number.isInteger(safeYear) || safeYear < 2000 || safeYear > 2100) {
    return [];
  }

  const easterSunday = calculateEasterSunday(safeYear);
  const goodFriday = addUtcDays(easterSunday, -2);

  return [
    { name: 'Confraternização Universal', holiday_date: formatHolidayDate(safeYear, 1, 1), type: 'nacional', recurring: true },
    { name: 'Paixão de Cristo', holiday_date: toIsoDate(goodFriday), type: 'nacional', recurring: false },
    { name: 'Tiradentes', holiday_date: formatHolidayDate(safeYear, 4, 21), type: 'nacional', recurring: true },
    { name: 'Dia do Trabalho', holiday_date: formatHolidayDate(safeYear, 5, 1), type: 'nacional', recurring: true },
    { name: 'Independência do Brasil', holiday_date: formatHolidayDate(safeYear, 9, 7), type: 'nacional', recurring: true },
    { name: 'Nossa Senhora Aparecida', holiday_date: formatHolidayDate(safeYear, 10, 12), type: 'nacional', recurring: true },
    { name: 'Finados', holiday_date: formatHolidayDate(safeYear, 11, 2), type: 'nacional', recurring: true },
    { name: 'Proclamação da República', holiday_date: formatHolidayDate(safeYear, 11, 15), type: 'nacional', recurring: true },
    { name: 'Natal', holiday_date: formatHolidayDate(safeYear, 12, 25), type: 'nacional', recurring: true },
  ];
}

async function ensureHolidaysInfrastructure() {
  if (!holidaysInfraPromise) {
    holidaysInfraPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS holidays (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          holiday_date DATE NOT NULL,
          type VARCHAR(20) DEFAULT 'nacional',
          state VARCHAR(2),
          city VARCHAR(100),
          recurring BOOLEAN DEFAULT true,
          active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS holiday_date DATE`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'nacional'`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS state VARCHAR(2)`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS city VARCHAR(100)`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT true`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
      await query(`CREATE INDEX IF NOT EXISTS idx_holidays_org ON holidays(organization_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_holidays_type ON holidays(type)`);
      await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_org_name_date ON holidays(organization_id, name, holiday_date)`);
    })().catch((error) => {
      holidaysInfraPromise = null;
      throw error;
    });
  }

  return holidaysInfraPromise;
}

async function seedNationalHolidays(orgId, year) {
  const safeYear = Number(year);
  const holidays = getBrazilNationalHolidays(safeYear);
  if (!orgId || !holidays.length) {
    return;
  }

  const cacheKey = `${orgId}:${safeYear}`;
  if (seededHolidayYears.has(cacheKey)) {
    return;
  }

  await Promise.all(
    holidays.map((holiday) =>
      query(
        `INSERT INTO holidays (organization_id, name, holiday_date, type, state, city, recurring, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (organization_id, name, holiday_date) DO NOTHING`,
        [orgId, holiday.name, holiday.holiday_date, holiday.type, null, null, holiday.recurring]
      )
    )
  );

  seededHolidayYears.add(cacheKey);
}

router.use('/holidays', async (req, res, next) => {
  try {
    await ensureHolidaysInfrastructure();

    if (req.method === 'GET') {
      const orgId = req.query.org_id || await getUserOrgId(req.userId);
      const requestedYear = Number(req.query.year || new Date().getFullYear());
      if (orgId && Number.isInteger(requestedYear)) {
        await seedNationalHolidays(orgId, requestedYear);
      }
    }

    next();
  } catch (err) {
    logError('rh.holidays.bootstrap', err, { user_id: req.userId, path: req.path, method: req.method });
    res.status(500).json({ error: err?.message || 'Erro ao inicializar feriados' });
  }
});

let employeeExtraColsReady = false;
async function ensureEmployeeExtraColumns() {
  if (employeeExtraColsReady) return;
  try {
    // Colunas usadas diretamente pelo INSERT/UPDATE principal do cadastro/importação.
    // Mantém compatibilidade com bancos antigos/remixados antes das migrations completas.
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_number VARCHAR(10)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pix_key VARCHAR(255)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS pix_key_type VARCHAR(20)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_items JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_latitude NUMERIC(10,7)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_longitude NUMERIC(10,7)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS voter_zone VARCHAR(20)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS voter_section VARCHAR(20)`);
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS skin_color VARCHAR(50)`);
    // facial_required: null = segue config da organização; true = sempre exigir; false = dispensado
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS facial_required BOOLEAN`);
    employeeExtraColsReady = true;
  } catch (e) {
    logError('rh.employees.ensureExtraCols', e);
  }
}

router.use('/employees', async (req, _res, next) => {
  await ensureEmployeeExtraColumns();
  next();
});

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeKey(value) {
  return stripAccents(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseBrazilianNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  let s = raw.replace(/[^\d,.-]/g, '');
  if (!s || s === '-' || s === ',' || s === '.') return fallback;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDateValue(value) {
  const v = emptyToNull(value);
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 10000 && serial < 100000) {
    const d = new Date((serial - 25569) * 86400000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeEmploymentType(value) {
  const key = normalizeKey(value);
  if (!key) return 'clt';
  if (['clt','pj','freelancer','temporario','estagiario','aprendiz'].includes(key)) return key;
  if (key.includes('estag')) return 'estagiario';
  if (key.includes('aprendiz')) return 'aprendiz';
  if (key.includes('temp')) return 'temporario';
  if (key.includes('freela')) return 'freelancer';
  if (key.includes('pj') || key.includes('pessoa_juridica')) return 'pj';
  return 'clt';
}

function normalizeWorkerProfile(value) {
  const key = normalizeKey(value);
  if (!key) return 'operacional';
  if (['administrativo','supervisor','promotor','operacional'].includes(key)) return key;
  if (key.includes('admin')) return 'administrativo';
  if (key.includes('super')) return 'supervisor';
  if (key.includes('promotor')) return 'promotor';
  return 'operacional';
}

function normalizeEmployeeStatus(value) {
  const key = normalizeKey(value);
  if (!key) return 'ativo';
  if (['ativo','afastado','ferias','desligado','suspenso'].includes(key)) return key;
  if (['ativa','admitido','admitida','trabalhando','normal'].includes(key)) return 'ativo';
  if (key.includes('feria')) return 'ferias';
  if (key.includes('afast')) return 'afastado';
  if (key.includes('suspens')) return 'suspenso';
  if (key.includes('deslig') || key.includes('demit')) return 'desligado';
  return 'ativo';
}

function limitText(value, max) {
  const v = emptyToNull(value);
  if (v === null) return null;
  return String(v).trim().slice(0, max);
}

function digitsText(value, max) {
  const v = emptyToNull(value);
  if (v === null) return null;
  return String(v).replace(/\D/g, '').slice(0, max) || null;
}

function normalizeEmployeePayload(body = {}) {
  const workSchedule = body.work_schedule
    ? (typeof body.work_schedule === 'object' ? JSON.stringify(body.work_schedule) : String(body.work_schedule))
    : '08:00-17:00';

  return {
    full_name: limitText(body.full_name, 255),
    social_name: limitText(body.social_name, 255),
    cpf: digitsText(body.cpf, 11),
    rg: limitText(body.rg, 20),
    rg_issuer: limitText(body.rg_issuer, 20),
    birth_date: normalizeDateValue(body.birth_date),
    gender: limitText(body.gender, 20),
    marital_status: limitText(body.marital_status, 30),
    email: limitText(body.email, 255),
    phone: limitText(body.phone, 20),
    phone2: limitText(body.phone2, 20),
    address: emptyToNull(body.address),
    address_number: limitText(body.address_number, 10),
    complement: limitText(body.complement, 100),
    neighborhood: limitText(body.neighborhood, 100),
    city: limitText(body.city, 100),
    state: (() => {
      const raw = emptyToNull(body.state);
      if (!raw) return null;
      const s = String(raw).trim().toUpperCase();
      if (s.length <= 2) return s;
      const UF_MAP = {
        'ACRE':'AC','ALAGOAS':'AL','AMAPA':'AP','AMAZONAS':'AM','BAHIA':'BA',
        'CEARA':'CE','DISTRITO FEDERAL':'DF','ESPIRITO SANTO':'ES','GOIAS':'GO',
        'MARANHAO':'MA','MATO GROSSO':'MT','MATO GROSSO DO SUL':'MS',
        'MINAS GERAIS':'MG','PARA':'PA','PARAIBA':'PB','PARANA':'PR',
        'PERNAMBUCO':'PE','PIAUI':'PI','RIO DE JANEIRO':'RJ',
        'RIO GRANDE DO NORTE':'RN','RIO GRANDE DO SUL':'RS','RONDONIA':'RO',
        'RORAIMA':'RR','SANTA CATARINA':'SC','SAO PAULO':'SP','SERGIPE':'SE',
        'TOCANTINS':'TO',
      };
      const normalized = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return UF_MAP[normalized] || s.substring(0, 2);
    })(),
    zip_code: limitText(body.zip_code, 10),
    registration_number: limitText(body.registration_number, 50),
    worker_profile: normalizeWorkerProfile(body.worker_profile),
    employment_type: normalizeEmploymentType(body.employment_type),
    position: limitText(body.position, 255),
    role_level: limitText(body.role_level, 100),
    branch_id: emptyToNull(body.branch_id),
    company_id: emptyToNull(body.company_id),
    department_id: emptyToNull(body.department_id),
    cost_center_id: emptyToNull(body.cost_center_id),
    direct_manager_id: emptyToNull(body.direct_manager_id),
    admission_date: normalizeDateValue(body.admission_date),
    contract_end_date: normalizeDateValue(body.contract_end_date),
    salary: parseBrazilianNumber(body.salary, 0),
    work_schedule: workSchedule,
    bank_name: limitText(body.bank_name, 100),
    bank_agency: limitText(body.bank_agency, 20),
    bank_account: limitText(body.bank_account, 30),
    bank_account_type: limitText(body.bank_account_type, 20),
    pix_key: limitText(body.pix_key, 255),
    pix_key_type: limitText(body.pix_key_type, 20),
    ctps_number: limitText(body.ctps_number, 30),
    ctps_series: limitText(body.ctps_series, 10),
    pis_pasep: digitsText(body.pis_pasep, 20),
    voter_id: limitText(body.voter_id, 20),
    voter_zone: limitText(body.voter_zone, 20),
    voter_section: limitText(body.voter_section, 20),
    skin_color: limitText(body.skin_color, 50),
    cnpj: digitsText(body.cnpj, 14),
    company_name: limitText(body.company_name, 255),
    status: normalizeEmployeeStatus(body.status),
    photo_url: emptyToNull(body.photo_url),
    salary_items: Array.isArray(body.salary_items) ? body.salary_items : [],
    benefits: Array.isArray(body.benefits) ? body.benefits : [],
    home_latitude: emptyToNull(body.home_latitude) ? Number(body.home_latitude) : null,
    home_longitude: emptyToNull(body.home_longitude) ? Number(body.home_longitude) : null,
  };
}

// Colunas estendidas suportadas via UPDATE após INSERT/UPDATE principal
const EXTENDED_EMPLOYEE_COLS = [
  'mother_name','father_name','spouse_name','birth_city','birth_country','nationality_country',
  'foreigner_registry','residence_time',
  'rg_uf','rg_issue_date','ctps_digit','ctps_uf','ctps_issue_date',
  'cnh','cnh_category','cnh_expiry','cnh_uf','cnh_first_date','cnh_issue_date',
  'reservist_cert','pis_issue_date',
  'civil_registry','civil_registry_term','civil_registry_office','civil_registry_book',
  'civil_registry_folio','civil_registry_city','civil_registry_date',
  'ric_number','ric_issuer','ric_issue_date',
  'class_body_number','class_body_org','class_body_issue_date','class_body_expiry',
  'education_level','cbo_code','current_position','current_cbo','current_salary','current_schedule_desc',
  'registration_date','admission_type','contract_type','occupation_nature','previous_employer_cnpj',
  'transfer_with_onus','transfer_date','service_time_start_date','retirement_date',
  'probation_extension_end','reinstatement_date','previous_registration',
  'work_regime','shift_type','weekly_rest','journey_type','journey_description',
  'work_schedule_desc','night_shift','monthly_hours','weekly_hours','daily_hours',
  'punch_card_number','record_sheet','record_book','record_folio',
  'insalubrity_percent','insalubrity_incidence','periculosity_percent','periculosity_incidence',
  'night_shift_percent','night_shift_incidence','private_pension_value','private_pension_13',
  'syndicate','syndicalized','syndicate_discount','fgts_category','fgts_occurrence','fgts_account',
  'social_security_regime','worker_class','collaborator_type',
  'payment_method','payment_mode','commission_percent','bank_digit','salary_card',
  'vr_card','vt_card','va_card','receives_vr','receives_va','receives_vt','receives_advance',
  'advance_percent','partial_time_regime','unemployment_benefit',
  'observation','import_extra','esocial_receipt','esocial_integration_date',
  'contract_end_date','probation_end_date','termination_date','termination_reason',
  'ctps_number','ctps_series','military_cert',
];

const BOOLEAN_EMP_COLS = new Set(['transfer_with_onus','syndicalized','syndicate_discount','receives_vr','receives_va','receives_vt','receives_advance','partial_time_regime','unemployment_benefit']);
const NUMERIC_EMP_COLS = new Set(['insalubrity_percent','periculosity_percent','night_shift_percent','private_pension_value','private_pension_13','commission_percent','advance_percent','current_salary','monthly_hours','weekly_hours','daily_hours']);

function coerceEmployeeExtValue(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (BOOLEAN_EMP_COLS.has(col)) {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['1','true','sim','yes','y','s','on'].includes(s)) return true;
    if (['0','false','nao','não','no','n','off'].includes(s)) return false;
    return null;
  }
  if (NUMERIC_EMP_COLS.has(col)) {
    const n = Number(String(v).replace(/[^\d.,-]/g,'').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  if (col === 'import_extra') {
    if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v)); } catch { return JSON.stringify({ raw: v }); } }
    return JSON.stringify(v);
  }
  return v;
}

let _employeeColsCache = null;
let _employeeColsCacheAt = 0;
async function getEmployeeColumns() {
  const now = Date.now();
  if (_employeeColsCache && (now - _employeeColsCacheAt) < 60_000) return _employeeColsCache;
  try {
    const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='employees'`);
    _employeeColsCache = new Set(r.rows.map(x => x.column_name));
    _employeeColsCacheAt = now;
  } catch { _employeeColsCache = _employeeColsCache || new Set(); }
  return _employeeColsCache;
}

async function applyExtendedEmployeeCols(employeeId, body) {
  const existing = await getEmployeeColumns();
  const sets = []; const vals = []; let i = 1;
  for (const col of EXTENDED_EMPLOYEE_COLS) {
    if (!(col in body)) continue;
    if (existing.size && !existing.has(col)) continue; // skip unknown cols instead of throwing
    const v = coerceEmployeeExtValue(col, body[col]);
    sets.push(`${col} = $${i++}`);
    vals.push(v);
  }
  if (!sets.length) return;
  vals.push(employeeId);
  try {
    await query(`UPDATE employees SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
  } catch (err) {
    logError('rh.employees.applyExtendedCols', err, { employeeId, cols: sets.length });
    // do not throw — main INSERT already succeeded
  }
}


// Helper: get user org_id
async function getUserOrgId(userId) {
  const r = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.organization_id;
}

// Helper: audit log
async function auditLog(orgId, entityType, entityId, action, changes, userId) {
  try {
    for (const ch of changes) {
      await query(
        `INSERT INTO rh_audit_log (organization_id, entity_type, entity_id, action, field_name, old_value, new_value, changed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, entityType, entityId, action, ch.field, ch.oldVal, ch.newVal, userId]
      );
    }
  } catch (err) {
    logError('rh.auditLog.safeSkip', err, { orgId, entityType, entityId, action });
  }
}

function assertCanManageRhAccess(req, res) {
  const role = String(req.user?.role || '').toLowerCase();
  if (req.user?.is_superadmin || ['owner', 'admin'].includes(role)) return true;
  res.status(403).json({ error: 'Apenas administradores podem liberar acesso de gestor' });
  return false;
}

// ===== EMPLOYEES =====

// List employees
router.get('/employees', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);

    const { status, search, department_id, branch_id, company_id } = req.query;
    let sql = `SELECT e.*, d.name as department_name, b.name as branch_name,
               CASE WHEN caa.access_status IN ('liberado','aguardando_login','ativo') THEN true ELSE false END as promotor_access,
               COALESCE(caa.access_status, 'sem_acesso') as app_access_status,
               caa.last_login as app_last_login
               FROM employees e
               LEFT JOIN rh_departments d ON d.id = e.department_id
               LEFT JOIN branches b ON b.id = e.branch_id
               LEFT JOIN collaborator_app_access caa ON caa.employee_id = e.id
               WHERE e.organization_id = $1`;
    const params = [orgId];
    let idx = 2;

    if (status) { sql += ` AND e.status = $${idx++}`; params.push(status); }
    if (department_id) { sql += ` AND e.department_id = $${idx++}`; params.push(department_id); }
    if (branch_id) { sql += ` AND e.branch_id = $${idx++}`; params.push(branch_id); }
    if (company_id) { sql += ` AND e.company_id = $${idx++}`; params.push(company_id); }
    if (search) { sql += ` AND (e.full_name ILIKE $${idx} OR e.cpf ILIKE $${idx} OR e.email ILIKE $${idx})`; params.push(`%${search}%`); idx++; }

    sql += ` ORDER BY e.full_name`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.employees.list', err);
    res.status(500).json({ error: 'Erro ao listar colaboradores' });
  }
});

// Get single employee
router.get('/employees/:id', async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, d.name as department_name, b.name as branch_name, cc.name as cost_center_name
       FROM employees e
       LEFT JOIN rh_departments d ON d.id = e.department_id
       LEFT JOIN branches b ON b.id = e.branch_id
       LEFT JOIN cost_centers cc ON cc.id = e.cost_center_id
       WHERE e.id = $1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.employees.get', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// Create employee
router.post('/employees', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada para o usuário' });

    const d = normalizeEmployeePayload(req.body);
    if (!d.full_name) return res.status(400).json({ error: 'Nome do colaborador é obrigatório' });

    // Upsert: se CPF existir na mesma org, atualiza em vez de duplicar
    if (d.cpf) {
      const cleanCpf = String(d.cpf).replace(/\D/g, '');
      if (cleanCpf.length >= 11) {
        const existing = await query(
          `SELECT id FROM employees WHERE organization_id = $1 AND REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') = $2 LIMIT 1`,
          [orgId, cleanCpf]
        );
        if (existing.rows[0]) {
          // Atualiza o existente com os novos dados
          const empId = existing.rows[0].id;
          const updateFields = [];
          const updateValues = [];
          let pi = 1;
          const skipKeys = ['organization_id', 'created_by', 'salary_items', 'benefits'];
          for (const [k, v] of Object.entries(d)) {
            if (skipKeys.includes(k) || v === null || v === undefined || v === '') continue;
            updateFields.push(`${k} = $${pi++}`);
            updateValues.push(v);
          }
          if (updateFields.length) {
            updateValues.push(empId);
            await query(`UPDATE employees SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${pi}`, updateValues);
          }
          await applyExtendedEmployeeCols(empId, req.body);
          const updated = await query(`SELECT * FROM employees WHERE id = $1`, [empId]);
          return res.json(updated.rows[0]);
        }
      }
    }

    // Auto-geocode home address if no coordinates provided
    if (!d.home_latitude && !d.home_longitude && (d.address || d.city)) {
      try {
        const geo = await autoGeocodeAddress(d.address, d.city, d.state, d.zip_code, d.neighborhood, d.address_number, d.complement);
        if (geo) { d.home_latitude = geo.lat; d.home_longitude = geo.lng; }
      } catch (geoErr) {
        logError('rh.employees.create.geocodeSafeSkip', geoErr, { full_name: d.full_name });
      }
    }

    const result = await query(
      `INSERT INTO employees (organization_id, company_id, full_name, social_name, cpf, rg, rg_issuer, birth_date, gender, marital_status, email, phone, phone2,
        address, address_number, complement, neighborhood, city, state, zip_code,
        registration_number, worker_profile, employment_type, position, role_level,
        branch_id, department_id, cost_center_id, direct_manager_id,
        admission_date, contract_end_date, salary, work_schedule,
        bank_name, bank_agency, bank_account, bank_account_type, pix_key, pix_key_type,
        ctps_number, ctps_series, pis_pasep, voter_id, voter_zone, voter_section, skin_color,
        cnpj, company_name, status, photo_url, created_by,
        salary_items, benefits, home_latitude, home_longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55)
       RETURNING *`,
      [orgId, d.company_id, d.full_name, d.social_name, d.cpf, d.rg, d.rg_issuer, d.birth_date, d.gender, d.marital_status, d.email, d.phone, d.phone2,
        d.address, d.address_number, d.complement, d.neighborhood, d.city, d.state, d.zip_code,
        d.registration_number, d.worker_profile, d.employment_type, d.position, d.role_level,
        d.branch_id, d.department_id, d.cost_center_id, d.direct_manager_id,
        d.admission_date, d.contract_end_date, d.salary, d.work_schedule,
        d.bank_name, d.bank_agency, d.bank_account, d.bank_account_type, d.pix_key, d.pix_key_type,
        d.ctps_number, d.ctps_series, d.pis_pasep, d.voter_id, d.voter_zone, d.voter_section, d.skin_color,
        d.cnpj, d.company_name, d.status, d.photo_url, req.userId,
        JSON.stringify(d.salary_items), JSON.stringify(d.benefits), d.home_latitude, d.home_longitude]
    );
    if (req.body.facial_required === true || req.body.facial_required === false) {
      try {
        await query(`UPDATE employees SET facial_required = $1 WHERE id = $2`, [req.body.facial_required, result.rows[0].id]);
        result.rows[0].facial_required = req.body.facial_required;
      } catch (facialErr) {
        logError('rh.employees.create.facialRequiredSafeSkip', facialErr, { employee_id: result.rows[0].id });
      }
    }
    await applyExtendedEmployeeCols(result.rows[0].id, req.body);
    await auditLog(orgId, 'employee', result.rows[0].id, 'create', [{ field: 'full_name', oldVal: null, newVal: d.full_name }], req.userId);
    const fresh = await query(`SELECT * FROM employees WHERE id = $1`, [result.rows[0].id]);
    // Trilha: abre o primeiro vínculo e registra a admissão
    try {
      const created = fresh.rows[0] || result.rows[0];
      const period = await openPeriod(created, { start_date: created.admission_date, userId: req.userId });
      await recordEvent({
        organization_id: orgId,
        employee_id: created.id,
        period_id: period?.id,
        event_type: 'admissao',
        title: 'Admissão',
        description: created.position ? `Cargo: ${created.position}` : null,
        effective_date: created.admission_date ? String(created.admission_date).slice(0, 10) : null,
        created_by: req.userId,
      });
    } catch (histErr) {
      logError('rh.employees.create.historySafeSkip', histErr);
    }
    res.json(fresh.rows[0] || result.rows[0]);

  } catch (err) {
    logError('rh.employees.create', err, { body: req.body });
    const message = err?.detail || err?.message || 'Erro ao criar colaborador';
    res.status(400).json({ error: message });
  }
});

// Update employee
router.put('/employees/:id', async (req, res) => {
  try {
    // Only process fields actually sent in the request body
    const allowedCols = new Set([
      'full_name','social_name','cpf','rg','rg_issuer','birth_date','gender','marital_status',
      'email','phone','phone2','address','address_number','complement','neighborhood','city',
      'state','zip_code','registration_number','worker_profile','employment_type','position',
      'role_level','branch_id','company_id','department_id','cost_center_id','direct_manager_id',
      'admission_date','contract_end_date','salary','work_schedule','bank_name','bank_agency',
      'bank_account','bank_account_type','pix_key','pix_key_type','ctps_number','ctps_series','pis_pasep',
      'voter_id','voter_zone','voter_section','skin_color','cnpj',
      'company_name','status','photo_url','salary_items','benefits',
      'home_latitude','home_longitude','facial_required',
      ...EXTENDED_EMPLOYEE_COLS,
    ]);

    const sentKeys = Object.keys(req.body).filter(k => allowedCols.has(k));
    if (!sentKeys.length) {
      const existing = await query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
      return existing.rows[0] ? res.json(existing.rows[0]) : res.status(404).json({ error: 'Não encontrado' });
    }

    // Normalize only sent fields
    const d = {};
    const jsonbFields = ['salary_items', 'benefits'];
    const extSet = new Set(EXTENDED_EMPLOYEE_COLS);
    for (const k of sentKeys) {
      if (k === 'work_schedule') {
        d[k] = typeof req.body[k] === 'object' ? JSON.stringify(req.body[k]) : String(req.body[k] || '08:00-17:00');
      } else if (jsonbFields.includes(k)) {
        d[k] = JSON.stringify(Array.isArray(req.body[k]) ? req.body[k] : []);
      } else if (extSet.has(k)) {
        d[k] = coerceEmployeeExtValue(k, req.body[k]);
      } else {
        d[k] = emptyToNull(req.body[k]);
      }
    }

    // Auto-geocode home address if address changed and no coords sent
    const addressChanged = ['address', 'city', 'state', 'zip_code'].some(k => sentKeys.includes(k));
    if (addressChanged && !d.home_latitude && !d.home_longitude) {
      const addrVal = d.address || req.body.address;
      const addressNumberVal = d.address_number || req.body.address_number;
      const complementVal = d.complement || req.body.complement;
      const cityVal = d.city || req.body.city;
      const stateVal = d.state || req.body.state;
      const zipVal = d.zip_code || req.body.zip_code;
      const neighborhoodVal = d.neighborhood || req.body.neighborhood;
      if (addrVal || cityVal) {
        const geo = await autoGeocodeAddress(addrVal, cityVal, stateVal, zipVal, neighborhoodVal, addressNumberVal, complementVal);
        if (geo) { d.home_latitude = geo.lat; d.home_longitude = geo.lng; }
      }
    }

    const old = await query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
    if (!old.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

    const fields = Object.keys(d);
    const sets = fields.map((f, i) => `${f} = $${i + 2}`);
    sets.push(`updated_at = NOW()`);
    const vals = fields.map(f => d[f]);

    const result = await query(
      `UPDATE employees SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      [req.params.id, ...vals]
    );

    const changes = fields
      .filter(f => String(old.rows[0][f]) !== String(d[f]))
      .map(f => ({ field: f, oldVal: String(old.rows[0][f] ?? ''), newVal: String(d[f] ?? '') }));
    if (changes.length) {
      await auditLog(old.rows[0].organization_id, 'employee', req.params.id, 'update', changes, req.userId);
      // Emit RH change alerts for tracked fields
      try {
        const ALERT_MAP = {
          position: 'cargo', role_level: 'cargo',
          salary: 'salario', salary_items: 'salario',
          benefits: 'plano_saude',
        };
        for (const ch of changes) {
          const alertType = ALERT_MAP[ch.field];
          if (!alertType) continue;
          await query(
            `INSERT INTO rh_change_alerts (organization_id, employee_id, field, old_value, new_value, alert_type, changed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [old.rows[0].organization_id, req.params.id, ch.field, ch.oldVal, ch.newVal, alertType, req.userId]
          ).catch(() => {});
        }
      } catch (e) { /* table may not exist yet - it's created on first call to rh-management */ }
    }

    // Trilha do colaborador (promoção, mudança de contrato, desligamento, readmissão...)
    await trackEmployeeChanges({
      before: old.rows[0],
      after: result.rows[0],
      changes,
      userId: req.userId,
      effective_date: req.body.effective_date || null,
    });

    res.json(result.rows[0]);

  } catch (err) {
    logError('rh.employees.update', err, { body: req.body, employee_id: req.params.id });
    const message = err?.detail || err?.message || 'Erro ao atualizar colaborador';
    res.status(400).json({ error: message, details: err?.detail || err?.hint || '' });
  }
});

// Create/reset a platform login for the employee as manager/supervisor
router.post('/employees/:id/manager-access', async (req, res) => {
  try {
    if (!assertCanManageRhAccess(req, res)) return;

    const orgId = req.user?.organization_id || await getUserOrgId(req.userId);
    const employeeResult = await query(
      `SELECT id, organization_id, full_name, email, user_id
       FROM employees
       WHERE id = $1 AND organization_id = $2
       LIMIT 1`,
      [req.params.id, orgId]
    );
    const employee = employeeResult.rows[0];
    if (!employee) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const email = String(req.body?.email || employee.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    if (!email) return res.status(400).json({ error: 'Informe um e-mail no cadastro do gestor' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });

    const passwordHash = await bcrypt.hash(password, 10);

    // Ensure the flag column exists (idempotent)
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false`);
    } catch (_) { /* ignore */ }

    let userId = employee.user_id;
    if (userId) {
      await query(
        `UPDATE users SET email = $1, name = $2, password_hash = $3, must_change_password = true, updated_at = NOW() WHERE id = $4`,
        [email, employee.full_name, passwordHash, userId]
      );
    } else {
      const existingUser = await query(`SELECT id FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`, [email]);
      if (existingUser.rows[0]) {
        userId = existingUser.rows[0].id;
        await query(
          `UPDATE users SET name = COALESCE(NULLIF($1, ''), name), password_hash = $2, must_change_password = true, updated_at = NOW() WHERE id = $3`,
          [employee.full_name, passwordHash, userId]
        );
      } else {
        const created = await query(
          `INSERT INTO users (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, true) RETURNING id`,
          [email, employee.full_name, passwordHash]
        );
        userId = created.rows[0].id;
      }
    }

    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'manager')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'manager'`,
      [orgId, userId]
    );

    await query(`UPDATE employees SET user_id = $1, email = $2, updated_at = NOW() WHERE id = $3`, [userId, email, employee.id]);
    await auditLog(orgId, 'employee', employee.id, 'manager_access', [{ field: 'user_id', oldVal: employee.user_id, newVal: userId }], req.userId);

    res.json({ ok: true, user_id: userId, email, role: 'manager' });
  } catch (err) {
    logError('rh.employees.managerAccess', err, { employee_id: req.params.id });
    res.status(500).json({ error: err?.detail || err?.message || 'Erro ao liberar acesso de gestor' });
  }
});

// Delete employee (soft by default, hard delete with ?hard=true)
router.delete('/employees/:id', async (req, res) => {
  try {
    const hard = req.query.hard === 'true' || req.query.hard === '1';
    if (hard) {
      // Hard delete: remove dependents first, then employee
      await query(`DELETE FROM employee_dependents WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM employee_documents WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM time_records WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM hour_bank WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM employee_absences WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM payslips WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM rh_employee_history WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM rh_employment_periods WHERE employee_id = $1`, [req.params.id]).catch(() => {});
      await query(`DELETE FROM employees WHERE id = $1`, [req.params.id]);
    } else {
      const before = await query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
      const upd = await query(
        `UPDATE employees SET status = 'desligado', termination_date = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (before.rows[0] && upd.rows[0] && before.rows[0].status !== 'desligado') {
        await trackEmployeeChanges({
          before: before.rows[0],
          after: upd.rows[0],
          changes: [{ field: 'status', oldVal: before.rows[0].status, newVal: 'desligado' }],
          userId: req.userId,
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logError('rh.employees.delete', err);
    res.status(500).json({ error: 'Erro ao apagar colaborador' });
  }
});

// ===== TRILHA / HISTÓRICO DO COLABORADOR =====

// Timeline completa: vínculos (períodos) + eventos
router.get('/employees/:id/history', async (req, res) => {
  try {
    await ensureHistoryTables();
    const empRes = await query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ error: 'Colaborador não encontrado' });

    // Backfill para colaboradores criados antes da trilha
    const periodCount = await query(`SELECT COUNT(*)::int AS n FROM rh_employment_periods WHERE employee_id = $1`, [req.params.id]);
    if (!periodCount.rows[0]?.n) {
      const isTerminated = String(emp.status || '') === 'desligado';
      const period = await openPeriod(emp, { start_date: emp.admission_date, userId: req.userId });
      await recordEvent({
        organization_id: emp.organization_id,
        employee_id: emp.id,
        period_id: period?.id,
        event_type: 'admissao',
        title: 'Admissão',
        effective_date: emp.admission_date ? String(emp.admission_date).slice(0, 10) : null,
        source: 'auto',
        created_by: req.userId,
      });
      if (isTerminated) {
        const end = emp.termination_date ? String(emp.termination_date).slice(0, 10) : null;
        await closePeriod(emp.id, { end_date: end, reason: emp.termination_reason, userId: req.userId });
        await recordEvent({
          organization_id: emp.organization_id,
          employee_id: emp.id,
          event_type: 'desligamento',
          title: 'Desligamento',
          description: emp.termination_reason || null,
          effective_date: end,
          created_by: req.userId,
        });
      }
    }

    const [periods, events] = await Promise.all([
      query(
        `SELECT p.*, d.name AS department_name, c.name AS company_name
         FROM rh_employment_periods p
         LEFT JOIN rh_departments d ON d.id = p.department_id
         LEFT JOIN companies c ON c.id = p.company_id
         WHERE p.employee_id = $1
         ORDER BY COALESCE(p.start_date, p.created_at::date) ASC, p.sequence ASC`,
        [req.params.id]
      ),
      query(
        `SELECT h.*, u.name AS created_by_name
         FROM rh_employee_history h
         LEFT JOIN users u ON u.id = h.created_by
         WHERE h.employee_id = $1
         ORDER BY h.effective_date DESC, h.created_at DESC`,
        [req.params.id]
      ),
    ]);

    res.json({
      employee: {
        id: emp.id, full_name: emp.full_name, status: emp.status,
        position: emp.position, employment_type: emp.employment_type,
        admission_date: emp.admission_date, termination_date: emp.termination_date,
      },
      periods: periods.rows,
      events: events.rows,
    });
  } catch (err) {
    logError('rh.employees.history.list', err, { employee_id: req.params.id });
    res.status(500).json({ error: err?.message || 'Erro ao carregar trilha do colaborador' });
  }
});

// Evento manual na trilha
router.post('/employees/:id/history', async (req, res) => {
  try {
    await ensureHistoryTables();
    const emp = await query(`SELECT id, organization_id FROM employees WHERE id = $1`, [req.params.id]);
    if (!emp.rows[0]) return res.status(404).json({ error: 'Colaborador não encontrado' });
    const { event_type, title, description, effective_date, old_value, new_value, field_name } = req.body || {};
    if (!title && !event_type) return res.status(400).json({ error: 'Informe o tipo ou o título do evento' });
    const row = await recordEvent({
      organization_id: emp.rows[0].organization_id,
      employee_id: req.params.id,
      event_type: event_type || 'outro',
      title: title || null,
      description: description || null,
      field_name: field_name || null,
      old_value, new_value,
      effective_date: effective_date || null,
      source: 'manual',
      created_by: req.userId,
    });
    res.json(row);
  } catch (err) {
    logError('rh.employees.history.create', err, { employee_id: req.params.id });
    res.status(400).json({ error: err?.message || 'Erro ao registrar evento' });
  }
});

// Remove evento manual
router.delete('/employees/:id/history/:eventId', async (req, res) => {
  try {
    await ensureHistoryTables();
    await query(`DELETE FROM rh_employee_history WHERE id = $1 AND employee_id = $2 AND source = 'manual'`,
      [req.params.eventId, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logError('rh.employees.history.delete', err);
    res.status(500).json({ error: 'Erro ao remover evento' });
  }
});

// Readmissão: encerra vínculo anterior e abre um novo
router.post('/employees/:id/readmit', async (req, res) => {
  try {
    await ensureHistoryTables();
    const empRes = await query(`SELECT * FROM employees WHERE id = $1`, [req.params.id]);
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ error: 'Colaborador não encontrado' });

    const admissionDate = req.body?.admission_date || new Date().toISOString().slice(0, 10);
    const employmentType = req.body?.employment_type || emp.employment_type;
    const position = req.body?.position || emp.position;
    const salary = req.body?.salary != null && req.body.salary !== '' ? Number(req.body.salary) : emp.salary;
    const companyId = req.body?.company_id || emp.company_id;

    await closePeriod(emp.id, {
      end_date: emp.termination_date ? String(emp.termination_date).slice(0, 10) : admissionDate,
      reason: emp.termination_reason,
      userId: req.userId,
    });

    const updated = await query(
      `UPDATE employees
       SET status = 'ativo', termination_date = NULL, termination_reason = NULL,
           admission_date = $2, employment_type = COALESCE($3, employment_type),
           position = COALESCE($4, position), salary = COALESCE($5, salary),
           company_id = COALESCE($6, company_id), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [emp.id, admissionDate, employmentType, position, salary, companyId]
    );

    const period = await openPeriod(updated.rows[0], { start_date: admissionDate, userId: req.userId });
    await recordEvent({
      organization_id: emp.organization_id,
      employee_id: emp.id,
      period_id: period?.id,
      event_type: 'readmissao',
      title: 'Readmissão',
      description: req.body?.notes || null,
      effective_date: admissionDate,
      source: 'manual',
      created_by: req.userId,
    });
    await auditLog(emp.organization_id, 'employee', emp.id, 'readmit',
      [{ field: 'status', oldVal: emp.status, newVal: 'ativo' }], req.userId);

    res.json({ ok: true, employee: updated.rows[0], period });
  } catch (err) {
    logError('rh.employees.readmit', err, { employee_id: req.params.id });
    res.status(400).json({ error: err?.message || 'Erro ao readmitir colaborador' });
  }
});



// ===== TIME RECORDS (PONTO) =====

// App punches (time_punches from promotor app)
router.get('/app-punches', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, start_date, end_date } = req.query;
    let sql = `SELECT tp.*, e.full_name as employee_name, p.name as pdv_name
               FROM time_punches tp
               JOIN employees e ON e.id = tp.employee_id
               LEFT JOIN pdvs p ON p.id = tp.pdv_id
               WHERE tp.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (employee_id) { sql += ` AND tp.employee_id = $${idx++}`; params.push(employee_id); }
    if (start_date) { sql += ` AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date >= $${idx++}::date`; params.push(start_date); }
    if (end_date) { sql += ` AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date <= $${idx++}::date`; params.push(end_date); }
    sql += ` ORDER BY tp.punched_at DESC LIMIT 500`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.app_punches.list', err);
    res.status(500).json({ error: 'Erro ao listar registros do app' });
  }
});

// Sync diagnostics
router.get('/sync-diagnostics', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({ total: 0, synced: 0, pending: 0, employees: [] });

    const [stats, byEmployee, recent] = await Promise.all([
      query(`SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sync_status = 'synced') as synced,
        COUNT(*) FILTER (WHERE sync_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE is_offline = true) as offline_originated,
        MAX(punched_at) as last_punch_at
       FROM time_punches WHERE organization_id = $1`, [orgId]),
      query(`SELECT e.id, e.full_name, e.photo_url,
        COUNT(tp.id) as total_punches,
        COUNT(tp.id) FILTER (WHERE tp.sync_status = 'synced') as synced,
        COUNT(tp.id) FILTER (WHERE tp.sync_status = 'pending') as pending,
        COUNT(tp.id) FILTER (WHERE tp.is_offline = true) as offline,
        MAX(tp.punched_at) as last_punch,
        MAX(CASE WHEN tp.sync_status = 'synced' THEN tp.punched_at END) as last_synced_at
       FROM employees e
       LEFT JOIN time_punches tp ON tp.employee_id = e.id
       WHERE e.organization_id = $1 AND e.status = 'ativo'
       GROUP BY e.id, e.full_name, e.photo_url
       HAVING COUNT(tp.id) > 0
       ORDER BY MAX(tp.punched_at) DESC NULLS LAST`, [orgId]),
      query(`SELECT tp.id, tp.employee_id, e.full_name, tp.punch_type, tp.punched_at, tp.sync_status, tp.is_offline, tp.geo_status, p.name as pdv_name
       FROM time_punches tp JOIN employees e ON e.id = tp.employee_id LEFT JOIN pdvs p ON p.id = tp.pdv_id
       WHERE tp.organization_id = $1 ORDER BY tp.punched_at DESC LIMIT 20`, [orgId]),
    ]);

    res.json({
      ...stats.rows[0],
      employees: byEmployee.rows,
      recent_punches: recent.rows,
    });
  } catch (err) {
    logError('rh.sync_diagnostics', err);
    res.status(500).json({ error: 'Erro' });
  }
});

router.get('/time-records', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, start_date, end_date } = req.query;
    let sql = `SELECT tr.*, e.full_name as employee_name
               FROM time_records tr
               JOIN employees e ON e.id = tr.employee_id
               WHERE tr.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (employee_id) { sql += ` AND tr.employee_id = $${idx++}`; params.push(employee_id); }
    if (start_date) { sql += ` AND tr.record_date >= $${idx++}`; params.push(start_date); }
    if (end_date) { sql += ` AND tr.record_date <= $${idx++}`; params.push(end_date); }
    sql += ` ORDER BY tr.record_date DESC, e.full_name`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.time_records.list', err);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/time-records', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    const result = await query(
      `INSERT INTO time_records (organization_id, employee_id, record_date, entry1, exit1, entry2, exit2, entry3, exit3, total_hours, overtime_hours, status, justification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (employee_id, record_date) DO UPDATE SET
         entry1=EXCLUDED.entry1, exit1=EXCLUDED.exit1, entry2=EXCLUDED.entry2, exit2=EXCLUDED.exit2,
         entry3=EXCLUDED.entry3, exit3=EXCLUDED.exit3, total_hours=EXCLUDED.total_hours,
         overtime_hours=EXCLUDED.overtime_hours, status=EXCLUDED.status, justification=EXCLUDED.justification, updated_at=NOW()
       RETURNING *`,
      [orgId, d.employee_id, d.record_date, d.entry1, d.exit1, d.entry2, d.exit2, d.entry3, d.exit3, d.total_hours || 0, d.overtime_hours || 0, d.status || 'normal', d.justification]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.time_records.create', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// Consolidated timesheet (app punches grouped by employee+date)
router.get('/consolidated-timesheet', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, start_date, end_date } = req.query;

    let sql = `
      SELECT 
        tp.employee_id,
        e.full_name as employee_name,
        e.cpf,
        e.position,
        e.work_schedule,
        (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date as record_date,
        json_agg(json_build_object(
          'id', tp.id, 'punch_type', tp.punch_type, 'punched_at', tp.punched_at,
          'geo_status', tp.geo_status, 'is_offline', tp.is_offline, 'pdv_name', p.name,
          'sync_status', tp.sync_status
        ) ORDER BY tp.punched_at) as punches,
        COUNT(*) as punch_count,
        MIN(tp.punched_at) as first_punch,
        MAX(tp.punched_at) as last_punch,
        EXTRACT(EPOCH FROM (MAX(tp.punched_at) - MIN(tp.punched_at)))/3600.0 as raw_hours
      FROM time_punches tp
      JOIN employees e ON e.id = tp.employee_id
      LEFT JOIN pdvs p ON p.id = tp.pdv_id
      WHERE tp.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (employee_id) { sql += ` AND tp.employee_id = $${idx++}`; params.push(employee_id); }
    if (start_date) { sql += ` AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date >= $${idx++}::date`; params.push(start_date); }
    if (end_date) { sql += ` AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date <= $${idx++}::date`; params.push(end_date); }
    sql += ` GROUP BY tp.employee_id, e.full_name, e.cpf, e.position, e.work_schedule, (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date
             ORDER BY (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date DESC, e.full_name`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.consolidated_timesheet', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// Divergence detection
router.get('/punch-divergences', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { start_date, end_date } = req.query;
    const sd = start_date || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const ed = end_date || new Date().toISOString().slice(0, 10);

    // Find employees who didn't punch on workdays + incomplete punch sequences
    const divergences = [];

    // 1. Employees with no punches on workdays
    const noPunch = await query(`
      SELECT e.id, e.full_name, e.work_schedule, d.dt::date as missing_date
      FROM employees e
      CROSS JOIN generate_series($2::date, $3::date, '1 day'::interval) d(dt)
      WHERE e.organization_id = $1 AND e.status = 'ativo'
        AND EXTRACT(DOW FROM d.dt) NOT IN (0, 6)
        AND NOT EXISTS (
          SELECT 1 FROM time_punches tp WHERE tp.employee_id = e.id AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dt::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM time_records tr WHERE tr.employee_id = e.id AND tr.record_date = d.dt::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_absences ea WHERE ea.employee_id = e.id AND d.dt::date BETWEEN ea.start_date AND ea.end_date
        )
      ORDER BY d.dt DESC, e.full_name
      LIMIT 100
    `, [orgId, sd, ed]);

    for (const r of noPunch.rows) {
      divergences.push({
        employee_id: r.id,
        employee_name: r.full_name,
        date: r.missing_date,
        type: 'sem_registro',
        description: 'Nenhum registro de ponto neste dia',
        severity: 'high',
      });
    }

    // 2. Incomplete punch sequences (odd number of punches = missing entry/exit)
    const incomplete = await query(`
      SELECT tp.employee_id, e.full_name, (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date as punch_date, COUNT(*) as punch_count
      FROM time_punches tp
      JOIN employees e ON e.id = tp.employee_id
      WHERE tp.organization_id = $1 AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
      GROUP BY tp.employee_id, e.full_name, (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date
      HAVING COUNT(*) % 2 != 0
      ORDER BY (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date DESC
    `, [orgId, sd, ed]);

    for (const r of incomplete.rows) {
      divergences.push({
        employee_id: r.employee_id,
        employee_name: r.full_name,
        date: r.punch_date,
        type: 'incompleto',
        description: `Sequência incompleta (${r.punch_count} registros - ímpar)`,
        severity: 'medium',
      });
    }

    // 3. Outside PDV punches
    const outsidePdv = await query(`
      SELECT tp.employee_id, e.full_name, (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date as punch_date, COUNT(*) as count
      FROM time_punches tp
      JOIN employees e ON e.id = tp.employee_id
      WHERE tp.organization_id = $1 AND (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date
        AND tp.geo_status = 'fora_area'
      GROUP BY tp.employee_id, e.full_name, (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY (tp.punched_at AT TIME ZONE 'America/Sao_Paulo')::date DESC
    `, [orgId, sd, ed]);

    for (const r of outsidePdv.rows) {
      divergences.push({
        employee_id: r.employee_id,
        employee_name: r.full_name,
        date: r.punch_date,
        type: 'fora_pdv',
        description: `${r.count} registro(s) fora do PDV`,
        severity: 'low',
      });
    }

    res.json(divergences);
  } catch (err) {
    logError('rh.punch_divergences', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// ===== PAYSLIPS (HOLERITE) =====

router.get('/payslips', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, reference_month } = req.query;
    let sql = `SELECT p.*, e.full_name as employee_name, e.cpf, e.position
               FROM payslips p
               JOIN employees e ON e.id = p.employee_id
               WHERE p.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (employee_id) { sql += ` AND p.employee_id = $${idx++}`; params.push(employee_id); }
    if (reference_month) { sql += ` AND p.reference_month = $${idx++}`; params.push(reference_month); }
    sql += ` ORDER BY p.reference_month DESC, e.full_name`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.payslips.list', err);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/payslips', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const d = req.body;
    const result = await query(
      `INSERT INTO payslips (organization_id, employee_id, reference_month, payment_type, gross_salary, earnings, total_earnings, deductions, total_deductions, net_salary, fgts_base, fgts_value, inss_base, inss_value, irrf_base, irrf_value, payment_date, status, notes, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [orgId, d.employee_id, d.reference_month, d.payment_type || 'mensal', d.gross_salary || 0,
        JSON.stringify(d.earnings || []), d.total_earnings || 0, JSON.stringify(d.deductions || []), d.total_deductions || 0,
        d.net_salary || 0, d.fgts_base || 0, d.fgts_value || 0, d.inss_base || 0, d.inss_value || 0,
        d.irrf_base || 0, d.irrf_value || 0, d.payment_date, d.status || 'rascunho', d.notes, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.payslips.create', err);
    res.status(500).json({ error: 'Erro' });
  }
});

router.put('/payslips/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await query(
      `UPDATE payslips SET gross_salary=$2, earnings=$3, total_earnings=$4, deductions=$5, total_deductions=$6,
       net_salary=$7, fgts_value=$8, inss_value=$9, irrf_value=$10, payment_date=$11, status=$12, notes=$13, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, d.gross_salary, JSON.stringify(d.earnings || []), d.total_earnings, JSON.stringify(d.deductions || []),
        d.total_deductions, d.net_salary, d.fgts_value, d.inss_value, d.irrf_value, d.payment_date, d.status, d.notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.payslips.update', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// Import payslip (PDF already uploaded via /api/uploads)
router.post('/payslips/import', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { employee_id, reference_month, payment_type, pdf_url, notes, send_for_signature } = req.body;
    if (!employee_id || !reference_month || !pdf_url) {
      return res.status(400).json({ error: 'employee_id, reference_month e pdf_url são obrigatórios' });
    }

    // Create payslip record with imported PDF
    const result = await query(
      `INSERT INTO payslips (organization_id, employee_id, reference_month, payment_type, pdf_url, status, notes, generated_by)
       VALUES ($1,$2,$3,$4,$5,'gerado',$6,$7) RETURNING *`,
      [orgId, employee_id, reference_month, payment_type || 'mensal', pdf_url, notes || '', req.userId]
    );
    const payslip = result.rows[0];

    // If send_for_signature, create a doc_signature_document and signer
    if (send_for_signature) {
      try {
        // Get employee info for signer
        const empRes = await query('SELECT full_name, email, cpf, phone FROM employees WHERE id=$1', [employee_id]);
        const emp = empRes.rows[0];
        if (emp) {
          // Create signature document
          const docRes = await query(
            `INSERT INTO doc_signature_documents (organization_id, title, description, file_url, status, created_by)
             VALUES ($1,$2,$3,$4,'pendente',$5) RETURNING *`,
            [orgId, `Holerite ${reference_month} - ${emp.full_name}`, `Demonstrativo de pagamento ref. ${reference_month}`, pdf_url, req.userId]
          );
          const doc = docRes.rows[0];

          // Add employee as signer
          const crypto = await import('crypto');
          const token = crypto.randomBytes(32).toString('hex');
          await query(
            `INSERT INTO doc_signature_signers (document_id, name, email, cpf, phone, sign_order, token)
             VALUES ($1,$2,$3,$4,$5,1,$6)`,
            [doc.id, emp.full_name, emp.email, emp.cpf, emp.phone, token]
          );

          // Update payslip with signature doc reference
          await query('UPDATE payslips SET notes = COALESCE(notes,\'\') || $2 WHERE id=$1',
            [payslip.id, `\n[Assinatura: ${doc.id}]`]);

          payslip.signature_document_id = doc.id;
        }
      } catch (sigErr) {
        logError('rh.payslips.import.signature', sigErr);
        // Don't fail the import if signature creation fails
      }
    }

    res.json(payslip);
  } catch (err) {
    logError('rh.payslips.import', err);
    res.status(500).json({ error: 'Erro ao importar holerite' });
  }
});

// ===== ABSENCES =====

router.get('/absences', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const { employee_id } = req.query;
    let sql = `SELECT a.*, e.full_name as employee_name
               FROM employee_absences a
               JOIN employees e ON e.id = a.employee_id
               WHERE e.organization_id = $1`;
    const params = [orgId];
    if (employee_id) { sql += ` AND a.employee_id = $2`; params.push(employee_id); }
    sql += ` ORDER BY a.start_date DESC`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.absences.list', err);
    res.status(500).json({ error: 'Erro' });
  }
});

router.post('/absences', async (req, res) => {
  try {
    const d = req.body;
    const result = await query(
      `INSERT INTO employee_absences (employee_id, absence_type, start_date, end_date, days_count, reason, document_url, approved, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.employee_id, d.absence_type, d.start_date, d.end_date, d.days_count, d.reason, d.document_url, d.approved || false, d.approved ? req.userId : null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.absences.create', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// ===== BRANCHES, DEPARTMENTS, COST CENTERS =====

router.get('/branches', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const result = await query(`SELECT * FROM branches WHERE organization_id = $1 ORDER BY name`, [orgId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/branches', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const result = await query(`INSERT INTO branches (organization_id, name, cnpj, address, city, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [orgId, req.body.name, req.body.cnpj, req.body.address, req.body.city, req.body.state]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.get('/rh-departments', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const result = await query(`SELECT * FROM rh_departments WHERE organization_id = $1 ORDER BY name`, [orgId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/rh-departments', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const result = await query(`INSERT INTO rh_departments (organization_id, name, branch_id) VALUES ($1,$2,$3) RETURNING *`,
      [orgId, req.body.name, req.body.branch_id || null]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.get('/cost-centers', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const result = await query(`SELECT * FROM cost_centers WHERE organization_id = $1 ORDER BY code`, [orgId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/cost-centers', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const result = await query(`INSERT INTO cost_centers (organization_id, code, name) VALUES ($1,$2,$3) RETURNING *`,
      [orgId, req.body.code, req.body.name]);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ===== POSITIONS (CARGOS) =====
router.get('/positions', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const result = await query(`SELECT * FROM rh_positions WHERE organization_id = $1 ORDER BY name`, [orgId]);
    res.json(result.rows);
  } catch (err) {
    // Table may not exist yet — auto-create
    try {
      await query(`CREATE TABLE IF NOT EXISTS rh_positions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        name VARCHAR(200) NOT NULL,
        department_id UUID REFERENCES rh_departments(id),
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      res.json([]);
    } catch (e2) { res.status(500).json({ error: 'Erro' }); }
  }
});

router.post('/positions', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    // Ensure table exists
    await query(`CREATE TABLE IF NOT EXISTS rh_positions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name VARCHAR(200) NOT NULL,
      department_id UUID REFERENCES rh_departments(id),
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const result = await query(
      `INSERT INTO rh_positions (organization_id, name, department_id, description) VALUES ($1,$2,$3,$4) RETURNING *`,
      [orgId, req.body.name, req.body.department_id || null, req.body.description || null]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar cargo' }); }
});

router.delete('/positions/:id', async (req, res) => {
  try {
    await query(`DELETE FROM rh_positions WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.delete('/rh-departments/:id', async (req, res) => {
  try {
    await query(`DELETE FROM rh_departments WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.delete('/branches/:id', async (req, res) => {
  try {
    await query(`DELETE FROM branches WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ===== WORKER PROFILES (PERFIS FUNCIONAIS) =====
router.get('/worker-profiles', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    await query(`CREATE TABLE IF NOT EXISTS rh_worker_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const result = await query(`SELECT * FROM rh_worker_profiles WHERE organization_id = $1 ORDER BY name`, [orgId]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

router.post('/worker-profiles', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    await query(`CREATE TABLE IF NOT EXISTS rh_worker_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    const result = await query(
      `INSERT INTO rh_worker_profiles (organization_id, name) VALUES ($1,$2) RETURNING *`,
      [orgId, req.body.name]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar perfil' }); }
});

router.delete('/worker-profiles/:id', async (req, res) => {
  try {
    await query(`DELETE FROM rh_worker_profiles WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ===== AUDIT LOG =====

// ===== RH DASHBOARD STATS =====
router.get('/dashboard-stats', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({});
    const today = new Date().toISOString().slice(0, 10);
    const lateRes = await query(
      `SELECT tr.*, e.full_name, e.work_schedule
       FROM time_records tr JOIN employees e ON e.id = tr.employee_id
       WHERE tr.organization_id = $1 AND tr.record_date = $2
         AND tr.entry1 IS NOT NULL AND e.work_schedule IS NOT NULL
         AND tr.entry1 > CAST(SPLIT_PART(e.work_schedule, '-', 1) || ':00' AS TIME) + INTERVAL '5 minutes'
       ORDER BY tr.entry1 DESC`, [orgId, today]);
    const absenceRes = await query(
      `SELECT e.id, e.full_name, e.position, d.name as department_name
       FROM employees e LEFT JOIN rh_departments d ON d.id = e.department_id
       WHERE e.organization_id = $1 AND e.status = 'ativo'
         AND NOT EXISTS (SELECT 1 FROM time_records tr WHERE tr.employee_id = e.id AND tr.record_date = $2)
       ORDER BY e.full_name`, [orgId, today]);
    const vacExpiring = await query(
      `SELECT e.id, e.full_name, e.admission_date, e.position
       FROM employees e WHERE e.organization_id = $1 AND e.status = 'ativo' AND e.admission_date IS NOT NULL
         AND (DATE_PART('month', e.admission_date) = DATE_PART('month', CURRENT_DATE + INTERVAL '30 days')
           AND DATE_PART('day', e.admission_date) <= DATE_PART('day', CURRENT_DATE + INTERVAL '30 days'))
       ORDER BY e.admission_date`, [orgId]);
    let pendingCerts = { rows: [] };
    try {
      pendingCerts = await query(
        `SELECT mc.*, e.full_name FROM rh_medical_certificates mc JOIN employees e ON e.id = mc.employee_id
         WHERE mc.organization_id = $1 AND mc.validated = false ORDER BY mc.created_at DESC LIMIT 20`, [orgId]);
    } catch(e) { /* table may not exist yet */ }
    let activeVacations = { rows: [] };
    try {
      activeVacations = await query(
        `SELECT v.*, e.full_name FROM rh_vacations v JOIN employees e ON e.id = v.employee_id
         WHERE v.organization_id = $1 AND v.status IN ('agendada', 'em_andamento') ORDER BY v.start_date`, [orgId]);
    } catch(e) { /* table may not exist yet */ }
    const countRes = await query(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE organization_id = $1 AND status = 'ativo') as total_active,
         (SELECT COUNT(*) FROM employees WHERE organization_id = $1 AND status = 'ferias') as on_vacation,
         (SELECT COUNT(*) FROM employees WHERE organization_id = $1 AND status = 'afastado') as on_leave`, [orgId]);
    res.json({
      late_arrivals: lateRes.rows, absences_today: absenceRes.rows,
      vacations_expiring: vacExpiring.rows, pending_certificates: pendingCerts.rows,
      active_vacations: activeVacations.rows, summary: countRes.rows[0] || {},
    });
  } catch (err) { logError('rh.dashboard', err); res.status(500).json({ error: 'Erro ao carregar dashboard' }); }
});

// ===== VACATIONS =====
router.get('/vacations', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, status } = req.query;
    let sql = `SELECT v.*, e.full_name as employee_name, e.position FROM rh_vacations v JOIN employees e ON e.id = v.employee_id WHERE v.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND v.employee_id = $${idx++}`; params.push(employee_id); }
    if (status) { sql += ` AND v.status = $${idx++}`; params.push(status); }
    sql += ` ORDER BY v.start_date DESC`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('rh.vacations.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/vacations', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    const result = await query(
      `INSERT INTO rh_vacations (organization_id, employee_id, vacation_type, acquisition_start, acquisition_end,
        start_date, end_date, days_total, days_taken, days_remaining, abono_pecuniario, abono_days, status, notes, approved, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [orgId, d.employee_id, d.vacation_type || 'completa', d.acquisition_start, d.acquisition_end,
        d.start_date, d.end_date, d.days_total || 30, d.days_taken || 0,
        (d.days_total || 30) - (d.days_taken || 0), d.abono_pecuniario || false, d.abono_days || 0,
        d.status || 'agendada', d.notes, d.approved || false, req.userId]);
    if (d.start_date <= new Date().toISOString().slice(0, 10)) {
      await query(`UPDATE employees SET status = 'ferias', updated_at = NOW() WHERE id = $1`, [d.employee_id]);
    }
    await auditLog(orgId, 'vacation', result.rows[0].id, 'create', [{ field: 'vacation', oldVal: null, newVal: `${d.vacation_type}: ${d.start_date} - ${d.end_date}` }], req.userId);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.vacations.create', err); res.status(500).json({ error: 'Erro ao registrar férias' }); }
});

router.put('/vacations/:id', async (req, res) => {
  try {
    const d = req.body;
    const result = await query(
      `UPDATE rh_vacations SET vacation_type=$2, start_date=$3, end_date=$4, days_total=$5, days_taken=$6, days_remaining=$7,
        abono_pecuniario=$8, abono_days=$9, status=$10, notes=$11, approved=$12, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id, d.vacation_type, d.start_date, d.end_date, d.days_total, d.days_taken, d.days_remaining, d.abono_pecuniario, d.abono_days, d.status, d.notes, d.approved]);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.vacations.update', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== MEDICAL CERTIFICATES =====
router.get('/medical-certificates', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, validated } = req.query;
    let sql = `SELECT mc.*, e.full_name as employee_name FROM rh_medical_certificates mc JOIN employees e ON e.id = mc.employee_id WHERE mc.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND mc.employee_id = $${idx++}`; params.push(employee_id); }
    if (validated !== undefined) { sql += ` AND mc.validated = $${idx++}`; params.push(validated === 'true'); }
    sql += ` ORDER BY mc.created_at DESC`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('rh.medical.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/medical-certificates', async (req, res) => {
  try {
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    const result = await query(
      `INSERT INTO rh_medical_certificates (organization_id, employee_id, doctor_name, doctor_crm, cid_code,
        healthcare_unit, absence_start, absence_end, absence_days, absence_hours, is_partial,
        document_url, ai_extracted_data, ai_confidence, notes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [orgId, d.employee_id, d.doctor_name, d.doctor_crm, d.cid_code, d.healthcare_unit,
        d.absence_start, d.absence_end, d.absence_days, d.absence_hours, d.is_partial || false,
        d.document_url, d.ai_extracted_data ? JSON.stringify(d.ai_extracted_data) : null,
        d.ai_confidence, d.notes, req.userId]);
    // Auto-justify time records
    if (d.absence_start && d.absence_end) {
      const days = Math.ceil((new Date(d.absence_end) - new Date(d.absence_start)) / 86400000) + 1;
      for (let i = 0; i < days; i++) {
        const dt = new Date(d.absence_start); dt.setDate(dt.getDate() + i);
        const dateStr = dt.toISOString().slice(0, 10);
        await query(
          `INSERT INTO time_records (organization_id, employee_id, record_date, status, justification, total_hours, overtime_hours)
           VALUES ($1, $2, $3, 'atestado', $4, 0, 0)
           ON CONFLICT (employee_id, record_date) DO UPDATE SET status = 'atestado', justification = EXCLUDED.justification, updated_at = NOW()`,
          [orgId, d.employee_id, dateStr, `Atestado: CID ${d.cid_code || 'N/I'} - Dr. ${d.doctor_name || 'N/I'}`]);
      }
    }
    await auditLog(orgId, 'medical_certificate', result.rows[0].id, 'create',
      [{ field: 'certificate', oldVal: null, newVal: `CID: ${d.cid_code}, Dr: ${d.doctor_name}` }], req.userId);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.medical.create', err); res.status(500).json({ error: 'Erro ao registrar atestado' }); }
});

router.put('/medical-certificates/:id/validate', async (req, res) => {
  try {
    const { validated, rejection_reason } = req.body;
    const result = await query(
      `UPDATE rh_medical_certificates SET validated = $2, validated_by = $3, validated_at = NOW(), rejection_reason = $4, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, validated, req.userId, rejection_reason || null]);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.medical.validate', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== EMPLOYEE DOCUMENTS =====
router.get('/documents', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, doc_type } = req.query;
    let sql = `SELECT ed.*, e.full_name as employee_name FROM employee_documents ed JOIN employees e ON e.id = ed.employee_id WHERE e.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND ed.employee_id = $${idx++}`; params.push(employee_id); }
    if (doc_type) { sql += ` AND ed.doc_type = $${idx++}`; params.push(doc_type); }
    sql += ` ORDER BY ed.created_at DESC`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('rh.documents.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/documents', async (req, res) => {
  try {
    const d = req.body;
    const result = await query(
      `INSERT INTO employee_documents (employee_id, doc_type, title, file_url, expiry_date, notes, status, uploaded_by, ai_extracted_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.employee_id, d.doc_type, d.title, d.file_url, d.expiry_date, d.notes, d.status || 'pendente', req.userId,
        d.ai_extracted_data ? JSON.stringify(d.ai_extracted_data) : null]);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.documents.create', err); res.status(500).json({ error: 'Erro' }); }
});

router.put('/documents/:id/validate', async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;
    const result = await query(
      `UPDATE employee_documents SET status = $2, validated_by = $3, validated_at = NOW(), rejection_reason = $4 WHERE id = $1 RETURNING *`,
      [req.params.id, status || 'aprovado', req.userId, rejection_reason || null]);
    res.json(result.rows[0]);
  } catch (err) { logError('rh.documents.validate', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    await query(`DELETE FROM employee_documents WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { logError('rh.documents.delete', err); res.status(500).json({ error: 'Erro' }); }
});



router.get('/audit-log', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    const { entity_type, entity_id } = req.query;
    let sql = `SELECT a.*, u.name as changed_by_name
               FROM rh_audit_log a
               LEFT JOIN users u ON u.id = a.changed_by
               WHERE a.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (entity_type) { sql += ` AND a.entity_type = $${idx++}`; params.push(entity_type); }
    if (entity_id) { sql += ` AND a.entity_id = $${idx++}`; params.push(entity_id); }
    sql += ` ORDER BY a.changed_at DESC LIMIT 200`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.audit.list', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// ===== NOTIFICATIONS HISTORY (per employee) =====
router.get('/employees/:id/notifications', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const emp = await query(`SELECT id FROM employees WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (!emp.rowCount) return res.status(404).json({ error: 'Colaborador não encontrado' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const r = await query(
      `SELECT id, title, message, type, reference_type, reference_id,
              read, read_at, created_at,
              CASE WHEN read THEN 'lido' ELSE 'entregue' END AS delivery_status
         FROM collaborator_notifications
        WHERE employee_id = $1 AND organization_id = $2
        ORDER BY created_at DESC
        LIMIT $3`,
      [req.params.id, orgId, limit]
    );
    res.json(r.rows);
  } catch (err) {
    logError('rh.employees.notifications', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// ===== AI CERTIFICATE ANALYSIS =====
async function getAIConfig(userId) {
  const orgResult = await query(
    `SELECT o.ai_provider, o.ai_model, o.ai_api_key 
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.user_id = $1 LIMIT 1`,
    [userId]
  );
  const org = orgResult.rows[0];
  if (!org || !org.ai_api_key || org.ai_provider === 'none') return null;
  return {
    provider: org.ai_provider,
    model: org.ai_model || (org.ai_provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.0-flash'),
    apiKey: org.ai_api_key,
  };
}

router.post('/analyze-certificate', async (req, res) => {
  try {
    const { document_url } = req.body;
    if (!document_url) return res.status(400).json({ error: 'document_url é obrigatório' });

    const aiConfig = await getAIConfig(req.userId);
    if (!aiConfig) {
      return res.status(400).json({ error: 'IA não configurada. Configure a chave de IA nas configurações da organização.' });
    }

    // Build image/document content for AI
    const resolvedUrl = document_url.startsWith('/') 
      ? `${process.env.BASE_URL || 'http://localhost:3000'}${document_url}`
      : document_url;

    const messages = [
      {
        role: 'system',
        content: `Você é um especialista em análise de atestados médicos brasileiros. Analise a imagem/documento do atestado e extraia as seguintes informações em JSON:
{
  "doctor_name": "nome completo do médico",
  "doctor_crm": "número do CRM (apenas números e UF, ex: 12345/SP)",
  "cid_code": "código CID (ex: J11, Z76.3)",
  "healthcare_unit": "nome do hospital, clínica ou unidade de saúde",
  "absence_start": "data início do afastamento no formato YYYY-MM-DD",
  "absence_end": "data fim do afastamento no formato YYYY-MM-DD",
  "absence_days": número de dias de afastamento,
  "absence_hours": "horários se parcial (ex: 08:00-12:00) ou vazio",
  "is_partial": true ou false se é atestado parcial (horas),
  "notes": "observações relevantes do atestado"
}
Se algum campo não for legível ou não estiver presente, use string vazia "" ou 0 para números. Responda APENAS com o JSON, sem texto adicional.`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analise este atestado médico e extraia as informações:' },
          { type: 'image_url', image_url: { url: resolvedUrl } }
        ]
      }
    ];

    const result = await callAI(aiConfig, messages, { temperature: 0.1, maxTokens: 800 });
    
    let parsed = {};
    try {
      const jsonStr = (result.content || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      logError('rh.analyze-certificate.parse', { raw: result.content });
      return res.status(422).json({ error: 'Não foi possível extrair dados do atestado. Tente uma imagem mais nítida.' });
    }

    logInfo('rh.analyze-certificate', { parsed });
    res.json({ success: true, data: parsed });
  } catch (err) {
    logError('rh.analyze-certificate', err);
    res.status(500).json({ error: 'Erro ao analisar atestado' });
  }
});

// ===== CRM VALIDATION =====
router.post('/validate-crm', async (req, res) => {
  try {
    const { crm, uf } = req.body;
    if (!crm || !uf) return res.status(400).json({ error: 'CRM e UF são obrigatórios' });

    const cleanCrm = crm.replace(/\D/g, '');
    const cleanUf = uf.toUpperCase().trim();

    // Use CFM portal search
    const url = `https://portal.cfm.org.br/api/public/medicos?crm=${cleanCrm}&uf=${cleanUf}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      // Fallback: try alternative endpoint
      const altUrl = `https://www.consultacrm.com.br/api/index.php?tipo=crm&q=${cleanCrm}&chave=1173&destession=&ession=&ession=`;
      try {
        const altResp = await fetch(altUrl, { 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (altResp.ok) {
          const altData = await altResp.json();
          const items = altData?.item || [];
          const match = items.find(i => i.uf?.toUpperCase() === cleanUf);
          if (match) {
            return res.json({
              valid: match.situacao?.toLowerCase().includes('regular') || match.situacao?.toLowerCase().includes('ativo'),
              doctor_name: match.nome || '',
              situation: match.situacao || 'Desconhecida',
              specialty: match.especialidade || '',
              source: 'consultacrm',
            });
          }
        }
      } catch { /* ignore fallback errors */ }

      return res.json({ valid: null, message: 'Não foi possível verificar o CRM no momento. Tente novamente mais tarde.' });
    }

    const data = await response.json();
    const medicos = data?.dados || data?.items || (Array.isArray(data) ? data : []);
    
    if (medicos.length === 0) {
      return res.json({ valid: false, message: 'CRM não encontrado no CFM.' });
    }

    const medico = medicos[0];
    const situacao = medico.situacao || medico.status || '';
    const isValid = situacao.toLowerCase().includes('regular') || situacao.toLowerCase().includes('ativo');

    res.json({
      valid: isValid,
      doctor_name: medico.nome || medico.name || '',
      situation: situacao,
      specialty: medico.especialidade || medico.specialty || '',
      source: 'cfm',
    });
  } catch (err) {
    logError('rh.validate-crm', err);
    res.json({ valid: null, message: 'Erro ao consultar CRM. Serviço pode estar indisponível.' });
  }
});

// ===== HOLIDAYS =====

// List holidays
router.get('/holidays', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);

    const { year, type } = req.query;
    const params = [orgId];
    let sql = `SELECT * FROM holidays WHERE organization_id = $1 AND active = true`;

    if (year) {
      sql += ` AND EXTRACT(YEAR FROM holiday_date) = $${params.length + 1}`;
      params.push(Number(year));
    }

    if (type) {
      sql += ` AND type = $${params.length + 1}`;
      params.push(type);
    }

    sql += ` ORDER BY holiday_date ASC, name ASC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) {
    logError('rh.holidays.list', err);
    res.status(500).json({ error: err.message });
  }
});

// Create holiday
router.post('/holidays', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const { name, holiday_date, type, state, city, recurring } = req.body;
    if (!name || !holiday_date) return res.status(400).json({ error: 'Nome e data obrigatórios' });

    const r = await query(
      `INSERT INTO holidays (organization_id, name, holiday_date, type, state, city, recurring)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, name, holiday_date) DO UPDATE SET
         type = EXCLUDED.type,
         state = EXCLUDED.state,
         city = EXCLUDED.city,
         recurring = EXCLUDED.recurring,
         active = true,
         updated_at = NOW()
       RETURNING *`,
      [orgId, name, holiday_date, type || 'nacional', emptyToNull(state), emptyToNull(city), recurring !== false]
    );
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.holidays.create', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk import holidays (from CSV/Excel)
router.post('/holidays/bulk', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const { holidays } = req.body;
    if (!Array.isArray(holidays) || !holidays.length) return res.status(400).json({ error: 'Lista de feriados vazia' });

    let imported = 0;
    for (const h of holidays) {
      if (!h.name || !h.holiday_date) continue;
      await query(
        `INSERT INTO holidays (organization_id, name, holiday_date, type, state, city, recurring)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id, name, holiday_date) DO UPDATE SET
           type = EXCLUDED.type,
           state = EXCLUDED.state,
           city = EXCLUDED.city,
           recurring = EXCLUDED.recurring,
           active = true,
           updated_at = NOW()`,
        [orgId, h.name, h.holiday_date, h.type || 'nacional', emptyToNull(h.state), emptyToNull(h.city), h.recurring !== false]
      );
      imported++;
    }

    res.json({ imported });
  } catch (err) {
    logError('rh.holidays.bulk', err);
    res.status(500).json({ error: err.message });
  }
});

// Update holiday
router.put('/holidays/:id', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const { name, holiday_date, type, state, city, recurring, active } = req.body;
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { fields.push(`name = $${i++}`); values.push(name); }
    if (holiday_date !== undefined) { fields.push(`holiday_date = $${i++}`); values.push(holiday_date); }
    if (type !== undefined) { fields.push(`type = $${i++}`); values.push(type); }
    if (state !== undefined) { fields.push(`state = $${i++}`); values.push(emptyToNull(state)); }
    if (city !== undefined) { fields.push(`city = $${i++}`); values.push(emptyToNull(city)); }
    if (recurring !== undefined) { fields.push(`recurring = $${i++}`); values.push(!!recurring); }
    if (active !== undefined) { fields.push(`active = $${i++}`); values.push(!!active); }
    if (!fields.length) return res.status(400).json({ error: 'Nada a atualizar' });
    fields.push(`updated_at = NOW()`);
    values.push(req.params.id, orgId);
    const r = await query(
      `UPDATE holidays SET ${fields.join(', ')} WHERE id = $${i++} AND organization_id = $${i} RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Feriado não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.holidays.update', err); res.status(500).json({ error: err.message }); }
});

// Delete holiday
router.delete('/holidays/:id', async (req, res) => {
  try {
    await query(`DELETE FROM holidays WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.holidays.delete', err); res.status(500).json({ error: err.message }); }
});


// ===== SERVICE REGIONS (auto-heal) =====
let regionsInfraPromise = null;
async function ensureRegionsInfrastructure() {
  if (!regionsInfraPromise) {
    regionsInfraPromise = (async () => {
      // Try with FK first, fall back without FK if organizations table missing
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS service_regions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            color VARCHAR(7) DEFAULT '#3b82f6',
            polygon JSONB DEFAULT '[]',
            cities JSONB DEFAULT '[]',
            states JSONB DEFAULT '[]',
            supervisor_id UUID,
            active BOOLEAN DEFAULT true,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
      } catch (_fkErr) {
        await query(`
          CREATE TABLE IF NOT EXISTS service_regions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id UUID NOT NULL,
            name VARCHAR(255) NOT NULL,
            color VARCHAR(7) DEFAULT '#3b82f6',
            polygon JSONB DEFAULT '[]',
            cities JSONB DEFAULT '[]',
            states JSONB DEFAULT '[]',
            supervisor_id UUID,
            active BOOLEAN DEFAULT true,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
      }
      await query(`CREATE INDEX IF NOT EXISTS idx_service_regions_org ON service_regions(organization_id)`);

      // Ensure all columns exist (safe for already-created tables)
      const cols = [
        ['organization_id', 'UUID'],
        ['color', "VARCHAR(7) DEFAULT '#3b82f6'"],
        ['polygon', "JSONB DEFAULT '[]'"],
        ['cities', "JSONB DEFAULT '[]'"],
        ['states', "JSONB DEFAULT '[]'"],
        ['supervisor_id', 'UUID'],
        ['active', 'BOOLEAN DEFAULT true'],
        ['notes', 'TEXT'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
      ];
      for (const [col, def] of cols) {
        try { await query(`ALTER TABLE service_regions ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (_e) { /* ignore */ }
      }

      try {
        await query(`
          CREATE TABLE IF NOT EXISTS region_pdvs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            region_id UUID NOT NULL REFERENCES service_regions(id) ON DELETE CASCADE,
            pdv_id UUID NOT NULL,
            auto_assigned BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(region_id, pdv_id)
          )
        `);
      } catch (_e) {
        await query(`
          CREATE TABLE IF NOT EXISTS region_pdvs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            region_id UUID NOT NULL,
            pdv_id UUID NOT NULL,
            auto_assigned BOOLEAN DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(region_id, pdv_id)
          )
        `);
      }
      await query(`CREATE INDEX IF NOT EXISTS idx_region_pdvs_region ON region_pdvs(region_id)`);

      // Ensure geo columns
      try { await query(`ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`); } catch (_e) { /* */ }
      try { await query(`ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`); } catch (_e) { /* */ }
      try { await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_latitude NUMERIC(10,7)`); } catch (_e) { /* */ }
      try { await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_longitude NUMERIC(10,7)`); } catch (_e) { /* */ }
    })().catch(err => { regionsInfraPromise = null; throw err; });
  }
  return regionsInfraPromise;
}

// Middleware: ensure tables exist before any region/map route
router.use(['/regions', '/map-data'], async (req, res, next) => {
  try {
    await ensureRegionsInfrastructure();
    next();
  } catch (err) {
    logError('rh.regions.bootstrap', err);
    res.status(500).json({ error: err?.message || 'Erro ao inicializar regiões' });
  }
});

// List regions
router.get('/regions', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const r = await query(
      `SELECT sr.*, e.full_name as supervisor_name,
         (SELECT COUNT(*) FROM region_pdvs rp WHERE rp.region_id = sr.id) as pdv_count
       FROM service_regions sr
       LEFT JOIN employees e ON e.id = sr.supervisor_id
       WHERE sr.organization_id = $1
       ORDER BY sr.name`,
      [orgId]
    );
    res.json(r.rows);
  } catch (err) { logError('rh.regions.list', err); res.status(500).json({ error: err.message }); }
});

// Create region
router.post('/regions', async (req, res) => {
  try {
    const orgId = await getUserOrgId(req.userId);
    const { name, color, polygon, cities, states, supervisor_id, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const r = await query(
      `INSERT INTO service_regions (organization_id, name, color, polygon, cities, states, supervisor_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [orgId, name, color || '#3b82f6', JSON.stringify(polygon || []), JSON.stringify(cities || []), JSON.stringify(states || []), emptyToNull(supervisor_id), emptyToNull(notes)]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.regions.create', err); res.status(500).json({ error: err.message }); }
});

// Update region
router.put('/regions/:id', async (req, res) => {
  try {
    const { name, color, polygon, cities, states, supervisor_id, notes, active } = req.body;
    const r = await query(
      `UPDATE service_regions SET name=$1, color=$2, polygon=$3, cities=$4, states=$5, supervisor_id=$6, notes=$7, active=$8, updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name, color, JSON.stringify(polygon || []), JSON.stringify(cities || []), JSON.stringify(states || []), emptyToNull(supervisor_id), emptyToNull(notes), active !== false, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.regions.update', err); res.status(500).json({ error: err.message }); }
});

// Delete region
router.delete('/regions/:id', async (req, res) => {
  try {
    await query(`DELETE FROM service_regions WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.regions.delete', err); res.status(500).json({ error: err.message }); }
});

// Link PDVs to region
router.post('/regions/:id/pdvs', async (req, res) => {
  try {
    const { pdv_ids, auto_assigned } = req.body;
    if (!Array.isArray(pdv_ids)) return res.status(400).json({ error: 'pdv_ids obrigatório' });
    for (const pdvId of pdv_ids) {
      await query(
        `INSERT INTO region_pdvs (region_id, pdv_id, auto_assigned) VALUES ($1,$2,$3) ON CONFLICT (region_id, pdv_id) DO NOTHING`,
        [req.params.id, pdvId, auto_assigned || false]
      );
    }
    res.json({ ok: true });
  } catch (err) { logError('rh.regions.link-pdvs', err); res.status(500).json({ error: err.message }); }
});

// Get PDVs in a region
router.get('/regions/:id/pdvs', async (req, res) => {
  try {
    const r = await query(
      `SELECT p.*, rp.auto_assigned FROM region_pdvs rp JOIN pdvs p ON p.id = rp.pdv_id WHERE rp.region_id = $1 ORDER BY p.name`,
      [req.params.id]
    );
    res.json(r.rows);
  } catch (err) { logError('rh.regions.pdvs', err); res.status(500).json({ error: err.message }); }
});

// Remove PDV from region
router.delete('/regions/:regionId/pdvs/:pdvId', async (req, res) => {
  try {
    await query(`DELETE FROM region_pdvs WHERE region_id = $1 AND pdv_id = $2`, [req.params.regionId, req.params.pdvId]);
    res.json({ ok: true });
  } catch (err) { logError('rh.regions.remove-pdv', err); res.status(500).json({ error: err.message }); }
});

// ===== GEOCODING (via Nominatim - free) =====
router.post('/geocode', async (req, res) => {
  try {
    const payload = req.body || {};
    const address = payload.address || payload.endereco || '';
    const address_number = payload.address_number || payload.numero || '';
    const complement = payload.complement || payload.complemento || '';
    const neighborhood = payload.neighborhood || payload.bairro || '';
    const city = payload.city || payload.cidade || '';
    const state = payload.state || payload.estado || '';
    const zip_code = payload.zip_code || payload.cep || '';

    const result = await geocodeAddressWithFallback(
      { address, address_number, complement, neighborhood, city, state, zip_code },
      { requireComplete: true }
    );

    if (result.validationError) {
      return res.status(400).json({ error: result.validationError, details: `Busca: ${result.attemptedAddress}`, attempted_address: result.attemptedAddress });
    }

    if (!result.geo) {
      return res.json({ found: false, attempted_address: result.attemptedAddress });
    }

    res.json({
      found: true,
      latitude: result.geo.lat,
      longitude: result.geo.lng,
      display_name: result.geo.display_name,
      attempted_address: result.attemptedAddress,
    });
  } catch (err) { logError('rh.geocode', err); res.status(500).json({ error: err.message }); }
});

// ===== MAP DATA: PDVs + Employees with coords =====
router.get('/map-data', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({ pdvs: [], employees: [], regions: [] });
    const [pdvsR, empsR, regionsR] = await Promise.all([
      query(`SELECT id, name, client_name, address, city, state, latitude, longitude, radius_meters, supervisor_id, active FROM pdvs WHERE organization_id = $1 AND active = true`, [orgId]),
      query(`SELECT id, full_name, position, worker_profile, city, state, home_latitude, home_longitude, photo_url FROM employees WHERE organization_id = $1 AND status = 'ativo'`, [orgId]),
      query(`SELECT sr.*, e.full_name as supervisor_name FROM service_regions sr LEFT JOIN employees e ON e.id = sr.supervisor_id WHERE sr.organization_id = $1 AND sr.active = true`, [orgId]),
    ]);
    res.json({ pdvs: pdvsR.rows, employees: empsR.rows, regions: regionsR.rows });
  } catch (err) { logError('rh.map-data', err); res.status(500).json({ error: err.message }); }
});

router.get('/pdvs', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);

    const result = await query(
      `SELECT p.*, e.full_name as supervisor_name
       FROM pdvs p
       LEFT JOIN employees e ON e.id = p.supervisor_id
       WHERE p.organization_id = $1
       ORDER BY p.name`,
      [orgId]
    );

    res.json(result.rows);
  } catch (err) {
    logError('rh.pdvs.list', err);
    res.status(500).json({ error: err.message || 'Erro ao listar PDVs' });
  }
});

// ─── Facial Recognition Config ───
let facialRecognitionInfraReady = false;
let facialRecognitionInfraPromise = null;

const DEFAULT_FACIAL_CONFIG = {
  enabled: false,
  use_for_attendance: false,
  use_for_checkin: false,
  min_confidence: 70,
  require_photo_registration: true,
  auto_verify_on_clock_in: false,
  allow_manual_fallback: true,
  photo_quality_check: true,
  allow_self_enrollment: false,
};

async function tableExists(tableName) {
  try {
    const r = await query(`SELECT to_regclass($1) AS name`, [`public.${tableName}`]);
    return !!r.rows[0]?.name;
  } catch (err) {
    logError('rh.tableExists.safeSkip', err, { tableName });
    return false;
  }
}

async function safeGetUserOrgId(userId) {
  try {
    if (!userId) return null;
    return await getUserOrgId(userId);
  } catch (err) {
    logError('rh.getUserOrgId.safeSkip', err, { userId });
    return null;
  }
}

async function ensureFacialConfigTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS facial_recognition_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        enabled BOOLEAN DEFAULT false,
        use_for_attendance BOOLEAN DEFAULT false,
        use_for_checkin BOOLEAN DEFAULT false,
        min_confidence NUMERIC(5,2) DEFAULT 70.00,
        require_photo_registration BOOLEAN DEFAULT true,
        auto_verify_on_clock_in BOOLEAN DEFAULT false,
        allow_manual_fallback BOOLEAN DEFAULT true,
        photo_quality_check BOOLEAN DEFAULT true,
        allow_self_enrollment BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(organization_id)
      )
    `);
  } catch (err) {
    if (err?.code !== '42P01') throw err;
    // Banco legado sem tabela organizations pronta: mantém o endpoint funcional e
    // ainda escopado por organization_id, sem quebrar a tela de configuração.
    await query(`
      CREATE TABLE IF NOT EXISTS facial_recognition_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        enabled BOOLEAN DEFAULT false,
        use_for_attendance BOOLEAN DEFAULT false,
        use_for_checkin BOOLEAN DEFAULT false,
        min_confidence NUMERIC(5,2) DEFAULT 70.00,
        require_photo_registration BOOLEAN DEFAULT true,
        auto_verify_on_clock_in BOOLEAN DEFAULT false,
        allow_manual_fallback BOOLEAN DEFAULT true,
        photo_quality_check BOOLEAN DEFAULT true,
        allow_self_enrollment BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facial_config_org_unique ON facial_recognition_config(organization_id)`);
  }

  const columns = [
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT false`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS use_for_attendance BOOLEAN DEFAULT false`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS use_for_checkin BOOLEAN DEFAULT false`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS min_confidence NUMERIC(5,2) DEFAULT 70.00`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS require_photo_registration BOOLEAN DEFAULT true`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS auto_verify_on_clock_in BOOLEAN DEFAULT false`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS allow_manual_fallback BOOLEAN DEFAULT true`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS photo_quality_check BOOLEAN DEFAULT true`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS allow_self_enrollment BOOLEAN DEFAULT false`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE facial_recognition_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of columns) {
    try { await query(sql); } catch (err) { logError('rh.facial-config.alter.safeSkip', err); }
  }
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facial_config_org_unique ON facial_recognition_config(organization_id)`);
}

async function ensureFaceVerificationLogsTable() {
  const hasOrganizations = await tableExists('organizations');
  const hasEmployees = await tableExists('employees');
  const hasAgencyPromoters = await tableExists('agency_promoters');
  const organizationRef = hasOrganizations ? ` REFERENCES organizations(id) ON DELETE CASCADE` : '';
  const employeeRef = hasEmployees ? ` REFERENCES employees(id) ON DELETE SET NULL` : '';
  const agencyRef = hasAgencyPromoters ? ` REFERENCES agency_promoters(id) ON DELETE SET NULL` : '';

  await query(`
    CREATE TABLE IF NOT EXISTS face_verification_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL${organizationRef},
      employee_id UUID${employeeRef},
      agency_promoter_id UUID${agencyRef},
      verification_context VARCHAR(30) NOT NULL,
      confidence_score NUMERIC(5,2),
      result VARCHAR(20) NOT NULL,
      captured_image_url TEXT,
      device_info TEXT,
      ip_address VARCHAR(45),
      processing_time_ms INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const columns = [
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS organization_id UUID`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS employee_id UUID`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS agency_promoter_id UUID`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS verification_context VARCHAR(30)`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,2)`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS result VARCHAR(20)`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS captured_image_url TEXT`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS device_info TEXT`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER`,
    `ALTER TABLE face_verification_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  ];
  for (const sql of columns) {
    try { await query(sql); } catch (err) { logError('rh.face-logs.alter.safeSkip', err); }
  }
}

async function ensureFacialRecognitionInfra() {
  if (facialRecognitionInfraReady) return;
  if (!facialRecognitionInfraPromise) {
    facialRecognitionInfraPromise = (async () => {
      await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await ensureFacialConfigTable();
      try {
        await ensureFaceVerificationLogsTable();
        await query(`CREATE INDEX IF NOT EXISTS idx_face_verify_org ON face_verification_logs(organization_id, created_at)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_face_verify_employee ON face_verification_logs(employee_id, created_at)`);
      } catch (err) {
        // Logs não podem derrubar a tela de configuração/listagem facial.
        logError('rh.face-logs.ensure.safeSkip', err);
      }
      facialRecognitionInfraReady = true;
    })().catch((err) => {
      facialRecognitionInfraPromise = null;
      throw err;
    });
  }
  return facialRecognitionInfraPromise;
}

router.get('/facial-recognition/config', async (req, res) => {
  try {
    await ensureFacialRecognitionInfra();
    const orgId = req.query.org_id || await safeGetUserOrgId(req.userId);
    if (!orgId) return res.json(DEFAULT_FACIAL_CONFIG);
    const result = await query(
      `SELECT * FROM facial_recognition_config WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    );
    if (result.rows.length === 0) {
      return res.json({ ...DEFAULT_FACIAL_CONFIG, organization_id: orgId });
    }
    res.json({ ...DEFAULT_FACIAL_CONFIG, ...result.rows[0] });
  } catch (err) {
    logError('rh.facial-config.get', err);
    res.json(DEFAULT_FACIAL_CONFIG);
  }
});

router.put('/facial-recognition/config', async (req, res) => {
  try {
    await ensureFacialRecognitionInfra();
    const orgId = req.body.organization_id || await safeGetUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });

    const d = {
      enabled: !!req.body.enabled,
      use_for_attendance: !!req.body.use_for_attendance,
      use_for_checkin: !!req.body.use_for_checkin,
      min_confidence: Number(req.body.min_confidence) || 70,
      require_photo_registration: req.body.require_photo_registration !== false,
      auto_verify_on_clock_in: !!req.body.auto_verify_on_clock_in,
      allow_manual_fallback: req.body.allow_manual_fallback !== false,
      photo_quality_check: req.body.photo_quality_check !== false,
      allow_self_enrollment: !!req.body.allow_self_enrollment,
    };

    const result = await query(
      `INSERT INTO facial_recognition_config (
         organization_id, enabled, use_for_attendance, use_for_checkin, min_confidence,
         require_photo_registration, auto_verify_on_clock_in, allow_manual_fallback, photo_quality_check,
         allow_self_enrollment
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organization_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         use_for_attendance = EXCLUDED.use_for_attendance,
         use_for_checkin = EXCLUDED.use_for_checkin,
         min_confidence = EXCLUDED.min_confidence,
         require_photo_registration = EXCLUDED.require_photo_registration,
         auto_verify_on_clock_in = EXCLUDED.auto_verify_on_clock_in,
         allow_manual_fallback = EXCLUDED.allow_manual_fallback,
         photo_quality_check = EXCLUDED.photo_quality_check,
         allow_self_enrollment = EXCLUDED.allow_self_enrollment,
         updated_at = NOW()
       RETURNING *`,
      [
        orgId,
        d.enabled,
        d.use_for_attendance,
        d.use_for_checkin,
        d.min_confidence,
        d.require_photo_registration,
        d.auto_verify_on_clock_in,
        d.allow_manual_fallback,
        d.photo_quality_check,
        d.allow_self_enrollment,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logError('rh.facial-config.put', err);
    res.status(500).json({ error: err.message || 'Erro ao salvar configuração da biometria facial' });
  }
});

// ─── Facial Enrollment for Employees ───

// Ensure employees have face_descriptor column
let faceEnrollColumnReady = false;
async function ensureFaceEnrollColumn() {
  if (faceEnrollColumnReady) return;
  if (!(await tableExists('employees'))) return;
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_descriptor JSONB`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_photo_url TEXT`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_collection_requested BOOLEAN DEFAULT false`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_collection_requested_at TIMESTAMPTZ`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_quality_score NUMERIC(5,2)`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS facial_required BOOLEAN`);
  _employeeColsCache = null;
  faceEnrollColumnReady = true;
}

function employeeColumnSql(cols, name, fallback = 'NULL') {
  return cols.has(name) ? `e.${name}` : `${fallback}`;
}

// Considered "listable" for facial biometrics: anyone not terminated / inactive.
// Previous filter (only 'ativo'/'active') was hiding employees created under new
// holding/company scaffolding that come in with empty or other status values.
const LISTABLE_EMPLOYEE_STATUS_SQL = `COALESCE(NULLIF(TRIM(e.status::text), ''), 'ativo') NOT IN ('desligado','inativo','inactive','terminated','demitido')`;

// List employees with facial enrollment status
router.get('/facial-recognition/employees', async (req, res) => {
  try {
    await ensureFacialRecognitionInfra();
    await ensureFaceEnrollColumn();
    if (!(await tableExists('employees'))) return res.json([]);
    const orgId = req.query.org_id || await safeGetUserOrgId(req.userId);
    if (!orgId) return res.json([]);

    const { filter, company_id } = req.query; // 'all' | 'enrolled' | 'pending'
    const cols = await getEmployeeColumns();
    const statusFilter = cols.has('status') ? ` AND ${LISTABLE_EMPLOYEE_STATUS_SQL}` : '';
    const faceDescriptorSql = cols.has('face_descriptor') ? `e.face_descriptor IS NOT NULL` : `false`;
    const facialRequiredSql = cols.has('facial_required') ? `COALESCE(e.facial_required, true)` : `true`;
    let sql = `SELECT e.id, e.full_name,
                      ${employeeColumnSql(cols, 'photo_url')} as photo_url,
                      ${employeeColumnSql(cols, 'cpf')} as cpf,
                      ${employeeColumnSql(cols, 'position')} as position,
                      ${employeeColumnSql(cols, 'status', `'ativo'`)} as status,
                      ${employeeColumnSql(cols, 'company_id')} as company_id,
                      ${employeeColumnSql(cols, 'branch_id')} as branch_id,
                      ${facialRequiredSql} as facial_verification_enabled,
                      ${faceDescriptorSql} as face_enrolled,
                      ${employeeColumnSql(cols, 'face_photo_url')} as face_photo_url,
                      ${employeeColumnSql(cols, 'face_enrolled_at')} as face_enrolled_at,
                      COALESCE(${employeeColumnSql(cols, 'face_collection_requested', 'false')}, false) as face_collection_requested,
                      ${employeeColumnSql(cols, 'face_collection_requested_at')} as face_collection_requested_at
               FROM employees e
               WHERE e.organization_id = $1${statusFilter}`;
    const params = [orgId];
    let idx = 2;

    if (company_id && cols.has('company_id')) { sql += ` AND e.company_id = $${idx++}`; params.push(company_id); }
    if (filter === 'enrolled') sql += cols.has('face_descriptor') ? ` AND e.face_descriptor IS NOT NULL` : ` AND false`;
    else if (filter === 'pending' && cols.has('face_descriptor')) sql += ` AND e.face_descriptor IS NULL`;

    sql += cols.has('face_descriptor') ? ` ORDER BY e.face_descriptor IS NULL DESC, e.full_name` : ` ORDER BY e.full_name`;
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logError('rh.facial.employees', err);
    res.json([]);
  }
});

// List employees for whom facial verification was explicitly disabled.
// This feeds the warning card on the RH dashboard.
router.get('/facial-recognition/disabled-alerts', async (req, res) => {
  try {
    await ensureFaceEnrollColumn();
    if (!(await tableExists('employees'))) return res.json([]);

    const orgId = req.query.org_id || await safeGetUserOrgId(req.userId);
    if (!orgId) return res.json([]);

    const cols = await getEmployeeColumns();
    if (!cols.has('facial_required')) return res.json([]);

    const positionSql = employeeColumnSql(cols, 'position');
    const updatedAtSql = employeeColumnSql(cols, 'updated_at');
    const statusFilter = cols.has('status') ? ` AND ${LISTABLE_EMPLOYEE_STATUS_SQL}` : '';
    const result = await query(
      `SELECT e.id, e.full_name,
              ${positionSql} AS position,
              ${updatedAtSql} AS updated_at
         FROM employees e
        WHERE e.organization_id = $1
          AND e.facial_required = false${statusFilter}
        ORDER BY ${updatedAtSql} DESC NULLS LAST, e.full_name`,
      [orgId]
    );

    res.json(result.rows);
  } catch (err) {
    logError('rh.facial.disabled-alerts', err);
    res.status(500).json({ error: 'Erro ao carregar alertas de reconhecimento facial' });
  }
});

// RH requests a new facial collection from the employee (unlocks self-enroll in app)
router.post('/facial-recognition/request-collection/:employeeId', async (req, res) => {
  try {
    await ensureFaceEnrollColumn();
    if (!(await tableExists('employees'))) return res.status(404).json({ error: 'Colaboradores não encontrados' });
    await query(
      `UPDATE employees SET face_collection_requested = true, face_collection_requested_at = NOW() WHERE id = $1`,
      [req.params.employeeId]
    );
    res.json({ success: true });
  } catch (err) {
    logError('rh.facial.request-collection', err);
    res.status(500).json({ error: err.message });
  }
});

// Ativa/desativa exigência de verificação facial por colaborador
router.put('/facial-recognition/toggle-verification/:employeeId', async (req, res) => {
  try {
    await ensureFaceEnrollColumn();
    if (!(await tableExists('employees'))) return res.status(404).json({ error: 'Colaboradores não encontrados' });
    const enabled = req.body?.enabled !== false;
    const cols = await getEmployeeColumns();
    const updatedAtSql = cols.has('updated_at') ? ', updated_at = NOW()' : '';
    await query(
      `UPDATE employees SET facial_required = $1${updatedAtSql} WHERE id = $2`,
      [enabled, req.params.employeeId]
    );
    res.json({ success: true, enabled });
  } catch (err) {
    logError('rh.facial.toggle-verification', err);
    res.status(500).json({ error: err.message });
  }
});

// Enroll employee face
router.post('/facial-recognition/enroll/:employeeId', async (req, res) => {
  try {
    await ensureFacialRecognitionInfra();
    await ensureFaceEnrollColumn();
    const { employeeId } = req.params;
    const { descriptor, landmarks, imageDataUrl, geometricProfile } = req.body;

    if (!descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ error: 'Descriptor facial é obrigatório' });
    }

    const faceData = { descriptor, landmarks, geometricProfile };

    await query(
      `UPDATE employees SET
         face_descriptor = $1,
         face_photo_url = $2,
         face_enrolled_at = NOW(),
         face_collection_requested = false,
         face_collection_requested_at = NULL
       WHERE id = $3`,
      [JSON.stringify(faceData), imageDataUrl || null, employeeId]
    );

    // Log the enrollment
    const emp = await query(`SELECT organization_id FROM employees WHERE id = $1`, [employeeId]);
    if (emp.rows[0]) {
      await query(
        `INSERT INTO face_verification_logs
         (organization_id, employee_id, verification_context, confidence_score, result, captured_image_url)
         VALUES ($1, $2, 'enrollment', 100, 'approved', $3)`,
        [emp.rows[0].organization_id, employeeId, imageDataUrl || null]
      );
    }

    res.json({ success: true });
  } catch (err) {
    logError('rh.facial.enroll', err);
    res.status(500).json({ error: err.message });
  }
});

// Remove employee face enrollment
router.delete('/facial-recognition/enroll/:employeeId', async (req, res) => {
  try {
    await ensureFaceEnrollColumn();
    await query(
      `UPDATE employees SET face_descriptor = NULL, face_photo_url = NULL, face_enrolled_at = NULL WHERE id = $1`,
      [req.params.employeeId]
    );
    res.json({ success: true });
  } catch (err) {
    logError('rh.facial.remove', err);
    res.status(500).json({ error: err.message });
  }
});

// Get face descriptor for testing verification
router.get('/facial-recognition/descriptor/:employeeId', async (req, res) => {
  try {
    await ensureFaceEnrollColumn();
    const { rows } = await query(
      `SELECT face_descriptor, face_photo_url, full_name FROM employees WHERE id = $1`,
      [req.params.employeeId]
    );
    if (!rows.length || !rows[0].face_descriptor) {
      return res.status(404).json({ error: 'Sem dados faciais cadastrados' });
    }
    const desc = typeof rows[0].face_descriptor === 'string'
      ? JSON.parse(rows[0].face_descriptor)
      : rows[0].face_descriptor;
    const descriptor = Array.isArray(desc)
      ? desc
      : Array.isArray(desc?.descriptor)
        ? desc.descriptor
        : [];

    if (!descriptor.length) {
      return res.status(422).json({ error: 'Dados faciais inválidos para teste' });
    }

    res.json({
      descriptor,
      photo_url: rows[0].face_photo_url,
      name: rows[0].full_name,
    });
  } catch (err) {
    logError('rh.facial.descriptor', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FASE 4 — DASHBOARD RH (Analytics)
//   GET /api/rh/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD
//                       &company_id=&department_id=
// ============================================================
router.get('/analytics', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({});

    const today = new Date();
    const defaultEnd = today.toISOString().slice(0, 10);
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultStart = first.toISOString().slice(0, 10);

    const start = req.query.start || defaultStart;
    const end = req.query.end || defaultEnd;
    const companyId = req.query.company_id || null;
    const departmentId = req.query.department_id || null;

    const empFilter = [`e.organization_id = $1`];
    const empParams = [orgId];
    let idx = 2;
    if (companyId) { empFilter.push(`e.company_id = $${idx++}`); empParams.push(companyId); }
    if (departmentId) { empFilter.push(`e.department_id = $${idx++}`); empParams.push(departmentId); }
    const empWhere = empFilter.join(' AND ');

    // Days in period (for absenteeism rate)
    const periodDays = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
    const workingDays = Math.max(1, Math.round(periodDays * (5 / 7)));

    // ---------- 1. HEADCOUNT + STATUS ----------
    const headcount = await query(
      `SELECT
        COUNT(*) FILTER (WHERE e.status = 'ativo') AS active,
        COUNT(*) FILTER (WHERE e.status = 'ferias') AS on_vacation,
        COUNT(*) FILTER (WHERE e.status = 'afastado') AS on_leave,
        COUNT(*) FILTER (WHERE e.status = 'inativo') AS inactive,
        COUNT(*) AS total
      FROM employees e WHERE ${empWhere}`,
      empParams
    );

    // ---------- 2. ADMISSÕES / DESLIGAMENTOS ----------
    const admissions = await query(
      `SELECT COUNT(*)::int AS n FROM employees e
       WHERE ${empWhere} AND e.admission_date BETWEEN $${idx} AND $${idx + 1}`,
      [...empParams, start, end]
    );
    const dismissals = await query(
      `SELECT COUNT(*)::int AS n FROM employees e
       WHERE ${empWhere} AND e.termination_date BETWEEN $${idx} AND $${idx + 1}`,
      [...empParams, start, end]
    );

    const active = Number(headcount.rows[0]?.active || 0);
    const dism = Number(dismissals.rows[0]?.n || 0);
    const adm = Number(admissions.rows[0]?.n || 0);
    const turnoverPct = active > 0 ? Number((((adm + dism) / 2 / active) * 100).toFixed(2)) : 0;

    // ---------- 3. TURNOVER MENSAL (12m) ----------
    let turnoverMonthly = { rows: [] };
    try {
      turnoverMonthly = await query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
             date_trunc('month', CURRENT_DATE),
             INTERVAL '1 month'
           )::date AS m
         )
         SELECT
           to_char(m, 'YYYY-MM') AS month,
           (SELECT COUNT(*)::int FROM employees e
             WHERE ${empWhere} AND date_trunc('month', e.admission_date) = m) AS admissions,
           (SELECT COUNT(*)::int FROM employees e
             WHERE ${empWhere} AND date_trunc('month', e.termination_date) = m) AS dismissals
         FROM months ORDER BY m`,
        empParams
      );
    } catch (e) { /* ignore */ }

    // ---------- 4. HORAS EXTRAS POR DEPARTAMENTO ----------
    let overtimeByDept = { rows: [] };
    try {
      overtimeByDept = await query(
        `SELECT COALESCE(d.name, 'Sem departamento') AS department,
                COALESCE(SUM(tr.overtime_hours), 0)::numeric(10,2) AS overtime_hours,
                COUNT(DISTINCT tr.employee_id)::int AS employees_count
         FROM time_records tr
         JOIN employees e ON e.id = tr.employee_id
         LEFT JOIN rh_departments d ON d.id = e.department_id
         WHERE ${empWhere} AND tr.record_date BETWEEN $${idx} AND $${idx + 1}
         GROUP BY d.name ORDER BY overtime_hours DESC`,
        [...empParams, start, end]
      );
    } catch (e) { /* ignore */ }

    const totalOvertime = overtimeByDept.rows.reduce((s, r) => s + Number(r.overtime_hours || 0), 0);

    // ---------- 5. ABSENTEÍSMO ----------
    let absencesByType = { rows: [] };
    try {
      absencesByType = await query(
        `SELECT tr.status AS type, COUNT(*)::int AS n
         FROM time_records tr JOIN employees e ON e.id = tr.employee_id
         WHERE ${empWhere} AND tr.record_date BETWEEN $${idx} AND $${idx + 1}
           AND tr.status IN ('falta','atestado','licenca','afastamento')
         GROUP BY tr.status`,
        [...empParams, start, end]
      );
    } catch (e) { /* ignore */ }

    const totalAbsences = absencesByType.rows.reduce((s, r) => s + Number(r.n || 0), 0);
    const absenteeismRate = active > 0
      ? Number(((totalAbsences / (active * workingDays)) * 100).toFixed(2))
      : 0;

    let topAbsentees = { rows: [] };
    try {
      topAbsentees = await query(
        `SELECT e.id, e.full_name, COUNT(*)::int AS absences
         FROM time_records tr JOIN employees e ON e.id = tr.employee_id
         WHERE ${empWhere} AND tr.record_date BETWEEN $${idx} AND $${idx + 1}
           AND tr.status IN ('falta','atestado')
         GROUP BY e.id, e.full_name
         HAVING COUNT(*) > 0
         ORDER BY absences DESC LIMIT 5`,
        [...empParams, start, end]
      );
    } catch (e) { /* ignore */ }

    // ---------- 6. ATRASOS ----------
    let latesByDay = { rows: [] };
    try {
      latesByDay = await query(
        `SELECT tr.record_date AS day,
                COUNT(*) FILTER (
                  WHERE tr.entry1 IS NOT NULL AND e.work_schedule IS NOT NULL
                    AND tr.entry1 > CAST(SPLIT_PART(e.work_schedule, '-', 1) || ':00' AS TIME) + INTERVAL '5 minutes'
                )::int AS lates
         FROM time_records tr JOIN employees e ON e.id = tr.employee_id
         WHERE ${empWhere} AND tr.record_date BETWEEN $${idx} AND $${idx + 1}
         GROUP BY tr.record_date ORDER BY tr.record_date`,
        [...empParams, start, end]
      );
    } catch (e) { /* ignore */ }

    const totalLates = latesByDay.rows.reduce((s, r) => s + Number(r.lates || 0), 0);

    // ---------- 7. DISTRIBUIÇÃO POR DEPARTAMENTO ----------
    const byDept = await query(
      `SELECT COALESCE(d.name, 'Sem departamento') AS name,
              COUNT(*)::int AS count
       FROM employees e LEFT JOIN rh_departments d ON d.id = e.department_id
       WHERE ${empWhere} AND e.status = 'ativo'
       GROUP BY d.name ORDER BY count DESC`,
      empParams
    );

    // ---------- 8. DISTRIBUIÇÃO POR EMPRESA ----------
    let byCompany = { rows: [] };
    try {
      byCompany = await query(
        `SELECT COALESCE(c.name, 'Sem empresa') AS name, COUNT(*)::int AS count
         FROM employees e LEFT JOIN companies c ON c.id = e.company_id
         WHERE ${empWhere} AND e.status = 'ativo'
         GROUP BY c.name ORDER BY count DESC`,
        empParams
      );
    } catch (e) { /* ignore */ }

    // ---------- 9. ANIVERSARIANTES DO MÊS ----------
    let birthdays = { rows: [] };
    try {
      birthdays = await query(
        `SELECT e.id, e.full_name, e.birth_date, e.position
         FROM employees e
         WHERE ${empWhere} AND e.status = 'ativo' AND e.birth_date IS NOT NULL
           AND EXTRACT(MONTH FROM e.birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
         ORDER BY EXTRACT(DAY FROM e.birth_date)`,
        empParams
      );
    } catch (e) { /* ignore */ }

    res.json({
      period: { start, end, working_days: workingDays },
      kpis: {
        headcount_active: active,
        headcount_total: Number(headcount.rows[0]?.total || 0),
        on_vacation: Number(headcount.rows[0]?.on_vacation || 0),
        on_leave: Number(headcount.rows[0]?.on_leave || 0),
        admissions: adm,
        dismissals: dism,
        turnover_pct: turnoverPct,
        overtime_hours: Number(totalOvertime.toFixed(2)),
        absenteeism_pct: absenteeismRate,
        absences_total: totalAbsences,
        lates_total: totalLates,
      },
      turnover_monthly: turnoverMonthly.rows,
      overtime_by_department: overtimeByDept.rows,
      absences_by_type: absencesByType.rows,
      top_absentees: topAbsentees.rows,
      lates_by_day: latesByDay.rows,
      by_department: byDept.rows,
      by_company: byCompany.rows,
      birthdays: birthdays.rows,
    });
  } catch (err) {
    logError('rh.analytics', err);
    res.status(500).json({ error: 'Erro ao carregar analytics' });
  }
});

// ============================================================
// FASE 9 - FÉRIAS COLETIVAS
// ============================================================
async function ensureCollectiveVacationsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_collective_vacations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      scope TEXT NOT NULL DEFAULT 'company',
      company_ids UUID[] DEFAULT '{}',
      branch_ids UUID[] DEFAULT '{}',
      department_ids UUID[] DEFAULT '{}',
      employee_ids UUID[] DEFAULT '{}',
      exclude_employee_ids UUID[] DEFAULT '{}',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      days_total INTEGER NOT NULL,
      abono_pecuniario BOOLEAN DEFAULT false,
      abono_days INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planejada',
      notice_sent_at TIMESTAMPTZ,
      union_notified BOOLEAN DEFAULT false,
      mte_notified BOOLEAN DEFAULT false,
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE rh_vacations ADD COLUMN IF NOT EXISTS collective_id UUID`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rh_vacations_collective ON rh_vacations(collective_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_rh_collective_vacations_org ON rh_collective_vacations(organization_id, start_date)`);
}

async function resolveCollectiveEmployees(orgId, payload) {
  const parts = [`organization_id = $1`, `status IN ('ativo','afastado')`];
  const params = [orgId];
  let idx = 2;
  const anyFilter = (payload.company_ids?.length || payload.branch_ids?.length || payload.department_ids?.length || payload.employee_ids?.length);
  if (payload.employee_ids?.length) {
    parts.push(`id = ANY($${idx++}::uuid[])`);
    params.push(payload.employee_ids);
  } else {
    const subs = [];
    if (payload.company_ids?.length) { subs.push(`company_id = ANY($${idx++}::uuid[])`); params.push(payload.company_ids); }
    if (payload.branch_ids?.length) { subs.push(`branch_id = ANY($${idx++}::uuid[])`); params.push(payload.branch_ids); }
    if (payload.department_ids?.length) { subs.push(`department_id = ANY($${idx++}::uuid[])`); params.push(payload.department_ids); }
    if (subs.length) parts.push(`(${subs.join(' OR ')})`);
  }
  if (!anyFilter && payload.scope !== 'company') return [];
  if (payload.exclude_employee_ids?.length) {
    parts.push(`id <> ALL($${idx++}::uuid[])`);
    params.push(payload.exclude_employee_ids);
  }
  const sql = `SELECT id, full_name, position, department_id, branch_id, company_id, admission_date FROM employees WHERE ${parts.join(' AND ')} ORDER BY full_name`;
  const r = await query(sql, params);
  return r.rows;
}

function daysBetween(start, end) {
  const s = new Date(start); const e = new Date(end);
  return Math.round((e - s) / 86400000) + 1;
}

// Preview: simulate affected employees before creating
router.post('/vacations/collective/preview', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({ employees: [], total: 0, conflicts: [] });
    const employees = await resolveCollectiveEmployees(orgId, req.body);
    const empIds = employees.map(e => e.id);
    let conflicts = [];
    if (empIds.length && req.body.start_date && req.body.end_date) {
      const c = await query(
        `SELECT v.id, v.employee_id, e.full_name, v.start_date, v.end_date, v.vacation_type
         FROM rh_vacations v JOIN employees e ON e.id = v.employee_id
         WHERE v.employee_id = ANY($1::uuid[])
           AND v.status IN ('agendada','em_andamento')
           AND daterange(v.start_date, v.end_date, '[]') && daterange($2::date, $3::date, '[]')`,
        [empIds, req.body.start_date, req.body.end_date]
      );
      conflicts = c.rows;
    }
    res.json({ employees, total: employees.length, conflicts, days_total: req.body.start_date && req.body.end_date ? daysBetween(req.body.start_date, req.body.end_date) : 0 });
  } catch (err) { logError('rh.collective.preview', err); res.status(500).json({ error: 'Erro ao simular férias coletivas' }); }
});

// List collective vacations
router.get('/vacations/collective', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const r = await query(
      `SELECT c.*, (SELECT COUNT(*) FROM rh_vacations v WHERE v.collective_id = c.id) as employees_count
       FROM rh_collective_vacations c WHERE c.organization_id = $1 ORDER BY c.start_date DESC`,
      [orgId]
    );
    res.json(r.rows);
  } catch (err) { logError('rh.collective.list', err); res.status(500).json({ error: 'Erro' }); }
});

// Get detail with affected employees
router.get('/vacations/collective/:id', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const c = await query(`SELECT * FROM rh_collective_vacations WHERE id = $1`, [req.params.id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    const vacs = await query(
      `SELECT v.*, e.full_name as employee_name, e.position
       FROM rh_vacations v JOIN employees e ON e.id = v.employee_id
       WHERE v.collective_id = $1 ORDER BY e.full_name`,
      [req.params.id]
    );
    res.json({ ...c.rows[0], employees: vacs.rows });
  } catch (err) { logError('rh.collective.detail', err); res.status(500).json({ error: 'Erro' }); }
});

// Create collective vacation
router.post('/vacations/collective', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    if (!d.start_date || !d.end_date || !d.title) return res.status(400).json({ error: 'Título, início e fim são obrigatórios' });
    const daysTotal = daysBetween(d.start_date, d.end_date);
    if (daysTotal < 5) return res.status(400).json({ error: 'Férias coletivas mínimas: 5 dias corridos (CLT art. 139)' });

    const employees = await resolveCollectiveEmployees(orgId, d);
    if (!employees.length) return res.status(400).json({ error: 'Nenhum colaborador selecionado' });

    const parent = await query(
      `INSERT INTO rh_collective_vacations (organization_id, title, description, scope, company_ids, branch_ids, department_ids, employee_ids, exclude_employee_ids, start_date, end_date, days_total, abono_pecuniario, abono_days, status, union_notified, mte_notified, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [orgId, d.title, d.description || null, d.scope || 'custom',
        d.company_ids || [], d.branch_ids || [], d.department_ids || [], d.employee_ids || [], d.exclude_employee_ids || [],
        d.start_date, d.end_date, daysTotal, d.abono_pecuniario || false, d.abono_days || 0,
        d.status || 'planejada', d.union_notified || false, d.mte_notified || false, d.notes || null, req.userId]
    );
    const parentId = parent.rows[0].id;

    let created = 0, skipped = 0;
    for (const emp of employees) {
      try {
        const overlap = await query(
          `SELECT 1 FROM rh_vacations WHERE employee_id = $1 AND status IN ('agendada','em_andamento')
           AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')`,
          [emp.id, d.start_date, d.end_date]);
        if (overlap.rowCount && !d.override_conflicts) { skipped++; continue; }
        await query(
          `INSERT INTO rh_vacations (organization_id, employee_id, vacation_type, start_date, end_date, days_total, days_taken, days_remaining, abono_pecuniario, abono_days, status, notes, approved, created_by, collective_id)
           VALUES ($1,$2,'coletiva',$3,$4,$5,$5,0,$6,$7,'agendada',$8,true,$9,$10)`,
          [orgId, emp.id, d.start_date, d.end_date, daysTotal, d.abono_pecuniario || false, d.abono_days || 0,
            `Férias coletivas: ${d.title}`, req.userId, parentId]);
        created++;
      } catch (e) { logError('rh.collective.employeeInsert', e, { employeeId: emp.id }); skipped++; }
    }
    await auditLog(orgId, 'collective_vacation', parentId, 'create',
      [{ field: 'title', oldVal: null, newVal: `${d.title} (${created} colaboradores, ${d.start_date} - ${d.end_date})` }], req.userId);

    res.json({ ...parent.rows[0], created, skipped, total_employees: employees.length });
  } catch (err) { logError('rh.collective.create', err); res.status(500).json({ error: 'Erro ao criar férias coletivas' }); }
});

// Update status/notes
router.put('/vacations/collective/:id', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const d = req.body;
    const r = await query(
      `UPDATE rh_collective_vacations SET title = COALESCE($2,title), description = COALESCE($3,description),
         status = COALESCE($4,status), union_notified = COALESCE($5,union_notified),
         mte_notified = COALESCE($6,mte_notified), notice_sent_at = COALESCE($7,notice_sent_at),
         notes = COALESCE($8,notes), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, d.title, d.description, d.status, d.union_notified, d.mte_notified,
        d.notice_sent ? new Date() : null, d.notes]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.collective.update', err); res.status(500).json({ error: 'Erro' }); }
});

// Cancel collective vacation (removes not-started child vacations)
router.delete('/vacations/collective/:id', async (req, res) => {
  try {
    await ensureCollectiveVacationsTables();
    const today = new Date().toISOString().slice(0, 10);
    await query(`DELETE FROM rh_vacations WHERE collective_id = $1 AND start_date > $2 AND status = 'agendada'`,
      [req.params.id, today]);
    await query(`UPDATE rh_collective_vacations SET status = 'cancelada', updated_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { logError('rh.collective.cancel', err); res.status(500).json({ error: 'Erro ao cancelar' }); }
});

// ============================================================
// FASE 10 - DESLIGAMENTO / RESCISÃO
// ============================================================
async function ensureTerminationsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_terminations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      reason TEXT NOT NULL,
      notice_type TEXT NOT NULL DEFAULT 'indenizado',
      notice_days INTEGER DEFAULT 30,
      notice_start DATE,
      notice_end DATE,
      termination_date DATE NOT NULL,
      last_working_day DATE,
      admission_date DATE,
      base_salary NUMERIC(14,2) DEFAULT 0,
      days_worked_month INTEGER DEFAULT 0,
      salary_proportional NUMERIC(14,2) DEFAULT 0,
      thirteenth_proportional NUMERIC(14,2) DEFAULT 0,
      vacation_proportional NUMERIC(14,2) DEFAULT 0,
      vacation_expired NUMERIC(14,2) DEFAULT 0,
      vacation_third NUMERIC(14,2) DEFAULT 0,
      notice_amount NUMERIC(14,2) DEFAULT 0,
      time_bank_amount NUMERIC(14,2) DEFAULT 0,
      time_bank_minutes INTEGER DEFAULT 0,
      fgts_balance NUMERIC(14,2) DEFAULT 0,
      fgts_fine NUMERIC(14,2) DEFAULT 0,
      other_credits NUMERIC(14,2) DEFAULT 0,
      other_debits NUMERIC(14,2) DEFAULT 0,
      gross_total NUMERIC(14,2) DEFAULT 0,
      net_total NUMERIC(14,2) DEFAULT 0,
      checklist JSONB DEFAULT '[]'::jsonb,
      documents JSONB DEFAULT '[]'::jsonb,
      interview_notes TEXT,
      status TEXT NOT NULL DEFAULT 'em_andamento',
      homologated_at TIMESTAMPTZ,
      homologated_by UUID,
      cancelled_at TIMESTAMPTZ,
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_terminations_org ON rh_terminations(organization_id, termination_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_terminations_emp ON rh_terminations(employee_id)`);
}

const DEFAULT_CHECKLIST = [
  { key: 'uniforme', label: 'Devolução de uniformes', done: false },
  { key: 'cracha', label: 'Devolução de crachá', done: false },
  { key: 'equipamentos', label: 'Devolução de equipamentos (notebook, celular)', done: false },
  { key: 'epis', label: 'Devolução de EPIs', done: false },
  { key: 'chaves', label: 'Devolução de chaves/acessos', done: false },
  { key: 'exame', label: 'Exame demissional realizado', done: false },
  { key: 'acesso_sistemas', label: 'Revogação de acessos aos sistemas', done: false },
  { key: 'trct', label: 'TRCT assinado', done: false },
  { key: 'homologacao', label: 'Homologação sindical (quando aplicável)', done: false },
  { key: 'fgts_saque', label: 'Chave PIX/dados para saque FGTS', done: false },
];

// Calcula verbas rescisórias com base nos dados do colaborador
async function computeTerminationValues(orgId, employeeId, payload) {
  const emp = (await query(
    `SELECT id, admission_date, salary, current_salary, monthly_hours FROM employees WHERE id = $1 AND organization_id = $2`,
    [employeeId, orgId]
  )).rows[0];
  if (!emp) throw new Error('Colaborador não encontrado');

  const termDate = payload.termination_date ? new Date(payload.termination_date + 'T12:00:00') : new Date();
  const admDate = emp.admission_date ? new Date(emp.admission_date + 'T12:00:00') : termDate;
  const baseSalary = Number(payload.base_salary ?? emp.current_salary ?? emp.salary ?? 0);
  const reason = payload.reason || 'sem_justa_causa';
  const noticeType = payload.notice_type || 'indenizado';

  // Dias trabalhados no mês da rescisão
  const daysWorked = Math.min(termDate.getDate(), 30);
  const salaryProp = +(baseSalary / 30 * daysWorked).toFixed(2);

  // 13º proporcional (avos por mês trabalhado no ano)
  const yearStart = new Date(termDate.getFullYear(), 0, 1);
  const startFor13 = admDate > yearStart ? admDate : yearStart;
  const monthsFor13 = Math.max(0, Math.min(12,
    (termDate.getMonth() - startFor13.getMonth()) + (termDate.getDate() >= 15 ? 1 : 0) + 1));
  const thirteenthProp = reason === 'com_justa_causa' ? 0 : +(baseSalary / 12 * monthsFor13).toFixed(2);

  // Férias proporcionais (avos)
  const cycleStart = new Date(admDate);
  while (cycleStart.getFullYear() < termDate.getFullYear() - 1) cycleStart.setFullYear(cycleStart.getFullYear() + 1);
  const monthsForVac = Math.max(0, Math.min(12,
    Math.floor((termDate - cycleStart) / (1000 * 60 * 60 * 24 * 30))));
  const vacProp = reason === 'com_justa_causa' ? 0 : +(baseSalary / 12 * monthsForVac).toFixed(2);

  // Férias vencidas (busca no rh_vacations)
  let vacExpired = 0;
  try {
    const v = await query(
      `SELECT COALESCE(SUM(days_remaining), 0) as days FROM rh_vacations
       WHERE employee_id = $1 AND status = 'agendada' AND acquisition_end < NOW() - INTERVAL '1 year'`,
      [employeeId]);
    const days = Number(v.rows[0]?.days || 0);
    vacExpired = reason === 'com_justa_causa' ? 0 : +(baseSalary / 30 * days).toFixed(2);
  } catch (_) { /* tabela pode não ter esses campos */ }

  const vacThird = +((vacProp + vacExpired) / 3).toFixed(2);

  // Aviso prévio
  const yearsWorked = (termDate - admDate) / (1000 * 60 * 60 * 24 * 365);
  const noticeDays = Math.min(90, 30 + Math.floor(yearsWorked) * 3);
  let noticeAmount = 0;
  if (['sem_justa_causa', 'fim_contrato_experiencia_antecipado'].includes(reason)) {
    if (noticeType === 'indenizado') noticeAmount = +(baseSalary / 30 * noticeDays).toFixed(2);
  } else if (reason === 'pedido_demissao' && noticeType === 'nao_cumprido') {
    noticeAmount = -+(baseSalary / 30 * noticeDays).toFixed(2); // desconto
  }

  // Banco de horas
  let timeBankMinutes = 0, timeBankAmount = 0;
  try {
    const tb = await query(
      `SELECT COALESCE(SUM(minutes), 0) as total FROM time_bank_entries
       WHERE employee_id = $1 AND expired = FALSE`, [employeeId]);
    timeBankMinutes = Number(tb.rows[0]?.total || 0);
    const hourlyRate = baseSalary / (Number(emp.monthly_hours) || 220);
    timeBankAmount = +(timeBankMinutes / 60 * hourlyRate * 1.5).toFixed(2); // 50% adicional
    if (reason === 'com_justa_causa') timeBankAmount = 0;
  } catch (_) {}

  // FGTS
  const fgtsBalance = Number(payload.fgts_balance || 0);
  let fgtsFine = 0;
  if (reason === 'sem_justa_causa' || reason === 'fim_contrato_experiencia_antecipado') fgtsFine = +(fgtsBalance * 0.40).toFixed(2);
  else if (reason === 'acordo') fgtsFine = +(fgtsBalance * 0.20).toFixed(2);

  const otherCredits = Number(payload.other_credits || 0);
  const otherDebits = Number(payload.other_debits || 0);

  const gross = salaryProp + thirteenthProp + vacProp + vacExpired + vacThird + noticeAmount + timeBankAmount + otherCredits;
  const net = +(gross - otherDebits).toFixed(2);

  return {
    admission_date: emp.admission_date,
    base_salary: baseSalary,
    days_worked_month: daysWorked,
    salary_proportional: salaryProp,
    thirteenth_proportional: thirteenthProp,
    vacation_proportional: vacProp,
    vacation_expired: vacExpired,
    vacation_third: vacThird,
    notice_days: noticeDays,
    notice_amount: noticeAmount,
    time_bank_minutes: timeBankMinutes,
    time_bank_amount: timeBankAmount,
    fgts_balance: fgtsBalance,
    fgts_fine: fgtsFine,
    other_credits: otherCredits,
    other_debits: otherDebits,
    gross_total: +gross.toFixed(2),
    net_total: net,
  };
}

// Preview de cálculo
router.post('/terminations/preview', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId || !req.body.employee_id) return res.status(400).json({ error: 'employee_id obrigatório' });
    const calc = await computeTerminationValues(orgId, req.body.employee_id, req.body);
    res.json(calc);
  } catch (err) { logError('rh.termination.preview', err); res.status(500).json({ error: err.message || 'Erro ao calcular' }); }
});

// Listar rescisões
router.get('/terminations', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { status, employee_id } = req.query;
    let sql = `SELECT t.*, e.full_name as employee_name, e.position, e.registration_number
               FROM rh_terminations t JOIN employees e ON e.id = t.employee_id
               WHERE t.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
    if (employee_id) { sql += ` AND t.employee_id = $${idx++}`; params.push(employee_id); }
    sql += ` ORDER BY t.termination_date DESC`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('rh.terminations.list', err); res.status(500).json({ error: 'Erro' }); }
});

// Detalhe
router.get('/terminations/:id', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const r = await query(
      `SELECT t.*, e.full_name as employee_name, e.position, e.cpf, e.registration_number, e.admission_date as emp_admission
       FROM rh_terminations t JOIN employees e ON e.id = t.employee_id WHERE t.id = $1`,
      [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.terminations.detail', err); res.status(500).json({ error: 'Erro' }); }
});

// Criar rescisão (não desliga ainda, fica em_andamento)
router.post('/terminations', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    if (!d.employee_id || !d.termination_date || !d.reason)
      return res.status(400).json({ error: 'employee_id, termination_date e reason são obrigatórios' });

    const calc = await computeTerminationValues(orgId, d.employee_id, d);
    const checklist = d.checklist || DEFAULT_CHECKLIST;

    const r = await query(
      `INSERT INTO rh_terminations (organization_id, employee_id, reason, notice_type, notice_days, notice_start, notice_end,
        termination_date, last_working_day, admission_date, base_salary, days_worked_month,
        salary_proportional, thirteenth_proportional, vacation_proportional, vacation_expired, vacation_third,
        notice_amount, time_bank_amount, time_bank_minutes, fgts_balance, fgts_fine,
        other_credits, other_debits, gross_total, net_total, checklist, interview_notes, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'em_andamento',$30)
       RETURNING *`,
      [orgId, d.employee_id, d.reason, d.notice_type || 'indenizado', calc.notice_days,
        d.notice_start || null, d.notice_end || null, d.termination_date, d.last_working_day || d.termination_date,
        calc.admission_date, calc.base_salary, calc.days_worked_month,
        calc.salary_proportional, calc.thirteenth_proportional, calc.vacation_proportional, calc.vacation_expired, calc.vacation_third,
        calc.notice_amount, calc.time_bank_amount, calc.time_bank_minutes, calc.fgts_balance, calc.fgts_fine,
        calc.other_credits, calc.other_debits, calc.gross_total, calc.net_total,
        JSON.stringify(checklist), d.interview_notes || null, d.notes || null, req.userId]
    );
    await auditLog(orgId, 'termination', r.rows[0].id, 'create',
      [{ field: 'reason', oldVal: null, newVal: `${d.reason} em ${d.termination_date}` }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.terminations.create', err); res.status(500).json({ error: err.message || 'Erro ao criar rescisão' }); }
});

// Atualizar (recalcula se dados chave mudarem)
router.put('/terminations/:id', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const cur = (await query(`SELECT * FROM rh_terminations WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    if (cur.status === 'homologado') return res.status(400).json({ error: 'Rescisão já homologada' });

    const d = { ...cur, ...req.body };
    const shouldRecalc = ['reason', 'notice_type', 'termination_date', 'base_salary', 'fgts_balance', 'other_credits', 'other_debits'].some(k => k in req.body);
    let extra = {};
    if (shouldRecalc) {
      const calc = await computeTerminationValues(cur.organization_id, cur.employee_id, d);
      extra = calc;
    }
    const merged = { ...cur, ...req.body, ...extra };
    const r = await query(
      `UPDATE rh_terminations SET reason=$2, notice_type=$3, notice_days=$4, notice_start=$5, notice_end=$6,
        termination_date=$7, last_working_day=$8, base_salary=$9, days_worked_month=$10,
        salary_proportional=$11, thirteenth_proportional=$12, vacation_proportional=$13, vacation_expired=$14, vacation_third=$15,
        notice_amount=$16, time_bank_amount=$17, time_bank_minutes=$18, fgts_balance=$19, fgts_fine=$20,
        other_credits=$21, other_debits=$22, gross_total=$23, net_total=$24, checklist=$25,
        interview_notes=$26, notes=$27, status=$28, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id, merged.reason, merged.notice_type, merged.notice_days, merged.notice_start, merged.notice_end,
        merged.termination_date, merged.last_working_day, merged.base_salary, merged.days_worked_month,
        merged.salary_proportional, merged.thirteenth_proportional, merged.vacation_proportional, merged.vacation_expired, merged.vacation_third,
        merged.notice_amount, merged.time_bank_amount, merged.time_bank_minutes, merged.fgts_balance, merged.fgts_fine,
        merged.other_credits, merged.other_debits, merged.gross_total, merged.net_total,
        JSON.stringify(Array.isArray(merged.checklist) ? merged.checklist : (typeof merged.checklist === 'string' ? JSON.parse(merged.checklist) : DEFAULT_CHECKLIST)),
        merged.interview_notes, merged.notes, merged.status || 'em_andamento']
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.terminations.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Homologar: efetiva o desligamento do colaborador
router.post('/terminations/:id/homologate', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const cur = (await query(`SELECT * FROM rh_terminations WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    if (cur.status === 'homologado') return res.status(400).json({ error: 'Já homologado' });

    const checklist = Array.isArray(cur.checklist) ? cur.checklist : (typeof cur.checklist === 'string' ? JSON.parse(cur.checklist) : []);
    const pending = checklist.filter(c => !c.done && !c.optional);
    if (pending.length && !req.body.force)
      return res.status(400).json({ error: `${pending.length} itens do checklist pendentes`, pending });

    await query(
      `UPDATE rh_terminations SET status='homologado', homologated_at=NOW(), homologated_by=$2, updated_at=NOW() WHERE id=$1`,
      [req.params.id, req.userId]);
    await query(
      `UPDATE employees SET status='desligado', termination_date=$2, termination_reason=$3, updated_at=NOW() WHERE id=$1`,
      [cur.employee_id, cur.termination_date, cur.reason]);
    await auditLog(cur.organization_id, 'termination', cur.id, 'homologate',
      [{ field: 'status', oldVal: cur.status, newVal: 'homologado' }], req.userId);
    res.json({ ok: true });
  } catch (err) { logError('rh.terminations.homologate', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Cancelar rescisão
router.post('/terminations/:id/cancel', async (req, res) => {
  try {
    await ensureTerminationsTables();
    await query(
      `UPDATE rh_terminations SET status='cancelado', cancelled_at=NOW(), notes = COALESCE(notes,'') || E'\nCancelado: ' || $2, updated_at=NOW() WHERE id=$1`,
      [req.params.id, req.body.reason || 'sem motivo']);
    res.json({ ok: true });
  } catch (err) { logError('rh.terminations.cancel', err); res.status(500).json({ error: 'Erro' }); }
});

// TRCT (dados estruturados para PDF no frontend)
router.get('/terminations/:id/trct', async (req, res) => {
  try {
    await ensureTerminationsTables();
    const r = await query(
      `SELECT t.*, e.full_name, e.cpf, e.rg, e.registration_number, e.position, e.admission_date,
              o.name as organization_name
       FROM rh_terminations t
       JOIN employees e ON e.id = t.employee_id
       LEFT JOIN organizations o ON o.id = t.organization_id
       WHERE t.id = $1`,
      [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.terminations.trct', err); res.status(500).json({ error: 'Erro' }); }
});

// ============================================================
// FASE 11 - ADMISSÃO / ONBOARDING
// ============================================================
async function ensureOnboardingTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_onboarding (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID,
      candidate_name TEXT NOT NULL,
      candidate_email TEXT,
      candidate_phone TEXT,
      candidate_cpf TEXT,
      position TEXT,
      position_id UUID,
      department_id UUID,
      branch_id UUID,
      company_id UUID,
      admission_date DATE NOT NULL,
      probation_end_date DATE,
      salary NUMERIC(14,2) DEFAULT 0,
      buddy_id UUID,
      manager_id UUID,
      exam_scheduled_at TIMESTAMPTZ,
      exam_done_at TIMESTAMPTZ,
      exam_result TEXT,
      exam_file_url TEXT,
      integration_scheduled_at TIMESTAMPTZ,
      integration_done_at TIMESTAMPTZ,
      documents JSONB DEFAULT '[]'::jsonb,
      checklist JSONB DEFAULT '[]'::jsonb,
      access_config JSONB DEFAULT '{}'::jsonb,
      schedule_template_id TEXT,
      schedule_start_date DATE,
      current_step TEXT DEFAULT 'dados',
      status TEXT DEFAULT 'em_andamento',
      completed_at TIMESTAMPTZ,
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Idempotent add for existing installs
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS position_id UUID`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS access_config JSONB DEFAULT '{}'::jsonb`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS schedule_template_id TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS schedule_start_date DATE`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS zip_code TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS address TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS address_number TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS complement TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS neighborhood TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS city TEXT`).catch(()=>{});
  await query(`ALTER TABLE rh_onboarding ADD COLUMN IF NOT EXISTS state TEXT`).catch(()=>{});
  await query(`CREATE INDEX IF NOT EXISTS idx_onboarding_org ON rh_onboarding(organization_id, admission_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_onboarding_status ON rh_onboarding(organization_id, status)`);

}


// Documentos obrigatórios padrão (CLT + eSocial)
const DEFAULT_ONBOARDING_DOCS = [
  { key: 'rg', label: 'RG (frente e verso)', required: true, received: false },
  { key: 'cpf', label: 'CPF', required: true, received: false },
  { key: 'ctps', label: 'Carteira de Trabalho (CTPS)', required: true, received: false },
  { key: 'pis', label: 'PIS/PASEP/NIS', required: true, received: false },
  { key: 'titulo', label: 'Título de eleitor', required: true, received: false },
  { key: 'reservista', label: 'Certificado de reservista (homens)', required: false, received: false },
  { key: 'endereco', label: 'Comprovante de residência', required: true, received: false },
  { key: 'escolaridade', label: 'Comprovante de escolaridade', required: true, received: false },
  { key: 'foto', label: 'Foto 3x4', required: true, received: false },
  { key: 'nascimento_filhos', label: 'Certidão de nascimento (filhos < 14)', required: false, received: false },
  { key: 'casamento', label: 'Certidão de casamento', required: false, received: false },
  { key: 'vacina_filhos', label: 'Cartão de vacinação (filhos < 7)', required: false, received: false },
  { key: 'exame_admissional', label: 'Exame médico admissional (ASO)', required: true, received: false },
  { key: 'conta_bancaria', label: 'Dados bancários / chave PIX', required: true, received: false },
];

// Checklist padrão de integração (com campos received_at/done_at editáveis)
const DEFAULT_ONBOARDING_CHECKLIST = [
  { key: 'assinatura_contrato', label: 'Contrato de trabalho assinado', done: false },
  { key: 'assinatura_ctps', label: 'Anotação na CTPS', done: false },
  { key: 'exame_admissional', label: 'Exame admissional realizado (apto)', done: false },
  { key: 'entrega_epi', label: 'Entrega de EPIs', done: false },
  { key: 'entrega_uniforme', label: 'Entrega de uniformes', done: false },
  { key: 'entrega_cracha', label: 'Entrega de crachá', done: false },
  { key: 'entrega_equipamentos', label: 'Entrega de equipamentos (notebook/celular)', done: false },
  { key: 'apresentacao_equipe', label: 'Apresentação à equipe', done: false },
  { key: 'treinamento_seguranca', label: 'Treinamento de segurança do trabalho', done: false },
  { key: 'treinamento_lgpd', label: 'Treinamento LGPD', done: false },
  { key: 'termo_confidencialidade', label: 'Termo de confidencialidade', done: false },
  { key: 'manual_colaborador', label: 'Manual do colaborador entregue', done: false },
  { key: 'esocial_s2200', label: 'Evento eSocial S-2200 enviado', done: false },
];

// Sistemas de acesso padrão
const DEFAULT_ACCESS_SYSTEMS = [
  { key: 'app_colaborador', label: 'App do Colaborador', granted: false },
  { key: 'app_gestor', label: 'App do Gestor (se aplicável)', granted: false },
  { key: 'email_corp', label: 'E-mail corporativo', granted: false },
  { key: 'sistemas_internos', label: 'Sistemas internos (ERP/CRM)', granted: false },
];


// Listar processos
router.get('/onboarding', async (req, res) => {
  try {
    await ensureOnboardingTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { status } = req.query;
    let sql = `SELECT o.*,
                 (SELECT COUNT(*) FROM jsonb_array_elements(o.documents) d WHERE (d->>'received')::boolean = true) as docs_received,
                 (SELECT COUNT(*) FROM jsonb_array_elements(o.documents) d WHERE (d->>'required')::boolean = true) as docs_required,
                 (SELECT COUNT(*) FROM jsonb_array_elements(o.checklist) c WHERE (c->>'done')::boolean = true) as checklist_done,
                 (SELECT COUNT(*) FROM jsonb_array_elements(o.checklist) c) as checklist_total
               FROM rh_onboarding o WHERE o.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (status) { sql += ` AND o.status = $${idx++}`; params.push(status); }
    sql += ` ORDER BY o.admission_date DESC`;
    res.json((await query(sql, params)).rows);
  } catch (err) { logError('rh.onboarding.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.get('/onboarding/:id', async (req, res) => {
  try {
    await ensureOnboardingTables();
    const r = await query(`SELECT * FROM rh_onboarding WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.onboarding.detail', err); res.status(500).json({ error: 'Erro' }); }
});

// Criar processo de admissão
router.post('/onboarding', async (req, res) => {
  try {
    await ensureOnboardingTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    const d = req.body;
    if (!d.candidate_name || !d.admission_date)
      return res.status(400).json({ error: 'Nome do candidato e data de admissão são obrigatórios' });

    const docs = d.documents || DEFAULT_ONBOARDING_DOCS;
    const checklist = d.checklist || DEFAULT_ONBOARDING_CHECKLIST;
    const accessConfig = d.access_config || { systems: DEFAULT_ACCESS_SYSTEMS, biometry: { registered: false }, timeclock: { registered: false } };

    const r = await query(
      `INSERT INTO rh_onboarding (organization_id, candidate_name, candidate_email, candidate_phone, candidate_cpf,
        position, position_id, department_id, branch_id, company_id, admission_date, probation_end_date, salary,
        buddy_id, manager_id, exam_scheduled_at, integration_scheduled_at, documents, checklist, access_config,
        schedule_template_id, schedule_start_date,
        zip_code, address, address_number, complement, neighborhood, city, state,
        current_step, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,'dados','em_andamento',$30,$31) RETURNING *`,
      [orgId, d.candidate_name, d.candidate_email || null, d.candidate_phone || null, d.candidate_cpf || null,
        d.position || null, d.position_id || null, d.department_id || null, d.branch_id || null, d.company_id || null,
        d.admission_date, d.probation_end_date || null, d.salary || 0,
        d.buddy_id || null, d.manager_id || null, d.exam_scheduled_at || null, d.integration_scheduled_at || null,
        JSON.stringify(docs), JSON.stringify(checklist), JSON.stringify(accessConfig),
        d.schedule_template_id || null, d.schedule_start_date || null,
        d.zip_code || null, d.address || null, d.address_number || null, d.complement || null,
        d.neighborhood || null, d.city || null, d.state || null,
        d.notes || null, req.userId]
    );
    await auditLog(orgId, 'onboarding', r.rows[0].id, 'create',
      [{ field: 'admission', oldVal: null, newVal: `${d.candidate_name} - ${d.admission_date}` }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.onboarding.create', err); res.status(500).json({ error: err.message || 'Erro ao criar admissão' }); }
});

// Atualizar processo
router.put('/onboarding/:id', async (req, res) => {
  try {
    await ensureOnboardingTables();
    const cur = (await query(`SELECT * FROM rh_onboarding WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });

    if (cur.status === 'concluido') return res.status(400).json({ error: 'Admissão já concluída' });
    const d = req.body;
    const merged = { ...cur, ...d };
    const r = await query(
      `UPDATE rh_onboarding SET candidate_name=$2, candidate_email=$3, candidate_phone=$4, candidate_cpf=$5,
        position=$6, position_id=$7, department_id=$8, branch_id=$9, company_id=$10, admission_date=$11, probation_end_date=$12,
        salary=$13, buddy_id=$14, manager_id=$15, exam_scheduled_at=$16, exam_done_at=$17, exam_result=$18, exam_file_url=$19,
        integration_scheduled_at=$20, integration_done_at=$21, documents=$22, checklist=$23, access_config=$24,
        schedule_template_id=$25, schedule_start_date=$26, current_step=$27,
        zip_code=$29, address=$30, address_number=$31, complement=$32, neighborhood=$33, city=$34, state=$35,
        notes=$28, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id, merged.candidate_name, merged.candidate_email, merged.candidate_phone, merged.candidate_cpf,
        merged.position, merged.position_id || null, merged.department_id, merged.branch_id, merged.company_id,
        merged.admission_date, merged.probation_end_date, merged.salary,
        merged.buddy_id, merged.manager_id, merged.exam_scheduled_at, merged.exam_done_at, merged.exam_result, merged.exam_file_url,
        merged.integration_scheduled_at, merged.integration_done_at,
        JSON.stringify(Array.isArray(merged.documents) ? merged.documents : (typeof merged.documents === 'string' ? JSON.parse(merged.documents) : DEFAULT_ONBOARDING_DOCS)),
        JSON.stringify(Array.isArray(merged.checklist) ? merged.checklist : (typeof merged.checklist === 'string' ? JSON.parse(merged.checklist) : DEFAULT_ONBOARDING_CHECKLIST)),
        JSON.stringify(typeof merged.access_config === 'object' && merged.access_config !== null ? merged.access_config : (typeof merged.access_config === 'string' ? JSON.parse(merged.access_config) : {})),
        merged.schedule_template_id || null, merged.schedule_start_date || null,
        merged.current_step || 'dados', merged.notes,
        merged.zip_code || null, merged.address || null, merged.address_number || null, merged.complement || null,
        merged.neighborhood || null, merged.city || null, merged.state || null]
    );

    res.json(r.rows[0]);
  } catch (err) { logError('rh.onboarding.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});


// Finalizar: cria employee e vincula
router.post('/onboarding/:id/finish', async (req, res) => {
  try {
    await ensureOnboardingTables();
    const cur = (await query(`SELECT * FROM rh_onboarding WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    if (cur.status === 'concluido') return res.status(400).json({ error: 'Já concluído' });

    const docs = Array.isArray(cur.documents) ? cur.documents : (typeof cur.documents === 'string' ? JSON.parse(cur.documents) : []);
    const cl = Array.isArray(cur.checklist) ? cur.checklist : (typeof cur.checklist === 'string' ? JSON.parse(cur.checklist) : []);
    const docsPending = docs.filter(d => d.required && !d.received);
    const clPending = cl.filter(c => !c.done);
    if ((docsPending.length || clPending.length) && !req.body.force) {
      return res.status(400).json({
        error: `${docsPending.length} documentos obrigatórios e ${clPending.length} itens de integração pendentes`,
        documents_pending: docsPending, checklist_pending: clPending,
      });
    }

    let employeeId = cur.employee_id;
    if (!employeeId) {
      const emp = await query(
        `INSERT INTO employees (organization_id, full_name, email, phone, cpf, position,
          department_id, branch_id, company_id, admission_date, probation_end_date, salary,
          zip_code, address, address_number, complement, neighborhood, city, state,
          status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ativo',$20) RETURNING id`,
        [cur.organization_id, cur.candidate_name, cur.candidate_email, cur.candidate_phone, cur.candidate_cpf,
          cur.position, cur.department_id, cur.branch_id, cur.company_id,
          cur.admission_date, cur.probation_end_date, cur.salary,
          cur.zip_code, cur.address, cur.address_number, cur.complement, cur.neighborhood, cur.city, cur.state,
          req.userId]);
      employeeId = emp.rows[0].id;
    }


    await query(
      `UPDATE rh_onboarding SET status='concluido', completed_at=NOW(), employee_id=$2, updated_at=NOW() WHERE id=$1`,
      [req.params.id, employeeId]);
    await auditLog(cur.organization_id, 'onboarding', cur.id, 'complete',
      [{ field: 'status', oldVal: cur.status, newVal: 'concluido' }], req.userId);

    res.json({ ok: true, employee_id: employeeId });
  } catch (err) { logError('rh.onboarding.finish', err); res.status(500).json({ error: err.message || 'Erro ao finalizar' }); }
});

router.post('/onboarding/:id/cancel', async (req, res) => {
  try {
    await ensureOnboardingTables();
    await query(
      `UPDATE rh_onboarding SET status='cancelado', notes = COALESCE(notes,'') || E'\nCancelado: ' || $2, updated_at=NOW() WHERE id=$1`,
      [req.params.id, req.body.reason || 'sem motivo']);
    res.json({ ok: true });
  } catch (err) { logError('rh.onboarding.cancel', err); res.status(500).json({ error: 'Erro' }); }
});


// ============================================================
// FASE 12 - ADVERTÊNCIAS E MEDIDAS DISCIPLINARES
// ============================================================
async function ensureWarningsTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_warnings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      type TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      incident_date DATE,
      issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
      suspension_days INTEGER DEFAULT 0,
      suspension_start_date DATE,
      suspension_end_date DATE,
      witness_name TEXT,
      witness_document TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      status TEXT DEFAULT 'pendente_ciencia',
      acknowledged_at TIMESTAMPTZ,
      acknowledged_signature TEXT,
      acknowledged_ip TEXT,
      acknowledged_note TEXT,
      refused_at TIMESTAMPTZ,
      refused_reason TEXT,
      revoked_at TIMESTAMPTZ,
      revoked_reason TEXT,
      revoked_by UUID,
      issued_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_warnings_org ON rh_warnings(organization_id, issued_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_warnings_emp ON rh_warnings(employee_id, issued_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_warnings_status ON rh_warnings(organization_id, status)`);
}

const WARNING_TYPES = ['verbal', 'escrita', 'suspensao', 'justa_causa'];

// Listar
router.get('/warnings', async (req, res) => {
  try {
    await ensureWarningsTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, status, type } = req.query;
    let sql = `SELECT w.*, e.full_name as employee_name, e.registration as employee_registration,
                      e.position as employee_position
               FROM rh_warnings w
               LEFT JOIN employees e ON e.id = w.employee_id
               WHERE w.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND w.employee_id = $${idx++}`; params.push(employee_id); }
    if (status) { sql += ` AND w.status = $${idx++}`; params.push(status); }
    if (type) { sql += ` AND w.type = $${idx++}`; params.push(type); }
    sql += ` ORDER BY w.issued_date DESC, w.created_at DESC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.warnings.list', err); res.status(500).json({ error: 'Erro ao listar advertências' }); }
});

// Detalhe
router.get('/warnings/:id', async (req, res) => {
  try {
    await ensureWarningsTables();
    const r = await query(
      `SELECT w.*, e.full_name as employee_name, e.registration as employee_registration,
              e.position as employee_position, e.cpf as employee_cpf
       FROM rh_warnings w LEFT JOIN employees e ON e.id = w.employee_id WHERE w.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.detail', err); res.status(500).json({ error: 'Erro' }); }
});

// Criar
router.post('/warnings', async (req, res) => {
  try {
    await ensureWarningsTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const {
      employee_id, type, reason, description, incident_date, issued_date,
      suspension_days, suspension_start_date, suspension_end_date,
      witness_name, witness_document, attachments,
    } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'Colaborador é obrigatório' });
    if (!WARNING_TYPES.includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
    if (!reason || String(reason).trim().length < 3) return res.status(400).json({ error: 'Motivo é obrigatório' });
    if (type === 'suspensao' && (!suspension_days || Number(suspension_days) < 1)) {
      return res.status(400).json({ error: 'Suspensão exige dias > 0' });
    }
    const r = await query(
      `INSERT INTO rh_warnings (organization_id, employee_id, type, reason, description,
        incident_date, issued_date, suspension_days, suspension_start_date, suspension_end_date,
        witness_name, witness_document, attachments, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8,$9,$10,$11,$12,COALESCE($13,'[]'::jsonb),$14)
       RETURNING *`,
      [orgId, employee_id, type, reason, description || null,
        incident_date || null, issued_date || null,
        Number(suspension_days || 0), suspension_start_date || null, suspension_end_date || null,
        witness_name || null, witness_document || null,
        attachments ? JSON.stringify(attachments) : null, req.userId]
    );
    await auditLog(orgId, 'warning', r.rows[0].id, 'create',
      [{ field: 'type', oldVal: null, newVal: type }, { field: 'employee_id', oldVal: null, newVal: employee_id }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.create', err); res.status(500).json({ error: err.message || 'Erro ao criar advertência' }); }
});

// Atualizar (apenas enquanto pendente)
router.put('/warnings/:id', async (req, res) => {
  try {
    await ensureWarningsTables();
    const cur = (await query(`SELECT * FROM rh_warnings WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status !== 'pendente_ciencia') return res.status(400).json({ error: 'Só é possível editar advertências pendentes de ciência' });
    const b = req.body;
    const r = await query(
      `UPDATE rh_warnings SET reason=COALESCE($2,reason), description=COALESCE($3,description),
        incident_date=COALESCE($4,incident_date), issued_date=COALESCE($5,issued_date),
        suspension_days=COALESCE($6,suspension_days), suspension_start_date=COALESCE($7,suspension_start_date),
        suspension_end_date=COALESCE($8,suspension_end_date), witness_name=COALESCE($9,witness_name),
        witness_document=COALESCE($10,witness_document), attachments=COALESCE($11,attachments),
        updated_at=NOW() WHERE id=$1 RETURNING *`,
      [cur.id, b.reason, b.description, b.incident_date, b.issued_date,
        b.suspension_days, b.suspension_start_date, b.suspension_end_date,
        b.witness_name, b.witness_document, b.attachments ? JSON.stringify(b.attachments) : null]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Dar ciência (assinatura do colaborador)
router.post('/warnings/:id/acknowledge', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { signature, note } = req.body;
    if (!signature) return res.status(400).json({ error: 'Assinatura é obrigatória' });
    const cur = (await query(`SELECT * FROM rh_warnings WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status !== 'pendente_ciencia') return res.status(400).json({ error: 'Já processada' });
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    const r = await query(
      `UPDATE rh_warnings SET status='dada_ciencia', acknowledged_at=NOW(),
        acknowledged_signature=$2, acknowledged_ip=$3, acknowledged_note=$4, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [cur.id, signature, ip, note || null]
    );
    await auditLog(cur.organization_id, 'warning', cur.id, 'acknowledge',
      [{ field: 'status', oldVal: 'pendente_ciencia', newVal: 'dada_ciencia' }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.acknowledge', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Recusar ciência
router.post('/warnings/:id/refuse', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { reason } = req.body;
    const cur = (await query(`SELECT * FROM rh_warnings WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status !== 'pendente_ciencia') return res.status(400).json({ error: 'Já processada' });
    const r = await query(
      `UPDATE rh_warnings SET status='recusada', refused_at=NOW(), refused_reason=$2, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [cur.id, reason || 'Sem justificativa']
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.refuse', err); res.status(500).json({ error: 'Erro' }); }
});

// Revogar
router.post('/warnings/:id/revoke', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Motivo da revogação é obrigatório' });
    const cur = (await query(`SELECT * FROM rh_warnings WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status === 'revogada' || cur.status === 'cancelada') return res.status(400).json({ error: 'Já revogada/cancelada' });
    const r = await query(
      `UPDATE rh_warnings SET status='revogada', revoked_at=NOW(), revoked_reason=$2, revoked_by=$3, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [cur.id, reason, req.userId]
    );
    await auditLog(cur.organization_id, 'warning', cur.id, 'revoke',
      [{ field: 'status', oldVal: cur.status, newVal: 'revogada' }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.warnings.revoke', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Excluir (apenas pendente)
router.delete('/warnings/:id', async (req, res) => {
  try {
    await ensureWarningsTables();
    const cur = (await query(`SELECT * FROM rh_warnings WHERE id = $1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status !== 'pendente_ciencia') return res.status(400).json({ error: 'Só é possível excluir advertências pendentes' });
    await query(`DELETE FROM rh_warnings WHERE id = $1`, [cur.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.warnings.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// Histórico disciplinar do colaborador (resumo)
router.get('/warnings/employee/:employeeId/summary', async (req, res) => {
  try {
    await ensureWarningsTables();
    const r = await query(
      `SELECT type, status, COUNT(*)::int as total FROM rh_warnings
       WHERE employee_id = $1 GROUP BY type, status`,
      [req.params.employeeId]
    );
    res.json(r.rows);
  } catch (err) { logError('rh.warnings.summary', err); res.status(500).json({ error: 'Erro' }); }
});


// ============================================================
// FASE 13 - EXPORTAÇÃO eSOCIAL (S-2200, S-2299, S-2230)
// ============================================================
async function ensureEsocialTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_esocial_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      company_id UUID,
      employee_id UUID,
      event_type TEXT NOT NULL,
      reference_type TEXT,
      reference_id UUID,
      event_id_esocial TEXT,
      event_date DATE,
      xml TEXT NOT NULL,
      xml_hash TEXT,
      status TEXT NOT NULL DEFAULT 'gerado',
      protocol TEXT,
      receipt_number TEXT,
      error_message TEXT,
      response_data JSONB DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      generated_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_esocial_org ON rh_esocial_events(organization_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_esocial_emp ON rh_esocial_events(employee_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_esocial_type ON rh_esocial_events(organization_id, event_type, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_esocial_ref ON rh_esocial_events(reference_type, reference_id)`);
}

const ESOCIAL_EVENT_TYPES = ['S-2200', 'S-2299', 'S-2230', 'S-3000'];
const ESOCIAL_STATUS = ['gerado', 'enviado', 'aceito', 'rejeitado', 'cancelado'];

// Helpers
function xmlEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
function fmtEsocialDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}
function fmtEsocialDateTime(d) {
  const dt = (d instanceof Date) ? d : new Date(d || Date.now());
  return dt.toISOString().slice(0, 19);
}
function esocialEventIdFor(cnpj, tipo) {
  // ID{tpInsc}{nrInsc padded 14}{aammddhhmmss}{seq5}
  const nr = onlyDigits(cnpj).padStart(14, '0').slice(0, 14);
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  const seq = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `ID1${nr}${stamp}${seq}`;
}
async function sha256(text) {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function loadEmployerContext(companyId, orgId) {
  let cmp = null;
  if (companyId) {
    cmp = (await query(`SELECT * FROM companies WHERE id=$1`, [companyId])).rows[0];
  }
  if (!cmp) {
    cmp = (await query(`SELECT * FROM companies WHERE organization_id=$1 AND is_active=true ORDER BY created_at LIMIT 1`, [orgId])).rows[0];
  }
  return {
    tpInsc: 1,
    nrInsc: onlyDigits(cmp?.cnpj || '').slice(0, 14),
    nmRazao: cmp?.name || cmp?.trade_name || 'Empregador',
  };
}

function buildIdeEvento(evtType, indRetif = 1) {
  const perApur = new Date().toISOString().slice(0, 7);
  return `<ideEvento><indRetif>${indRetif}</indRetif><tpAmb>2</tpAmb><procEmi>1</procEmi><verProc>Ayratech-1.0</verProc>${['S-2200','S-2299','S-2230'].includes(evtType) ? '' : `<perApur>${perApur}</perApur>`}</ideEvento>`;
}

function buildIdeEmpregador(emp) {
  return `<ideEmpregador><tpInsc>${emp.tpInsc}</tpInsc><nrInsc>${xmlEscape(emp.nrInsc)}</nrInsc></ideEmpregador>`;
}

// S-2200: Admissão
function buildS2200XML(evtId, emp, employee) {
  const cpf = onlyDigits(employee.cpf).padStart(11, '0').slice(0, 11);
  const nis = onlyDigits(employee.pis_pasep).padStart(11, '0').slice(0, 11);
  const dtNasc = fmtEsocialDate(employee.birth_date);
  const dtAdm = fmtEsocialDate(employee.admission_date);
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAdmissao/v_S_01_02_00">
  <evtAdmissao Id="${xmlEscape(evtId)}">
    ${buildIdeEvento('S-2200')}
    ${buildIdeEmpregador(emp)}
    <trabalhador>
      <cpfTrab>${cpf}</cpfTrab>
      <nmTrab>${xmlEscape(employee.full_name)}</nmTrab>
      <sexo>${employee.gender === 'F' ? 'F' : 'M'}</sexo>
      <racaCor>${employee.skin_color || '1'}</racaCor>
      <estCiv>${employee.marital_status || '1'}</estCiv>
      <grauInstr>07</grauInstr>
      <nascimento>
        <dtNascto>${dtNasc}</dtNascto>
        <paisNascto>105</paisNascto>
        <paisNac>105</paisNac>
      </nascimento>
      ${employee.email ? `<contato><fonePrinc>${onlyDigits(employee.phone)}</fonePrinc><emailPrinc>${xmlEscape(employee.email)}</emailPrinc></contato>` : ''}
    </trabalhador>
    <vinculo>
      <matricula>${xmlEscape(employee.registration_number || employee.id.slice(0, 8))}</matricula>
      <tpRegTrab>1</tpRegTrab>
      <tpRegPrev>1</tpRegPrev>
      ${nis ? `<nisTrab>${nis}</nisTrab>` : ''}
      <infoRegimeTrab>
        <infoCeletista>
          <dtAdm>${dtAdm}</dtAdm>
          <tpAdmissao>1</tpAdmissao>
          <indAdmissao>1</indAdmissao>
          <tpRegJor>1</tpRegJor>
          <natAtividade>1</natAtividade>
          <dtOpcFGTS>${dtAdm}</dtOpcFGTS>
        </infoCeletista>
      </infoRegimeTrab>
      <infoContrato>
        <nmCargo>${xmlEscape(employee.position || 'Não informado')}</nmCargo>
        <CBOCargo>999999</CBOCargo>
        <remuneracao>
          <vrSalFx>${Number(employee.salary || 0).toFixed(2)}</vrSalFx>
          <undSalFixo>5</undSalFixo>
        </remuneracao>
        <tpContr>1</tpContr>
        <duracao><tpContr>1</tpContr></duracao>
        <localTrabalho>
          <localTrabGeral><tpInsc>${emp.tpInsc}</tpInsc><nrInsc>${xmlEscape(emp.nrInsc)}</nrInsc></localTrabGeral>
        </localTrabalho>
        <horContratual>
          <qtdHrsSem>44</qtdHrsSem>
          <tpJornada>1</tpJornada>
          <tmpParc>0</tmpParc>
        </horContratual>
      </infoContrato>
    </vinculo>
  </evtAdmissao>
</eSocial>`;
}

// S-2299: Desligamento
function buildS2299XML(evtId, emp, employee, termination) {
  const cpf = onlyDigits(employee.cpf).padStart(11, '0').slice(0, 11);
  const mtc = employee.registration_number || employee.id.slice(0, 8);
  const dtDeslig = fmtEsocialDate(termination.termination_date);
  const causaMap = { sem_justa_causa: '02', pedido_demissao: '07', justa_causa: '11', acordo: '03', experiencia: '12', aposentadoria: '10' };
  const cause = causaMap[termination.reason] || '02';
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtDeslig/v_S_01_02_00">
  <evtDeslig Id="${xmlEscape(evtId)}">
    ${buildIdeEvento('S-2299')}
    ${buildIdeEmpregador(emp)}
    <ideVinculo>
      <cpfTrab>${cpf}</cpfTrab>
      <matricula>${xmlEscape(mtc)}</matricula>
    </ideVinculo>
    <infoDeslig>
      <mtvDeslig>${cause}</mtvDeslig>
      <dtDeslig>${dtDeslig}</dtDeslig>
      <indPagtoAPI>${termination.notice_type === 'indenizado' ? 'S' : 'N'}</indPagtoAPI>
      ${termination.notice_type === 'indenizado' ? `<dtProjFimAPI>${fmtEsocialDate(termination.notice_end || termination.termination_date)}</dtProjFimAPI>` : ''}
      <pensAlim>N</pensAlim>
      <verbasResc>
        <dmDev>
          <ideDmDev>DES${evtId.slice(-6)}</ideDmDev>
          <infoPerApur>
            <ideEstabLot>
              <tpInsc>${emp.tpInsc}</tpInsc>
              <nrInsc>${xmlEscape(emp.nrInsc)}</nrInsc>
              <codLotacao>00001</codLotacao>
              <detVerbas>
                <codRubr>1000</codRubr>
                <ideTabRubr>Ayratech</ideTabRubr>
                <qtdRubr>1</qtdRubr>
                <vrUnit>${Number(termination.gross_total || 0).toFixed(2)}</vrUnit>
                <vrRubr>${Number(termination.gross_total || 0).toFixed(2)}</vrRubr>
              </detVerbas>
            </ideEstabLot>
          </infoPerApur>
        </dmDev>
      </verbasResc>
    </infoDeslig>
  </evtDeslig>
</eSocial>`;
}

// S-2230: Afastamento
function buildS2230XML(evtId, emp, employee, absence) {
  const cpf = onlyDigits(employee.cpf).padStart(11, '0').slice(0, 11);
  const mtc = employee.registration_number || employee.id.slice(0, 8);
  const dtIniAfast = fmtEsocialDate(absence.start_date);
  const dtTermAfast = absence.end_date ? fmtEsocialDate(absence.end_date) : '';
  const codMap = { doenca: '01', acidente_trabalho: '03', maternidade: '17', paternidade: '19', ferias: '15', servico_militar: '11', licenca_nao_remunerada: '10' };
  const codMotAfast = codMap[absence.absence_type] || '01';
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtAfastTemp/v_S_01_02_00">
  <evtAfastTemp Id="${xmlEscape(evtId)}">
    ${buildIdeEvento('S-2230')}
    ${buildIdeEmpregador(emp)}
    <ideVinculo>
      <cpfTrab>${cpf}</cpfTrab>
      <matricula>${xmlEscape(mtc)}</matricula>
    </ideVinculo>
    <infoAfastamento>
      <iniAfastamento>
        <dtIniAfast>${dtIniAfast}</dtIniAfast>
        <codMotAfast>${codMotAfast}</codMotAfast>
        ${absence.reason ? `<observacao>${xmlEscape(absence.reason).slice(0, 999)}</observacao>` : ''}
      </iniAfastamento>
      ${dtTermAfast ? `<fimAfastamento><dtTermAfast>${dtTermAfast}</dtTermAfast></fimAfastamento>` : ''}
    </infoAfastamento>
  </evtAfastTemp>
</eSocial>`;
}

// S-3000: Exclusão de evento
function buildS3000XML(evtId, emp, originalEvent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtExclusao/v_S_01_02_00">
  <evtExclusao Id="${xmlEscape(evtId)}">
    ${buildIdeEvento('S-3000')}
    ${buildIdeEmpregador(emp)}
    <infoExclusao>
      <tpEvento>${originalEvent.event_type}</tpEvento>
      <nrRecEvt>${xmlEscape(originalEvent.receipt_number || '')}</nrRecEvt>
    </infoExclusao>
  </evtExclusao>
</eSocial>`;
}

async function generateEsocialEvent({ orgId, type, referenceId, referenceType, userId }) {
  if (!ESOCIAL_EVENT_TYPES.includes(type)) throw new Error(`Tipo inválido: ${type}`);
  let employee = null, refRow = null, companyId = null, xml = '', evtId = '';

  if (type === 'S-2200') {
    employee = (await query(`SELECT * FROM employees WHERE id=$1`, [referenceId])).rows[0];
    if (!employee) throw new Error('Colaborador não encontrado');
    if (!employee.cpf) throw new Error('CPF do colaborador é obrigatório');
    if (!employee.admission_date) throw new Error('Data de admissão é obrigatória');
    companyId = employee.company_id;
    const emp = await loadEmployerContext(companyId, orgId);
    if (!emp.nrInsc) throw new Error('CNPJ da empresa é obrigatório');
    evtId = esocialEventIdFor(emp.nrInsc, type);
    xml = buildS2200XML(evtId, emp, employee);
    referenceType = 'employee';
    refRow = { event_date: employee.admission_date };
  } else if (type === 'S-2299') {
    const term = (await query(`SELECT * FROM rh_terminations WHERE id=$1`, [referenceId])).rows[0];
    if (!term) throw new Error('Rescisão não encontrada');
    employee = (await query(`SELECT * FROM employees WHERE id=$1`, [term.employee_id])).rows[0];
    if (!employee) throw new Error('Colaborador não encontrado');
    companyId = employee.company_id;
    const emp = await loadEmployerContext(companyId, orgId);
    if (!emp.nrInsc) throw new Error('CNPJ da empresa é obrigatório');
    evtId = esocialEventIdFor(emp.nrInsc, type);
    xml = buildS2299XML(evtId, emp, employee, term);
    referenceType = 'termination';
    refRow = { event_date: term.termination_date };
  } else if (type === 'S-2230') {
    const abs = (await query(`SELECT * FROM employee_absences WHERE id=$1`, [referenceId])).rows[0];
    if (!abs) throw new Error('Afastamento não encontrado');
    employee = (await query(`SELECT * FROM employees WHERE id=$1`, [abs.employee_id])).rows[0];
    if (!employee) throw new Error('Colaborador não encontrado');
    companyId = employee.company_id;
    const emp = await loadEmployerContext(companyId, orgId);
    if (!emp.nrInsc) throw new Error('CNPJ da empresa é obrigatório');
    evtId = esocialEventIdFor(emp.nrInsc, type);
    xml = buildS2230XML(evtId, emp, employee, abs);
    referenceType = 'absence';
    refRow = { event_date: abs.start_date };
  } else if (type === 'S-3000') {
    const orig = (await query(`SELECT * FROM rh_esocial_events WHERE id=$1`, [referenceId])).rows[0];
    if (!orig) throw new Error('Evento original não encontrado');
    if (!orig.receipt_number) throw new Error('Evento original precisa de nº de recibo antes de excluir');
    const emp = await loadEmployerContext(orig.company_id, orgId);
    evtId = esocialEventIdFor(emp.nrInsc, type);
    xml = buildS3000XML(evtId, emp, orig);
    employee = orig.employee_id ? { id: orig.employee_id } : null;
    companyId = orig.company_id;
    referenceType = 'esocial_event';
    refRow = { event_date: new Date() };
  }

  const hash = await sha256(xml);
  const r = await query(
    `INSERT INTO rh_esocial_events (organization_id, company_id, employee_id, event_type,
      reference_type, reference_id, event_id_esocial, event_date, xml, xml_hash, status, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'gerado',$11) RETURNING *`,
    [orgId, companyId, employee?.id || null, type, referenceType, referenceId,
      evtId, refRow?.event_date || null, xml, hash, userId]
  );
  return r.rows[0];
}

// Listar
router.get('/esocial/events', async (req, res) => {
  try {
    await ensureEsocialTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { event_type, status, employee_id } = req.query;
    let sql = `SELECT ev.id, ev.event_type, ev.event_id_esocial, ev.event_date, ev.status,
                      ev.protocol, ev.receipt_number, ev.error_message, ev.xml_hash,
                      ev.reference_type, ev.reference_id, ev.sent_at, ev.processed_at, ev.created_at,
                      e.full_name as employee_name, e.cpf as employee_cpf, e.registration_number
               FROM rh_esocial_events ev
               LEFT JOIN employees e ON e.id = ev.employee_id
               WHERE ev.organization_id = $1`;
    const params = [orgId]; let idx = 2;
    if (event_type) { sql += ` AND ev.event_type = $${idx++}`; params.push(event_type); }
    if (status) { sql += ` AND ev.status = $${idx++}`; params.push(status); }
    if (employee_id) { sql += ` AND ev.employee_id = $${idx++}`; params.push(employee_id); }
    sql += ` ORDER BY ev.created_at DESC LIMIT 500`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.esocial.list', err); res.status(500).json({ error: 'Erro ao listar eventos' }); }
});

// Detalhe (com XML completo)
router.get('/esocial/events/:id', async (req, res) => {
  try {
    await ensureEsocialTables();
    const r = await query(
      `SELECT ev.*, e.full_name as employee_name, e.cpf as employee_cpf, e.registration_number
       FROM rh_esocial_events ev
       LEFT JOIN employees e ON e.id = ev.employee_id
       WHERE ev.id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.esocial.detail', err); res.status(500).json({ error: 'Erro' }); }
});

// Gerar evento individual
router.post('/esocial/generate', async (req, res) => {
  try {
    await ensureEsocialTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { type, reference_id, reference_type } = req.body;
    if (!type || !reference_id) return res.status(400).json({ error: 'type e reference_id são obrigatórios' });
    const evt = await generateEsocialEvent({ orgId, type, referenceId: reference_id, referenceType: reference_type, userId: req.userId });
    await auditLog(orgId, 'esocial_event', evt.id, 'generate',
      [{ field: 'event_type', oldVal: null, newVal: type }], req.userId);
    res.json(evt);
  } catch (err) { logError('rh.esocial.generate', err); res.status(500).json({ error: err.message || 'Erro ao gerar evento' }); }
});

// Geração em lote (todos elegíveis ainda não gerados)
router.post('/esocial/generate-batch', async (req, res) => {
  try {
    await ensureEsocialTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { type } = req.body;
    if (!['S-2200', 'S-2299', 'S-2230'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });

    let candidates = [];
    if (type === 'S-2200') {
      const r = await query(
        `SELECT e.id FROM employees e
         WHERE e.organization_id = $1 AND e.status = 'ativo' AND e.cpf IS NOT NULL AND e.admission_date IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM rh_esocial_events ev WHERE ev.reference_id = e.id AND ev.event_type='S-2200' AND ev.status <> 'cancelado')`,
        [orgId]);
      candidates = r.rows.map(x => x.id);
    } else if (type === 'S-2299') {
      const r = await query(
        `SELECT t.id FROM rh_terminations t
         WHERE t.organization_id = $1 AND t.status = 'homologada'
         AND NOT EXISTS (SELECT 1 FROM rh_esocial_events ev WHERE ev.reference_id = t.id AND ev.event_type='S-2299' AND ev.status <> 'cancelado')`,
        [orgId]);
      candidates = r.rows.map(x => x.id);
    } else if (type === 'S-2230') {
      const r = await query(
        `SELECT a.id FROM employee_absences a
         JOIN employees e ON e.id = a.employee_id
         WHERE e.organization_id = $1 AND (a.approved IS NULL OR a.approved = true)
         AND NOT EXISTS (SELECT 1 FROM rh_esocial_events ev WHERE ev.reference_id = a.id AND ev.event_type='S-2230' AND ev.status <> 'cancelado')`,
        [orgId]);
      candidates = r.rows.map(x => x.id);
    }

    const results = { total: candidates.length, ok: 0, failed: 0, errors: [] };
    for (const id of candidates) {
      try {
        await generateEsocialEvent({ orgId, type, referenceId: id, userId: req.userId });
        results.ok++;
      } catch (e) {
        results.failed++;
        results.errors.push({ reference_id: id, error: e.message });
      }
    }
    res.json(results);
  } catch (err) { logError('rh.esocial.batch', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Download XML
router.get('/esocial/events/:id/xml', async (req, res) => {
  try {
    await ensureEsocialTables();
    const r = await query(`SELECT event_id_esocial, event_type, xml FROM rh_esocial_events WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).send('Não encontrado');
    const row = r.rows[0];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${row.event_type}_${row.event_id_esocial}.xml"`);
    res.send(row.xml);
  } catch (err) { logError('rh.esocial.download', err); res.status(500).send('Erro'); }
});

// Atualizar status (marcar enviado / aceito / rejeitado com protocolo)
router.put('/esocial/events/:id/status', async (req, res) => {
  try {
    await ensureEsocialTables();
    const { status, protocol, receipt_number, error_message, response_data } = req.body;
    if (!ESOCIAL_STATUS.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const cur = (await query(`SELECT * FROM rh_esocial_events WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    const r = await query(
      `UPDATE rh_esocial_events SET status=$2, protocol=COALESCE($3,protocol),
        receipt_number=COALESCE($4,receipt_number), error_message=$5,
        response_data=COALESCE($6, response_data),
        sent_at=CASE WHEN $2='enviado' AND sent_at IS NULL THEN NOW() ELSE sent_at END,
        processed_at=CASE WHEN $2 IN ('aceito','rejeitado') THEN NOW() ELSE processed_at END,
        updated_at=NOW() WHERE id=$1 RETURNING *`,
      [cur.id, status, protocol || null, receipt_number || null, error_message || null,
        response_data ? JSON.stringify(response_data) : null]
    );
    await auditLog(cur.organization_id, 'esocial_event', cur.id, 'status',
      [{ field: 'status', oldVal: cur.status, newVal: status }], req.userId);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.esocial.status', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

// Excluir (só se ainda não enviado)
router.delete('/esocial/events/:id', async (req, res) => {
  try {
    await ensureEsocialTables();
    const cur = (await query(`SELECT * FROM rh_esocial_events WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    if (!['gerado', 'rejeitado', 'cancelado'].includes(cur.status)) {
      return res.status(400).json({ error: 'Só é possível excluir eventos ainda não enviados/aceitos' });
    }
    await query(`DELETE FROM rh_esocial_events WHERE id=$1`, [cur.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.esocial.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// KPIs
router.get('/esocial/summary', async (req, res) => {
  try {
    await ensureEsocialTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json({ by_type: [], by_status: [] });
    const byType = await query(
      `SELECT event_type, COUNT(*)::int as total FROM rh_esocial_events WHERE organization_id=$1 GROUP BY event_type`, [orgId]);
    const byStatus = await query(
      `SELECT status, COUNT(*)::int as total FROM rh_esocial_events WHERE organization_id=$1 GROUP BY status`, [orgId]);
    const pendingS2200 = await query(
      `SELECT COUNT(*)::int as n FROM employees e WHERE e.organization_id=$1 AND e.status='ativo'
        AND e.cpf IS NOT NULL AND e.admission_date IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM rh_esocial_events ev WHERE ev.reference_id=e.id AND ev.event_type='S-2200' AND ev.status<>'cancelado')`,
      [orgId]);
    res.json({
      by_type: byType.rows, by_status: byStatus.rows,
      pending: { 'S-2200': pendingS2200.rows[0]?.n || 0 },
    });
  } catch (err) { logError('rh.esocial.summary', err); res.status(500).json({ error: 'Erro' }); }
});


// ============================================================
// FASE 14 - AVALIAÇÕES DE DESEMPENHO
// ============================================================
async function ensurePerformanceTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS rh_perf_cycles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cycle_type TEXT NOT NULL DEFAULT '90',
      scale_min INTEGER DEFAULT 1,
      scale_max INTEGER DEFAULT 5,
      criteria JSONB DEFAULT '[]'::jsonb,
      start_date DATE,
      end_date DATE,
      status TEXT NOT NULL DEFAULT 'rascunho',
      opened_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_cycles_org ON rh_perf_cycles(organization_id, created_at DESC)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rh_perf_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      cycle_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      evaluator_id UUID,
      evaluator_type TEXT NOT NULL DEFAULT 'manager',
      status TEXT NOT NULL DEFAULT 'pendente',
      scores JSONB DEFAULT '[]'::jsonb,
      overall_score NUMERIC(4,2),
      strengths TEXT,
      improvements TEXT,
      comments TEXT,
      submitted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_reviews_cycle ON rh_perf_reviews(cycle_id, employee_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_reviews_evaluator ON rh_perf_reviews(evaluator_id, status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_reviews_emp ON rh_perf_reviews(employee_id, cycle_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rh_perf_goals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      cycle_id UUID,
      title TEXT NOT NULL,
      description TEXT,
      metric TEXT,
      target_value NUMERIC(14,2),
      current_value NUMERIC(14,2) DEFAULT 0,
      unit TEXT,
      weight INTEGER DEFAULT 1,
      due_date DATE,
      progress_pct INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'nao_iniciada',
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_goals_emp ON rh_perf_goals(employee_id, cycle_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_goals_org ON rh_perf_goals(organization_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rh_perf_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      given_by UUID,
      given_by_name TEXT,
      feedback_type TEXT NOT NULL DEFAULT 'positivo',
      category TEXT,
      message TEXT NOT NULL,
      is_private BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_feedback_emp ON rh_perf_feedback(employee_id, created_at DESC)`);

  await query(`
    CREATE TABLE IF NOT EXISTS rh_perf_pdi (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      employee_id UUID NOT NULL,
      cycle_id UUID,
      title TEXT NOT NULL DEFAULT 'PDI',
      actions JSONB DEFAULT '[]'::jsonb,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      potential_score INTEGER,
      performance_score NUMERIC(4,2),
      nine_box_cell TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_perf_pdi_emp ON rh_perf_pdi(employee_id)`);
}

const DEFAULT_PERF_CRITERIA = [
  { key: 'entrega', label: 'Entrega de resultados', weight: 3 },
  { key: 'qualidade', label: 'Qualidade do trabalho', weight: 3 },
  { key: 'colaboracao', label: 'Colaboração e trabalho em equipe', weight: 2 },
  { key: 'comunicacao', label: 'Comunicação', weight: 2 },
  { key: 'proatividade', label: 'Proatividade e iniciativa', weight: 2 },
  { key: 'aprendizado', label: 'Aprendizado e desenvolvimento', weight: 2 },
  { key: 'lideranca', label: 'Liderança / influência', weight: 2 },
  { key: 'valores', label: 'Alinhamento com valores da empresa', weight: 3 },
];

function nineBoxCell(perf, pot) {
  // perf 1-5, potential 1-3 (baixo/médio/alto)
  const p = Number(perf || 0);
  const q = Number(pot || 2);
  let pRow;
  if (p >= 4) pRow = 'alto';
  else if (p >= 3) pRow = 'medio';
  else pRow = 'baixo';
  const potMap = { 1: 'baixo', 2: 'medio', 3: 'alto' };
  const pCol = potMap[q] || 'medio';
  return `${pRow}_${pCol}`;
}

// ===== CICLOS =====
router.get('/performance/cycles', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const r = await query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM rh_perf_reviews r WHERE r.cycle_id = c.id) as reviews_total,
              (SELECT COUNT(*)::int FROM rh_perf_reviews r WHERE r.cycle_id = c.id AND r.status = 'enviada') as reviews_done
       FROM rh_perf_cycles c WHERE c.organization_id = $1 ORDER BY c.created_at DESC`, [orgId]);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.cycles.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.get('/performance/cycles/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const c = (await query(`SELECT * FROM rh_perf_cycles WHERE id=$1`, [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Não encontrado' });
    const reviews = await query(
      `SELECT r.*, e.full_name as employee_name, e.position as employee_position,
              ev.full_name as evaluator_name
       FROM rh_perf_reviews r
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN employees ev ON ev.id = r.evaluator_id
       WHERE r.cycle_id=$1 ORDER BY e.full_name, r.evaluator_type`, [c.id]);
    res.json({ ...c, reviews: reviews.rows });
  } catch (err) { logError('rh.perf.cycles.detail', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/performance/cycles', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { name, description, cycle_type, scale_min, scale_max, criteria, start_date, end_date } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    const cr = criteria && criteria.length ? criteria : DEFAULT_PERF_CRITERIA;
    const r = await query(
      `INSERT INTO rh_perf_cycles (organization_id, name, description, cycle_type,
        scale_min, scale_max, criteria, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,1),COALESCE($6,5),$7,$8,$9,$10) RETURNING *`,
      [orgId, name, description || null, cycle_type || '90',
        scale_min, scale_max, JSON.stringify(cr), start_date || null, end_date || null, req.userId]
    );
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.cycles.create', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.put('/performance/cycles/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const b = req.body;
    const r = await query(
      `UPDATE rh_perf_cycles SET name=COALESCE($2,name), description=COALESCE($3,description),
        cycle_type=COALESCE($4,cycle_type), scale_min=COALESCE($5,scale_min), scale_max=COALESCE($6,scale_max),
        criteria=COALESCE($7,criteria), start_date=COALESCE($8,start_date), end_date=COALESCE($9,end_date),
        updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id, b.name, b.description, b.cycle_type, b.scale_min, b.scale_max,
        b.criteria ? JSON.stringify(b.criteria) : null, b.start_date, b.end_date]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.cycles.update', err); res.status(500).json({ error: 'Erro' }); }
});

// Abrir ciclo: cria reviews para colaboradores selecionados conforme cycle_type
router.post('/performance/cycles/:id/open', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const cycle = (await query(`SELECT * FROM rh_perf_cycles WHERE id=$1`, [req.params.id])).rows[0];
    if (!cycle) return res.status(404).json({ error: 'Não encontrado' });
    if (cycle.status !== 'rascunho' && cycle.status !== 'aberto') return res.status(400).json({ error: 'Ciclo não pode ser aberto neste status' });

    const { employee_ids, peers_per_employee = 0 } = req.body;
    const empIds = Array.isArray(employee_ids) && employee_ids.length
      ? employee_ids
      : (await query(`SELECT id FROM employees WHERE organization_id=$1 AND status='ativo'`, [cycle.organization_id])).rows.map(e => e.id);

    let created = 0;
    for (const empId of empIds) {
      const emp = (await query(`SELECT id, direct_manager_id FROM employees WHERE id=$1`, [empId])).rows[0];
      if (!emp) continue;
      const targets = [];
      // autoavaliação
      targets.push({ evaluator_id: empId, evaluator_type: 'self' });
      if (cycle.cycle_type === '180' || cycle.cycle_type === '360') {
        if (emp.direct_manager_id) targets.push({ evaluator_id: emp.direct_manager_id, evaluator_type: 'manager' });
      } else {
        // 90 = só gestor
        if (emp.direct_manager_id) targets.push({ evaluator_id: emp.direct_manager_id, evaluator_type: 'manager' });
      }
      if (cycle.cycle_type === '360') {
        // pares
        if (peers_per_employee > 0) {
          const peers = (await query(
            `SELECT id FROM employees WHERE organization_id=$1 AND status='ativo' AND id<>$2
             AND (department_id = (SELECT department_id FROM employees WHERE id=$2) OR $3=true)
             ORDER BY random() LIMIT $4`,
            [cycle.organization_id, empId, false, peers_per_employee])).rows;
          peers.forEach(p => targets.push({ evaluator_id: p.id, evaluator_type: 'peer' }));
        }
        // subordinados avaliam o gestor (quando emp é gestor de alguém)
        const subs = (await query(`SELECT id FROM employees WHERE direct_manager_id=$1 AND status='ativo'`, [empId])).rows;
        subs.forEach(s => targets.push({ evaluator_id: s.id, evaluator_type: 'subordinate' }));
      }

      for (const t of targets) {
        const exists = await query(
          `SELECT 1 FROM rh_perf_reviews WHERE cycle_id=$1 AND employee_id=$2 AND evaluator_id=$3 AND evaluator_type=$4`,
          [cycle.id, empId, t.evaluator_id, t.evaluator_type]);
        if (exists.rows.length) continue;
        await query(
          `INSERT INTO rh_perf_reviews (organization_id, cycle_id, employee_id, evaluator_id, evaluator_type)
           VALUES ($1,$2,$3,$4,$5)`,
          [cycle.organization_id, cycle.id, empId, t.evaluator_id, t.evaluator_type]);
        created++;
      }
    }

    await query(`UPDATE rh_perf_cycles SET status='em_avaliacao', opened_at=COALESCE(opened_at,NOW()), updated_at=NOW() WHERE id=$1`, [cycle.id]);
    res.json({ ok: true, created, employees: empIds.length });
  } catch (err) { logError('rh.perf.cycles.open', err); res.status(500).json({ error: err.message || 'Erro ao abrir' }); }
});

router.post('/performance/cycles/:id/close', async (req, res) => {
  try {
    await ensurePerformanceTables();
    await query(`UPDATE rh_perf_cycles SET status='concluido', closed_at=NOW(), updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.perf.cycles.close', err); res.status(500).json({ error: 'Erro' }); }
});

router.delete('/performance/cycles/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const c = (await query(`SELECT * FROM rh_perf_cycles WHERE id=$1`, [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Não encontrado' });
    if (c.status !== 'rascunho') return res.status(400).json({ error: 'Só é possível excluir ciclos em rascunho' });
    await query(`DELETE FROM rh_perf_cycles WHERE id=$1`, [c.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.perf.cycles.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== REVIEWS =====
router.get('/performance/reviews', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { cycle_id, employee_id, evaluator_id, status } = req.query;
    let sql = `SELECT r.*, e.full_name as employee_name, e.position as employee_position,
                      ev.full_name as evaluator_name, c.name as cycle_name, c.criteria as cycle_criteria,
                      c.scale_min, c.scale_max
               FROM rh_perf_reviews r
               LEFT JOIN employees e ON e.id = r.employee_id
               LEFT JOIN employees ev ON ev.id = r.evaluator_id
               LEFT JOIN rh_perf_cycles c ON c.id = r.cycle_id
               WHERE r.organization_id=$1`;
    const params = [orgId]; let idx = 2;
    if (cycle_id) { sql += ` AND r.cycle_id=$${idx++}`; params.push(cycle_id); }
    if (employee_id) { sql += ` AND r.employee_id=$${idx++}`; params.push(employee_id); }
    if (evaluator_id) { sql += ` AND r.evaluator_id=$${idx++}`; params.push(evaluator_id); }
    if (status) { sql += ` AND r.status=$${idx++}`; params.push(status); }
    sql += ` ORDER BY r.updated_at DESC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.reviews.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.get('/performance/reviews/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const r = await query(
      `SELECT r.*, e.full_name as employee_name, e.position as employee_position,
              ev.full_name as evaluator_name, c.name as cycle_name, c.criteria as cycle_criteria,
              c.scale_min, c.scale_max, c.cycle_type
       FROM rh_perf_reviews r
       LEFT JOIN employees e ON e.id = r.employee_id
       LEFT JOIN employees ev ON ev.id = r.evaluator_id
       LEFT JOIN rh_perf_cycles c ON c.id = r.cycle_id
       WHERE r.id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.reviews.detail', err); res.status(500).json({ error: 'Erro' }); }
});

router.put('/performance/reviews/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const cur = (await query(`SELECT * FROM rh_perf_reviews WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status === 'enviada') return res.status(400).json({ error: 'Avaliação já enviada, não pode ser editada' });
    const { scores, comments, strengths, improvements } = req.body;

    let overall = null;
    if (Array.isArray(scores) && scores.length) {
      let sum = 0, wSum = 0;
      for (const s of scores) {
        const val = Number(s.value || 0);
        const w = Number(s.weight || 1);
        if (val > 0) { sum += val * w; wSum += w; }
      }
      overall = wSum > 0 ? +(sum / wSum).toFixed(2) : null;
    }

    const r = await query(
      `UPDATE rh_perf_reviews SET scores=COALESCE($2,scores), overall_score=COALESCE($3,overall_score),
        comments=COALESCE($4,comments), strengths=COALESCE($5,strengths), improvements=COALESCE($6,improvements),
        status=CASE WHEN status='pendente' THEN 'em_andamento' ELSE status END,
        updated_at=NOW() WHERE id=$1 RETURNING *`,
      [cur.id, scores ? JSON.stringify(scores) : null, overall, comments, strengths, improvements]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.reviews.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.post('/performance/reviews/:id/submit', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const cur = (await query(`SELECT * FROM rh_perf_reviews WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrada' });
    if (cur.status === 'enviada') return res.status(400).json({ error: 'Já enviada' });
    if (!cur.scores || !Array.isArray(cur.scores) || cur.scores.length === 0) {
      return res.status(400).json({ error: 'Preencha as notas antes de enviar' });
    }
    const r = await query(
      `UPDATE rh_perf_reviews SET status='enviada', submitted_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [cur.id]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.reviews.submit', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== METAS =====
router.get('/performance/goals', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, cycle_id, status } = req.query;
    let sql = `SELECT g.*, e.full_name as employee_name FROM rh_perf_goals g
               LEFT JOIN employees e ON e.id = g.employee_id WHERE g.organization_id=$1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND g.employee_id=$${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND g.cycle_id=$${idx++}`; params.push(cycle_id); }
    if (status) { sql += ` AND g.status=$${idx++}`; params.push(status); }
    sql += ` ORDER BY g.due_date NULLS LAST, g.created_at DESC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.goals.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/performance/goals', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const b = req.body;
    if (!b.employee_id || !b.title) return res.status(400).json({ error: 'Colaborador e título são obrigatórios' });
    const r = await query(
      `INSERT INTO rh_perf_goals (organization_id, employee_id, cycle_id, title, description,
        metric, target_value, current_value, unit, weight, due_date, progress_pct, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),$9,COALESCE($10,1),$11,COALESCE($12,0),COALESCE($13,'nao_iniciada'),$14) RETURNING *`,
      [orgId, b.employee_id, b.cycle_id || null, b.title, b.description || null,
        b.metric || null, b.target_value || null, b.current_value, b.unit || null,
        b.weight, b.due_date || null, b.progress_pct, b.status, req.userId]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.goals.create', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.put('/performance/goals/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const b = req.body;
    let progress = b.progress_pct;
    if (progress === undefined && b.target_value && b.current_value !== undefined) {
      const t = Number(b.target_value); const c = Number(b.current_value);
      progress = t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0;
    }
    let status = b.status;
    if (!status && progress !== undefined) {
      status = progress >= 100 ? 'concluida' : progress > 0 ? 'em_andamento' : 'nao_iniciada';
    }
    const r = await query(
      `UPDATE rh_perf_goals SET title=COALESCE($2,title), description=COALESCE($3,description),
        metric=COALESCE($4,metric), target_value=COALESCE($5,target_value), current_value=COALESCE($6,current_value),
        unit=COALESCE($7,unit), weight=COALESCE($8,weight), due_date=COALESCE($9,due_date),
        progress_pct=COALESCE($10,progress_pct), status=COALESCE($11,status), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, b.title, b.description, b.metric, b.target_value, b.current_value,
        b.unit, b.weight, b.due_date, progress, status]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrada' });
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.goals.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.delete('/performance/goals/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    await query(`DELETE FROM rh_perf_goals WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.perf.goals.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== FEEDBACK CONTÍNUO =====
router.get('/performance/feedback', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id } = req.query;
    let sql = `SELECT f.*, e.full_name as employee_name, g.full_name as given_by_full_name
               FROM rh_perf_feedback f
               LEFT JOIN employees e ON e.id = f.employee_id
               LEFT JOIN employees g ON g.id = f.given_by
               WHERE f.organization_id=$1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND f.employee_id=$${idx++}`; params.push(employee_id); }
    sql += ` ORDER BY f.created_at DESC LIMIT 200`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.feedback.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/performance/feedback', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { employee_id, given_by, given_by_name, feedback_type, category, message, is_private } = req.body;
    if (!employee_id || !message) return res.status(400).json({ error: 'Colaborador e mensagem são obrigatórios' });
    const r = await query(
      `INSERT INTO rh_perf_feedback (organization_id, employee_id, given_by, given_by_name,
        feedback_type, category, message, is_private)
       VALUES ($1,$2,$3,$4,COALESCE($5,'positivo'),$6,$7,COALESCE($8,false)) RETURNING *`,
      [orgId, employee_id, given_by || req.userId, given_by_name || null,
        feedback_type, category || null, message, is_private]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.feedback.create', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.delete('/performance/feedback/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    await query(`DELETE FROM rh_perf_feedback WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.perf.feedback.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// ===== PDI =====
router.get('/performance/pdi', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, cycle_id } = req.query;
    let sql = `SELECT p.*, e.full_name as employee_name, e.position as employee_position
               FROM rh_perf_pdi p LEFT JOIN employees e ON e.id = p.employee_id
               WHERE p.organization_id=$1`;
    const params = [orgId]; let idx = 2;
    if (employee_id) { sql += ` AND p.employee_id=$${idx++}`; params.push(employee_id); }
    if (cycle_id) { sql += ` AND p.cycle_id=$${idx++}`; params.push(cycle_id); }
    sql += ` ORDER BY p.updated_at DESC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.pdi.list', err); res.status(500).json({ error: 'Erro' }); }
});

router.post('/performance/pdi', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const b = req.body;
    if (!b.employee_id) return res.status(400).json({ error: 'Colaborador é obrigatório' });
    const cell = (b.performance_score && b.potential_score) ? nineBoxCell(b.performance_score, b.potential_score) : null;
    const r = await query(
      `INSERT INTO rh_perf_pdi (organization_id, employee_id, cycle_id, title, actions, notes,
        potential_score, performance_score, nine_box_cell)
       VALUES ($1,$2,$3,COALESCE($4,'PDI'),$5,$6,$7,$8,$9) RETURNING *`,
      [orgId, b.employee_id, b.cycle_id || null, b.title,
        JSON.stringify(b.actions || []), b.notes || null,
        b.potential_score || null, b.performance_score || null, cell]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.pdi.create', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.put('/performance/pdi/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const b = req.body;
    const cur = (await query(`SELECT * FROM rh_perf_pdi WHERE id=$1`, [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'Não encontrado' });
    const perf = b.performance_score ?? cur.performance_score;
    const pot = b.potential_score ?? cur.potential_score;
    const cell = (perf && pot) ? nineBoxCell(perf, pot) : cur.nine_box_cell;
    const r = await query(
      `UPDATE rh_perf_pdi SET title=COALESCE($2,title), actions=COALESCE($3,actions), notes=COALESCE($4,notes),
        potential_score=COALESCE($5,potential_score), performance_score=COALESCE($6,performance_score),
        nine_box_cell=$7, status=COALESCE($8,status), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [cur.id, b.title, b.actions ? JSON.stringify(b.actions) : null, b.notes,
        b.potential_score, b.performance_score, cell, b.status]);
    res.json(r.rows[0]);
  } catch (err) { logError('rh.perf.pdi.update', err); res.status(500).json({ error: err.message || 'Erro' }); }
});

router.delete('/performance/pdi/:id', async (req, res) => {
  try {
    await ensurePerformanceTables();
    await query(`DELETE FROM rh_perf_pdi WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { logError('rh.perf.pdi.delete', err); res.status(500).json({ error: 'Erro' }); }
});

// Matriz 9-box (consolidada por colaborador, último PDI)
router.get('/performance/nine-box', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const r = await query(
      `SELECT DISTINCT ON (p.employee_id) p.employee_id, e.full_name, e.position,
              p.performance_score, p.potential_score, p.nine_box_cell
       FROM rh_perf_pdi p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.organization_id=$1 AND p.performance_score IS NOT NULL AND p.potential_score IS NOT NULL
       ORDER BY p.employee_id, p.updated_at DESC`, [orgId]);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.ninebox', err); res.status(500).json({ error: 'Erro' }); }
});

// Resumo consolidado por colaborador (média das reviews enviadas do ciclo)
router.get('/performance/cycles/:id/consolidated', async (req, res) => {
  try {
    await ensurePerformanceTables();
    const r = await query(
      `SELECT r.employee_id, e.full_name, e.position,
              AVG(r.overall_score)::numeric(4,2) as avg_score,
              COUNT(*)::int as reviewers,
              COUNT(*) FILTER (WHERE r.status='enviada')::int as submitted
       FROM rh_perf_reviews r JOIN employees e ON e.id = r.employee_id
       WHERE r.cycle_id=$1 GROUP BY r.employee_id, e.full_name, e.position
       ORDER BY avg_score DESC NULLS LAST`, [req.params.id]);
    res.json(r.rows);
  } catch (err) { logError('rh.perf.consolidated', err); res.status(500).json({ error: 'Erro' }); }
});

export default router;
