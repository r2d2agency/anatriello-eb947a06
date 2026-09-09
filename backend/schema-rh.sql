-- ================================================
-- Schema RH - Módulo de Recursos Humanos Ayratech
-- ================================================

-- Enum: tipo de vínculo
CREATE TYPE IF NOT EXISTS employment_type AS ENUM (
  'clt', 'pj', 'freelancer', 'temporario', 'estagiario', 'aprendiz'
);

-- Enum: perfil funcional
CREATE TYPE IF NOT EXISTS worker_profile AS ENUM (
  'administrativo', 'supervisor', 'promotor', 'operacional'
);

-- Enum: status do colaborador
CREATE TYPE IF NOT EXISTS employee_status AS ENUM (
  'ativo', 'afastado', 'ferias', 'desligado', 'suspenso'
);

-- ================================================
-- Filiais
-- ================================================
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id);

-- ================================================
-- Centros de Custo
-- ================================================
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_centers_org ON cost_centers(organization_id);

-- ================================================
-- Departamentos RH
-- ================================================
CREATE TABLE IF NOT EXISTS rh_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  manager_id UUID, -- FK para employees (adicionado depois)
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rh_departments_org ON rh_departments(organization_id);

-- ================================================
-- Colaboradores (Ficha Completa)
-- ================================================
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- link opcional ao login

  -- Dados pessoais
  full_name VARCHAR(255) NOT NULL,
  social_name VARCHAR(255),
  cpf VARCHAR(14),
  rg VARCHAR(20),
  rg_issuer VARCHAR(20),
  birth_date DATE,
  gender VARCHAR(20),
  marital_status VARCHAR(30),
  nationality VARCHAR(50) DEFAULT 'Brasileira',
  photo_url TEXT,

  -- Contato
  email VARCHAR(255),
  phone VARCHAR(20),
  phone2 VARCHAR(20),
  address TEXT,
  address_number VARCHAR(10),
  complement VARCHAR(100),
  neighborhood VARCHAR(100),
  city VARCHAR(100),
  state VARCHAR(2),
  zip_code VARCHAR(10),

  -- Dados profissionais
  registration_number VARCHAR(50), -- matrícula
  worker_profile worker_profile DEFAULT 'operacional',
  employment_type employment_type DEFAULT 'clt',
  position VARCHAR(255), -- cargo
  role_level VARCHAR(100), -- nível (junior, pleno, senior)
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  department_id UUID REFERENCES rh_departments(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  direct_manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,

  -- Dados contratuais
  admission_date DATE,
  contract_end_date DATE, -- para temporários/estagiários
  probation_end_date DATE,
  termination_date DATE,
  termination_reason TEXT,
  salary NUMERIC(12,2),
  work_schedule VARCHAR(100) DEFAULT '08:00-17:00', -- jornada padrão

  -- Dados bancários
  bank_name VARCHAR(100),
  bank_agency VARCHAR(20),
  bank_account VARCHAR(30),
  bank_account_type VARCHAR(20), -- corrente, poupança, pix

  -- Documentos trabalhistas
  ctps_number VARCHAR(30),
  ctps_series VARCHAR(10),
  pis_pasep VARCHAR(20),
  voter_id VARCHAR(20),
  voter_zone VARCHAR(20),
  voter_section VARCHAR(20),
  skin_color VARCHAR(50),
  military_cert VARCHAR(30),
  cnh VARCHAR(20),
  cnh_category VARCHAR(5),
  cnh_expiry DATE,

  -- PJ
  cnpj VARCHAR(20),
  company_name VARCHAR(255),

  -- Status
  status employee_status DEFAULT 'ativo',

  -- Composição salarial, benefícios e descontos (JSONB arrays)
  salary_items JSONB DEFAULT '[]', -- [{type, description, value}]
  benefits JSONB DEFAULT '[]', -- [{type, description, value, employer_cost}]
  deductions JSONB DEFAULT '[]', -- [{type, description, value}]

  -- Metadados
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_cpf ON employees(cpf);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department_id);

-- Compatibilidade com bases antigas
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deductions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- FK de manager no departamento
ALTER TABLE rh_departments ADD CONSTRAINT fk_rh_dept_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL;

