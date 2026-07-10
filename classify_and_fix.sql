ALTER TABLE procedures ADD COLUMN IF NOT EXISTS code_type TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS name_type TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS is_mismatch BOOLEAN DEFAULT FALSE;

UPDATE procedures SET code_type = CASE
  WHEN cpt_code ~ '^[0-9]{4}[0-9A-Z]$' THEN 'CPT'
  WHEN cpt_code ~ '^[A-Z][0-9]{4}$'   THEN 'HCPCS'
  WHEN cpt_code ~ '^[0-9]{1,3}$'      THEN 'DRG'
  WHEN cpt_code ~ '^[0-9]{4}$'        THEN 'REV_APC'
  WHEN cpt_code LIKE 'PX-%'           THEN 'INTERNAL'
  WHEN cpt_code ~ '^[0-9]{9,}$'       THEN 'INTERNAL'
  ELSE 'OTHER'
END;

UPDATE procedures SET name_type = CASE
  WHEN standard_name ~* '(suppository|supp |tablet| tab |injection|inj |solution|soln|lotion|cream|ointment| mg | mcg | ml |capsule| cap |syrup|infusion|vial|glargine|insulin|acetaminophen|ibuprofen|solr|elixir|drops)' THEN 'DRUG'
  WHEN standard_name ~* '(catheter|cath |stent|graft|lead |electrode|device|implant|prosthesis| kit|trieval|triever|sheath|guidewire|mesh|screw|plate|valve|allograft)' THEN 'DEVICE'
  WHEN standard_name ~* '(diagnoses|diagnosis|with mcc|w/mcc|w mcc|with cc|drg|>96 hours|>96 hrs|procedures with|system diagnosis)' THEN 'DRG_BUNDLE'
  ELSE 'PROCEDURE'
END;

UPDATE procedures SET is_mismatch = (
  code_type IN ('CPT','REV_APC')
  AND name_type IN ('DRUG','DEVICE','DRG_BUNDLE')
);

CREATE INDEX IF NOT EXISTS idx_proc_code_type ON procedures(code_type);
CREATE INDEX IF NOT EXISTS idx_proc_mismatch ON procedures(is_mismatch) WHERE is_mismatch IS TRUE;
CREATE INDEX IF NOT EXISTS idx_proc_name_type ON procedures(name_type);

SELECT code_type, COUNT(*) AS procedures, COUNT(*) FILTER (WHERE is_mismatch) AS contaminated_rows FROM procedures GROUP BY code_type ORDER BY 2 DESC;

SELECT name_type, COUNT(*) FROM procedures GROUP BY name_type ORDER BY 2 DESC;

SELECT COUNT(*) AS total_mismatches_found FROM procedures WHERE is_mismatch;
