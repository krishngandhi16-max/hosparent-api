// episode_rulebook.js
// Evidence-based component rulebook (from Hosparent research report).
// Every value cited to CMS/ASA/AAHKS/ASCRS. This is a DATA module —
// require it from server.js or the assembler. It does not touch the DB by itself.

const CONVERSION_FACTORS = {
  anesthesia_medicare_2026: 20.4976,   // CMS CY2026 non-QP anesthesia CF
  anesthesia_commercial_default: 65.0, // commercial ~2-3x Medicare; tune per market
};

// Surgical CPT -> anesthesia mapping (ASA CROSSWALK anchors, confirmed in research)
// base_units = ASA base units; typical_minutes = assumption (surface as adjustable)
const ANESTHESIA_MAP = {
  '47562': { anes: '00790', base_units: 7, typical_minutes: 75 }, // lap chole
  '47563': { anes: '00790', base_units: 7, typical_minutes: 80 },
  '45378': { anes: '00812', base_units: 4, typical_minutes: 30 }, // screening colonoscopy
  '45380': { anes: '00811', base_units: 4, typical_minutes: 35 }, // w/ biopsy -> 00811
  '45385': { anes: '00811', base_units: 4, typical_minutes: 40 }, // w/ polypectomy
  '49505': { anes: '00830', base_units: 4, typical_minutes: 60 }, // open hernia
  '49650': { anes: '00840', base_units: 6, typical_minutes: 60 }, // lap hernia
  '29881': { anes: '01400', base_units: 4, typical_minutes: 50 }, // knee arthroscopy
  '66984': { anes: '00142', base_units: 4, typical_minutes: 25 }, // cataract simple
  '66982': { anes: '00142', base_units: 4, typical_minutes: 30 }, // cataract complex
  '27447': { anes: '01402', base_units: 7, typical_minutes: 112 },// total knee
};

// Which ancillaries genuinely apply (research: do NOT auto-add pathology everywhere)
const ANCILLARIES = {
  '47562': { pathology: '88304', implant: false }, // gallbladder specimen exam
  '47563': { pathology: '88304', implant: false },
  '45378': { pathology: null,    implant: false }, // pure screening: no tissue
  '45380': { pathology: '88305', implant: false }, // biopsy tissue
  '45385': { pathology: '88305', implant: false }, // polyp tissue
  '49505': { pathology: null,    implant: false }, // mesh packaged into facility
  '49650': { pathology: null,    implant: false },
  '29881': { pathology: null,    implant: false }, // meniscus often discarded
  '66984': { pathology: null,    implant: false }, // IOL packaged; no path
  '66982': { pathology: null,    implant: false },
  '27447': { pathology: null,    implant: true  }, // implant is the defining ancillary
};

// Medicare facility (APC/ASC) + surgeon anchors from research (CY2026, national).
// facility_hopd / facility_asc = bundled facility rate (NOT summed line items).
const FACILITY_ANCHORS = {
  '47562': { apc: '5361', hopd: 6176, asc: 3031, surgeon: 632 },
  '45378': { apc: '5312', hopd: 1223, asc: 657,  surgeon: 228 },
  '49505': { apc: '5341', hopd: 3658, asc: 1744, surgeon: 508 },
  '49650': { apc: '5361', hopd: 6176, asc: 3031, surgeon: 424 },
  '29881': { apc: '5113', hopd: 3343, asc: 1645, surgeon: 341 },
  '66984': { apc: '5491', hopd: 2370, asc: 1256, surgeon: 463 },
  '66982': { apc: '5492', hopd: 2370, asc: 1256, surgeon: 463 },
  '27447': { apc: '5115', hopd: 12553, asc: 9055, surgeon: 1450 },
};

// Validation benchmarks (cash/commercial all-in ranges) to sanity-check totals.
const VALIDATION_RANGES = {
  '47562': [6767, 17350],
  '45378': [1250, 3773],
  '49505': [3000, 9000],   // weakly sourced - flagged in research
  '49650': [3000, 11000],  // weakly sourced
  '29881': [3000, 12000],  // weakly sourced
  '66984': [1719, 7000],
  '66982': [1719, 7000],
  '27447': [15000, 75000],
};

function anesthesiaEstimate(cpt, payer = 'medicare') {
  const m = ANESTHESIA_MAP[cpt];
  if (!m) return null;
  const cf = payer === 'medicare'
    ? CONVERSION_FACTORS.anesthesia_medicare_2026
    : CONVERSION_FACTORS.anesthesia_commercial_default;
  const timeUnits = m.typical_minutes / 15;
  const total = (m.base_units + timeUnits) * cf;
  return {
    anesthesia_cpt: m.anes,
    base_units: m.base_units,
    time_units: Math.round(timeUnits * 100) / 100,
    conversion_factor: cf,
    estimate: Math.round(total),
    note: `(${m.base_units} base + ${(m.typical_minutes/15).toFixed(1)} time units) x $${cf}/unit. Time is an assumption (${m.typical_minutes} min).`
  };
}

module.exports = {
  CONVERSION_FACTORS, ANESTHESIA_MAP, ANCILLARIES,
  FACILITY_ANCHORS, VALIDATION_RANGES, anesthesiaEstimate,
};