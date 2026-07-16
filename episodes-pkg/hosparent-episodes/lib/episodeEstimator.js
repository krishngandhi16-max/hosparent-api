/**
 * episodeEstimator.js — additive episode-of-care estimator.
 *
 * Waterfall per component:
 *   1. mrf_direct       — high-confidence (>= 0.7) MRF price at this facility
 *   2. medicare_derived — CMS benchmark x locally-calibrated commercial multiplier
 *   3. percentage_model — component weight applied to a known anchor component
 *
 * !! Table/column names for the MRF price table are configurable below —
 *    set them from the preflight output before wiring into server.js.
 */

const CONFIG = {
  priceTable: 'prices',          // <-- your ~49.5M row table
  colCode: 'billing_code',
  colPrice: 'price',
  colPriceType: 'price_type',
  colFacility: 'facility_id',
  colConfidence: 'mapping_confidence',
  minConfidence: 0.7,
  // Calibrate these against your DFW MRF medians (see calibrateMultipliers)
  commercialMultipliers: {
    professional: 2.0,
    facility: 2.5,
    anesthesia: 2.5,
    pathology: 2.0,
    labs: 1.5,
    radiology: 2.0,
    drugs: 2.0,
    implant: 2.5,
  },
  ascToHopdRatio: 0.565,         // midpoint of documented 0.53-0.60 band
  defaultAnesthesiaMinutes: {    // typical case durations; refine per procedure
    '47562': 75, '47563': 90, '47564': 120,
    '45378': 30, '45380': 35, '45385': 40, 'G0121': 30,
    '27447': 100, '27130': 100, '49505': 60, '66984': 25, '29881': 45,
  },
};

// Typical component set per procedure. Global-days from medicare_benchmarks
// determines the E&M handling (090 = post-op visits bundled into professional).
const EPISODE_TEMPLATES = {
  DEFAULT: ['professional', 'facility', 'anesthesia', 'pathology', 'labs'],
  '47562': ['professional', 'facility', 'anesthesia', 'pathology', 'labs'],
  '45378': ['professional', 'facility', 'anesthesia', 'pathology'],
  'G0121': ['professional', 'facility', 'anesthesia', 'pathology'],
  '49505': ['professional', 'facility', 'anesthesia', 'labs'],
  '29881': ['professional', 'facility', 'anesthesia', 'radiology'],
  '66984': ['professional', 'facility', 'anesthesia'],
  '27447': ['professional', 'facility', 'anesthesia', 'implant', 'labs', 'radiology'],
};

class EpisodeEstimator {
  constructor(pool) { this.pool = pool; }

  /** Anesthesia allowed amount via ASA formula. Medicare pays exact
   *  fractional time units (47 min = 3.13 units) — no rounding. */
  async anesthesiaEstimate(surgCpt, { minutes, locality = 'NATIONAL', multiplier } = {}) {
    const xw = await this.pool.query(
      `SELECT x.anes_cpt, x.needs_verification, b.base_units
       FROM cpt_anesthesia_crosswalk x
       JOIN anesthesia_base_units b ON b.anes_cpt = x.anes_cpt
       WHERE x.surg_cpt = $1 LIMIT 1`, [surgCpt]);
    if (!xw.rows.length) return null;

    const cf = await this.pool.query(
      `SELECT cf_non_apm FROM locality_anesthesia_cf
       WHERE locality = $1 ORDER BY effective_year DESC LIMIT 1`, [locality]);
    const cfRow = cf.rows.length ? cf.rows[0] : (await this.pool.query(
      `SELECT cf_non_apm FROM locality_anesthesia_cf
       WHERE locality = 'NATIONAL' ORDER BY effective_year DESC LIMIT 1`)).rows[0];
    if (!cfRow) return null;

    const mins = minutes || CONFIG.defaultAnesthesiaMinutes[surgCpt] || 60;
    const timeUnits = mins / 15;                    // exact, unrounded
    const medicareAllowed = (xw.rows[0].base_units + timeUnits) * Number(cfRow.cf_non_apm);
    const mult = multiplier ?? CONFIG.commercialMultipliers.anesthesia;
    return {
      anesCpt: xw.rows[0].anes_cpt,
      baseUnits: xw.rows[0].base_units,
      timeUnits: Math.round(timeUnits * 100) / 100,
      medicareAllowed: Math.round(medicareAllowed * 100) / 100,
      estimate: Math.round(medicareAllowed * mult * 100) / 100,
      needsVerification: xw.rows[0].needs_verification,
    };
  }