-- ================================================
-- Dependentes
-- ================================================
CREATE TABLE IF NOT EXISTS employee_dependents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  relationship VARCHAR(50),
  birth_date DATE,
  cpf VARCHAR(14),
  ir_deduction BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dependents_emp ON employee_dependents(employee_id);

-- ================================================
-- Documentos do Colaborador
-- ================================================
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type VARCHAR(100) NOT NULL, -- 'contrato', 'atestado', 'certificado', etc.
  title VARCHAR(255) NOT NULL,
  file_url TEXT,
  expiry_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_docs ON employee_documents(employee_id);

-- ================================================
-- Registro de Ponto
-- ================================================
CREATE TABLE IF NOT EXISTS time_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  entry1 TIME,        -- entrada manhã
  exit1 TIME,         -- saída almoço
  entry2 TIME,        -- retorno almoço
  exit2 TIME,         -- saída fim
  entry3 TIME,        -- hora extra entrada
  exit3 TIME,         -- hora extra saída
  total_hours NUMERIC(5,2),
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'normal', -- normal, falta, atestado, feriado, compensado
  justification TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  location_lat NUMERIC(10,7),
  location_lng NUMERIC(10,7),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_records_emp ON time_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_records_date ON time_records(record_date);
CREATE INDEX IF NOT EXISTS idx_time_records_org ON time_records(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_unique ON time_records(employee_id, record_date);

-- ================================================
-- Banco de Horas
-- ================================================
CREATE TABLE IF NOT EXISTS hour_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reference_month VARCHAR(7) NOT NULL, -- '2026-03'
  balance_hours NUMERIC(6,2) DEFAULT 0,
  carried_over NUMERIC(6,2) DEFAULT 0,
  used_hours NUMERIC(6,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hour_bank_emp ON hour_bank(employee_id);

-- ================================================
-- Afastamentos / Férias / Licenças
-- ================================================
CREATE TABLE IF NOT EXISTS employee_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  absence_type VARCHAR(50) NOT NULL, -- 'ferias', 'atestado', 'licenca_maternidade', 'falta', etc.
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER,
  reason TEXT,
  document_url TEXT,
  approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_absences_emp ON employee_absences(employee_id);

-- ================================================
-- Holerites / Demonstrativos de Pagamento
-- ================================================
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reference_month VARCHAR(7) NOT NULL, -- '2026-03'
  payment_type VARCHAR(30) DEFAULT 'mensal', -- mensal, adiantamento, 13o, ferias, rescisao
  gross_salary NUMERIC(12,2) DEFAULT 0,

  -- Proventos (JSONB array: [{description, value, reference}])
  earnings JSONB DEFAULT '[]',
  total_earnings NUMERIC(12,2) DEFAULT 0,

  -- Descontos (JSONB array: [{description, value, reference}])
  deductions JSONB DEFAULT '[]',
  total_deductions NUMERIC(12,2) DEFAULT 0,

  net_salary NUMERIC(12,2) DEFAULT 0,
  fgts_base NUMERIC(12,2) DEFAULT 0,
  fgts_value NUMERIC(12,2) DEFAULT 0,
  inss_base NUMERIC(12,2) DEFAULT 0,
  inss_value NUMERIC(12,2) DEFAULT 0,
  irrf_base NUMERIC(12,2) DEFAULT 0,
  irrf_value NUMERIC(12,2) DEFAULT 0,

  payment_date DATE,
  status VARCHAR(20) DEFAULT 'rascunho', -- rascunho, gerado, pago
  pdf_url TEXT,
  notes TEXT,

  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_month ON payslips(reference_month);
CREATE INDEX IF NOT EXISTS idx_payslips_org ON payslips(organization_id);

-- ================================================
-- Trilha de Auditoria RH
-- ================================================
CREATE TABLE IF NOT EXISTS rh_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL, -- 'employee', 'time_record', 'payslip', etc.
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete'
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_rh_audit_entity ON rh_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_rh_audit_org ON rh_audit_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_rh_audit_date ON rh_audit_log(changed_at);
