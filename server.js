require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, ensureBoundsColumns } = require('./db'); // shared pool (see db.js)
const { runAgent } = require('./db_agent');

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.use(express.static('public'));

// ── AGENT ─────────────────────────────────────────────────
// Natural-language question -> Claude tool-use agent (DB + web + healthcare MCP).
// Returns { answer, actions_taken }. See db_agent.js.
app.post('/agent', async (req, res) => {
  const question = (req.body && req.body.question) || '';
  if (!question) return res.status(400).json({ error: 'missing "question"' });
  try {
    const result = await runAgent(question);
    res.json(result);
  } catch (err) {
    console.error('[/agent]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── VOICE ─────────────────────────────────────────────────
// Optional: POST raw WAV audio -> Azure STT -> agent -> Azure TTS (mp3 audio back).
// Transcript + answer are also returned in response headers. Needs AZURE_SPEECH_*.
app.post('/voice', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const { transcribe, synthesize } = require('./voice');
    const transcript = await transcribe(req.body);
    const { answer } = await runAgent(transcript);
    const audio = await synthesize(answer);
    res.set('X-Transcript', encodeURIComponent(transcript));
    res.set('X-Answer', encodeURIComponent(answer));
    res.set('Content-Type', 'audio/mpeg');
    res.send(audio);
  } catch (err) {
    console.error('[/voice]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ══════════════════════════════════════════════════════════════
// HOSPARENT API v3.2 — BOUNDS-EVERYWHERE FIX
//
// v3.1 BUG (root cause of the "$35 knee replacement" class of failure):
//   The live cpt_price_bounds check was only applied to the `cash_price`
//   FILTER clause inside /search. gross_price, medicare rates, and every
//   OTHER endpoint (/procedure/:id/prices, /procedure/:id/payer/:payer,
//   /search-imaging, /search-radiology, /search-asc, /search-surgery-bundles)
//   had ZERO live bounds enforcement. They relied entirely on
//   is_suspicious=true already being set by validation_system.js at scrape
//   time. Any price that validation missed (new scrape, edge case, re-scrape
//   before re-running validation) rendered everywhere except as a cash price
//   in /search.
//
// FIX:
//   1. A single reusable SQL boolean fragment, PRICE_IS_VALID_SQL, checks
//      is_suspicious AND live cpt_price_bounds together. It is spliced into
//      EVERY query that reads a price, on every price_type, in every
//      endpoint — not just cash.
//   2. /test-cpt/:cpt now checks ALL price_types (cash, gross, negotiated),
//      not just cash, and reports per-type pass/fail.
//   3. New /verify-all endpoint: loops every CPT with bounds set, checks
//      every price_type, returns a single PASS/FAIL manifest — this is what
//      you run before ANY demo. If a $35 knee replacement exists anywhere
//      in the DB under any price_type, this catches it in one call.
// ══════════════════════════════════════════════════════════════

// ── THE CORE FIX ──────────────────────────────────────────
// PRICE_IS_VALID_SQL is AND-ed into every query that reads a price. It requires
// p.cpt_code in scope (from the procedures join). Rows for CPTs with no bounds row
// pass through unchecked (fall back to is_suspicious only) — same as before.
//
// v3.3: it now bounds-checks EACH price_type against its OWN window —
// negotiated against min/max_negotiated, gross against min/max_gross — with a
// COALESCE fallback to the cash window when a type-specific bound isn't set.
// Previously every type was checked against the CASH window only, which HID valid
// negotiated rates below the cash floor and valid gross charges above the cash
// ceiling (the main "our price looks wrong vs TryBilly" bug).
//
// Starts as the cash-only fragment (always valid) and is upgraded to per-type by
// loadBounds() once the per-type columns are confirmed present — so there is never
// a window where a query references a column that doesn't exist yet.
let PRICE_IS_VALID_SQL = `
  (pr.is_suspicious IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM cpt_price_bounds b
    WHERE b.cpt_code = p.cpt_code
    AND (pr.price < b.min_cash OR pr.price > b.max_cash)
  )
`;

const PRICE_IS_VALID_PER_TYPE = `
  (pr.is_suspicious IS NOT TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM cpt_price_bounds b
    WHERE b.cpt_code = p.cpt_code
    AND (
      pr.price < CASE lower(pr.price_type)
                   WHEN 'negotiated' THEN COALESCE(b.min_negotiated, b.min_cash)
                   WHEN 'gross'      THEN COALESCE(b.min_gross, b.min_cash)
                   ELSE b.min_cash END
      OR
      pr.price > CASE lower(pr.price_type)
                   WHEN 'negotiated' THEN COALESCE(b.max_negotiated, b.max_cash)
                   WHEN 'gross'      THEN COALESCE(b.max_gross, b.max_cash)
                   ELSE b.max_cash END
    )
  )
`;

// "This price is outside its price_type's bounds" — for the diagnostic endpoints,
// which JOIN cpt_price_bounds as `b`. Mirrors PRICE_IS_VALID_PER_TYPE's window.
const OUT_OF_TYPE_BOUNDS_SQL = `(
  pr.price < CASE lower(pr.price_type)
               WHEN 'negotiated' THEN COALESCE(b.min_negotiated, b.min_cash)
               WHEN 'gross'      THEN COALESCE(b.min_gross, b.min_cash)
               ELSE b.min_cash END
  OR pr.price > CASE lower(pr.price_type)
               WHEN 'negotiated' THEN COALESCE(b.max_negotiated, b.max_cash)
               WHEN 'gross'      THEN COALESCE(b.max_gross, b.max_cash)
               ELSE b.max_cash END
)`;

let BOUNDS = {};
async function loadBounds() {
  try {
    await ensureBoundsColumns();
    const r = await pool.query(
      'SELECT cpt_code, procedure_label, min_cash, max_cash, min_negotiated, max_negotiated, min_gross, max_gross FROM cpt_price_bounds'
    );
    const num = (v, fallback) => (v != null ? parseFloat(v) : fallback);
    const next = {};
    for (const row of r.rows) {
      const minC = parseFloat(row.min_cash);
      const maxC = parseFloat(row.max_cash);
      next[row.cpt_code] = {
        label: row.procedure_label,
        min: minC, max: maxC, // legacy cash fields (kept for existing callers)
        cash: [minC, maxC],
        negotiated: [num(row.min_negotiated, minC), num(row.max_negotiated, maxC)],
        gross: [num(row.min_gross, minC), num(row.max_gross, maxC)],
      };
    }
    BOUNDS = next;
    PRICE_IS_VALID_SQL = PRICE_IS_VALID_PER_TYPE; // upgrade once columns confirmed present
    console.log(`[bounds] ${Object.keys(BOUNDS).length} CPT bounds loaded (per-type)`);
  } catch (e) { console.error('[bounds]', e.message); }
}
loadBounds();
setInterval(loadBounds, 10 * 60 * 1000);

// Simple in-memory cache: instant repeat searches, auto-expires
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  cache.delete(key);
  return null;
}
function cacheSet(key, v) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { t: Date.now(), v });
}

// Request timing log
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    if (ms > 2000) console.log(`[slow ${ms}ms] ${req.path}?${new URLSearchParams(req.query)}`);
  });
  next();
});

