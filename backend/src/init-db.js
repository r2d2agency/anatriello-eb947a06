import { pool } from './db.js';

// ============================================
// STEP 1: ENUMS (must be first)
// ============================================
const step1Enums = `
DO $$
BEGIN
  -- Create enum if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('owner', 'admin', 'manager', 'agent', 'user');
  ELSE
    -- Ensure all expected values exist (supports older schemas)
    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'owner';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'admin';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'manager';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'agent';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    BEGIN
      ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'user';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
`;

// ============================================
// STEP 2: CORE TABLES (no foreign key dependencies)
// ============================================
const step2CoreTables = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_superadmin BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add is_superadmin column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Plans table (SaaS)
CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    max_connections INTEGER NOT NULL DEFAULT 1,
    max_monthly_messages INTEGER NOT NULL DEFAULT 1000,
    max_users INTEGER NOT NULL DEFAULT 5,
    max_supervisors INTEGER NOT NULL DEFAULT 1,
    has_asaas_integration BOOLEAN DEFAULT false,
    has_chat BOOLEAN DEFAULT true,
    has_whatsapp_groups BOOLEAN DEFAULT false,
    has_campaigns BOOLEAN DEFAULT true,
    has_chatbots BOOLEAN DEFAULT true,
    has_scheduled_messages BOOLEAN DEFAULT true,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    billing_period VARCHAR(20) DEFAULT 'monthly',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new plan columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_supervisors INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_whatsapp_groups BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_campaigns BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_chatbots BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_scheduled_messages BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS visible_on_signup BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS trial_days INTEGER DEFAULT 3;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_departments BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_lead_scoring BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ai_summary BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_group_secretary BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ghost BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_projects BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_lead_gleego BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_rh BOOLEAN DEFAULT true;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_doc_signatures BOOLEAN DEFAULT false;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS doc_signatures_limit INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(50);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
`;

// ============================================
// STEP 3: ORGANIZATIONS (depends on plans)
// ============================================
const step3Organizations = `
-- Organizations (multi-tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    asaas_customer_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add plan columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS integration_settings jsonb DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS asaas_customer_id VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS modules_enabled JSONB DEFAULT '{"campaigns": true, "billing": true, "groups": true, "scheduled_messages": true, "chatbots": true, "chat": true, "crm": true, "rh": true}'::jsonb;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Organização: configuração global de IA (OpenAI/Gemini)
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) DEFAULT 'none';
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_api_key TEXT;
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_preset VARCHAR(50);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme_custom_colors TEXT;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Organização: horário de trabalho para agendamento inteligente
DO $$ BEGIN
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS work_schedule JSONB DEFAULT '{
      "timezone": "America/Sao_Paulo",
      "work_days": [1,2,3,4,5],
      "work_start": "08:00",
      "work_end": "18:00",
      "lunch_start": "12:00",
      "lunch_end": "13:00",
      "slot_duration_minutes": 60,
      "buffer_minutes": 15
    }'::jsonb;
EXCEPTION WHEN duplicate_column THEN null; END $$;
`;

// ============================================
// STEP 4: USER RELATIONS (depends on users, organizations)
// ============================================
const step4UserRelations = `
-- Organization Members
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'agent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

