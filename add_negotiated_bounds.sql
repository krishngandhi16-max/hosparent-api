ALTER TABLE cpt_price_bounds ADD COLUMN IF NOT EXISTS min_negotiated NUMERIC;
ALTER TABLE cpt_price_bounds ADD COLUMN IF NOT EXISTS max_negotiated NUMERIC;
ALTER TABLE cpt_price_bounds ADD COLUMN IF NOT EXISTS min_gross NUMERIC;
ALTER TABLE cpt_price_bounds ADD COLUMN IF NOT EXISTS max_gross NUMERIC;

UPDATE cpt_price_bounds
SET min_negotiated = ROUND(min_cash * 0.4, 2),
    max_negotiated = max_cash
WHERE min_negotiated IS NULL;

UPDATE cpt_price_bounds
SET min_gross = min_cash,
    max_gross = ROUND(max_cash * 1.5, 2)
WHERE min_gross IS NULL;

UPDATE cpt_price_bounds SET min_negotiated = 100 WHERE cpt_code IN ('45378','45380','45385');

UPDATE cpt_price_bounds SET min_negotiated = 0.50
WHERE cpt_code IN ('80048','80053','80061','80074','80076','81001','82306','82565',
                    '82607','82728','82746','82947','83036','83540','84403','84443',
                    '84703','85025','86140','86703');

UPDATE cpt_price_bounds SET min_negotiated = 20
WHERE cpt_code IN ('70450','70460','70490','70551','70552','70553','71045','71046',
                    '71250','71260','72141','72146','72148','73221','73564','73721',
                    '74176','74177','74178','76536','76700','76705','76856','77065',
                    '77066','77067','80048');

UPDATE cpt_price_bounds SET max_gross = 60000, max_negotiated = 30000 WHERE cpt_code = '85610';
UPDATE cpt_price_bounds SET max_gross = 90000 WHERE cpt_code = '92928';
UPDATE cpt_price_bounds SET max_gross = 180000 WHERE cpt_code = '93454';
UPDATE cpt_price_bounds SET max_gross = 20000 WHERE cpt_code = '90935';

SELECT cpt_code, procedure_label, min_cash, max_cash,
       min_negotiated, max_negotiated, min_gross, max_gross
FROM cpt_price_bounds
ORDER BY cpt_code;
