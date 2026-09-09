import 'dotenv/config'; // Preload — side-effect import, loads .env BEFORE other modules

import express from 'express';
import cors from 'cors';
import path from 'path';
import cron from 'node-cron';
import crypto from 'crypto';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import messagesRoutes from './routes/messages.js';
import contactsRoutes from './routes/contacts.js';
import campaignsRoutes from './routes/campaigns.js';
import organizationsRoutes from './routes/organizations.js';
import asaasRoutes from './routes/asaas.js';
import adminRoutes from './routes/admin.js';
import uploadsRoutes from './routes/uploads.js';
import notificationsRoutes from './routes/notifications.js';
import evolutionRoutes from './routes/evolution.js';
import wapiRoutes from './routes/wapi.js';
import chatRoutes from './routes/chat.js';
import quickRepliesRoutes from './routes/quick-replies.js';
import chatbotsRoutes from './routes/chatbots.js';
import departmentsRoutes from './routes/departments.js';
import flowsRoutes from './routes/flows.js';
import crmRoutes from './routes/crm.js';
import crmAutomationRoutes from './routes/crm-automation.js';
import emailRoutes from './routes/email.js';
import googleCalendarRoutes from './routes/google-calendar.js';
import billingQueueRoutes from './routes/billing-queue.js';
import transcribeRoutes from './routes/transcribe.js';
import aiAgentsRoutes from './routes/ai-agents.js';
import externalFormsRoutes from './routes/external-forms.js';
import leadDistributionRoutes from './routes/lead-distribution.js';
import leadWebhooksRoutes from './routes/lead-webhooks.js';
import leadScoringRoutes from './routes/lead-scoring.js';
import conversationSummaryRoutes from './routes/conversation-summary.js';
import nurturingRoutes from './routes/nurturing.js';
import ctwaAnalyticsRoutes from './routes/ctwa-analytics.js';
import groupSecretaryRoutes from './routes/group-secretary.js';
import ghostRoutes from './routes/ghost.js';
import projectsRoutes from './routes/projects.js';
import pushRoutes from './routes/push.js';
import taskBoardsRoutes from './routes/task-boards.js';
import leadGleegoRoutes from './routes/lead-gleego.js';
import globalAgentsRoutes from './routes/global-agents.js';
import metaTemplatesRoutes from './routes/meta-templates.js';
import docSignaturesRoutes from './routes/doc-signatures.js';
import rhRoutes from './routes/rh.js';
import appAccessTemplatesRoutes from './routes/app-access-templates.js';
import rhKioskRoutes from './routes/rh-kiosk.js';
import rhManagementRoutes from './routes/rh-management.js';
import rhPayrollExportRoutes from './routes/rh-payroll-export.js';
import rhDeductionsRoutes from './routes/rh-deductions.js';
import rhWhistleblowerRoutes from './routes/rh-whistleblower.js';
import rhWhistleblowerPublicRoutes from './routes/rh-whistleblower-public.js';
import timeclockRoutes from './routes/timeclock.js';
import companiesRoutes from './routes/companies.js';
import holdingRoutes from './routes/holding.js';
import promotorRoutes from './routes/promotor.js';
import merchandisingRoutes from './routes/merchandising.js';
import merchRoutesRoutes from './routes/merch-routes.js';
import accessControlRoutes from './routes/access-control.js';
import priceResearchRoutes from './routes/price-research.js';
import merchAnalyticsRoutes from './routes/merch-analytics.js';
import merchChecklistsRoutes from './routes/merch-checklists.js';
import ayratechAiRoutes from './routes/ayratech-ai.js';
import promoterValidationsRoutes from './routes/promoter-validations.js';
import pdvBlocksRoutes from './routes/pdv-blocks.js';
import networkPortalRoutes from './routes/network-portal.js';
import agencyNetworkRequestsRoutes from './routes/agency-network-requests.js';
import promoterAccessRoutes from './routes/promoter-access.js';
import smartrouteRoutes, { runNightlyOptimizer, runCatchupOptimizer } from './routes/smartroute.js';
import smartrouteDriverRoutes from './routes/smartroute-driver.js';