-- User roles (legacy/global roles)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    UNIQUE (user_id, role)
);
`;

// ============================================
// STEP 5: CONNECTIONS (depends on users, organizations)
// ============================================
const step5Connections = `
-- WhatsApp Connections (Evolution API + W-API)
CREATE TABLE IF NOT EXISTS connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,

    -- Evolution provider fields (nullable because W-API doesn't use them)
    api_url VARCHAR(500),
    api_key VARCHAR(500),
    instance_name VARCHAR(255),

    -- Multi-provider fields
    provider VARCHAR(20) NOT NULL DEFAULT 'evolution',
    instance_id VARCHAR(255),
    wapi_token TEXT,

    status VARCHAR(50) DEFAULT 'disconnected',
    phone_number VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add organization_id column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add webhook_url column if not exists
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS webhook_url TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- W-API / multi-provider columns (for existing databases)
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'evolution';
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS instance_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS wapi_token TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS show_groups BOOLEAN DEFAULT false;
    -- Meta Cloud API columns
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_token TEXT;
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_phone_number_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_waba_id VARCHAR(255);
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS meta_webhook_verify_token VARCHAR(255);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Ensure nullable Evolution-only columns (required by Evolution, but unused by W-API)
DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN api_url DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN api_key DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ALTER COLUMN instance_name DROP NOT NULL;
EXCEPTION WHEN others THEN null; END $$;

-- Enforce required fields per provider (drop old constraints and recreate to include meta)
DO $$
BEGIN
    -- Normalize provider
    UPDATE connections SET provider = 'evolution' WHERE provider IS NULL;

    -- Drop old constraints to recreate with meta support
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_provider_chk') THEN
        ALTER TABLE connections DROP CONSTRAINT connections_provider_chk;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connections_provider_required_fields_chk') THEN
        ALTER TABLE connections DROP CONSTRAINT connections_provider_required_fields_chk;
    END IF;

    -- Provider value constraint (now includes meta)
    ALTER TABLE connections
    ADD CONSTRAINT connections_provider_chk
    CHECK (provider IN ('evolution', 'wapi', 'meta'));

    -- Required fields per provider constraint (now includes meta)
    ALTER TABLE connections
    ADD CONSTRAINT connections_provider_required_fields_chk
    CHECK (
        (provider = 'wapi' AND instance_id IS NOT NULL AND wapi_token IS NOT NULL)
        OR
        (provider = 'evolution' AND api_url IS NOT NULL AND api_key IS NOT NULL AND instance_name IS NOT NULL)
        OR
        (provider = 'meta' AND meta_token IS NOT NULL AND meta_phone_number_id IS NOT NULL AND meta_waba_id IS NOT NULL)
    );
END $$;


-- Connection Members
CREATE TABLE IF NOT EXISTS connection_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    can_view BOOLEAN DEFAULT true,
    can_send BOOLEAN DEFAULT true,
    can_manage BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, user_id)
);
`;

// ============================================
// STEP 6: CONTACTS & MESSAGES (depends on users, connections)
// ============================================
const step6ContactsMessages = `
-- Contact Lists
CREATE TABLE IF NOT EXISTS contact_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add connection_id column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE contact_lists ADD COLUMN IF NOT EXISTS connection_id UUID REFERENCES connections(id) ON DELETE CASCADE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID REFERENCES contact_lists(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    jid VARCHAR(100),
    profile_picture_url TEXT,
    push_name VARCHAR(255),
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add missing columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_whatsapp BOOLEAN;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS jid VARCHAR(100);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS push_name VARCHAR(255);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source VARCHAR(255);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Message Templates
CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

// ============================================
// STEP 7: CAMPAIGNS (depends on contacts, messages, connections)
// ============================================
const step7Campaigns = `
-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    list_id UUID REFERENCES contact_lists(id) ON DELETE SET NULL,
    message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    start_time VARCHAR(10),
    end_time VARCHAR(10),
    min_delay INTEGER DEFAULT 120,
    max_delay INTEGER DEFAULT 300,
    pause_after_messages INTEGER DEFAULT 20,
    pause_duration INTEGER DEFAULT 10,
    random_order BOOLEAN DEFAULT false,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new campaign columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_time VARCHAR(10);
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_time VARCHAR(10);
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pause_after_messages INTEGER DEFAULT 20;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS pause_duration INTEGER DEFAULT 10;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS random_order BOOLEAN DEFAULT false;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS flow_id UUID;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add foreign key for flow_id if flows table exists
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'flows') THEN
        BEGIN
            ALTER TABLE campaigns 
            ADD CONSTRAINT campaigns_flow_id_fkey 
            FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE SET NULL;
        EXCEPTION 
            WHEN duplicate_object THEN null;
        END;
    END IF;
END $$;

-- Create index for flow-based campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_flow_id ON campaigns(flow_id);

-- Campaign Messages Log
CREATE TABLE IF NOT EXISTS campaign_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add new campaign_messages columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES message_templates(id) ON DELETE SET NULL;
    ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;
`;

// ============================================
// STEP 8: ASAAS INTEGRATION (depends on organizations, connections)
// ============================================
const step8Asaas = `
-- Asaas Integrations
CREATE TABLE IF NOT EXISTS asaas_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
    api_key VARCHAR(500) NOT NULL,
    environment VARCHAR(20) DEFAULT 'sandbox',
    webhook_token VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Billing Notification Rules
CREATE TABLE IF NOT EXISTS billing_notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    days_offset INTEGER NOT NULL DEFAULT 0,
    max_days_overdue INTEGER,
    message_template TEXT NOT NULL,
    send_time TIME DEFAULT '09:00',
    min_delay INTEGER DEFAULT 120,
    max_delay INTEGER DEFAULT 300,
    pause_after_messages INTEGER DEFAULT 20,
    pause_duration INTEGER DEFAULT 600,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add delay columns if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS min_delay INTEGER DEFAULT 120;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS max_delay INTEGER DEFAULT 300;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS pause_after_messages INTEGER DEFAULT 20;
    ALTER TABLE billing_notification_rules ADD COLUMN IF NOT EXISTS pause_duration INTEGER DEFAULT 600;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Asaas Customers (cached)
CREATE TABLE IF NOT EXISTS asaas_customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asaas_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    cpf_cnpj VARCHAR(20),
    external_reference VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, asaas_id)
);

-- Asaas Payments (cached)
CREATE TABLE IF NOT EXISTS asaas_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    asaas_id VARCHAR(100) NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE,
    asaas_customer_id VARCHAR(100) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    net_value DECIMAL(10, 2),
    due_date DATE NOT NULL,
    billing_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    payment_link TEXT,
    invoice_url TEXT,
    bank_slip_url TEXT,
    pix_qr_code TEXT,
    pix_copy_paste TEXT,
    description TEXT,
    external_reference VARCHAR(255),
    confirmed_date DATE,
    payment_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, asaas_id)
);

-- Billing Notifications Log
CREATE TABLE IF NOT EXISTS billing_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    payment_id UUID REFERENCES asaas_payments(id) ON DELETE CASCADE NOT NULL,
    rule_id UUID REFERENCES billing_notification_rules(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Asaas Webhook Events Log
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    payment_id VARCHAR(100),
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ASAAS v3 (advanced billing controls)
-- These columns/tables are required by backend/src/routes/asaas.js
-- ============================================

-- Customer blacklist + pause controls
DO $$ BEGIN
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMP WITH TIME ZONE;

    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT false;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE asaas_customers ADD COLUMN IF NOT EXISTS billing_paused_reason TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Integration settings (limits/alerts/global pause)
DO $$ BEGIN
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS daily_message_limit_per_customer INTEGER;

    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN DEFAULT false;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused_until TIMESTAMP WITH TIME ZONE;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS billing_paused_reason TEXT;

    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS critical_alert_threshold DECIMAL(10, 2);
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS critical_alert_days INTEGER;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_email TEXT;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_whatsapp BOOLEAN DEFAULT false;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS alert_connection_id UUID REFERENCES connections(id) ON DELETE SET NULL;

    -- Auto-sync settings (for 2AM/8AM CRON jobs)
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN DEFAULT true;
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS sync_time_morning VARCHAR(5) DEFAULT '02:00';
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS check_time_morning VARCHAR(5) DEFAULT '08:00';
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS last_check_at TIMESTAMP WITH TIME ZONE;
    
    -- Webhook configuration
    ALTER TABLE asaas_integrations ADD COLUMN IF NOT EXISTS webhook_url TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Daily message count per customer (anti-spam)
CREATE TABLE IF NOT EXISTS billing_daily_message_count (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE NOT NULL,
    day DATE NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (customer_id, day)
);

-- Critical delinquency alerts
CREATE TABLE IF NOT EXISTS billing_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES asaas_customers(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    total_overdue DECIMAL(12, 2),
    days_overdue INTEGER,
    is_read BOOLEAN DEFAULT false,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`;

// ============================================
// STEP 9: CHAT SYSTEM (depends on connections, users, organizations)
// ============================================
const step9Chat = `
-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    remote_jid VARCHAR(100) NOT NULL,
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    last_message_at TIMESTAMP WITH TIME ZONE,
    unread_count INTEGER DEFAULT 0,
    is_archived BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, remote_jid)
);

-- Add is_pinned column if not exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name VARCHAR(255);
    -- chat_messages is created later in this same step, so add only the column here.
    -- The foreign key is attached after chat_messages exists.
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_message_id UUID;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Allow NULL connection_id on conversations (preserve conversations when connection is deleted)
DO $$ BEGIN
    -- Drop old CASCADE constraint and re-add as SET NULL
    ALTER TABLE conversations ALTER COLUMN connection_id DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    -- Drop the old unique constraint and create a partial one that allows nulls
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_remote_jid_key;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_id_remote_jid_key 
    ON conversations (connection_id, remote_jid) WHERE connection_id IS NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Change FK from CASCADE to SET NULL for conversations.connection_id
DO $$ BEGIN
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;
    ALTER TABLE conversations ADD CONSTRAINT conversations_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Allow NULL connection_id on chat_contacts
DO $$ BEGIN
    ALTER TABLE chat_contacts ALTER COLUMN connection_id DROP NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE chat_contacts DROP CONSTRAINT IF EXISTS chat_contacts_connection_id_fkey;
    ALTER TABLE chat_contacts ADD CONSTRAINT chat_contacts_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Change contact_lists FK from CASCADE to SET NULL
DO $$ BEGIN
    ALTER TABLE contact_lists DROP CONSTRAINT IF EXISTS contact_lists_connection_id_fkey;
    ALTER TABLE contact_lists ADD CONSTRAINT contact_lists_connection_id_fkey 
        FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN null;
END $$;

-- Conversation Tags
CREATE TABLE IF NOT EXISTS conversation_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (organization_id, name)
);

-- Conversation Tag Links
CREATE TABLE IF NOT EXISTS conversation_tag_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES conversation_tags(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (conversation_id, tag_id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    message_id VARCHAR(100),
    from_me BOOLEAN DEFAULT false,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT,
    message_type VARCHAR(50) DEFAULT 'text',
    media_url TEXT,
    media_mimetype VARCHAR(100),
    wa_media_key TEXT,
    quoted_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'sent',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure W-API media key column exists (for existing databases)
DO $$ BEGIN
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS wa_media_key TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add sender_name column for group messages (WhatsApp pushName)
DO $$ BEGIN
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_phone VARCHAR(50);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS transcript TEXT;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add unique index on message_id to prevent duplicates (excludes temp_ messages)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_message_id 
  ON chat_messages (message_id) 
  WHERE message_id IS NOT NULL AND message_id NOT LIKE 'temp_%';

DO $$ BEGIN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_pinned_message_id_fkey
      FOREIGN KEY (pinned_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN others THEN null;
END $$;

-- Backward compatibility: if older DB has quoted_message_id as VARCHAR, convert to UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chat_messages'
      AND column_name = 'quoted_message_id'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE chat_messages
      ALTER COLUMN quoted_message_id TYPE UUID
      USING NULLIF(quoted_message_id, '')::uuid;
  END IF;
EXCEPTION WHEN others THEN
  -- Ignore conversion errors to avoid blocking startup
  NULL;
END $$;

-- Internal Notes (Chat)
CREATE TABLE IF NOT EXISTS conversation_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Scheduled Messages (Chat)
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT,
    message_type VARCHAR(20) DEFAULT 'text',
    media_url TEXT,
    media_mimetype VARCHAR(100),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quick Replies (Chat productivity)
CREATE TABLE IF NOT EXISTS quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    shortcut VARCHAR(50),
    category VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Backward-compatible column adds (older databases may miss columns)
DO $$ BEGIN
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS shortcut VARCHAR(50);
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS created_by UUID;
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    ALTER TABLE quick_replies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;

-- Alerts (for scheduled message sent notifications)
CREATE TABLE IF NOT EXISTS user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'scheduled_message_sent',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat Contacts (agenda de contatos para chat - não campanhas)
CREATE TABLE IF NOT EXISTS chat_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    jid VARCHAR(100),
    profile_picture_url TEXT,
    push_name VARCHAR(255),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, phone)
);

-- Backward-compatible column adds for chat_contacts
DO $$ BEGIN
    ALTER TABLE chat_contacts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE chat_contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
EXCEPTION
    WHEN duplicate_column THEN null;
    WHEN others THEN null;
END $$;
`;

// ============================================
// STEP 10: SYSTEM SETTINGS
// ============================================
const step10Settings = `
-- System Settings (for branding, logos, etc)
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settings if not exists
INSERT INTO system_settings (key, value, description) VALUES
    ('logo_login', NULL, 'Logo da tela de login'),
    ('logo_sidebar', NULL, 'Logo/ícone da sidebar'),
    ('favicon', NULL, 'Favicon do sistema')
ON CONFLICT (key) DO NOTHING;
`;

// ============================================
// STEP 11: INDEXES (last step, non-critical)
// ============================================
const step11Indexes = `
DO $$
BEGIN
  IF to_regclass('public.connections') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
    CREATE INDEX IF NOT EXISTS idx_connections_org ON connections(organization_id);
  END IF;

  IF to_regclass('public.contact_lists') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contact_lists_user_id ON contact_lists(user_id);
    CREATE INDEX IF NOT EXISTS idx_contact_lists_conn ON contact_lists(connection_id);
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_contacts_list_id ON contacts(list_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_jid ON contacts(jid);
  END IF;

  IF to_regclass('public.message_templates') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates(user_id);
  END IF;

  IF to_regclass('public.campaigns') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
  END IF;

  IF to_regclass('public.campaign_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_messages_status ON campaign_messages(status);
  END IF;

  IF to_regclass('public.organization_members') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
  END IF;

  IF to_regclass('public.connection_members') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_connection_members_conn ON connection_members(connection_id);
    CREATE INDEX IF NOT EXISTS idx_connection_members_user ON connection_members(user_id);
  END IF;

  IF to_regclass('public.asaas_integrations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_asaas_integrations_org ON asaas_integrations(organization_id);
  END IF;

  IF to_regclass('public.asaas_customers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_asaas_customers_org ON asaas_customers(organization_id);
  END IF;

  IF to_regclass('public.asaas_payments') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_asaas_payments_org ON asaas_payments(organization_id);
    CREATE INDEX IF NOT EXISTS idx_asaas_payments_status ON asaas_payments(status);
    CREATE INDEX IF NOT EXISTS idx_asaas_payments_due_date ON asaas_payments(due_date);
  END IF;

  IF to_regclass('public.billing_notifications') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_billing_notifications_payment ON billing_notifications(payment_id);
  END IF;

  IF to_regclass('public.billing_alerts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_billing_alerts_org ON billing_alerts(organization_id);
    CREATE INDEX IF NOT EXISTS idx_billing_alerts_unresolved ON billing_alerts(organization_id, is_resolved) WHERE is_resolved = false;
  END IF;

  IF to_regclass('public.billing_daily_message_count') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_billing_daily_msg_customer_day ON billing_daily_message_count(customer_id, day);
  END IF;

  IF to_regclass('public.conversations') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_conversations_conn ON conversations(connection_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_to);
  END IF;

  IF to_regclass('public.chat_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
  END IF;

  IF to_regclass('public.conversation_notes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_conversation_notes_conv ON conversation_notes(conversation_id);
  END IF;

  IF to_regclass('public.scheduled_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status_time ON scheduled_messages(status, scheduled_at);
  END IF;

  IF to_regclass('public.quick_replies') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_quick_replies_org ON quick_replies(organization_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_quick_replies_shortcut_org ON quick_replies(organization_id, shortcut) WHERE shortcut IS NOT NULL;
  END IF;

  IF to_regclass('public.user_alerts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_user_alerts_user_unread ON user_alerts(user_id, is_read) WHERE is_read = false;
  END IF;

  IF to_regclass('public.chat_contacts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_chat_contacts_conn ON chat_contacts(connection_id);
    CREATE INDEX IF NOT EXISTS idx_chat_contacts_phone ON chat_contacts(phone);
  END IF;
END $$;
`;

// Step 12: Attendance Status
const step12Attendance = `
-- Attendance status columns for conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(20) DEFAULT 'waiting';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_attendance_status ON conversations(attendance_status);
CREATE INDEX IF NOT EXISTS idx_conversations_accepted_by ON conversations(accepted_by);
`;

// Step 13: Chatbots System
const step13Chatbots = `
-- Enum para provedor de IA
DO $$ BEGIN
  CREATE TYPE ai_provider AS ENUM ('gemini', 'openai', 'none');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Enum para modo de operação do chatbot
DO $$ BEGIN
  CREATE TYPE chatbot_mode AS ENUM ('always', 'business_hours', 'outside_hours', 'pre_service');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Enum para tipo de nó do fluxo
DO $$ BEGIN
  CREATE TYPE flow_node_type AS ENUM ('start', 'message', 'menu', 'input', 'condition', 'action', 'transfer', 'ai_response', 'end');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela principal de chatbots
CREATE TABLE IF NOT EXISTS chatbots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false,
  
  mode chatbot_mode DEFAULT 'always',
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  timezone VARCHAR(50) DEFAULT 'America/Sao_Paulo',
  
  ai_provider ai_provider DEFAULT 'none',
  ai_model VARCHAR(100),
  ai_api_key TEXT,
  ai_system_prompt TEXT,
  ai_temperature DECIMAL(2,1) DEFAULT 0.7,
  ai_max_tokens INTEGER DEFAULT 500,
  
  welcome_message TEXT,
  fallback_message TEXT DEFAULT 'Desculpe, não entendi. Vou transferir você para um atendente.',
  transfer_after_failures INTEGER DEFAULT 3,
  typing_delay_ms INTEGER DEFAULT 1500,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbots_organization ON chatbots(organization_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_connection ON chatbots(connection_id);
CREATE INDEX IF NOT EXISTS idx_chatbots_active ON chatbots(is_active);

-- Tabela de fluxos do chatbot
CREATE TABLE IF NOT EXISTS chatbot_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  
  node_id VARCHAR(50) NOT NULL,
  node_type flow_node_type NOT NULL,
  name VARCHAR(255),
  
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  content JSONB DEFAULT '{}',
  next_node_id VARCHAR(50),
  order_index INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_flows_chatbot ON chatbot_flows(chatbot_id);

-- Tabela de sessões do chatbot
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,
  
  current_node_id VARCHAR(50),
  variables JSONB DEFAULT '{}',
  
  is_active BOOLEAN DEFAULT true,
  failure_count INTEGER DEFAULT 0,
  transferred_at TIMESTAMP WITH TIME ZONE,
  transferred_to UUID REFERENCES users(id),
  
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_chatbot ON chatbot_sessions(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_conversation ON chatbot_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_active ON chatbot_sessions(is_active);

-- Tabela de mensagens do chatbot
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chatbot_sessions(id) ON DELETE CASCADE,
  
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  content TEXT,
  message_type VARCHAR(20) DEFAULT 'text',
  media_url TEXT,
  
  node_id VARCHAR(50),
  ai_generated BOOLEAN DEFAULT false,
  ai_tokens_used INTEGER,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_session ON chatbot_messages(session_id);

-- Tabela de estatísticas
CREATE TABLE IF NOT EXISTS chatbot_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  
  total_sessions INTEGER DEFAULT 0,
  completed_sessions INTEGER DEFAULT 0,
  transferred_sessions INTEGER DEFAULT 0,
  
  total_messages_in INTEGER DEFAULT 0,
  total_messages_out INTEGER DEFAULT 0,
  
  ai_requests INTEGER DEFAULT 0,
  ai_tokens_used INTEGER DEFAULT 0,
  
  avg_session_duration_seconds INTEGER,
  avg_messages_per_session DECIMAL(5,2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_stats_chatbot_date ON chatbot_stats(chatbot_id, date);
`;

// Step 14: Chatbot Permissions
const step14ChatbotPermissions = `
-- Enum para nível de permissão de chatbot
DO $$ BEGIN
  CREATE TYPE chatbot_permission_level AS ENUM ('view', 'edit', 'manage', 'owner');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela de múltiplas conexões por chatbot
CREATE TABLE IF NOT EXISTS chatbot_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_connections_chatbot ON chatbot_connections(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_connections_connection ON chatbot_connections(connection_id);

-- Tabela de permissões de usuário para chatbots
CREATE TABLE IF NOT EXISTS chatbot_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_level chatbot_permission_level NOT NULL DEFAULT 'view',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_permissions_chatbot ON chatbot_permissions(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_permissions_user ON chatbot_permissions(user_id);

-- Configuração de permissões por papel (role-based)
CREATE TABLE IF NOT EXISTS chatbot_role_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  
  -- Quais papéis podem fazer o quê
  owner_can_manage BOOLEAN DEFAULT true,
  admin_can_manage BOOLEAN DEFAULT true,
  admin_can_edit BOOLEAN DEFAULT true,
  manager_can_view BOOLEAN DEFAULT true,
  manager_can_edit BOOLEAN DEFAULT false,
  agent_can_view BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_role_settings_chatbot ON chatbot_role_settings(chatbot_id);

-- Migrar connection_id existente para chatbot_connections
INSERT INTO chatbot_connections (chatbot_id, connection_id)
SELECT id, connection_id FROM chatbots WHERE connection_id IS NOT NULL
ON CONFLICT DO NOTHING;
`;

// Step 15: Chatbot Team Assignment & Keywords
const step15ChatbotTeamKeywords = `
-- Atendente padrão do chatbot (recebe transferências)
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS default_agent_id UUID REFERENCES users(id);

-- Palavras-chave para ativação automática do fluxo
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS trigger_keywords TEXT[] DEFAULT '{}';
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS trigger_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chatbots_trigger_keywords ON chatbots USING GIN(trigger_keywords);
CREATE INDEX IF NOT EXISTS idx_chatbots_default_agent ON chatbots(default_agent_id);

-- Tabela de equipe de atendentes do chatbot
CREATE TABLE IF NOT EXISTS chatbot_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(chatbot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatbot_agents_chatbot ON chatbot_agents(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_agents_user ON chatbot_agents(user_id);

-- Sessões de fluxo ativas em conversas (para encaminhamento manual)
CREATE TABLE IF NOT EXISTS conversation_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chatbot_id UUID NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  current_node_id TEXT,
  variables JSONB DEFAULT '{}',
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'transferred')),
  
  UNIQUE(conversation_id) -- apenas um fluxo ativo por conversa
);

CREATE INDEX IF NOT EXISTS idx_conversation_flows_conversation ON conversation_flows(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flows_chatbot ON conversation_flows(chatbot_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flows_status ON conversation_flows(status);
`;

// Step 16: Independent Flows System
const step16IndependentFlows = `
-- Fluxos independentes (separados dos chatbots)
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Ativação por palavra-chave
  trigger_enabled BOOLEAN DEFAULT false,
  trigger_keywords TEXT[] DEFAULT '{}',
  trigger_match_mode VARCHAR(20) DEFAULT 'exact' CHECK (trigger_match_mode IN ('exact', 'contains', 'starts_with')),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_draft BOOLEAN DEFAULT true,
  
  -- Conexões vinculadas
  connection_ids UUID[] DEFAULT '{}',
  
  -- Metadata
  version INTEGER DEFAULT 1,
  last_edited_by UUID REFERENCES users(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_organization ON flows(organization_id);
CREATE INDEX IF NOT EXISTS idx_flows_active ON flows(is_active);
CREATE INDEX IF NOT EXISTS idx_flows_trigger_keywords ON flows USING GIN(trigger_keywords);

-- Nós do fluxo
CREATE TABLE IF NOT EXISTS flow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  node_id VARCHAR(100) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  
  content JSONB DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow ON flow_nodes(flow_id);

-- Arestas do fluxo (conexões entre nós)
CREATE TABLE IF NOT EXISTS flow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  
  edge_id VARCHAR(100) NOT NULL,
  source_node_id VARCHAR(100) NOT NULL,
  target_node_id VARCHAR(100) NOT NULL,
  source_handle VARCHAR(50),
  target_handle VARCHAR(50),
  
  label VARCHAR(255),
  edge_type VARCHAR(50) DEFAULT 'default',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_edges_flow ON flow_edges(flow_id);

-- Sessões de execução do fluxo (necessário para continuar após Input/Menu via webhooks)
CREATE TABLE IF NOT EXISTS flow_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,

  -- Estado atual
  current_node_id VARCHAR(100) NOT NULL DEFAULT 'start',
  variables JSONB DEFAULT '{}'::jsonb,

  -- Controle
  is_active BOOLEAN DEFAULT true,
  started_by UUID REFERENCES users(id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE
);

-- Backward/forward compatibility (for existing DBs)
DO $$ BEGIN
  ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
  ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Apenas uma sessão ativa por conversa (permite ON CONFLICT (conversation_id) WHERE is_active = true)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_flow_sessions_active_conversation
  ON flow_sessions(conversation_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_flow_sessions_flow ON flow_sessions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_conversation ON flow_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_sessions_active ON flow_sessions(is_active);

-- Histórico de versões do fluxo
CREATE TABLE IF NOT EXISTS flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  
  nodes_data JSONB NOT NULL,
  edges_data JSONB NOT NULL,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_flow ON flow_versions(flow_id);

-- Vincular chatbot a um fluxo
ALTER TABLE chatbots ADD COLUMN IF NOT EXISTS linked_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_chatbots_linked_flow ON chatbots(linked_flow_id);

-- Categorias de fluxos
CREATE TABLE IF NOT EXISTS flow_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(20) DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flow_categories_org ON flow_categories(organization_id);

-- Categoria no fluxo
ALTER TABLE flows ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES flow_categories(id) ON DELETE SET NULL;

-- Membros com acesso ao fluxo
CREATE TABLE IF NOT EXISTS flow_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(flow_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_flow_members_flow ON flow_members(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_members_user ON flow_members(user_id);
`;

// Step 18: CRM System
const step18CRM = `
-- CRM User Groups
CREATE TABLE IF NOT EXISTS crm_user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm_user_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    is_supervisor BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- CRM Funnels
CREATE TABLE IF NOT EXISTS crm_funnels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#6366f1',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    position INTEGER NOT NULL DEFAULT 0,
    inactivity_hours INTEGER DEFAULT 24,
    inactivity_color VARCHAR(20) DEFAULT '#ef4444',
    is_final BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Companies
CREATE TABLE IF NOT EXISTS crm_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    cnpj VARCHAR(20),
    email VARCHAR(255),
    phone VARCHAR(50),
    website VARCHAR(500),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Deals
CREATE TABLE IF NOT EXISTS crm_deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    -- Ordering within a stage (Kanban drag & drop)
    position INTEGER NOT NULL DEFAULT 0,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    value DECIMAL(15, 2) DEFAULT 0,
    probability INTEGER DEFAULT 50,
    expected_close_date DATE,
    status VARCHAR(20) DEFAULT 'open',
    won_at TIMESTAMP WITH TIME ZONE,
    lost_at TIMESTAMP WITH TIME ZONE,
    lost_reason TEXT,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    description TEXT,
    tags TEXT[],
    custom_fields JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure position exists for older databases (and backfill a stable order)
DO $$ BEGIN
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

DO $$
DECLARE
  total_count BIGINT;
  zero_count BIGINT;
BEGIN
  -- If the column is newly added, all rows will be 0. Backfill a deterministic order.
  SELECT COUNT(*) INTO total_count FROM crm_deals;
  SELECT COUNT(*) INTO zero_count FROM crm_deals WHERE position = 0;

  IF total_count > 0 AND zero_count = total_count THEN
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY organization_id, stage_id
               ORDER BY created_at ASC, id ASC
             ) - 1 AS new_pos
      FROM crm_deals
      WHERE stage_id IS NOT NULL
    )
    UPDATE crm_deals d
    SET position = r.new_pos
    FROM ranked r
    WHERE d.id = r.id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_deal_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    role VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id, contact_id)
);

CREATE TABLE IF NOT EXISTS crm_deal_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    from_value TEXT,
    to_value TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Tasks
CREATE TABLE IF NOT EXISTS crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE,
    company_id UUID REFERENCES crm_companies(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'task',
    priority VARCHAR(20) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    reminder_at TIMESTAMP WITH TIME ZONE,
    reminder_minutes INTEGER DEFAULT NULL,
    reminder_whatsapp BOOLEAN DEFAULT false,
    reminder_popup BOOLEAN DEFAULT true,
    reminder_sent BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMP WITH TIME ZONE,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Indexes
CREATE INDEX IF NOT EXISTS idx_crm_user_groups_org ON crm_user_groups(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_group ON crm_user_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_user_group_members_user ON crm_user_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_funnels_org ON crm_funnels(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_stages_funnel ON crm_stages(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_org ON crm_companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_org ON crm_deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_funnel ON crm_deals(funnel_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_company ON crm_deals(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_owner ON crm_deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_activity ON crm_deals(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage_position ON crm_deals(organization_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_crm_deal_contacts_deal ON crm_deal_contacts(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_history_deal ON crm_deal_history(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_org ON crm_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_deal ON crm_tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
`;

// Step 19: CRM Configuration (Task Types, Segments, Custom Fields)
const step19CRMConfig = `
-- Task Types (Global + Organization-specific)
CREATE TABLE IF NOT EXISTS crm_task_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT 'check-square',
    color VARCHAR(20) DEFAULT '#6366f1',
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint for global task types (only one per name when is_global=true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_task_types_global_name 
  ON crm_task_types (name) WHERE is_global = true;

-- Add unique constraint for organization task types
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_task_types_org_name 
  ON crm_task_types (organization_id, name) WHERE organization_id IS NOT NULL;

-- Segments/Tags for Deals
CREATE TABLE IF NOT EXISTS crm_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#6366f1',
    description TEXT,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Deal Segments (Many-to-Many)
CREATE TABLE IF NOT EXISTS crm_deal_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    segment_id UUID REFERENCES crm_segments(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id, segment_id)
);

-- Custom Fields Definition
CREATE TABLE IF NOT EXISTS crm_custom_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- 'deal', 'company', 'task'
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(200) NOT NULL,
    field_type VARCHAR(50) DEFAULT 'text', -- text, number, date, select, multiselect, boolean
    options JSONB, -- for select/multiselect
    is_required BOOLEAN DEFAULT false,
    is_global BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_task_types_org ON crm_task_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_segments_org ON crm_segments(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_segments_deal ON crm_deal_segments(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_segments_segment ON crm_deal_segments(segment_id);
CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_org ON crm_custom_fields(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_custom_fields_entity ON crm_custom_fields(entity_type);

-- Insert default global task types (with conflict handling)
INSERT INTO crm_task_types (name, icon, color, is_global, position) VALUES
    ('Tarefa', 'check-square', '#6366f1', true, 0),
    ('Ligação', 'phone', '#22c55e', true, 1),
    ('E-mail', 'mail', '#f59e0b', true, 2),
    ('Reunião', 'calendar', '#8b5cf6', true, 3),
    ('WhatsApp', 'message-circle', '#25d366', true, 4),
    ('Follow-up', 'repeat', '#ec4899', true, 5)
ON CONFLICT (name) WHERE is_global = true DO NOTHING;

-- Loss Reasons (motivos de perda)
CREATE TABLE IF NOT EXISTS crm_loss_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    position INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_loss_reasons_org ON crm_loss_reasons(organization_id);

-- Cleanup duplicate global loss reasons (in case init ran multiple times)
DELETE FROM crm_loss_reasons
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC) AS rn
    FROM crm_loss_reasons
    WHERE organization_id IS NULL
  ) t
  WHERE rn > 1
);

-- Unique constraints to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_loss_reasons_global_name
  ON crm_loss_reasons (name) WHERE organization_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_loss_reasons_org_name
  ON crm_loss_reasons (organization_id, name) WHERE organization_id IS NOT NULL;

-- Add loss_reason_id to crm_deals if not exists
DO $$ BEGIN
    ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS loss_reason_id UUID REFERENCES crm_loss_reasons(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Insert default loss reasons
INSERT INTO crm_loss_reasons (name, description, is_active, position) VALUES
    ('Preço muito alto', 'Cliente achou o valor elevado para o orçamento disponível', true, 0),
    ('Optou pela concorrência', 'Cliente escolheu um concorrente', true, 1),
    ('Sem orçamento', 'Cliente não possui verba disponível no momento', true, 2),
    ('Timing inadequado', 'O momento não é propício para a compra', true, 3),
    ('Não respondeu', 'Cliente parou de responder às tentativas de contato', true, 4),
    ('Mudança de prioridades', 'O projeto/necessidade deixou de ser prioridade', true, 5),
    ('Proposta não atende', 'Produto/serviço não atende às necessidades do cliente', true, 6)
ON CONFLICT (name) WHERE organization_id IS NULL DO NOTHING;
`;

// Step 17: Departments / Queues System (depends on organizations, users, conversations)
// NOTE: This was previously defined only in a standalone SQL file, but not executed
// during initDatabase(). If the tables don't exist, /api/departments will 500.
const step17Departments = `
-- Schema para sistema de Filas/Departamentos de Atendimento
-- Cada organização pode ter múltiplos departamentos
-- Cada usuário pode pertencer a múltiplos departamentos

-- Tabela de departamentos/filas
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'users',

  is_active BOOLEAN DEFAULT true,

  max_concurrent_chats INTEGER DEFAULT 5,
  auto_assign BOOLEAN DEFAULT false,

  business_hours_enabled BOOLEAN DEFAULT false,
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],

  welcome_message TEXT,
  offline_message TEXT,
  queue_message TEXT DEFAULT 'Você está na fila de espera. Em breve um atendente irá te atender.',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

-- Índices para departments
CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

-- Tabela de membros do departamento (relação N:N entre users e departments)
CREATE TABLE IF NOT EXISTS department_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  role VARCHAR(20) DEFAULT 'agent' CHECK (role IN ('supervisor', 'agent')),

  is_available BOOLEAN DEFAULT true,
  current_chats INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(department_id, user_id)
);

-- Índices para department_members
CREATE INDEX IF NOT EXISTS idx_department_members_department ON department_members(department_id);
CREATE INDEX IF NOT EXISTS idx_department_members_user ON department_members(user_id);
CREATE INDEX IF NOT EXISTS idx_department_members_available ON department_members(is_available);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_department_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_departments_updated_at ON departments;
CREATE TRIGGER trigger_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION update_department_updated_at();
`;

// Step 17b: Add department_id to conversations (separate step to avoid dependency issues)
const step17bDepartmentConversations = `
-- Adicionar coluna de departamento na tabela de conversas (se não existir)
DO $$ BEGIN
  ALTER TABLE conversations ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
EXCEPTION
  WHEN undefined_table THEN null;
  WHEN undefined_column THEN null;
END $$;

-- Índice para buscar conversas por departamento
CREATE INDEX IF NOT EXISTS idx_conversations_department ON conversations(department_id);
`;

// Step 20: CRM Migrations (additional columns)
const step20CRMMigrations = `
-- Add has_crm to plans table
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_crm BOOLEAN DEFAULT true;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;

-- Add segment_id to crm_companies (linking company to a segment)
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES crm_segments(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

-- Index for segment lookup on companies
CREATE INDEX IF NOT EXISTS idx_crm_companies_segment ON crm_companies(segment_id);

-- Add owner_id and group_id to crm_companies
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES crm_user_groups(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN undefined_table THEN null;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_companies_owner ON crm_companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_companies_group ON crm_companies(group_id);

-- Add extended company fields
DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS razao_social VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS nome_fantasia VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS inscricao_municipal VARCHAR(30);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS porte VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS cnae VARCHAR(100);
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS more_info TEXT;
EXCEPTION WHEN duplicate_column THEN null; WHEN undefined_table THEN null; END $$;
`;

// Step 21: CRM Prospects
const step21Prospects = `
-- Prospects table for simple lead management before conversion to deals
CREATE TABLE IF NOT EXISTS crm_prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    source VARCHAR(100),
    city VARCHAR(100),
    state VARCHAR(50),
    address TEXT,
    zip_code VARCHAR(20),
    is_company BOOLEAN DEFAULT false,
    custom_fields JSONB DEFAULT '{}',
    converted_at TIMESTAMP WITH TIME ZONE,
    converted_deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, phone)
);

-- Add new columns if not exists
DO $$ BEGIN
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS city VARCHAR(100);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS state VARCHAR(50);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS zip_code VARCHAR(20);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS is_company BOOLEAN DEFAULT false;
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    ALTER TABLE crm_prospects ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Indexes for prospects
CREATE INDEX IF NOT EXISTS idx_crm_prospects_org ON crm_prospects(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_phone ON crm_prospects(phone);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_converted ON crm_prospects(converted_at);

-- Prospect custom field definitions per organization
CREATE TABLE IF NOT EXISTS crm_prospect_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    field_key VARCHAR(100) NOT NULL,
    field_label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) DEFAULT 'text',
    is_required BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_crm_prospect_fields_org ON crm_prospect_fields(organization_id);
`;

// ============================================
// STEP 22: CRM AUTOMATION
// ============================================
const step22CRMAutomation = `
-- CRM Stage Automations (one per stage)
CREATE TABLE IF NOT EXISTS crm_stage_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id UUID REFERENCES crm_stages(id) ON DELETE CASCADE NOT NULL UNIQUE,
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    wait_hours INTEGER NOT NULL DEFAULT 24,
    next_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    fallback_funnel_id UUID REFERENCES crm_funnels(id) ON DELETE SET NULL,
    fallback_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    execute_immediately BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Deal Automations (active automation per deal)
CREATE TABLE IF NOT EXISTS crm_deal_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE CASCADE NOT NULL,
    automation_id UUID REFERENCES crm_stage_automations(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending',
    flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
    flow_session_id UUID,
    flow_sent_at TIMESTAMP WITH TIME ZONE,
    wait_until TIMESTAMP WITH TIME ZONE,
    responded_at TIMESTAMP WITH TIME ZONE,
    moved_at TIMESTAMP WITH TIME ZONE,
    next_stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    contact_phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CRM Automation Logs
CREATE TABLE IF NOT EXISTS crm_automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_automation_id UUID REFERENCES crm_deal_automations(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE CASCADE NOT NULL,
    action VARCHAR(50) NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for CRM Automation
CREATE INDEX IF NOT EXISTS idx_crm_stage_automations_stage ON crm_stage_automations(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_stage_automations_flow ON crm_stage_automations(flow_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_deal ON crm_deal_automations(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_status ON crm_deal_automations(status);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_wait ON crm_deal_automations(wait_until);
CREATE INDEX IF NOT EXISTS idx_crm_deal_automations_phone ON crm_deal_automations(contact_phone);
CREATE INDEX IF NOT EXISTS idx_crm_automation_logs_deal ON crm_automation_logs(deal_id);
`;

// ============================================
// STEP 23: EMAIL SYSTEM
// ============================================
const step23Email = `
-- Email SMTP configs (organization level)
CREATE TABLE IF NOT EXISTS email_smtp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    secure BOOLEAN DEFAULT true,
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    reply_to VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email SMTP configs (user level - overrides org)
CREATE TABLE IF NOT EXISTS email_user_smtp_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 587,
    secure BOOLEAN DEFAULT true,
    username VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    from_name VARCHAR(255) NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    reply_to VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) DEFAULT 'general',
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    available_variables TEXT[] DEFAULT ARRAY['nome', 'email', 'telefone', 'empresa'],
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email queue
CREATE TABLE IF NOT EXISTS email_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
    to_email VARCHAR(255) NOT NULL,
    to_name VARCHAR(255),
    cc TEXT[],
    bcc TEXT[],
    subject VARCHAR(500) NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    context_type VARCHAR(50),
    context_id UUID,
    variables JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email history
CREATE TABLE IF NOT EXISTS email_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    queue_id UUID REFERENCES email_queue(id) ON DELETE SET NULL,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    context_type VARCHAR(50),
    context_id UUID,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for email system
CREATE INDEX IF NOT EXISTS idx_email_smtp_configs_org ON email_smtp_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_user_smtp_configs_user ON email_user_smtp_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_history_org ON email_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_history_context ON email_history(context_type, context_id);
`;

// ============================================
// STEP 24: GOOGLE CALENDAR INTEGRATION
// ============================================
const step24GoogleCalendar = `
-- Google OAuth tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type VARCHAR(50) DEFAULT 'Bearer',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    scope TEXT,
    google_email VARCHAR(255),
    google_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Calendar events mapping
CREATE TABLE IF NOT EXISTS google_calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    crm_task_id UUID REFERENCES crm_tasks(id) ON DELETE CASCADE,
    crm_deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    google_event_id VARCHAR(255) NOT NULL,
    google_calendar_id VARCHAR(255) DEFAULT 'primary',
    event_summary VARCHAR(500),
    event_start TIMESTAMP WITH TIME ZONE,
    event_end TIMESTAMP WITH TIME ZONE,
    meet_link VARCHAR(500),
    sync_status VARCHAR(20) DEFAULT 'synced',
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, crm_task_id)
);

-- Add new columns if not exists (migration for existing databases)
DO $$ BEGIN
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_summary VARCHAR(500);
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_start TIMESTAMP WITH TIME ZONE;
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS event_end TIMESTAMP WITH TIME ZONE;
    ALTER TABLE google_calendar_events ADD COLUMN IF NOT EXISTS meet_link VARCHAR(500);
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- Add unique constraint on google_event_id if not exists
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'google_calendar_events_user_id_google_event_id_key'
    ) THEN
        ALTER TABLE google_calendar_events ADD CONSTRAINT google_calendar_events_user_id_google_event_id_key UNIQUE (user_id, google_event_id);
    END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_google_oauth_user ON google_oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_user ON google_calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_task ON google_calendar_events(crm_task_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_deal ON google_calendar_events(crm_deal_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_start ON google_calendar_events(event_start);
`;

// ============================================
// STEP 25: AI AGENTS MODULE
// ============================================
const step25AIAgents = `
-- Enum for AI provider
DO $$ BEGIN
  CREATE TYPE agent_ai_provider AS ENUM ('openai', 'gemini');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for knowledge source type
DO $$ BEGIN
  CREATE TYPE knowledge_source_type AS ENUM ('file', 'url', 'text');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for processing status
DO $$ BEGIN
  CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enum for agent capabilities
DO $$ BEGIN
  CREATE TYPE agent_capability AS ENUM (
    'respond_messages',
    'read_files',
    'schedule_meetings',
    'create_deals',
    'suggest_actions',
    'generate_content',
    'summarize_history',
    'qualify_leads',
    'manage_tasks',
    'google_calendar'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add new enum values if they don't exist
DO $$ BEGIN
  ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'manage_tasks';
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE agent_capability ADD VALUE IF NOT EXISTS 'google_calendar';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AI Agents main table
CREATE TABLE IF NOT EXISTS ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  ai_provider agent_ai_provider NOT NULL DEFAULT 'openai',
  ai_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual prestativo e profissional.',
  personality_traits JSONB DEFAULT '[]',
  language VARCHAR(10) DEFAULT 'pt-BR',
  temperature DECIMAL(2,1) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1000,
  context_window INTEGER DEFAULT 10,
  capabilities agent_capability[] DEFAULT ARRAY['respond_messages']::agent_capability[],
  greeting_message TEXT,
  fallback_message TEXT DEFAULT 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
  handoff_message TEXT DEFAULT 'Vou transferir você para um atendente humano.',
  handoff_keywords TEXT[] DEFAULT ARRAY['humano', 'atendente', 'pessoa'],
  auto_handoff_after_failures INTEGER DEFAULT 3,
  default_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  default_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lead_scoring_criteria JSONB DEFAULT '{}',
  auto_create_deal_funnel_id UUID,
  auto_create_deal_stage_id UUID,
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  satisfaction_score DECIMAL(3,2),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Calendar connection for agents (which user's calendar to use)
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS google_calendar_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS call_agent_config JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Knowledge sources
CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  source_type knowledge_source_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  source_content TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  original_filename VARCHAR(255),
  status processing_status DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Knowledge chunks for RAG
CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ai_knowledge_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  token_count INTEGER,
  char_count INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent sessions
CREATE TABLE IF NOT EXISTS ai_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_phone VARCHAR(50),
  contact_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  context_variables JSONB DEFAULT '{}',
  lead_score INTEGER,
  qualification_data JSONB DEFAULT '{}',
  handoff_requested BOOLEAN DEFAULT false,
  handoff_at TIMESTAMP WITH TIME ZONE,
  handoff_to_user_id UUID REFERENCES users(id),
  handoff_reason TEXT,
  message_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  paused_until TIMESTAMP WITH TIME ZONE,
  human_takeover BOOLEAN DEFAULT false,
  human_takeover_by UUID REFERENCES users(id),
  human_takeover_at TIMESTAMP WITH TIME ZONE
);

-- Agent messages
CREATE TABLE IF NOT EXISTS ai_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES ai_agent_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  media_type VARCHAR(50),
  media_url TEXT,
  knowledge_sources_used UUID[],
  context_chunks JSONB,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  tool_calls JSONB,
  tool_results JSONB,
  feedback_rating INTEGER CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
  feedback_comment TEXT,
  processing_time_ms INTEGER,
  model_used VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prompt templates
CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  template TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  is_system BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent connections (WhatsApp)
CREATE TABLE IF NOT EXISTS ai_agent_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  mode VARCHAR(50) DEFAULT 'always',
  trigger_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '18:00',
  business_days INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, connection_id)
);

-- Agent statistics
CREATE TABLE IF NOT EXISTS ai_agent_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  handoff_count INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER,
  positive_feedback_count INTEGER DEFAULT 0,
  negative_feedback_count INTEGER DEFAULT 0,
  deals_created INTEGER DEFAULT 0,
  meetings_scheduled INTEGER DEFAULT 0,
  leads_qualified INTEGER DEFAULT 0,
  tasks_created INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(agent_id, date)
);

-- Add tasks_created column if not exists
DO $$ BEGIN
  ALTER TABLE ai_agent_stats ADD COLUMN IF NOT EXISTS tasks_created INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Indexes for AI Agents
CREATE INDEX IF NOT EXISTS idx_ai_agents_organization ON ai_agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_agents_active ON ai_agents(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_agent ON ai_knowledge_sources(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_sources_status ON ai_knowledge_sources(status);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_source ON ai_knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_agent ON ai_agent_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_conversation ON ai_agent_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_sessions_active ON ai_agent_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_session ON ai_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_templates_organization ON ai_prompt_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_connections_agent ON ai_agent_connections(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_connections_connection ON ai_agent_connections(connection_id);
CREATE INDEX IF NOT EXISTS idx_ai_agent_stats_agent_date ON ai_agent_stats(agent_id, date);

-- Add has_ai_agents to plans if not exists
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_ai_agents BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add ai_agents to organizations modules_enabled
UPDATE organizations 
SET modules_enabled = modules_enabled || '{"ai_agents": true}'::jsonb
WHERE modules_enabled IS NOT NULL 
  AND NOT (modules_enabled ? 'ai_agents');

-- Add notify_external columns to ai_agents
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_phone VARCHAR(50);
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS notify_external_summary BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Takeover timeout, required variables, inactivity timeout for AI agents
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS takeover_timeout_seconds INTEGER DEFAULT 300;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS required_variables JSONB DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS inactivity_timeout_minutes INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS inactivity_message TEXT DEFAULT 'Como não recebi sua resposta, vou encerrar nosso atendimento por aqui. Se precisar, é só me chamar novamente! 😊';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- RAG columns for ai_knowledge_chunks
ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS embedding JSONB;
ALTER TABLE ai_knowledge_chunks ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- RAG columns for ai_knowledge_sources
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS extracted_text TEXT;
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(100);
ALTER TABLE ai_knowledge_sources ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;

-- RAG indexes
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_hash ON ai_knowledge_chunks(content_hash);
CREATE INDEX IF NOT EXISTS idx_ai_knowledge_chunks_source_active ON ai_knowledge_chunks(source_id);

-- Cosine similarity function for JSONB embeddings
CREATE OR REPLACE FUNCTION cosine_similarity(a JSONB, b JSONB)
RETURNS FLOAT AS $$
DECLARE
  dot_product FLOAT := 0;
  norm_a FLOAT := 0;
  norm_b FLOAT := 0;
  len INTEGER;
  i INTEGER;
  va FLOAT;
  vb FLOAT;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0; END IF;
  len := LEAST(jsonb_array_length(a), jsonb_array_length(b));
  IF len = 0 THEN RETURN 0; END IF;
  FOR i IN 0..len-1 LOOP
    va := (a->i)::FLOAT;
    vb := (b->i)::FLOAT;
    dot_product := dot_product + (va * vb);
    norm_a := norm_a + (va * va);
    norm_b := norm_b + (vb * vb);
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN RETURN 0; END IF;
  RETURN dot_product / (sqrt(norm_a) * sqrt(norm_b));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Search knowledge chunks by semantic similarity
CREATE OR REPLACE FUNCTION search_knowledge_chunks(
  p_agent_id UUID,
  p_query_embedding JSONB,
  p_limit INTEGER DEFAULT 5,
  p_min_similarity FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  chunk_id UUID,
  source_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as chunk_id,
    c.source_id,
    c.content,
    c.metadata,
    cosine_similarity(c.embedding, p_query_embedding) as similarity
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_sources s ON s.id = c.source_id
  WHERE s.agent_id = p_agent_id 
    AND s.is_active = true 
    AND s.status = 'completed'
    AND c.embedding IS NOT NULL
    AND cosine_similarity(c.embedding, p_query_embedding) >= p_min_similarity
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
`;

// ============================================
// STEP 26: EXTERNAL FORMS
// ============================================
const step26ExternalForms = `
-- Form definitions table
CREATE TABLE IF NOT EXISTS external_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic info
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  
  -- Branding
  logo_url TEXT,
  primary_color VARCHAR(20) DEFAULT '#6366f1',
  background_color VARCHAR(20) DEFAULT '#ffffff',
  text_color VARCHAR(20) DEFAULT '#1f2937',
  button_text VARCHAR(100) DEFAULT 'Enviar',
  welcome_message TEXT DEFAULT 'Olá! Vamos começar?',
  
  -- Post-submission config
  thank_you_message TEXT DEFAULT 'Obrigado pelo contato! Em breve entraremos em contato.',
  redirect_url TEXT,
  trigger_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
  
  -- Stats
  views_count INTEGER DEFAULT 0,
  submissions_count INTEGER DEFAULT 0,
  
  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, slug)
);

-- Form fields (customizable per form)
CREATE TABLE IF NOT EXISTS external_form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES external_forms(id) ON DELETE CASCADE,
  
  field_key VARCHAR(100) NOT NULL,
  field_label VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'text',
  placeholder TEXT,
  is_required BOOLEAN DEFAULT false,
  validation_regex TEXT,
  options JSONB,
  position INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(form_id, field_key)
);

-- Form submissions (leads captured)
CREATE TABLE IF NOT EXISTS external_form_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES external_forms(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Core captured data
  data JSONB NOT NULL DEFAULT '{}',
  
  -- Extracted standard fields for easy querying
  name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(50),
  
  -- Tracking
  ip_address INET,
  user_agent TEXT,
  referrer TEXT,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  
  -- Integration status
  prospect_id UUID REFERENCES crm_prospects(id),
  contact_id UUID REFERENCES chat_contacts(id),
  flow_session_id UUID,
  processed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_external_forms_org ON external_forms(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_forms_slug ON external_forms(slug);
CREATE INDEX IF NOT EXISTS idx_external_forms_active ON external_forms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_external_form_fields_form ON external_form_fields(form_id);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_form ON external_form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_org ON external_form_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_phone ON external_form_submissions(phone);
CREATE INDEX IF NOT EXISTS idx_external_form_submissions_created ON external_form_submissions(created_at DESC);
`;

// ============================================
// STEP 27: LEAD DISTRIBUTION
// ============================================
const step27LeadDistribution = `
-- Adicionar colunas na tabela connections para controlar distribuição
DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS lead_distribution_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
    ALTER TABLE connections ADD COLUMN IF NOT EXISTS lead_distribution_last_user_index INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Tabela de usuários elegíveis para distribuição de leads em cada conexão
CREATE TABLE IF NOT EXISTS connection_lead_distribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    max_leads_per_day INTEGER,
    leads_today INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (connection_id, user_id)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_conn ON connection_lead_distribution(connection_id);
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_user ON connection_lead_distribution(user_id);
CREATE INDEX IF NOT EXISTS idx_connection_lead_dist_active ON connection_lead_distribution(is_active);

-- Tabela de log de distribuição
CREATE TABLE IF NOT EXISTS lead_distribution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID,
    contact_phone VARCHAR(50),
    contact_name VARCHAR(255),
    assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    distribution_method VARCHAR(20) DEFAULT 'round_robin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_dist_log_conn ON lead_distribution_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_lead_dist_log_user ON lead_distribution_log(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_dist_log_date ON lead_distribution_log(created_at);
`;

// Step 28: Lead Scoring
const step28LeadScoring = `
-- Lead scoring configuration per organization
CREATE TABLE IF NOT EXISTS lead_scoring_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    weight_response_time INTEGER DEFAULT 20,
    weight_engagement INTEGER DEFAULT 25,
    weight_profile_completeness INTEGER DEFAULT 15,
    weight_deal_value INTEGER DEFAULT 20,
    weight_funnel_progress INTEGER DEFAULT 10,
    weight_recency INTEGER DEFAULT 10,
    hot_threshold INTEGER DEFAULT 70,
    warm_threshold INTEGER DEFAULT 40,
    auto_update_on_message BOOLEAN DEFAULT true,
    auto_update_on_stage_change BOOLEAN DEFAULT true,
    recalculate_interval_hours INTEGER DEFAULT 24,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Lead scores per deal
CREATE TABLE IF NOT EXISTS lead_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    score INTEGER DEFAULT 0,
    score_label VARCHAR(10) DEFAULT 'cold',
    score_response_time INTEGER DEFAULT 0,
    score_engagement INTEGER DEFAULT 0,
    score_profile INTEGER DEFAULT 0,
    score_value INTEGER DEFAULT 0,
    score_funnel INTEGER DEFAULT 0,
    score_recency INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    avg_response_time_minutes INTEGER,
    last_contact_response_at TIMESTAMP WITH TIME ZONE,
    profile_fields_filled INTEGER DEFAULT 0,
    profile_fields_total INTEGER DEFAULT 10,
    funnel_stages_completed INTEGER DEFAULT 0,
    funnel_stages_total INTEGER DEFAULT 1,
    ai_summary TEXT,
    ai_recommended_action TEXT,
    ai_analyzed_at TIMESTAMP WITH TIME ZONE,
    previous_score INTEGER,
    score_trend VARCHAR(10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(deal_id)
);

-- Lead score history
CREATE TABLE IF NOT EXISTS lead_score_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    score_label VARCHAR(10),
    trigger_event VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lead_scores_org ON lead_scores(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_deal ON lead_scores(deal_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_score ON lead_scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_label ON lead_scores(score_label);
CREATE INDEX IF NOT EXISTS idx_lead_score_history_deal ON lead_score_history(deal_id);

-- Add columns to crm_deals
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'lead_score') THEN
        ALTER TABLE crm_deals ADD COLUMN lead_score INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'crm_deals' AND column_name = 'lead_score_label') THEN
        ALTER TABLE crm_deals ADD COLUMN lead_score_label VARCHAR(10) DEFAULT 'cold';
    END IF;
END $$;
`;

// Step 29: Conversation Summaries
const step29ConversationSummaries = `
-- Conversation summaries (AI-generated)
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    key_points JSONB DEFAULT '[]',
    customer_sentiment VARCHAR(20),
    topics JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    resolution_status VARCHAR(20),
    messages_analyzed INTEGER DEFAULT 0,
    generated_by VARCHAR(50),
    ai_provider VARCHAR(20),
    ai_model VARCHAR(50),
    processing_time_ms INTEGER,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(conversation_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conv_summaries_org ON conversation_summaries(organization_id);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_conv ON conversation_summaries(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_sentiment ON conversation_summaries(customer_sentiment);

-- Add columns to conversations
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'ai_summary') THEN
        ALTER TABLE conversations ADD COLUMN ai_summary TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'ai_sentiment') THEN
        ALTER TABLE conversations ADD COLUMN ai_sentiment VARCHAR(20);
    END IF;
END $$;
`;

// Step 30: Nurturing Sequences
const step30NurturingSequences = `
-- Nurturing sequences
CREATE TABLE IF NOT EXISTS nurturing_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type VARCHAR(50) NOT NULL DEFAULT 'manual',
    trigger_config JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    pause_on_reply BOOLEAN DEFAULT true,
    pause_on_deal_won BOOLEAN DEFAULT true,
    exit_on_reply BOOLEAN DEFAULT false,
    contacts_enrolled INTEGER DEFAULT 0,
    contacts_completed INTEGER DEFAULT 0,
    contacts_converted INTEGER DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sequence steps
CREATE TABLE IF NOT EXISTS nurturing_sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES nurturing_sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL DEFAULT 1,
    delay_value INTEGER NOT NULL DEFAULT 1,
    delay_unit VARCHAR(20) NOT NULL DEFAULT 'days',
    channel VARCHAR(20) NOT NULL,
    whatsapp_content TEXT,
    whatsapp_media_url TEXT,
    whatsapp_media_type VARCHAR(50),
    email_subject VARCHAR(500),
    email_body TEXT,
    email_template_id UUID,
    conditions JSONB DEFAULT '{}',
    skip_if_replied BOOLEAN DEFAULT true,
    sent_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    replied_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sequence_id, step_order)
);

-- Enrollments
CREATE TABLE IF NOT EXISTS nurturing_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID NOT NULL REFERENCES nurturing_sequences(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    contact_name VARCHAR(255),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    deal_id UUID,
    current_step INTEGER DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    pause_reason VARCHAR(100),
    next_step_at TIMESTAMP WITH TIME ZONE,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    paused_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    variables JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step logs
CREATE TABLE IF NOT EXISTS nurturing_step_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES nurturing_enrollments(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES nurturing_sequence_steps(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL,
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    replied_at TIMESTAMP WITH TIME ZONE,
    message_id VARCHAR(255),
    email_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sequences_org ON nurturing_sequences(organization_id);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON nurturing_sequence_steps(sequence_id, step_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_sequence ON nurturing_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON nurturing_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_next ON nurturing_enrollments(next_step_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_enrollments_phone ON nurturing_enrollments(contact_phone);
CREATE INDEX IF NOT EXISTS idx_step_logs_enrollment ON nurturing_step_logs(enrollment_id);

-- Add has_nurturing to plans
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'has_nurturing') THEN
        ALTER TABLE plans ADD COLUMN has_nurturing BOOLEAN DEFAULT false;
    END IF;
END $$;
`;

// Step 31: CTWA Analytics
const step31CTWAAnalytics = `
-- CTWA Campaigns
CREATE TABLE IF NOT EXISTS ctwa_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'meta',
    campaign_id VARCHAR(255),
    ad_set_id VARCHAR(255),
    ad_id VARCHAR(255),
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    tracking_code VARCHAR(50),
    total_spend DECIMAL(12,2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'BRL',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CTWA Leads
CREATE TABLE IF NOT EXISTS ctwa_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES ctwa_campaigns(id) ON DELETE SET NULL,
    phone VARCHAR(50) NOT NULL,
    contact_name VARCHAR(255),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    deal_id UUID,
    source_platform VARCHAR(50),
    referrer_url TEXT,
    landing_page TEXT,
    utm_source VARCHAR(255),
    utm_medium VARCHAR(255),
    utm_campaign VARCHAR(255),
    utm_content VARCHAR(255),
    utm_term VARCHAR(255),
    tracking_code VARCHAR(50),
    entry_message TEXT,
    status VARCHAR(30) DEFAULT 'new',
    converted_at TIMESTAMP WITH TIME ZONE,
    conversion_value DECIMAL(12,2),
    first_response_at TIMESTAMP WITH TIME ZONE,
    response_time_seconds INTEGER,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- CTWA Events
CREATE TABLE IF NOT EXISTS ctwa_lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES ctwa_leads(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ctwa_campaigns_org ON ctwa_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_campaigns_tracking ON ctwa_campaigns(tracking_code);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_org ON ctwa_leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_campaign ON ctwa_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_phone ON ctwa_leads(phone);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_status ON ctwa_leads(status);
CREATE INDEX IF NOT EXISTS idx_ctwa_leads_created ON ctwa_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_ctwa_events_lead ON ctwa_lead_events(lead_id);
`;

// ============================================
// STEP 32: GROUP SECRETARY (AI Secretary for Groups)
// ============================================
const step32GroupSecretary = `
-- Group Secretary Configuration
CREATE TABLE IF NOT EXISTS group_secretary_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    connection_ids UUID[] DEFAULT NULL,
    group_jids TEXT[] DEFAULT NULL,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(100),
    ai_api_key TEXT,
    create_crm_task BOOLEAN DEFAULT true,
    show_popup_alert BOOLEAN DEFAULT true,
    min_confidence DECIMAL(3,2) DEFAULT 0.6,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id)
);

-- Group Secretary Member Aliases
CREATE TABLE IF NOT EXISTS group_secretary_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    role_description TEXT,
    departments TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Group Secretary Detection Logs
CREATE TABLE IF NOT EXISTS group_secretary_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    message_content TEXT,
    sender_name TEXT,
    detected_request TEXT,
    matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    matched_user_name TEXT,
    confidence DECIMAL(3,2),
    crm_task_id UUID REFERENCES crm_tasks(id) ON DELETE SET NULL,
    alert_id UUID REFERENCES user_alerts(id) ON DELETE SET NULL,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(50),
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_secretary_config_org ON group_secretary_config(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_members_org ON group_secretary_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_members_user ON group_secretary_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_org ON group_secretary_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_conv ON group_secretary_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_matched ON group_secretary_logs(matched_user_id);
CREATE INDEX IF NOT EXISTS idx_group_secretary_logs_created ON group_secretary_logs(created_at);

-- Add new columns for member/external notifications and advanced features
DO $$ BEGIN
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_external_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_external_phone VARCHAR(50);
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS notify_members_whatsapp BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS default_connection_id UUID;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS followup_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS followup_hours INTEGER DEFAULT 4;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS daily_digest_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS daily_digest_hour INTEGER DEFAULT 8;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT false;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS auto_reply_message TEXT;
    ALTER TABLE group_secretary_config ADD COLUMN IF NOT EXISTS excluded_senders TEXT[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add new columns to logs for priority, sentiment, deadline
DO $$ BEGIN
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS deadline TIMESTAMP WITH TIME ZONE;
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20) DEFAULT 'neutral';
    ALTER TABLE group_secretary_logs ADD COLUMN IF NOT EXISTS matched_users_count INTEGER DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- Add source and followup columns to crm_tasks
DO $$ BEGIN
    ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS source VARCHAR(50);
    ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMP WITH TIME ZONE;
EXCEPTION WHEN duplicate_column THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_source ON crm_tasks(source);

-- Meeting Minutes (Atas de Reunião)
CREATE TABLE IF NOT EXISTS group_secretary_meeting_minutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    group_name TEXT,
    title TEXT NOT NULL,
    summary TEXT,
    decisions JSONB DEFAULT '[]',
    action_items JSONB DEFAULT '[]',
    participants TEXT[] DEFAULT '{}',
    message_count INTEGER DEFAULT 0,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    ai_provider VARCHAR(20),
    ai_model VARCHAR(100),
    generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_org ON group_secretary_meeting_minutes(organization_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_conv ON group_secretary_meeting_minutes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_created ON group_secretary_meeting_minutes(created_at);
`;

// Step 33: Ghost Audit Logs
const step33GhostAudit = `
CREATE TABLE IF NOT EXISTS ghost_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    days_analyzed INTEGER NOT NULL,
    conversations_analyzed INTEGER DEFAULT 0,
    insights_count INTEGER DEFAULT 0,
    categories_summary JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghost_audit_org ON ghost_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ghost_audit_created ON ghost_audit_logs(created_at);
`;

// Step 34: Ghost Saved Analyses
const step34GhostSavedAnalyses = `
CREATE TABLE IF NOT EXISTS ghost_saved_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    label VARCHAR(500) NOT NULL,
    data JSONB NOT NULL,
    days INTEGER NOT NULL DEFAULT 7,
    connection_id UUID,
    connection_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghost_saved_org ON ghost_saved_analyses(organization_id);
CREATE INDEX IF NOT EXISTS idx_ghost_saved_created ON ghost_saved_analyses(created_at);
`;

// Step 35: Group Funnels (link groups to specific funnels)
const step35GroupFunnels = `
CREATE TABLE IF NOT EXISTS crm_group_funnels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES crm_user_groups(id) ON DELETE CASCADE NOT NULL,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, funnel_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_group_funnels_group ON crm_group_funnels(group_id);
CREATE INDEX IF NOT EXISTS idx_crm_group_funnels_funnel ON crm_group_funnels(funnel_id);
`;

// Step 36: Projects Module
const step36Projects = `
CREATE TABLE IF NOT EXISTS project_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    position INTEGER DEFAULT 0,
    color VARCHAR(50) DEFAULT '#6366f1',
    is_final BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_stages_org ON project_stages(organization_id);

CREATE TABLE IF NOT EXISTS project_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_templates_org ON project_templates(organization_id);

CREATE TABLE IF NOT EXISTS project_template_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES project_templates(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    duration_days INTEGER DEFAULT 1,
    depends_on_position INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_template_tasks_tpl ON project_template_tasks(template_id);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    deal_id UUID,
    stage_id UUID REFERENCES project_stages(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_deal ON projects(deal_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage_id);

CREATE TABLE IF NOT EXISTS project_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255),
    url TEXT NOT NULL,
    mimetype VARCHAR(100),
    size INTEGER,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_attachments_proj ON project_attachments(project_id);

CREATE TABLE IF NOT EXISTS project_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    parent_id UUID REFERENCES project_notes(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_notes_proj ON project_notes(project_id);

CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    position INTEGER DEFAULT 0,
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    duration_days INTEGER DEFAULT 1,
    depends_on UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_proj ON project_tasks(project_id);

CREATE TABLE IF NOT EXISTS project_note_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    project_id UUID NOT NULL,
    note_id UUID NOT NULL,
    project_title TEXT,
    sender_name TEXT,
    content_preview TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_note_notifs_user ON project_note_notifications(user_id, read);
`;

// Step 37: Permission Templates
const step37PermissionTemplates = `
CREATE TABLE IF NOT EXISTS permission_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#6366f1',
  permissions JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permission_templates_org ON permission_templates(organization_id);
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS permission_template_id UUID REFERENCES permission_templates(id) ON DELETE SET NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
`;

// Step 38: Push Notifications
const step38PushNotifications = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_org ON push_subscriptions(organization_id);

CREATE TABLE IF NOT EXISTS push_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB,
  status TEXT DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_log_user ON push_notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_notification_log(created_at DESC);
`;

const step45bAgencyAllowedUnits = `
CREATE TABLE IF NOT EXISTS agency_allowed_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agency_id, supermarket_unit_id)
);
`;


// ============================================
// STEP 39: GLOBAL AI AGENTS
// ============================================
const step39GlobalAgents = `
CREATE TABLE IF NOT EXISTS global_ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  avatar_url TEXT,
  ai_provider VARCHAR(20) NOT NULL DEFAULT 'openai',
  ai_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
  ai_api_key TEXT,
  system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual profissional.',
  temperature NUMERIC(3,2) DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 1000,
  context_window INTEGER DEFAULT 20,
  custom_fields JSONB DEFAULT '[]'::jsonb,
  capabilities TEXT[] DEFAULT ARRAY['respond_messages']::TEXT[],
  handoff_message TEXT DEFAULT 'Vou transferir você para um atendente humano. Aguarde um momento.',
  handoff_keywords TEXT[] DEFAULT ARRAY['humano', 'atendente', 'pessoa']::TEXT[],
  fallback_message TEXT DEFAULT 'Desculpe, não consegui entender. Pode reformular sua pergunta?',
  greeting_message TEXT,
  has_knowledge_base BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_agent_org_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(global_agent_id, organization_id)
);