const synonyms = {
  'mri brain': ['70551','70552','70553'],
  'brain mri': ['70551','70552','70553'],
  'ct abdomen': ['74177','74178','74176'],
  'abdominal ct': ['74177','74178','74176'],
  'colonoscopy': ['45378','45380','45385'],
  'virtual colonoscopy': ['74263'],
  'ct colonography': ['74263'],
  'knee replacement': ['27447'],
  'total knee': ['27447'],
  'hip replacement': ['27130'],
  'total hip': ['27130'],
  'gallbladder removal': ['47562','47563'],
  'gallbladder surgery': ['47562','47563'],
  'gallbladder': ['47562','47563'],
  'cholecystectomy': ['47562','47563'],
  'mammogram': ['77067','77065','77066'],
  'mammography': ['77067','77065'],
  'ekg': ['93000','93010'],
  'ecg': ['93000','93010'],
  'electrocardiogram': ['93000','93010'],
  'blood panel': ['80053','80048'],
  'metabolic panel': ['80053','80048'],
  'cmp': ['80053'],
  'bmp': ['80048'],
  'cbc': ['85025'],
  'complete blood count': ['85025'],
  'lipid panel': ['80061'],
  'cholesterol test': ['80061'],
  'cholesterol': ['80061'],
  'appendectomy': ['44950','44970'],
  'appendix': ['44950','44970'],
  'hernia repair': ['49505','49650','49560'],
  'hernia surgery': ['49505','49650','49560'],
  'hernia': ['49505','49650','49560'],
  'cataract': ['66984','66982'],
  'shoulder replacement': ['23472'],
  'spinal fusion': ['22612','22551'],
  'back fusion': ['22612','22551'],
  'physical therapy': ['97110','97530'],
  'stress test': ['93015','93016'],
  'echocardiogram': ['93306','93308'],
  'echo': ['93306','93308'],
  'ultrasound abdomen': ['76700','76705'],
  'abdominal ultrasound': ['76700','76705'],
  'chest xray': ['71046','71045'],
  'chest x-ray': ['71046','71045'],
  'chest x ray': ['71046','71045'],
  'dexa': ['77080','77081'],
  'bone density': ['77080','77081'],
  'pet scan': ['78815','78816'],
  'pet/ct': ['78815','78816'],
  'epidural': ['62322','62323'],
  'thyroid test': ['84443'],
  'tsh': ['84443'],
  'a1c': ['83036'],
  'hemoglobin a1c': ['83036'],
  'psa': ['86316'],
  'urinalysis': ['81001'],
  'urine test': ['81001'],
  'c-section': ['59510','59515'],
  'csection': ['59510','59515'],
  'cesarean': ['59510','59515'],
  'vaginal delivery': ['59400','59410'],
  'childbirth': ['59400','59510'],
  'prostatectomy': ['55866'],
  'knee arthroscopy': ['29881'],
  'knee scope': ['29881'],
  'shoulder surgery': ['29827'],
  'rotator cuff': ['29827'],
  'mri spine': ['72141','72148','72146'],
  'mri lumbar': ['72148'],
  'mri cervical': ['72141'],
  'mri knee': ['73721'],
  'mri shoulder': ['73221'],
  'mri hip': ['73721'],
  'ct chest': ['71260','71250'],
  'chest ct': ['71260','71250'],
  'ct head': ['70450','70460'],
  'head ct': ['70450','70460'],
  'ct brain': ['70450','70460'],
  'ct neck': ['70490'],
  'ultrasound thyroid': ['76536'],
  'thyroid ultrasound': ['76536'],
  'ultrasound pelvis': ['76856'],
  'pelvic ultrasound': ['76856'],
  'tonsillectomy': ['42820'],
  'tonsils': ['42820'],
  'hysterectomy': ['58570','58150'],
  'laminectomy': ['63030'],
  'discectomy': ['63030'],
  'carpal tunnel': ['64721'],
  'cardiac catheterization': ['93454'],
  'heart cath': ['93454'],
  'angioplasty': ['92928'],
  'stent': ['92928'],
  'pacemaker': ['33206'],
  'ablation': ['93653'],
  'sleeve gastrectomy': ['43775'],
  'gastric sleeve': ['43775'],
  'gastric bypass': ['43644'],
  'vasectomy': ['55250'],
  'circumcision': ['54150'],
  'mastectomy': ['19303'],
  'thyroidectomy': ['60220','60240'],
  'upper endoscopy': ['43239','43235'],
  'endoscopy': ['43239','43235'],
  'egd': ['43239','43235'],
  'er visit': ['99283','99284'],
  'emergency room': ['99283','99284'],
  'office visit': ['99213','99214'],
  'doctor visit': ['99213','99214'],
  'therapy session': ['90837','90834'],
  'psychotherapy': ['90837','90834'],
  'counseling': ['90837','90834'],
  'dialysis': ['90935'],
  'hemodialysis': ['90935'],
  'chemotherapy': ['96413'],
  'chemo': ['96413'],
  'vitamin d test': ['82306'],
  'testosterone test': ['84403'],
  'pregnancy test': ['84703'],
  'hiv test': ['86703'],
  'sleep study': ['95810','95806'],
};

