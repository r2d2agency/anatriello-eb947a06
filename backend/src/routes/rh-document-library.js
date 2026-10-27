import express from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();
router.use(authenticate);

async function resolveOrgId(req) {
  const fromReq = req.body?.organization_id || req.query?.organization_id || req.organizationId || req.headers['x-organization-id'];
  if (fromReq) return fromReq;
  if (!req.userId) return null;
  const r = await query(
    `SELECT organization_id FROM organization_members WHERE user_id = $1 LIMIT 1`,
    [req.userId]
  );
  return r.rows[0]?.organization_id || null;
}

async function ensureSchema() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS rh_document_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL,
        color VARCHAR(20) DEFAULT '#6366f1',
        is_system BOOLEAN DEFAULT false,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(organization_id, slug)
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_doc_categories_org ON rh_document_categories(organization_id);`);
    await query(`
      CREATE TABLE IF NOT EXISTS rh_document_library (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        category_id UUID REFERENCES rh_document_categories(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        summary TEXT,
        tags TEXT[],
        status VARCHAR(20) DEFAULT 'rascunho',
        is_mandatory BOOLEAN DEFAULT false,
        current_version_id UUID,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_doc_library_org ON rh_document_library(organization_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_doc_library_cat ON rh_document_library(category_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_doc_library_status ON rh_document_library(status);`);
    await query(`
      CREATE TABLE IF NOT EXISTS rh_document_library_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL REFERENCES rh_document_library(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        file_url TEXT NOT NULL,
        file_name VARCHAR(255),
        file_size INTEGER,
        file_hash VARCHAR(128),
        change_reason TEXT,
        published_by UUID REFERENCES users(id) ON DELETE SET NULL,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        is_current BOOLEAN DEFAULT true,
        UNIQUE(document_id, version_number)
      );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_doc_lib_versions_doc ON rh_document_library_versions(document_id);`);
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rh_document_deliveries' AND column_name = 'library_document_id') THEN
          ALTER TABLE rh_document_deliveries ADD COLUMN library_document_id UUID REFERENCES rh_document_library(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rh_document_deliveries' AND column_name = 'library_version_id') THEN
          ALTER TABLE rh_document_deliveries ADD COLUMN library_version_id UUID REFERENCES rh_document_library_versions(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  } catch (e) {
    console.error('document-library.ensureSchema', e);
  }
}

async function ensureCategories(orgId) {
  try {
    await ensureSchema();
    const existing = await query(`SELECT COUNT(*) as c FROM rh_document_categories WHERE organization_id = $1`, [orgId]);
    if (Number(existing.rows[0]?.c || 0) > 0) return;
    const defaults = [
      { name: 'POP', slug: 'pop', color: '#3b82f6' },
      { name: 'Procedimento', slug: 'procedimento', color: '#22c55e' },
      { name: 'Política', slug: 'politica', color: '#a855f7' },
      { name: 'Manual', slug: 'manual', color: '#f59e0b' },
      { name: 'Formulário', slug: 'formulario', color: '#06b6d4' },
      { name: 'Comunicado', slug: 'comunicado', color: '#64748b' },
      { name: 'Treinamento', slug: 'treinamento', color: '#10b981' },
      { name: 'Outro', slug: 'outro', color: '#94a3b8' },
    ];
    for (const cat of defaults) {
      await query(
        `INSERT INTO rh_document_categories (organization_id, name, slug, color, is_system, active) VALUES ($1,$2,$3,$4,true,true) ON CONFLICT (organization_id, slug) DO NOTHING`,
        [orgId, cat.name, cat.slug, cat.color]
      );
    }
  } catch (e) {
    console.error('document-library.ensureCategories', e);
  }
}

// Categories
router.get('/categories', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    await ensureCategories(orgId);
    const r = await query(`SELECT * FROM rh_document_categories WHERE organization_id = $1 AND active = true ORDER BY name`, [orgId]);
    res.json(r.rows);
  } catch (err) {
    console.error('document-library.categories.get', err);
    res.status(500).json({ error: 'Erro ao listar categorias', detail: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const { name, slug, color } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const finalSlug = (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const r = await query(
      `INSERT INTO rh_document_categories (organization_id, name, slug, color, is_system, active) VALUES ($1,$2,$3,$4,false,true) ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name, active = true RETURNING *`,
      [orgId, name, finalSlug, color || '#6366f1']
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error('document-library.categories.post', err);
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

// Library
router.get('/', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const { search, category_id, status, tag } = req.query;
    const params = [orgId];
    let where = `WHERE d.organization_id = $1`;
    if (category_id) { params.push(category_id); where += ` AND d.category_id = $${params.length}`; }
    if (status) { params.push(status); where += ` AND d.status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (d.title ILIKE $${params.length} OR d.code ILIKE $${params.length} OR d.summary ILIKE $${params.length})`; }
    if (tag) { params.push(tag); where += ` AND $${params.length} = ANY(d.tags)`; }
    const r = await query(
      `SELECT d.*, c.name as category_name, c.color as category_color, c.slug as category_slug,
              v.version_number as current_version_number, v.file_url as current_file_url, v.file_name as current_file_name, v.published_at as current_published_at
       FROM rh_document_library d
       LEFT JOIN rh_document_categories c ON c.id = d.category_id
       LEFT JOIN rh_document_library_versions v ON v.id = d.current_version_id
       ${where}
       ORDER BY d.updated_at DESC, d.created_at DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('document-library.list', err);
    res.status(500).json({ error: 'Erro ao listar acervo' });
  }
});

router.post('/', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const { title, code, category_id, summary, tags, is_mandatory, file_url, file_name, file_size } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });
    if (!file_url) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const doc = await query(
      `INSERT INTO rh_document_library (organization_id, category_id, title, code, summary, tags, status, is_mandatory, created_by, updated_at, last_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'rascunho',$7,$8,NOW(),NOW()) RETURNING *`,
      [orgId, category_id || null, title, code || null, summary || null, Array.isArray(tags) ? tags : null, is_mandatory === true, req.userId || null]
    );
    const document = doc.rows[0];
    const ver = await query(
      `INSERT INTO rh_document_library_versions (document_id, version_number, file_url, file_name, file_size, published_by, published_at, is_current)
       VALUES ($1,1,$2,$3,$4,$5,NOW(),true) RETURNING *`,
      [document.id, file_url, file_name || null, file_size || null, req.userId || null]
    );
    await query(`UPDATE rh_document_library SET current_version_id = $1, updated_at = NOW(), last_updated_at = NOW() WHERE id = $2`, [ver.rows[0].id, document.id]);
    const full = await query(
      `SELECT d.*, c.name as category_name, c.color as category_color, v.version_number as current_version_number, v.file_url as current_file_url
       FROM rh_document_library d LEFT JOIN rh_document_categories c ON c.id = d.category_id LEFT JOIN rh_document_library_versions v ON v.id = d.current_version_id WHERE d.id = $1`,
      [document.id]
    );
    res.json(full.rows[0]);
  } catch (err) {
    console.error('document-library.post', err);
    res.status(500).json({ error: 'Erro ao criar documento' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const doc = await query(
      `SELECT d.*, c.name as category_name, c.color as category_color
       FROM rh_document_library d LEFT JOIN rh_document_categories c ON c.id = d.category_id
       WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (!doc.rows[0]) return res.status(404).json({ error: 'Documento não encontrado' });
    const versions = await query(`SELECT * FROM rh_document_library_versions WHERE document_id = $1 ORDER BY version_number DESC, published_at DESC`, [req.params.id]);
    res.json({ ...doc.rows[0], versions });
  } catch (err) {
    console.error('document-library.get', err);
    res.status(500).json({ error: 'Erro ao buscar documento' });
  }
});

router.post('/:id/versions', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const doc = await query(`SELECT * FROM rh_document_library WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
    if (!doc.rows[0]) return res.status(404).json({ error: 'Documento não encontrado' });
    const { file_url, file_name, file_size, change_reason } = req.body || {};
    if (!file_url) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const last = await query(`SELECT COALESCE(MAX(version_number),0) as m FROM rh_document_library_versions WHERE document_id = $1`, [req.params.id]);
    const next = Number(last.rows[0].m) + 1;
    await query(`UPDATE rh_document_library_versions SET is_current = false WHERE document_id = $1`, [req.params.id]);
    const ver = await query(
      `INSERT INTO rh_document_library_versions (document_id, version_number, file_url, file_name, file_size, change_reason, published_by, published_at, is_current)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),true) RETURNING *`,
      [req.params.id, next, file_url, file_name || null, file_size || null, change_reason || null, req.userId || null]
    );
    await query(`UPDATE rh_document_library SET current_version_id = $1, updated_at = NOW(), last_updated_at = NOW() WHERE id = $2`, [ver.rows[0].id, req.params.id]);
    res.json(ver.rows[0]);
  } catch (err) {
    console.error('document-library.versions.post', err);
    res.status(500).json({ error: 'Erro ao criar nova versão' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const { title, code, category_id, summary, tags, status, is_mandatory } = req.body || {};
    const r = await query(
      `UPDATE rh_document_library SET
         title = COALESCE($1,title),
         code = COALESCE($2,code),
         category_id = CASE WHEN $9 THEN $3::uuid ELSE category_id END,
         summary = COALESCE($4,summary),
         tags = COALESCE($5,tags),
         status = COALESCE($6,status),
         is_mandatory = COALESCE($7,is_mandatory),
         updated_at = NOW(),
         last_updated_at = NOW()
       WHERE id = $8 AND organization_id = $10 RETURNING *`,
      [title || null, code || null, category_id || null, summary || null, Array.isArray(tags) ? tags : null, status || null, typeof is_mandatory === 'boolean' ? is_mandatory : null, req.params.id, category_id === null, orgId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Documento não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('document-library.patch', err);
    res.status(500).json({ error: 'Erro ao atualizar documento' });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organização não identificada' });
    const doc = await query(
      `SELECT d.*, v.file_url, v.id as version_id
       FROM rh_document_library d
       LEFT JOIN rh_document_library_versions v ON v.id = d.current_version_id
       WHERE d.id = $1 AND d.organization_id = $2`,
      [req.params.id, orgId]
    );
    if (!doc.rows[0]) return res.status(404).json({ error: 'Documento não encontrado' });
    const d = doc.rows[0];
    const file_url = d.file_url || d.current_file_url;
    const version_id = d.version_id || d.current_version_id;
    if (!file_url) return res.status(400).json({ error: 'Documento sem arquivo vigente' });

    const { employee_ids = [], sendToAll = false, requires_confirmation = true, requires_signature = false, signature_deadline = null, block_until_signed = false, description = null } = req.body || {};
    let ids = Array.isArray(employee_ids) ? employee_ids.filter(Boolean) : [];
    if (sendToAll) {
      const emps = await query(`SELECT id FROM employees WHERE organization_id = $1 AND COALESCE(NULLIF(TRIM(status::text),''),'ativo') NOT IN ('desligado','inativo','inactive','terminated','demitido')`, [orgId]);
      ids = emps.rows.map(r => r.id);
    }
    if (ids.length === 0) return res.status(400).json({ error: 'Selecione ao menos um colaborador' });

    const batch_id = crypto.randomUUID();
    const results = [];
    for (const empId of ids) {
      const r = await query(
        `INSERT INTO rh_document_deliveries (organization_id, employee_id, title, description, file_url, requires_view_only, requires_confirmation, requires_signature, signature_deadline, block_until_signed, status, sent_by, sent_at, batch_id, library_document_id, library_version_id)
         VALUES ($1,$2,$3,$4,$5,false,$6,$7,$8,$9,'enviado',$10,NOW(),$11,$12,$13) RETURNING *`,
        [orgId, empId, d.title, description || d.summary || null, file_url, requires_confirmation, requires_signature, signature_deadline, block_until_signed, req.userId || null, batch_id, d.id, version_id]
      );
      await query(`INSERT INTO rh_document_delivery_events (delivery_id, event_type, actor_type, actor_id) VALUES ($1,'enviado','rh',$2)`, [r.rows[0].id, req.userId || null]);
      try {
        await query(`INSERT INTO collaborator_notifications (organization_id, employee_id, title, message, type, reference_type, reference_id) VALUES ($1,$2,'Novo documento',$3,'document','delivery',$4)`, [orgId, empId, d.title, r.rows[0].id]);
      } catch {}
      results.push(r.rows[0]);
    }
    res.json({ success: true, batch_id, count: results.length });
  } catch (err) {
    console.error('document-library.send', err);
    res.status(500).json({ error: 'Erro ao enviar documento' });
  }
});

export default router;