CREATE TABLE IF NOT EXISTS global_agent_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  custom_field_values JSONB DEFAULT '{}'::jsonb,
  prompt_additions TEXT,
  client_ai_api_key TEXT,
  schedule_windows JSONB DEFAULT '[]'::jsonb,
  schedule_mode VARCHAR(20) DEFAULT 'manual',
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(global_agent_id, connection_id)
);

CREATE TABLE IF NOT EXISTS global_agent_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  global_agent_id UUID NOT NULL REFERENCES global_ai_agents(id) ON DELETE CASCADE,
  source_type VARCHAR(20) NOT NULL DEFAULT 'text',
  name VARCHAR(255) NOT NULL,
  description TEXT,
  source_content TEXT NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  original_filename VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_agent_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES global_agent_knowledge_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  embedding JSONB,
  token_count INTEGER,
  char_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_agent_org_assignments_org ON global_agent_org_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_org_assignments_agent ON global_agent_org_assignments(global_agent_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_org ON global_agent_activations(organization_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_conn ON global_agent_activations(connection_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_activations_active ON global_agent_activations(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_global_agent_knowledge_sources_agent ON global_agent_knowledge_sources(global_agent_id);
CREATE INDEX IF NOT EXISTS idx_global_agent_knowledge_chunks_source ON global_agent_knowledge_chunks(source_id);

DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS fallback_message TEXT DEFAULT 'Desculpe, não consegui entender.'; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_ai_agents ADD COLUMN IF NOT EXISTS has_knowledge_base BOOLEAN DEFAULT false; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE global_agent_activations ADD COLUMN IF NOT EXISTS client_ai_api_key TEXT; EXCEPTION WHEN others THEN NULL; END $$;
`;

// ============================================
// STEP 40: LEAD WEBHOOKS
// ============================================
const step40LeadWebhooks = `
CREATE TABLE IF NOT EXISTS lead_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    webhook_token VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    funnel_id UUID REFERENCES crm_funnels(id) ON DELETE SET NULL,
    stage_id UUID REFERENCES crm_stages(id) ON DELETE SET NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    distribution_enabled BOOLEAN DEFAULT false,
    distribution_last_index INTEGER DEFAULT 0,
    field_mapping JSONB DEFAULT '{}',
    default_value DECIMAL(15,2) DEFAULT 0,
    default_probability INTEGER DEFAULT 10,
    total_leads INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_webhook_distribution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES lead_webhooks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    max_leads_per_day INTEGER DEFAULT NULL,
    leads_today INTEGER DEFAULT 0,
    last_lead_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(webhook_id, user_id)
);

CREATE TABLE IF NOT EXISTS lead_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES lead_webhooks(id) ON DELETE CASCADE,
    request_body JSONB,
    response_status INTEGER,
    response_message TEXT,
    deal_id UUID REFERENCES crm_deals(id) ON DELETE SET NULL,
    prospect_id UUID REFERENCES crm_prospects(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    source_ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_webhooks_org ON lead_webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhooks_token ON lead_webhooks(webhook_token);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_distribution_webhook ON lead_webhook_distribution(webhook_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_logs_webhook ON lead_webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_lead_webhook_logs_created ON lead_webhook_logs(created_at DESC);
`;

const step41MetaTemplates = `
CREATE TABLE IF NOT EXISTS meta_message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id UUID REFERENCES connections(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    meta_template_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    language VARCHAR(20) DEFAULT 'pt_BR',
    category VARCHAR(50) DEFAULT 'UTILITY',
    status VARCHAR(50) DEFAULT 'PENDING',
    components JSONB DEFAULT '[]'::jsonb,
    synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_templates_conn_tid 
  ON meta_message_templates(connection_id, meta_template_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_connection 
  ON meta_message_templates(connection_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_org 
  ON meta_message_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_meta_templates_status 
  ON meta_message_templates(status);
`;

// Step 42: RH Module (Colaboradores, Ponto, Holerite)
const step42RH = `
-- RH Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employment_type') THEN
    CREATE TYPE employment_type AS ENUM ('clt','pj','freelancer','temporario','estagiario','aprendiz');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_profile') THEN
    CREATE TYPE worker_profile AS ENUM ('administrativo','supervisor','promotor','operacional');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_status') THEN
    CREATE TYPE employee_status AS ENUM ('ativo','afastado','ferias','desligado','suspenso');
  END IF;
END $$;

-- Filiais
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

-- Centros de Custo
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_centers_org ON cost_centers(organization_id);

-- Departamentos RH
CREATE TABLE IF NOT EXISTS rh_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rh_departments_org ON rh_departments(organization_id);

-- Colaboradores
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
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
  registration_number VARCHAR(50),
  worker_profile worker_profile DEFAULT 'operacional',
  employment_type employment_type DEFAULT 'clt',
  position VARCHAR(255),
  role_level VARCHAR(100),
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  department_id UUID REFERENCES rh_departments(id) ON DELETE SET NULL,
  cost_center_id UUID REFERENCES cost_centers(id) ON DELETE SET NULL,
  direct_manager_id UUID,
  admission_date DATE,
  contract_end_date DATE,
  probation_end_date DATE,
  termination_date DATE,
  termination_reason TEXT,
  salary NUMERIC(12,2),
  work_schedule TEXT DEFAULT '08:00-17:00',
  bank_name VARCHAR(100),
  bank_agency VARCHAR(20),
  bank_account VARCHAR(30),
  bank_account_type VARCHAR(20),
  ctps_number VARCHAR(30),
  ctps_series VARCHAR(10),
  pis_pasep VARCHAR(20),
  voter_id VARCHAR(20),
  military_cert VARCHAR(30),
  cnh VARCHAR(20),
  cnh_category VARCHAR(5),
  cnh_expiry DATE,
  cnpj VARCHAR(20),
  company_name VARCHAR(255),
  status employee_status DEFAULT 'ativo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(organization_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_cpf ON employees(cpf);

DO $$ BEGIN
  ALTER TABLE employees ALTER COLUMN work_schedule TYPE TEXT;
EXCEPTION WHEN others THEN null;
END $$;

-- Dependentes
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

-- Documentos do Colaborador
CREATE TABLE IF NOT EXISTS employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_url TEXT,
  expiry_date DATE,
  notes TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Registro de Ponto
CREATE TABLE IF NOT EXISTS time_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  record_date DATE NOT NULL,
  entry1 TIME, exit1 TIME, entry2 TIME, exit2 TIME, entry3 TIME, exit3 TIME,
  total_hours NUMERIC(5,2),
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'normal',
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_unique ON time_records(employee_id, record_date);

-- Banco de Horas
CREATE TABLE IF NOT EXISTS hour_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reference_month VARCHAR(7) NOT NULL,
  balance_hours NUMERIC(6,2) DEFAULT 0,
  carried_over NUMERIC(6,2) DEFAULT 0,
  used_hours NUMERIC(6,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Afastamentos
CREATE TABLE IF NOT EXISTS employee_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  absence_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INTEGER,
  reason TEXT,
  document_url TEXT,
  approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Holerites
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reference_month VARCHAR(7) NOT NULL,
  payment_type VARCHAR(30) DEFAULT 'mensal',
  gross_salary NUMERIC(12,2) DEFAULT 0,
  earnings JSONB DEFAULT '[]',
  total_earnings NUMERIC(12,2) DEFAULT 0,
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
  status VARCHAR(20) DEFAULT 'rascunho',
  pdf_url TEXT,
  notes TEXT,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payslips_emp ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_month ON payslips(reference_month);

-- Trilha de Auditoria RH
CREATE TABLE IF NOT EXISTS rh_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_rh_audit_entity ON rh_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_rh_audit_org ON rh_audit_log(organization_id);

-- ================================================
-- Férias (Parcial e Completa)
-- ================================================
CREATE TABLE IF NOT EXISTS rh_vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  vacation_type VARCHAR(20) NOT NULL DEFAULT 'completa', -- completa, parcial
  acquisition_start DATE, -- início período aquisitivo
  acquisition_end DATE,   -- fim período aquisitivo
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_total INTEGER NOT NULL,
  days_taken INTEGER DEFAULT 0,
  days_remaining INTEGER DEFAULT 0,
  abono_pecuniario BOOLEAN DEFAULT false,
  abono_days INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'agendada', -- agendada, em_andamento, concluida, cancelada
  notes TEXT,
  approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rh_vacations_emp ON rh_vacations(employee_id);
CREATE INDEX IF NOT EXISTS idx_rh_vacations_org ON rh_vacations(organization_id);

-- ================================================
-- Atestados Médicos (detalhado)
-- ================================================
CREATE TABLE IF NOT EXISTS rh_medical_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doctor_name VARCHAR(255),
  doctor_crm VARCHAR(30),
  cid_code VARCHAR(20),
  healthcare_unit VARCHAR(255),
  absence_start DATE NOT NULL,
  absence_end DATE NOT NULL,
  absence_days INTEGER,
  absence_hours VARCHAR(20), -- para atestado parcial (ex: "4h")
  is_partial BOOLEAN DEFAULT false,
  document_url TEXT,
  ai_extracted_data JSONB, -- dados extraídos pela IA
  ai_confidence NUMERIC(3,2), -- confiança da IA (0-1)
  validated BOOLEAN DEFAULT false,
  validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  rejection_reason TEXT,
  justifies_absence BOOLEAN DEFAULT true,
  linked_time_records JSONB DEFAULT '[]', -- IDs dos registros de ponto justificados
  notes TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rh_medical_emp ON rh_medical_certificates(employee_id);
CREATE INDEX IF NOT EXISTS idx_rh_medical_org ON rh_medical_certificates(organization_id);

-- ================================================
-- Central de Documentos do Colaborador (ampliada)
-- ================================================
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente';
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS validated_by UUID;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB;
ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Colunas extras em employee_absences para vincular atestado
ALTER TABLE employee_absences ADD COLUMN IF NOT EXISTS medical_certificate_id UUID;
ALTER TABLE employee_absences ADD COLUMN IF NOT EXISTS organization_id UUID;
`;

// ============================================
// STEP 43: Promotor App (Fase 2)
// ============================================
const step43PromotorApp = `
-- PDVs
CREATE TABLE IF NOT EXISTS pdvs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, client_name VARCHAR(255), cnpj VARCHAR(20), address TEXT, zip_code VARCHAR(10), city VARCHAR(100), state VARCHAR(2), neighborhood VARCHAR(100), latitude NUMERIC(10,7), longitude NUMERIC(10,7), radius_meters INTEGER DEFAULT 200, supervisor_id UUID, active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
DO $$ BEGIN ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS cnpj VARCHAR(20); EXCEPTION WHEN duplicate_column THEN null; END $$;
CREATE INDEX IF NOT EXISTS idx_pdvs_org ON pdvs(organization_id);

-- Collaborator PDVs
CREATE TABLE IF NOT EXISTS collaborator_pdvs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, pdv_id UUID NOT NULL REFERENCES pdvs(id) ON DELETE CASCADE, assignment_type VARCHAR(20) DEFAULT 'fixo', weekdays JSONB DEFAULT '[]', start_date DATE, end_date DATE, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_collab_pdvs_emp ON collaborator_pdvs(employee_id);

-- Daily assignments
CREATE TABLE IF NOT EXISTS collaborator_daily_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, pdv_id UUID REFERENCES pdvs(id) ON DELETE SET NULL, assignment_date DATE NOT NULL, shift_start TIME, shift_end TIME, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_daily_assign_emp ON collaborator_daily_assignments(employee_id, assignment_date);

-- Time Punches
CREATE TABLE IF NOT EXISTS time_punches (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, punch_type VARCHAR(30) NOT NULL, punched_at TIMESTAMPTZ NOT NULL, latitude NUMERIC(10,7), longitude NUMERIC(10,7), accuracy_meters NUMERIC(8,2), pdv_id UUID REFERENCES pdvs(id) ON DELETE SET NULL, distance_from_pdv NUMERIC(10,2), geo_status VARCHAR(30) DEFAULT 'dentro_area', device_info TEXT, ip_address VARCHAR(45), is_offline BOOLEAN DEFAULT false, offline_local_time TIMESTAMPTZ, synced_at TIMESTAMPTZ, sync_status VARCHAR(20) DEFAULT 'synced', justification TEXT, approved BOOLEAN, approved_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_time_punches_emp ON time_punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_date ON time_punches(punched_at);
CREATE INDEX IF NOT EXISTS idx_time_punches_org ON time_punches(organization_id);

-- Time Rules
CREATE TABLE IF NOT EXISTS time_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID REFERENCES employees(id) ON DELETE CASCADE, name VARCHAR(255), late_tolerance_minutes INTEGER DEFAULT 10, early_leave_tolerance INTEGER DEFAULT 10, break_tolerance INTEGER DEFAULT 5, max_late_minutes INTEGER DEFAULT 30, require_justification BOOLEAN DEFAULT true, absence_on_no_punch BOOLEAN DEFAULT true, punch_window_minutes INTEGER DEFAULT 60, allow_manual_adjustment BOOLEAN DEFAULT true, require_geo BOOLEAN DEFAULT true, allow_offline_punch BOOLEAN DEFAULT true, allow_exception_punch BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW());

-- Time Alerts
CREATE TABLE IF NOT EXISTS time_alerts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, alert_type VARCHAR(50) NOT NULL, alert_date DATE NOT NULL, description TEXT, resolved BOOLEAN DEFAULT false, resolved_by UUID, resolved_at TIMESTAMPTZ, resolution_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_time_alerts_org ON time_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_time_alerts_date ON time_alerts(alert_date);

-- App Access
CREATE TABLE IF NOT EXISTS collaborator_app_access (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE UNIQUE, login_type VARCHAR(10) DEFAULT 'cpf', password_hash VARCHAR(255), temp_password BOOLEAN DEFAULT false, force_password_change BOOLEAN DEFAULT true, access_status VARCHAR(30) DEFAULT 'sem_acesso', enabled_at TIMESTAMPTZ, enabled_by UUID, last_login TIMESTAMPTZ, last_device TEXT, last_ip VARCHAR(45), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- Sessions
CREATE TABLE IF NOT EXISTS collaborator_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, token_hash VARCHAR(255) NOT NULL, device_info TEXT, ip_address VARCHAR(45), expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());

-- Password Resets
CREATE TABLE IF NOT EXISTS collaborator_password_resets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, reset_by VARCHAR(20) NOT NULL, reset_by_user_id UUID, ip_address VARCHAR(45), created_at TIMESTAMPTZ DEFAULT NOW());

-- Document Types
CREATE TABLE IF NOT EXISTS rh_document_types (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, slug VARCHAR(100), requires_signature BOOLEAN DEFAULT false, requires_confirmation BOOLEAN DEFAULT true, category VARCHAR(50) DEFAULT 'geral', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

-- Document Deliveries
CREATE TABLE IF NOT EXISTS rh_document_deliveries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, document_type_id UUID, title VARCHAR(255) NOT NULL, description TEXT, file_url TEXT, file_hash VARCHAR(128), requires_view_only BOOLEAN DEFAULT false, requires_confirmation BOOLEAN DEFAULT false, requires_signature BOOLEAN DEFAULT false, signature_deadline TIMESTAMPTZ, block_until_signed BOOLEAN DEFAULT false, status VARCHAR(30) DEFAULT 'pendente', sent_by UUID, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, viewed_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, signature_id UUID, refused_at TIMESTAMPTZ, refuse_reason TEXT, cancelled_at TIMESTAMPTZ, cancelled_by UUID, batch_id UUID, ip_at_view VARCHAR(45), ip_at_sign VARCHAR(45), device_at_view TEXT, device_at_sign TEXT, geo_lat_at_sign NUMERIC(10,7), geo_lng_at_sign NUMERIC(10,7), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_doc_deliveries_org ON rh_document_deliveries(organization_id);
CREATE INDEX IF NOT EXISTS idx_doc_deliveries_emp ON rh_document_deliveries(employee_id);
CREATE INDEX IF NOT EXISTS idx_doc_deliveries_status ON rh_document_deliveries(status);

-- Delivery Events
CREATE TABLE IF NOT EXISTS rh_document_delivery_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id UUID NOT NULL REFERENCES rh_document_deliveries(id) ON DELETE CASCADE, event_type VARCHAR(30) NOT NULL, event_at TIMESTAMPTZ DEFAULT NOW(), actor_type VARCHAR(20), actor_id UUID, ip_address VARCHAR(45), device_info TEXT, notes TEXT);

-- Inbound Documents
CREATE TABLE IF NOT EXISTS rh_inbound_documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, category VARCHAR(50) NOT NULL, title VARCHAR(255), file_url TEXT, observation TEXT, status VARCHAR(20) DEFAULT 'recebido', read_by UUID, read_at TIMESTAMPTZ, processed_by UUID, processed_at TIMESTAMPTZ, process_notes TEXT, ip_address VARCHAR(45), device_info TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_inbound_docs_org ON rh_inbound_documents(organization_id);

-- Payslip Deliveries
CREATE TABLE IF NOT EXISTS payslip_deliveries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), payslip_id UUID NOT NULL REFERENCES payslips(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, delivery_status VARCHAR(30) DEFAULT 'pendente', requires_signature BOOLEAN DEFAULT false, sent_at TIMESTAMPTZ, viewed_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, signature_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());

-- Timesheet Exports
CREATE TABLE IF NOT EXISTS timesheet_exports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, reference_month VARCHAR(7) NOT NULL, status VARCHAR(30) DEFAULT 'rascunho', pdf_url TEXT, total_hours NUMERIC(6,2), overtime_hours NUMERIC(6,2), absences INTEGER DEFAULT 0, lates INTEGER DEFAULT 0, sent_at TIMESTAMPTZ, viewed_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ, signed_at TIMESTAMPTZ, requires_signature BOOLEAN DEFAULT false, signature_id UUID, generated_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- Offline Sync Queue
CREATE TABLE IF NOT EXISTS offline_sync_queue (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, action_type VARCHAR(50) NOT NULL, payload JSONB NOT NULL, local_timestamp TIMESTAMPTZ NOT NULL, server_timestamp TIMESTAMPTZ, sync_status VARCHAR(20) DEFAULT 'pending', attempts INTEGER DEFAULT 0, error_message TEXT, local_id VARCHAR(100), server_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());

-- Overtime Requests
CREATE TABLE IF NOT EXISTS overtime_requests (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, request_date DATE NOT NULL DEFAULT CURRENT_DATE, reason TEXT NOT NULL, requested_start TIME, requested_end TIME, status VARCHAR(20) DEFAULT 'pendente', approved_by UUID REFERENCES employees(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ, supervisor_notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_overtime_requests_emp ON overtime_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_date ON overtime_requests(request_date);
CREATE INDEX IF NOT EXISTS idx_overtime_requests_status ON overtime_requests(status);

-- Collaborator Notifications
CREATE TABLE IF NOT EXISTS collaborator_notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, message TEXT, type VARCHAR(30) DEFAULT 'info', reference_type VARCHAR(50), reference_id UUID, read BOOLEAN DEFAULT false, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_collab_notif_emp ON collaborator_notifications(employee_id);

-- Notification Rules
CREATE TABLE IF NOT EXISTS rh_notification_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, event_type VARCHAR(50) NOT NULL, notify_rh BOOLEAN DEFAULT true, notify_supervisor BOOLEAN DEFAULT false, notify_collaborator BOOLEAN DEFAULT false, channel_system BOOLEAN DEFAULT true, channel_push BOOLEAN DEFAULT false, channel_email BOOLEAN DEFAULT false, channel_whatsapp BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

-- App Settings
CREATE TABLE IF NOT EXISTS collaborator_app_settings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE UNIQUE, theme VARCHAR(10) DEFAULT 'auto', notifications_enabled BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

-- Supervisor column
ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_id UUID;

-- Compensation columns for existing RH databases
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deductions JSONB NOT NULL DEFAULT '[]'::jsonb;
`;

// Step 44: Merchandising Phase 4 - Routes, Execution, Damages
const step44MerchPhase4 = `
CREATE TABLE IF NOT EXISTS photo_quality_settings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, brand_id UUID, blur_tolerance NUMERIC(5,2) DEFAULT 50, min_brightness NUMERIC(5,2) DEFAULT 30, max_brightness NUMERIC(5,2) DEFAULT 90, compression_quality INTEGER DEFAULT 80, max_file_size_mb NUMERIC(5,2) DEFAULT 5, require_checkin_photo BOOLEAN DEFAULT true, require_category_photo BOOLEAN DEFAULT true, require_checkout_photo BOOLEAN DEFAULT false, watermark_enabled BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS brand_checklists (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, brand_id UUID NOT NULL, name VARCHAR(255) NOT NULL, description TEXT, require_checkin_photo BOOLEAN DEFAULT true, require_checkout_photo BOOLEAN DEFAULT false, require_stock_count BOOLEAN DEFAULT false, require_validity_check BOOLEAN DEFAULT false, require_extra_point BOOLEAN DEFAULT false, category_photo_mode VARCHAR(20) DEFAULT 'both', min_category_photos_before INT DEFAULT 1, min_category_photos_after INT DEFAULT 1, stock_count_frequency VARCHAR(20) DEFAULT 'every_visit', validity_check_frequency VARCHAR(20) DEFAULT 'every_visit', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
DO $$ BEGIN
    ALTER TABLE brand_checklists ADD COLUMN IF NOT EXISTS category_photo_mode VARCHAR(20) DEFAULT 'both';
    ALTER TABLE brand_checklists ADD COLUMN IF NOT EXISTS min_category_photos_before INT DEFAULT 1;
    ALTER TABLE brand_checklists ADD COLUMN IF NOT EXISTS min_category_photos_after INT DEFAULT 1;
EXCEPTION WHEN duplicate_column THEN null; END $$;

CREATE TABLE IF NOT EXISTS brand_checklist_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), checklist_id UUID, category_id UUID, subcategory_id UUID, product_id UUID, require_photo BOOLEAN DEFAULT false, require_count BOOLEAN DEFAULT false, require_validity BOOLEAN DEFAULT false, require_stock BOOLEAN DEFAULT false, require_extra_point BOOLEAN DEFAULT false, require_observation BOOLEAN DEFAULT false, count_frequency VARCHAR(20) DEFAULT 'every_visit', max_postponements INTEGER DEFAULT 1, is_mandatory BOOLEAN DEFAULT true, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS brand_promoter_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, brand_id UUID NOT NULL, employee_id UUID NOT NULL, assignment_type VARCHAR(20) DEFAULT 'preferred', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS exposure_point_types (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, name VARCHAR(100) NOT NULL, code VARCHAR(50) NOT NULL, description TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS merch_routes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, promoter_id UUID NOT NULL, supervisor_id UUID, pdv_id UUID NOT NULL, brand_id UUID NOT NULL, checklist_id UUID, visit_date DATE NOT NULL, scheduled_time TIME, window_start TIME, window_end TIME, estimated_duration_min INTEGER DEFAULT 60, priority VARCHAR(10) DEFAULT 'normal', visit_type VARCHAR(30) DEFAULT 'regular', recurrence TEXT, recurrence_parent_id UUID, status VARCHAR(30) DEFAULT 'scheduled', notes TEXT, checkin_at TIMESTAMPTZ, checkin_latitude NUMERIC(10,7), checkin_longitude NUMERIC(10,7), checkin_photo_url TEXT, checkin_device TEXT, checkout_at TIMESTAMPTZ, checkout_latitude NUMERIC(10,7), checkout_longitude NUMERIC(10,7), checkout_photo_url TEXT, progress_pct NUMERIC(5,2) DEFAULT 0, completed_at TIMESTAMPTZ, completion_notes TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE merch_routes ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE merch_routes ALTER COLUMN recurrence TYPE TEXT;
CREATE INDEX IF NOT EXISTS idx_merch_routes_org ON merch_routes(organization_id);
CREATE INDEX IF NOT EXISTS idx_merch_routes_promoter ON merch_routes(promoter_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_merch_routes_org_visit ON merch_routes(organization_id, visit_date DESC, scheduled_time);
CREATE INDEX IF NOT EXISTS idx_merch_routes_org_promoter_visit ON merch_routes(organization_id, promoter_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_merch_routes_org_brand_visit ON merch_routes(organization_id, brand_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_merch_routes_org_pdv_visit ON merch_routes(organization_id, pdv_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_merch_routes_status ON merch_routes(status);

CREATE TABLE IF NOT EXISTS route_person_assignments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, employee_id UUID NOT NULL, role VARCHAR(20) DEFAULT 'executor', assigned_at TIMESTAMPTZ DEFAULT NOW(), removed_at TIMESTAMPTZ, reason TEXT, assigned_by UUID, active BOOLEAN DEFAULT true);

CREATE TABLE IF NOT EXISTS route_photos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, photo_type VARCHAR(30) NOT NULL, category_id UUID, product_id UUID, exposure_point VARCHAR(50), photo_url TEXT NOT NULL, thumbnail_url TEXT, original_size_bytes INTEGER, compressed_size_bytes INTEGER, latitude NUMERIC(10,7), longitude NUMERIC(10,7), quality_score NUMERIC(5,2), quality_passed BOOLEAN DEFAULT true, quality_rejection_reason TEXT, watermark_applied BOOLEAN DEFAULT false, upload_source VARCHAR(20) DEFAULT 'app', uploaded_by UUID, contingency_reason TEXT, captured_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_product_executions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, product_id UUID NOT NULL, category_id UUID, exposure_point VARCHAR(50) DEFAULT 'natural', status VARCHAR(20) DEFAULT 'pending', checked BOOLEAN DEFAULT false, qty_store INTEGER DEFAULT 0, qty_stock INTEGER DEFAULT 0, qty_total INTEGER DEFAULT 0, has_rupture BOOLEAN DEFAULT false, has_damage BOOLEAN DEFAULT false, has_discard BOOLEAN DEFAULT false, observation TEXT, executed_by UUID, executed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_route_product_exec_route_status ON route_product_executions(route_id, status);
CREATE INDEX IF NOT EXISTS idx_brand_checklists_org_brand_active ON brand_checklists(organization_id, brand_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS product_validity_entries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), execution_id UUID, route_id UUID, product_id UUID NOT NULL, expiry_date DATE NOT NULL, qty_store INTEGER DEFAULT 0, qty_stock INTEGER DEFAULT 0, recorded_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS product_ruptures (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, product_id UUID NOT NULL, execution_id UUID, location VARCHAR(20) DEFAULT 'store', qty_store INTEGER DEFAULT 0, qty_stock INTEGER DEFAULT 0, reason VARCHAR(100), observation TEXT, photo_url TEXT, recorded_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS product_damages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, route_id UUID, product_id UUID NOT NULL, pdv_id UUID NOT NULL, brand_id UUID NOT NULL, execution_id UUID, promoter_id UUID NOT NULL, location VARCHAR(20) DEFAULT 'store', qty_store INTEGER DEFAULT 0, qty_stock INTEGER DEFAULT 0, reason VARCHAR(255), description TEXT, photo_url TEXT, status VARCHAR(30) DEFAULT 'registered', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS product_discards (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, product_id UUID NOT NULL, execution_id UUID, qty_store INTEGER DEFAULT 0, qty_stock INTEGER DEFAULT 0, reason VARCHAR(255), photo_url TEXT, observation TEXT, recorded_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS damage_return_requests (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, pdv_id UUID NOT NULL, brand_id UUID NOT NULL, promoter_id UUID NOT NULL, status VARCHAR(30) DEFAULT 'awaiting_invoice', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS damage_return_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID, damage_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS return_invoices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID, invoice_number VARCHAR(100), invoice_date DATE, issuer_name VARCHAR(255), issuer_cnpj VARCHAR(20), photo_url TEXT, pdf_url TEXT, ocr_data JSONB, ocr_confidence NUMERIC(5,2), manually_reviewed BOOLEAN DEFAULT false, uploaded_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_execution_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, action VARCHAR(50) NOT NULL, details JSONB, performed_by UUID, source VARCHAR(20) DEFAULT 'app', created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_edit_audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, field_changed VARCHAR(100), old_value TEXT, new_value TEXT, edited_by UUID NOT NULL, editor_role VARCHAR(30), source VARCHAR(20) DEFAULT 'web', reason TEXT, route_was_completed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_stock_postponements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, product_id UUID, category_id UUID, item_type VARCHAR(20) NOT NULL, reason TEXT NOT NULL, postponed_by UUID NOT NULL, next_route_id UUID, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, route_id UUID, recipient_id UUID NOT NULL, type VARCHAR(30) NOT NULL, title VARCHAR(255) NOT NULL, message TEXT, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS pdv_service_windows (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), pdv_id UUID NOT NULL, weekday INTEGER NOT NULL, open_time TIME NOT NULL, close_time TIME NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());

ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_latitude NUMERIC(10,7);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS home_longitude NUMERIC(10,7);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS max_daily_visits INTEGER DEFAULT 10;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS max_daily_hours NUMERIC(4,1) DEFAULT 8;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pix_key VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pix_key_type VARCHAR(20);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS promoter_access VARCHAR(20) DEFAULT 'open';
ALTER TABLE brands ADD COLUMN IF NOT EXISTS default_checklist_id UUID;

CREATE TABLE IF NOT EXISTS execution_authors (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID, execution_id UUID, action VARCHAR(50) NOT NULL, performed_by UUID NOT NULL, performer_role VARCHAR(30) DEFAULT 'promotor', source VARCHAR(20) DEFAULT 'app', details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS contingency_photo_uploads (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL, photo_id UUID, uploaded_by UUID NOT NULL, uploader_role VARCHAR(30) DEFAULT 'supervisor', source VARCHAR(20) DEFAULT 'web', reason TEXT, device_info TEXT, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_person_assignment_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL, employee_id UUID NOT NULL, action VARCHAR(20) NOT NULL, reason TEXT, changed_by UUID NOT NULL, progress_at_change NUMERIC(5,2) DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS route_stock_schedule_rules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, brand_id UUID, category_id UUID, product_id UUID, pdv_id UUID, rule_type VARCHAR(20) NOT NULL DEFAULT 'stock_count', frequency VARCHAR(20) NOT NULL DEFAULT 'every_visit', max_postponements INTEGER DEFAULT 1, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());

CREATE TABLE IF NOT EXISTS live_photo_books (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, brand_id UUID NOT NULL, pdv_id UUID NOT NULL, route_id UUID, photo_id UUID, category_id UUID, product_id UUID, photo_type VARCHAR(30), photo_url TEXT NOT NULL, promoter_id UUID, captured_at TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_live_photo_books_brand ON live_photo_books(brand_id, pdv_id);

CREATE TABLE IF NOT EXISTS route_report_snapshots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), route_id UUID NOT NULL, snapshot_type VARCHAR(30) DEFAULT 'progress', data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());

ALTER TABLE route_product_executions ADD COLUMN IF NOT EXISTS executed_source VARCHAR(20) DEFAULT 'app';
ALTER TABLE route_photos ADD COLUMN IF NOT EXISTS contingency_uploaded_by UUID;
ALTER TABLE route_photos ADD COLUMN IF NOT EXISTS contingency_device TEXT;
`;

// ============================================
// STEP 45: ACCESS CONTROL MODULE (Fase 5)
// ============================================
const step45AccessControl = `
-- Redes de supermercados
CREATE TABLE IF NOT EXISTS supermarket_networks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  contact_name VARCHAR(255),
  contact_phone VARCHAR(30),
  contact_email VARCHAR(255),
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unidades de supermercado
CREATE TABLE IF NOT EXISTS supermarket_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  network_id UUID REFERENCES supermarket_networks(id) ON DELETE SET NULL,
  pdv_id UUID REFERENCES pdvs(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  zip_code VARCHAR(10),
  neighborhood VARCHAR(100),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  radius_meters INTEGER DEFAULT 200,
  opening_time TIME DEFAULT '06:00',
  closing_time TIME DEFAULT '22:00',
  operating_days JSONB DEFAULT '[1,2,3,4,5,6]',
  access_rules JSONB DEFAULT '{}',
  operational_requirements TEXT,
  totem_enabled BOOLEAN DEFAULT false,
  totem_token VARCHAR(255),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agências terceiras
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  responsible_name VARCHAR(255),
  responsible_cpf VARCHAR(14),
  responsible_phone VARCHAR(30),
  responsible_email VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2),
  plan_name VARCHAR(100),
  max_promoters INTEGER DEFAULT 10,
  price_per_promoter NUMERIC(10,2) DEFAULT 0,
  billing_status VARCHAR(20) DEFAULT 'active',
  auto_block_on_overdue BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Login separado para agências
CREATE TABLE IF NOT EXISTS agency_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(30) DEFAULT 'admin',
  last_login TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Promotores vinculados a agências
CREATE TABLE IF NOT EXISTS agency_promoters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  cpf VARCHAR(14) NOT NULL,
  phone VARCHAR(30),
  photo_url TEXT,
  document_url TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agency_id, cpf)
);
CREATE INDEX IF NOT EXISTS idx_agency_promoters_cpf ON agency_promoters(cpf);

-- Regras de acesso ao PDV
CREATE TABLE IF NOT EXISTS pdv_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  allowed_weekdays JSONB DEFAULT '[1,2,3,4,5]',
  start_time TIME DEFAULT '08:00',
  end_time TIME DEFAULT '18:00',
  max_duration_minutes INTEGER,
  require_active_route BOOLEAN DEFAULT false,
  require_prior_approval BOOLEAN DEFAULT false,
  approval_status VARCHAR(20) DEFAULT 'approved',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissões de marcas por regra de acesso
CREATE TABLE IF NOT EXISTS promoter_brand_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_rule_id UUID NOT NULL REFERENCES pdv_access_rules(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(access_rule_id, brand_id)
);

-- Logs de entrada/saída
CREATE TABLE IF NOT EXISTS pdv_entry_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  cpf VARCHAR(14) NOT NULL,
  entry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'authorized',
  block_reason VARCHAR(100),
  origin VARCHAR(20) DEFAULT 'totem',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  device_info TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pdv_entry_logs_cpf ON pdv_entry_logs(cpf);
CREATE INDEX IF NOT EXISTS idx_pdv_entry_logs_unit ON pdv_entry_logs(supermarket_unit_id, entry_at);
CREATE INDEX IF NOT EXISTS idx_pdv_entry_logs_date ON pdv_entry_logs(organization_id, entry_at);

-- Auditoria completa
CREATE TABLE IF NOT EXISTS access_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  supermarket_unit_id UUID REFERENCES supermarket_units(id) ON DELETE SET NULL,
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  performed_by UUID,
  performed_by_type VARCHAR(20) DEFAULT 'system',
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_access_audit_org ON access_audit_logs(organization_id, created_at);

-- Login para supermercados
CREATE TABLE IF NOT EXISTS supermarket_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  network_id UUID REFERENCES supermarket_networks(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(30) DEFAULT 'manager',
  can_view_all_network BOOLEAN DEFAULT false,
  last_login TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sessões do totem
CREATE TABLE IF NOT EXISTS totem_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  device_info TEXT,
  ip_address VARCHAR(45),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Presença de marcas por dia
CREATE TABLE IF NOT EXISTS daily_brand_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  presence_date DATE NOT NULL DEFAULT CURRENT_DATE,
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  promoter_count INTEGER DEFAULT 0,
  first_entry TIMESTAMPTZ,
  last_exit TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supermarket_unit_id, brand_id, presence_date)
);
`;

const step45cAuthModules = `
-- Configurações de autenticação por rede
CREATE TABLE IF NOT EXISTS network_auth_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id UUID NOT NULL REFERENCES supermarket_networks(id) ON DELETE CASCADE,
  cpf_entry_enabled BOOLEAN DEFAULT true,
  qr_entry_enabled BOOLEAN DEFAULT false,
  selfie_entry_required BOOLEAN DEFAULT false,
  selfie_exit_required BOOLEAN DEFAULT false,
  facial_recognition_enabled BOOLEAN DEFAULT false,
  combined_validation VARCHAR(50) DEFAULT 'cpf_only',
  security_level VARCHAR(20) DEFAULT 'basic',
  facial_min_confidence NUMERIC(5,2) DEFAULT 70.00,
  allow_low_confidence_entry BOOLEAN DEFAULT false,
  low_confidence_action VARCHAR(20) DEFAULT 'alert',
  qr_expiration_minutes INTEGER DEFAULT 60,
  qr_single_use BOOLEAN DEFAULT true,
  require_lgpd_consent BOOLEAN DEFAULT true,
  consent_text TEXT DEFAULT 'Ao utilizar este sistema, você consente com a captura e armazenamento temporário de sua imagem para fins de controle de acesso, conforme a Lei Geral de Proteção de Dados (LGPD).',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(network_id)
);

CREATE TABLE IF NOT EXISTS pdv_auth_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  cpf_entry_enabled BOOLEAN,
  qr_entry_enabled BOOLEAN,
  selfie_entry_required BOOLEAN,
  selfie_exit_required BOOLEAN,
  facial_recognition_enabled BOOLEAN,
  combined_validation VARCHAR(50),
  security_level VARCHAR(20),
  facial_min_confidence NUMERIC(5,2),
  allow_low_confidence_entry BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(supermarket_unit_id)
);

CREATE TABLE IF NOT EXISTS qr_access_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  valid_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_from TIME,
  valid_until TIME,
  status VARCHAR(20) DEFAULT 'active',
  used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by UUID,
  created_by_type VARCHAR(20) DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_qr_promoter CHECK (agency_promoter_id IS NOT NULL OR employee_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_status ON qr_access_tokens(status, expires_at);

CREATE TABLE IF NOT EXISTS qr_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_token_id UUID REFERENCES qr_access_tokens(id) ON DELETE SET NULL,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  reason VARCHAR(100),
  device_info TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS selfie_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_log_id UUID REFERENCES pdv_entry_logs(id) ON DELETE SET NULL,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  capture_type VARCHAR(20) NOT NULL,
  image_url TEXT NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  device_info TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_selfie_captures_entry ON selfie_captures(entry_log_id);

CREATE TABLE IF NOT EXISTS facial_recognition_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_log_id UUID REFERENCES pdv_entry_logs(id) ON DELETE SET NULL,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  comparison_type VARCHAR(30) NOT NULL,
  confidence_score NUMERIC(5,2),
  result VARCHAR(20) NOT NULL,
  base_image_url TEXT,
  captured_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authentication_attempt_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  cpf VARCHAR(14),
  method VARCHAR(30) NOT NULL,
  auth_steps JSONB DEFAULT '[]',
  overall_result VARCHAR(20) NOT NULL,
  confidence_level NUMERIC(5,2),
  block_reason VARCHAR(100),
  entry_log_id UUID REFERENCES pdv_entry_logs(id) ON DELETE SET NULL,
  device_info TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_org ON authentication_attempt_logs(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_unit ON authentication_attempt_logs(supermarket_unit_id, created_at);

CREATE TABLE IF NOT EXISTS fraud_detection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  cpf VARCHAR(14),
  fraud_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium',
  details JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_logs_org ON fraud_detection_logs(organization_id, created_at);

CREATE TABLE IF NOT EXISTS promoter_identity_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  base_photo_url TEXT NOT NULL,
  face_encoding JSONB,
  lgpd_consent_given BOOLEAN DEFAULT false,
  lgpd_consent_at TIMESTAMPTZ,
  lgpd_consent_ip VARCHAR(45),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_identity_promoter CHECK (agency_promoter_id IS NOT NULL OR employee_id IS NOT NULL)
);
`;

const step46AgencyBilling = `
CREATE TABLE IF NOT EXISTS agency_billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  price_per_promoter NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_promoters INTEGER,
  features JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agency_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES agency_billing_plans(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'active',
  current_period_start DATE NOT NULL DEFAULT CURRENT_DATE,
  current_period_end DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
  promoter_count INTEGER DEFAULT 0,
  amount_due NUMERIC(10,2) DEFAULT 0,
  amount_paid NUMERIC(10,2) DEFAULT 0,
  last_payment_at TIMESTAMPTZ,
  overdue_since DATE,
  auto_block_enabled BOOLEAN DEFAULT false,
  block_after_days INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agency_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES agency_subscriptions(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  promoter_count INTEGER NOT NULL DEFAULT 0,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount NUMERIC(10,2) DEFAULT 0,
  final_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agency_invoices_agency ON agency_invoices(agency_id, reference_month);
CREATE INDEX IF NOT EXISTS idx_agency_invoices_status ON agency_invoices(status, due_date);
CREATE TABLE IF NOT EXISTS agency_billing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  performed_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const step45dPromoterConformity = `
CREATE TABLE IF NOT EXISTS promoter_conformity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  network_id UUID REFERENCES supermarket_networks(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reason TEXT,
  photo_quality_score NUMERIC(5,2),
  photo_resolution_ok BOOLEAN DEFAULT false,
  photo_frontal_ok BOOLEAN DEFAULT false,
  photo_illumination_ok BOOLEAN DEFAULT false,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_conformity_promoter CHECK (agency_promoter_id IS NOT NULL OR employee_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_conformity_org ON promoter_conformity(organization_id, status);

CREATE TABLE IF NOT EXISTS facial_comparison_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supermarket_unit_id UUID REFERENCES supermarket_units(id) ON DELETE SET NULL,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  entry_log_id UUID REFERENCES pdv_entry_logs(id) ON DELETE SET NULL,
  comparison_type VARCHAR(30) NOT NULL DEFAULT 'entry_vs_base',
  base_image_url TEXT,
  captured_image_url TEXT,
  confidence_score NUMERIC(5,2),
  result VARCHAR(20) NOT NULL DEFAULT 'pending',
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facial_logs_org ON facial_comparison_logs(organization_id, created_at);

CREATE TABLE IF NOT EXISTS conformity_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
  agency_promoter_id UUID REFERENCES agency_promoters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  network_id UUID NOT NULL REFERENCES supermarket_networks(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL DEFAULT 'photo_non_conform',
  message TEXT,
  channel VARCHAR(20) DEFAULT 'system',
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conformity_notif_agency ON conformity_notifications(agency_id, read_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conformity_agency_network_unique
ON promoter_conformity (agency_promoter_id, network_id)
WHERE agency_promoter_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promoter_conformity_employee_network_unique
ON promoter_conformity (employee_id, network_id)
WHERE employee_id IS NOT NULL;
`;

const step47VisitRequests = `
-- Solicitações de visita (agência -> supermercado)
CREATE TABLE IF NOT EXISTS visit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  supermarket_unit_id UUID NOT NULL REFERENCES supermarket_units(id) ON DELETE CASCADE,
  promoter_id UUID REFERENCES agency_promoters(id) ON DELETE SET NULL,
  promoter_name VARCHAR(255),
  brand_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  weekdays JSONB DEFAULT '[1,2,3,4,5]',
  start_time TIME DEFAULT '08:00',
  end_time TIME DEFAULT '18:00',
  notes TEXT,
  rejection_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visit_requests_agency ON visit_requests(agency_id);
CREATE INDEX IF NOT EXISTS idx_visit_requests_unit ON visit_requests(supermarket_unit_id);
CREATE INDEX IF NOT EXISTS idx_visit_requests_status ON visit_requests(status);
`;
const migrationSteps = [
  { name: 'Enums', sql: step1Enums, critical: true },
  { name: 'Core Tables (users, plans)', sql: step2CoreTables, critical: true },
  { name: 'Organizations', sql: step3Organizations, critical: true },
  { name: 'User Relations', sql: step4UserRelations, critical: true },
  { name: 'Connections', sql: step5Connections, critical: true },
  { name: 'Contacts & Messages', sql: step6ContactsMessages, critical: false },
  { name: 'Campaigns', sql: step7Campaigns, critical: false },
  { name: 'Asaas Integration', sql: step8Asaas, critical: false },
  { name: 'Chat System', sql: step9Chat, critical: false },
  { name: 'System Settings', sql: step10Settings, critical: false },
  { name: 'Indexes', sql: step11Indexes, critical: false },
  { name: 'Attendance Status', sql: step12Attendance, critical: false },
  { name: 'Departments / Queues', sql: step17Departments, critical: false },
  { name: 'Departments Conversations Link', sql: step17bDepartmentConversations, critical: false },
  { name: 'Chatbots System', sql: step13Chatbots, critical: false },
  { name: 'Chatbot Permissions', sql: step14ChatbotPermissions, critical: false },
  { name: 'Chatbot Team & Keywords', sql: step15ChatbotTeamKeywords, critical: false },
  { name: 'Independent Flows', sql: step16IndependentFlows, critical: false },
  { name: 'CRM System', sql: step18CRM, critical: false },
  { name: 'CRM Config', sql: step19CRMConfig, critical: false },
  { name: 'CRM Migrations', sql: step20CRMMigrations, critical: false },
  { name: 'CRM Prospects', sql: step21Prospects, critical: false },
  { name: 'CRM Automation', sql: step22CRMAutomation, critical: false },
  { name: 'Email System', sql: step23Email, critical: false },
  { name: 'Google Calendar', sql: step24GoogleCalendar, critical: false },
  { name: 'AI Agents', sql: step25AIAgents, critical: false },
  { name: 'External Forms', sql: step26ExternalForms, critical: false },
  { name: 'Lead Distribution', sql: step27LeadDistribution, critical: false },
  { name: 'Lead Scoring', sql: step28LeadScoring, critical: false },
  { name: 'Conversation Summaries', sql: step29ConversationSummaries, critical: false },
  { name: 'Nurturing Sequences', sql: step30NurturingSequences, critical: false },
  { name: 'CTWA Analytics', sql: step31CTWAAnalytics, critical: false },
  { name: 'Group Secretary', sql: step32GroupSecretary, critical: false },
  { name: 'Ghost Audit Logs', sql: step33GhostAudit, critical: false },
  { name: 'Ghost Saved Analyses', sql: step34GhostSavedAnalyses, critical: false },
  { name: 'Group Funnels', sql: step35GroupFunnels, critical: false },
  { name: 'Projects Module', sql: step36Projects, critical: false },
  { name: 'Permission Templates', sql: step37PermissionTemplates, critical: false },
  { name: 'Push Notifications', sql: step38PushNotifications, critical: false },
  { name: 'Global AI Agents', sql: step39GlobalAgents, critical: false },
  { name: 'Lead Webhooks', sql: step40LeadWebhooks, critical: false },
  { name: 'Meta Message Templates', sql: step41MetaTemplates, critical: false },
  { name: 'RH Module', sql: step42RH, critical: false },
  { name: 'Promotor App (Fase 2)', sql: step43PromotorApp, critical: false },
  { name: 'Merchandising Phase 4 (Routes)', sql: step44MerchPhase4, critical: false },
  { name: 'Access Control (Fase 5)', sql: step45AccessControl, critical: false },
  { name: 'Access Control Auth Modules (Fase 5)', sql: step45cAuthModules, critical: false },
  { name: 'Promoter Conformity (Fase 5)', sql: step45dPromoterConformity, critical: false },
  { name: 'Agency Billing', sql: step46AgencyBilling, critical: false },
  { name: 'Agency Allowed Units', sql: step45bAgencyAllowedUnits, critical: false },
  { name: 'Visit Requests', sql: step47VisitRequests, critical: false },
];

export async function initDatabase() {
  console.log('🔄 Initializing database in steps...');
  
  let successCount = 0;
  let failedSteps = [];
  let criticalFailure = false;

  for (const step of migrationSteps) {
    try {
      console.log(`  → Step: ${step.name}...`);
      await pool.query(step.sql);
      console.log(`  ✅ ${step.name} - OK`);
      successCount++;
    } catch (error) {
      console.error(`  ❌ ${step.name} - FAILED: ${error.message}`);
      failedSteps.push({ name: step.name, error: error.message });
      
      if (step.critical) {
        criticalFailure = true;
        console.error(`  🛑 Critical step failed, stopping initialization`);
        break;
      }
      // Non-critical steps: continue to next step
    }
  }

  console.log('');
  console.log('📊 Database initialization summary:');
  console.log(`   - Steps completed: ${successCount}/${migrationSteps.length}`);
  
  if (failedSteps.length > 0) {
    console.log(`   - Failed steps: ${failedSteps.map(s => s.name).join(', ')}`);
  }
  
  if (criticalFailure) {
    console.error('❌ Database initialization failed (critical step error)');
    return false;
  }
  
  if (failedSteps.length === 0) {
    console.log('✅ Database initialized successfully!');
  } else {
    console.log('⚠️ Database initialized with warnings (some non-critical steps failed)');
  }

  // Ensure all users have an organization (fix orphaned users)
  try {
    const orphans = await pool.query(
      `SELECT u.id, u.name, u.email FROM users u
       WHERE NOT EXISTS (
         SELECT 1 FROM organization_members om WHERE om.user_id = u.id
       )`
    );
    for (const user of orphans.rows) {
      const slug = (user.name || 'org').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        + '-' + Date.now().toString(36);
      const orgRes = await pool.query(
        `INSERT INTO organizations (name, slug, modules_enabled)
         VALUES ($1, $2, '{"campaigns":true,"billing":true,"groups":true,"scheduled_messages":true,"chatbots":true,"chat":true,"crm":true,"rh":true}'::jsonb)
         RETURNING id`,
        [user.name || 'Organização', slug]
      );
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [orgRes.rows[0].id, user.id]
      );
      console.log(`  🏢 Created organization for orphaned user: ${user.email}`);
    }
  } catch (e) {
    console.error('  ⚠️ Failed to fix orphaned users:', e.message);
  }

  // Ensure master superadmin
  try {
    const res = await pool.query(
      `UPDATE users SET is_superadmin = true WHERE email = 'tnicodemos@gmail.com' AND is_superadmin IS NOT TRUE RETURNING email`
    );
    if (res.rowCount > 0) {
      console.log('  👑 Promoted tnicodemos@gmail.com to superadmin');
    }
    try {
      await pool.query(`UPDATE users SET role = 'superadmin' WHERE email = 'tnicodemos@gmail.com' AND (role IS NULL OR role <> 'superadmin')`);
    } catch (_) { /* role column may not exist */ }
  } catch (e) {
    console.error('  ⚠️ Failed to promote superadmin:', e.message);
  }


  try {
    await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS responsible_cpf VARCHAR(14)`);
  } catch (e) {
    console.error('  ⚠️ Failed to ensure agencies.responsible_cpf:', e.message);
  }

  // Expand agency_promoters with additional fields
  try {
    await pool.query(`
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(30);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS birth_date DATE;
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS rg VARCHAR(20);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS city VARCHAR(100);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS state VARCHAR(2);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(30);
      ALTER TABLE agency_promoters ADD COLUMN IF NOT EXISTS notes TEXT;
    `);
  } catch (e) {
    console.error('  ⚠️ Failed to expand agency_promoters:', e.message);
  }

  // ============================================================
  // HOLDING / MULTI-EMPRESA (RH)
  // ============================================================
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        trade_name VARCHAR(255),
        cnpj VARCHAR(20),
        logo_url TEXT,
        color VARCHAR(20) DEFAULT '#3B82F6',
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(2),
        phone VARCHAR(30),
        email VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        punch_facial_required BOOLEAN DEFAULT true,
        punch_gps_required BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_companies_org ON companies(organization_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_org_cnpj ON companies(organization_id, cnpj) WHERE cnpj IS NOT NULL;

      ALTER TABLE companies ADD COLUMN IF NOT EXISTS cep VARCHAR(15);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS address_number VARCHAR(20);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS complement VARCHAR(120);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(120);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS ie VARCHAR(30);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS im VARCHAR(30);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS website VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_representative VARCHAR(255);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_representative_cpf VARCHAR(20);
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS default_radius_meters INTEGER DEFAULT 200;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS geofence_strict BOOLEAN DEFAULT false;
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS geofence_require_photo BOOLEAN DEFAULT false;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);

      CREATE TABLE IF NOT EXISTS punch_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        punch_date DATE NOT NULL,
        type VARCHAR(30) NOT NULL,
        justification TEXT NOT NULL,
        attachment_url TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMPTZ,
        review_note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_punch_adjustments_org ON punch_adjustments(organization_id);
      CREATE INDEX IF NOT EXISTS idx_punch_adjustments_company ON punch_adjustments(company_id);
      CREATE INDEX IF NOT EXISTS idx_punch_adjustments_employee ON punch_adjustments(employee_id);
      CREATE INDEX IF NOT EXISTS idx_punch_adjustments_status ON punch_adjustments(status);

      CREATE TABLE IF NOT EXISTS document_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        file_url TEXT NOT NULL,
        require_signature BOOLEAN DEFAULT false,
        require_read BOOLEAN DEFAULT true,
        sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        read_at TIMESTAMPTZ,
        signed_at TIMESTAMPTZ,
        signature_hash VARCHAR(128),
        status VARCHAR(20) NOT NULL DEFAULT 'sent',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_doc_deliveries_org ON document_deliveries(organization_id);
      CREATE INDEX IF NOT EXISTS idx_doc_deliveries_company ON document_deliveries(company_id);
      CREATE INDEX IF NOT EXISTS idx_doc_deliveries_employee ON document_deliveries(employee_id);
      CREATE INDEX IF NOT EXISTS idx_doc_deliveries_status ON document_deliveries(status);
    `);

    // Seed: uma company padrão "Anatriello" por organização que não tenha nenhuma
    await pool.query(`
      INSERT INTO companies (organization_id, name, trade_name, is_active, punch_facial_required)
      SELECT o.id, 'Anatriello', 'Anatriello Gestão', true, true
      FROM organizations o
      WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.organization_id = o.id)
    `);

    // Migração leve: vincular employees sem company_id à primeira company da org
    await pool.query(`
      UPDATE employees e
      SET company_id = (SELECT id FROM companies c WHERE c.organization_id = e.organization_id ORDER BY created_at LIMIT 1)
      WHERE e.company_id IS NULL
    `);

    // ===== Colunas estendidas de employees (importação eSocial/folha) =====
    await pool.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS mother_name VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS father_name VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS spouse_name VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_city VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_country VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality_country VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS foreigner_registry VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS residence_time VARCHAR(50);

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS rg_uf VARCHAR(2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS rg_issue_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ctps_digit VARCHAR(4);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ctps_uf VARCHAR(2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ctps_issue_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cnh_uf VARCHAR(2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cnh_first_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cnh_issue_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS reservist_cert VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS pis_issue_date DATE;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_term VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_office VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_book VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_folio VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_city VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS civil_registry_date DATE;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ric_number VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ric_issuer VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS ric_issue_date DATE;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS class_body_number VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS class_body_org VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS class_body_issue_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS class_body_expiry DATE;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS education_level VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS cbo_code VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_position VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_cbo VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_salary NUMERIC(12,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_schedule_desc TEXT;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS registration_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS admission_type VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS occupation_nature VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_employer_cnpj VARCHAR(20);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS transfer_with_onus BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS transfer_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS service_time_start_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS retirement_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_extension_end DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS reinstatement_date DATE;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS previous_registration VARCHAR(50);

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_regime VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_type VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_rest VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS journey_type VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS journey_description TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_schedule_desc TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS night_shift VARCHAR(20);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_hours NUMERIC(6,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS daily_hours NUMERIC(4,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS punch_card_number VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_sheet VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_book VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_folio VARCHAR(30);

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS insalubrity_percent NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS insalubrity_incidence VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS periculosity_percent NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS periculosity_incidence VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS night_shift_percent NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS night_shift_incidence VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS private_pension_value NUMERIC(12,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS private_pension_13 NUMERIC(12,2);

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS syndicate VARCHAR(255);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS syndicalized BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS syndicate_discount BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS fgts_category VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS fgts_occurrence VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS fgts_account VARCHAR(30);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS social_security_regime VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS worker_class VARCHAR(150);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS collaborator_type VARCHAR(80);

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_digit VARCHAR(4);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_card VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS vr_card VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS vt_card VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS va_card VARCHAR(50);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS receives_vr BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS receives_va BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS receives_vt BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS receives_advance BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS advance_percent NUMERIC(5,2);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS partial_time_regime BOOLEAN;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS unemployment_benefit BOOLEAN;

      ALTER TABLE employees ADD COLUMN IF NOT EXISTS observation TEXT;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS import_extra JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS esocial_receipt VARCHAR(80);
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS esocial_integration_date TIMESTAMPTZ;
    `);

    console.log('  🏢 Holding/companies schema ready');
  } catch (e) {
    console.error('  ⚠️ Failed to ensure holding schema:', e.message);
  }

  return true;
}


