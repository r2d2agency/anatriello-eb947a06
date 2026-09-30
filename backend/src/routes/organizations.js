import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// List user's organizations
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*, om.role 
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY o.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List organizations error:', error);
    res.status(500).json({ error: 'Erro ao listar organizações' });
  }
});

// Get organization by ID
// NOTE: constrain :id to UUID to avoid conflicts with static routes like /ai-config
router.get('/:id([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is member
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await query(
      `SELECT * FROM organizations WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    
    res.json({ ...result.rows[0], role: memberCheck.rows[0].role });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ error: 'Erro ao buscar organização' });
  }
});

// Get organization theme
router.get('/:id([0-9a-fA-F-]{36})/theme', async (req, res) => {
  try {
    const { id } = req.params;
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const result = await query(
      `SELECT theme_preset, theme_custom_colors FROM organizations WHERE id = $1`,
      [id]
    );
    res.json(result.rows[0] || { theme_preset: null, theme_custom_colors: null });
  } catch (error) {
    // Column might not exist
    if (/theme_preset|theme_custom_colors/i.test(String(error?.message || ''))) {
      return res.json({ theme_preset: null, theme_custom_colors: null });
    }
    console.error('Get org theme error:', error);
    res.status(500).json({ error: 'Erro ao buscar tema' });
  }
});

// Update organization theme (admin/owner only)
router.patch('/:id([0-9a-fA-F-]{36})/theme', async (req, res) => {
  try {
    const { id } = req.params;
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0 || !['owner', 'admin'].includes(memberCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Apenas admin/owner pode alterar o tema' });
    }

    const { theme_preset, theme_custom_colors } = req.body;

    try {
      await query(
        `UPDATE organizations SET theme_preset = $1, theme_custom_colors = $2, updated_at = NOW() WHERE id = $3`,
        [theme_preset || null, theme_custom_colors || null, id]
      );
    } catch (colError) {
      if (/theme_preset|theme_custom_colors/i.test(String(colError?.message || ''))) {
        await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_preset VARCHAR(50)`);
        await query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_custom_colors TEXT`);
        await query(
          `UPDATE organizations SET theme_preset = $1, theme_custom_colors = $2, updated_at = NOW() WHERE id = $3`,
          [theme_preset || null, theme_custom_colors || null, id]
        );
      } else throw colError;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update org theme error:', error);
    res.status(500).json({ error: 'Erro ao salvar tema' });
  }
});


router.get('/:id([0-9a-fA-F-]{36})/connections', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is member
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await query(
      `SELECT id, name, phone_number, status, provider 
       FROM connections 
       WHERE organization_id = $1 
       ORDER BY name`,
      [id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Get org connections error:', error);
    res.status(500).json({ error: 'Erro ao buscar conexões' });
  }
});

// Create organization - ONLY SUPERADMIN
router.post('/', async (req, res) => {
  try {
    // Check if user is superadmin
    const superadminCheck = await query(
      `SELECT is_superadmin FROM users WHERE id = $1`,
      [req.userId]
    );

    if (!superadminCheck.rows[0]?.is_superadmin) {
      return res.status(403).json({ error: 'Apenas superadmin pode criar organizações' });
    }

    const { name, slug, owner_user_id } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Nome e slug são obrigatórios' });
    }

    // Create organization
    const orgResult = await query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2) RETURNING *`,
      [name, slug]
    );
    
    const org = orgResult.rows[0];

    // Add specified user or creator as owner
    const ownerId = owner_user_id || req.userId;
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, ownerId]
    );

    res.status(201).json({ ...org, role: 'owner' });
  } catch (error) {
    console.error('Create organization error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Slug já está em uso' });
    }
    res.status(500).json({ error: 'Erro ao criar organização' });
  }
});

// Update organization
router.patch('/:id([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, logo_url, modules_enabled } = req.body;

    // Check if user is admin/owner
    const memberCheck = await query(
      `SELECT role FROM organization_members 
       WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem editar a organização' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (logo_url !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(logo_url);
    }
    if (modules_enabled !== undefined) {
      updates.push(`modules_enabled = $${paramIndex++}`);
      values.push(JSON.stringify(modules_enabled));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const result = await query(
      `UPDATE organizations 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Erro ao atualizar organização' });
  }
});