const drugSynonyms = {
  'lipitor': 'atorvastatin', 'zoloft': 'sertraline', 'prozac': 'fluoxetine',
  'synthroid': 'levothyroxine', 'ozempic': 'semaglutide', 'mounjaro': 'tirzepatide',
  'wegovy': 'semaglutide', 'eliquis': 'apixaban', 'xarelto': 'rivaroxaban',
  'jardiance': 'empagliflozin', 'lexapro': 'escitalopram', 'wellbutrin': 'bupropion',
  'cymbalta': 'duloxetine', 'xanax': 'alprazolam', 'adderall': 'amphetamine',
  'ambien': 'zolpidem', 'viagra': 'sildenafil', 'cialis': 'tadalafil',
  'flomax': 'tamsulosin', 'nexium': 'esomeprazole', 'prilosec': 'omeprazole',
  'zofran': 'ondansetron', 'augmentin': 'amoxicillin', 'keflex': 'cephalexin',
  'bactrim': 'trimethoprim', 'flagyl': 'metronidazole',
  'lantus': 'insulin glargine', 'januvia': 'sitagliptin', 'plavix': 'clopidogrel',
  'crestor': 'rosuvastatin', 'norvasc': 'amlodipine', 'lasix': 'furosemide',
  'glucophage': 'metformin', 'neurontin': 'gabapentin', 'lyrica': 'pregabalin',
  'deltasone': 'prednisone', 'medrol': 'methylprednisolone', 'zocor': 'simvastatin',
  'coumadin': 'warfarin', 'coreg': 'carvedilol', 'cozaar': 'losartan',
  'singulair': 'montelukast', 'zyrtec': 'cetirizine', 'claritin': 'loratadine',
  'allegra': 'fexofenadine', 'pepcid': 'famotidine', 'protonix': 'pantoprazole',
  'ativan': 'lorazepam', 'klonopin': 'clonazepam', 'seroquel': 'quetiapine',
  'abilify': 'aripiprazole', 'ritalin': 'methylphenidate', 'effexor': 'venlafaxine',
  'desyrel': 'trazodone', 'ultram': 'tramadol', 'mobic': 'meloxicam',
  'celebrex': 'celecoxib', 'flexeril': 'cyclobenzaprine', 'imitrex': 'sumatriptan',
  'topamax': 'topiramate', 'keppra': 'levetiracetam', 'aricept': 'donepezil',
  'fosamax': 'alendronate', 'propecia': 'finasteride', 'retin-a': 'tretinoin',
  'vibramycin': 'doxycycline', 'cipro': 'ciprofloxacin', 'zithromax': 'azithromycin',
  'amoxil': 'amoxicillin', 'estrace': 'estradiol',
};

