-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "results" (
    "domain" TEXT NOT NULL,
    "societe_name" TEXT,
    "societe_name_source" TEXT,
    "siret" TEXT,
    "siren" TEXT,
    "rcs" TEXT,
    "capital" TEXT,
    "forme_juridique" TEXT,
    "tva_intracom" TEXT,
    "dirigeant_nom" TEXT,
    "address" TEXT,
    "code_postal" TEXT,
    "ville_mentionnee" TEXT,
    "code_naf" TEXT,
    "emails" TEXT,
    "email_principal" TEXT,
    "phones" TEXT,
    "phone_principal" TEXT,
    "phone_type" TEXT,
    "social_linkedin" TEXT,
    "social_facebook" TEXT,
    "social_instagram" TEXT,
    "social_twitter" TEXT,
    "social_youtube" TEXT,
    "has_contact_form" INTEGER,
    "has_chat_widget" INTEGER,
    "has_whatsapp" INTEGER,
    "final_url" TEXT,
    "http_status" INTEGER,
    "has_https" INTEGER,
    "response_time_ms" INTEGER,
    "html_size" INTEGER,
    "server_header" TEXT,
    "title" TEXT,
    "meta_description" TEXT,
    "language" TEXT,
    "doctype" TEXT,
    "has_noindex" INTEGER,
    "has_mixed_content" INTEGER,
    "has_lorem_ipsum" INTEGER,
    "has_security_headers" INTEGER,
    "powered_by" TEXT,
    "php_version" TEXT,
    "generator" TEXT,
    "cms" TEXT,
    "cms_version" TEXT,
    "platform_name" TEXT,
    "page_builder_name" TEXT,
    "js_framework_name" TEXT,
    "css_framework_name" TEXT,
    "jquery_version" TEXT,
    "bootstrap_version" TEXT,
    "agency_signature" TEXT,
    "has_responsive" INTEGER,
    "has_favicon" INTEGER,
    "has_old_html" INTEGER,
    "has_flash" INTEGER,
    "has_old_images" INTEGER,
    "has_phpsessid" INTEGER,
    "has_ie_polyfills" INTEGER,
    "has_layout_tables" INTEGER,
    "has_viewport_no_scale" INTEGER,
    "inline_style_count" INTEGER,
    "inline_js_events_count" INTEGER,
    "placeholder_links_count" INTEGER,
    "imgs_missing_alt_pct" INTEGER,
    "h1_count" INTEGER,
    "copyright_year" INTEGER,
    "has_modern_images" INTEGER,
    "has_minified_assets" INTEGER,
    "has_compression" INTEGER,
    "has_cdn" INTEGER,
    "has_lazy_loading" INTEGER,
    "has_hreflang" INTEGER,
    "has_meta_keywords" INTEGER,
    "analytics_type" TEXT,
    "has_facebook_pixel" INTEGER,
    "has_linkedin_pixel" INTEGER,
    "has_google_ads" INTEGER,
    "has_schema_org" INTEGER,
    "has_og_tags" INTEGER,
    "has_canonical" INTEGER,
    "has_cookie_banner" INTEGER,
    "cookie_banner_name" TEXT,
    "has_mentions_legales" INTEGER,
    "has_devis" INTEGER,
    "has_ecommerce" INTEGER,
    "has_recruiting_page" INTEGER,
    "has_blog" INTEGER,
    "has_google_maps" INTEGER,
    "has_horaires" INTEGER,
    "has_booking_system" INTEGER,
    "has_newsletter_provider" INTEGER,
    "has_certifications" INTEGER,
    "certifications_list" TEXT,
    "has_app_links" INTEGER,
    "has_trust_signals" INTEGER,
    "nb_pages_internes" INTEGER,
    "niveau" TEXT,
    "raison_exclusion" TEXT,
    "score_pertinence" DOUBLE PRECISION,
    "enriched" INTEGER,
    "enriched_date" TEXT,
    "enriched_via" TEXT,
    "api_nom_complet" TEXT,
    "api_forme_juridique" TEXT,
    "api_code_naf" TEXT,
    "api_date_creation" TEXT,
    "api_etat" TEXT,
    "api_categorie" TEXT,
    "api_est_asso" INTEGER,
    "api_est_ess" INTEGER,
    "api_est_service_public" INTEGER,
    "api_est_qualiopi" INTEGER,
    "api_est_rge" INTEGER,
    "api_est_societe_mission" INTEGER,
    "api_effectifs" TEXT,
    "api_ca" BIGINT,
    "api_ville" TEXT,
    "api_code_postal" TEXT,
    "api_departement" TEXT,
    "api_adresse" TEXT,
    "api_latitude" DOUBLE PRECISION,
    "api_longitude" DOUBLE PRECISION,
    "api_dirigeant_prenom" TEXT,
    "api_dirigeant_nom" TEXT,
    "api_dirigeant_qualite" TEXT,
    "api_dirigeant_annee_naissance" TEXT,
    "bodacc_procedure" TEXT,
    "dept_computed" TEXT,
    "tech_score" INTEGER,
    "eclate_score" INTEGER,
    "lead_flags" TEXT,
    "cnb_nom" TEXT,
    "cnb_prenom" TEXT,
    "cnb_barreau" TEXT,
    "cnb_specialite1" TEXT,
    "cnb_specialite2" TEXT,
    "cnb_date_serment" TEXT,
    "cnb_raison_sociale" TEXT,
    "cnb_tel" TEXT,
    "est_encore_avocat" INTEGER,
    "obsolescence_score" INTEGER,
    "best_ville" TEXT,
    "best_cp" TEXT,
    "gmaps_status" TEXT,
    "gmaps_website" TEXT,
    "gmaps_rating" DOUBLE PRECISION,
    "gmaps_reviews" INTEGER,
    "gmaps_checked_at" TEXT,
    "scan_date" TEXT,
    "scan_duration_ms" INTEGER,

    CONSTRAINT "results_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "email_verification" (
    "domain" TEXT NOT NULL,
    "mx_exists" INTEGER,
    "mx_host" TEXT,
    "is_catch_all" INTEGER,
    "smtp_connected" INTEGER,
    "existing_email_valid" INTEGER,
    "dirigeant_email" TEXT,
    "dirigeant_email_pattern" TEXT,
    "dirigeant_emails_all" TEXT,
    "aliases_found" TEXT,
    "mail_provider" TEXT,
    "candidates_tested" INTEGER,
    "error" TEXT,
    "verified_at" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "phone_verification" (
    "domain" TEXT NOT NULL,
    "is_valid" INTEGER,
    "phone_type" TEXT,
    "is_test_number" INTEGER,
    "is_shared" INTEGER,
    "carrier" TEXT,

    CONSTRAINT "phone_verification_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "outreach" (
    "domain" TEXT NOT NULL,
    "tenant_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'a_contacter',
    "contacted_date" TEXT,
    "contact_method" TEXT,
    "notes" TEXT,
    "qualification" DOUBLE PRECISION,
    "last_visited" TEXT,
    "updated_at" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outreach_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "claude_activity" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID,
    "domain" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TEXT NOT NULL DEFAULT NOW(),

    CONSTRAINT "claude_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followups" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID,
    "domain" TEXT NOT NULL,
    "scheduled_at" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "created_at" TEXT DEFAULT NOW(),

    CONSTRAINT "followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_emails" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID,
    "domain" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "from_email" TEXT NOT NULL DEFAULT 'robert.brunon@veridian.site',
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "sent_at" TEXT NOT NULL,
    "message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',

    CONSTRAINT "outreach_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_log" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID,
    "direction" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "from_number" TEXT,
    "to_number" TEXT,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "started_at" TEXT NOT NULL,
    "ended_at" TEXT,
    "duration_seconds" INTEGER,
    "recording_path" TEXT,
    "notes" TEXT,
    "telnyx_call_control_id" TEXT,

    CONSTRAINT "call_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_segments" (
    "domain" TEXT NOT NULL,
    "segment" TEXT NOT NULL DEFAULT 'audit',
    "tenant_id" UUID,
    "added_at" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "lead_segments_pkey" PRIMARY KEY ("domain","segment")
);

-- CreateTable
CREATE TABLE "pipeline_config" (
    "key" TEXT NOT NULL,
    "tenant_id" UUID,
    "value" TEXT NOT NULL,

    CONSTRAINT "pipeline_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "pj_leads" (
    "pj_id" TEXT NOT NULL,
    "name" TEXT,
    "rue" TEXT,
    "code_postal" TEXT,
    "ville" TEXT,
    "departement" TEXT,
    "address_full" TEXT,
    "phone_principal" TEXT,
    "phones" TEXT,
    "website_url" TEXT,
    "website_domain" TEXT,
    "website_found_via" TEXT,
    "activites_pj" TEXT,
    "categories" TEXT,
    "description" TEXT,
    "nb_avis_pj" INTEGER,
    "rating_pj" TEXT,
    "siret" TEXT,
    "siren" TEXT,
    "api_nom_complet" TEXT,
    "api_forme_juridique" TEXT,
    "api_code_naf" TEXT,
    "api_date_creation" TEXT,
    "api_etat" TEXT,
    "api_categorie" TEXT,
    "api_effectifs" TEXT,
    "api_ca" INTEGER,
    "api_dirigeant" TEXT,
    "matched_domain" TEXT,
    "matched_via" TEXT,
    "pj_url" TEXT,
    "scraped_at" TEXT,
    "enriched_at" TEXT,
    "synced_at" TEXT,
    "is_solocal" INTEGER,
    "solocal_tier" TEXT,
    "honeypot_score" INTEGER,
    "honeypot_flag" TEXT,
    "honeypot_reasons" TEXT,

    CONSTRAINT "pj_leads_pkey" PRIMARY KEY ("pj_id")
);

-- CreateTable
CREATE TABLE "ovh_monthly_destinations" (
    "month" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "tenant_id" UUID,
    "call_count" INTEGER NOT NULL DEFAULT 1,
    "first_called_at" TEXT NOT NULL,

    CONSTRAINT "ovh_monthly_destinations_pkey" PRIMARY KEY ("month","destination")
);

-- CreateIndex
CREATE INDEX "outreach_tenant_id_idx" ON "outreach"("tenant_id");

-- CreateIndex
CREATE INDEX "claude_activity_tenant_id_idx" ON "claude_activity"("tenant_id");

-- CreateIndex
CREATE INDEX "claude_activity_domain_idx" ON "claude_activity"("domain");

-- CreateIndex
CREATE INDEX "claude_activity_activity_type_idx" ON "claude_activity"("activity_type");

-- CreateIndex
CREATE INDEX "claude_activity_created_at_idx" ON "claude_activity"("created_at" DESC);

-- CreateIndex
CREATE INDEX "followups_tenant_id_idx" ON "followups"("tenant_id");

-- CreateIndex
CREATE INDEX "followups_domain_idx" ON "followups"("domain");

-- CreateIndex
CREATE INDEX "followups_status_idx" ON "followups"("status");

-- CreateIndex
CREATE INDEX "followups_scheduled_at_idx" ON "followups"("scheduled_at");

-- CreateIndex
CREATE INDEX "outreach_emails_tenant_id_idx" ON "outreach_emails"("tenant_id");

-- CreateIndex
CREATE INDEX "outreach_emails_domain_idx" ON "outreach_emails"("domain");

-- CreateIndex
CREATE INDEX "outreach_emails_sent_at_idx" ON "outreach_emails"("sent_at");

-- CreateIndex
CREATE INDEX "call_log_tenant_id_idx" ON "call_log"("tenant_id");

-- CreateIndex
CREATE INDEX "call_log_domain_idx" ON "call_log"("domain");

-- CreateIndex
CREATE INDEX "call_log_started_at_idx" ON "call_log"("started_at" DESC);

-- CreateIndex
CREATE INDEX "lead_segments_tenant_id_idx" ON "lead_segments"("tenant_id");

-- CreateIndex
CREATE INDEX "pipeline_config_tenant_id_idx" ON "pipeline_config"("tenant_id");

-- CreateIndex
CREATE INDEX "pj_leads_matched_domain_idx" ON "pj_leads"("matched_domain");

-- CreateIndex
CREATE INDEX "pj_leads_departement_idx" ON "pj_leads"("departement");

-- CreateIndex
CREATE INDEX "pj_leads_siren_idx" ON "pj_leads"("siren");

-- CreateIndex
CREATE INDEX "ovh_monthly_destinations_tenant_id_idx" ON "ovh_monthly_destinations"("tenant_id");

-- AddForeignKey
ALTER TABLE "email_verification" ADD CONSTRAINT "email_verification_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claude_activity" ADD CONSTRAINT "claude_activity_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followups" ADD CONSTRAINT "followups_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_domain_fkey" FOREIGN KEY ("domain") REFERENCES "results"("domain") ON DELETE SET NULL ON UPDATE CASCADE;

