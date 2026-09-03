// ============================================================
// RH — Lançamentos de Deduções / Proventos avulsos
//   Permite lançar adiantamentos, multas, vales etc. por
//   colaborador/mês. Ao gerar holerite ou a folha de pagamento
//   os itens pendentes são consolidados automaticamente.
// ============================================================
import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logError } from '../logger.js';

const router = express.Router();
router.use(authenticate);

async function getUserOrgId(userId) {
  const r = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.organization_id;
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS rh_payroll_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID,
      employee_id UUID NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'deducao',   -- 'deducao' | 'provento'
      category VARCHAR(50) NOT NULL DEFAULT 'outro', -- adiantamento, multa, vale, emprestimo, plano, outro...
      description TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      reference_month VARCHAR(7) NOT NULL,           -- YYYY-MM
      installments_total INTEGER DEFAULT 1,
      installment_number INTEGER DEFAULT 1,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente',-- pendente | aplicada | cancelada
      applied_payslip_id UUID,
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rh_pay_entries_emp ON rh_payroll_entries(employee_id, reference_month);
    CREATE INDEX IF NOT EXISTS idx_rh_pay_entries_org ON rh_payroll_entries(organization_id, reference_month, status);
  `);
  schemaReady = true;
}

// ------------------- CRUD -------------------
router.get('/', async (req, res) => {
  try {
    await ensureSchema();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { employee_id, reference_month, status, kind, category } = req.query;
    let sql = `SELECT e.*, emp.full_name as employee_name, emp.cpf, emp.registration_number, emp.company_id
               FROM rh_payroll_entries e
               LEFT JOIN employees emp ON emp.id = e.employee_id
               WHERE e.organization_id = $1`;
    const params = [orgId];
    let i = 2;
    if (employee_id) { sql += ` AND e.employee_id = $${i++}`; params.push(employee_id); }
    if (reference_month) { sql += ` AND e.reference_month = $${i++}`; params.push(reference_month); }
    if (status) { sql += ` AND e.status = $${i++}`; params.push(status); }
    if (kind) { sql += ` AND e.kind = $${i++}`; params.push(kind); }
    if (category) { sql += ` AND e.category = $${i++}`; params.push(category); }
    sql += ` ORDER BY e.reference_month DESC, emp.full_name`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) {
    logError('rh.deductions.list', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await ensureSchema();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const d = req.body;
    const total = Math.max(1, Number(d.installments_total || 1));
    const inst = Math.max(1, Number(d.installment_number || 1));
    const created = [];
    // If installments_total > 1 and installment_number == 1, cria N parcelas em meses subsequentes
    if (total > 1 && (d.spread_installments === true || d.spread_installments === 'true')) {
      const [yy, mm] = String(d.reference_month).split('-').map(Number);
      for (let k = 0; k < total; k++) {
        const dt = new Date(Date.UTC(yy, (mm - 1) + k, 1));
        const ref = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
        const r = await query(
          `INSERT INTO rh_payroll_entries (organization_id, employee_id, kind, category, description, amount, reference_month, installments_total, installment_number, status, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente',$10,$11) RETURNING *`,
          [orgId, d.employee_id, d.kind || 'deducao', d.category || 'outro',
           `${d.description} (${k+1}/${total})`, Number(d.amount || 0), ref, total, k+1, d.notes, req.userId]
        );
        created.push(r.rows[0]);
      }
    } else {
      const r = await query(
        `INSERT INTO rh_payroll_entries (organization_id, employee_id, kind, category, description, amount, reference_month, installments_total, installment_number, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pendente',$10,$11) RETURNING *`,
        [orgId, d.employee_id, d.kind || 'deducao', d.category || 'outro',
         d.description, Number(d.amount || 0), d.reference_month, total, inst, d.notes, req.userId]
      );
      created.push(r.rows[0]);
    }
    res.json(created.length === 1 ? created[0] : created);
  } catch (err) {
    logError('rh.deductions.create', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await ensureSchema();
    const d = req.body;
    const r = await query(
      `UPDATE rh_payroll_entries
       SET kind=COALESCE($2,kind), category=COALESCE($3,category), description=COALESCE($4,description),
           amount=COALESCE($5,amount), reference_month=COALESCE($6,reference_month),
           status=COALESCE($7,status), notes=COALESCE($8,notes), updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, d.kind, d.category, d.description, d.amount, d.reference_month, d.status, d.notes]
    );
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.deductions.update', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ensureSchema();
    await query(`DELETE FROM rh_payroll_entries WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    logError('rh.deductions.delete', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

// ------------------- Payment sheet (Folha do Mês) -------------------
// Consolida por colaborador: salário base, proventos avulsos, deduções avulsas, líquido a pagar
async function buildPaymentSheet(orgId, month, companyId) {
  await ensureSchema();
  const params = [orgId];
  // Colunas reais do schema: `salary` (não base_salary), sem pix_key.
  // Filtro tolerante: se não houver termination_date, é ativo.
  let empSql = `SELECT id, full_name, cpf, registration_number, position,
                       COALESCE(salary, 0) AS salary, COALESCE(benefits, '[]'::jsonb) AS benefits, company_id,
                       bank_account, bank_agency, bank_name, bank_account_type
                FROM employees
                WHERE organization_id=$1
                  AND (status IS NULL OR status::text NOT IN ('inativo','desligado','demitido'))
                  AND termination_date IS NULL`;
  if (companyId) { empSql += ` AND company_id=$${params.length + 1}`; params.push(companyId); }
  empSql += ` ORDER BY full_name`;
  let employees = [];
  try { employees = (await query(empSql, params)).rows; }
  catch (e) {
    // Fallback quando alguma coluna opcional não existe
    const fb = await query(
      `SELECT id, full_name, cpf, registration_number, position, company_id,
              COALESCE(salary, 0) AS salary, COALESCE(benefits, '[]'::jsonb) AS benefits
       FROM employees WHERE organization_id=$1 ${companyId ? 'AND company_id=$2' : ''}
       ORDER BY full_name`,
      companyId ? [orgId, companyId] : [orgId]
    );
    employees = fb.rows.map(r => ({ ...r, bank_account: '', bank_agency: '', bank_name: '', bank_account_type: '' }));
  }

  const entriesRes = await query(
    `SELECT * FROM rh_payroll_entries WHERE organization_id=$1 AND reference_month=$2 AND status IN ('pendente','aplicada')`,
    [orgId, month]
  );
  const byEmp = new Map();
  for (const e of entriesRes.rows) {
    if (!byEmp.has(e.employee_id)) byEmp.set(e.employee_id, []);
    byEmp.get(e.employee_id).push(e);
  }

  const payRes = await query(
    `SELECT employee_id, gross_salary, total_earnings, total_deductions, net_salary
     FROM payslips WHERE organization_id=$1 AND reference_month=$2`,
    [orgId, month]
  ).catch(() => ({ rows: [] }));
  const payMap = new Map((payRes.rows || []).map(p => [p.employee_id, p]));

  const rows = employees.map(emp => {
    const ents = byEmp.get(emp.id) || [];
    const proventos = ents.filter(x => x.kind === 'provento').reduce((s, x) => s + Number(x.amount || 0), 0);
    const deducoes = ents.filter(x => x.kind === 'deducao').reduce((s, x) => s + Number(x.amount || 0), 0);
    const pay = payMap.get(emp.id);
    const base = Number(pay?.gross_salary ?? emp.salary ?? 0);
    const totalProv = Number(pay?.total_earnings ?? 0) + proventos;
    const totalDed = Number(pay?.total_deductions ?? 0) + deducoes;
    const bruto = base + totalProv;
    const liquido = pay?.net_salary != null
      ? Number(pay.net_salary) + proventos - deducoes
      : bruto - totalDed;
    const beneficios = (Array.isArray(emp.benefits) ? emp.benefits : [])
      .reduce((s, b) => s + (Number(b?.value) || 0), 0);
    const isPix = String(emp.bank_account_type || '').toLowerCase() === 'pix';
    return {
      employee_id: emp.id,
      matricula: emp.registration_number || '',
      nome: emp.full_name,
      cpf: emp.cpf || '',
      cargo: emp.position || '',
      company_id: emp.company_id,
      salario_base: base,
      proventos_avulsos: proventos,
      deducoes_avulsas: deducoes,
      total_bruto: bruto,
      total_descontos: totalDed,
      liquido_a_pagar: Number(liquido.toFixed(2)),
      beneficios: Number(beneficios.toFixed(2)),
      total_geral: Number((liquido + beneficios).toFixed(2)),
      pix: isPix ? (emp.bank_account || '') : '',
      banco: emp.bank_name || '',
      agencia: emp.bank_agency || '',
      conta: emp.bank_account || '',
      lancamentos: ents.map(e => ({
        id: e.id, kind: e.kind, category: e.category, description: e.description, amount: Number(e.amount)
      })),
    };
  });

  const totals = rows.reduce((acc, r) => ({
    salario_base: acc.salario_base + r.salario_base,
    proventos_avulsos: acc.proventos_avulsos + r.proventos_avulsos,
    deducoes_avulsas: acc.deducoes_avulsas + r.deducoes_avulsas,
    total_bruto: acc.total_bruto + r.total_bruto,
    total_descontos: acc.total_descontos + r.total_descontos,
    liquido_a_pagar: acc.liquido_a_pagar + r.liquido_a_pagar,
    beneficios: acc.beneficios + r.beneficios,
    total_geral: acc.total_geral + r.total_geral,
  }), { salario_base:0, proventos_avulsos:0, deducoes_avulsas:0, total_bruto:0, total_descontos:0, liquido_a_pagar:0, beneficios:0, total_geral:0 });

  return { month, employees_count: rows.length, rows, totals };
}

router.get('/payment-sheet', async (req, res) => {
  try {
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const month = req.query.month;
    if (!month) return res.status(400).json({ error: 'month é obrigatório' });
    const companyId = req.query.company_id || null;
    const format = String(req.query.format || 'json').toLowerCase();
    const data = await buildPaymentSheet(orgId, month, companyId);

    if (format === 'json') return res.json(data);

    if (format === 'csv') {
      const header = ['Matricula','CPF','Nome','Cargo','Salario Base','Proventos','Descontos','Total Bruto','Total Descontos','Liquido a Pagar','Beneficios','Total Geral','PIX','Banco','Agencia','Conta'];
      const lines = [header.join(';')];
      for (const r of data.rows) {
        lines.push([
          r.matricula, r.cpf, `"${(r.nome||'').replace(/"/g,'""')}"`, `"${(r.cargo||'').replace(/"/g,'""')}"`,
          r.salario_base.toFixed(2).replace('.',','),
          r.proventos_avulsos.toFixed(2).replace('.',','),
          r.deducoes_avulsas.toFixed(2).replace('.',','),
          r.total_bruto.toFixed(2).replace('.',','),
          r.total_descontos.toFixed(2).replace('.',','),
          r.liquido_a_pagar.toFixed(2).replace('.',','),
          r.beneficios.toFixed(2).replace('.',','),
          r.total_geral.toFixed(2).replace('.',','),
          r.pix, r.banco, r.agencia, r.conta,
        ].join(';'));
      }
      lines.push(['','','TOTAIS','','',
        data.totals.salario_base.toFixed(2).replace('.',','),
        data.totals.proventos_avulsos.toFixed(2).replace('.',','),
        data.totals.deducoes_avulsas.toFixed(2).replace('.',','),
        data.totals.total_bruto.toFixed(2).replace('.',','),
        data.totals.total_descontos.toFixed(2).replace('.',','),
        data.totals.liquido_a_pagar.toFixed(2).replace('.',','),
        data.totals.beneficios.toFixed(2).replace('.',','),
        data.totals.total_geral.toFixed(2).replace('.',','),
      ].join(';'));
      const csv = '\ufeff' + lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="folha-${month}.csv"`);
      return res.send(csv);
    }

    if (format === 'html' || format === 'pdf') {
      const brl = (v) => 'R$ ' + Number(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const rowsHtml = data.rows.map(r => `
        <tr>
          <td>${r.matricula||''}</td>
          <td>${r.nome||''}</td>
          <td>${r.cpf||''}</td>
          <td>${r.cargo||''}</td>
          <td class="r">${brl(r.salario_base)}</td>
          <td class="r pos">${brl(r.proventos_avulsos)}</td>
          <td class="r neg">${brl(r.deducoes_avulsas)}</td>
          <td class="r">${brl(r.liquido_a_pagar)}</td>
          <td class="r">${brl(r.beneficios)}</td>
          <td class="r"><b>${brl(r.total_geral)}</b></td>
          <td>${r.pix||[r.banco,r.agencia,r.conta].filter(Boolean).join(' / ')}</td>
        </tr>`).join('');
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
        <title>Folha de Pagamento — ${month}</title>
        <style>
          body{font-family:Arial,sans-serif;font-size:11px;margin:24px;color:#111}
          h1{font-size:16px;margin:0 0 4px}
          .sub{color:#555;font-size:11px;margin-bottom:16px}
          table{width:100%;border-collapse:collapse}
          th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}
          th{background:#f4f4f5;font-size:10px;text-transform:uppercase;letter-spacing:.03em}
          .r{text-align:right;font-variant-numeric:tabular-nums}
          .pos{color:#065f46}
          .neg{color:#991b1b}
          tfoot td{border-top:2px solid #111;font-weight:700;background:#fafafa}
          .print{margin-bottom:12px}
          @media print { .print{display:none} }
        </style></head><body>
        <div class="print"><button onclick="window.print()">Imprimir / Salvar como PDF</button></div>
        <h1>Folha de Pagamento — ${month}</h1>
        <div class="sub">${data.employees_count} colaboradores • Gerado em ${new Date().toLocaleString('pt-BR')}</div>
        <table>
          <thead><tr>
            <th>Matr.</th><th>Nome</th><th>CPF</th><th>Cargo</th>
            <th class="r">Sal. Base</th><th class="r">Proventos</th>
            <th class="r">Descontos</th><th class="r">Líquido</th>
            <th class="r">Benefícios</th><th class="r">Total Geral</th>
            <th>Pagamento</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot><tr>
            <td colspan="4">TOTAIS</td>
            <td class="r">${brl(data.totals.salario_base)}</td>
            <td class="r pos">${brl(data.totals.proventos_avulsos)}</td>
            <td class="r neg">${brl(data.totals.deducoes_avulsas)}</td>
            <td class="r">${brl(data.totals.liquido_a_pagar)}</td>
            <td class="r">${brl(data.totals.beneficios)}</td>
            <td class="r"><b>${brl(data.totals.total_geral)}</b></td>
            <td></td>
          </tr></tfoot>
        </table></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    res.status(400).json({ error: 'Formato inválido' });
  } catch (err) {
    logError('rh.deductions.payment-sheet', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

// Aplica lançamentos pendentes em um holerite existente (merge deductions/earnings JSONB)
router.post('/apply-to-payslip/:payslip_id', async (req, res) => {
  try {
    await ensureSchema();
    const psRes = await query(`SELECT * FROM payslips WHERE id=$1`, [req.params.payslip_id]);
    const ps = psRes.rows[0];
    if (!ps) return res.status(404).json({ error: 'Holerite não encontrado' });

    const entriesRes = await query(
      `SELECT * FROM rh_payroll_entries WHERE organization_id=$1 AND employee_id=$2 AND reference_month=$3 AND status='pendente'`,
      [ps.organization_id, ps.employee_id, ps.reference_month]
    );
    if (!entriesRes.rows.length) return res.json({ ok: true, applied: 0, payslip: ps });

    const earnings = Array.isArray(ps.earnings) ? [...ps.earnings] : [];
    const deductions = Array.isArray(ps.deductions) ? [...ps.deductions] : [];
    for (const e of entriesRes.rows) {
      const item = { code: e.category, description: e.description, reference: '', value: Number(e.amount || 0), entry_id: e.id };
      if (e.kind === 'provento') earnings.push(item); else deductions.push(item);
    }
    const totalE = earnings.reduce((s, x) => s + Number(x.value || 0), 0);
    const totalD = deductions.reduce((s, x) => s + Number(x.value || 0), 0);
    const net = Number(ps.gross_salary || 0) + totalE - totalD;

    const upd = await query(
      `UPDATE payslips SET earnings=$2, total_earnings=$3, deductions=$4, total_deductions=$5, net_salary=$6, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [ps.id, JSON.stringify(earnings), totalE, JSON.stringify(deductions), totalD, net]
    );
    await query(
      `UPDATE rh_payroll_entries SET status='aplicada', applied_payslip_id=$2, updated_at=NOW() WHERE id = ANY($1::uuid[])`,
      [entriesRes.rows.map(r => r.id), ps.id]
    );
    res.json({ ok: true, applied: entriesRes.rows.length, payslip: upd.rows[0] });
  } catch (err) {
    logError('rh.deductions.apply', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

export default router;