// Get organization modules settings
router.get('/:id([0-9a-fA-F-]{36})/modules', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is member
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const result = await query(
      `SELECT modules_enabled FROM organizations WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organização não encontrada' });
    }
    
    // Default modules if null
    const defaultModules = {
      campaigns: true,
      billing: true,
      groups: true,
      scheduled_messages: true,
      chatbots: true,
      chat: true,
      crm: true,
      rh: true,
    };
    
    res.json(result.rows[0].modules_enabled || defaultModules);
  } catch (error) {
    console.error('Get org modules error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// List organization members with their connection assignments
router.get('/:id([0-9a-fA-F-]{36})/members', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is member
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    // Query básica que não depende de tabelas que podem não existir
    const result = await query(
      `SELECT 
        om.*, 
        u.name, 
        u.email,
        COALESCE(om.is_active, true) as is_active,
        pt.name as template_name,
        pt.color as template_color
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       LEFT JOIN permission_templates pt ON pt.id = om.permission_template_id
       WHERE om.organization_id = $1
       ORDER BY om.created_at`,
      [id]
    );

    // Tentar buscar conexões atribuídas (não falha se tabela não existir)
    let connectionAssignments = {};
    try {
      const connResult = await query(
        `SELECT cm.user_id, json_agg(json_build_object('id', c.id, 'name', c.name)) as connections
         FROM connection_members cm
         JOIN connections c ON c.id = cm.connection_id
         WHERE c.organization_id = $1
         GROUP BY cm.user_id`,
        [id]
      );
      connectionAssignments = connResult.rows.reduce((acc, row) => {
        acc[row.user_id] = row.connections;
        return acc;
      }, {});
    } catch (e) {
      console.log('connection_members table may not exist:', e.message);
    }

    // Tentar buscar departamentos atribuídos (não falha se tabela não existir)
    let departmentAssignments = {};
    try {
      const deptResult = await query(
        `SELECT dm.user_id, json_agg(json_build_object('id', d.id, 'name', d.name, 'role', dm.role)) as departments
         FROM department_members dm
         JOIN departments d ON d.id = dm.department_id
         WHERE d.organization_id = $1
         GROUP BY dm.user_id`,
        [id]
      );
      departmentAssignments = deptResult.rows.reduce((acc, row) => {
        acc[row.user_id] = row.departments;
        return acc;
      }, {});
    } catch (e) {
      console.log('department_members table may not exist:', e.message);
    }

    // Montar resposta com assignments opcionais
    const members = result.rows.map(member => ({
      ...member,
      assigned_connections: connectionAssignments[member.user_id] || [],
      assigned_departments: departmentAssignments[member.user_id] || []
    }));

    res.json(members);
  } catch (error) {
    console.error('List members error:', error);
    res.status(500).json({ error: 'Erro ao listar membros', details: error.message });
  }
});

// Add member to organization (creates user if not exists)
router.post('/:id([0-9a-fA-F-]{36})/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, password, role, account_type, connection_ids } = req.body;
    const accountType = account_type === 'timeclock_kiosk' ? 'timeclock_kiosk' : 'standard';

    // Check if user is admin/owner
    const memberCheck = await query(
      `SELECT role FROM organization_members 
       WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem adicionar membros' });
    }

    // Find user by email
    let userResult = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );
    
    let userId;
    let userCreated = false;
    
    if (userResult.rows.length === 0) {
      // Create new user if name and password provided
      if (!name || !password) {
        return res.status(400).json({ 
          error: 'Usuário não encontrado', 
          details: `Nenhum usuário com o email "${email}" está cadastrado. Forneça nome e senha para criar um novo usuário.`,
          requires_registration: true
        });
      }
      
      // Validate password
      if (password.length < 6) {
        return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      }
      
      // Create the user
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = await query(
        `INSERT INTO users (name, email, password_hash, account_type, timeclock_kiosk) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, email, hashedPassword, accountType, accountType === 'timeclock_kiosk']
      );
      userId = newUser.rows[0].id;
      userCreated = true;
    } else {
      userId = userResult.rows[0].id;
    }

    // Add to organization
    const result = await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3
       RETURNING *`,
      [id, userId, role || 'agent']
    );

    // Assign to connections if provided
    if (connection_ids && Array.isArray(connection_ids) && connection_ids.length > 0) {
      // First remove existing connection assignments
      await query(
        `DELETE FROM connection_members 
         WHERE user_id = $1 AND connection_id IN (
           SELECT id FROM connections WHERE organization_id = $2
         )`,
        [userId, id]
      );
      
      // Add new connection assignments
      for (const connId of connection_ids) {
        await query(
          `INSERT INTO connection_members (connection_id, user_id, can_view, can_send, can_manage)
           VALUES ($1, $2, true, true, false)
           ON CONFLICT (connection_id, user_id) DO NOTHING`,
          [connId, userId]
        );
      }
    }

    res.status(201).json({ 
      ...result.rows[0], 
      user_created: userCreated,
      message: userCreated ? `Usuário "${name}" criado e adicionado à organização` : 'Membro adicionado'
    });
  } catch (error) {
    console.error('Add member error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Este email já está em uso' });
    }
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

