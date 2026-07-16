ALTER TABLE procedures ADD COLUMN IF NOT EXISTS setting TEXT;
ALTER TABLE procedures ADD COLUMN IF NOT EXISTS severity TEXT;

UPDATE procedures SET setting = CASE
  WHEN standard_name ~* '(inpatient|aprdrg|ap-drg|with mcc|w/mcc|w mcc|with cc|w/cc|w cc| with or without |critical care|>96 hours|ventilator support)' THEN 'inpatient'
  ELSE 'outpatient'
END
WHERE code_type = 'CPT';

UPDATE procedures SET severity = CASE
  WHEN standard_name ~* '( with mcc|w/mcc|w mcc)' THEN 'with_mcc'
  WHEN standard_name ~* '( with cc|w/cc|w cc)'    THEN 'with_cc'
  WHEN standard_name ~* ',\s*extreme'  THEN 'extreme'
  WHEN standard_name ~* ',\s*major'    THEN 'major'
  WHEN standard_name ~* ',\s*moderate' THEN 'moderate'
  WHEN standard_name ~* ',\s*minor'    THEN 'minor'
  ELSE NULL
END
WHERE code_type = 'CPT';

UPDATE procedures SET is_searchable = true
WHERE code_type = 'CPT' AND is_searchable = false AND setting IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proc_setting ON procedures(setting);
CREATE INDEX IF NOT EXISTS idx_proc_cpt_setting ON procedures(cpt_code, setting);

SELECT setting, COUNT(*) AS procedures FROM procedures WHERE code_type='CPT' GROUP BY setting ORDER BY 2 DESC;
SELECT severity, COUNT(*) FROM procedures WHERE code_type='CPT' AND severity IS NOT NULL GROUP BY severity ORDER BY 2 DESC;
SELECT setting, severity, COUNT(*) AS procedure_rows FROM procedures WHERE cpt_code='47562' GROUP BY setting, severity ORDER BY setting, severity NULLS FIRST;