import smartrouteAIRoutes from './routes/smartroute-ai.js';
import smartroutePublicRoutes from './routes/smartroute-public.js';
import smartrouteReportsRoutes from './routes/smartroute-reports.js';
import smartrouteOpsRoutes from './routes/smartroute-ops.js';
import smartroutePlannerRoutes from './routes/smartroute-planner.js';

import promoterLeavesRoutes from './routes/promoter-leaves.js';
import accessControlDashboardRoutes from './routes/access-control-dashboard.js';
import appLogsRoutes from './routes/app-logs.js';
import managerRoutes from './routes/manager.js';
import { initDatabase } from './init-db.js';
import { executeNotifications } from './scheduler.js';
import { executeCampaignMessages } from './campaign-scheduler.js';
import { executeScheduledMessages } from './scheduled-messages.js';
import { syncTodaysDueBoletos, checkPaymentStatusUpdates } from './asaas-auto-sync.js';
import { executeCRMAutomations } from './crm-automation-scheduler.js';
import { processEmailQueue } from './email-scheduler.js';
import { executeNurturing } from './nurturing-scheduler.js';
import { executeTaskReminders } from './task-reminder-scheduler.js';
import { executeSecretaryFollowups } from './secretary-followup-scheduler.js';
import { executeSecretaryDigest } from './secretary-digest-scheduler.js';
import { checkInactivityTimeouts } from './lib/ai-agent-processor.js';
import { executeScoreCalculation } from './score-scheduler.js';
import { requestContext } from './request-context.js';
import { log, logError } from './logger.js';

// dotenv already loaded via 'dotenv/config' import at top

const app = express();
const PORT = process.env.PORT || 3001;
let databaseReady = false;
let databaseInitError = null;

// Add CORS headers to EVERY response (must be absolute first)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Request-Id');
  res.header('Access-Control-Max-Age', '86400');
  
  // Handle preflight immediately
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// CORS configuration - belt and suspenders
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request-scoped context + correlation id for structured logs
app.use((req, res, next) => {
  const startedAt = Date.now();
  const rawHeader = req.headers['x-request-id'];
  const incomingRequestId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const requestId = (incomingRequestId && String(incomingRequestId).trim()) || crypto.randomUUID();

  requestContext.run(
    {
      request_id: requestId,
      http_method: req.method,
      http_path: req.originalUrl,
    },
    () => {
      req.requestId = requestId;
      res.setHeader('X-Request-Id', requestId);

      log('info', 'http.request', {
        http_method: req.method,
        http_path: req.originalUrl,
      });

      res.on('finish', () => {
        log('info', 'http.response', {
          http_method: req.method,
          http_path: req.originalUrl,
          status_code: res.statusCode,
          duration_ms: Date.now() - startedAt,
        });
      });

      next();
    }
  );
});

// Serve uploaded files statically with CORS headers
const uploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    // Set correct MIME types for audio/video
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.ogg') {
      res.setHeader('Content-Type', 'audio/ogg');
    } else if (ext === '.mp3') {
      res.setHeader('Content-Type', 'audio/mpeg');
    } else if (ext === '.m4a') {
      res.setHeader('Content-Type', 'audio/mp4');
    } else if (ext === '.wav') {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (ext === '.aac') {
      res.setHeader('Content-Type', 'audio/aac');
    } else if (ext === '.mp4') {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (ext === '.webm') {
      // Many voice notes are stored as .webm; prefer audio/webm for broad compatibility
      res.setHeader('Content-Type', 'audio/webm');
    }
  }
}));


// ===========================
// Meta Cloud API Webhook (public - no auth)
// ===========================
import { query as dbQuery } from './db.js';

// GET: Meta webhook verification (hub.verify_token challenge)
app.get('/api/meta/webhook', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe' || !token) {
    return res.sendStatus(403);
  }

  try {
    // Find a Meta connection with this verify token
    const result = await dbQuery(
      `SELECT id FROM connections WHERE provider = 'meta' AND meta_webhook_verify_token = $1 LIMIT 1`,
      [token]
    );
    if (result.rows.length === 0) {
      console.log('[Meta Webhook] Verify token not found:', token);
      return res.sendStatus(403);
    }
    console.log('[Meta Webhook] Verification successful for connection:', result.rows[0].id);
    return res.status(200).send(challenge);
  } catch (err) {
    console.error('[Meta Webhook] Verification error:', err.message);
    return res.sendStatus(500);
  }
});