// Update member's role, connection and department assignments
router.patch('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role, connection_ids, department_ids, is_active } = req.body;

    // Check if user is admin/owner
    const memberCheck = await query(
      `SELECT role FROM organization_members 
       WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem editar membros' });
    }

    // Check if target is owner (can't change owner's role)
    const targetCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, userId]
    );
    
    if (targetCheck.rows[0]?.role === 'owner' && role && role !== 'owner') {
      return res.status(400).json({ error: 'Não é possível alterar o cargo do proprietário' });
    }

    // Update role if provided and not owner
    if (role && targetCheck.rows[0]?.role !== 'owner') {
      await query(
        `UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3`,
        [role, id, userId]
      );
    }

    // Update is_active if provided (can't deactivate owner)
    if (is_active !== undefined && targetCheck.rows[0]?.role !== 'owner') {
      try {
        await query(
          `UPDATE organization_members SET is_active = $1 WHERE organization_id = $2 AND user_id = $3`,
          [is_active, id, userId]
        );
      } catch (e) {
        // Column may not exist yet, try adding it
        await query(`ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
        await query(
          `UPDATE organization_members SET is_active = $1 WHERE organization_id = $2 AND user_id = $3`,
          [is_active, id, userId]
        );
      }
    }

    // Update connection assignments if provided
    if (connection_ids !== undefined && Array.isArray(connection_ids)) {
      try {
        // Remove existing assignments for this org's connections
        await query(
          `DELETE FROM connection_members 
           WHERE user_id = $1 AND connection_id IN (
             SELECT id FROM connections WHERE organization_id = $2
           )`,
          [userId, id]
        );
        
        // Add new assignments
        for (const connId of connection_ids) {
          await query(
            `INSERT INTO connection_members (connection_id, user_id, can_view, can_send, can_manage)
             VALUES ($1, $2, true, true, false)
             ON CONFLICT (connection_id, user_id) DO NOTHING`,
            [connId, userId]
          );
        }
      } catch (e) {
        console.log('connection_members table may not exist:', e.message);
      }
    }

    // Update department assignments if provided
    if (department_ids !== undefined && Array.isArray(department_ids)) {
      try {
        // Remove existing department assignments for this org
        await query(
          `DELETE FROM department_members 
           WHERE user_id = $1 AND department_id IN (
             SELECT id FROM departments WHERE organization_id = $2
           )`,
          [userId, id]
        );
        
        // Add new department assignments
        for (const deptId of department_ids) {
          await query(
            `INSERT INTO department_members (department_id, user_id, role)
             VALUES ($1, $2, 'agent')
             ON CONFLICT (department_id, user_id) DO NOTHING`,
            [deptId, userId]
          );
        }
      } catch (e) {
        console.log('department_members table may not exist:', e.message);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ error: 'Erro ao atualizar membro' });
  }
});

// Get organization departments (for member assignment)
router.get('/:id([0-9a-fA-F-]{36})/departments', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user is member
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    
    // Tentar buscar departamentos (não falha se tabela não existir)
    try {
      const result = await query(
        `SELECT id, name, color, icon, is_active
         FROM departments 
         WHERE organization_id = $1 
         ORDER BY name`,
        [id]
      );
      res.json(result.rows);
    } catch (e) {
      console.log('departments table may not exist:', e.message);
      res.json([]);
    }
  } catch (error) {
    console.error('Get org departments error:', error);
    res.status(500).json({ error: 'Erro ao buscar departamentos', details: error.message });
  }
});

