// ============================================================
// RH — Canal de Denúncias (Whistleblower / NR-1)
//   Canal interno anônimo para denúncias de assédio, discriminação,
//   riscos psicossociais, condutas antiéticas e condições inseguras
//   de trabalho, conforme exigido pela NR-1 (gestão de riscos
//   psicossociais). O denunciante nunca é identificado — nenhum
//   dado pessoal, IP ou user-agent é armazenado nas denúncias.
//   Rotas administrativas (RH) aqui; rotas públicas de envio/consulta
//   ficam em rh-whistleblower-public.js (sem autenticação).
// ============================================================
import express from 'express';
import crypto from 'crypto';
import QRCode from 'qrcode';
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

const SLUG_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789'; // sem 0,o,1,l para evitar confusão
function generateSlug(len = 14) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += SLUG_CHARS[bytes[i] % SLUG_CHARS.length];
  return out;
}

export const WHISTLEBLOWER_CATEGORIES = [
  { key: 'assedio_moral', label: 'Assédio moral' },
  { key: 'assedio_sexual', label: 'Assédio sexual' },
  { key: 'discriminacao', label: 'Discriminação' },
  { key: 'riscos_psicossociais', label: 'Sobrecarga / riscos psicossociais (estresse, esgotamento)' },
  { key: 'seguranca_trabalho', label: 'Condições inseguras / segurança do trabalho' },
  { key: 'conduta_etica', label: 'Conduta antiética, fraude ou conflito de interesse' },
  { key: 'outro', label: 'Outro' },
];

let schemaReady = false;
export async function ensureWhistleblowerTables() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS rh_whistleblower_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rh_whistleblower_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      protocol TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'outro',
      description TEXT NOT NULL,
      location TEXT,
      involves_whom TEXT,
      status TEXT NOT NULL DEFAULT 'nova', -- nova | em_analise | concluida
      rh_response TEXT,
      internal_notes TEXT,
      responded_by UUID,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rh_whistle_reports_org ON rh_whistleblower_reports(organization_id, status, created_at DESC);
  `);
  schemaReady = true;
}

// Retorna (criando se necessário) o canal de denúncias da organização
router.get('/channel', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });

    let r = await query(`SELECT * FROM rh_whistleblower_channels WHERE organization_id = $1`, [orgId]);
    if (!r.rows[0]) {
      let slug = generateSlug();
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          r = await query(
            `INSERT INTO rh_whistleblower_channels (organization_id, slug) VALUES ($1, $2) RETURNING *`,
            [orgId, slug]
          );
          break;
        } catch (e) {
          if (e?.code === '23505') { slug = generateSlug(); continue; }
          throw e;
        }
      }
    }
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.whistleblower.channel.get', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.post('/channel/regenerate', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });

    let updated = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = generateSlug();
      try {
        const r = await query(
          `UPDATE rh_whistleblower_channels SET slug = $2, updated_at = NOW() WHERE organization_id = $1 RETURNING *`,
          [orgId, slug]
        );
        updated = r.rows[0];
        break;
      } catch (e) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    if (!updated) return res.status(404).json({ error: 'Canal não encontrado' });
    res.json(updated);
  } catch (err) {
    logError('rh.whistleblower.channel.regenerate', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.put('/channel', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const r = await query(
      `UPDATE rh_whistleblower_channels SET active = $2, updated_at = NOW() WHERE organization_id = $1 RETURNING *`,
      [orgId, req.body.active !== false]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Canal não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.whistleblower.channel.update', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

// Gera um PNG de QR Code para a URL pública informada (não faz nenhuma requisição à URL, apenas a codifica visualmente)
router.get('/channel/qrcode', async (req, res) => {
  try {
    const url = String(req.query.url || '');
    if (!url) return res.status(400).json({ error: 'url é obrigatória' });
    const buffer = await QRCode.toBuffer(url, { type: 'png', width: 480, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    logError('rh.whistleblower.channel.qrcode', err);
    res.status(500).json({ error: 'Erro ao gerar QR Code' });
  }
});

router.get('/categories', (req, res) => res.json(WHISTLEBLOWER_CATEGORIES));

router.get('/reports', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.json([]);
    const { status } = req.query;
    let sql = `SELECT * FROM rh_whistleblower_reports WHERE organization_id = $1`;
    const params = [orgId];
    if (status) { sql += ` AND status = $2`; params.push(status); }
    sql += ` ORDER BY created_at DESC`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (err) {
    logError('rh.whistleblower.reports.list', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.get('/reports/:id', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.query.org_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const r = await query(
      `SELECT * FROM rh_whistleblower_reports WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Denúncia não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.whistleblower.reports.get', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

router.put('/reports/:id', async (req, res) => {
  try {
    await ensureWhistleblowerTables();
    const orgId = req.body.organization_id || await getUserOrgId(req.userId);
    if (!orgId) return res.status(400).json({ error: 'Organização não encontrada' });
    const { status, rh_response, internal_notes } = req.body;

    const setResponded = rh_response !== undefined && rh_response !== null && String(rh_response).trim() !== '';
    const r = await query(
      `UPDATE rh_whistleblower_reports
       SET status = COALESCE($3, status),
           rh_response = COALESCE($4, rh_response),
           internal_notes = COALESCE($5, internal_notes),
           responded_by = CASE WHEN $6 THEN $7 ELSE responded_by END,
           responded_at = CASE WHEN $6 THEN NOW() ELSE responded_at END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [req.params.id, orgId, status || null, rh_response ?? null, internal_notes ?? null, setResponded, req.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Denúncia não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.whistleblower.reports.update', err);
    res.status(500).json({ error: 'Erro', detail: err.message });
  }
});

export default router;