// POST: Meta webhook incoming messages
app.post('/api/meta/webhook', async (req, res) => {
  // Always respond 200 immediately to Meta
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body?.object || body.object !== 'whatsapp_business_account') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        // Accept both 'messages' and 'message_echoes' fields
        if (change.field !== 'messages' && change.field !== 'message_echoes') continue;
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Find the connection for this phone number ID
        const connResult = await dbQuery(
          `SELECT * FROM connections WHERE provider = 'meta' AND meta_phone_number_id = $1 LIMIT 1`,
          [phoneNumberId]
        );
        if (connResult.rows.length === 0) {
          console.log('[Meta Webhook] No connection found for phone_number_id:', phoneNumberId);
          continue;
        }

        const connection = connResult.rows[0];

        // Process incoming messages
        for (const message of (value.messages || [])) {
          try {
            const from = message.from; // sender phone
            
            // Skip outbound echoes (messages sent by us) to avoid duplicates
            if (change.field === 'message_echoes') {
              console.log(`[Meta Webhook] Echo received for message ${message.id}, skipping inbound processing`);
              continue;
            }

            const msgType = message.type;
            let content = '';
            let mediaUrl = null;

            switch (msgType) {
              case 'text':
                content = message.text?.body || '';
                break;
              case 'image':
                content = message.image?.caption || '[Imagem]';
                mediaUrl = message.image?.id; // Media ID, needs download
                break;
              case 'video':
                content = message.video?.caption || '[Vídeo]';
                mediaUrl = message.video?.id;
                break;
              case 'audio':
                content = '[Áudio]';
                mediaUrl = message.audio?.id;
                break;
              case 'document':
                content = message.document?.caption || message.document?.filename || '[Documento]';
                mediaUrl = message.document?.id;
                break;
              case 'sticker':
                content = '[Sticker]';
                mediaUrl = message.sticker?.id;
                break;
              case 'location':
                content = `[Localização: ${message.location?.latitude}, ${message.location?.longitude}]`;
                break;
              case 'contacts':
                content = `[Contato: ${message.contacts?.[0]?.name?.formatted_name || ''}]`;
                break;
              case 'reaction':
                content = message.reaction?.emoji || '👍';
                break;
              default:
                content = `[${msgType}]`;
            }

            // Download media if needed
            let finalMediaUrl = null;
            if (mediaUrl && connection.meta_token) {
              try {
                const mediaInfoRes = await fetch(`https://graph.facebook.com/v21.0/${mediaUrl}`, {
                  headers: { Authorization: `Bearer ${connection.meta_token}` }
                });
                if (mediaInfoRes.ok) {
                  const mediaInfo = await mediaInfoRes.json();
                  finalMediaUrl = mediaInfo.url; // Temporary URL from Meta
                }
              } catch (mediaErr) {
                console.error('[Meta Webhook] Media download error:', mediaErr.message);
              }
            }

            // Normalize phone
            const normalizedPhone = from.replace(/\D/g, '');
            const contactName = value.contacts?.[0]?.profile?.name || normalizedPhone;

            // Find or create contact
            let contactResult = await dbQuery(
              `SELECT id FROM contacts WHERE phone = $1 AND organization_id = $2 LIMIT 1`,
              [normalizedPhone, connection.organization_id]
            );

            if (contactResult.rows.length === 0) {
              contactResult = await dbQuery(
                `INSERT INTO contacts (phone, name, organization_id) VALUES ($1, $2, $3) RETURNING id`,
                [normalizedPhone, contactName, connection.organization_id]
              );
            }
            const contactId = contactResult.rows[0].id;

            // Find or create conversation
            let convResult = await dbQuery(
              `SELECT id FROM conversations WHERE contact_id = $1 AND connection_id = $2 LIMIT 1`,
              [contactId, connection.id]
            );

            if (convResult.rows.length === 0) {
              convResult = await dbQuery(
                `INSERT INTO conversations (contact_id, connection_id, organization_id, last_message_at)
                 VALUES ($1, $2, $3, NOW()) RETURNING id`,
                [contactId, connection.id, connection.organization_id]
              );
            }
            const conversationId = convResult.rows[0].id;

            // Save message
            await dbQuery(
              `INSERT INTO messages (conversation_id, sender, content, media_url, message_type, wamid, timestamp)
               VALUES ($1, 'contact', $2, $3, $4, $5, NOW())`,
              [conversationId, content, finalMediaUrl, msgType, message.id]
            );

            // Update conversation
            await dbQuery(
              `UPDATE conversations SET last_message_at = NOW(), unread_count = unread_count + 1 WHERE id = $1`,
              [conversationId]
            );

            console.log(`[Meta Webhook] Message saved: ${msgType} from ${normalizedPhone}`);
          } catch (msgErr) {
            console.error('[Meta Webhook] Error processing message:', msgErr.message);
          }
        }

        // Process status updates
        for (const status of (value.statuses || [])) {
          try {
            const wamid = status.id;
            const statusValue = status.status; // sent, delivered, read, failed
            
            if (statusValue === 'read') {
              await dbQuery(
                `UPDATE messages SET read_at = NOW() WHERE wamid = $1 AND read_at IS NULL`,
                [wamid]
              );
            } else if (statusValue === 'delivered') {
              await dbQuery(
                `UPDATE messages SET delivered_at = NOW() WHERE wamid = $1 AND delivered_at IS NULL`,
                [wamid]
              );
            }
          } catch (statusErr) {
            console.error('[Meta Webhook] Error processing status:', statusErr.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Meta Webhook] General error:', error.message);
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/asaas', asaasRoutes);
// Mount promoter-access early so its public routes (e.g. /api/public/networks)
// are not swallowed by adminRoutes' authenticate middleware at /api/public.
app.use('/api', promoterAccessRoutes);
app.use('/api/admin', adminRoutes);
// Mount admin routes also at /api/public for public endpoints (pre-register, branding)
app.use('/api/public', adminRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/evolution', evolutionRoutes);
app.use('/api/wapi', wapiRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/quick-replies', quickRepliesRoutes);
app.use('/api/chatbots', chatbotsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/flows', flowsRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/crm/automation', crmAutomationRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);
app.use('/api/billing-queue', billingQueueRoutes);
app.use('/api/transcribe-audio', transcribeRoutes);
app.use('/api/ai-agents', aiAgentsRoutes);
app.use('/api/external-forms', externalFormsRoutes);
app.use('/api/lead-distribution', leadDistributionRoutes);
app.use('/api/lead-webhooks', leadWebhooksRoutes);
app.use('/api/lead-scoring', leadScoringRoutes);
app.use('/api/conversation-summary', conversationSummaryRoutes);
app.use('/api/nurturing', nurturingRoutes);
app.use('/api/ctwa', ctwaAnalyticsRoutes);
app.use('/api/group-secretary', groupSecretaryRoutes);
app.use('/api/ghost', ghostRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/task-boards', taskBoardsRoutes);
app.use('/api/lead-gleego', leadGleegoRoutes);
app.use('/api/global-agents', globalAgentsRoutes);
app.use('/api/meta', metaTemplatesRoutes);
app.use('/api/doc-signatures', docSignaturesRoutes);
app.use('/api/rh', rhRoutes);
app.use('/api/rh/app-templates', appAccessTemplatesRoutes);
app.use('/api/rh/kiosk', rhKioskRoutes);
app.use('/api/rh', rhManagementRoutes);
app.use('/api/rh/payroll-export', rhPayrollExportRoutes);
app.use('/api/rh/deductions', rhDeductionsRoutes);
app.use('/api/rh/denuncias', rhWhistleblowerRoutes);
app.use('/api/denuncias-public', rhWhistleblowerPublicRoutes);
app.use('/api/timeclock', timeclockRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/holding', holdingRoutes);
app.use('/api/promotor', promotorRoutes);
app.use('/api/merchandising', merchandisingRoutes);
app.use('/api/merch', merchRoutesRoutes);
app.use('/api/access-control', accessControlRoutes);
app.use('/api/price-research', priceResearchRoutes);
app.use('/api/merch-analytics', merchAnalyticsRoutes);
app.use('/api/merch/brand-checklists', merchChecklistsRoutes);
app.use('/api/ayratech-ai', ayratechAiRoutes);
app.use('/api/promoter-validations', promoterValidationsRoutes);
app.use('/api/pdv-blocks', pdvBlocksRoutes);
app.use('/api/network-portal', networkPortalRoutes);
app.use('/api', agencyNetworkRequestsRoutes);
// promoterAccessRoutes already mounted above (before /api/public)
// SmartRoute AI — public (tracking, webhook) BEFORE admin auth; driver BEFORE admin
app.use('/api/smartroute-public', smartroutePublicRoutes);
app.use('/api/smartroute/driver', smartrouteDriverRoutes);
app.use('/api/smartroute/ai', smartrouteAIRoutes);
app.use('/api/smartroute/reports', smartrouteReportsRoutes);
app.use('/api/smartroute/ops', smartrouteOpsRoutes);
app.use('/api/smartroute/planner', smartroutePlannerRoutes);
app.use('/api/smartroute', smartrouteRoutes);


app.use('/api/promoter-leaves', promoterLeavesRoutes);
app.use('/api/access-control-dashboard', accessControlDashboardRoutes);
app.use('/api/app-logs', appLogsRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    databaseReady,
    databaseInitError,
    timestamp: new Date().toISOString(),
  });
});

// Diagnostic endpoint to check Google Calendar env vars
app.get('/api/debug/google-config', (req, res) => {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const frontendUrl = process.env.FRONTEND_URL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  res.json({
    GOOGLE_CLIENT_ID: clientId ? `${clientId.substring(0, 15)}...` : 'NOT SET',
    GOOGLE_REDIRECT_URI: redirectUri || 'NOT SET (will use localhost fallback)',
    FRONTEND_URL: frontendUrl || 'NOT SET (will use localhost fallback)',
  });
});

// Global error handler with CORS headers
app.use((err, req, res, next) => {
  logError('http.unhandled_error', err, {
    status_code: err?.status || 500,
  });
  
  // Ensure CORS headers are set even on errors
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    requestId: req.requestId || null,
  });
});

// Start the HTTP server immediately, then initialize the database in the background.
// This prevents deploy-time 502 responses while long non-critical migrations run.
app.listen(PORT, () => {
  console.log(`🚀 Whatsale API running on port ${PORT}`);

  initDatabase().then((ok) => {
    if (!ok) {
      databaseInitError = 'Database initialization failed in a critical step';
      console.error('🛑 Database initialization failed (critical step). API remains online in degraded mode.');
      return;
    }

    databaseReady = true;

    // Schedule billing notifications - runs every hour to check rules with matching send_time
    // Each rule has its own send_time, the scheduler only executes rules matching current hour
    cron.schedule('0 * * * *', async () => {
      console.log('⏰ [CRON] Hourly notification check triggered at', new Date().toISOString());
      try {
        await executeNotifications();
      } catch (error) {
        console.error('⏰ [CRON] Error executing notifications:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule campaign messages - runs every 30 seconds to check for pending messages
    cron.schedule('*/30 * * * * *', async () => {
      try {
        await executeCampaignMessages();
      } catch (error) {
        console.error('📤 [CRON] Error executing campaign messages:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule message sender - runs every minute to check for due scheduled messages
    cron.schedule('* * * * *', async () => {
      try {
        await executeScheduledMessages();
      } catch (error) {
        console.error('📅 [CRON] Error executing scheduled messages:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // ASAAS AUTO-SYNC JOBS
    // ============================================

    // 02:00 AM - Sync today's due boletos from Asaas
    // This ensures all boletos that are due TODAY are in the local DB
    // before the notification rules run
    cron.schedule('0 2 * * *', async () => {
      console.log('🌙 [CRON] 2AM Asaas auto-sync triggered at', new Date().toISOString());
      try {
        await syncTodaysDueBoletos();
      } catch (error) {
        console.error('🌙 [CRON] Error in 2AM Asaas sync:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // 08:00 AM - Check payment status updates
    // This verifies if any PENDING/OVERDUE payments have been paid
    // and updates their status (catches missed webhooks)
    cron.schedule('0 8 * * *', async () => {
      console.log('☀️ [CRON] 8AM Asaas status check triggered at', new Date().toISOString());
      try {
        await checkPaymentStatusUpdates();
      } catch (error) {
        console.error('☀️ [CRON] Error in 8AM status check:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // CRM FUNNEL AUTOMATION
    // ============================================

    // Schedule CRM automations - runs every 2 minutes to process flows and timeouts
    cron.schedule('*/2 * * * *', async () => {
      try {
        await executeCRMAutomations();
      } catch (error) {
        console.error('🤖 [CRON] Error executing CRM automations:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // EMAIL QUEUE PROCESSOR
    // ============================================

    // Schedule email queue processing - runs every minute
    cron.schedule('* * * * *', async () => {
      try {
        await processEmailQueue();
      } catch (error) {
        console.error('📧 [CRON] Error processing email queue:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // ============================================
    // NURTURING SEQUENCES SCHEDULER
    // ============================================

    // Schedule nurturing sequences - runs every 2 minutes
    cron.schedule('*/2 * * * *', async () => {
      try {
        await executeNurturing();
      } catch (error) {
        console.error('🔄 [CRON] Error executing nurturing sequences:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Schedule task reminders - runs every minute to check for due reminders
    cron.schedule('* * * * *', async () => {
      try {
        await executeTaskReminders();
      } catch (error) {
        console.error('⏰ [CRON] Error executing task reminders:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Secretary follow-up - checks every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      try {
        await executeSecretaryFollowups();
      } catch (error) {
        console.error('📌 [CRON] Error executing secretary follow-ups:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    // Secretary daily digest - checks every hour (matches digest_hour config)
    cron.schedule('0 * * * *', async () => {
      try {
        await executeSecretaryDigest();
      } catch (error) {
        console.error('📊 [CRON] Error executing secretary digest:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });

    console.log('⏰ Notification scheduler started - checks every hour (timezone: America/Sao_Paulo)');
    console.log('📤 Campaign scheduler started - checks every 30 seconds');
    console.log('📅 Scheduled messages started - checks every minute');
    console.log('🌙 Asaas auto-sync started - runs at 2:00 AM daily');
    console.log('☀️ Asaas status check started - runs at 8:00 AM daily');
    console.log('🤖 CRM automation started - checks every 2 minutes');
    console.log('📧 Email queue processor started - checks every minute');
    console.log('🔄 Nurturing sequences started - checks every 2 minutes');
    console.log('⏰ Task reminders started - checks every minute');
    console.log('📌 Secretary follow-up started - checks every 30 minutes');
    console.log('📊 Secretary daily digest started - checks every hour');

    // AI Agent inactivity timeout - checks every minute
    cron.schedule('* * * * *', async () => {
      try {
        await checkInactivityTimeouts();
      } catch (error) {
        console.error('🤖 AI inactivity check error:', error.message);
      }
    });
    console.log('🤖 AI agent inactivity checker started - checks every minute');

    // Promoter score calculation - runs every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      try {
        await executeScoreCalculation();
      } catch (error) {
        console.error('⭐ [CRON] Error calculating promoter scores:', error);
      }
    }, {
      timezone: 'America/Sao_Paulo'
    });
    console.log('⭐ Promoter score calculator started - runs every 6 hours');

    // SmartRoute IA - otimização noturna 20h America/Sao_Paulo para D+1
    cron.schedule('0 20 * * *', async () => {
      try { await runNightlyOptimizer(); }
      catch (error) { console.error('🌙 [CRON] Erro na otimização noturna SmartRoute:', error); }
    }, { timezone: 'America/Sao_Paulo' });
    console.log('🌙 SmartRoute IA nightly optimizer started - runs at 20:00 (America/Sao_Paulo)');

    // SmartRoute IA - catch-up no startup (cobre downtime durante o horário do cron)
    setTimeout(() => {
      runCatchupOptimizer().catch((e) => console.error('🔁 [CATCHUP] Erro:', e?.message || e));
    }, 15000);

  }).catch((error) => {
    databaseInitError = error?.message || 'Database initialization failed';
    console.error('🛑 Database initialization crashed. API remains online in degraded mode:', error);
  });
});
