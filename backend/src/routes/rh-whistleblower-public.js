// ============================================================
// RH — Canal de Denúncias (Whistleblower / NR-1) — rotas públicas
//   Sem autenticação. Usadas pelo formulário anônimo (link/QR Code)
//   e pela consulta de status por protocolo. Nunca gravam IP,
//   user-agent ou qualquer dado que possa identificar quem denuncia.
//   O rate-limit abaixo é só em memória (não persistido) e serve
//   apenas para conter abuso automatizado do formulário público.
// ============================================================
import express from 'express';
import crypto from 'crypto';
import { query } from '../db.js';
import { logError } from '../logger.js';
import { ensureWhistleblowerTables, WHISTLEBLOWER_CATEGORIES } from './rh-whistleblower.js';

const router = express.Router();

const VALID_CATEGORIES = new Set(WHISTLEBLOWER_CATEGORIES.map(c => c.key));

// ---- Rate limit simples em memória (por IP), sem persistência ----
const hits = new Map(); // key -> timestamps[]
function isRateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits.entries()) {
    const fresh = arr.filter(t => now - t < 60 * 60 * 1000);
    if (fresh.length) hits.set(k, fresh); else hits.delete(k);
  }
}, 15 * 60 * 1000).unref?.();

function clientKey(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
}

const PROTOCOL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0,O,1,I
function generateProtocol() {
  const bytes = crypto.randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) code += PROTOCOL_CHARS[bytes[i] % PROTOCOL_CHARS.length];
  return `DEN-${code.slice(0, 5)}-${code.slice(5, 10)}`;
}

router.use(async (req, res, next) => { try { await ensureWhistleblowerTables(); next(); } catch (e) { next(e); } });

// GET /api/denuncias-public/:slug — dados mínimos para renderizar o formulário
router.get('/:slug', async (req, res) => {
  try {
    const r = await query(
      `SELECT c.active, o.name AS organization_name
       FROM rh_whistleblower_channels c
       JOIN organizations o ON o.id = c.organization_id
       WHERE c.slug = $1`,
      [req.params.slug]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Canal não encontrado' });
    res.json({
      active: r.rows[0].active,
      organization_name: r.rows[0].organization_name,
      categories: WHISTLEBLOWER_CATEGORIES,
    });
  } catch (err) {
    logError('rh.whistleblowerPublic.channel.get', err);
    res.status(500).json({ error: 'Erro' });
  }
});

// POST /api/denuncias-public/:slug — envia uma denúncia anônima
router.post('/:slug', async (req, res) => {
  try {
    if (isRateLimited(`submit:${clientKey(req)}`, 5, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }

    const description = String(req.body?.description || '').trim();
    if (description.length < 10) {
      return res.status(400).json({ error: 'Descreva a denúncia com mais detalhes (mínimo 10 caracteres).' });
    }
    const category = VALID_CATEGORIES.has(req.body?.category) ? req.body.category : 'outro';
    const location = req.body?.location ? String(req.body.location).slice(0, 255) : null;
    const involvesWhom = req.body?.involves_whom ? String(req.body.involves_whom).slice(0, 500) : null;

    const chan = await query(
      `SELECT organization_id, active FROM rh_whistleblower_channels WHERE slug = $1`,
      [req.params.slug]
    );
    if (!chan.rows[0] || !chan.rows[0].active) {
      return res.status(404).json({ error: 'Canal não encontrado ou inativo' });
    }

    let created = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const protocol = generateProtocol();
      try {
        const r = await query(
          `INSERT INTO rh_whistleblower_reports (organization_id, protocol, category, description, location, involves_whom)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING protocol, created_at`,
          [chan.rows[0].organization_id, protocol, category, description.slice(0, 5000), location, involvesWhom]
        );
        created = r.rows[0];
        break;
      } catch (e) {
        if (e?.code === '23505') continue;
        throw e;
      }
    }
    if (!created) return res.status(500).json({ error: 'Não foi possível gerar o protocolo, tente novamente.' });

    res.json({ protocol: created.protocol, created_at: created.created_at });
  } catch (err) {
    logError('rh.whistleblowerPublic.report.create', err);
    res.status(500).json({ error: 'Erro ao enviar denúncia' });
  }
});

// GET /api/denuncias-public/status/:protocol — consulta anônima do andamento
router.get('/status/:protocol', async (req, res) => {
  try {
    if (isRateLimited(`status:${clientKey(req)}`, 20, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    const protocol = String(req.params.protocol || '').trim().toUpperCase();
    const r = await query(
      `SELECT protocol, category, status, rh_response, responded_at, created_at
       FROM rh_whistleblower_reports WHERE protocol = $1`,
      [protocol]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Protocolo não encontrado' });
    res.json(r.rows[0]);
  } catch (err) {
    logError('rh.whistleblowerPublic.status.get', err);
    res.status(500).json({ error: 'Erro' });
  }
});

export default router;
