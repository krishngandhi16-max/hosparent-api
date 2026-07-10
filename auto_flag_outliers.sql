\timing on

DROP TABLE IF EXISTS cohort_stats;
CREATE TABLE cohort_stats AS
WITH med AS (
  SELECT p.cpt_code, pr.price_type,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price) AS median_price,
         COUNT(*) AS n,
         MAX(COALESCE(p.medicare_facility_rate, p.medicare_non_facility_rate)) AS medicare_rate
  FROM prices pr
  JOIN procedures p ON p.id = pr.procedure_id
  WHERE pr.price > 0 AND p.cpt_code IS NOT NULL
  GROUP BY p.cpt_code, pr.price_type
),
dev AS (
  SELECT p.cpt_code, pr.price_type,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(pr.price - m.median_price)) AS mad
  FROM prices pr
  JOIN procedures p ON p.id = pr.procedure_id
  JOIN med m ON m.cpt_code = p.cpt_code AND m.price_type = pr.price_type
  WHERE pr.price > 0
  GROUP BY p.cpt_code, pr.price_type
)
SELECT m.cpt_code, m.price_type, m.median_price, m.n, m.medicare_rate,
       COALESCE(NULLIF(d.mad, 0), m.median_price * 0.15) AS mad
FROM med m
JOIN dev d ON d.cpt_code = m.cpt_code AND d.price_type = m.price_type;

CREATE INDEX idx_cohort ON cohort_stats(cpt_code, price_type);

DROP TABLE IF EXISTS auto_flag_review;
CREATE TABLE auto_flag_review AS
WITH scored AS (
  SELECT pr.id AS price_id, p.cpt_code, p.standard_name, pr.price, pr.price_type,
         cs.median_price, cs.mad, cs.n AS cohort_size, cs.medicare_rate,
         CASE WHEN cs.mad > 0 THEN 0.6745 * (pr.price - cs.median_price) / cs.mad END AS mod_z,
         CASE WHEN cs.medicare_rate > 0 THEN pr.price / cs.medicare_rate END AS medicare_ratio,
         b.cpt_code IS NOT NULL AS has_hand_bounds,
         b.min_cash, b.max_cash
  FROM prices pr
  JOIN procedures p ON p.id = pr.procedure_id
  JOIN cohort_stats cs ON cs.cpt_code = p.cpt_code AND cs.price_type = pr.price_type
  LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
  WHERE pr.is_suspicious IS NOT TRUE
)
SELECT price_id, cpt_code, standard_name, price, price_type,
       ROUND(median_price::numeric, 2) AS cohort_median,
       cohort_size, medicare_rate,
       ROUND(mod_z::numeric, 2) AS mod_z,
       ROUND(medicare_ratio::numeric, 3) AS medicare_ratio,
       has_hand_bounds,
       CASE
         WHEN has_hand_bounds AND (price < min_cash OR price > max_cash)
              THEN 'FLAG: outside hand-set bounds'
         WHEN medicare_ratio > 50 THEN 'FLAG: >50x medicare (hard ceiling)'
         WHEN ABS(mod_z) > 3.5 AND medicare_ratio > 25 THEN 'FLAG: high, both signals'
         WHEN medicare_ratio IS NOT NULL AND medicare_ratio < 0.20
              THEN 'FLAG: <0.2x medicare (impossibly cheap)'
         WHEN ABS(mod_z) > 3.5 AND medicare_ratio IS NOT NULL AND medicare_ratio < 0.5
              THEN 'FLAG: low, both signals'
         WHEN price < 1 AND median_price > 20 THEN 'FLAG: sub-dollar artifact'
         WHEN medicare_ratio IS NULL AND ABS(mod_z) > 5 THEN 'FLAG: extreme z (no medicare)'
         ELSE 'ok'
       END AS verdict
FROM scored
WHERE
      (has_hand_bounds AND (price < min_cash OR price > max_cash))
   OR (medicare_ratio > 50)
   OR (ABS(mod_z) > 3.5 AND medicare_ratio > 25)
   OR (medicare_ratio IS NOT NULL AND medicare_ratio < 0.20)
   OR (ABS(mod_z) > 3.5 AND medicare_ratio IS NOT NULL AND medicare_ratio < 0.5)
   OR (price < 1 AND median_price > 20)
   OR (medicare_ratio IS NULL AND ABS(mod_z) > 5);

CREATE INDEX idx_review_priceid ON auto_flag_review(price_id);

SELECT verdict, COUNT(*) AS rows_flagged,
       ROUND(MIN(price)::numeric,2) AS min_price,
       ROUND(MAX(price)::numeric,2) AS max_price
FROM auto_flag_review
GROUP BY verdict
ORDER BY rows_flagged DESC;

SELECT COUNT(*) AS total_rows_that_would_be_flagged FROM auto_flag_review;
