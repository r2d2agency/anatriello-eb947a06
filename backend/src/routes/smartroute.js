// SmartRoute AI - Admin routes
import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { query, pool } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { logError } from '../logger.js';

const router = express.Router();

let ensured = false;
export async function ensureSmartRouteTables() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS smartroute_vehicles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      plate TEXT NOT NULL,
      model TEXT,
      brand TEXT,
      year INTEGER,
      capacity_kg NUMERIC(10,2) DEFAULT 0,
      capacity_m3 NUMERIC(10,2) DEFAULT 0,
      fuel_type TEXT DEFAULT 'diesel',
      status TEXT DEFAULT 'ativo',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_veh_org ON smartroute_vehicles(organization_id, status);

    CREATE TABLE IF NOT EXISTS smartroute_drivers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      full_name TEXT NOT NULL,
      cpf TEXT,
      phone TEXT,
      email TEXT,
      license_number TEXT,
      license_category TEXT,
      license_expires_at DATE,
      vehicle_id UUID REFERENCES smartroute_vehicles(id) ON DELETE SET NULL,
      password_hash TEXT,
      active BOOLEAN DEFAULT true,
      current_lat DOUBLE PRECISION,
      current_lng DOUBLE PRECISION,
      current_status TEXT DEFAULT 'offline',
      last_location_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_drv_org ON smartroute_drivers(organization_id, active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_drv_cpf ON smartroute_drivers(organization_id, cpf) WHERE cpf IS NOT NULL;

    CREATE TABLE IF NOT EXISTS smartroute_pdvs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name TEXT NOT NULL,
      cnpj TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      contact_name TEXT,
      contact_phone TEXT,
      delivery_window_start TIME,
      delivery_window_end TIME,
      notes TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_pdv_org ON smartroute_pdvs(organization_id, active);

    CREATE TABLE IF NOT EXISTS smartroute_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      pdv_id UUID REFERENCES smartroute_pdvs(id) ON DELETE SET NULL,
      order_number TEXT,
      weight_kg NUMERIC(10,2) DEFAULT 0,
      volume_m3 NUMERIC(10,3) DEFAULT 0,
      value_cents INTEGER DEFAULT 0,
      items JSONB DEFAULT '[]'::jsonb,
      priority INTEGER DEFAULT 5,
      delivery_date DATE,
      status TEXT DEFAULT 'pendente',
      route_stop_id UUID,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ord_org ON smartroute_orders(organization_id, status, delivery_date);
    CREATE INDEX IF NOT EXISTS idx_sr_ord_pdv ON smartroute_orders(pdv_id);

    CREATE TABLE IF NOT EXISTS smartroute_routes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      code TEXT,
      driver_id UUID REFERENCES smartroute_drivers(id) ON DELETE SET NULL,
      vehicle_id UUID REFERENCES smartroute_vehicles(id) ON DELETE SET NULL,
      planned_date DATE NOT NULL DEFAULT CURRENT_DATE,
      status TEXT DEFAULT 'planejada',
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      total_distance_km NUMERIC(10,2) DEFAULT 0,
      total_stops INTEGER DEFAULT 0,
      completed_stops INTEGER DEFAULT 0,
      depot_lat DOUBLE PRECISION,
      depot_lng DOUBLE PRECISION,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_rt_org ON smartroute_routes(organization_id, planned_date, status);
    CREATE INDEX IF NOT EXISTS idx_sr_rt_driver ON smartroute_routes(driver_id, planned_date);

    CREATE TABLE IF NOT EXISTS smartroute_route_stops (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id UUID NOT NULL REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      order_id UUID REFERENCES smartroute_orders(id) ON DELETE SET NULL,
      pdv_id UUID REFERENCES smartroute_pdvs(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pendente',
      arrived_at TIMESTAMPTZ,
      checkin_lat DOUBLE PRECISION,
      checkin_lng DOUBLE PRECISION,
      checkin_photo TEXT,
      departed_at TIMESTAMPTZ,
      checkout_lat DOUBLE PRECISION,
      checkout_lng DOUBLE PRECISION,
      signature_url TEXT,
      receiver_name TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_stops_route ON smartroute_route_stops(route_id, sequence);

    CREATE TABLE IF NOT EXISTS smartroute_stop_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      stop_id UUID NOT NULL REFERENCES smartroute_route_stops(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      kind TEXT DEFAULT 'entrega',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_photos_stop ON smartroute_stop_photos(stop_id);

    CREATE TABLE IF NOT EXISTS smartroute_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      route_id UUID REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      driver_id UUID REFERENCES smartroute_drivers(id) ON DELETE SET NULL,
      stop_id UUID REFERENCES smartroute_route_stops(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      event_data JSONB DEFAULT '{}'::jsonb,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_evt_route ON smartroute_events(route_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sr_evt_driver ON smartroute_events(driver_id, created_at DESC);

    ALTER TABLE smartroute_vehicles ADD COLUMN IF NOT EXISTS km_per_liter NUMERIC(6,2);
    ALTER TABLE smartroute_vehicles ADD COLUMN IF NOT EXISTS fuel_price_per_liter NUMERIC(8,3);
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS estimated_fuel_liters NUMERIC(10,2);
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS estimated_cost_brl NUMERIC(10,2);
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS estimated_duration_min INTEGER;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS eta_min INTEGER;

    CREATE TABLE IF NOT EXISTS smartroute_depots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      is_default BOOLEAN DEFAULT false,
      active BOOLEAN DEFAULT true,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_depots_org ON smartroute_depots(organization_id, active);
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS depot_id UUID;

    -- Atributos do PDV usados pelas regras de checklist
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS client_id UUID;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS pdv_type TEXT;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS channel TEXT;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS region TEXT;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS contacts JSONB DEFAULT '[]'::jsonb;

    -- Código do cliente no ERP externo (Mega Online etc), usado na importação de romaneios
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS erp_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_pdvs_erp_code ON smartroute_pdvs(organization_id, erp_code) WHERE erp_code IS NOT NULL;

    -- Número do romaneio de origem, para evitar reimportação duplicada
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS romaneio_number TEXT;
    CREATE INDEX IF NOT EXISTS idx_sr_routes_romaneio ON smartroute_routes(organization_id, romaneio_number) WHERE romaneio_number IS NOT NULL;


    -- === Fluxo Inteligente da Operação (Onda 1) ===
    -- Máquina de estados por stop
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'PENDING';
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS checkin_at TIMESTAMPTZ;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS checkout_at TIMESTAMPTZ;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS distance_ok BOOLEAN;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS checkin_distance_m NUMERIC(10,2);
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS template_snapshot_id UUID;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS occurrence_summary TEXT;

    -- === Onda 7 (POD): CPF/RG opcional por rota/parada + comprovante ===
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS pod_require_document BOOLEAN;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS receiver_document TEXT;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS receiver_document_type TEXT;
    ALTER TABLE smartroute_route_stops ADD COLUMN IF NOT EXISTS receipt_url TEXT;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS pod_require_document BOOLEAN;

    -- Configurações operacionais por organização
    -- Precisa existir antes dos ALTERs abaixo; caso contrário o ensureTables falha
    -- e endpoints como /depots e /depots/geocode retornam 500.
    CREATE TABLE IF NOT EXISTS smartroute_org_operation_settings (
      organization_id UUID PRIMARY KEY,
      max_checkin_distance_m INTEGER DEFAULT 30,
      require_facade_photo BOOLEAN DEFAULT true,
      require_vehicle_checklist BOOLEAN DEFAULT false,
      preferred_nav_app TEXT DEFAULT 'ask',
      allow_checkout_with_occurrence BOOLEAN DEFAULT true,
      require_signature BOOLEAN DEFAULT true,
      require_invoice_photo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE smartroute_org_operation_settings ADD COLUMN IF NOT EXISTS require_receiver_document BOOLEAN DEFAULT false;
    ALTER TABLE smartroute_org_operation_settings ADD COLUMN IF NOT EXISTS receiver_document_type TEXT DEFAULT 'cpf';

    -- Mídias ricas (foto/vídeo/áudio/assinatura) com EXIF
    CREATE TABLE IF NOT EXISTS smartroute_stop_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      stop_id UUID NOT NULL REFERENCES smartroute_route_stops(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,               -- photo | video | audio | signature | facade | invoice
      url TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      taken_at TIMESTAMPTZ DEFAULT NOW(),
      device_info JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_media_stop ON smartroute_stop_media(stop_id, kind);
    CREATE INDEX IF NOT EXISTS idx_sr_media_org ON smartroute_stop_media(organization_id, created_at DESC);

    -- Ocorrências ricas por stop
    CREATE TABLE IF NOT EXISTS smartroute_stop_occurrences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      stop_id UUID NOT NULL REFERENCES smartroute_route_stops(id) ON DELETE CASCADE,
      driver_id UUID,
      type TEXT NOT NULL,               -- danificado | vencido | recusado | cliente_ausente | cliente_fechado | garantia | devolucao | descarte | equipamento | freezer | outro
      description TEXT,
      severity TEXT DEFAULT 'medium',   -- low | medium | high
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      media_ids UUID[] DEFAULT '{}'::uuid[],
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_occ_stop ON smartroute_stop_occurrences(stop_id);
    CREATE INDEX IF NOT EXISTS idx_sr_occ_org ON smartroute_stop_occurrences(organization_id, created_at DESC);

    -- Onda 4: enriquecimento de ocorrências (status, SLA, atribuição, resolução)
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS code TEXT;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aberta';
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS sla_target_min INTEGER;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS sla_deadline_at TIMESTAMPTZ;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN DEFAULT false;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS assigned_to UUID;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS resolution TEXT;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS resolved_by UUID;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
    ALTER TABLE smartroute_stop_occurrences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS idx_sr_occ_status ON smartroute_stop_occurrences(organization_id, status, created_at DESC);

    -- Catálogo configurável de tipos de ocorrência (com SLA por tipo)
    CREATE TABLE IF NOT EXISTS smartroute_occurrence_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      severity TEXT DEFAULT 'medium',       -- low | medium | high
      sla_target_min INTEGER DEFAULT 60,    -- prazo em minutos para resolução
      require_photo BOOLEAN DEFAULT true,
      require_description BOOLEAN DEFAULT true,
      blocks_checkout BOOLEAN DEFAULT false,
      color TEXT DEFAULT '#f59e0b',
      icon TEXT DEFAULT 'alert-triangle',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (organization_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_sr_occ_types_org ON smartroute_occurrence_types(organization_id, active);

    -- Comentários / follow-ups em ocorrências
    CREATE TABLE IF NOT EXISTS smartroute_occurrence_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      occurrence_id UUID NOT NULL REFERENCES smartroute_stop_occurrences(id) ON DELETE CASCADE,
      organization_id UUID NOT NULL,
      author_id UUID,
      author_name TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_occ_cmt ON smartroute_occurrence_comments(occurrence_id, created_at ASC);


    -- === Checklists configuráveis (Onda 2 — schema pronto) ===
    CREATE TABLE IF NOT EXISTS smartroute_checklist_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      active BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ck_tpl_org ON smartroute_checklist_templates(organization_id, active);

    CREATE TABLE IF NOT EXISTS smartroute_checklist_template_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES smartroute_checklist_templates(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL DEFAULT 0,
      field_type TEXT NOT NULL,          -- photo|video|text|number|temperature|stock_count|ocr|qr|barcode|signature|geo|face|yes_no|multi_choice
      label TEXT NOT NULL,
      required BOOLEAN DEFAULT true,
      config JSONB DEFAULT '{}'::jsonb,  -- { min, max, options, gpsToleranceM, ocrTargets, ... }
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ck_item_tpl ON smartroute_checklist_template_items(template_id, seq);

    CREATE TABLE IF NOT EXISTS smartroute_checklist_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      template_id UUID NOT NULL REFERENCES smartroute_checklist_templates(id) ON DELETE CASCADE,
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { client_ids, pdv_types, channels, categories, regions, equipment, operation, product_ids }
      priority INTEGER DEFAULT 100,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ck_asg_org ON smartroute_checklist_assignments(organization_id, active);

    CREATE TABLE IF NOT EXISTS smartroute_stop_checklist_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      stop_id UUID NOT NULL REFERENCES smartroute_route_stops(id) ON DELETE CASCADE,
      template_id UUID NOT NULL,
      item_id UUID NOT NULL,
      value JSONB DEFAULT '{}'::jsonb,
      media_ids UUID[] DEFAULT '{}'::uuid[],
      ocr_json JSONB,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      answered_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ck_resp_stop ON smartroute_stop_checklist_responses(stop_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_ck_resp ON smartroute_stop_checklist_responses(stop_id, item_id);

    CREATE TABLE IF NOT EXISTS smartroute_stop_ocr_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      stop_id UUID NOT NULL REFERENCES smartroute_route_stops(id) ON DELETE CASCADE,
      media_id UUID REFERENCES smartroute_stop_media(id) ON DELETE SET NULL,
      product TEXT,
      brand TEXT,
      code TEXT,
      ean TEXT,
      batch TEXT,
      manufactured_at DATE,
      expires_at DATE,
      confidence NUMERIC(4,3),
      raw_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_ocr_stop ON smartroute_stop_ocr_results(stop_id);

    -- Log append-only da jornada
    CREATE TABLE IF NOT EXISTS smartroute_journey_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      driver_id UUID,
      route_id UUID,
      stop_id UUID,
      event_type TEXT NOT NULL,          -- journey_started | stop_navigate | stop_checkin | stop_checkin_denied | checklist_item_answered | occurrence_added | stop_signed | stop_checkout | journey_finished
      payload JSONB DEFAULT '{}'::jsonb,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_jev_route ON smartroute_journey_events(route_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sr_jev_org ON smartroute_journey_events(organization_id, created_at DESC);

    -- === Rotas dinâmicas + IA noturna ===
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS default_driver_id UUID;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS default_vehicle_id UUID;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS owner_user_id UUID;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS parent_route_id UUID;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS route_day_id UUID;
    ALTER TABLE smartroute_routes ADD COLUMN IF NOT EXISTS upsell_time_min INTEGER DEFAULT 0;

    ALTER TABLE smartroute_orders ADD COLUMN IF NOT EXISTS route_id UUID;
    ALTER TABLE smartroute_orders ADD COLUMN IF NOT EXISTS pdv_window TEXT;
    ALTER TABLE smartroute_orders ADD COLUMN IF NOT EXISTS owner_user_id UUID;
    ALTER TABLE smartroute_orders ADD COLUMN IF NOT EXISTS sequence INTEGER;

    -- Regras por PDV (janela + dias permitidos + tempo de descarga + checklist)
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS delivery_window TEXT DEFAULT 'qualquer';
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS allowed_weekdays INTEGER[] DEFAULT '{0,1,2,3,4,5,6}'::int[];
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS service_time_min INTEGER DEFAULT 15;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS checklist_template_id UUID;
    ALTER TABLE smartroute_pdvs ADD COLUMN IF NOT EXISTS route_template_id UUID;
    CREATE INDEX IF NOT EXISTS idx_sr_pdv_route_template ON smartroute_pdvs(route_template_id);

    -- Templates de checklist por PDV (pdv_id nulo = template global padrão)
    CREATE TABLE IF NOT EXISTS smartroute_pdv_checklists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      pdv_id UUID REFERENCES smartroute_pdvs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default BOOLEAN DEFAULT false,
      items JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sr_pdvchk_org ON smartroute_pdv_checklists(organization_id);

    -- Mantém tabelas antigas mas não obrigatórias
    CREATE TABLE IF NOT EXISTS smartroute_route_pdvs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id UUID NOT NULL REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      pdv_id UUID NOT NULL REFERENCES smartroute_pdvs(id) ON DELETE CASCADE,
      sequence INTEGER DEFAULT 0,
      delivery_window TEXT DEFAULT 'qualquer',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(route_id, pdv_id)
    );
    ALTER TABLE smartroute_route_pdvs ADD COLUMN IF NOT EXISTS delivery_window TEXT DEFAULT 'qualquer';
    CREATE TABLE IF NOT EXISTS smartroute_route_schedule (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id UUID NOT NULL REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL,
      driver_id UUID,
      vehicle_id UUID,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(route_id, weekday)
    );

    -- Instância diária de rota (agora é o resultado da IA)
    CREATE TABLE IF NOT EXISTS smartroute_route_days (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      route_id UUID NOT NULL REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      status TEXT DEFAULT 'aberta',
      driver_ids UUID[] DEFAULT '{}'::uuid[],
      vehicle_id UUID,
      closed_at TIMESTAMPTZ,
      closed_by UUID,
      reopened_at TIMESTAMPTZ,
      daily_route_ids UUID[] DEFAULT '{}'::uuid[],
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(route_id, date)
    );
    ALTER TABLE smartroute_route_days ADD COLUMN IF NOT EXISTS optimized_at TIMESTAMPTZ;
    ALTER TABLE smartroute_route_days ADD COLUMN IF NOT EXISTS optimized_by TEXT;
    ALTER TABLE smartroute_route_days ADD COLUMN IF NOT EXISTS stops_summary JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE smartroute_route_days ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_sr_rday ON smartroute_route_days(route_id, date);
    CREATE INDEX IF NOT EXISTS idx_sr_orders_route_date ON smartroute_orders(route_id, delivery_date, sequence);
  `);
  ensured = true;
}



router.use(authenticate);
router.use(async (req, res, next) => { try { await ensureSmartRouteTables(); next(); } catch (e) { next(e); } });

const orgId = (req) => req.user?.organization_id;

// ============ DEPOTS (Centros de Distribuição) ============
async function geocodeNominatim(parts = {}) {
  const zipDigits = String(parts.zip || '').replace(/\D/g, '');
  let viaCep = null;

  if (zipDigits.length === 8) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://viacep.com.br/ws/${zipDigits}/json/`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && !data.erro) viaCep = data;
      }
    } catch (_) {}
  }

  const address = parts.address || [viaCep?.logradouro, viaCep?.bairro].filter(Boolean).join(', ');
  const city = parts.city || viaCep?.localidade;
  const state = parts.state || viaCep?.uf;
  const queryText = [address, city, state, zipDigits || parts.zip, 'Brasil'].filter(Boolean).join(', ');
  if (!queryText.trim()) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(queryText)}`,
      { headers: { 'User-Agent': 'AnatrielloSmartRoute/1.0 (smartroute@anatriello.local)' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data) && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display_name: data[0].display_name };
    }
  } catch (_) {}
  return null;
}

router.get('/depots', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM smartroute_depots WHERE organization_id=$1 AND active=true ORDER BY is_default DESC, name`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/depots/geocode', async (req, res) => {
  try {
    const g = await geocodeNominatim(req.body || {});
    if (!g) return res.status(404).json({ error: 'Endereço não encontrado' });
    res.json(g);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/depots', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Nome é obrigatório' });
    let { lat, lng } = b;
    if ((lat == null || lng == null) && (b.address || b.city)) {
      const g = await geocodeNominatim(b);
      if (g) { lat = g.lat; lng = g.lng; }
    }
    if (b.is_default) await query(`UPDATE smartroute_depots SET is_default=false WHERE organization_id=$1`, [orgId(req)]);
    const r = await query(
      `INSERT INTO smartroute_depots (organization_id, name, address, city, state, zip, lat, lng, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,false),$10) RETURNING *`,
      [orgId(req), b.name, b.address, b.city, b.state, b.zip, lat, lng, b.is_default, b.notes]);
    res.json(r.rows[0]);
  } catch (e) { logError('smartroute.depots.create', e); res.status(500).json({ error: e.message }); }
});
router.put('/depots/:id', async (req, res) => {
  try {
    const b = req.body || {};
    let { lat, lng } = b;
    if ((lat == null || lng == null) && (b.address || b.city)) {
      const g = await geocodeNominatim(b);
      if (g) { lat = g.lat; lng = g.lng; }
    }
    if (b.is_default) await query(`UPDATE smartroute_depots SET is_default=false WHERE organization_id=$1 AND id<>$2`, [orgId(req), req.params.id]);
    const r = await query(
      `UPDATE smartroute_depots SET name=COALESCE($3,name), address=$4, city=$5, state=$6, zip=$7,
        lat=COALESCE($8,lat), lng=COALESCE($9,lng), is_default=COALESCE($10,is_default), notes=$11, updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.name, b.address, b.city, b.state, b.zip, lat, lng, b.is_default, b.notes]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/depots/:id', async (req, res) => {
  try { await query(`UPDATE smartroute_depots SET active=false WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DASHBOARD ============
router.get('/dashboard', async (req, res) => {
  try {
    const org = orgId(req);
    const today = new Date().toISOString().slice(0, 10);
    const [routes, stops, drivers, vehicles, orders] = await Promise.all([
      query(`SELECT status, COUNT(*)::int c FROM smartroute_routes WHERE organization_id=$1 AND planned_date=$2 GROUP BY status`, [org, today]),
      query(`SELECT s.status, COUNT(*)::int c FROM smartroute_route_stops s JOIN smartroute_routes r ON r.id=s.route_id WHERE r.organization_id=$1 AND r.planned_date=$2 GROUP BY s.status`, [org, today]),
      query(`SELECT current_status, COUNT(*)::int c FROM smartroute_drivers WHERE organization_id=$1 AND active=true GROUP BY current_status`, [org]),
      query(`SELECT status, COUNT(*)::int c FROM smartroute_vehicles WHERE organization_id=$1 GROUP BY status`, [org]),
      query(`SELECT status, COUNT(*)::int c FROM smartroute_orders WHERE organization_id=$1 AND (delivery_date=$2 OR delivery_date IS NULL) GROUP BY status`, [org, today]),
    ]);
    const toMap = (rows, k = 'status') => Object.fromEntries(rows.map((r) => [r[k] || 'na', r.c]));
    res.json({
      date: today,
      routes: toMap(routes.rows),
      stops: toMap(stops.rows),
      drivers: toMap(drivers.rows, 'current_status'),
      vehicles: toMap(vehicles.rows),
      orders: toMap(orders.rows),
    });
  } catch (e) { logError('smartroute.dashboard', e); res.status(500).json({ error: e.message }); }
});

// ============ LIVE MAP ============
router.get('/live', async (req, res) => {
  try {
    const org = orgId(req);
    const today = new Date().toISOString().slice(0, 10);
    const drivers = await query(
      `SELECT d.id, d.full_name, d.current_lat, d.current_lng, d.current_status, d.last_location_at,
              v.plate, v.model,
              r.id AS route_id, r.code AS route_code, r.status AS route_status, r.completed_stops, r.total_stops
       FROM smartroute_drivers d
       LEFT JOIN smartroute_vehicles v ON v.id=d.vehicle_id
       LEFT JOIN smartroute_routes r ON r.driver_id=d.id AND r.planned_date=$2 AND r.status IN ('em_andamento','planejada')
       WHERE d.organization_id=$1 AND d.active=true`,
      [org, today]
    );
    res.json({ drivers: drivers.rows, date: today });
  } catch (e) { logError('smartroute.live', e); res.status(500).json({ error: e.message }); }
});

// ============ VEHICLES CRUD ============
router.get('/vehicles', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM smartroute_vehicles WHERE organization_id=$1 ORDER BY plate`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/vehicles', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `INSERT INTO smartroute_vehicles (organization_id, plate, model, brand, year, capacity_kg, capacity_m3, fuel_type, status, notes, km_per_liter, fuel_price_per_liter)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'ativo'),$10,$11,$12) RETURNING *`,
      [orgId(req), b.plate, b.model, b.brand, b.year || null, b.capacity_kg || 0, b.capacity_m3 || 0, b.fuel_type || 'diesel', b.status, b.notes, b.km_per_liter || null, b.fuel_price_per_liter || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/vehicles/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_vehicles SET plate=COALESCE($3,plate), model=COALESCE($4,model), brand=COALESCE($5,brand),
        year=COALESCE($6,year), capacity_kg=COALESCE($7,capacity_kg), capacity_m3=COALESCE($8,capacity_m3),
        fuel_type=COALESCE($9,fuel_type), status=COALESCE($10,status), notes=COALESCE($11,notes),
        km_per_liter=COALESCE($12,km_per_liter), fuel_price_per_liter=COALESCE($13,fuel_price_per_liter), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.plate, b.model, b.brand, b.year, b.capacity_kg, b.capacity_m3, b.fuel_type, b.status, b.notes, b.km_per_liter, b.fuel_price_per_liter]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/vehicles/:id', async (req, res) => {
  try { await query(`DELETE FROM smartroute_vehicles WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ DRIVERS CRUD ============
router.get('/drivers', async (req, res) => {
  try {
    const r = await query(
      `SELECT d.*, v.plate AS vehicle_plate FROM smartroute_drivers d
       LEFT JOIN smartroute_vehicles v ON v.id=d.vehicle_id
       WHERE d.organization_id=$1 ORDER BY d.full_name`, [orgId(req)]);
    res.json(r.rows.map(({ password_hash, ...rest }) => rest));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Cria/atualiza o colaborador correspondente no RH e devolve o employee_id
async function upsertRhEmployeeForDriver(org, b) {
  try {
    const cpfDigits = (b.cpf || '').replace(/\D/g, '') || null;
    // 1) tenta encontrar existente por CPF
    let empId = null;
    if (cpfDigits) {
      const found = await query(
        `SELECT id FROM employees
          WHERE organization_id=$1
            AND REGEXP_REPLACE(COALESCE(cpf,''),'\\D','','g') = $2
          LIMIT 1`,
        [org, cpfDigits]
      );
      empId = found.rows[0]?.id || null;
    }

    if (empId) {
      // atualiza dados básicos sem sobrescrever com nulos
      await query(
        `UPDATE employees SET
           full_name = COALESCE($2, full_name),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           cnh = COALESCE($5, cnh),
           cnh_category = COALESCE($6, cnh_category),
           cnh_expiry = COALESCE($7, cnh_expiry),
           position = COALESCE(NULLIF(position,''), 'Motorista'),
           worker_profile = COALESCE(worker_profile, 'operacional'),
           updated_at = NOW()
         WHERE id = $1`,
        [empId, b.full_name || null, b.phone || null, b.email || null,
         b.license_number || null, b.license_category || null, b.license_expires_at || null]
      );
      return empId;
    }

    // 2) cria novo colaborador mínimo
    const ins = await query(
      `INSERT INTO employees
         (organization_id, full_name, cpf, phone, email,
          cnh, cnh_category, cnh_expiry,
          position, worker_profile, employment_type, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Motorista','operacional','clt','ativo')
       RETURNING id`,
      [org, b.full_name, cpfDigits, b.phone || null, b.email || null,
       b.license_number || null, b.license_category || null, b.license_expires_at || null]
    );
    return ins.rows[0]?.id || null;
  } catch (e) {
    logError('sr.drivers.upsertRhEmployee', e);
    return null;
  }
}

router.post('/drivers', async (req, res) => {
  try {
    await query(`ALTER TABLE smartroute_drivers ADD COLUMN IF NOT EXISTS employee_id UUID`);
    const b = req.body || {};
    const org = orgId(req);
    const cpf = (b.cpf || '').replace(/\D/g, '') || null;
    const password = b.password || Math.random().toString(36).slice(2, 8);
    const hash = await bcrypt.hash(password, 10);

    // Espelha no RH (cria ou atualiza colaborador)
    const employeeId = await upsertRhEmployeeForDriver(org, b);

    const r = await query(
      `INSERT INTO smartroute_drivers (organization_id, employee_id, full_name, cpf, phone, email, license_number, license_category, license_expires_at, vehicle_id, password_hash, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,true)) RETURNING *`,
      [org, employeeId, b.full_name, cpf, b.phone, b.email, b.license_number, b.license_category, b.license_expires_at || null, b.vehicle_id || null, hash, b.active]
    );
    const { password_hash, ...safe } = r.rows[0];
    res.json({ ...safe, generated_password: b.password ? undefined : password, rh_synced: !!employeeId });
  } catch (e) { logError('sr.drivers.create', e); res.status(500).json({ error: e.message }); }
});
router.put('/drivers/:id', async (req, res) => {
  try {
    await query(`ALTER TABLE smartroute_drivers ADD COLUMN IF NOT EXISTS employee_id UUID`);
    const b = req.body || {};
    const org = orgId(req);
    let hash = null;
    if (b.password) hash = await bcrypt.hash(b.password, 10);

    // Garante espelho no RH também em edição
    const employeeId = await upsertRhEmployeeForDriver(org, b);

    const r = await query(
      `UPDATE smartroute_drivers SET full_name=COALESCE($3,full_name), cpf=COALESCE($4,cpf), phone=COALESCE($5,phone),
        email=COALESCE($6,email), license_number=COALESCE($7,license_number), license_category=COALESCE($8,license_category),
        license_expires_at=COALESCE($9,license_expires_at), vehicle_id=$10, active=COALESCE($11,active),
        password_hash=COALESCE($12,password_hash),
        employee_id=COALESCE(employee_id, $13),
        updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, org, b.full_name, (b.cpf || '').replace(/\D/g, '') || null, b.phone, b.email, b.license_number, b.license_category, b.license_expires_at || null, b.vehicle_id || null, b.active, hash, employeeId]
    );
    const { password_hash, ...safe } = r.rows[0] || {};
    res.json({ ...safe, rh_synced: !!employeeId });
  } catch (e) { logError('sr.drivers.update', e); res.status(500).json({ error: e.message }); }
});
router.delete('/drivers/:id', async (req, res) => {
  try { await query(`DELETE FROM smartroute_drivers WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ IMPORT DRIVERS FROM RH (employees) ============
// Lista colaboradores do RH com perfil de motorista que ainda não estão cadastrados no SmartRoute
router.get('/drivers/rh-candidates', async (req, res) => {
  try {
    await query(`ALTER TABLE smartroute_drivers ADD COLUMN IF NOT EXISTS employee_id UUID`);
    const org = orgId(req);
    const r = await query(
      `SELECT e.id, e.full_name, e.cpf, e.phone, e.email, e.position, e.worker_profile,
              e.cnh AS license_number, e.cnh_category AS license_category, e.cnh_expiry AS license_expires_at,
              e.status
         FROM employees e
        WHERE e.organization_id = $1
          AND COALESCE(e.status::text,'ativo') = 'ativo'
          AND (
            e.worker_profile::text ILIKE '%motorista%'
            OR LOWER(COALESCE(e.position,'')) LIKE '%motorista%'
            OR LOWER(COALESCE(e.position,'')) LIKE '%entregador%'
            OR LOWER(COALESCE(e.position,'')) LIKE '%driver%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM smartroute_drivers d
             WHERE d.organization_id = $1
               AND (
                 d.employee_id = e.id
                 OR (e.cpf IS NOT NULL AND REGEXP_REPLACE(COALESCE(d.cpf,''),'\\D','','g') = REGEXP_REPLACE(e.cpf,'\\D','','g'))
               )
          )
        ORDER BY e.full_name`,
      [org]
    );
    res.json(r.rows);
  } catch (e) { logError('sr.drivers.rh-candidates', e); res.status(500).json({ error: e.message }); }
});

// Importa colaboradores selecionados como motoristas SmartRoute
router.post('/drivers/import-rh', async (req, res) => {
  try {
    await query(`ALTER TABLE smartroute_drivers ADD COLUMN IF NOT EXISTS employee_id UUID`);
    const org = orgId(req);
    const ids = Array.isArray(req.body?.employee_ids) ? req.body.employee_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Selecione pelo menos um colaborador' });

    const emps = await query(
      `SELECT id, full_name, cpf, phone, email, cnh, cnh_category, cnh_expiry
         FROM employees WHERE organization_id=$1 AND id = ANY($2::uuid[])`,
      [org, ids]
    );

    const created = [];
    const credentials = [];
    for (const e of emps.rows) {
      const cpf = (e.cpf || '').replace(/\D/g, '') || null;
      const password = Math.random().toString(36).slice(2, 8);
      const hash = await bcrypt.hash(password, 10);
      try {
        const r = await query(
          `INSERT INTO smartroute_drivers
             (organization_id, employee_id, full_name, cpf, phone, email, license_number, license_category, license_expires_at, password_hash, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
           ON CONFLICT DO NOTHING
           RETURNING id, full_name`,
          [org, e.id, e.full_name, cpf, e.phone, e.email, e.cnh, e.cnh_category, e.cnh_expiry, hash]
        );
        if (r.rows[0]) {
          created.push(r.rows[0]);
          credentials.push({ full_name: e.full_name, cpf, password });
        }
      } catch (err) {
        logError('sr.drivers.import-rh.one', err, { employee_id: e.id });
      }
    }
    res.json({ imported: created.length, drivers: created, credentials });
  } catch (e) { logError('sr.drivers.import-rh', e); res.status(500).json({ error: e.message }); }
});

// ============ PDVs CRUD ============
router.get('/pdvs', async (req, res) => {
  try { const r = await query(`SELECT * FROM smartroute_pdvs WHERE organization_id=$1 ORDER BY name`, [orgId(req)]); res.json(r.rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/pdvs', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `INSERT INTO smartroute_pdvs (organization_id, name, cnpj, address, city, state, zip, lat, lng, contact_name, contact_phone, delivery_window_start, delivery_window_end, notes, active, delivery_window, allowed_weekdays, service_time_min, checklist_template_id, route_template_id, contacts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,true),COALESCE($16,'qualquer'),COALESCE($17,'{0,1,2,3,4,5,6}'::int[]),COALESCE($18,15),$19,$20,COALESCE($21::jsonb,'[]'::jsonb)) RETURNING *`,
      [orgId(req), b.name, b.cnpj, b.address, b.city, b.state, b.zip, b.lat, b.lng, b.contact_name, b.contact_phone, b.delivery_window_start, b.delivery_window_end, b.notes, b.active, b.delivery_window, b.allowed_weekdays, b.service_time_min, b.checklist_template_id, b.route_template_id || null, b.contacts ? JSON.stringify(b.contacts) : null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/pdvs/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_pdvs SET name=COALESCE($3,name), cnpj=COALESCE($4,cnpj), address=COALESCE($5,address),
        city=COALESCE($6,city), state=COALESCE($7,state), zip=COALESCE($8,zip), lat=$9, lng=$10,
        contact_name=COALESCE($11,contact_name), contact_phone=COALESCE($12,contact_phone),
        delivery_window_start=$13, delivery_window_end=$14, notes=COALESCE($15,notes), active=COALESCE($16,active),
        delivery_window=COALESCE($17,delivery_window), allowed_weekdays=COALESCE($18,allowed_weekdays),
        service_time_min=COALESCE($19,service_time_min), checklist_template_id=$20, route_template_id=$21,
        contacts=COALESCE($22::jsonb, contacts), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.name, b.cnpj, b.address, b.city, b.state, b.zip, b.lat, b.lng, b.contact_name, b.contact_phone, b.delivery_window_start, b.delivery_window_end, b.notes, b.active, b.delivery_window, b.allowed_weekdays, b.service_time_min, b.checklist_template_id, b.route_template_id || null, b.contacts ? JSON.stringify(b.contacts) : null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/pdvs/:id', async (req, res) => {
  try { await query(`DELETE FROM smartroute_pdvs WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});


// ============ ORDERS CRUD ============
router.get('/orders', async (req, res) => {
  try {
    const { status, date } = req.query;
    const conds = ['o.organization_id=$1'];
    const params = [orgId(req)];
    if (status) { params.push(status); conds.push(`o.status=$${params.length}`); }
    if (date) { params.push(date); conds.push(`o.delivery_date=$${params.length}`); }
    const r = await query(
      `SELECT o.*, p.name AS pdv_name, p.address AS pdv_address, p.lat AS pdv_lat, p.lng AS pdv_lng
       FROM smartroute_orders o LEFT JOIN smartroute_pdvs p ON p.id=o.pdv_id
       WHERE ${conds.join(' AND ')} ORDER BY o.delivery_date NULLS LAST, o.priority DESC, o.created_at DESC LIMIT 500`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/orders', async (req, res) => {
  try {
    const b = req.body || {};
    let pdv_window = b.pdv_window || null;
    if (b.route_id && b.pdv_id && !pdv_window) {
      const w = await query(`SELECT delivery_window FROM smartroute_route_pdvs WHERE route_id=$1 AND pdv_id=$2`, [b.route_id, b.pdv_id]);
      pdv_window = w.rows[0]?.delivery_window || 'qualquer';
    }
    const r = await query(
      `INSERT INTO smartroute_orders (organization_id, pdv_id, order_number, weight_kg, volume_m3, value_cents, items, priority, delivery_date, status, notes, route_id, pdv_window, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'pendente'),$11,$12,$13,$14) RETURNING *`,
      [orgId(req), b.pdv_id, b.order_number, b.weight_kg || 0, b.volume_m3 || 0, b.value_cents || 0, JSON.stringify(b.items || []), b.priority || 5, b.delivery_date || null, b.status, b.notes, b.route_id || null, pdv_window, req.user?.id || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/orders/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_orders SET pdv_id=COALESCE($3,pdv_id), order_number=COALESCE($4,order_number),
        weight_kg=COALESCE($5,weight_kg), volume_m3=COALESCE($6,volume_m3), value_cents=COALESCE($7,value_cents),
        items=COALESCE($8,items), priority=COALESCE($9,priority), delivery_date=$10,
        status=COALESCE($11,status), notes=COALESCE($12,notes),
        route_id=COALESCE($13,route_id), pdv_window=COALESCE($14,pdv_window), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.pdv_id, b.order_number, b.weight_kg, b.volume_m3, b.value_cents, b.items ? JSON.stringify(b.items) : null, b.priority, b.delivery_date || null, b.status, b.notes, b.route_id || null, b.pdv_window || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/orders/:id', async (req, res) => {
  try { await query(`DELETE FROM smartroute_orders WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ ROUTES CRUD + STOPS ============
router.get('/routes', async (req, res) => {
  try {
    const { date, status } = req.query;
    const conds = ['r.organization_id=$1']; const params = [orgId(req)];
    if (date) { params.push(date); conds.push(`r.planned_date=$${params.length}`); }
    if (status) { params.push(status); conds.push(`r.status=$${params.length}`); }
    const r = await query(
      `SELECT r.*, d.full_name AS driver_name, v.plate AS vehicle_plate
       FROM smartroute_routes r
       LEFT JOIN smartroute_drivers d ON d.id=r.driver_id
       LEFT JOIN smartroute_vehicles v ON v.id=r.vehicle_id
       WHERE ${conds.join(' AND ')} ORDER BY r.planned_date DESC, r.created_at DESC LIMIT 300`, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/routes/:id', async (req, res) => {
  try {
    const org = orgId(req);
    const r = await query(
      `SELECT r.*, d.full_name AS driver_name, d.phone AS driver_phone, v.plate AS vehicle_plate, v.model AS vehicle_model
       FROM smartroute_routes r
       LEFT JOIN smartroute_drivers d ON d.id=r.driver_id
       LEFT JOIN smartroute_vehicles v ON v.id=r.vehicle_id
       WHERE r.id=$1 AND r.organization_id=$2`, [req.params.id, org]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const stops = await query(
      `SELECT s.*, p.name AS pdv_name, p.address AS pdv_address, p.lat AS pdv_lat, p.lng AS pdv_lng,
              o.order_number, o.weight_kg, o.volume_m3, o.value_cents, o.items
       FROM smartroute_route_stops s
       LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
       LEFT JOIN smartroute_orders o ON o.id=s.order_id
       WHERE s.route_id=$1 ORDER BY s.sequence`, [req.params.id]);
    res.json({ ...r.rows[0], stops: stops.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/routes', async (req, res) => {
  try {
    const b = req.body || {};
    const code = b.code || `R-${Date.now().toString(36).toUpperCase()}`;
    let { depot_lat, depot_lng } = b;
    let depotId = b.depot_id || null;
    if (!depotId && (depot_lat == null || depot_lng == null)) {
      const d = await query(`SELECT id, lat, lng FROM smartroute_depots WHERE organization_id=$1 AND is_default=true AND active=true LIMIT 1`, [orgId(req)]);
      if (d.rows[0]) { depotId = d.rows[0].id; depot_lat = d.rows[0].lat; depot_lng = d.rows[0].lng; }
    } else if (depotId) {
      const d = await query(`SELECT lat, lng FROM smartroute_depots WHERE id=$1 AND organization_id=$2`, [depotId, orgId(req)]);
      if (d.rows[0]) { depot_lat = d.rows[0].lat; depot_lng = d.rows[0].lng; }
    }
    const r = await query(
      `INSERT INTO smartroute_routes (organization_id, code, driver_id, vehicle_id, planned_date, status, depot_lat, depot_lng, depot_id, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'planejada',$6,$7,$8,$9) RETURNING *`,
      [orgId(req), code, b.driver_id || null, b.vehicle_id || null, b.planned_date || null, depot_lat, depot_lng, depotId, b.notes]
    );
    const route = r.rows[0];

    // Add stops from order_ids
    if (Array.isArray(b.order_ids) && b.order_ids.length) {
      const ords = await query(
        `SELECT id, pdv_id FROM smartroute_orders WHERE organization_id=$1 AND id = ANY($2::uuid[])`,
        [orgId(req), b.order_ids]
      );
      for (let i = 0; i < ords.rows.length; i++) {
        const o = ords.rows[i];
        const st = await query(
          `INSERT INTO smartroute_route_stops (route_id, order_id, pdv_id, sequence) VALUES ($1,$2,$3,$4) RETURNING id`,
          [route.id, o.id, o.pdv_id, i + 1]
        );
        await query(`UPDATE smartroute_orders SET status='em_rota', route_stop_id=$2, updated_at=NOW() WHERE id=$1`, [o.id, st.rows[0].id]);
      }
      await query(`UPDATE smartroute_routes SET total_stops=$2 WHERE id=$1`, [route.id, ords.rows.length]);
    }
    res.json(route);
  } catch (e) { logError('smartroute.createRoute', e); res.status(500).json({ error: e.message }); }
});
router.put('/routes/:id', async (req, res) => {
  try {
    const b = req.body || {};
    let depotLat = b.depot_lat;
    let depotLng = b.depot_lng;
    let depotId = b.depot_id || null;
    if (depotId) {
      const d = await query(`SELECT lat, lng FROM smartroute_depots WHERE id=$1 AND organization_id=$2 AND active=true`, [depotId, orgId(req)]);
      if (d.rows[0]) { depotLat = d.rows[0].lat; depotLng = d.rows[0].lng; }
    }
    const r = await query(
      `UPDATE smartroute_routes SET driver_id=$3, vehicle_id=$4, planned_date=COALESCE($5,planned_date),
        status=COALESCE($6,status), depot_lat=COALESCE($7,depot_lat), depot_lng=COALESCE($8,depot_lng), notes=COALESCE($9,notes),
        default_driver_id=COALESCE($10,default_driver_id), default_vehicle_id=COALESCE($11,default_vehicle_id),
        upsell_time_min=COALESCE($12,upsell_time_min), depot_id=COALESCE($13,depot_id), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.driver_id || null, b.vehicle_id || null, b.planned_date || null, b.status, depotLat, depotLng, b.notes,
       b.default_driver_id ?? null, b.default_vehicle_id ?? null,
       (b.upsell_time_min === undefined || b.upsell_time_min === null || b.upsell_time_min === '') ? null : +b.upsell_time_min,
       depotId]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/routes/:id', async (req, res) => {
  try {
    await query(`UPDATE smartroute_orders SET status='pendente', route_stop_id=NULL WHERE route_stop_id IN (SELECT id FROM smartroute_route_stops WHERE route_id=$1)`, [req.params.id]);
    await query(`DELETE FROM smartroute_routes WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Simple nearest-neighbor optimizer
router.post('/routes/:id/optimize', async (req, res) => {
  try {
    const org = orgId(req);
    const r = await query(`SELECT * FROM smartroute_routes WHERE id=$1 AND organization_id=$2`, [req.params.id, org]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    const route = r.rows[0];
    const stops = await query(
      `SELECT s.id, s.pdv_id, p.lat, p.lng FROM smartroute_route_stops s
       LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id WHERE s.route_id=$1`, [req.params.id]);
    const pts = stops.rows.filter((s) => s.lat != null && s.lng != null);
    const d = (a, b) => { const dx = a.lat - b.lat, dy = a.lng - b.lng; return Math.sqrt(dx * dx + dy * dy); };
    let cur = { lat: route.depot_lat ?? pts[0]?.lat, lng: route.depot_lng ?? pts[0]?.lng };
    const remaining = [...pts]; const order = [];
    while (remaining.length) {
      remaining.sort((a, b) => d(cur, a) - d(cur, b));
      const next = remaining.shift(); order.push(next); cur = next;
    }
    for (let i = 0; i < order.length; i++) {
      await query(`UPDATE smartroute_route_stops SET sequence=$2, updated_at=NOW() WHERE id=$1`, [order[i].id, i + 1]);
    }
    res.json({ ok: true, sequenced: order.length });
  } catch (e) { logError('smartroute.optimize', e); res.status(500).json({ error: e.message }); }
});

// Adiciona pedidos pendentes como novas paradas ao final de uma rota já criada
router.post('/routes/:id/stops', async (req, res) => {
  try {
    const org = orgId(req);
    const { order_ids } = req.body || {};
    if (!Array.isArray(order_ids) || !order_ids.length) return res.status(400).json({ error: 'Informe order_ids' });

    const route = await query(`SELECT id FROM smartroute_routes WHERE id=$1 AND organization_id=$2`, [req.params.id, org]);
    if (!route.rows[0]) return res.status(404).json({ error: 'Rota não encontrada' });

    const maxSeq = await query(`SELECT COALESCE(MAX(sequence), 0) AS max FROM smartroute_route_stops WHERE route_id=$1`, [req.params.id]);
    let seq = maxSeq.rows[0].max;

    const ords = await query(`SELECT id, pdv_id FROM smartroute_orders WHERE organization_id=$1 AND id = ANY($2::uuid[]) AND status='pendente'`, [org, order_ids]);
    if (!ords.rows.length) return res.status(400).json({ error: 'Nenhum pedido pendente encontrado para esses IDs' });

    for (const o of ords.rows) {
      seq++;
      const st = await query(`INSERT INTO smartroute_route_stops (route_id, order_id, pdv_id, sequence) VALUES ($1,$2,$3,$4) RETURNING id`, [req.params.id, o.id, o.pdv_id, seq]);
      await query(`UPDATE smartroute_orders SET status='em_rota', route_stop_id=$2, updated_at=NOW() WHERE id=$1`, [o.id, st.rows[0].id]);
    }
    await query(`UPDATE smartroute_routes SET total_stops=(SELECT COUNT(*) FROM smartroute_route_stops WHERE route_id=$1) WHERE id=$1`, [req.params.id]);

    res.json({ ok: true, added: ords.rows.length });
  } catch (e) { logError('smartroute.addStops', e); res.status(500).json({ error: e.message }); }
});

// Reordena manualmente as paradas de uma rota (prioridade) — body: { stop_ids: [ordem desejada] }
router.put('/routes/:id/stops/reorder', async (req, res) => {
  try {
    const org = orgId(req);
    const { stop_ids } = req.body || {};
    if (!Array.isArray(stop_ids) || !stop_ids.length) return res.status(400).json({ error: 'Informe stop_ids' });

    const route = await query(`SELECT id FROM smartroute_routes WHERE id=$1 AND organization_id=$2`, [req.params.id, org]);
    if (!route.rows[0]) return res.status(404).json({ error: 'Rota não encontrada' });

    for (let i = 0; i < stop_ids.length; i++) {
      await query(`UPDATE smartroute_route_stops SET sequence=$2, updated_at=NOW() WHERE id=$1 AND route_id=$3`, [stop_ids[i], i + 1, req.params.id]);
    }
    res.json({ ok: true, reordered: stop_ids.length });
  } catch (e) { logError('smartroute.reorderStops', e); res.status(500).json({ error: e.message }); }
});

// Remove uma parada da rota — o pedido volta para 'pendente' e pode ser realocado depois
router.delete('/routes/:id/stops/:stopId', async (req, res) => {
  try {
    const org = orgId(req);
    const route = await query(`SELECT id FROM smartroute_routes WHERE id=$1 AND organization_id=$2`, [req.params.id, org]);
    if (!route.rows[0]) return res.status(404).json({ error: 'Rota não encontrada' });

    const stop = await query(`SELECT order_id FROM smartroute_route_stops WHERE id=$1 AND route_id=$2`, [req.params.stopId, req.params.id]);
    if (!stop.rows[0]) return res.status(404).json({ error: 'Parada não encontrada' });

    await query(`UPDATE smartroute_orders SET status='pendente', route_stop_id=NULL, updated_at=NOW() WHERE id=$1`, [stop.rows[0].order_id]);
    await query(`DELETE FROM smartroute_route_stops WHERE id=$1`, [req.params.stopId]);

    const rest = await query(`SELECT id FROM smartroute_route_stops WHERE route_id=$1 ORDER BY sequence`, [req.params.id]);
    for (let i = 0; i < rest.rows.length; i++) {
      await query(`UPDATE smartroute_route_stops SET sequence=$2 WHERE id=$1`, [rest.rows[i].id, i + 1]);
    }
    await query(`UPDATE smartroute_routes SET total_stops=$2 WHERE id=$1`, [req.params.id, rest.rows.length]);

    res.json({ ok: true });
  } catch (e) { logError('smartroute.removeStop', e); res.status(500).json({ error: e.message }); }
});

// Route events (timeline)
router.get('/routes/:id/events', async (req, res) => {
  try {
    const r = await query(
      `SELECT e.*, d.full_name AS driver_name FROM smartroute_events e
       LEFT JOIN smartroute_drivers d ON d.id=e.driver_id
       WHERE e.route_id=$1 AND e.organization_id=$2 ORDER BY e.created_at DESC LIMIT 200`,
      [req.params.id, orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Route replay — geo-tagged events chronological + stops
router.get('/routes/:id/replay', async (req, res) => {
  try {
    const org = orgId(req);
    const route = await query(
      `SELECT r.*, d.full_name AS driver_name, v.plate AS vehicle_plate
       FROM smartroute_routes r
       LEFT JOIN smartroute_drivers d ON d.id=r.driver_id
       LEFT JOIN smartroute_vehicles v ON v.id=r.vehicle_id
       WHERE r.id=$1 AND r.organization_id=$2`, [req.params.id, org]);
    if (!route.rows[0]) return res.status(404).json({ error: 'not found' });
    const events = await query(
      `SELECT event_type, event_data, lat, lng, created_at FROM smartroute_events
       WHERE route_id=$1 AND organization_id=$2 ORDER BY created_at`, [req.params.id, org]);
    const stops = await query(
      `SELECT s.id, s.sequence, s.status, s.arrived_at, s.departed_at, s.checkin_lat, s.checkin_lng,
              s.checkout_lat, s.checkout_lng, s.receiver_name, p.name AS pdv_name, p.lat AS pdv_lat, p.lng AS pdv_lng
       FROM smartroute_route_stops s LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
       WHERE s.route_id=$1 ORDER BY s.sequence`, [req.params.id]);
    res.json({ route: route.rows[0], events: events.rows, stops: stops.rows });
  } catch (e) { logError('smartroute.replay', e); res.status(500).json({ error: e.message }); }
});

// Alerts table (shared with geofence + AI scanner)
export async function ensureSRAlerts() {
  await query(`
    CREATE TABLE IF NOT EXISTS smartroute_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL,
      route_id UUID REFERENCES smartroute_routes(id) ON DELETE CASCADE,
      driver_id UUID REFERENCES smartroute_drivers(id) ON DELETE SET NULL,
      severity TEXT DEFAULT 'medium',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      dedupe_key TEXT UNIQUE,
      resolved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

router.get('/alerts', async (req, res) => {
  try { await ensureSRAlerts();
    const r = await query(`SELECT * FROM smartroute_alerts WHERE organization_id=$1 AND resolved=false ORDER BY created_at DESC LIMIT 100`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/alerts/:id/resolve', async (req, res) => {
  try { await query(`UPDATE smartroute_alerts SET resolved=true WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Webhook token (import orders)
router.get('/webhook-token', async (req, res) => {
  try {
    const org = orgId(req);
    await query(`CREATE TABLE IF NOT EXISTS smartroute_org_settings (organization_id UUID PRIMARY KEY, webhook_token TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    let r = await query(`SELECT webhook_token FROM smartroute_org_settings WHERE organization_id=$1`, [org]);
    if (!r.rows[0]) {
      const crypto = await import('crypto');
      const t = crypto.randomBytes(24).toString('hex');
      r = await query(`INSERT INTO smartroute_org_settings (organization_id, webhook_token) VALUES ($1,$2) RETURNING webhook_token`, [org, t]);
    }
    res.json({ token: r.rows[0].webhook_token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/webhook-token/rotate', async (req, res) => {
  try {
    const org = orgId(req);
    const crypto = await import('crypto');
    const t = crypto.randomBytes(24).toString('hex');
    await query(`CREATE TABLE IF NOT EXISTS smartroute_org_settings (organization_id UUID PRIMARY KEY, webhook_token TEXT UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(
      `INSERT INTO smartroute_org_settings (organization_id, webhook_token) VALUES ($1,$2)
       ON CONFLICT (organization_id) DO UPDATE SET webhook_token=EXCLUDED.webhook_token, updated_at=NOW()`, [org, t]);
    res.json({ token: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ensure tracking token for a specific order
router.post('/orders/:id/tracking-token', async (req, res) => {
  try {
    const crypto = await import('crypto');
    const t = crypto.randomBytes(16).toString('hex');
    await query(`ALTER TABLE smartroute_orders ADD COLUMN IF NOT EXISTS tracking_token TEXT UNIQUE`);
    const r = await query(
      `UPDATE smartroute_orders SET tracking_token=COALESCE(tracking_token,$3)
       WHERE id=$1 AND organization_id=$2 RETURNING tracking_token`,
      [req.params.id, orgId(req), t]);
    res.json({ token: r.rows[0]?.tracking_token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Configurações da Operação (Fluxo Inteligente) ============
router.get('/operation-settings', async (req, res) => {
  try {
    const { getOperationSettings } = await import('../lib/sr-journey.js');
    res.json(await getOperationSettings(orgId(req)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/operation-settings', async (req, res) => {
  try {
    const { upsertOperationSettings } = await import('../lib/sr-journey.js');
    res.json(await upsertOperationSettings(orgId(req), req.body || {}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ CHECKLISTS CONFIGURÁVEIS (Onda 2) ============
router.get('/checklist-templates', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, (SELECT COUNT(*) FROM smartroute_checklist_template_items i WHERE i.template_id=t.id)::int AS items_count
       FROM smartroute_checklist_templates t
       WHERE t.organization_id=$1 ORDER BY t.priority ASC, t.name ASC`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/checklist-templates/:id', async (req, res) => {
  try {
    const t = await query(
      `SELECT * FROM smartroute_checklist_templates WHERE id=$1 AND organization_id=$2`,
      [req.params.id, orgId(req)]);
    if (!t.rows[0]) return res.status(404).json({ error: 'not found' });
    const items = await query(
      `SELECT * FROM smartroute_checklist_template_items WHERE template_id=$1 ORDER BY seq ASC`,
      [req.params.id]);
    const assigns = await query(
      `SELECT * FROM smartroute_checklist_assignments WHERE template_id=$1 AND organization_id=$2`,
      [req.params.id, orgId(req)]);
    res.json({ ...t.rows[0], items: items.rows, assignments: assigns.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/checklist-templates', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `INSERT INTO smartroute_checklist_templates (organization_id, name, description, active, priority)
       VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,100)) RETURNING *`,
      [orgId(req), b.name, b.description || null, b.active, b.priority]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/checklist-templates/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_checklist_templates
         SET name=COALESCE($3,name), description=COALESCE($4,description),
             active=COALESCE($5,active), priority=COALESCE($6,priority), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.name, b.description, b.active, b.priority]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/checklist-templates/:id', async (req, res) => {
  try {
    await query(`DELETE FROM smartroute_checklist_templates WHERE id=$1 AND organization_id=$2`,
      [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Substitui todos os itens do template (edição em lote)
router.put('/checklist-templates/:id/items', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    await query(`DELETE FROM smartroute_checklist_template_items WHERE template_id=$1`, [req.params.id]);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await query(
        `INSERT INTO smartroute_checklist_template_items
           (template_id, seq, field_type, label, required, config)
         VALUES ($1,$2,$3,$4,COALESCE($5,true),$6)`,
        [req.params.id, i + 1, it.field_type, it.label, it.required,
          JSON.stringify(it.config || {})]);
    }
    res.json({ ok: true, count: items.length });
  } catch (e) { logError('sr.checklist.items.put', e); res.status(500).json({ error: e.message }); }
});

router.get('/checklist-assignments', async (req, res) => {
  try {
    const r = await query(
      `SELECT a.*, t.name AS template_name
       FROM smartroute_checklist_assignments a
       JOIN smartroute_checklist_templates t ON t.id=a.template_id
       WHERE a.organization_id=$1 ORDER BY a.priority ASC`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/checklist-assignments', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `INSERT INTO smartroute_checklist_assignments
         (organization_id, template_id, scope, priority, active)
       VALUES ($1,$2,$3,COALESCE($4,100),COALESCE($5,true)) RETURNING *`,
      [orgId(req), b.template_id, JSON.stringify(b.scope || {}), b.priority, b.active]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/checklist-assignments/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_checklist_assignments
         SET scope=COALESCE($3,scope), priority=COALESCE($4,priority), active=COALESCE($5,active)
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.scope ? JSON.stringify(b.scope) : null, b.priority, b.active]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/checklist-assignments/:id', async (req, res) => {
  try {
    await query(`DELETE FROM smartroute_checklist_assignments WHERE id=$1 AND organization_id=$2`,
      [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ REPLAY ENRIQUECIDO (Onda 3) ============
router.get('/routes/:id/journey-events', async (req, res) => {
  try {
    const r = await query(
      `SELECT e.*, s.sequence AS stop_seq, p.name AS pdv_name
       FROM smartroute_journey_events e
       LEFT JOIN smartroute_route_stops s ON s.id=e.stop_id
       LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
       WHERE e.route_id=$1 AND e.organization_id=$2
       ORDER BY e.created_at ASC`, [req.params.id, orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ MÉTRICAS OPERACIONAIS (Onda 3) ============
router.get('/ops-metrics', async (req, res) => {
  try {
    const org = orgId(req);
    const today = new Date().toISOString().slice(0, 10);
    const avg = await query(
      `SELECT AVG(duration_ms)::bigint AS avg_ms, COUNT(*)::int AS n
       FROM smartroute_route_stops s
       JOIN smartroute_routes r ON r.id=s.route_id
       WHERE r.organization_id=$1 AND s.duration_ms IS NOT NULL
         AND r.planned_date >= CURRENT_DATE - INTERVAL '7 days'`, [org]);
    const byState = await query(
      `SELECT state, COUNT(*)::int AS n FROM smartroute_route_stops s
       JOIN smartroute_routes r ON r.id=s.route_id
       WHERE r.organization_id=$1 AND r.planned_date=$2
       GROUP BY state`, [org, today]);
    const occ = await query(
      `SELECT type, COUNT(*)::int AS n FROM smartroute_stop_occurrences
       WHERE organization_id=$1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY type ORDER BY n DESC LIMIT 10`, [org]);
    const failedItems = await query(
      `SELECT i.label, COUNT(*)::int AS n
       FROM smartroute_checklist_template_items i
       LEFT JOIN smartroute_stop_checklist_responses r ON r.item_id=i.id
       WHERE i.required=true AND r.id IS NULL
       GROUP BY i.label ORDER BY n DESC LIMIT 5`);
    res.json({
      avg_stop_ms: avg.rows[0]?.avg_ms || 0,
      stops_today_by_state: byState.rows,
      occurrences_7d: occ.rows,
      checklist_gaps: failedItems.rows,
    });
  } catch (e) { logError('sr.ops-metrics', e); res.status(500).json({ error: e.message }); }
});

// ============ TORRE DE CONTROLE AO VIVO (Onda 3) ============
// Snapshot consolidado: motoristas, paradas ativas, alertas de atraso/GPS, feed de eventos.
router.get('/monitor', async (req, res) => {
  try {
    const org = orgId(req);
    const today = new Date().toISOString().slice(0, 10);
    const staleGpsMin = Number(req.query.stale_gps_min) || 5;
    const stopSlaMin = Number(req.query.stop_sla_min) || 30;
    const routeSlaHrs = Number(req.query.route_sla_hrs) || 12;

    const [drivers, activeStops, events, kpis] = await Promise.all([
      query(
        `SELECT d.id, d.full_name, d.current_lat, d.current_lng, d.current_status, d.last_location_at,
                v.plate, v.model,
                r.id AS route_id, r.code AS route_code, r.status AS route_status,
                r.started_at, r.completed_stops, r.total_stops,
                EXTRACT(EPOCH FROM (NOW() - d.last_location_at))::int AS gps_age_sec,
                EXTRACT(EPOCH FROM (NOW() - r.started_at))::int AS route_age_sec
         FROM smartroute_drivers d
         LEFT JOIN smartroute_vehicles v ON v.id=d.vehicle_id
         LEFT JOIN smartroute_routes r ON r.driver_id=d.id AND r.planned_date=$2 AND r.status IN ('em_andamento','planejada')
         WHERE d.organization_id=$1 AND d.active=true
         ORDER BY (d.current_status='em_rota') DESC, d.full_name`,
        [org, today]
      ),
      query(
        `SELECT s.id, s.sequence, s.state, s.status, s.arrived_at,
                EXTRACT(EPOCH FROM (NOW() - s.arrived_at))::int AS elapsed_sec,
                p.name AS pdv_name, p.address AS pdv_address, p.city AS pdv_city,
                r.id AS route_id, r.code AS route_code,
                d.full_name AS driver_name
         FROM smartroute_route_stops s
         JOIN smartroute_routes r ON r.id=s.route_id
         LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
         LEFT JOIN smartroute_drivers d ON d.id=r.driver_id
         WHERE r.organization_id=$1 AND s.state='em_atendimento'
         ORDER BY s.arrived_at ASC NULLS LAST`,
        [org]
      ),
      query(
        `SELECT e.id, e.event_type, e.created_at, e.payload, e.lat, e.lng,
                r.code AS route_code, d.full_name AS driver_name,
                s.sequence AS stop_seq, p.name AS pdv_name
         FROM smartroute_journey_events e
         LEFT JOIN smartroute_routes r ON r.id=e.route_id
         LEFT JOIN smartroute_drivers d ON d.id=e.driver_id
         LEFT JOIN smartroute_route_stops s ON s.id=e.stop_id
         LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
         WHERE e.organization_id=$1 AND e.created_at >= NOW() - INTERVAL '6 hours'
         ORDER BY e.created_at DESC
         LIMIT 60`,
        [org]
      ),
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM smartroute_drivers WHERE organization_id=$1 AND current_status='em_rota' AND active=true) AS drivers_em_rota,
           (SELECT COUNT(*)::int FROM smartroute_route_stops s JOIN smartroute_routes r ON r.id=s.route_id WHERE r.organization_id=$1 AND s.state='em_atendimento') AS stops_em_atendimento,
           (SELECT COUNT(*)::int FROM smartroute_route_stops s JOIN smartroute_routes r ON r.id=s.route_id WHERE r.organization_id=$1 AND r.planned_date=$2 AND s.status='concluida') AS stops_concluidas_hoje,
           (SELECT COUNT(*)::int FROM smartroute_route_stops s JOIN smartroute_routes r ON r.id=s.route_id WHERE r.organization_id=$1 AND r.planned_date=$2 AND s.status='nao_entregue') AS stops_nao_entregues_hoje,
           (SELECT COUNT(*)::int FROM smartroute_stop_occurrences WHERE organization_id=$1 AND created_at::date=$2) AS occ_hoje`,
        [org, today]
      ),
    ]);

    const alerts = [];
    for (const s of activeStops.rows) {
      if ((s.elapsed_sec || 0) >= stopSlaMin * 60) {
        alerts.push({
          type: 'stop_slow',
          severity: s.elapsed_sec >= stopSlaMin * 120 ? 'high' : 'medium',
          driver_name: s.driver_name, route_code: s.route_code,
          pdv_name: s.pdv_name, stop_id: s.id, route_id: s.route_id,
          message: `Parada em atendimento há ${Math.round(s.elapsed_sec / 60)} min`,
          elapsed_sec: s.elapsed_sec,
        });
      }
    }
    for (const d of drivers.rows) {
      if (d.current_status === 'em_rota' && d.gps_age_sec != null && d.gps_age_sec >= staleGpsMin * 60) {
        alerts.push({
          type: 'stale_gps', severity: d.gps_age_sec >= staleGpsMin * 180 ? 'high' : 'medium',
          driver_name: d.full_name, route_code: d.route_code,
          message: `Sem sinal GPS há ${Math.round(d.gps_age_sec / 60)} min`,
          driver_id: d.id, route_id: d.route_id, elapsed_sec: d.gps_age_sec,
        });
      }
      if (d.route_age_sec != null && d.route_age_sec >= routeSlaHrs * 3600 && d.route_status === 'em_andamento') {
        alerts.push({
          type: 'route_overtime', severity: 'high',
          driver_name: d.full_name, route_code: d.route_code,
          message: `Jornada em andamento há ${(d.route_age_sec / 3600).toFixed(1)}h sem finalizar`,
          driver_id: d.id, route_id: d.route_id, elapsed_sec: d.route_age_sec,
        });
      }
    }
    alerts.sort((a, b) => (b.severity === 'high' ? 1 : 0) - (a.severity === 'high' ? 1 : 0) || (b.elapsed_sec || 0) - (a.elapsed_sec || 0));

    res.json({
      generated_at: new Date().toISOString(),
      thresholds: { stale_gps_min: staleGpsMin, stop_sla_min: stopSlaMin, route_sla_hrs: routeSlaHrs },
      kpis: kpis.rows[0] || {},
      drivers: drivers.rows,
      active_stops: activeStops.rows,
      alerts,
      recent_events: events.rows,
    });
  } catch (e) { logError('sr.monitor', e); res.status(500).json({ error: e.message }); }
});

// ============ DETALHES DE UMA PARADA (para Replay/Torre) ============
router.get('/stops/:id/summary', async (req, res) => {
  try {
    const org = orgId(req);
    const [stop, checklist, media, occ, ocr] = await Promise.all([
      query(
        `SELECT s.*, p.name AS pdv_name, p.address AS pdv_address, p.city AS pdv_city,
                p.lat AS pdv_lat, p.lng AS pdv_lng,
                r.code AS route_code, d.full_name AS driver_name
         FROM smartroute_route_stops s
         JOIN smartroute_routes r ON r.id=s.route_id
         LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
         LEFT JOIN smartroute_drivers d ON d.id=r.driver_id
         WHERE s.id=$1 AND r.organization_id=$2`, [req.params.id, org]),
      query(
        `SELECT r.*, i.label, i.kind, i.required
         FROM smartroute_stop_checklist_responses r
         JOIN smartroute_checklist_template_items i ON i.id=r.item_id
         WHERE r.stop_id=$1 ORDER BY i.seq ASC`, [req.params.id]),
      query(
        `SELECT id, kind, url, created_at FROM smartroute_stop_media
         WHERE stop_id=$1 ORDER BY created_at ASC`, [req.params.id]),
      query(
        `SELECT * FROM smartroute_stop_occurrences WHERE stop_id=$1 ORDER BY created_at ASC`, [req.params.id]),
      query(
        `SELECT * FROM smartroute_stop_ocr_results WHERE stop_id=$1 ORDER BY created_at ASC`, [req.params.id]),
    ]);
    if (!stop.rows[0]) return res.status(404).json({ error: 'Parada não encontrada' });
    res.json({
      stop: stop.rows[0],
      checklist: checklist.rows,
      media: media.rows,
      occurrences: occ.rows,
      ocr: ocr.rows,
    });
  } catch (e) { logError('sr.stop.summary', e); res.status(500).json({ error: e.message }); }
});


// ============ ONDA 4 — OCORRÊNCIAS & SLA ============

// Seed default types for org if empty
async function ensureDefaultOccurrenceTypes(org) {
  const r = await query(`SELECT COUNT(*)::int AS n FROM smartroute_occurrence_types WHERE organization_id=$1`, [org]);
  if ((r.rows[0]?.n || 0) > 0) return;
  const seeds = [
    ['danificado', 'Produto danificado', 'high', 120, true, true, true, '#ef4444'],
    ['vencido', 'Produto vencido', 'high', 60, true, true, true, '#dc2626'],
    ['recusado', 'Recusa de recebimento', 'medium', 60, true, true, false, '#f59e0b'],
    ['cliente_ausente', 'Cliente ausente', 'medium', 30, true, false, false, '#f97316'],
    ['cliente_fechado', 'Estabelecimento fechado', 'medium', 30, true, false, false, '#f97316'],
    ['divergencia_nota', 'Divergência na nota fiscal', 'high', 90, true, true, true, '#dc2626'],
    ['avaria_transporte', 'Avaria em transporte', 'high', 120, true, true, false, '#b91c1c'],
    ['atraso', 'Atraso na entrega', 'low', 240, false, true, false, '#eab308'],
    ['equipamento', 'Problema com equipamento (freezer/rack)', 'medium', 180, true, true, false, '#8b5cf6'],
    ['outro', 'Outro', 'low', 240, false, true, false, '#6b7280'],
  ];
  for (const [code, label, severity, sla, ph, desc, blocks, color] of seeds) {
    await query(
      `INSERT INTO smartroute_occurrence_types
         (organization_id, code, label, severity, sla_target_min, require_photo, require_description, blocks_checkout, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (organization_id, code) DO NOTHING`,
      [org, code, label, severity, sla, ph, desc, blocks, color]);
  }
}

// ----- Catálogo de tipos
router.get('/occurrence-types', async (req, res) => {
  try {
    const org = orgId(req);
    await ensureDefaultOccurrenceTypes(org);
    const r = await query(
      `SELECT * FROM smartroute_occurrence_types WHERE organization_id=$1 ORDER BY active DESC, label`, [org]);
    res.json(r.rows);
  } catch (e) { logError('sr.occ-types.list', e); res.status(500).json({ error: e.message }); }
});

router.post('/occurrence-types', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.code || !b.label) return res.status(400).json({ error: 'code e label são obrigatórios' });
    const r = await query(
      `INSERT INTO smartroute_occurrence_types
        (organization_id, code, label, description, severity, sla_target_min, require_photo, require_description, blocks_checkout, color, icon, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,true))
       RETURNING *`,
      [orgId(req), b.code, b.label, b.description || null, b.severity || 'medium',
       b.sla_target_min ?? 60, b.require_photo ?? true, b.require_description ?? true,
       b.blocks_checkout ?? false, b.color || '#f59e0b', b.icon || 'alert-triangle', b.active]);
    res.json(r.rows[0]);
  } catch (e) { logError('sr.occ-types.create', e); res.status(500).json({ error: e.message }); }
});

router.put('/occurrence-types/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_occurrence_types SET
         label=COALESCE($3,label), description=COALESCE($4,description),
         severity=COALESCE($5,severity), sla_target_min=COALESCE($6,sla_target_min),
         require_photo=COALESCE($7,require_photo), require_description=COALESCE($8,require_description),
         blocks_checkout=COALESCE($9,blocks_checkout), color=COALESCE($10,color),
         icon=COALESCE($11,icon), active=COALESCE($12,active), updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.label, b.description, b.severity, b.sla_target_min,
       b.require_photo, b.require_description, b.blocks_checkout, b.color, b.icon, b.active]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Tipo não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { logError('sr.occ-types.update', e); res.status(500).json({ error: e.message }); }
});

router.delete('/occurrence-types/:id', async (req, res) => {
  try {
    await query(`UPDATE smartroute_occurrence_types SET active=false, updated_at=NOW()
                 WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (e) { logError('sr.occ-types.delete', e); res.status(500).json({ error: e.message }); }
});

// ----- Listagem/filtro de ocorrências
router.get('/occurrences', async (req, res) => {
  try {
    const org = orgId(req);
    const { status, type, severity, driver_id, from, to, sla, q, limit } = req.query;
    const where = ['o.organization_id=$1'];
    const params = [org];
    let i = 2;
    if (status)   { where.push(`o.status=$${i++}`); params.push(status); }
    if (type)     { where.push(`o.type=$${i++}`); params.push(type); }
    if (severity) { where.push(`o.severity=$${i++}`); params.push(severity); }
    if (driver_id){ where.push(`o.driver_id=$${i++}`); params.push(driver_id); }
    if (from)     { where.push(`o.created_at >= $${i++}`); params.push(from); }
    if (to)       { where.push(`o.created_at <= $${i++}`); params.push(to); }
    if (sla === 'breached')  where.push(`o.sla_breached=true`);
    if (sla === 'in_sla')    where.push(`o.sla_breached=false`);
    if (q) { where.push(`(o.description ILIKE $${i} OR p.name ILIKE $${i})`); params.push(`%${q}%`); i++; }

    const lim = Math.min(Number(limit) || 200, 500);
    const r = await query(
      `SELECT o.*, p.name AS pdv_name, p.city AS pdv_city,
              r.code AS route_code, d.full_name AS driver_name, s.sequence AS stop_seq,
              CASE WHEN o.status IN ('aberta','em_analise') AND o.sla_deadline_at IS NOT NULL
                     AND o.sla_deadline_at < NOW() THEN true ELSE o.sla_breached END AS sla_breached_now,
              GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(o.resolved_at, NOW()) - o.created_at))/60)::int AS age_min
         FROM smartroute_stop_occurrences o
         LEFT JOIN smartroute_route_stops s ON s.id=o.stop_id
         LEFT JOIN smartroute_routes r ON r.id=s.route_id
         LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
         LEFT JOIN smartroute_drivers d ON d.id=o.driver_id
         WHERE ${where.join(' AND ')}
         ORDER BY o.created_at DESC
         LIMIT ${lim}`,
      params);
    res.json(r.rows);
  } catch (e) { logError('sr.occ.list', e); res.status(500).json({ error: e.message }); }
});

router.get('/occurrences/:id', async (req, res) => {
  try {
    const org = orgId(req);
    const [occ, media, comments, stop] = await Promise.all([
      query(
        `SELECT o.*, p.name AS pdv_name, p.address AS pdv_address, p.city AS pdv_city,
                r.code AS route_code, d.full_name AS driver_name
           FROM smartroute_stop_occurrences o
           LEFT JOIN smartroute_route_stops s ON s.id=o.stop_id
           LEFT JOIN smartroute_routes r ON r.id=s.route_id
           LEFT JOIN smartroute_pdvs p ON p.id=s.pdv_id
           LEFT JOIN smartroute_drivers d ON d.id=o.driver_id
           WHERE o.id=$1 AND o.organization_id=$2`, [req.params.id, org]),
      query(
        `SELECT id, kind, url, created_at FROM smartroute_stop_media
           WHERE id = ANY(
             SELECT UNNEST(media_ids) FROM smartroute_stop_occurrences WHERE id=$1
           ) OR stop_id = (SELECT stop_id FROM smartroute_stop_occurrences WHERE id=$1)
           ORDER BY created_at ASC`, [req.params.id]),
      query(
        `SELECT * FROM smartroute_occurrence_comments
           WHERE occurrence_id=$1 ORDER BY created_at ASC`, [req.params.id]),
      query(
        `SELECT s.id, s.sequence, s.state, s.status, s.arrived_at, s.checkin_at, s.completed_at
           FROM smartroute_route_stops s
           JOIN smartroute_stop_occurrences o ON o.stop_id=s.id
           WHERE o.id=$1`, [req.params.id]),
    ]);
    if (!occ.rows[0]) return res.status(404).json({ error: 'Ocorrência não encontrada' });
    res.json({ occurrence: occ.rows[0], media: media.rows, comments: comments.rows, stop: stop.rows[0] || null });
  } catch (e) { logError('sr.occ.detail', e); res.status(500).json({ error: e.message }); }
});

// Update status / atribuição / resolução
router.put('/occurrences/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const setResolved = b.status === 'resolvida' || b.status === 'descartada';
    const r = await query(
      `UPDATE smartroute_stop_occurrences SET
         status = COALESCE($3, status),
         severity = COALESCE($4, severity),
         assigned_to = COALESCE($5, assigned_to),
         assigned_at = CASE WHEN $5 IS NOT NULL AND assigned_at IS NULL THEN NOW() ELSE assigned_at END,
         resolution = COALESCE($6, resolution),
         resolved_by = CASE WHEN $7::boolean THEN COALESCE($8, resolved_by) ELSE resolved_by END,
         resolved_at = CASE WHEN $7::boolean AND resolved_at IS NULL THEN NOW() ELSE resolved_at END,
         sla_breached = CASE
             WHEN $7::boolean AND sla_deadline_at IS NOT NULL AND NOW() > sla_deadline_at THEN true
             WHEN $7::boolean THEN false
             ELSE sla_breached
         END,
         updated_at = NOW()
       WHERE id=$1 AND organization_id=$2
       RETURNING *`,
      [req.params.id, orgId(req), b.status, b.severity, b.assigned_to || null,
       b.resolution || null, setResolved, req.user?.id || null]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Ocorrência não encontrada' });
    if (b.comment) {
      await query(
        `INSERT INTO smartroute_occurrence_comments (occurrence_id, organization_id, author_id, author_name, body)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, orgId(req), req.user?.id || null, req.user?.name || req.user?.email || 'Sistema', b.comment]);
    }
    res.json(r.rows[0]);
  } catch (e) { logError('sr.occ.update', e); res.status(500).json({ error: e.message }); }
});

router.post('/occurrences/:id/comments', async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'body obrigatório' });
    const r = await query(
      `INSERT INTO smartroute_occurrence_comments (occurrence_id, organization_id, author_id, author_name, body)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, orgId(req), req.user?.id || null, req.user?.name || req.user?.email || 'Sistema', body]);
    res.json(r.rows[0]);
  } catch (e) { logError('sr.occ.comment', e); res.status(500).json({ error: e.message }); }
});

// Marca SLA vencido em lote (útil chamar via cron/refresh do frontend)
router.post('/occurrences/refresh-sla', async (req, res) => {
  try {
    const r = await query(
      `UPDATE smartroute_stop_occurrences
         SET sla_breached=true, updated_at=NOW()
       WHERE organization_id=$1 AND status IN ('aberta','em_analise')
         AND sla_deadline_at IS NOT NULL AND sla_deadline_at < NOW()
         AND sla_breached=false
       RETURNING id`, [orgId(req)]);
    res.json({ updated: r.rowCount });
  } catch (e) { logError('sr.occ.refresh-sla', e); res.status(500).json({ error: e.message }); }
});

// ----- Métricas de SLA
router.get('/sla-metrics', async (req, res) => {
  try {
    const org = orgId(req);
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 180));
    const since = `CURRENT_DATE - INTERVAL '${days} days'`;

    const [totals, byStatus, bySeverity, byType, mttr, topDrivers, stageAvg, trend] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('aberta','em_analise'))::int AS abertas,
           COUNT(*) FILTER (WHERE status='resolvida')::int AS resolvidas,
           COUNT(*) FILTER (WHERE status='descartada')::int AS descartadas,
           COUNT(*) FILTER (WHERE sla_breached=true OR (status IN ('aberta','em_analise') AND sla_deadline_at < NOW()))::int AS breached,
           COUNT(*) FILTER (WHERE severity='high')::int AS high_severity
         FROM smartroute_stop_occurrences
         WHERE organization_id=$1 AND created_at >= ${since}`, [org]),
      query(
        `SELECT status, COUNT(*)::int AS n FROM smartroute_stop_occurrences
         WHERE organization_id=$1 AND created_at >= ${since}
         GROUP BY status`, [org]),
      query(
        `SELECT severity, COUNT(*)::int AS n FROM smartroute_stop_occurrences
         WHERE organization_id=$1 AND created_at >= ${since}
         GROUP BY severity`, [org]),
      query(
        `SELECT o.type,
                COALESCE(t.label, o.type) AS label,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE o.sla_breached=true)::int AS breached
         FROM smartroute_stop_occurrences o
         LEFT JOIN smartroute_occurrence_types t ON t.organization_id=o.organization_id AND t.code=o.type
         WHERE o.organization_id=$1 AND o.created_at >= ${since}
         GROUP BY o.type, t.label ORDER BY n DESC LIMIT 10`, [org]),
      query(
        `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/60)::int AS mttr_min
         FROM smartroute_stop_occurrences
         WHERE organization_id=$1 AND status='resolvida' AND created_at >= ${since}`, [org]),
      query(
        `SELECT d.id, d.full_name, COUNT(o.*)::int AS n,
                COUNT(*) FILTER (WHERE o.sla_breached=true)::int AS breached
         FROM smartroute_stop_occurrences o
         JOIN smartroute_drivers d ON d.id=o.driver_id
         WHERE o.organization_id=$1 AND o.created_at >= ${since}
         GROUP BY d.id, d.full_name ORDER BY n DESC LIMIT 10`, [org]),
      query(
        `SELECT
           AVG(EXTRACT(EPOCH FROM (s.checkin_at - s.arrived_at)))::int AS avg_arrival_to_checkin_sec,
           AVG(EXTRACT(EPOCH FROM (s.completed_at - s.checkin_at)))::int AS avg_service_sec,
           AVG(EXTRACT(EPOCH FROM (s.completed_at - s.arrived_at)))::int AS avg_total_sec,
           COUNT(*)::int AS stops
         FROM smartroute_route_stops s
         JOIN smartroute_routes r ON r.id=s.route_id
         WHERE r.organization_id=$1 AND r.planned_date >= ${since}
           AND s.arrived_at IS NOT NULL AND s.completed_at IS NOT NULL`, [org]),
      query(
        `SELECT date_trunc('day', created_at)::date AS d,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE sla_breached=true)::int AS breached
         FROM smartroute_stop_occurrences
         WHERE organization_id=$1 AND created_at >= ${since}
         GROUP BY d ORDER BY d ASC`, [org]),
    ]);

    const t = totals.rows[0] || {};
    const sla_compliance = t.total > 0 ? Math.round(((t.total - t.breached) / t.total) * 100) : 100;

    res.json({
      period_days: days,
      totals: { ...t, sla_compliance_pct: sla_compliance },
      by_status: byStatus.rows,
      by_severity: bySeverity.rows,
      top_types: byType.rows,
      top_drivers: topDrivers.rows,
      mttr_min: mttr.rows[0]?.mttr_min || 0,
      stage_avg: stageAvg.rows[0] || {},
      trend: trend.rows,
    });
  } catch (e) { logError('sr.sla.metrics', e); res.status(500).json({ error: e.message }); }
});

// ============================================================
// ============ ROTAS FIXAS: PDVs, ESCALA, ROTA DO DIA =========
// ============================================================

// -------- PDVs fixos da rota --------
router.get('/routes/:id/pdvs', async (req, res) => {
  try {
    const r = await query(
      `SELECT rp.*, p.name AS pdv_name, p.address, p.city, p.state, p.contact_name, p.contact_phone, p.lat, p.lng
       FROM smartroute_route_pdvs rp
       JOIN smartroute_pdvs p ON p.id=rp.pdv_id
       WHERE rp.route_id=$1 ORDER BY rp.sequence, p.name`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/routes/:id/pdvs', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.pdv_id) return res.status(400).json({ error: 'pdv_id obrigatório' });
    // pega sequence próximo
    const s = await query(`SELECT COALESCE(MAX(sequence),0)+1 AS n FROM smartroute_route_pdvs WHERE route_id=$1`, [req.params.id]);
    const r = await query(
      `INSERT INTO smartroute_route_pdvs (route_id, pdv_id, sequence, delivery_window, notes)
       VALUES ($1,$2,COALESCE($3,$4),COALESCE($5,'qualquer'),$6)
       ON CONFLICT (route_id, pdv_id) DO UPDATE SET
         sequence=COALESCE(EXCLUDED.sequence, smartroute_route_pdvs.sequence),
         delivery_window=COALESCE(EXCLUDED.delivery_window, smartroute_route_pdvs.delivery_window),
         notes=COALESCE(EXCLUDED.notes, smartroute_route_pdvs.notes)
       RETURNING *`,
      [req.params.id, b.pdv_id, b.sequence || null, s.rows[0].n, b.delivery_window || b.window || null, b.notes || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/routes/:id/pdvs/reorder', async (req, res) => {
  try {
    const ids = req.body?.pdv_ids || [];
    for (let i = 0; i < ids.length; i++) {
      await query(`UPDATE smartroute_route_pdvs SET sequence=$1 WHERE route_id=$2 AND pdv_id=$3`, [i + 1, req.params.id, ids[i]]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/routes/:id/pdvs/:pdvId', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE smartroute_route_pdvs SET delivery_window=COALESCE($3,delivery_window), notes=COALESCE($4,notes), sequence=COALESCE($5,sequence)
       WHERE route_id=$1 AND pdv_id=$2 RETURNING *`,
      [req.params.id, req.params.pdvId, b.delivery_window || b.window || null, b.notes || null, b.sequence || null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/routes/:id/pdvs/:pdvId', async (req, res) => {
  try {
    await query(`DELETE FROM smartroute_route_pdvs WHERE route_id=$1 AND pdv_id=$2`, [req.params.id, req.params.pdvId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------- Escala semanal --------
router.get('/routes/:id/schedule', async (req, res) => {
  try {
    const r = await query(
      `SELECT s.*, d.full_name AS driver_name, v.plate AS vehicle_plate
       FROM smartroute_route_schedule s
       LEFT JOIN smartroute_drivers d ON d.id=s.driver_id
       LEFT JOIN smartroute_vehicles v ON v.id=s.vehicle_id
       WHERE s.route_id=$1 ORDER BY s.weekday`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/routes/:id/schedule', async (req, res) => {
  try {
    const entries = req.body?.entries || []; // [{weekday, driver_id, vehicle_id}]
    await query(`DELETE FROM smartroute_route_schedule WHERE route_id=$1`, [req.params.id]);
    for (const e of entries) {
      if (e.driver_id || e.vehicle_id) {
        await query(
          `INSERT INTO smartroute_route_schedule (route_id, weekday, driver_id, vehicle_id)
           VALUES ($1,$2,$3,$4)`,
          [req.params.id, e.weekday, e.driver_id || null, e.vehicle_id || null]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------- Rota do Dia (auto-cria se não existe) --------
async function ensureRouteDay(routeId, date) {
  const existing = await query(`SELECT * FROM smartroute_route_days WHERE route_id=$1 AND date=$2`, [routeId, date]);
  if (existing.rows[0]) return existing.rows[0];
  // herda escala do weekday + fallback do default_driver do template
  const wd = new Date(date + 'T12:00:00').getDay();
  const sch = await query(`SELECT driver_id, vehicle_id FROM smartroute_route_schedule WHERE route_id=$1 AND weekday=$2`, [routeId, wd]);
  const tmpl = await query(`SELECT default_driver_id, default_vehicle_id FROM smartroute_routes WHERE id=$1`, [routeId]);
  const drv = sch.rows[0]?.driver_id || tmpl.rows[0]?.default_driver_id || null;
  const veh = sch.rows[0]?.vehicle_id || tmpl.rows[0]?.default_vehicle_id || null;
  const drvArr = drv ? [drv] : [];
  const ins = await query(
    `INSERT INTO smartroute_route_days (route_id, date, status, driver_ids, vehicle_id)
     VALUES ($1,$2,'aberta',$3::uuid[],$4) RETURNING *`,
    [routeId, date, drvArr, veh]
  );
  return ins.rows[0];
}

router.get('/routes/:id/day', async (req, res) => {
  try {
    const org = orgId(req);
    const date = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const rt = await query(
      `SELECT r.*,
              COALESCE(r.depot_id, d.id, def.id) AS depot_id,
              COALESCE(r.depot_lat, d.lat, def.lat) AS depot_lat,
              COALESCE(r.depot_lng, d.lng, def.lng) AS depot_lng,
              COALESCE(d.name, def.name) AS depot_name
         FROM smartroute_routes r
         LEFT JOIN smartroute_depots d ON d.id=r.depot_id
         LEFT JOIN LATERAL (
           SELECT id, name, lat, lng
             FROM smartroute_depots
             WHERE organization_id=r.organization_id AND COALESCE(active,true)=true
            ORDER BY is_default DESC, name
            LIMIT 1
         ) def ON true
        WHERE r.id=$1 AND r.organization_id=$2`, [req.params.id, org]);
    if (!rt.rows[0]) return res.status(404).json({ error: 'Rota não encontrada' });
    const day = await ensureRouteDay(req.params.id, date);
    const orders = await query(
      `SELECT o.*, p.name AS pdv_name, p.address AS pdv_address, p.lat AS pdv_lat, p.lng AS pdv_lng,
              p.delivery_window AS pdv_default_window,
              p.delivery_window_start AS pdv_window_start,
              p.delivery_window_end AS pdv_window_end,
              COALESCE(NULLIF(o.pdv_window,'qualquer'), NULLIF(rp.delivery_window,'qualquer'), p.delivery_window, 'qualquer') AS effective_pdv_window,
              COALESCE(p.service_time_min,15) AS pdv_service_time_min,
              p.checklist_template_id AS pdv_checklist_template_id,
              (SELECT COALESCE(jsonb_array_length(items),0)
                 FROM smartroute_pdv_checklists c
                WHERE c.organization_id=$3
                  AND (c.pdv_id = o.pdv_id OR (c.pdv_id IS NULL AND c.is_default=true))
                ORDER BY (c.pdv_id = o.pdv_id) DESC LIMIT 1) AS checklist_items_count,
              rp.sequence AS pdv_sequence, rp.delivery_window AS route_pdv_window
       FROM smartroute_orders o
       LEFT JOIN smartroute_pdvs p ON p.id=o.pdv_id
       LEFT JOIN smartroute_route_pdvs rp ON rp.route_id=o.route_id AND rp.pdv_id=o.pdv_id
       WHERE o.route_id=$1 AND o.delivery_date=$2
       ORDER BY
         CASE WHEN o.sequence IS NOT NULL THEN 0 ELSE 1 END,
         o.sequence NULLS LAST,
          CASE COALESCE(NULLIF(o.pdv_window,'qualquer'), NULLIF(rp.delivery_window,'qualquer'), p.delivery_window, 'qualquer')
           WHEN 'manha' THEN 1 WHEN 'tarde' THEN 2 WHEN 'noite' THEN 3 ELSE 4 END,
          p.delivery_window_start NULLS LAST,
         rp.sequence NULLS LAST, o.created_at`,
      [req.params.id, date, org]);
    // enriquece drivers/vehicle
    const drvs = day.driver_ids?.length
      ? (await query(`SELECT id, full_name, phone FROM smartroute_drivers WHERE id = ANY($1::uuid[])`, [day.driver_ids])).rows
      : [];
    const veh = day.vehicle_id ? (await query(`SELECT id, plate, model FROM smartroute_vehicles WHERE id=$1`, [day.vehicle_id])).rows[0] : null;
    res.json({ route: rt.rows[0], day, orders: orders.rows, drivers: drvs, vehicle: veh });
  } catch (e) { logError('sr.route.day', e); res.status(500).json({ error: e.message }); }
});

router.post('/routes/street-route', async (req, res) => {
  try {
    const points = Array.isArray(req.body?.points) ? req.body.points : [];
    if (points.length < 2) return res.status(400).json({ error: 'Informe ao menos origem e destino' });
    const normalized = points.map((p) => ({
      lat: toCoord(p.lat),
      lng: toCoord(p.lng),
      label: p.label || null,
    }));
    if (normalized.some((p) => !hasCoord(p))) {
      return res.status(400).json({ error: 'Todos os pontos precisam de latitude e longitude' });
    }

    const legs = [];
    const geometry = [];
    let fallbackLegs = 0;
    for (let i = 0; i < normalized.length - 1; i++) {
      const from = normalized[i];
      const to = normalized[i + 1];
      const result = await fetchOsrmLeg(from, to);
      if (!result.ok) fallbackLegs++;
      legs.push({ ...result.leg, fromLabel: from.label, toLabel: to.label });
      result.geometry.forEach((point, idx) => {
        if (i > 0 && idx === 0) return;
        geometry.push(point);
      });
    }

    res.json({ legs, geometry, fallbackLegs });
  } catch (e) { logError('sr.streetRoute', e); res.status(500).json({ error: e.message }); }
});

router.post('/routes/:id/day/:date/drivers', async (req, res) => {
  try {
    const day = await ensureRouteDay(req.params.id, req.params.date);
    const { driver_ids, vehicle_id } = req.body || {};
    await query(
      `UPDATE smartroute_route_days SET driver_ids=COALESCE($2::uuid[],driver_ids), vehicle_id=COALESCE($3,vehicle_id), updated_at=NOW() WHERE id=$1`,
      [day.id, Array.isArray(driver_ids) ? driver_ids : null, vehicle_id || null]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/routes/:id/day/:date/close', async (req, res) => {
  try {
    const org = orgId(req);
    const day = await ensureRouteDay(req.params.id, req.params.date);
    if (day.status === 'fechada' || day.status === 'em_andamento' || day.status === 'concluida') {
      return res.status(400).json({ error: 'Rota do dia já está fechada' });
    }
    if (!day.driver_ids?.length) return res.status(400).json({ error: 'Defina ao menos 1 entregador antes de fechar' });

    // pega pedidos e template
    const tmpl = (await query(
      `SELECT r.*,
              COALESCE(r.depot_id, d.id, def.id) AS depot_id,
              COALESCE(r.depot_lat, d.lat, def.lat) AS depot_lat,
              COALESCE(r.depot_lng, d.lng, def.lng) AS depot_lng
         FROM smartroute_routes r
         LEFT JOIN smartroute_depots d ON d.id=r.depot_id
         LEFT JOIN LATERAL (
           SELECT id, lat, lng
             FROM smartroute_depots
            WHERE organization_id=r.organization_id AND active=true
            ORDER BY is_default DESC, name
            LIMIT 1
         ) def ON true
        WHERE r.id=$1`, [req.params.id])).rows[0];
    const orders = (await query(
      `SELECT o.*, rp.sequence AS pdv_sequence
       FROM smartroute_orders o
       LEFT JOIN smartroute_route_pdvs rp ON rp.route_id=o.route_id AND rp.pdv_id=o.pdv_id
       WHERE o.route_id=$1 AND o.delivery_date=$2
       ORDER BY
         CASE COALESCE(o.pdv_window,'qualquer') WHEN 'manha' THEN 1 WHEN 'tarde' THEN 2 WHEN 'noite' THEN 3 ELSE 4 END,
         rp.sequence NULLS LAST, o.created_at`, [req.params.id, req.params.date])).rows;
    if (!orders.length) return res.status(400).json({ error: 'Sem pedidos para esta data' });

    // divide pedidos entre entregadores (round-robin simples)
    const drivers = day.driver_ids;
    const buckets = drivers.map(() => []);
    orders.forEach((o, i) => buckets[i % drivers.length].push(o));

    const createdRouteIds = [];
    for (let idx = 0; idx < drivers.length; idx++) {
      const bucket = buckets[idx];
      if (!bucket.length) continue;
      const code = `${tmpl.code || 'RT'}-${req.params.date}-${idx + 1}`;
      const dayRoute = await query(
        `INSERT INTO smartroute_routes
           (organization_id, code, driver_id, vehicle_id, planned_date, status,
            depot_id, depot_lat, depot_lng, total_stops, is_template, parent_route_id, route_day_id, notes)
         VALUES ($1,$2,$3,$4,$5,'planejada',$6,$7,$8,$9,false,$10,$11,$12) RETURNING id`,
        [org, code, drivers[idx], day.vehicle_id || tmpl.default_vehicle_id, req.params.date,
         tmpl.depot_id, tmpl.depot_lat, tmpl.depot_lng, bucket.length, req.params.id, day.id, tmpl.notes]
      );
      const rid = dayRoute.rows[0].id;
      createdRouteIds.push(rid);
      for (let i = 0; i < bucket.length; i++) {
        const o = bucket[i];
        const st = await query(
          `INSERT INTO smartroute_route_stops (route_id, order_id, pdv_id, sequence)
           VALUES ($1,$2,$3,$4) RETURNING id`, [rid, o.id, o.pdv_id, i + 1]
        );
        await query(`UPDATE smartroute_orders SET status='em_rota', route_stop_id=$2, updated_at=NOW() WHERE id=$1`, [o.id, st.rows[0].id]);
      }
    }

    await query(
      `UPDATE smartroute_route_days SET status='fechada', closed_at=NOW(), closed_by=$2, daily_route_ids=$3::uuid[], updated_at=NOW() WHERE id=$1`,
      [day.id, req.user?.id || null, createdRouteIds]
    );
    res.json({ ok: true, daily_route_ids: createdRouteIds });
  } catch (e) { logError('sr.route.day.close', e); res.status(500).json({ error: e.message }); }
});

router.post('/routes/:id/day/:date/reopen', async (req, res) => {
  try {
    const day = (await query(`SELECT * FROM smartroute_route_days WHERE route_id=$1 AND date=$2`, [req.params.id, req.params.date])).rows[0];
    if (!day) return res.status(404).json({ error: 'Rota do dia não encontrada' });
    // reverte: apaga daily routes/stops e devolve orders ao pool 'pendente'
    for (const rid of (day.daily_route_ids || [])) {
      await query(`UPDATE smartroute_orders SET status='pendente', route_stop_id=NULL WHERE route_stop_id IN (SELECT id FROM smartroute_route_stops WHERE route_id=$1)`, [rid]);
      await query(`DELETE FROM smartroute_routes WHERE id=$1`, [rid]);
    }
    await query(
      `UPDATE smartroute_route_days SET status='aberta', reopened_at=NOW(), daily_route_ids='{}'::uuid[], closed_at=NULL, closed_by=NULL, updated_at=NOW() WHERE id=$1`,
      [day.id]
    );
    res.json({ ok: true });
  } catch (e) { logError('sr.route.day.reopen', e); res.status(500).json({ error: e.message }); }
});

// Marca route como template (para migração de rotas antigas → templates)
router.post('/routes/:id/mark-template', async (req, res) => {
  try {
    await query(`UPDATE smartroute_routes SET is_template=true, updated_at=NOW() WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cria rota template (mais simples que /routes original)
router.post('/routes/template', async (req, res) => {
  try {
    const b = req.body || {};
    const code = b.code || `TMPL-${Date.now().toString(36).toUpperCase()}`;
    let depotId = b.depot_id || null;
    let depotLat = null;
    let depotLng = null;
    if (!depotId) {
      const def = await query(`SELECT id, lat, lng FROM smartroute_depots WHERE organization_id=$1 AND active=true ORDER BY is_default DESC, name LIMIT 1`, [orgId(req)]);
      if (def.rows[0]) { depotId = def.rows[0].id; depotLat = def.rows[0].lat; depotLng = def.rows[0].lng; }
    } else {
      const d = await query(`SELECT lat, lng FROM smartroute_depots WHERE id=$1 AND organization_id=$2 AND active=true`, [depotId, orgId(req)]);
      if (d.rows[0]) { depotLat = d.rows[0].lat; depotLng = d.rows[0].lng; }
    }
    const r = await query(
      `INSERT INTO smartroute_routes (organization_id, code, is_template, default_driver_id, default_vehicle_id, owner_user_id, notes, status, planned_date, upsell_time_min, depot_id, depot_lat, depot_lng)
       VALUES ($1,$2,true,$3,$4,$5,$6,'template',CURRENT_DATE,$7,$8,$9,$10) RETURNING *`,
      [orgId(req), code, b.default_driver_id || null, b.default_vehicle_id || null, req.user?.id || null, b.notes || null, Number.isFinite(+b.upsell_time_min) ? +b.upsell_time_min : 0,
       depotId, depotLat, depotLng]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista somente templates
router.get('/routes-templates', async (req, res) => {
  try {
    const r = await query(
      `SELECT r.*,
              (SELECT COUNT(*)::int FROM smartroute_route_pdvs WHERE route_id=r.id) AS pdvs_count,
              d.full_name AS default_driver_name, v.plate AS default_vehicle_plate,
              dep.name AS depot_name
       FROM smartroute_routes r
       LEFT JOIN smartroute_drivers d ON d.id=r.default_driver_id
       LEFT JOIN smartroute_vehicles v ON v.id=r.default_vehicle_id
       LEFT JOIN smartroute_depots dep ON dep.id=r.depot_id
       WHERE r.organization_id=$1 AND r.is_template=true
       ORDER BY r.code`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================================
// ============ OTIMIZAÇÃO IA DA ROTA DO DIA ============
// =====================================================================
// Algoritmo: janela do PDV (manhã=1, tarde=2, noite=3, qualquer=4) →
// nearest-neighbor por coordenadas → tempo de descarga por PDV.
// Respeita allowed_weekdays (pedidos em dias não permitidos ficam
// marcados como bloqueados e não entram na sequência).

const WINDOW_RANK = { manha: 1, tarde: 2, noite: 3, qualquer: 4 };
function timeToMinutes(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Math.max(0, Math.min(1440, Number(match[1]) * 60 + Number(match[2])));
}
function haversineKm(a, b) {
  if (!a?.lat || !b?.lat) return 999;
  const R = 6371, toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const AVG_ROUTE_SPEED_KMH = 30;
const toCoord = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const hasCoord = (point) => toCoord(point?.lat) !== null && toCoord(point?.lng) !== null;
async function fetchOsrmLeg(from, to) {
  const fromLat = toCoord(from.lat), fromLng = toCoord(from.lng);
  const toLat = toCoord(to.lat), toLng = toCoord(to.lng);
  const fallbackKm = haversineKm({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
  const fallback = {
    leg: { km: fallbackKm, min: (fallbackKm / AVG_ROUTE_SPEED_KMH) * 60, fallback: true },
    geometry: [[fromLat, fromLng], [toLat, toLng]],
    ok: false,
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!response.ok) return fallback;
    const data = await response.json();
    const route = data?.routes?.[0];
    const rawLeg = route?.legs?.[0];
    const geometry = route?.geometry?.coordinates;
    if (!route || !rawLeg || !Array.isArray(geometry) || geometry.length < 2) return fallback;
    return {
      leg: { km: Number(rawLeg.distance || 0) / 1000, min: Number(rawLeg.duration || 0) / 60 },
      geometry: geometry.map((c) => [c[1], c[0]]),
      ok: true,
    };
  } catch {
    return fallback;
  }
}

async function optimizeRouteDay(organization_id, route_id, date, actor = 'manual') {
  // Garante instância do dia
  await query(
    `INSERT INTO smartroute_route_days (route_id, date, status)
     VALUES ($1,$2,'aberta') ON CONFLICT (route_id, date) DO NOTHING`,
    [route_id, date]
  );

  const weekday = new Date(date + 'T12:00:00-03:00').getDay();

  const ordersR = await query(
    `SELECT o.id, o.pdv_id, o.pdv_window, o.priority, o.notes, o.order_number,
            p.name AS pdv_name, p.lat, p.lng, p.delivery_window, p.allowed_weekdays,
            p.delivery_window_start, p.delivery_window_end,
            p.service_time_min, p.checklist_template_id,
            COALESCE(NULLIF(o.pdv_window,'qualquer'), p.delivery_window, 'qualquer') AS effective_window
       FROM smartroute_orders o
       LEFT JOIN smartroute_pdvs p ON p.id = o.pdv_id
      WHERE o.organization_id=$1 AND o.route_id=$2 AND o.delivery_date=$3
        AND o.status IN ('pendente','planejado','em_rota')`,
    [organization_id, route_id, date]
  );

  const eligible = [];
  const blocked = [];
  for (const o of ordersR.rows) {
    const allowed = Array.isArray(o.allowed_weekdays) ? o.allowed_weekdays : [0,1,2,3,4,5,6];
    if (!allowed.includes(weekday)) blocked.push({ ...o, reason: 'dia_nao_permitido' });
    else {
      const window = o.effective_window || o.pdv_window || o.delivery_window || 'qualquer';
      eligible.push({
        ...o,
        window,
        window_start_min: timeToMinutes(o.delivery_window_start),
        window_end_min: timeToMinutes(o.delivery_window_end),
      });
    }
  }

    const routeSeedR = await query(
    `SELECT COALESCE(r.depot_lat, d.lat, def.lat) AS depot_lat,
            COALESCE(r.depot_lng, d.lng, def.lng) AS depot_lng
       FROM smartroute_routes r
       LEFT JOIN smartroute_depots d ON d.id=r.depot_id
       LEFT JOIN LATERAL (
         SELECT lat, lng
           FROM smartroute_depots
          WHERE organization_id=r.organization_id AND active=true
          ORDER BY is_default DESC, name
          LIMIT 1
       ) def ON true
      WHERE r.id=$1 AND r.organization_id=$2`,
    [route_id, organization_id]
  );

  // Ordenação: horário exato da janela → nearest-neighbor por PDV, partindo sempre do CD
  const byWindow = new Map();
  for (const o of eligible) {
    const rank = WINDOW_RANK[o.window] ?? 4;
    const start = o.window_start_min ?? (o.window === 'tarde' ? 13 * 60 : o.window === 'noite' ? 18 * 60 : o.window === 'manha' ? 8 * 60 : 24 * 60);
    const end = o.window_end_min ?? (o.window === 'tarde' ? 18 * 60 : o.window === 'noite' ? 22 * 60 : o.window === 'manha' ? 12 * 60 : 24 * 60);
    const key = `${start}:${end}:${rank}`;
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key).push(o);
  }
  const sortedWindows = [...byWindow.keys()].sort((a,b) => {
    const aa = a.split(':').map(Number), bb = b.split(':').map(Number);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  });

  const sequence = [];
  let cursor = routeSeedR.rows[0]?.depot_lat && routeSeedR.rows[0]?.depot_lng
    ? { lat: routeSeedR.rows[0].depot_lat, lng: routeSeedR.rows[0].depot_lng }
    : null;
  for (const w of sortedWindows) {
    const pool = byWindow.get(w);
    while (pool.length) {
      let bestIdx = 0;
      if (cursor) {
        let bestDist = Infinity;
        pool.forEach((p, i) => {
          const d = haversineKm(cursor, p);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
      }
      const picked = pool.splice(bestIdx, 1)[0];
      sequence.push(picked);
      if (picked.lat && picked.lng) cursor = { lat: picked.lat, lng: picked.lng };
    }
  }

  // Persiste sequência nos pedidos
  for (let i = 0; i < sequence.length; i++) {
    await query(`UPDATE smartroute_orders SET sequence=$1, status='planejado' WHERE id=$2`, [i+1, sequence[i].id]);
  }
  for (const b of blocked) {
    await query(`UPDATE smartroute_orders SET sequence=NULL WHERE id=$1`, [b.id]);
  }

  // Atribui motorista/veículo padrão se ainda não houver
  const routeR = await query(
    `SELECT default_driver_id, default_vehicle_id FROM smartroute_routes WHERE id=$1`,
    [route_id]
  );
  const rt = routeR.rows[0] || {};
  const dayR = await query(`SELECT driver_ids, vehicle_id FROM smartroute_route_days WHERE route_id=$1 AND date=$2`, [route_id, date]);
  const current = dayR.rows[0] || {};
  const nextDrivers = (current.driver_ids && current.driver_ids.length) ? current.driver_ids : (rt.default_driver_id ? [rt.default_driver_id] : []);
  const nextVehicle = current.vehicle_id || rt.default_vehicle_id || null;

  const summary = {
    stops: sequence.length,
    blocked: blocked.length,
    weekday,
    optimized_by: actor,
  };

  await query(
    `UPDATE smartroute_route_days
       SET status = CASE WHEN status='publicada' THEN 'publicada' ELSE 'otimizada' END,
           driver_ids=$3, vehicle_id=$4,
           optimized_at=NOW(), optimized_by=$5, stops_summary=$6, updated_at=NOW()
     WHERE route_id=$1 AND date=$2`,
    [route_id, date, nextDrivers, nextVehicle, actor, JSON.stringify(summary)]
  );

  return { sequence, blocked, summary, drivers: nextDrivers, vehicle_id: nextVehicle };
}

// Otimizar rota do dia (uma rota específica)
router.post('/routes/:id/day/:date/optimize', async (req, res) => {
  try {
    const result = await optimizeRouteDay(orgId(req), req.params.id, req.params.date, req.user?.email || 'manual');
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Publicar rota do dia → vai para o app do entregador
router.post('/routes/:id/day/:date/publish', async (req, res) => {
  try {
    await query(
      `UPDATE smartroute_route_days SET status='publicada', published_at=NOW(), closed_at=NOW(), closed_by=$3, updated_at=NOW()
        WHERE route_id=$1 AND date=$2`,
      [req.params.id, req.params.date, req.user?.id || null]
    );
    await query(
      `UPDATE smartroute_orders SET status='em_rota' WHERE route_id=$1 AND delivery_date=$2 AND status='planejado'`,
      [req.params.id, req.params.date]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Salvar sequência manual (simulador) → registra como oficial
router.put('/routes/:id/day/:date/sequence', async (req, res) => {
  try {
    const org = orgId(req);
    const ids = Array.isArray(req.body?.order_ids) ? req.body.order_ids : [];
    if (!ids.length) return res.status(400).json({ error: 'order_ids vazio' });
    // Garante dia
    await query(
      `INSERT INTO smartroute_route_days (route_id, date, status)
       VALUES ($1,$2,'aberta') ON CONFLICT (route_id, date) DO NOTHING`,
      [req.params.id, req.params.date]
    );
    for (let i = 0; i < ids.length; i++) {
      await query(
        `UPDATE smartroute_orders SET sequence=$1, status = CASE WHEN status='pendente' THEN 'planejado' ELSE status END
           WHERE id=$2 AND organization_id=$3 AND route_id=$4 AND delivery_date=$5`,
        [i + 1, ids[i], org, req.params.id, req.params.date]
      );
    }
    const summary = { stops: ids.length, manual_override: true, saved_by: req.user?.email || 'manual' };
    await query(
      `UPDATE smartroute_route_days
         SET status = CASE WHEN status IN ('publicada','em_andamento','concluida') THEN status ELSE 'otimizada' END,
             optimized_at=NOW(), optimized_by=$3, stops_summary=$4, updated_at=NOW()
       WHERE route_id=$1 AND date=$2`,
      [req.params.id, req.params.date, req.user?.email || 'manual', JSON.stringify(summary)]
    );
    res.json({ ok: true, stops: ids.length });
  } catch (e) { logError('sr.day.sequence', e); res.status(500).json({ error: e.message }); }
});

// Troca/adiciona motorista
router.post('/routes/:id/day/:date/drivers', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.driver_ids) ? req.body.driver_ids : [];
    await query(
      `UPDATE smartroute_route_days SET driver_ids=$3, updated_at=NOW() WHERE route_id=$1 AND date=$2`,
      [req.params.id, req.params.date, ids]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============ Templates de Checklist ============
router.get('/pdv-checklists', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM smartroute_pdv_checklists WHERE organization_id=$1 ORDER BY is_default DESC, name`, [orgId(req)]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/pdv-checklists', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.is_default) {
      await query(`UPDATE smartroute_pdv_checklists SET is_default=false WHERE organization_id=$1`, [orgId(req)]);
    }
    const r = await query(
      `INSERT INTO smartroute_pdv_checklists (organization_id, pdv_id, name, is_default, items)
       VALUES ($1,$2,$3,COALESCE($4,false),COALESCE($5,'[]'::jsonb)) RETURNING *`,
      [orgId(req), b.pdv_id || null, b.name, b.is_default, JSON.stringify(b.items || [])]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/pdv-checklists/:id', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.is_default) {
      await query(`UPDATE smartroute_pdv_checklists SET is_default=false WHERE organization_id=$1 AND id<>$2`, [orgId(req), req.params.id]);
    }
    const r = await query(
      `UPDATE smartroute_pdv_checklists SET name=COALESCE($3,name), pdv_id=$4, is_default=COALESCE($5,is_default), items=COALESCE($6,items), updated_at=NOW()
        WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [req.params.id, orgId(req), b.name, b.pdv_id || null, b.is_default, b.items ? JSON.stringify(b.items) : null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/pdv-checklists/:id', async (req, res) => {
  try { await query(`DELETE FROM smartroute_pdv_checklists WHERE id=$1 AND organization_id=$2`, [req.params.id, orgId(req)]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================================
// Nightly optimizer - roda para todas as orgs, para D+1
// Chamado pelo cron em index.js (20h America/Sao_Paulo)
// =====================================================================
export async function runNightlyOptimizer() {
  await ensureSmartRouteTables();
  const tomorrow = new Date(Date.now() + 24*60*60*1000).toISOString().slice(0,10);
  const targets = await query(
    `SELECT DISTINCT o.organization_id, o.route_id
       FROM smartroute_orders o
      WHERE o.delivery_date=$1 AND o.route_id IS NOT NULL AND o.status IN ('pendente','planejado')`,
    [tomorrow]
  );
  let ok = 0, err = 0;
  for (const t of targets.rows) {
    try { await optimizeRouteDay(t.organization_id, t.route_id, tomorrow, 'cron-nightly'); ok++; }
    catch (e) { err++; console.error('[smartroute-nightly] falhou rota', t.route_id, e.message); }
  }
  console.log(`🌙 [SmartRoute IA] Otimização noturna para ${tomorrow}: ${ok} rotas OK, ${err} erros`);
  return { date: tomorrow, ok, err };
}

// =====================================================================
// Catch-up: roda no startup do backend. Cobre casos em que o servidor
// estava fora do ar às 20h e o cron noturno foi pulado.
// Otimiza D+1 e também o dia atual se ainda houver rotas não otimizadas.
// =====================================================================
export async function runCatchupOptimizer() {
  await ensureSmartRouteTables();
  const now = new Date();
  const today = new Date(now.getTime() - 3*60*60*1000).toISOString().slice(0,10); // GMT-3
  const tomorrow = new Date(now.getTime() + 24*60*60*1000 - 3*60*60*1000).toISOString().slice(0,10);
  const dates = [today, tomorrow];
  let total = 0, ok = 0, err = 0;
  for (const date of dates) {
    const targets = await query(
      `SELECT DISTINCT o.organization_id, o.route_id
         FROM smartroute_orders o
         LEFT JOIN smartroute_route_days d
           ON d.route_id=o.route_id AND d.date=o.delivery_date
        WHERE o.delivery_date=$1
          AND o.route_id IS NOT NULL
          AND o.status IN ('pendente','planejado')
          AND (d.id IS NULL OR d.status='aberta' OR d.optimized_at IS NULL)`,
      [date]
    );
    for (const t of targets.rows) {
      total++;
      try { await optimizeRouteDay(t.organization_id, t.route_id, date, 'startup-catchup'); ok++; }
      catch (e) { err++; console.error('[smartroute-catchup] falhou rota', t.route_id, date, e.message); }
    }
  }
  if (total > 0) console.log(`🔁 [SmartRoute IA] Catch-up no startup: ${ok}/${total} rotas otimizadas (${err} erros)`);
  else console.log('🔁 [SmartRoute IA] Catch-up no startup: nada pendente');
  return { ok, err, total };
}

// =====================================================================
// IMPORTAÇÃO DE ROMANEIO (PDF do Mega Online Software) → Pedidos + Rota
// =====================================================================
function parseBRNumber(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function brDateToISO(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// pdf-parse não preserva a ordem visual do layout: rótulos costumam vir DEPOIS do
// valor (ex: "02873-CARLOS...\nCliente:\n"), e células numéricas adjacentes ficam
// coladas sem separador (ex: qty "1" + peso "0,000" + valor "60,00" -> "10,00060,00").
// O peso é sempre gravado como "0,000" neste romaneio, então usamos essa string
// literal como âncora para separar qty de valor de forma inequívoca.
function parseProductLine(line) {
  const unitMatch = line.match(/(FD|UN)$/);
  if (!unitMatch) return null;
  const unit = unitMatch[1];
  const rest = line.slice(0, line.length - unit.length);

  const pesoIdx = rest.indexOf('0,000');
  if (pesoIdx < 0) return null;
  const qtyBlock = rest.slice(0, pesoIdx);
  const qtyDigits = qtyBlock.match(/(\d+)$/);
  if (!qtyDigits) return null;
  const description = qtyBlock.slice(0, qtyBlock.length - qtyDigits[1].length).trim();
  const valorStr = rest.slice(pesoIdx + 5); // "0,000".length === 5
  if (!/^[\d.]+,\d{2}$/.test(valorStr)) return null;

  return { description, qty: parseInt(qtyDigits[1], 10), weight: 0, total_value: parseBRNumber(valorStr), unit };
}

function parseSubtotalBlob(line) {
  if (!line.endsWith('0,000')) return null;
  const valorStr = line.slice(0, line.length - 5);
  if (!/^[\d.]+,\d{2}$/.test(valorStr)) return null;
  return { valor: parseBRNumber(valorStr), peso: 0 };
}

function parseRomaneioText(rawText) {
  const text = String(rawText || '').replace(/\r/g, '');

  // "13:37:42\n0003235\nEntregador:" — hora e número do romaneio vêm juntos, nessa ordem,
  // logo antes do rótulo "Entregador:" (âncora confiável).
  const numMatch = text.match(/(\d{2}:\d{2}:\d{2})\s*\n\s*(\d{4,10})\s*\n\s*Entregador:/i);
  const timeMatch = text.match(/(\d{2}:\d{2}:\d{2})/);
  const headerDateMatch = text.match(/ROMANEIO[\s\S]*?Data:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const entregadorMatch = text.match(/Entregador:\s*([^\n]+)/i);
  const placaMatch = text.match(/Placa:\s*([^\n]+)/i);

  const romaneio_number = numMatch ? numMatch[2] : null;
  const romaneio_time = numMatch ? numMatch[1] : (timeMatch ? timeMatch[1] : null);
  const romaneio_date = headerDateMatch ? brDateToISO(headerDateMatch[1]) : null;
  const deliverer_name = entregadorMatch ? entregadorMatch[1].trim() : null;
  const plate = placaMatch ? placaMatch[1].trim().replace(/\s+/g, '') : null;

  const stops = [];
  const warnings = [];

  // Cada parada é precedida por esse cabeçalho de coluna fixo — usamos como delimitador.
  const DELIM = /Endere[cç]o de Entrega\s*\n\s*Seq:\s*\n\s*Endere[cç]o de Faturamento\s*\n/gi;
  const parts = text.split(DELIM);

  // Um quebra de página no meio de uma parada reinsere o cabeçalho da página seguinte
  // (nome da empresa, "Página: N", hora, motorista/placa) no meio do bloco — filtramos isso.
  const HEADER_NOISE = new Set(['ANATRIELLO SUCOS LTDA', 'MEGA ONLINE SOFTWARE', deliverer_name, plate, romaneio_number].filter(Boolean));
  const isHeaderNoise = (l) =>
    HEADER_NOISE.has(l) ||
    /^P[aá]gina:/i.test(l) || /^ROMANEIO/i.test(l) || /^Entregador:$/i.test(l) || /^Placa:$/i.test(l) ||
    /^Data:\s*\d{2}\/\d{2}\/\d{4}$/i.test(l) || /^\d{2}:\d{2}:\d{2}$/.test(l);

  for (let i = 1; i < parts.length; i++) {
    let lines = parts[i].split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const blobMatch = lines[0].match(/^(\d+)$/);
    if (!blobMatch) { warnings.push(`Bloco ${i}: não consegui identificar Seq/Venda — revise manualmente.`); continue; }
    const blob = blobMatch[1];
    // Nº de venda do Mega Online sempre tem 7 dígitos; o resto na frente é o Seq.
    const vendaNumber = blob.length > 7 ? blob.slice(-7) : blob;
    const seq = blob.length > 7 ? blob.slice(0, -7) : String(i);

    // Corta no fim da parada (evita pegar o resumo final ou a próxima página).
    const subtotalIdxRaw = lines.findIndex((l) => /^SubTotal\s*=>/i.test(l));
    if (subtotalIdxRaw > 0) lines = lines.slice(0, subtotalIdxRaw + 1);
    lines = lines.filter((l) => !isHeaderNoise(l) && l !== blob);

    const clientLine = lines.find((l) => /^\d+-.+/.test(l));
    const clientMatch = clientLine ? clientLine.match(/^(\d+)-(.+)$/) : null;

    const fantasiaIdx = lines.findIndex((l) => /^Fantasia:$/i.test(l));
    const fantasyName = fantasiaIdx >= 0 && lines[fantasiaIdx + 1] ? lines[fantasiaIdx + 1] : null;

    const dateLine = lines.find((l) => /^\d{2}\/\d{2}\/\d{4}$/.test(l));
    const deliveryDate = dateLine ? brDateToISO(dateLine) : romaneio_date;

    const vendedorIdx = lines.findIndex((l) => /Vendedor:.*Data:|Data:.*Vendedor:/i.test(l));
    const salesperson = vendedorIdx >= 0 && lines[vendedorIdx + 1] ? lines[vendedorIdx + 1] : null;

    const cityStateLine = lines.find((l) => /\/(.+)\/([A-Z]{2})$/.test(l));
    const cityStateMatch = cityStateLine ? cityStateLine.match(/\/(.+)\/([A-Z]{2})$/) : null;

    const phones = lines.filter((l) => /^\d{8,13}$/.test(l)).slice(0, 2);

    const products = [];
    for (const line of lines) {
      if (!/^PRD/i.test(line)) continue;
      const p = parseProductLine(line);
      if (p) products.push(p);
    }

    const subIdx2 = lines.findIndex((l) => /^SubTotal\s*=>/i.test(l));
    const subtotalBlobLine = subIdx2 > 0 ? lines[subIdx2 - 1] : null;
    let valorTotal = 0;
    if (subtotalBlobLine) {
      const parsed = parseSubtotalBlob(subtotalBlobLine);
      if (parsed) valorTotal = parsed.valor;
    }
    if (!valorTotal && products.length) valorTotal = products.reduce((s, p) => s + p.total_value, 0);

    const isNoise = (l) =>
      l === clientLine || l === dateLine || l === cityStateLine ||
      l === fantasyName || l === salesperson || l === subtotalBlobLine ||
      phones.includes(l) ||
      /^(Cliente:|Fone:|Cel\.:|Venda\s*N[ºo]|Fantasia:|Vendedor:.*Data:|Data:.*Vendedor:|Produto.*Un\.?$|SubTotal\s*=>|PRD\S+)/i.test(l);

    const addressLines = lines.filter((l) => !isNoise(l));

    const stop = {
      seq: parseInt(seq, 10) || i,
      venda_number: vendaNumber,
      client_code: clientMatch ? clientMatch[1] : null,
      client_name: clientMatch ? clientMatch[2].trim() : null,
      fantasy_name: fantasyName,
      delivery_date: deliveryDate,
      salesperson,
      phone: phones[0] || null,
      phone2: phones[1] || null,
      address_raw: addressLines.join(', '),
      city: cityStateMatch ? cityStateMatch[1].trim() : null,
      state: cityStateMatch ? cityStateMatch[2].trim() : null,
      products,
      weight_total: 0,
      value_total: valorTotal,
    };

    if (!stop.client_code || !products.length) {
      warnings.push(`Parada Seq ${stop.seq} (cliente ${stop.client_code || '?'}): dados possivelmente incompletos, revise antes de importar.`);
    }
    stops.push(stop);
  }

  if (!stops.length) {
    warnings.push('Nenhuma parada foi reconhecida no PDF. O layout pode ser diferente do esperado — revise manualmente.');
  }

  return { romaneio_number, romaneio_date, romaneio_time, deliverer_name, plate, stops, warnings };
}

const romaneioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Envie um arquivo PDF'));
  },
});

// Preview: faz o parse do PDF e sugere vínculos (PDV, motorista, veículo) sem gravar nada
router.post('/romaneio/parse', romaneioUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const pdfData = await pdfParse(req.file.buffer);
    const parsed = parseRomaneioText(pdfData.text);
    const org = orgId(req);

    let matched_driver = null;
    if (parsed.deliverer_name) {
      const d = await query(
        `SELECT id, full_name FROM smartroute_drivers WHERE organization_id=$1 AND active=true AND full_name ILIKE $2 LIMIT 1`,
        [org, `%${parsed.deliverer_name}%`]
      );
      matched_driver = d.rows[0] || null;
    }

    let matched_vehicle = null;
    if (parsed.plate) {
      const v = await query(
        `SELECT id, plate FROM smartroute_vehicles WHERE organization_id=$1 AND REPLACE(UPPER(plate),'-','')=$2 LIMIT 1`,
        [org, parsed.plate.toUpperCase().replace(/-/g, '')]
      );
      matched_vehicle = v.rows[0] || null;
    }

    let existing_route = null;
    if (parsed.romaneio_number) {
      const ex = await query(`SELECT id, code FROM smartroute_routes WHERE organization_id=$1 AND romaneio_number=$2`, [org, parsed.romaneio_number]);
      existing_route = ex.rows[0] || null;
    }

    const codes = parsed.stops.map((s) => s.client_code).filter(Boolean);
    let pdvByCode = new Map();
    if (codes.length) {
      const p = await query(
        `SELECT id, name, erp_code FROM smartroute_pdvs WHERE organization_id=$1 AND erp_code = ANY($2::text[])`,
        [org, codes]
      );
      pdvByCode = new Map(p.rows.map((row) => [row.erp_code, row]));
    }
    const allPdvs = await query(`SELECT id, name FROM smartroute_pdvs WHERE organization_id=$1 AND active=true`, [org]);

    const stopsWithMatch = parsed.stops.map((stop) => {
      const byCode = pdvByCode.get(stop.client_code);
      if (byCode) return { ...stop, matched_pdv_id: byCode.id, matched_pdv_name: byCode.name, match_type: 'code' };

      const nameKey = stop.client_name.toLowerCase().slice(0, 12);
      const byName = nameKey ? allPdvs.rows.find((p) => p.name && p.name.toLowerCase().includes(nameKey)) : null;
      if (byName) return { ...stop, matched_pdv_id: byName.id, matched_pdv_name: byName.name, match_type: 'name_guess' };

      return { ...stop, matched_pdv_id: null, matched_pdv_name: null, match_type: 'none' };
    });

    const debug_raw_text = parsed.stops.length === 0 ? String(pdfData.text || '').slice(0, 4000) : undefined;

    res.json({ ...parsed, stops: stopsWithMatch, matched_driver, matched_vehicle, existing_route, debug_raw_text });
  } catch (e) {
    logError('smartroute.romaneio.parse', e);
    res.status(500).json({ error: e.message || 'Falha ao processar o PDF' });
  }
});

// Commit: grava PDVs novos, pedidos, rota e paradas a partir do preview (já revisado pelo usuário)
router.post('/romaneio/commit', async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const org = orgId(req);
    if (!Array.isArray(b.stops) || !b.stops.length) {
      client.release();
      return res.status(400).json({ error: 'Nenhuma parada para importar' });
    }

    await client.query('BEGIN');

    if (b.romaneio_number && !b.force) {
      const ex = await client.query(`SELECT id FROM smartroute_routes WHERE organization_id=$1 AND romaneio_number=$2`, [org, b.romaneio_number]);
      if (ex.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Este romaneio já foi importado anteriormente', route_id: ex.rows[0].id });
      }
    }

    let depotId = b.depot_id || null;
    let depotLat = null, depotLng = null;
    if (!depotId) {
      const d = await client.query(`SELECT id, lat, lng FROM smartroute_depots WHERE organization_id=$1 AND is_default=true AND active=true LIMIT 1`, [org]);
      if (d.rows[0]) { depotId = d.rows[0].id; depotLat = d.rows[0].lat; depotLng = d.rows[0].lng; }
    } else {
      const d = await client.query(`SELECT lat, lng FROM smartroute_depots WHERE id=$1 AND organization_id=$2`, [depotId, org]);
      if (d.rows[0]) { depotLat = d.rows[0].lat; depotLng = d.rows[0].lng; }
    }

    const code = b.romaneio_number ? `ROM-${b.romaneio_number}` : `R-${Date.now().toString(36).toUpperCase()}`;
    const notes = `Importado do romaneio ${b.romaneio_number || ''}`.trim();
    const routeRes = await client.query(
      `INSERT INTO smartroute_routes (organization_id, code, driver_id, vehicle_id, planned_date, status, depot_lat, depot_lng, depot_id, notes, romaneio_number)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'planejada',$6,$7,$8,$9,$10) RETURNING *`,
      [org, code, b.driver_id || null, b.vehicle_id || null, b.romaneio_date || null, depotLat, depotLng, depotId, notes, b.romaneio_number || null]
    );
    const route = routeRes.rows[0];

    const sortedStops = [...b.stops].sort((a, c) => (a.seq || 0) - (c.seq || 0));
    let stopCount = 0;

    for (const stop of sortedStops) {
      let pdvId = stop.pdv_id || null;

      if (!pdvId) {
        let lat = null, lng = null;
        try {
          const g = await geocodeNominatim({ address: stop.address_raw, city: stop.city, state: stop.state });
          if (g) { lat = g.lat; lng = g.lng; }
        } catch {}

        const pdvRes = await client.query(
          `INSERT INTO smartroute_pdvs (organization_id, name, address, city, state, lat, lng, contact_phone, erp_code, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
          [org, stop.fantasy_name || stop.client_name, stop.address_raw || null, stop.city || null, stop.state || null, lat, lng, stop.phone || null, stop.client_code || null]
        );
        pdvId = pdvRes.rows[0].id;
      }

      const orderNotes = `Importado do romaneio ${b.romaneio_number || ''} — Cliente ${stop.client_code || ''} (${stop.client_name || ''})`.trim();
      const orderRes = await client.query(
        `INSERT INTO smartroute_orders (organization_id, pdv_id, order_number, weight_kg, volume_m3, value_cents, items, priority, delivery_date, status, notes, owner_user_id)
         VALUES ($1,$2,$3,$4,0,$5,$6,5,$7,'pendente',$8,$9) RETURNING id`,
        [
          org, pdvId, stop.venda_number || null, stop.weight_total || 0,
          Math.round((stop.value_total || 0) * 100),
          JSON.stringify(stop.products || []),
          stop.delivery_date || b.romaneio_date || null,
          orderNotes,
          req.user?.id || null,
        ]
      );
      const orderId = orderRes.rows[0].id;

      stopCount++;
      const stopRes = await client.query(
        `INSERT INTO smartroute_route_stops (route_id, order_id, pdv_id, sequence) VALUES ($1,$2,$3,$4) RETURNING id`,
        [route.id, orderId, pdvId, stopCount]
      );
      await client.query(`UPDATE smartroute_orders SET status='em_rota', route_stop_id=$2, updated_at=NOW() WHERE id=$1`, [orderId, stopRes.rows[0].id]);
    }

    await client.query(`UPDATE smartroute_routes SET total_stops=$2 WHERE id=$1`, [route.id, stopCount]);
    await client.query('COMMIT');

    const full = await query(
      `SELECT r.*, d.full_name AS driver_name, v.plate AS vehicle_plate FROM smartroute_routes r
       LEFT JOIN smartroute_drivers d ON d.id=r.driver_id LEFT JOIN smartroute_vehicles v ON v.id=r.vehicle_id
       WHERE r.id=$1`,
      [route.id]
    );
    res.json({ route: full.rows[0], stops_created: stopCount });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    logError('smartroute.romaneio.commit', e);
    res.status(500).json({ error: e.message || 'Falha ao importar romaneio' });
  } finally {
    client.release();
  }
});

export default router;