// Update user password (admin only)
router.patch('/:id([0-9a-fA-F-]{36})/members/:userId([0-9a-fA-F-]{36})/password', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { password } = req.body;

    // Check if user is admin/owner
    const memberCheck = await query(
      `SELECT role FROM organization_members 
       WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem alterar senhas' });
    }

    // Validate password
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(password, 10);
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hashedPassword, userId]
    );

    res.json({ success: true, message: 'Senha atualizada com sucesso' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Erro ao atualizar senha' });
  }
});

// Remove member from organization
router.delete('/:id([0-9a-fA-F-]{36})/members/:userId([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const { id, userId } = req.params;

    // Check if user is admin/owner
    const memberCheck = await query(
      `SELECT role FROM organization_members 
       WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem remover membros' });
    }

    // Can't remove owner
    const targetCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, userId]
    );
    
    if (targetCheck.rows[0]?.role === 'owner') {
      return res.status(400).json({ error: 'Não é possível remover o proprietário' });
    }

    // Remove connection assignments first
    await query(
      `DELETE FROM connection_members 
       WHERE user_id = $1 AND connection_id IN (
         SELECT id FROM connections WHERE organization_id = $2
       )`,
      [userId, id]
    );

    // Remove from organization
    await query(
      `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// ========================================
// AI Configuration Endpoints
// ========================================

// Get AI config for user's current organization
router.get('/ai-config', async (req, res) => {
  try {
    // First check if columns exist, if not return defaults
    const orgResult = await query(
      `SELECT o.id, 
              COALESCE(o.ai_provider, 'none') as ai_provider,
              o.ai_model,
              o.ai_api_key
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1
       ORDER BY om.created_at
       LIMIT 1`,
      [req.userId]
    );

    if (orgResult.rows.length === 0) {
      // Return defaults if no organization found
      return res.json({
        ai_provider: 'none',
        ai_model: '',
        ai_api_key: '',
      });
    }

    const org = orgResult.rows[0];
    res.json({
      ai_provider: org.ai_provider || 'none',
      ai_model: org.ai_model || '',
      ai_api_key: org.ai_api_key ? '••••••••' + org.ai_api_key.slice(-4) : '',
    });
  } catch (error) {
    // If columns don't exist, return defaults instead of error
    if (error.message && error.message.includes('column') && error.message.includes('does not exist')) {
      console.warn('AI config columns not found in organizations table, returning defaults');
      return res.json({
        ai_provider: 'none',
        ai_model: '',
        ai_api_key: '',
      });
    }
    console.error('Get AI config error:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações de IA' });
  }
});

// Update AI config for user's organization
router.put('/ai-config', async (req, res) => {
  try {
    const { ai_provider, ai_model, ai_api_key } = req.body;

    // Get user's organization and check if admin
    const orgResult = await query(
      `SELECT o.id, om.role, o.ai_api_key as existing_key
       FROM organizations o
       JOIN organization_members om ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.role IN ('owner', 'admin')
       ORDER BY om.created_at
       LIMIT 1`,
      [req.userId]
    );

    if (orgResult.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas admins podem alterar configurações de IA' });
    }

    const orgId = orgResult.rows[0].id;
    const existingKey = orgResult.rows[0].existing_key;

    // Determine the actual API key to save
    // If the key is masked (starts with ••), keep the existing one
    let actualApiKey = ai_api_key;
    if (ai_api_key && ai_api_key.startsWith('••')) {
      actualApiKey = existingKey;
    }

    await query(
      `UPDATE organizations 
       SET ai_provider = $1, ai_model = $2, ai_api_key = $3, updated_at = NOW()
       WHERE id = $4`,
      [ai_provider || 'none', ai_model || null, actualApiKey || null, orgId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Update AI config error:', error);
    // Migration resilience: missing columns
    if (error?.code === '42703' || (error?.message && error.message.includes('column') && error.message.includes('does not exist'))) {
      return res.status(503).json({
        error: 'Configuração de IA indisponível: migração do banco pendente (colunas ai_provider/ai_model/ai_api_key).',
      });
    }
    res.status(500).json({ error: 'Erro ao salvar configurações de IA' });
  }
});

// Test AI connection
router.post('/ai-config/test', async (req, res) => {
  try {
    const { ai_provider, ai_model, ai_api_key } = req.body;

    if (!ai_provider || ai_provider === 'none' || !ai_api_key) {
      return res.status(400).json({ error: 'Provedor e API Key são obrigatórios' });
    }

    // If key is masked, get the real one from DB
    let actualApiKey = ai_api_key;
    if (ai_api_key.startsWith('••')) {
      const orgResult = await query(
        `SELECT o.ai_api_key
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id
         WHERE om.user_id = $1
         ORDER BY om.created_at
         LIMIT 1`,
        [req.userId]
      );
      if (orgResult.rows.length === 0 || !orgResult.rows[0].ai_api_key) {
        return res.status(400).json({ error: 'API Key não encontrada' });
      }
      actualApiKey = orgResult.rows[0].ai_api_key;
    }

    // Test the connection based on provider
    let testResponse;
    if (ai_provider === 'openai') {
      testResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${actualApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ai_model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Diga apenas "OK"' }],
          max_tokens: 5,
        }),
      });
    } else if (ai_provider === 'gemini') {
      const geminiModel = ai_model || 'gemini-1.5-flash';
      testResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${actualApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Diga apenas "OK"' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        }
      );
    } else if (ai_provider === 'openrouter') {
      testResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${actualApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'https://gleego.app',
          'X-Title': 'Glee-go Whats',
        },
        body: JSON.stringify({
          model: ai_model || 'openai/gpt-4o-mini',
          messages: [{ role: 'user', content: 'Diga apenas "OK"' }],
          max_tokens: 5,
        }),
      });
    } else {
      return res.status(400).json({ error: 'Provedor não suportado' });
    }

    if (!testResponse.ok) {
      const upstreamStatus = testResponse.status;
      const errorText = await testResponse.text().catch(() => '');

      let parsedError = null;
      try {
        parsedError = JSON.parse(errorText);
      } catch {
        parsedError = null;
      }

      const upstreamMessageRaw =
        parsedError?.error?.message || // OpenAI + Gemini
        parsedError?.message ||
        parsedError?.error?.status ||
        (typeof errorText === 'string' ? errorText : '');

      const upstreamMessage = String(upstreamMessageRaw || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400);

      console.error('AI test failed:', {
        provider: ai_provider,
        model: ai_model,
        upstreamStatus,
        upstreamMessage,
      });

      // Human-friendly message + preserve upstream details for the UI
      let friendly = 'Falha na conexão com a IA';
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        friendly = 'API Key inválida ou sem permissão';
      } else if (upstreamStatus === 404) {
        friendly = 'Modelo não encontrado (verifique o modelo selecionado)';
      } else if (upstreamStatus === 429) {
        friendly = 'Rate limit excedido, tente novamente';
      } else if (upstreamStatus === 400) {
        // Common Gemini/OpenAI cases are returned as 400 with a helpful message
        if (/api key|apikey|invalid.*key|key.*invalid/i.test(upstreamMessage)) {
          friendly = 'API Key inválida';
        } else {
          friendly = 'Requisição inválida para o provedor (verifique modelo e se a API está habilitada)';
        }
      }

      return res.status(upstreamStatus >= 400 && upstreamStatus <= 599 ? upstreamStatus : 400).json({
        error: friendly,
        details: upstreamMessage || undefined,
        provider: ai_provider,
        model: ai_model || undefined,
      });
    }

    res.json({ success: true, message: 'Conexão testada com sucesso' });
  } catch (error) {
    console.error('Test AI config error:', error);
    // Migration resilience: missing columns
    if (error?.code === '42703' || (error?.message && error.message.includes('column') && error.message.includes('does not exist'))) {
      return res.status(503).json({
        error: 'Teste de IA indisponível: migração do banco pendente (colunas ai_provider/ai_model/ai_api_key).',
      });
    }
    res.status(500).json({ error: 'Erro ao testar conexão' });
  }
});

// ==================== WORK SCHEDULE ====================

// Get work schedule
router.get('/work-schedule', async (req, res) => {
  try {
    const memberResult = await query(
      `SELECT om.organization_id FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
      [req.userId]
    );
    if (memberResult.rows.length === 0) return res.status(403).json({ error: 'Sem organização' });

    const orgId = memberResult.rows[0].organization_id;
    const result = await query(`SELECT work_schedule FROM organizations WHERE id = $1`, [orgId]);
    const raw = result.rows[0]?.work_schedule;
    const schedule = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});

    res.json({
      timezone: schedule.timezone || 'America/Sao_Paulo',
      work_days: schedule.work_days || [1, 2, 3, 4, 5],
      work_start: schedule.work_start || '08:00',
      work_end: schedule.work_end || '18:00',
      lunch_start: schedule.lunch_start || '12:00',
      lunch_end: schedule.lunch_end || '13:00',
      slot_duration_minutes: schedule.slot_duration_minutes || 60,
      buffer_minutes: schedule.buffer_minutes || 15,
    });
  } catch (error) {
    console.error('Get work schedule error:', error);
    res.status(500).json({ error: 'Erro ao buscar horário de trabalho' });
  }
});

