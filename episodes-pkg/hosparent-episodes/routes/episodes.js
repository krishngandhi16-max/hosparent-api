/**
 * routes/episodes.js — mount in server.js:
 *   const episodeRoutes = require('./routes/episodes');
 *   app.use('/api/episodes', episodeRoutes(pool));
 */
const express = require('express');
const { EpisodeEstimator } = require('../lib/episodeEstimator');

module.exports = function (pool) {
  const router = express.Router();
  const estimator = new EpisodeEstimator(pool);

  // GET /api/episodes/estimate?cpt=47562&facilityId=123&setting=HOPD
  router.get('/estimate', async (req, res) => {
    try {
      const { cpt, facilityId, setting = 'HOPD', priceType = 'negotiated' } = req.query;
      if (!cpt || !facilityId) return res.status(400).json({ error: 'cpt and facilityId required' });
      if (!/^([0-9]{5}|[A-Z][0-9]{4})$/.test(cpt)) return res.status(400).json({ error: 'invalid CPT/HCPCS' });
      const est = await estimator.estimateEpisode(cpt, Number(facilityId), { setting, priceType });
      res.json(est);
    } catch (e) {
      console.error('episode estimate error:', e);
      res.status(500).json({ error: 'estimation failed' });
    }
  });

  // GET /api/episodes/anesthesia?cpt=47562&minutes=75
  router.get('/anesthesia', async (req, res) => {
    try {
      const { cpt, minutes, locality } = req.query;
      if (!cpt) return res.status(400).json({ error: 'cpt required' });
      const a = await estimator.anesthesiaEstimate(cpt, {
        minutes: minutes ? Number(minutes) : undefined, locality,
      });
      if (!a) return res.status(404).json({ error: 'no crosswalk for this CPT' });
      res.json(a);
    } catch (e) {
      console.error('anesthesia estimate error:', e);
      res.status(500).json({ error: 'estimation failed' });
    }
  });

  // POST /api/episodes/compute-batch  { cpts: [...], facilityIds: [...] }
  // Precompute + persist summaries for search/UI reads.
  router.post('/compute-batch', async (req, res) => {
    try {
      const { cpts = [], facilityIds = [], setting = 'HOPD' } = req.body || {};
      const results = [];
      for (const cpt of cpts) {
        for (const fid of facilityIds) {
          const est = await estimator.estimateEpisode(cpt, Number(fid), { setting });
          if (est.components.length) { await estimator.persistEpisode(est); results.push({ cpt, fid, total: est.totalEstimate }); }
        }
      }
      res.json({ computed: results.length, results });
    } catch (e) {
      console.error('batch compute error:', e);
      res.status(500).json({ error: 'batch failed' });
    }
  });

  return router;
};
