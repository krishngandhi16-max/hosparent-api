// test_episode.js
const rb = require('./episode_rulebook');

function assemble(cpt, setting = 'asc', payer = 'medicare') {
  const fac = rb.FACILITY_ANCHORS[cpt];
  const anes = rb.anesthesiaEstimate(cpt, payer);
  const anc = rb.ANCILLARIES[cpt];
  if (!fac || !anes) { console.log(`No rulebook entry for ${cpt}`); return; }

  const facility = setting === 'asc' ? fac.asc : fac.hopd;
  const surgeon = fac.surgeon;
  const anesthesia = anes.estimate;
  const pathology = anc.pathology ? 40 : 0; // Medicare 88304/88305 ~ $40 technical+prof
  const total = facility + surgeon + anesthesia + pathology;
  const [lo, hi] = rb.VALIDATION_RANGES[cpt] || [0, 999999];

  console.log(`\n=== CPT ${cpt} | ${setting.toUpperCase()} | ${payer} ===`);
  console.table({
    facility: `$${facility}`,
    surgeon: `$${surgeon}`,
    anesthesia: `$${anesthesia}`,
    pathology: pathology ? `$${pathology} (${anc.pathology})` : 'none',
    TOTAL: `$${total}`,
  });
  const inRange = total >= lo && total <= hi;
  console.log(`Validation range (cash all-in): $${lo} - $${hi}  ->  ${inRange ? 'within range' : 'OUTSIDE (Medicare base is expected to be lower than cash)'}`);
}

['47562','45378','49650','29881','66984','27447'].forEach(c => assemble(c, 'asc', 'medicare'));