// Update work schedule
router.put('/work-schedule', async (req, res) => {
  try {
    const memberResult = await query(
      `SELECT om.organization_id, om.role FROM organization_members om WHERE om.user_id = $1 LIMIT 1`,
      [req.userId]
    );
    if (memberResult.rows.length === 0) return res.status(403).json({ error: 'Sem organização' });
    if (!['admin', 'superadmin'].includes(memberResult.rows[0].role)) {
      return res.status(403).json({ error: 'Apenas admins podem alterar horário de trabalho' });
    }

    const orgId = memberResult.rows[0].organization_id;
    const { timezone, work_days, work_start, work_end, lunch_start, lunch_end, slot_duration_minutes, buffer_minutes } = req.body;

    const schedule = {
      timezone: timezone || 'America/Sao_Paulo',
      work_days: work_days || [1, 2, 3, 4, 5],
      work_start: work_start || '08:00',
      work_end: work_end || '18:00',
      lunch_start: lunch_start || '12:00',
      lunch_end: lunch_end || '13:00',
      slot_duration_minutes: slot_duration_minutes || 60,
      buffer_minutes: buffer_minutes || 15,
    };

    await query(
      `UPDATE organizations SET work_schedule = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(schedule), orgId]
    );

    res.json(schedule);
  } catch (error) {
    console.error('Update work schedule error:', error);
    res.status(500).json({ error: 'Erro ao atualizar horário de trabalho' });
  }
});

// ========================================
// Permission Templates
// ========================================

// List permission templates for org
router.get('/:id([0-9a-fA-F-]{36})/permission-templates', async (req, res) => {
  try {
    const { id } = req.params;
    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Acesso negado' });

    const result = await query(
      `SELECT pt.*, 
        (SELECT COUNT(*) FROM organization_members om WHERE om.permission_template_id = pt.id)::int as member_count
       FROM permission_templates pt 
       WHERE pt.organization_id = $1 
       ORDER BY pt.created_at`,
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('List permission templates error:', error);
    res.status(500).json({ error: 'Erro ao listar templates de permissão' });
  }
});

// Create permission template
router.post('/:id([0-9a-fA-F-]{36})/permission-templates', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, permissions } = req.body;

    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Apenas admins podem criar templates' });

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const result = await query(
      `INSERT INTO permission_templates (organization_id, name, description, color, permissions) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, name, description || null, color || '#6366f1', JSON.stringify(permissions || {})]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Create permission template error:', error);
    res.status(500).json({ error: 'Erro ao criar template' });
  }
});

