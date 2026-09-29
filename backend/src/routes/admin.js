import { Router } from 'express';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import * as wapiProvider from '../lib/wapi-provider.js';

const router = Router();

const DEFAULT_BRANDING = {
  logo_login: null,
  logo_sidebar: null,
  logo_topbar: null,
  favicon: null,
  company_name: null,
  theme_preset: null,
  theme_custom_colors: null,
};

const BRANDING_MEDIA_KEYS = new Set(['logo_login', 'logo_sidebar', 'logo_topbar', 'favicon']);

function getRequestBaseUrl(req) {
  const envBase = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return envBase;

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers['host'] || '').split(',')[0].trim();
  if (!forwardedHost) return '';
  return `${forwardedProto || req.protocol || 'https'}://${forwardedHost}`;
}

function resolveBrandingMediaUrl(value, req) {
  if (!value || typeof value !== 'string') return value || null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;

  const baseUrl = getRequestBaseUrl(req);
  if (!baseUrl) return trimmed;
  if (trimmed.startsWith('/')) return `${baseUrl}${trimmed}`;
  if (trimmed.startsWith('uploads/')) return `${baseUrl}/${trimmed}`;
  return trimmed;
}

function resolveBrandingPayload(payload, req) {
  const resolved = { ...payload };
  for (const key of BRANDING_MEDIA_KEYS) {
    resolved[key] = resolveBrandingMediaUrl(resolved[key], req);
  }
  return resolved;
}

// Ensure has_projects column exists on plans table
(async () => {
  try {
    await query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_projects BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_rh BOOLEAN DEFAULT true`);
  } catch (_) {}
})();

// Public endpoint to get branding settings (no auth required)
// NOTE: Must be defined before router.use(authenticate)
router.get('/branding', async (req, res) => {
  try {
    const branding = { ...DEFAULT_BRANDING };
    const tableCheck = await query(`SELECT to_regclass('public.system_settings') AS table_name`);

    if (tableCheck.rows[0]?.table_name) {
      const result = await query(
        `SELECT key, value FROM system_settings 
         WHERE key IN ('logo_login', 'logo_sidebar', 'logo_topbar', 'favicon', 'company_name', 'theme_preset', 'theme_custom_colors')`
      );

      for (const row of result.rows) {
        branding[row.key] = row.value;
      }
    }

    // Fallback: use logo_sidebar as logo_topbar if not set
    if (!branding.logo_topbar && branding.logo_sidebar) {
      branding.logo_topbar = branding.logo_sidebar;
    }

    // If org_id is provided, overlay org-specific theme
    const orgId = req.query.org_id;
    if (orgId) {
      try {
        const orgResult = await query(
          `SELECT theme_preset, theme_custom_colors FROM organizations WHERE id = $1`,
          [orgId]
        );
        if (orgResult.rows.length > 0) {
          const org = orgResult.rows[0];
          if (org.theme_preset) {
            branding.theme_preset = org.theme_preset;
            branding.theme_custom_colors = org.theme_custom_colors;
          }
        }
      } catch (e) {
        // Columns might not exist yet, ignore
      }
    }

    res.json(resolveBrandingPayload(branding, req));
  } catch (error) {
    console.error('Get branding error:', error);
    res.json({ ...DEFAULT_BRANDING });
  }
});

// Public endpoint for pre-registration (creates a deal in superadmin's CRM)
// NOTE: Must be defined before router.use(authenticate)
router.post('/pre-register', async (req, res) => {
  try {
    const { name, email, whatsapp } = req.body;

    // Validate inputs
    if (!name || !email || !whatsapp) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    // Sanitize phone - keep only digits
    const phone = whatsapp.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) {
      return res.status(400).json({ error: 'WhatsApp inválido' });
    }

    // Sanitize name - limit length
    const sanitizedName = name.trim().slice(0, 100);
    const sanitizedEmail = email.trim().toLowerCase().slice(0, 255);

    // Find superadmin user
    const superadminResult = await query(
      `SELECT u.id, om.organization_id 
       FROM users u 
       JOIN organization_members om ON om.user_id = u.id 
       WHERE u.is_superadmin = true 
       LIMIT 1`
    );

    if (superadminResult.rows.length === 0) {
      console.error('Pre-register: No superadmin found');
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }

    const superadmin = superadminResult.rows[0];
    const organizationId = superadmin.organization_id;

    // Find or create a funnel for leads
    let funnelResult = await query(
      `SELECT id FROM crm_funnels 
       WHERE organization_id = $1 AND is_active = true 
       ORDER BY created_at ASC LIMIT 1`,
      [organizationId]
    );

    let funnelId;
    let stageId;

    if (funnelResult.rows.length === 0) {
      // Create a default leads funnel
      const newFunnel = await query(
        `INSERT INTO crm_funnels (organization_id, name, description, color)
         VALUES ($1, 'Leads Landing Page', 'Leads capturados pela landing page', '#6366f1')
         RETURNING id`,
        [organizationId]
      );
      funnelId = newFunnel.rows[0].id;

      // Create stages
      await query(
        `INSERT INTO crm_stages (funnel_id, name, color, position, inactivity_hours, inactivity_color, is_final)
         VALUES 
           ($1, 'Novo Lead', '#3b82f6', 0, 24, '#ef4444', false),
           ($1, 'Contato Inicial', '#8b5cf6', 1, 48, '#ef4444', false),
           ($1, 'Demonstração', '#f59e0b', 2, 72, '#ef4444', false),
           ($1, 'Proposta', '#22c55e', 3, 96, '#ef4444', false),
           ($1, 'Fechado', '#10b981', 4, 0, '#22c55e', true)`,
        [funnelId]
      );

      // Get first stage
      const stageResult = await query(
        `SELECT id FROM crm_stages WHERE funnel_id = $1 ORDER BY position ASC LIMIT 1`,
        [funnelId]
      );
      stageId = stageResult.rows[0].id;
    } else {
      funnelId = funnelResult.rows[0].id;
      
      // Get first stage of existing funnel
      const stageResult = await query(
        `SELECT id FROM crm_stages WHERE funnel_id = $1 ORDER BY position ASC LIMIT 1`,
        [funnelId]
      );
      
      if (stageResult.rows.length === 0) {
        // Create a default stage if none exists
        const newStage = await query(
          `INSERT INTO crm_stages (funnel_id, name, color, position, inactivity_hours, inactivity_color, is_final)
           VALUES ($1, 'Novo Lead', '#3b82f6', 0, 24, '#ef4444', false)
           RETURNING id`,
          [funnelId]
        );
        stageId = newStage.rows[0].id;
      } else {
        stageId = stageResult.rows[0].id;
      }
    }

    // Get or create default company
    let companyResult = await query(
      `SELECT id FROM crm_companies 
       WHERE organization_id = $1 AND name = 'Leads Landing Page' 
       LIMIT 1`,
      [organizationId]
    );

    let companyId;
    if (companyResult.rows.length === 0) {
      const newCompany = await query(
        `INSERT INTO crm_companies (organization_id, name, created_by)
         VALUES ($1, 'Leads Landing Page', $2)
         RETURNING id`,
        [organizationId, superadmin.id]
      );
      companyId = newCompany.rows[0].id;
    } else {
      companyId = companyResult.rows[0].id;
    }

    // Check if lead with same email or phone already exists
    const existingDeal = await query(
      `SELECT d.id FROM crm_deals d
       WHERE d.organization_id = $1 
         AND (d.description ILIKE $2 OR d.description ILIKE $3)
       LIMIT 1`,
      [organizationId, `%${sanitizedEmail}%`, `%${phone}%`]
    );

    if (existingDeal.rows.length > 0) {
      // Update existing deal to move back to first stage
      await query(
        `UPDATE crm_deals SET 
           last_activity_at = NOW(), 
           updated_at = NOW(),
           description = $2
         WHERE id = $1`,
        [existingDeal.rows[0].id, `Email: ${sanitizedEmail}\nWhatsApp: ${phone}\n\nAtualizado em: ${new Date().toLocaleString('pt-BR')}`]
      );
      
      return res.json({ success: true, message: 'Lead atualizado' });
    }

    // Create the deal
    const dealResult = await query(
      `INSERT INTO crm_deals (
         organization_id, funnel_id, stage_id, company_id, 
         title, value, probability, status, 
         description, owner_id, created_by
       ) VALUES ($1, $2, $3, $4, $5, 0, 10, 'open', $6, $7, $7)
       RETURNING id`,
      [
        organizationId,
        funnelId,
        stageId,
        companyId,
        `Lead: ${sanitizedName}`,
        `Nome: ${sanitizedName}\nEmail: ${sanitizedEmail}\nWhatsApp: ${phone}\n\nCadastrado via Landing Page em: ${new Date().toLocaleString('pt-BR')}`,
        superadmin.id
      ]
    );

    // Log history
    await query(
      `INSERT INTO crm_deal_history (deal_id, user_id, action, to_value)
       VALUES ($1, $2, 'created', 'Lead via Landing Page')`,
      [dealResult.rows[0].id, superadmin.id]
    );

    console.log(`Pre-register: Created deal ${dealResult.rows[0].id} for ${sanitizedEmail}`);
    res.json({ success: true, message: 'Cadastro recebido com sucesso' });

  } catch (error) {
    console.error('Pre-register error:', error);
    res.status(500).json({ error: 'Erro ao processar cadastro' });
  }
});

router.use(authenticate);

// Middleware to check superadmin
const requireSuperadmin = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT is_superadmin, email FROM users WHERE id = $1`,
      [req.userId]
    );
    const row = result.rows[0];
    const isMasterAdmin = String(row?.email || '').toLowerCase().trim() === 'tnicodemos@gmail.com';
    
    if (result.rows.length === 0 || (!row.is_superadmin && !isMasterAdmin)) {
      return res.status(403).json({ error: 'Acesso negado. Requer superadmin.' });
    }
    
    next();
  } catch (error) {
    console.error('Superadmin check error:', error);
    res.status(500).json({ error: 'Erro ao verificar permissões' });
  }
};

