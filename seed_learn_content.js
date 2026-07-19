#!/usr/bin/env node
// seed_learn_content.js — kickstart the Learn tab with evidence-backed starter
// content, live immediately (no waiting for the daily research run).
//
// Every entry cites primary sources (CMS, IRS, HHS, DOL, Medicare.gov). Indy's
// daily Perplexity research (run_hoser_daily.js) refreshes and expands these over
// time — upsert is by (category, title), so re-running never duplicates.
//
// Run once: node seed_learn_content.js
require('dotenv').config();
const { pool } = require('./db');
const { upsertLearnEntry } = require('./learn_content');

const ENTRIES = [
  // ── START HERE / how the whole thing works ────────────────────────────────
  {
    category: 'lower_price',
    title: 'Start here: how hospital pricing actually works',
    jurisdiction: 'US federal',
    body: `Hospitals don't have one price for a procedure — they have many. The "gross charge" (chargemaster price) is a list price almost nobody actually pays. Each insurance company negotiates its own secret rate with each hospital. And most hospitals have a separate cash or self-pay price that can be dramatically lower than the billed charge — sometimes lower than an insured patient's share.

Since 2021, a federal rule (45 CFR Part 180) requires every US hospital to publish all of these prices in a machine-readable file, including the cash price and every negotiated insurer rate. That file is where Hosparent's numbers come from: real published prices, not estimates.

This is also why two price-comparison sites can show different numbers for the same procedure at the same hospital: one may show the lowest published cash price, another a median negotiated rate, another an estimate that includes physician fees. Neither is "wrong" — they're different statistics from the same messy reality. What matters is knowing which number you're looking at, and that you can often choose which price you pay.`,
    sources: [
      'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency',
      'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-E/part-180',
    ],
  },
  {
    category: 'lower_price',
    title: 'Ask for the cash / self-pay price',
    jurisdiction: 'US federal',
    body: `Hospitals and clinics typically maintain a discounted cash price for patients who pay directly instead of billing insurance. Under the federal price transparency rule, hospitals must publish that "discounted cash price" in their price file — so you can look it up before you go, and you have the hospital's own published number to point to.

Paying cash can beat using insurance when you haven't met your deductible, when the cash price is below your plan's negotiated rate, or when the service isn't covered. Ask the billing office: "What is your self-pay or prompt-pay price for this exact service?" Get it in writing before the visit.

One caution: money you pay outside your plan usually doesn't count toward your deductible or out-of-pocket maximum, so if you expect heavy medical costs this year, do the math both ways.`,
    sources: [
      'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency',
      'https://www.healthcare.gov/glossary/deductible/',
    ],
  },
  {
    category: 'lower_price',
    title: 'Get an itemized bill and dispute errors',
    jurisdiction: 'US federal',
    body: `You have the right to request a fully itemized bill listing every charge with its billing code. Ask for it every time — a surprising share of hospital bills contain errors: duplicate charges, services never performed, wrong quantities, or "unbundled" items that should have been one charge.

Compare the itemized bill against what actually happened, and against the hospital's published prices for those same codes. Dispute anything that doesn't match, in writing, with the billing office — and ask for a hold on collections while the dispute is reviewed.

If you're uninsured or self-pay, you're entitled to a Good Faith Estimate before scheduled care, and if the final bill exceeds that estimate by $400 or more you can challenge it through the federal patient-provider dispute resolution process.`,
    sources: [
      'https://www.cms.gov/medical-bill-rights',
      'https://www.cms.gov/nosurprises/consumers/good-faith-estimates-for-uninsured-or-self-pay-patients',
    ],
  },
  {
    category: 'lower_price',
    title: 'Hospital financial assistance (charity care / 501(r))',
    jurisdiction: 'US federal',
    body: `Most US hospitals are nonprofits, and federal tax law (Internal Revenue Code section 501(r)) requires them to maintain a written Financial Assistance Policy — free or discounted care for patients who qualify, typically based on income relative to the federal poverty level. Many hospitals forgive 100% of a bill for patients under 200–300% of the poverty line, and discount steeply above that.

The policy, an application, and a plain-language summary must be publicly available (usually on the hospital's website). Hospitals must also refrain from "extraordinary collection actions" — lawsuits, wage garnishment, credit reporting — until they've made a reasonable effort to determine whether you qualify.

Always apply if the bill is large relative to your income. Assistance can apply retroactively, even after a bill has gone to collections.`,
    sources: [
      'https://www.irs.gov/charities-non-profits/financial-assistance-policies-faps',
      'https://www.irs.gov/charities-non-profits/charitable-hospitals-general-requirements-for-tax-exemption-under-section-501c3',
    ],
  },
  {
    category: 'lower_price',
    title: 'Choose an ASC or independent imaging center over a hospital',
    jurisdiction: 'US federal',
    body: `The same procedure by the same kind of doctor often costs several times more inside a hospital than at an ambulatory surgery center (ASC) or an independent imaging center — largely because hospitals add facility fees. Medicare itself publishes side-by-side prices showing the hospital outpatient vs ASC difference for common procedures.

For planned, routine care — colonoscopies, MRIs, cataract surgery, many orthopedic procedures — ask your doctor: "Can this be done at an ASC or independent center instead of the hospital?" Then compare published prices for the same billing code.

Hospital-owned "outpatient" clinics can bill hospital rates even when the building isn't a hospital, so ask whether a facility fee applies before booking.`,
    sources: [
      'https://www.medicare.gov/procedure-price-lookup/',
      'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency',
    ],
  },

  // ── KNOW YOUR RIGHTS ──────────────────────────────────────────────────────
  {
    category: 'your_rights',
    title: 'The No Surprises Act: surprise-bill protection',
    jurisdiction: 'US federal',
    body: `Since January 2022, the federal No Surprises Act protects you from most "surprise" out-of-network bills: emergency care (including air ambulance), and out-of-network providers working at in-network facilities (anesthesiologists, radiologists, assistant surgeons). In those situations you can only be charged your normal in-network cost sharing, and the provider is generally banned from "balance billing" you for the rest.

It does NOT cover ground ambulances, or care you knowingly chose out-of-network after signing a valid written waiver. Never sign an out-of-network consent form you don't understand — for emergency care and ancillary providers, they can't even ask.

If you get a bill that looks like a banned surprise bill, don't pay it — call the federal No Surprises Help Desk at 1-800-985-3059 or submit a complaint online.`,
    sources: [
      'https://www.cms.gov/nosurprises',
      'https://www.cms.gov/medical-bill-rights',
    ],
  },
  {
    category: 'your_rights',
    title: 'Appealing a denied insurance claim',
    jurisdiction: 'US federal',
    body: `A denial is not the final word. Every plan must give you an internal appeal: you (or your doctor) submit a written request asking the plan to reconsider, with medical records supporting why the care is necessary. Plans must decide within set deadlines (72 hours for urgent care).

If the internal appeal fails, you're entitled to an external review by an independent third party — the insurer must tell you how to request it in the denial letter, and its decision is binding on the plan. Employer self-funded plans follow the federal ERISA process through the Department of Labor; marketplace and individual plans follow state or HHS-administered external review.

Most denials that are appealed with documentation get overturned more often than people expect — the biggest mistake is not appealing at all. Deadlines are strict (often 180 days from the denial), so start early and keep everything in writing.`,
    sources: [
      'https://www.healthcare.gov/appeal-insurance-company-decision/',
      'https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/resource-center/publications/filing-a-claim-for-your-health-benefits',
    ],
  },
  {
    category: 'your_rights',
    title: 'Hospitals must publish their prices (and how to use it)',
    jurisdiction: 'US federal',
    body: `Federal rule 45 CFR Part 180 requires every US hospital to publish a machine-readable file of ALL its standard charges — gross charges, discounted cash prices, and every payer-negotiated rate — plus a consumer-friendly display of shoppable services. This is the raw data Hosparent is built on.

Use it two ways. Before care: look up the cash price and the negotiated rate for your plan, so you know what the service should cost. After care: compare your bill line-by-line against the hospital's own published prices — a charge far above the published rate is strong ammunition in a dispute.

If a hospital hasn't published usable prices, that's a federal violation — CMS takes complaints from the public and has fined noncompliant hospitals.`,
    sources: [
      'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency',
      'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-E/part-180',
    ],
  },
  {
    category: 'your_rights',
    title: 'Good Faith Estimates for uninsured and self-pay patients',
    jurisdiction: 'US federal',
    body: `If you're uninsured — or insured but choosing not to use your insurance — providers must give you a written Good Faith Estimate (GFE) of expected charges before scheduled care, automatically for appointments booked 3+ days out, and on request any time.

Keep that estimate. If the final bill comes in $400 or more above the GFE, you can start a federal patient-provider dispute resolution process (there's a small administrative fee, refunded if you win), and the provider cannot send the disputed bill to collections while it's pending.

Ask for the GFE in writing, make sure it lists each service and billing code, and compare the final bill against it line by line.`,
    sources: [
      'https://www.cms.gov/nosurprises/consumers/good-faith-estimates-for-uninsured-or-self-pay-patients',
      'https://www.cms.gov/medical-bill-rights',
    ],
  },
];

(async () => {
  console.log('=== SEEDING LEARN CONTENT (evidence-backed starter set) ===\n');
  for (const e of ENTRIES) {
    await upsertLearnEntry(e);
    console.log(`  ✓ [${e.category}] ${e.title}`);
  }
  const n = await pool.query(`SELECT category, COUNT(*)::int AS n FROM learn_content GROUP BY category`);
  console.log('\nLearn content now:', n.rows.map((r) => `${r.category}: ${r.n}`).join(' | '));
  console.log('Live at: GET /learn/content  (Indy\'s daily research expands this over time)');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