  /** Tier 1: median high-confidence MRF price for a code at a facility. */
  async mrfDirect(code, facilityId, priceType = 'negotiated') {
    const c = CONFIG;
    const q = await this.pool.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ${c.colPrice}) AS median_price,
              AVG(${c.colConfidence}) AS avg_conf, COUNT(*) AS n
       FROM ${c.priceTable}
       WHERE ${c.colCode} = $1 AND ${c.colFacility} = $2
         AND ${c.colPriceType} = $3 AND ${c.colPrice} > 0
         AND COALESCE(${c.colConfidence}, 0) >= $4
         AND COALESCE(is_suspicious, FALSE) = FALSE`,
      [code, facilityId, priceType, c.minConfidence]);
    const r = q.rows[0];
    if (!r || !r.median_price) return null;
    return { amount: Number(r.median_price), confidence: Number(r.avg_conf), n: Number(r.n) };
  }

  /** Tier 2: Medicare benchmark x multiplier. */
  async medicareDerived(code, componentType, setting = 'HOPD') {
    const q = await this.pool.query(
      `SELECT pfs_facility_amt, opps_apc_rate, asc_rate, clfs_rate, global_days
       FROM medicare_benchmarks
       WHERE code = $1 AND locality = 'NATIONAL'
       ORDER BY effective_year DESC LIMIT 1`, [code]);
    if (!q.rows.length) return null;
    const b = q.rows[0];
    let base = null;
    if (componentType === 'professional') base = b.pfs_facility_amt;
    else if (componentType === 'facility') {
      base = setting === 'ASC'
        ? (b.asc_rate ?? (b.opps_apc_rate ? b.opps_apc_rate * CONFIG.ascToHopdRatio : null))
        : b.opps_apc_rate;
    } else if (componentType === 'labs') base = b.clfs_rate;
    else base = b.pfs_facility_amt ?? b.opps_apc_rate;
    if (base == null) return null;
    const mult = CONFIG.commercialMultipliers[componentType] ?? 2.0;
    return {
      amount: Math.round(Number(base) * mult * 100) / 100,
      medicareBase: Number(base), multiplier: mult, globalDays: b.global_days,
    };
  }

  /** Tier 3: percentage model anchored to a known component. */
  async percentageModel(primaryCpt, componentType, anchorType, anchorAmount) {
    const w = await this.pool.query(
      `SELECT component_type, weight FROM episode_component_weights
       WHERE primary_cpt = $1
       UNION ALL
       SELECT component_type, weight FROM episode_component_weights
       WHERE primary_cpt = 'DEFAULT'
         AND NOT EXISTS (SELECT 1 FROM episode_component_weights WHERE primary_cpt = $1)`,
      [primaryCpt]);
    const weights = Object.fromEntries(w.rows.map(r => [r.component_type, Number(r.weight)]));
    if (!weights[componentType] || !weights[anchorType]) return null;
    const total = anchorAmount / weights[anchorType];
    return { amount: Math.round(total * weights[componentType] * 100) / 100 };
  }

  /** Assemble the full additive episode for one procedure at one facility. */
  async estimateEpisode(primaryCpt, facilityId, { setting = 'HOPD', priceType = 'negotiated' } = {}) {
    const template = EPISODE_TEMPLATES[primaryCpt] || EPISODE_TEMPLATES.DEFAULT;
    const components = [];
    let anchor = null;

    for (const componentType of template) {
      let line = null;

      if (componentType === 'anesthesia') {
        const a = await this.anesthesiaEstimate(primaryCpt);
        if (a) line = {
          componentType, amount: a.estimate, method: 'medicare_derived',
          confidence: a.needsVerification ? 0.6 : 0.85, detail: a,
        };
      } else {
        // Component -> code to price. Professional + facility use the primary CPT;
        // ancillaries need a per-procedure code map you refine over time.
        const code = primaryCpt; // TODO: ancillary code map (path CPT 88304/88305, CBC 85025, etc.)

        if (['professional', 'facility'].includes(componentType)) {
          const direct = await this.mrfDirect(code, facilityId, priceType);
          if (direct) line = {
            componentType, amount: direct.amount, method: 'mrf_direct',
            confidence: direct.confidence, n: direct.n,
          };
        }
        if (!line) {
          const derived = await this.medicareDerived(code, componentType, setting);
          if (derived) line = {
            componentType, amount: derived.amount, method: 'medicare_derived',
            confidence: 0.75, detail: derived,
          };
        }
      }

      if (line) {
        components.push(line);
        if (!anchor || line.method === 'mrf_direct') anchor = line;
      } else {
        components.push({ componentType, amount: null, method: 'percentage_model', pending: true });
      }
    }

    // Fill gaps with the percentage model off the best anchor
    if (anchor) {
      for (const c of components) {
        if (c.pending) {
          const pct = await this.percentageModel(primaryCpt, c.componentType, anchor.componentType, anchor.amount);
          if (pct) { c.amount = pct.amount; c.confidence = 0.4; delete c.pending; }
        }
      }
    }

    const priced = components.filter(c => c.amount != null);
    const total = priced.reduce((s, c) => s + c.amount, 0);
    const conf = priced.length
      ? priced.reduce((s, c) => s + (c.confidence ?? 0.4) * c.amount, 0) / total : 0;

    return {
      primaryCpt, facilityId, setting,
      totalEstimate: Math.round(total * 100) / 100,
      overallConfidence: Math.round(conf * 1000) / 1000,
      components: priced,
      unpriced: components.filter(c => c.amount == null).map(c => c.componentType),
      methodCounts: {
        mrf_direct: priced.filter(c => c.method === 'mrf_direct').length,
        medicare_derived: priced.filter(c => c.method === 'medicare_derived').length,
        percentage_model: priced.filter(c => c.method === 'percentage_model').length,
      },
      disclaimer: 'Estimate, not a quote. Anesthesia and pathology may be billed separately by other providers. You may request a Good Faith Estimate from the provider.',
    };
  }

  /** Persist into procedure_episode_costs + summary. */
  async persistEpisode(est) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM procedure_episode_costs WHERE primary_cpt = $1 AND facility_id = $2`,
        [est.primaryCpt, est.facilityId]);
      for (const c of est.components) {
        await client.query(
          `INSERT INTO procedure_episode_costs
             (primary_cpt, facility_id, component_type, estimated_amount,
              estimation_method, mapping_confidence)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [est.primaryCpt, est.facilityId, c.componentType, c.amount, c.method, c.confidence ?? null]);
      }
      await client.query(
        `INSERT INTO procedure_episode_summary
           (primary_cpt, facility_id, setting, total_estimate, overall_confidence,
            n_mrf_components, n_derived_components, n_pct_components, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (primary_cpt, facility_id, setting) DO UPDATE SET
           total_estimate = EXCLUDED.total_estimate,
           overall_confidence = EXCLUDED.overall_confidence,
           n_mrf_components = EXCLUDED.n_mrf_components,
           n_derived_components = EXCLUDED.n_derived_components,
           n_pct_components = EXCLUDED.n_pct_components,
           computed_at = now()`,
        [est.primaryCpt, est.facilityId, est.setting, est.totalEstimate, est.overallConfidence,
         est.methodCounts.mrf_direct, est.methodCounts.medicare_derived, est.methodCounts.percentage_model]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }
  }

  /** Calibrate commercial multipliers from your own DFW MRF medians vs Medicare. */
  async calibrateMultipliers(priceType = 'negotiated') {
    const c = CONFIG;
    const q = await this.pool.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP
                (ORDER BY p.${c.colPrice} / NULLIF(mb.pfs_facility_amt, 0)) AS median_ratio,
              COUNT(*) AS n
       FROM ${c.priceTable} p
       JOIN medicare_benchmarks mb
         ON mb.code = p.${c.colCode} AND mb.locality = 'NATIONAL'
       WHERE p.${c.colPriceType} = $1 AND p.${c.colPrice} > 0
         AND COALESCE(p.${c.colConfidence}, 0) >= $2
         AND mb.pfs_facility_amt > 0`, [priceType, c.minConfidence]);
    return q.rows[0]; // review, then update CONFIG.commercialMultipliers
  }
}

module.exports = { EpisodeEstimator, CONFIG, EPISODE_TEMPLATES };