// Dynamic cleanup helper for user deletion (prevents FK-related 500s)
const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

async function cleanupDynamicUserReferences(userId) {
  const refsResult = await query(
    `SELECT tc.table_name, kcu.column_name, cols.is_nullable, rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_name = tc.constraint_name
      AND rc.constraint_schema = tc.table_schema
     JOIN information_schema.columns cols
       ON cols.table_schema = kcu.table_schema
      AND cols.table_name = kcu.table_name
      AND cols.column_name = kcu.column_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND ccu.table_name = 'users'
       AND ccu.column_name = 'id'`
  );

  // Handled explicitly before dynamic cleanup
  const alreadyHandled = new Set(['organization_members', 'department_members', 'user_roles']);

  for (const ref of refsResult.rows) {
    const tableName = ref.table_name;
    const columnName = ref.column_name;

    if (!tableName || !columnName || tableName === 'users' || alreadyHandled.has(tableName)) {
      continue;
    }

    // CASCADE relations are handled automatically by Postgres
    if (ref.delete_rule === 'CASCADE') {
      continue;
    }

    const tableSql = quoteIdentifier(tableName);
    const columnSql = quoteIdentifier(columnName);
    const cleanupSql =
      ref.is_nullable === 'YES'
        ? `UPDATE ${tableSql} SET ${columnSql} = NULL WHERE ${columnSql} = $1`
        : `DELETE FROM ${tableSql} WHERE ${columnSql} = $1`;

    try {
      await query(cleanupSql, [userId]);
    } catch (err) {
      // ignore missing table/column during partial deploys
      if (err.code !== '42P01' && err.code !== '42703') {
        console.warn(`[Delete user] Dynamic cleanup warning on ${tableName}.${columnName}: ${err.message}`);
      }
    }
  }
}

async function deleteUserWithCleanup(userId) {
  // Explicit high-priority cleanup for hot tables
  const cleanupQueries = [
    `DELETE FROM organization_members WHERE user_id = $1`,
    `DELETE FROM department_members WHERE user_id = $1`,
    `DELETE FROM user_roles WHERE user_id = $1`,
    `DELETE FROM crm_user_group_members WHERE user_id = $1`,
    `UPDATE crm_deals SET responsible_user_id = NULL WHERE responsible_user_id = $1`,
    `UPDATE crm_tasks SET assigned_user_id = NULL WHERE assigned_user_id = $1`,
    `UPDATE crm_prospects SET responsible_user_id = NULL WHERE responsible_user_id = $1`,
    `UPDATE conversations SET assigned_user_id = NULL WHERE assigned_user_id = $1`,
    `DELETE FROM conversation_notes WHERE user_id = $1`,
    `UPDATE chatbots SET created_by = NULL WHERE created_by = $1`,
    `DELETE FROM sessions WHERE user_id = $1`,
  ];

  for (const sql of cleanupQueries) {
    try {
      await query(sql, [userId]);
    } catch (err) {
      if (err.code !== '42P01' && err.code !== '42703') {
        console.warn(`[Delete user] Cleanup warning: ${err.message}`);
      }
    }
  }

  // Catch any remaining FK references discovered from schema metadata
  await cleanupDynamicUserReferences(userId);

  return query(`DELETE FROM users WHERE id = $1 RETURNING id, email`, [userId]);
}

// Check if current user is superadmin
router.get('/check', async (req, res) => {
  try {
    console.log('Checking superadmin for userId:', req.userId);
    const result = await query(
      `SELECT id, email, is_superadmin FROM users WHERE id = $1`,
      [req.userId]
    );
    
    console.log('User found:', result.rows[0]);
    const row = result.rows[0];
    const isMasterAdmin = String(row?.email || '').toLowerCase().trim() === 'tnicodemos@gmail.com';
    const isSuperadmin = !!row?.is_superadmin || isMasterAdmin;
    res.json({ isSuperadmin, isAdmin: isSuperadmin });
  } catch (error) {
    console.error('Check superadmin error:', error);
    res.status(500).json({ error: 'Erro ao verificar permissões' });
  }
});

