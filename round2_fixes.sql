UPDATE cpt_price_bounds SET min_negotiated = 500  WHERE cpt_code = '23472';
UPDATE cpt_price_bounds SET min_negotiated = 600  WHERE cpt_code = '29827';
UPDATE cpt_price_bounds SET min_negotiated = 100  WHERE cpt_code = '43235';
UPDATE cpt_price_bounds SET min_negotiated = 100  WHERE cpt_code = '43239';
UPDATE cpt_price_bounds SET min_negotiated = 1500 WHERE cpt_code = '43644';
UPDATE cpt_price_bounds SET min_negotiated = 400  WHERE cpt_code = '44950';
UPDATE cpt_price_bounds SET min_negotiated = 400  WHERE cpt_code = '44970';
UPDATE cpt_price_bounds SET min_negotiated = 400  WHERE cpt_code = '49505';
UPDATE cpt_price_bounds SET min_negotiated = 400  WHERE cpt_code = '49560';
UPDATE cpt_price_bounds SET min_negotiated = 300  WHERE cpt_code = '49650';
UPDATE cpt_price_bounds SET min_negotiated = 50   WHERE cpt_code = '54150';
UPDATE cpt_price_bounds SET min_negotiated = 600  WHERE cpt_code = '58150';
UPDATE cpt_price_bounds SET min_negotiated = 600  WHERE cpt_code = '58570';
UPDATE cpt_price_bounds SET min_negotiated = 600  WHERE cpt_code = '59400';
UPDATE cpt_price_bounds SET min_negotiated = 700  WHERE cpt_code = '59510';
UPDATE cpt_price_bounds SET min_negotiated = 500  WHERE cpt_code = '60220';
UPDATE cpt_price_bounds SET min_negotiated = 800  WHERE cpt_code = '63030';
UPDATE cpt_price_bounds SET min_negotiated = 200  WHERE cpt_code = '64721';
UPDATE cpt_price_bounds SET min_negotiated = 5    WHERE cpt_code = '71045';
UPDATE cpt_price_bounds SET min_negotiated = 5    WHERE cpt_code = '71046';
UPDATE cpt_price_bounds SET min_negotiated = 5    WHERE cpt_code = '73564';
UPDATE cpt_price_bounds SET min_negotiated = 15   WHERE cpt_code = '80048';
UPDATE cpt_price_bounds SET min_negotiated = 0.50 WHERE cpt_code = '85610';
UPDATE cpt_price_bounds SET min_negotiated = 20   WHERE cpt_code = '90837';
UPDATE cpt_price_bounds SET min_negotiated = 30   WHERE cpt_code = '90935';
UPDATE cpt_price_bounds SET min_negotiated = 35   WHERE cpt_code = '93015';
UPDATE cpt_price_bounds SET min_negotiated = 18   WHERE cpt_code = '93308';
UPDATE cpt_price_bounds SET min_negotiated = 500  WHERE cpt_code = '93454';
UPDATE cpt_price_bounds SET min_negotiated = 20   WHERE cpt_code = '99214';
UPDATE cpt_price_bounds SET min_negotiated = 40   WHERE cpt_code = '99283';
UPDATE cpt_price_bounds SET min_negotiated = 75   WHERE cpt_code = '99284';
UPDATE cpt_price_bounds SET min_negotiated = 140  WHERE cpt_code = '99285';
UPDATE cpt_price_bounds SET min_negotiated = 5    WHERE cpt_code = '97110';
UPDATE cpt_price_bounds SET min_negotiated = 5    WHERE cpt_code = '97530';
UPDATE cpt_price_bounds SET min_negotiated = 40   WHERE cpt_code = '96413';
UPDATE cpt_price_bounds SET min_gross = 1 WHERE cpt_code = '80048';
UPDATE cpt_price_bounds SET min_gross = 1 WHERE cpt_code = '82947';

UPDATE prices SET is_suspicious = true
WHERE price_type = 'gross'
AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code = '70490')
AND price > 9000;

UPDATE prices SET is_suspicious = true
WHERE price_type = 'gross'
AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code = '85610')
AND price > 60000;

UPDATE prices SET is_suspicious = true
WHERE price_type = 'gross'
AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code = '93454')
AND price > 180000;

UPDATE prices SET is_suspicious = true
WHERE price_type = 'gross'
AND procedure_id IN (SELECT id FROM procedures WHERE cpt_code = '90935')
AND price > 20000;

SELECT cpt_code, procedure_label, min_negotiated, max_negotiated, min_gross, max_gross
FROM cpt_price_bounds
WHERE cpt_code IN ('70490','85610','93454','90935','23472','43235','80048')
ORDER BY cpt_code;