// Resolve query → CPT codes. Longest synonym match wins (so "mri brain"
// beats "mri", "knee replacement" beats "knee").
function resolveCpts(q) {
  const qLower = q.toLowerCase().trim();
  if (/^\d{5}$/.test(qLower)) return [qLower];
  let bestKey = null;
  for (const key of Object.keys(synonyms)) {
    if (qLower === key || qLower.includes(key)) {
      if (!bestKey || key.length > bestKey.length) bestKey = key;
    }
  }
  if (!bestKey) {
    // partial: query is a prefix/substring of a synonym key (e.g. "colonosc")
    for (const key of Object.keys(synonyms)) {
      if (key.includes(qLower) && qLower.length >= 4) {
        if (!bestKey || key.length < bestKey.length) bestKey = key;
      }
    }
  }
  return bestKey ? [...new Set(synonyms[bestKey])] : [];
}

// ── MAIN SEARCH ───────────────────────────────────────────
// Strict mode: if the query maps to CPT codes, match CPT ONLY.
// Name matching is fallback for unmapped queries only.
// Bounds are now enforced on cash AND gross (medicare rates come straight
// from CMS reference data, not scraped prices, so they're not bounds-checked
// against cpt_price_bounds — but they're a fixed government number, not a
// scrape artifact, so that's the correct call, not a gap).
app.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  const cacheKey = `search:${q.toLowerCase().trim()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const cptCodes = resolveCpts(q);

  try {
    let whereClause, params;
    if (cptCodes.length > 0) {
      whereClause = `p.cpt_code = ANY($1::text[])`;
      params = [cptCodes];
    } else {
      whereClause = `(p.standard_name ILIKE $1 OR p.display_name ILIKE $1)`;
      params = [`%${q}%`];
    }

    const result = await pool.query(`
      SELECT
        h.id as hospital_id, h.name as hospital_name, h.city,
        h.leapfrog_grade, h.cms_rating, h.hospital_phone,
        h.is_compliant, h.mrf_last_updated, h.full_address,
        h.hospital_hours, h.google_maps_url, h.latitude, h.longitude,
        h.google_rating, h.google_review_count,
        MIN(pr.price) FILTER (WHERE pr.price_type = 'cash' AND ${PRICE_IS_VALID_SQL}) as cash_price,
        MIN(pr.price) FILTER (WHERE pr.price_type = 'gross' AND ${PRICE_IS_VALID_SQL}) as gross_price,
        MIN(pr.price) FILTER (WHERE pr.price_type = 'negotiated' AND ${PRICE_IS_VALID_SQL}) as negotiated_price,
        -- Representative (median) prices, so the UI can show a typical price
        -- comparable to competitors' medians instead of only the MIN floor.
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)
          FILTER (WHERE pr.price_type = 'cash' AND ${PRICE_IS_VALID_SQL}) as median_cash_price,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY pr.price)
          FILTER (WHERE pr.price_type = 'negotiated' AND ${PRICE_IS_VALID_SQL}) as median_negotiated_price,
        COUNT(DISTINCT pr.payer_name) FILTER (
          WHERE pr.payer_name IS NOT NULL AND ${PRICE_IS_VALID_SQL}
        ) as payer_count,
        MIN(p.medicare_facility_rate) FILTER (WHERE p.medicare_facility_rate IS NOT NULL) as medicare_facility_rate,
        MIN(p.medicare_non_facility_rate) FILTER (WHERE p.medicare_non_facility_rate IS NOT NULL) as medicare_non_facility_rate,
        COUNT(DISTINCT p.id) as procedure_variant_count,
        MIN(p.id) as procedure_id,
        MIN(p.display_name) as standard_name,
        MIN(p.cpt_code) as cpt_code
      FROM procedures p
      JOIN prices pr ON pr.procedure_id = p.id
      JOIN hospitals h ON h.id = pr.hospital_id
      WHERE ${whereClause}
      AND p.standard_name NOT ILIKE '%hchg%'
      AND pr.price > 5
      AND pr.price < 500000
      GROUP BY
        h.id, h.name, h.city, h.leapfrog_grade, h.cms_rating, h.hospital_phone,
        h.is_compliant, h.mrf_last_updated, h.full_address, h.hospital_hours,
        h.google_maps_url, h.latitude, h.longitude, h.google_rating, h.google_review_count
      HAVING MIN(pr.price) FILTER (WHERE pr.price_type = 'cash' AND ${PRICE_IS_VALID_SQL}) IS NOT NULL
        OR COUNT(DISTINCT pr.payer_name) FILTER (
          WHERE pr.payer_name IS NOT NULL AND ${PRICE_IS_VALID_SQL}
        ) > 0
      ORDER BY cash_price ASC NULLS LAST
      LIMIT 200
    `, params);

    cacheSet(cacheKey, result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('[/search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PROCEDURE PRICES ─────────────────────────────────────
// FIXED: was is_suspicious-only. Now bounds-checked like everything else.
app.get('/procedure/:id/prices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        h.name AS hospital_name, h.city, h.is_compliant, h.mrf_last_updated,
        h.cms_rating, h.leapfrog_grade, h.hospital_phone, h.full_address,
        h.hospital_hours, h.google_maps_url, h.latitude, h.longitude,
        pr.payer_name, pr.plan_name, pr.price_type, pr.price, pr.is_cash_price
      FROM prices pr
      JOIN hospitals h ON h.id = pr.hospital_id
      JOIN procedures p ON p.id = pr.procedure_id
      WHERE pr.procedure_id = $1
      AND pr.price > 5
      AND p.standard_name NOT ILIKE '%hchg%'
      AND ${PRICE_IS_VALID_SQL}
      ORDER BY pr.price ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HOSPITALS ─────────────────────────────────────────────
app.get('/hospitals', async (req, res) => {
  const cached = cacheGet('hospitals');
  if (cached) return res.json(cached);
  try {
    const result = await pool.query(`
      SELECT h.*, COALESCE(pc.procedure_count, 0) AS procedure_count
      FROM hospitals h
      LEFT JOIN (
        SELECT hospital_id, COUNT(DISTINCT procedure_id) AS procedure_count
        FROM prices GROUP BY hospital_id
      ) pc ON pc.hospital_id = h.id
      ORDER BY h.name
    `);
    cacheSet('hospitals', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAYERS ────────────────────────────────────────────────
app.get('/payers', async (req, res) => {
  const cached = cacheGet('payers');
  if (cached) return res.json(cached);
  try {
    const result = await pool.query(`SELECT DISTINCT payer_name FROM prices WHERE payer_name IS NOT NULL ORDER BY payer_name`);
    const payers = result.rows.map(r => r.payer_name);
    cacheSet('payers', payers);
    res.json(payers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PROCEDURE BY PAYER ────────────────────────────────────
// FIXED: was is_suspicious-only. Now bounds-checked like everything else.
app.get('/procedure/:id/payer/:payer', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.name AS hospital_name, h.city, h.is_compliant, h.cms_rating,
        h.leapfrog_grade, h.hospital_phone, h.full_address, h.latitude, h.longitude,
        pr.payer_name, pr.plan_name, pr.price_type, pr.price, pr.is_cash_price
      FROM prices pr
      JOIN hospitals h ON h.id = pr.hospital_id
      JOIN procedures p ON p.id = pr.procedure_id
      WHERE pr.procedure_id = $1
      AND pr.payer_name ILIKE $2
      AND pr.price > 5
      AND p.standard_name NOT ILIKE '%hchg%'
      AND ${PRICE_IS_VALID_SQL}
      ORDER BY pr.price ASC
    `, [req.params.id, `%${req.params.payer}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── IMAGING CENTERS ───────────────────────────────────────
// NOTE: imaging_prices has its own is_suspicious column, not the same
// table as prices/procedures, so it can't use PRICE_IS_VALID_SQL (that
// fragment is written against p.cpt_code from the `procedures` table).
// Left as-is (is_suspicious filter only) — if you want live bounds here
// too, cpt_price_bounds would need to be joined on ip.cpt_code directly.
// Flagging this explicitly rather than silently leaving a second gap.
app.get('/search-imaging', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT ic.id, ic.name, ic.city, ic.state, ic.address, ic.phone,
        ic.network, ic.full_address, ic.latitude, ic.longitude, ic.zip,
        ic.google_maps_url, ic.self_pay_note, ic.accepts_insurance, ic.acr_accredited, ic.same_day,
        ip.scan_type, ip.procedure_name, ip.price, ip.cpt_code, ip.medicare_opps_rate
      FROM imaging_centers ic
      JOIN imaging_prices ip ON ip.imaging_center_id = ic.id
      WHERE ic.name NOT LIKE 'RadiologyAssist%'
      AND (ip.procedure_name ILIKE $1 OR ip.scan_type ILIKE $1 OR ic.name ILIKE $1)
      AND ip.price > 20 AND LENGTH(ip.procedure_name) < 100
      AND (ip.is_suspicious IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM cpt_price_bounds b
        WHERE b.cpt_code = ip.cpt_code
        AND (ip.price < b.min_cash OR ip.price > b.max_cash)
      )
      ORDER BY ip.price ASC LIMIT 100
    `, [`%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RADIOLOGY ASSIST ──────────────────────────────────────
app.get('/search-radiology', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT ic.id, ic.name, ic.city, ic.state, ic.address, ic.phone,
        ic.network, ic.full_address, ic.latitude, ic.longitude, ic.zip,
        ic.google_maps_url, ic.self_pay_note, ic.accepts_insurance, ic.acr_accredited,
        ip.scan_type, ip.procedure_name, ip.price, ip.cpt_code, ip.medicare_opps_rate
      FROM imaging_centers ic
      JOIN imaging_prices ip ON ip.imaging_center_id = ic.id
      WHERE ic.name ILIKE '%radiology%assist%'
      AND (ip.procedure_name ILIKE $1 OR ip.scan_type ILIKE $1 OR ip.cpt_code = $2)
      AND ip.price > 0
      AND (ip.is_suspicious IS NOT TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM cpt_price_bounds b
        WHERE b.cpt_code = ip.cpt_code
        AND (ip.price < b.min_cash OR ip.price > b.max_cash)
      )
      ORDER BY ip.price ASC LIMIT 50
    `, [`%${q}%`, q]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LABS ──────────────────────────────────────────────────
app.get('/search-labs', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT l.name, l.network, l.city, l.no_order_required, l.hsa_fsa_accepted,
        l.source_url, lp.test_name, lp.price
      FROM labs l JOIN lab_prices lp ON lp.lab_id = l.id
      WHERE lp.test_name ILIKE $1 OR l.city ILIKE $1
      ORDER BY lp.price ASC LIMIT 50
    `, [`%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WALK-IN LAB ───────────────────────────────────────────
app.get('/search-walkinlab', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT test_name, cpt_code, price, discounted_price, discount_code,
        physician_fee, total_price, source_url
      FROM walkinlab_prices
      WHERE test_name ILIKE $1 OR cpt_code = $2
      ORDER BY price ASC LIMIT 30
    `, [`%${q}%`, q]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EMS ───────────────────────────────────────────────────
app.get('/ems', async (req, res) => {
  const cached = cacheGet('ems');
  if (cached) return res.json(cached);
  try {
    const result = await pool.query(`
      SELECT ep.name, ep.provider_type, ep.city, ep.phone, ep.source_url,
        er.service_type, er.base_rate, er.mileage_rate, er.notes
      FROM ems_providers ep JOIN ems_rates er ON er.ems_provider_id = ep.id
      ORDER BY ep.provider_type, er.base_rate ASC
    `);
    cacheSet('ems', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COLONOSCOPY CENTERS ───────────────────────────────────
app.get('/search-colonoscopy', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT cc.name, cc.city, cc.phone, cc.board_certified, cc.source_url,
        cp.service_name, cp.price, cp.price_label, cp.includes
      FROM colonoscopy_centers cc JOIN colonoscopy_prices cp ON cp.center_id = cc.id
      WHERE cp.service_name ILIKE $1 OR cc.city ILIKE $1
      ORDER BY cp.price ASC LIMIT 50
    `, [`%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── EPISODE COSTS ─────────────────────────────────────────
app.get('/episode/:cpt', async (req, res) => {
  try {
    const summary = await pool.query('SELECT * FROM procedure_episode_summary WHERE cpt_code = $1 LIMIT 1', [req.params.cpt]);
    const components = await pool.query('SELECT * FROM procedure_episode_costs WHERE cpt_code = $1 ORDER BY sort_order', [req.params.cpt]);
    res.json({ summary: summary.rows[0] || null, components: components.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DRUGS ─────────────────────────────────────────────────
app.get('/search-drugs', async (req, res) => {
  let { q } = req.query;
  if (!q) return res.json([]);
  const qLower = q.toLowerCase().trim();
  const resolved = drugSynonyms[qLower] || q;
  try {
    // FIX: also match by drug CODE. ndc and j_code were SELECTed but never
    // searched, so searching an NDC or J-code returned nothing even though the
    // columns are populated. $3 is the raw query, matched exactly (case-insensitive).
    const result = await pool.query(`
      SELECT dp.drug_name, dp.brand_name, dp.ndc, dp.j_code,
        dp.strength, dp.form, dp.quantity,
        dp.pharmacy_name, dp.pharmacy_chain, dp.pharmacy_address,
        dp.pharmacy_zip, dp.pharmacy_lat, dp.pharmacy_lng,
        dp.price, dp.price_type, dp.source, dp.source_url,
        dp.conditions, dp.is_generic
      FROM drug_prices dp
      WHERE dp.drug_name ILIKE $1 OR dp.brand_name ILIKE $1
         OR dp.drug_name ILIKE $2 OR dp.brand_name ILIKE $2
         OR dp.ndc ILIKE $3 OR dp.j_code ILIKE $3
      ORDER BY dp.price ASC LIMIT 50
    `, [`%${resolved}%`, `%${q}%`, qLower]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SURGERY BUNDLES ───────────────────────────────────────
app.get('/search-surgery-bundles', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ sco: [], mdsave: [] });
  const cpts = resolveCpts(q);
  try {
    const sco = await pool.query(`
      SELECT procedure_name, cpt_code, all_inclusive_price, includes_description, source_url,
        'Surgery Center of Oklahoma' as provider_name, 'Oklahoma City, OK' as city
      FROM sco_prices
      WHERE procedure_name ILIKE $1 OR cpt_code = ANY($2::text[])
      ORDER BY all_inclusive_price ASC
    `, [`%${q}%`, cpts.length ? cpts : ['']]).catch(() => ({ rows: [] }));

    const mdsave = await pool.query(`
      SELECT procedure_name, cpt_code, provider_name, city, address, zip,
        distance_miles, price, network, source_url
      FROM mdsave_prices
      WHERE procedure_name ILIKE $1 OR cpt_code = ANY($2::text[])
      ORDER BY price ASC LIMIT 20
    `, [`%${q}%`, cpts.length ? cpts : ['']]).catch(() => ({ rows: [] }));

    res.json({ sco: sco.rows, mdsave: mdsave.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ASC ───────────────────────────────────────────────────
app.get('/search-asc', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const result = await pool.query(`
      SELECT ac.id, ac.name, ac.address, ac.city, ac.zip, ac.phone,
        ac.website, ac.network, ac.latitude, ac.longitude,
        ac.accepts_medicare, ac.cash_only, ac.specialties,
        ap.procedure_name, ap.cpt_code, ap.asc_medicare_rate,
        ap.hospital_opps_rate, ap.savings_vs_hospital
      FROM asc_centers ac
      LEFT JOIN asc_prices ap ON ap.asc_center_id = ac.id
      WHERE ac.name ILIKE $1 OR ap.procedure_name ILIKE $1 OR ap.cpt_code = $2
      ORDER BY ap.asc_medicare_rate ASC NULLS LAST LIMIT 50
    `, [`%${q}%`, q]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── THERAPISTS ────────────────────────────────────────────
app.get('/search-therapists', async (req, res) => {
  const { q, city } = req.query;
  try {
    const result = await pool.query(`
      SELECT name, credentials, city, zip, session_fee_min, session_fee_max,
        accepts_insurance, cash_pay_available, specialties, modalities,
        platform, profile_url
      FROM mental_health_providers
      WHERE ($1::text IS NULL OR city ILIKE $1)
      AND ($2::text IS NULL OR name ILIKE $2)
      ORDER BY session_fee_min ASC NULLS LAST LIMIT 50
    `, [city ? `%${city}%` : null, q ? `%${q}%` : null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONTRACTS ─────────────────────────────────────────────
app.get('/contracts', async (req, res) => {
  const cached = cacheGet('contracts');
  if (cached) return res.json(cached);
  try {
    const result = await pool.query(`
      SELECT contract_id, provider_name, provider_type, city, state,
        contract_url, pdf_url, services, rates, notes
      FROM costplus_wellness_contracts ORDER BY provider_name
    `);
    cacheSet('contracts', result.rows);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHARMACIES ────────────────────────────────────────────
app.get('/pharmacies', async (req, res) => {
  const { zip } = req.query;
  try {
    const result = await pool.query(`
      SELECT id, name, chain, address, city, state, zip,
        latitude, longitude, is_online, accepts_goodrx,
        accepts_singlecare, accepts_costplus
      FROM pharmacies
      WHERE ($1::text IS NULL OR zip = $1 OR is_online = true)
      ORDER BY is_online ASC, name ASC
    `, [zip || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OPPS RATES ────────────────────────────────────────────
app.get('/opps-rates', async (req, res) => {
  try {
    const result = await pool.query(`SELECT apc_code, description, payment_rate, year FROM medicare_opps_rates ORDER BY payment_rate DESC`);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DIAGNOSTICS ───────────────────────────────────────────
app.get('/bounds', (req, res) => res.json(BOUNDS));

// FIXED: now checks ALL price_types (cash, gross, negotiated), not just cash.
// A CPT can now FAIL specifically because its gross or negotiated prices
// are out of bounds even if cash is fine — that used to be invisible.
app.get('/test-cpt/:cpt', async (req, res) => {
  const cpt = req.params.cpt;
  const b = BOUNDS[cpt] || null;
  try {
    const stats = await pool.query(`
      SELECT
        pr.price_type,
        MIN(pr.price) as min_price,
        MAX(pr.price) as max_price,
        COUNT(*) FILTER (WHERE pr.is_suspicious IS NOT TRUE) as clean_count,
        COUNT(*) FILTER (WHERE pr.is_suspicious IS TRUE) as flagged_count,
        COUNT(*) FILTER (
          WHERE pr.is_suspicious IS NOT TRUE
          AND b.cpt_code IS NOT NULL
          AND ${OUT_OF_TYPE_BOUNDS_SQL}
        ) as unflagged_out_of_bounds,
        COUNT(DISTINCT pr.hospital_id) as hospitals
      FROM prices pr
      JOIN procedures p ON p.id = pr.procedure_id
      LEFT JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
      WHERE p.cpt_code = $1
      GROUP BY pr.price_type
    `, [cpt]);

    const byType = {};
    let anyUnflaggedOutOfBounds = false;
    for (const row of stats.rows) {
      const outOfBounds = parseInt(row.unflagged_out_of_bounds) > 0;
      if (outOfBounds) anyUnflaggedOutOfBounds = true;
      byType[row.price_type] = {
        min_price: row.min_price, max_price: row.max_price,
        clean_count: parseInt(row.clean_count),
        flagged_count: parseInt(row.flagged_count),
        unflagged_out_of_bounds: parseInt(row.unflagged_out_of_bounds),
        status: !b ? 'NO BOUNDS SET' : (outOfBounds ? 'FAIL' : 'PASS')
      };
    }

    res.json({
      cpt, label: b?.label || 'no bounds set', bounds: b,
      by_price_type: byType,
      overall_status: !b ? 'NO BOUNDS SET' : (anyUnflaggedOutOfBounds ? 'FAIL' : 'PASS')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW: run this before every demo. Loops every CPT that has bounds set,
// checks every price_type against those bounds, returns one manifest.
// This is the thing that would have caught the $35 knee replacement:
// it doesn't matter which endpoint or price_type the bad row is under,
// if it's out of bounds and not flagged, it shows up here.
app.get('/verify-all', async (req, res) => {
  try {
    const cptList = Object.keys(BOUNDS);
    const results = [];
    let failCount = 0;

    for (const cpt of cptList) {
      const b = BOUNDS[cpt];
      const stats = await pool.query(`
        SELECT
          pr.price_type,
          MIN(pr.price) as min_price,
          MAX(pr.price) as max_price,
          COUNT(*) FILTER (
            WHERE pr.is_suspicious IS NOT TRUE
            AND ${OUT_OF_TYPE_BOUNDS_SQL}
          ) as unflagged_out_of_bounds
        FROM prices pr
        JOIN procedures p ON p.id = pr.procedure_id
        JOIN cpt_price_bounds b ON b.cpt_code = p.cpt_code
        WHERE p.cpt_code = $1
        GROUP BY pr.price_type
      `, [cpt]);

      const failingTypes = stats.rows.filter(r => parseInt(r.unflagged_out_of_bounds) > 0);
      const status = failingTypes.length > 0 ? 'FAIL' : 'PASS';
      if (status === 'FAIL') failCount++;

      results.push({
        cpt, label: b.label, bounds: `$${b.min}–$${b.max}`,
        status,
        failing_price_types: failingTypes.map(r => ({
          price_type: r.price_type,
          min_price: r.min_price,
          max_price: r.max_price,
          bad_row_count: parseInt(r.unflagged_out_of_bounds)
        }))
      });
    }

    res.json({
      total_cpts_checked: cptList.length,
      passing: cptList.length - failCount,
      failing: failCount,
      overall_status: failCount === 0 ? 'ALL PASS' : `${failCount} CPT(S) FAILING — review before demo`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/cache-clear', (req, res) => { cache.clear(); res.json({ cleared: true }); });

// ── HEALTH ────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '3.2',
  bounds_loaded: Object.keys(BOUNDS).length,
  cache_entries: cache.size
}));

const PORT = 3001;
app.listen(PORT, () => console.log(`Hosparent API v3.2 on http://localhost:${PORT}`));