// Update permission template
router.put('/:id([0-9a-fA-F-]{36})/permission-templates/:templateId', async (req, res) => {
  try {
    const { id, templateId } = req.params;
    const { name, description, color, permissions } = req.body;

    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Apenas admins podem editar templates' });

    const result = await query(
      `UPDATE permission_templates 
       SET name = COALESCE($1, name), 
           description = COALESCE($2, description), 
           color = COALESCE($3, color), 
           permissions = COALESCE($4, permissions),
           updated_at = NOW()
       WHERE id = $5 AND organization_id = $6 RETURNING *`,
      [name, description, color, permissions ? JSON.stringify(permissions) : null, templateId, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Template não encontrado' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update permission template error:', error);
    res.status(500).json({ error: 'Erro ao atualizar template' });
  }
});

// Delete permission template
router.delete('/:id([0-9a-fA-F-]{36})/permission-templates/:templateId', async (req, res) => {
  try {
    const { id, templateId } = req.params;

    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Apenas admins podem excluir templates' });

    // Unset template from members first
    await query(`UPDATE organization_members SET permission_template_id = NULL WHERE permission_template_id = $1`, [templateId]);
    
    await query(`DELETE FROM permission_templates WHERE id = $1 AND organization_id = $2`, [templateId, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete permission template error:', error);
    res.status(500).json({ error: 'Erro ao excluir template' });
  }
});

// Assign template to member
router.patch('/:id([0-9a-fA-F-]{36})/members/:userId([0-9a-fA-F-]{36})/template', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { permission_template_id } = req.body;

    const memberCheck = await query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
      [id, req.userId]
    );
    if (memberCheck.rows.length === 0) return res.status(403).json({ error: 'Apenas admins podem atribuir templates' });

    await query(
      `UPDATE organization_members SET permission_template_id = $1 WHERE organization_id = $2 AND user_id = $3`,
      [permission_template_id || null, id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Assign template error:', error);
    res.status(500).json({ error: 'Erro ao atribuir template' });
  }
});

export default router;
