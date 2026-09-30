import jwt from 'jsonwebtoken';
import { setRequestContext } from '../request-context.js';
import { query } from '../db.js';

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;

    try {
      let result;
      try {
        result = await query(
          `SELECT u.id, u.email, u.name, u.is_superadmin, u.account_type, u.timeclock_kiosk,
                  om.role, o.id AS organization_id, o.modules_enabled
           FROM users u
           LEFT JOIN organization_members om ON om.user_id = u.id
           LEFT JOIN organizations o ON o.id = om.organization_id
           WHERE u.id = $1
           ORDER BY CASE om.role
             WHEN 'owner' THEN 1
             WHEN 'admin' THEN 2
             WHEN 'manager' THEN 3
             WHEN 'agent' THEN 4
             ELSE 5
           END
           LIMIT 1`,
          [decoded.userId]
        );
      } catch (error) {
        // Schemas without the kiosk columns: retry without them so role/org
        // context is still resolved instead of degrading to an empty user.
        result = await query(
          `SELECT u.id, u.email, u.name, u.is_superadmin,
                  om.role, o.id AS organization_id, o.modules_enabled
           FROM users u
           LEFT JOIN organization_members om ON om.user_id = u.id
           LEFT JOIN organizations o ON o.id = om.organization_id
           WHERE u.id = $1
           ORDER BY CASE om.role
             WHEN 'owner' THEN 1
             WHEN 'admin' THEN 2
             WHEN 'manager' THEN 3
             WHEN 'agent' THEN 4
             ELSE 5
           END
           LIMIT 1`,
          [decoded.userId]
        );
      }

      if (!result.rows.length) {
        return res.status(401).json({ error: 'Usuário não encontrado' });
      }

      const user = result.rows[0];
      const isMasterAdmin = String(user.email || '').toLowerCase().trim() === 'tnicodemos@gmail.com';
      const isSuperadmin = user.is_superadmin === true || isMasterAdmin;
      if (isMasterAdmin && user.is_superadmin !== true) {
        await query(`UPDATE users SET is_superadmin = true WHERE id = $1`, [user.id]);
      }

      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        is_superadmin: isSuperadmin,
        role: isSuperadmin ? 'superadmin' : user.role,
        organization_id: user.organization_id,
        modules_enabled: user.modules_enabled,
        account_type: user.account_type || 'standard',
        timeclock_kiosk: user.timeclock_kiosk === true,
      };
    } catch (error) {
      console.warn('[auth middleware] failed to enrich user context:', error.message);
      const isMasterAdmin = String(decoded.email || '').toLowerCase().trim() === 'tnicodemos@gmail.com';
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        is_superadmin: isMasterAdmin,
        role: isMasterAdmin ? 'superadmin' : undefined,
      };
    }

    // enrich structured logs
    setRequestContext({ user_id: decoded.userId, user_email: decoded.email });

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

