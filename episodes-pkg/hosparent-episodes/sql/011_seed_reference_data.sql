-- ============================================================
-- Migration 011: Seed reference data
-- Anesthesia base units + crosswalk + 2026 conversion factors
-- + default component weights. Idempotent (ON CONFLICT).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Anesthesia base units (source: research brief, mirrored from
-- DOL OWCP anesthesia base-unit table / ASA RVG integers).
-- is_verified=TRUE only for values explicitly confirmed in brief.
-- ------------------------------------------------------------
INSERT INTO anesthesia_base_units (anes_cpt, base_units, description, is_verified) VALUES
('00790', 7,  'Anesthesia, upper abdomen laparoscopy (incl. lap chole)', TRUE),
('00840', 6,  'Anesthesia, lower abdomen intraperitoneal (hernia/appy region)', TRUE),
('00811', 4,  'Anesthesia, lower GI endoscopy NOS', TRUE),
('00812', 3,  'Anesthesia, screening colonoscopy', TRUE),
('00810', 5,  'LEGACY lower GI endoscopy (deleted; use 00811/00812)', TRUE),
('01402', 7,  'Anesthesia, total knee arthroplasty', TRUE),
('01214', 8,  'Anesthesia, total hip arthroplasty', TRUE),
('01215', 10, 'Anesthesia, revision total hip', TRUE),
('00142', 4,  'Anesthesia, lens surgery (cataract)', TRUE),
('01622', 4,  'Anesthesia, diagnostic shoulder arthroscopy', TRUE),
('01630', 5,  'Anesthesia, open shoulder procedures', TRUE),
('00830', 4,  'Anesthesia, hernia repair lower abdomen', TRUE)
ON CONFLICT (anes_cpt) DO UPDATE
SET base_units = EXCLUDED.base_units, description = EXCLUDED.description;

-- ------------------------------------------------------------
-- Surgical CPT -> anesthesia CPT crosswalk (anchor procedures).
-- ASA CROSSWALK is licensed, so entries here are conservative:
-- confirmed pairs marked needs_verification=FALSE; the rest must
-- be verified against a licensed CROSSWALK or payer policy docs.
-- ------------------------------------------------------------
INSERT INTO cpt_anesthesia_crosswalk (surg_cpt, anes_cpt, needs_verification, notes) VALUES
('47562', '00790', FALSE, 'Lap chole; confirmed in brief'),
('47563', '00790', FALSE, 'Lap chole w/ cholangiography'),
('47564', '00790', FALSE, 'Lap chole w/ CBD exploration'),
('27447', '01402', FALSE, 'Total knee arthroplasty; confirmed in brief'),
('27130', '01214', TRUE,  'Total hip -> 01214 (verify)'),
('45378', '00811', TRUE,  'Diagnostic colonoscopy -> 00811 (verify)'),
('45380', '00811', TRUE,  'Colonoscopy w/ biopsy -> 00811 (verify)'),
('45385', '00811', TRUE,  'Colonoscopy w/ polypectomy -> 00811 (verify)'),
('G0121', '00812', TRUE,  'Medicare screening colonoscopy -> 00812 (verify)'),
('49505', '00830', TRUE,  'Inguinal hernia repair -> 00830 (verify)'),
('66984', '00142', TRUE,  'Cataract w/ IOL -> 00142 (verify)'),
('29881', '01400', TRUE,  'Knee arthroscopy/meniscectomy -> VERIFY; 01400 not yet in base-unit table')
ON CONFLICT (surg_cpt, anes_cpt) DO NOTHING;
-- NOTE: the 29881 row will fail FK until 01400's base units are added
-- from the OWCP table. That failure is intentional: do not guess units.

-- ------------------------------------------------------------
-- 2026 anesthesia conversion factors (CMS-1832-F confirmed national).
-- Locality rows: load from CMS "2026 Anesthesia Conversion Factors (ZIP)"
-- (Novitas JH; Dallas and Fort Worth are SEPARATE localities).
-- ------------------------------------------------------------
INSERT INTO locality_anesthesia_cf (locality, cf_non_apm, cf_apm, effective_year, source) VALUES
('NATIONAL', 20.4976, 20.5998, 2026, 'CMS CY2026 PFS Final Rule CMS-1832-F')
ON CONFLICT (locality, effective_year) DO UPDATE
SET cf_non_apm = EXCLUDED.cf_non_apm, cf_apm = EXCLUDED.cf_apm;

-- ------------------------------------------------------------
-- Default component weights (facility-based outpatient surgery).
-- Midpoints of the evidence-backed bands; label as estimates in UI.
-- ------------------------------------------------------------
INSERT INTO episode_component_weights (primary_cpt, component_type, weight, notes) VALUES
('DEFAULT', 'facility',     0.60, 'Band 0.55-0.65'),
('DEFAULT', 'professional', 0.15, 'Band 0.10-0.20'),
('DEFAULT', 'anesthesia',   0.11, 'Band 0.08-0.15'),
('DEFAULT', 'pathology',    0.04, 'Band 0.02-0.06'),
('DEFAULT', 'labs',         0.02, 'Band 0.01-0.03'),
('DEFAULT', 'radiology',    0.03, 'Band 0.01-0.04'),
('DEFAULT', 'drugs',        0.05, 'Remainder allocation'),
-- Implant-heavy joint replacement override (implant broken out)
('27447',   'facility',     0.42, 'TKA: facility ex-implant'),
('27447',   'implant',      0.27, 'TKA: implant band 0.20-0.35'),
('27447',   'professional', 0.13, 'Surgeon prof fee <10-14% of total'),
('27447',   'anesthesia',   0.10, ''),
('27447',   'pathology',    0.02, ''),
('27447',   'labs',         0.02, ''),
('27447',   'radiology',    0.03, ''),
('27447',   'drugs',        0.01, '')
ON CONFLICT (primary_cpt, component_type) DO UPDATE SET weight = EXCLUDED.weight;

COMMIT;