// ============================================
// PLANS
// ============================================

// List all plans
router.get('/plans', requireSuperadmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, 
              (SELECT COUNT(*) FROM organizations WHERE plan_id = p.id) as org_count
       FROM plans p
       ORDER BY p.price ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List plans error:', error);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

// Create plan
router.post('/plans', requireSuperadmin, async (req, res) => {
  try {
    const { 
      name, 
      description, 
      max_connections, 
      max_monthly_messages,
      max_users,
      max_supervisors,
      has_asaas_integration, 
      has_chat,
      has_whatsapp_groups,
      has_campaigns,
      has_chatbots,
      has_scheduled_messages,
      has_crm,
      has_ai_agents,
      has_departments,
      has_lead_scoring,
      has_ai_summary,
      has_group_secretary,
      has_rh,
      has_ghost,
      has_projects,
      has_lead_gleego,
      has_doc_signatures,
      doc_signatures_limit,
      price, 
      billing_period,
      visible_on_signup,
      trial_days
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nome do plano é obrigatório' });
    }

    const result = await query(
      `INSERT INTO plans (name, description, max_connections, max_monthly_messages, max_users, max_supervisors, has_asaas_integration, has_chat, has_whatsapp_groups, has_campaigns, has_chatbots, has_scheduled_messages, has_crm, has_ai_agents, has_departments, has_lead_scoring, has_ai_summary, has_group_secretary, has_rh, has_ghost, has_projects, has_lead_gleego, has_doc_signatures, doc_signatures_limit, price, billing_period, visible_on_signup, trial_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) RETURNING *`,
      [
        name,
        description,
        max_connections || 1,
        max_monthly_messages || 1000,
        max_users || 5,
        max_supervisors || 1,
        has_asaas_integration || false,
        has_chat !== false,
        has_whatsapp_groups || false,
        has_campaigns !== false,
        has_chatbots !== false,
        has_scheduled_messages !== false,
        has_crm !== false,
        has_ai_agents !== false,
        has_departments !== false,
        has_lead_scoring !== false,
        has_ai_summary !== false,
        has_group_secretary || false,
        has_rh !== false,
        has_ghost || false,
        has_projects || false,
        has_lead_gleego || false,
        has_doc_signatures || false,
        doc_signatures_limit || 0,
        price || 0,
        billing_period || 'monthly',
        visible_on_signup || false,
        trial_days || 3
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

// Update plan
router.patch('/plans/:id', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, 
      description, 
      max_connections, 
      max_monthly_messages, 
      max_users,
      max_supervisors,
      has_asaas_integration, 
      has_chat, 
      has_whatsapp_groups,
      has_campaigns,
      has_chatbots,
      has_scheduled_messages,
      has_crm,
      has_ai_agents,
      has_departments,
      has_lead_scoring,
      has_ai_summary,
      has_group_secretary,
      has_rh,
      has_ghost,
      has_projects,
      has_lead_gleego,
      has_doc_signatures,
      doc_signatures_limit,
      price, 
      billing_period, 
      is_active,
      visible_on_signup,
      trial_days
    } = req.body;

    const result = await query(
      `UPDATE plans 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           max_connections = COALESCE($3, max_connections),
           max_monthly_messages = COALESCE($4, max_monthly_messages),
           max_users = COALESCE($5, max_users),
           max_supervisors = COALESCE($6, max_supervisors),
           has_asaas_integration = COALESCE($7, has_asaas_integration),
           has_chat = COALESCE($8, has_chat),
           has_whatsapp_groups = COALESCE($9, has_whatsapp_groups),
           has_campaigns = COALESCE($10, has_campaigns),
           has_chatbots = COALESCE($11, has_chatbots),
           has_scheduled_messages = COALESCE($12, has_scheduled_messages),
           has_crm = COALESCE($13, has_crm),
           has_ai_agents = COALESCE($14, has_ai_agents),
           has_departments = COALESCE($15, has_departments),
           has_lead_scoring = COALESCE($16, has_lead_scoring),
           has_ai_summary = COALESCE($17, has_ai_summary),
           has_group_secretary = COALESCE($18, has_group_secretary),
           has_rh = COALESCE($19, has_rh),
           has_ghost = COALESCE($20, has_ghost),
           has_projects = COALESCE($21, has_projects),
           has_lead_gleego = COALESCE($22, has_lead_gleego),
           has_doc_signatures = COALESCE($23, has_doc_signatures),
           doc_signatures_limit = COALESCE($24, doc_signatures_limit),
           price = COALESCE($25, price),
           billing_period = COALESCE($26, billing_period),
           is_active = COALESCE($27, is_active),
           visible_on_signup = COALESCE($28, visible_on_signup),
           trial_days = COALESCE($29, trial_days),
           updated_at = NOW()
       WHERE id = $30
       RETURNING *`,
      [
        name,
        description,
        max_connections,
        max_monthly_messages,
        max_users,
        max_supervisors,
        has_asaas_integration,
        has_chat,
        has_whatsapp_groups,
        has_campaigns,
        has_chatbots,
        has_scheduled_messages,
        has_crm,
        has_ai_agents,
        has_departments,
        has_lead_scoring,
        has_ai_summary,
        has_group_secretary,
        has_rh,
        has_ghost,
        has_projects,
        has_lead_gleego,
        has_doc_signatures,
        doc_signatures_limit,
        price,
        billing_period,
        is_active,
        visible_on_signup,
        trial_days,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update plan error:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

// Sync all organizations' modules with their plans
router.post('/plans/sync-all', requireSuperadmin, async (req, res) => {
  try {
    // Get all plans with their modules
    const plansResult = await query(
      `SELECT id, name, has_campaigns, has_asaas_integration, has_whatsapp_groups, has_scheduled_messages, has_chatbots, has_chat, has_crm, has_ai_agents, has_departments, has_lead_scoring, has_ai_summary, has_group_secretary, has_rh, has_projects, has_lead_gleego, has_doc_signatures FROM plans`
    );

    let syncedCount = 0;
    const syncDetails = [];

    for (const plan of plansResult.rows) {
      const modulesEnabled = {
        campaigns: plan.has_campaigns ?? true,
        billing: plan.has_asaas_integration ?? true,
        groups: plan.has_whatsapp_groups ?? true,
        scheduled_messages: plan.has_scheduled_messages ?? true,
        chatbots: plan.has_chatbots ?? true,
        chat: plan.has_chat ?? true,
        crm: plan.has_crm ?? true,
        ai_agents: plan.has_ai_agents ?? true,
        departments: plan.has_departments ?? true,
        lead_scoring: plan.has_lead_scoring ?? true,
        ai_summary: plan.has_ai_summary ?? true,
        group_secretary: plan.has_group_secretary ?? false,
        rh: plan.has_rh ?? true,
        projects: plan.has_projects ?? false,
        lead_gleego: plan.has_lead_gleego ?? false,
        doc_signatures: plan.has_doc_signatures ?? false,
      };

      console.log(`[sync-all] Plan "${plan.name}" (${plan.id}) modules:`, modulesEnabled);

      // Update all organizations using this plan
      const updateResult = await query(
        `UPDATE organizations SET modules_enabled = $1, updated_at = NOW() WHERE plan_id = $2 RETURNING id, name`,
        [JSON.stringify(modulesEnabled), plan.id]
      );

      if (updateResult.rowCount > 0) {
        syncDetails.push({
          plan: plan.name,
          organizations: updateResult.rows.map(o => o.name),
          modules: modulesEnabled
        });
      }

      syncedCount += updateResult.rowCount || 0;
    }

    console.log(`[sync-all] Synced modules for ${syncedCount} organizations:`, JSON.stringify(syncDetails, null, 2));
    res.json({ success: true, synced_organizations: syncedCount, details: syncDetails });
  } catch (error) {
    console.error('Sync all plans error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar planos' });
  }
});

// Delete plan
router.delete('/plans/:id', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if plan is in use
    const orgCheck = await query(`SELECT id FROM organizations WHERE plan_id = $1 LIMIT 1`, [id]);
    if (orgCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Este plano está em uso por organizações' });
    }

    const result = await query(`DELETE FROM plans WHERE id = $1 RETURNING id`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ error: 'Erro ao deletar plano' });
  }
});

// ============================================
// USERS
// ============================================

// List all users with orphan status (superadmin only)
router.get('/users', requireSuperadmin, async (req, res) => {
  try {
    const { search, orphans_only } = req.query;
    
    let baseQuery = `
      SELECT u.id, u.email, u.name, u.is_superadmin, u.account_type, u.timeclock_kiosk, u.created_at,
             COALESCE(
               (SELECT json_agg(json_build_object('org_id', o.id, 'org_name', o.name, 'role', om.role))
                FROM organization_members om
                JOIN organizations o ON o.id = om.organization_id
                WHERE om.user_id = u.id),
               '[]'::json
             ) as organizations,
             NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id) as is_orphan
      FROM users u
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      baseQuery += ` AND (u.email ILIKE $${paramIndex} OR u.name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (orphans_only === 'true') {
      baseQuery += ` AND NOT EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = u.id)`;
    }
    
    baseQuery += ` ORDER BY u.created_at DESC`;
    
    const result = await query(baseQuery, params);
    res.json(result.rows);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// Search user by exact email (superadmin only)
router.get('/users/search-email', requireSuperadmin, async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }
    
    const result = await query(
      `SELECT u.id, u.email, u.name, u.is_superadmin, u.account_type, u.timeclock_kiosk, u.created_at,
              COALESCE(
                (SELECT json_agg(json_build_object('org_id', o.id, 'org_name', o.name, 'role', om.role))
                 FROM organization_members om
                 JOIN organizations o ON o.id = om.organization_id
                 WHERE om.user_id = u.id),
                '[]'::json
              ) as organizations
       FROM users u
       WHERE u.email = $1`,
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado', exists: false });
    }
    
    res.json({ ...result.rows[0], exists: true });
  } catch (error) {
    console.error('Search user by email error:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// Delete user by email (superadmin only - for orphan cleanup)
router.delete('/users/by-email/:email', requireSuperadmin, async (req, res) => {
  try {
    const { email } = req.params;

    const userCheck = await query(`SELECT id, email FROM users WHERE email = $1`, [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userId = userCheck.rows[0].id;
    if (userId === req.userId) {
      return res.status(400).json({ error: 'Não é possível excluir sua própria conta' });
    }

    const result = await deleteUserWithCleanup(userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Erro ao excluir usuário' });
    }

    console.log(`User ${email} deleted by superadmin ${req.userId}`);
    res.json({ success: true, deleted_email: email });
  } catch (error) {
    console.error('Delete user by email error:', error);
    if (error?.code === '23503') {
      return res.status(409).json({ error: 'Usuário possui vínculos que impedem exclusão', details: error.detail || error.message });
    }
    res.status(500).json({ error: 'Erro ao excluir usuário', details: error.message });
  }
});

// Delete user completely (with all related data)
router.delete('/users/:id', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (id === req.userId) {
      return res.status(400).json({ error: 'Não é possível excluir sua própria conta' });
    }

    const userCheck = await query(`SELECT id, email FROM users WHERE id = $1`, [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const userEmail = userCheck.rows[0].email;
    const result = await deleteUserWithCleanup(id);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Erro ao excluir usuário' });
    }

    console.log(`User ${userEmail} deleted by superadmin ${req.userId}`);
    res.json({ success: true, deleted_email: userEmail });
  } catch (error) {
    console.error('Delete user error:', error);
    if (error?.code === '23503') {
      return res.status(409).json({ error: 'Usuário possui vínculos que impedem exclusão', details: error.detail || error.message });
    }
    res.status(500).json({ error: 'Erro ao excluir usuário', details: error.message });
  }
});

// Set user superadmin status
router.patch('/users/:id/superadmin', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_superadmin } = req.body;

    // Can't remove own superadmin
    if (id === req.userId && !is_superadmin) {
      return res.status(400).json({ error: 'Não é possível remover seu próprio acesso superadmin' });
    }

    const result = await query(
      `UPDATE users SET is_superadmin = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, is_superadmin`,
      [is_superadmin, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Set superadmin error:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// Change user password (superadmin only)
router.patch('/users/:id/password', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    const result = await query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name`,
      [hashedPassword, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ message: 'Senha atualizada com sucesso', user: result.rows[0] });
  } catch (error) {
    console.error('Change user password error:', error);
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

// ============================================
// ORGANIZATIONS
// ============================================

// List all organizations (superadmin only)
router.get('/organizations', requireSuperadmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, 
              p.name as plan_name,
              p.price as plan_price,
              (SELECT COUNT(*) FROM organization_members WHERE organization_id = o.id) as member_count
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List organizations error:', error);
    res.status(500).json({ error: 'Erro ao listar organizações' });
  }
});

// Create organization (superadmin only)
router.post('/organizations', requireSuperadmin, async (req, res) => {
  try {
    const { name, slug, logo_url, owner_email, owner_name, owner_password, plan_id, expires_at } = req.body;

    if (!name || !slug || !owner_email) {
      return res.status(400).json({ error: 'Nome, slug e email do proprietário são obrigatórios' });
    }

    // Find or create owner user
    let ownerId;
    const userResult = await query(
      `SELECT id FROM users WHERE email = $1`,
      [owner_email]
    );

    if (userResult.rows.length === 0) {
      // User doesn't exist, create one if password provided
      if (!owner_password) {
        return res.status(400).json({ error: 'Usuário não encontrado. Forneça nome e senha para criar novo usuário.' });
      }

      const hashedPassword = await bcrypt.hash(owner_password, 10);
      const newUser = await query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
        [owner_email, hashedPassword, owner_name || owner_email.split('@')[0]]
      );
      ownerId = newUser.rows[0].id;
    } else {
      ownerId = userResult.rows[0].id;
    }

    // Get plan modules if plan_id provided
    let modulesEnabled = {
      campaigns: true,
      billing: true,
      groups: true,
      scheduled_messages: true,
      chatbots: true,
      chat: true,
      crm: true,
      rh: true,
    };

    if (plan_id) {
      const planResult = await query(
        `SELECT has_campaigns, has_asaas_integration, has_whatsapp_groups, has_scheduled_messages, has_chatbots, has_chat, has_crm, has_lead_gleego, has_rh FROM plans WHERE id = $1`,
        [plan_id]
      );
      if (planResult.rows.length > 0) {
        const plan = planResult.rows[0];
        modulesEnabled = {
          campaigns: plan.has_campaigns ?? true,
          billing: plan.has_asaas_integration ?? true,
          groups: plan.has_whatsapp_groups ?? true,
          scheduled_messages: plan.has_scheduled_messages ?? true,
          chatbots: plan.has_chatbots ?? true,
          chat: plan.has_chat ?? true,
          crm: plan.has_crm ?? true,
          rh: plan.has_rh ?? true,
          lead_gleego: plan.has_lead_gleego ?? false,
        };
      }
    }

    // Create organization with modules from plan
    const orgResult = await query(
      `INSERT INTO organizations (name, slug, logo_url, plan_id, expires_at, modules_enabled)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, slug, logo_url || null, plan_id || null, expires_at || null, JSON.stringify(modulesEnabled)]
    );

    const org = orgResult.rows[0];

    // Add owner
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, ownerId]
    );

    res.status(201).json({ ...org, member_count: 1 });
  } catch (error) {
    console.error('Create organization error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Slug já está em uso' });
    }
    res.status(500).json({ error: 'Erro ao criar organização' });
  }
});

// Update organization (superadmin only)
router.patch('/organizations/:id', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, logo_url, plan_id, expires_at, sync_modules } = req.body;

    // If plan_id changed and sync_modules is true, update modules_enabled from plan
    let modulesEnabled = null;
    if (plan_id && sync_modules !== false) {
      const planResult = await query(
        `SELECT has_campaigns, has_asaas_integration, has_whatsapp_groups, has_scheduled_messages, has_chatbots, has_chat, has_crm, has_lead_gleego, has_rh FROM plans WHERE id = $1`,
        [plan_id]
      );
      if (planResult.rows.length > 0) {
        const plan = planResult.rows[0];
        modulesEnabled = {
          campaigns: plan.has_campaigns ?? true,
          billing: plan.has_asaas_integration ?? true,
          groups: plan.has_whatsapp_groups ?? true,
          scheduled_messages: plan.has_scheduled_messages ?? true,
          chatbots: plan.has_chatbots ?? true,
          chat: plan.has_chat ?? true,
          crm: plan.has_crm ?? true,
          rh: plan.has_rh ?? true,
          lead_gleego: plan.has_lead_gleego ?? false,
        };
      }
    }

    const result = await query(
      `UPDATE organizations 
       SET name = COALESCE($1, name),
           logo_url = COALESCE($2, logo_url),
           plan_id = COALESCE($3, plan_id),
           expires_at = COALESCE($4, expires_at),
           modules_enabled = COALESCE($5, modules_enabled),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, logo_url, plan_id, expires_at, modulesEnabled ? JSON.stringify(modulesEnabled) : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Erro ao atualizar organização' });
  }
});

// Delete organization (superadmin only)
router.delete('/organizations/:id', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `DELETE FROM organizations WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Erro ao deletar organização' });
  }
});

// ============================================
// ORGANIZATION USERS MANAGEMENT
// ============================================

// Get organization members with limits info
router.get('/organizations/:id/members', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get members
    const membersResult = await query(
      `SELECT om.id, om.role, om.created_at,
              u.id as user_id, u.email, u.name
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY 
         CASE om.role 
           WHEN 'owner' THEN 1 
           WHEN 'admin' THEN 2 
           WHEN 'agent' THEN 3 
           ELSE 4 
         END`,
      [id]
    );

    // Get plan limits
    const limitsResult = await query(
      `SELECT p.max_users, p.max_supervisors, p.name as plan_name
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [id]
    );

    const limits = limitsResult.rows[0] || { max_users: 999, max_supervisors: 999 };
    const members = membersResult.rows;
    const supervisorCount = members.filter(m => ['owner', 'admin'].includes(m.role)).length;
    
    res.json({
      members,
      limits: {
        max_users: limits.max_users || 999,
        max_supervisors: limits.max_supervisors || 999,
        current_users: members.length,
        current_supervisors: supervisorCount,
        plan_name: limits.plan_name || 'Sem plano'
      }
    });
  } catch (error) {
    console.error('Get org members error:', error);
    res.status(500).json({ error: 'Erro ao buscar membros' });
  }
});

// Create user for organization
router.post('/organizations/:id/users', requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, password, role, account_type, timeclock_kiosk } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, nome e senha são obrigatórios' });
    }

    const validAccountTypes = ['standard', 'timeclock_kiosk'];
    const accountType = validAccountTypes.includes(account_type) ? account_type : 'standard';
    const isKiosk = accountType === 'timeclock_kiosk' || timeclock_kiosk === true;

    // Get organization plan limits
    const orgPlan = await query(
      `SELECT o.id, p.max_users, p.max_supervisors, p.name as plan_name
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [id]
    );

    if (orgPlan.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }

    const plan = orgPlan.rows[0];
    const maxUsers = plan.max_users || 999;
    const maxSupervisors = plan.max_supervisors || 999;

    // Count current members
    const memberCounts = await query(
      `SELECT 
         COUNT(*) as total_members,
         COUNT(*) FILTER (WHERE role IN ('owner', 'admin')) as supervisor_count
       FROM organization_members
       WHERE organization_id = $1`,
      [id]
    );

    const currentTotal = parseInt(memberCounts.rows[0].total_members) || 0;
    const currentSupervisors = parseInt(memberCounts.rows[0].supervisor_count) || 0;

    // Check total users limit
    if (currentTotal >= maxUsers) {
      return res.status(400).json({ 
        error: `Limite de usuários atingido (${currentTotal}/${maxUsers}). Faça upgrade do plano.`,
        code: 'USER_LIMIT_REACHED'
      });
    }

    // Check supervisors limit (owner + admin roles)
    const isSupervisorRole = ['owner', 'admin'].includes(role);
    if (isSupervisorRole && currentSupervisors >= maxSupervisors) {
      return res.status(400).json({ 
        error: `Limite de supervisores atingido (${currentSupervisors}/${maxSupervisors}). Faça upgrade do plano.`,
        code: 'SUPERVISOR_LIMIT_REACHED'
      });
    }

    // Check if user exists
    const existingUser = await query(`SELECT id FROM users WHERE email = $1`, [email]);
    
    let userId;
    
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
      
      // Check if already member
      const existingMember = await query(
        `SELECT id FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [id, userId]
      );
      
      if (existingMember.rows.length > 0) {
        return res.status(400).json({ error: 'Usuário já é membro desta organização' });
      }
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await query(
        `INSERT INTO users (email, name, password_hash, account_type, timeclock_kiosk) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [email, name, hashedPassword, accountType, isKiosk]
      );
      userId = newUser.rows[0].id;
    }

    // Add to organization
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [id, userId, role || 'agent']
    );

    res.status(201).json({ 
      user_id: userId, 
      email, 
      name, 
      role: role || 'agent',
      account_type: accountType,
      timeclock_kiosk: isKiosk
    });
  } catch (error) {
    console.error('Create org user error:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Update member role
router.patch('/organizations/:orgId/members/:memberId', requireSuperadmin, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;
    const { role } = req.body;

    if (!['owner', 'admin', 'agent'].includes(role)) {
      return res.status(400).json({ error: 'Role inválido' });
    }

    // Get current member role
    const currentMember = await query(
      `SELECT role FROM organization_members WHERE id = $1 AND organization_id = $2`,
      [memberId, orgId]
    );

    if (currentMember.rows.length === 0) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    const currentRole = currentMember.rows[0].role;
    const isPromotingToSupervisor = !['owner', 'admin'].includes(currentRole) && ['owner', 'admin'].includes(role);

    // Check supervisor limit if promoting to supervisor role
    if (isPromotingToSupervisor) {
      const orgPlan = await query(
        `SELECT p.max_supervisors
         FROM organizations o
         LEFT JOIN plans p ON p.id = o.plan_id
         WHERE o.id = $1`,
        [orgId]
      );

      const maxSupervisors = orgPlan.rows[0]?.max_supervisors || 999;

      const supervisorCount = await query(
        `SELECT COUNT(*) as count
         FROM organization_members
         WHERE organization_id = $1 AND role IN ('owner', 'admin')`,
        [orgId]
      );

      const currentSupervisors = parseInt(supervisorCount.rows[0].count) || 0;

      if (currentSupervisors >= maxSupervisors) {
        return res.status(400).json({ 
          error: `Limite de supervisores atingido (${currentSupervisors}/${maxSupervisors}). Faça upgrade do plano.`,
          code: 'SUPERVISOR_LIMIT_REACHED'
        });
      }
    }

    const result = await query(
      `UPDATE organization_members SET role = $1 WHERE id = $2 AND organization_id = $3 RETURNING *`,
      [role, memberId, orgId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Erro ao atualizar membro' });
  }
});

// Remove member from organization
router.delete('/organizations/:orgId/members/:memberId', requireSuperadmin, async (req, res) => {
  try {
    const { orgId, memberId } = req.params;

    const result = await query(
      `DELETE FROM organization_members WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [memberId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// ============================================
// SYSTEM SETTINGS (Branding)
// ============================================

// Get all settings
router.get('/settings', requireSuperadmin, async (req, res) => {
  try {
    const result = await query(`SELECT * FROM system_settings ORDER BY key`);
    res.json(result.rows);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// Update a setting
router.patch('/settings/:key', requireSuperadmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await query(
      `UPDATE system_settings 
       SET value = $1, updated_by = $2, updated_at = NOW()
       WHERE key = $3
       RETURNING *`,
      [value, req.userId, key]
    );

    if (result.rows.length === 0) {
      // Insert if not exists
      const insertResult = await query(
        `INSERT INTO system_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [key, value, req.userId]
      );
      return res.json(insertResult.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update setting error:', error);
    res.status(500).json({ error: 'Erro ao atualizar configuração' });
  }
});

// ============================================
// DOC SIGNATURE SMTP (System-level)
// ============================================

const DOC_SMTP_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'whatsale-email-key-32chars!!';

function encryptSmtpPassword(password) {
  const key = crypto.scryptSync(DOC_SMTP_ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptSmtpPassword(encryptedPassword) {
  try {
    const [ivHex, encrypted] = encryptedPassword.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.scryptSync(DOC_SMTP_ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedPassword;
  }
}

router.put('/settings/doc-signature-smtp', requireSuperadmin, async (req, res) => {
  try {
    const { host, port, secure, username, password, from_name, from_email } = req.body;
    
    // Load existing to preserve password if not provided
    let existingPassword = null;
    const existing = await query(`SELECT value FROM system_settings WHERE key = 'doc_signature_smtp'`);
    if (existing.rows[0]?.value) {
      try { existingPassword = JSON.parse(existing.rows[0].value).password_encrypted; } catch {}
    }

    const smtpData = {
      host, port: port || 587, secure: secure !== false,
      username, from_name, from_email,
      password_encrypted: password ? encryptSmtpPassword(password) : existingPassword,
    };

    const result = await query(
      `UPDATE system_settings SET value = $1, updated_by = $2, updated_at = NOW() WHERE key = 'doc_signature_smtp' RETURNING *`,
      [JSON.stringify(smtpData), req.userId]
    );
    if (result.rows.length === 0) {
      await query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ('doc_signature_smtp', $1, $2)`,
        [JSON.stringify(smtpData), req.userId]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Save doc SMTP error:', error);
    res.status(500).json({ error: 'Erro ao salvar SMTP' });
  }
});

router.post('/settings/doc-signature-smtp/test', requireSuperadmin, async (req, res) => {
  try {
    const r = await query(`SELECT value FROM system_settings WHERE key = 'doc_signature_smtp'`);
    if (!r.rows[0]?.value) return res.status(400).json({ error: 'SMTP não configurado' });
    
    const config = JSON.parse(r.rows[0].value);
    const password = config.password_encrypted ? decryptSmtpPassword(config.password_encrypted) : '';
    
    const transporter = nodemailer.createTransport({
      host: config.host, port: config.port,
      secure: config.secure || config.port === 465,
      auth: { user: config.username, pass: password },
    });

    // Get superadmin email
    const userResult = await query(`SELECT email FROM users WHERE id = $1`, [req.userId]);
    const testEmail = userResult.rows[0]?.email || config.from_email;

    await transporter.sendMail({
      from: `"${config.from_name}" <${config.from_email}>`,
      to: testEmail,
      subject: 'Teste SMTP - Assinatura de Documentos',
      html: '<div style="font-family:Arial;padding:20px;"><h2>✅ SMTP funcionando!</h2><p>O envio de e-mails de verificação para assinaturas está configurado corretamente.</p></div>',
    });
    
    res.json({ success: true, message: `E-mail de teste enviado para ${testEmail}` });
  } catch (error) {
    console.error('Test doc SMTP error:', error);
    res.status(500).json({ error: error.message || 'Falha no envio de teste' });
  }
});


// ============================================
// W-API INSTANCES MANAGEMENT (Integrator)
// ============================================

router.get('/wapi/instances', requireSuperadmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 100;
    const tokenResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const token = tokenResult.rows[0]?.value;
    if (!token) return res.status(400).json({ error: 'Token W-API não configurado' });

    const response = await fetch(
      `https://api.w-api.app/v1/integrator/instances?pageSize=${pageSize}&page=${page}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data?.message || 'Erro ao listar instâncias' });

    // Cross-reference with local connections table to find org/owner info
    const list = Array.isArray(data) ? data : (data?.instances || data?.data || []);
    
    // Get all W-API connections with org info
    const connectionsResult = await query(`
      SELECT c.instance_id, c.name as connection_name, c.phone_number,
             o.id as org_id, o.name as org_name, o.slug as org_slug,
             u.name as owner_name, u.email as owner_email
      FROM connections c
      LEFT JOIN organization_members om ON om.user_id = c.user_id
      LEFT JOIN organizations o ON o.id = om.organization_id
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.provider = 'wapi' AND c.instance_id IS NOT NULL
    `);
    
    const connectionMap = {};
    for (const row of connectionsResult.rows) {
      if (row.instance_id) connectionMap[row.instance_id] = row;
    }

    // Enrich instances with local data
    const enriched = list.map(inst => {
      const id = inst.instanceId || inst.id || '';
      const local = connectionMap[id] || null;
      return {
        ...inst,
        local: local ? {
          connectionName: local.connection_name,
          phoneNumber: local.phone_number,
          orgId: local.org_id,
          orgName: local.org_name,
          orgSlug: local.org_slug,
          ownerName: local.owner_name,
          ownerEmail: local.owner_email,
        } : null,
      };
    });

    res.json({ instances: enriched, total: enriched.length });
  } catch (error) {
    console.error('List W-API instances error:', error);
    res.status(500).json({ error: 'Erro ao listar instâncias W-API' });
  }
});

router.delete('/wapi/instances/:instanceId', requireSuperadmin, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const tokenResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const token = tokenResult.rows[0]?.value;
    if (!token) return res.status(400).json({ error: 'Token W-API não configurado' });

    const response = await fetch(
      `https://api.w-api.app/v1/integrator/delete-instance?instanceId=${encodeURIComponent(instanceId)}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data?.message || 'Erro ao deletar instância' });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Delete W-API instance error:', error);
    res.status(500).json({ error: 'Erro ao deletar instância W-API' });
  }
});

router.get('/wapi/instances/:instanceId/webhooks', requireSuperadmin, async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    // Resolve best token: instance-specific first, then global
    const connResult = await query(
      `SELECT wapi_token FROM connections WHERE instance_id = $1 AND provider = 'wapi' AND wapi_token IS NOT NULL LIMIT 1`,
      [instanceId]
    );
    const instanceToken = connResult.rows[0]?.wapi_token;
    const globalResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const globalToken = globalResult.rows[0]?.value;
    const tokensToTry = [instanceToken, globalToken].filter(Boolean);
    if (tokensToTry.length === 0) return res.status(400).json({ error: 'Nenhum token W-API disponível' });

    let bestResults = null;
    for (const token of tokensToTry) {
      const results = await wapiProvider.getWebhookConfig(instanceId, token);
      const okCount = results.filter(r => r.ok).length;
      console.log(`[admin] Webhooks for ${instanceId} (${token === instanceToken ? 'instance' : 'global'} token): ${okCount}/${results.length} ok, sample data:`, JSON.stringify(results[0]?.data || {}).substring(0, 300));
      
      if (okCount > 0) {
        bestResults = results;
        break; // Use first token that works
      }
      if (!bestResults) bestResults = results;
    }
    
    res.json({ instanceId, webhooks: bestResults || [] });
  } catch (error) {
    console.error('Get webhooks error:', error);
    res.status(500).json({ error: 'Erro ao buscar webhooks' });
  }
});

router.put('/wapi/instances/:instanceId/webhooks', requireSuperadmin, async (req, res) => {
  try {
    const { instanceId } = req.params;
    const { webhookUrl, webhookTypes: requestedTypes } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl é obrigatório' });

    // Resolve best token
    const connResult = await query(
      `SELECT wapi_token FROM connections WHERE instance_id = $1 AND provider = 'wapi' AND wapi_token IS NOT NULL LIMIT 1`,
      [instanceId]
    );
    const instanceToken = connResult.rows[0]?.wapi_token;
    const globalResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const globalToken = globalResult.rows[0]?.value;
    const tokensToTry = [instanceToken, globalToken].filter(Boolean);
    if (tokensToTry.length === 0) return res.status(400).json({ error: 'Nenhum token W-API disponível' });

    const allWebhookTypes = [
      { endpoint: 'update-webhook-received', name: 'received' },
      { endpoint: 'update-webhook-delivery', name: 'delivery' },
      { endpoint: 'update-webhook-message-status', name: 'message-status' },
      { endpoint: 'update-webhook-connected', name: 'connected' },
      { endpoint: 'update-webhook-disconnected', name: 'disconnected' },
      { endpoint: 'update-webhook-chat-presence', name: 'chat-presence' },
    ];

    const webhookTypesToConfigure = requestedTypes && Array.isArray(requestedTypes) 
      ? allWebhookTypes.filter(wh => requestedTypes.includes(wh.name))
      : allWebhookTypes;

    const results = [];
    for (const wh of webhookTypesToConfigure) {
      let configured = false;
      for (const token of tokensToTry) {
        try {
          const r = await fetch(
            `https://api.w-api.app/v1/webhook/${wh.endpoint}?instanceId=${instanceId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ url: webhookUrl, enabled: true }),
            }
          );
          const d = await r.json().catch(() => ({}));
          if (r.ok) {
            results.push({ type: wh.name, ok: true, status: r.status, data: d });
            configured = true;
            break;
          }
          // If token error, try next token
          const errMsg = (d?.message || d?.error || '').toLowerCase();
          if (errMsg.includes('token') || r.status === 401 || r.status === 403) {
            continue;
          }
          results.push({ type: wh.name, ok: false, status: r.status, data: d });
          configured = true; // stop trying tokens for this type
          break;
        } catch (err) {
          // try next token
        }
      }
      if (!configured) {
        results.push({ type: wh.name, ok: false, error: 'Todos os tokens falharam' });
      }
    }
    const successCount = results.filter(r => r.ok).length;
    console.log(`[admin] Configured webhooks for ${instanceId}: ${successCount}/${results.length}`);
    res.json({ success: successCount > 0, configured: successCount, total: results.length, results });
  } catch (error) {
    console.error('Configure webhooks error:', error);
    res.status(500).json({ error: 'Erro ao configurar webhooks' });
  }
});

// Toggle individual webhook on/off
router.put('/wapi/instances/:instanceId/webhooks/:webhookType/toggle', requireSuperadmin, async (req, res) => {
  try {
    const { instanceId, webhookType } = req.params;
    const { enabled, url } = req.body;
    
    // Try instance-specific token first, then global integrator token
    const connResult = await query(
      `SELECT wapi_token FROM connections WHERE instance_id = $1 AND provider = 'wapi' AND wapi_token IS NOT NULL LIMIT 1`,
      [instanceId]
    );
    const instanceToken = connResult.rows[0]?.wapi_token;
    
    const globalResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const globalToken = globalResult.rows[0]?.value;
    
    const tokensToTry = [instanceToken, globalToken].filter(Boolean);
    if (tokensToTry.length === 0) return res.status(400).json({ error: 'Nenhum token W-API disponível' });

    const endpointMap = {
      'received': 'update-webhook-received',
      'delivery': 'update-webhook-delivery',
      'message-status': 'update-webhook-message-status',
      'connected': 'update-webhook-connected',
      'disconnected': 'update-webhook-disconnected',
      'chat-presence': 'update-webhook-chat-presence',
    };
    const endpoint = endpointMap[webhookType];
    if (!endpoint) return res.status(400).json({ error: `Tipo de webhook inválido: ${webhookType}` });

    const body = { enabled: !!enabled };
    if (url) body.url = url;
    // Always include default URL when enabling and no URL provided
    if (enabled && !url) body.url = 'https://blaster-whats-backend.isyhhh.easypanel.host/api/wapi/webhook';

    let lastError = null;
    for (const token of tokensToTry) {
      try {
        const r = await fetch(
          `https://api.w-api.app/v1/webhook/${endpoint}?instanceId=${instanceId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
          }
        );
        const d = await r.json().catch(() => ({}));
        console.log(`[admin] toggleWebhook ${webhookType} for ${instanceId}: status=${r.status} token=${token === instanceToken ? 'instance' : 'global'}`, JSON.stringify(d).substring(0, 200));
        
        if (r.ok) {
          return res.json({ success: true, status: r.status, data: d, tokenUsed: token === instanceToken ? 'instance' : 'global' });
        }
        
        // If token invalid, try next token
        const errMsg = d?.message || d?.error || '';
        if (errMsg.toLowerCase().includes('token') || r.status === 401 || r.status === 403) {
          lastError = { status: r.status, data: d };
          continue;
        }
        
        // Other error, return it
        return res.json({ success: false, status: r.status, data: d, error: errMsg });
      } catch (err) {
        lastError = { error: err.message };
      }
    }
    
    // All tokens failed
    const errMsg = lastError?.data?.message || lastError?.data?.error || lastError?.error || 'Token inválido';
    res.json({ success: false, error: errMsg, data: lastError?.data });
  } catch (error) {
    console.error('Toggle webhook error:', error);
    res.status(500).json({ error: 'Erro ao alternar webhook: ' + error.message });
  }
});

router.get('/wapi/instances/:instanceId/status', requireSuperadmin, async (req, res) => {
  try {
    const { instanceId } = req.params;
    
    // Try instance-specific token first, then global
    const connResult = await query(
      `SELECT wapi_token FROM connections WHERE instance_id = $1 AND provider = 'wapi' AND wapi_token IS NOT NULL LIMIT 1`,
      [instanceId]
    );
    const instanceToken = connResult.rows[0]?.wapi_token;
    const globalResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const globalToken = globalResult.rows[0]?.value;
    const tokensToTry = [instanceToken, globalToken].filter(Boolean);
    if (tokensToTry.length === 0) return res.status(400).json({ error: 'Token W-API não configurado' });

    let lastResult = null;
    for (const token of tokensToTry) {
      try {
        const result = await wapiProvider.checkStatus(instanceId, token);
        console.log(`[admin] Instance ${instanceId} status via wapiProvider (${token === instanceToken ? 'instance' : 'global'} token):`, JSON.stringify(result));
        
        if (result.status === 'connected' || !result.error) {
          return res.json({ 
            instanceId, ok: true, 
            connected: result.status === 'connected',
            status: result.status,
            phoneNumber: result.phoneNumber || null,
            error: result.error || null,
          });
        }
        lastResult = result;
      } catch (err) {
        console.log(`[admin] Token ${token === instanceToken ? 'instance' : 'global'} failed for status:`, err.message);
        lastResult = { status: 'disconnected', error: err.message };
      }
    }
    
    res.json({ 
      instanceId, ok: true, 
      connected: lastResult?.status === 'connected',
      status: lastResult?.status || 'disconnected',
      phoneNumber: lastResult?.phoneNumber || null,
      error: lastResult?.error || null,
    });
  } catch (error) {
    console.error('Instance status error:', error);
    res.status(500).json({ error: 'Erro ao verificar status: ' + error.message });
  }
});

router.post('/wapi/instances', requireSuperadmin, async (req, res) => {
  try {
    const { instanceName, rejectCalls = true, callMessage = 'Não estamos disponíveis no momento.', webhookUrl } = req.body;
    if (!instanceName) return res.status(400).json({ error: 'instanceName é obrigatório' });

    const tokenResult = await query(`SELECT value FROM system_settings WHERE key = 'wapi_token'`);
    const token = tokenResult.rows[0]?.value;
    if (!token) return res.status(400).json({ error: 'Token W-API não configurado' });

    const response = await fetch(
      'https://api.w-api.app/v1/integrator/create-instance',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ instanceName, rejectCalls, callMessage }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ error: data?.message || 'Erro ao criar instância' });

    // Auto-configure webhooks if webhookUrl provided
    const newInstanceId = data?.instanceId || data?.id || '';
    let webhooksResult = null;
    if (webhookUrl && newInstanceId) {
      const webhookTypes = [
        'update-webhook-received', 'update-webhook-delivery', 'update-webhook-message-status',
        'update-webhook-connected', 'update-webhook-disconnected', 'update-webhook-chat-presence',
      ];
      const results = [];
      for (const endpoint of webhookTypes) {
        try {
          const r = await fetch(
            `https://api.w-api.app/v1/webhook/${endpoint}?instanceId=${newInstanceId}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ url: webhookUrl, enabled: true }),
            }
          );
          results.push({ endpoint, ok: r.ok });
        } catch (err) {
          results.push({ endpoint, ok: false, error: err.message });
        }
      }
      const configured = results.filter(r => r.ok).length;
      webhooksResult = { configured, total: results.length };
      console.log(`Auto-configured ${configured}/${results.length} webhooks for instance ${newInstanceId}`);
    }

    res.json({ ...data, webhooksResult });
  } catch (error) {
    console.error('Create W-API instance error:', error);
    res.status(500).json({ error: 'Erro ao criar instância W-API' });
  }
});

export default router;