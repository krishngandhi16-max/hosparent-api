#!/usr/bin/env node
// seed_learn_research.js — load the verified patient-protection laws & rights
// into learn_reference so the Learn tab can serve them.
//
// EVERY entry below is grounded in a government or primary source (URL included).
// Nothing is model-invented. Numbers/dates are stated conservatively; where a
// figure could not be verified it was left out rather than guessed — this is
// shown to clinicians and must hold up.
//
// Idempotent: re-run any time; upserts by slug. Run: node seed_learn_research.js
require('dotenv').config();
const { pool } = require('./db');
const { upsertReference } = require('./learn_reference');

const ENTRIES = [
  // ── Federal price-transparency law ──────────────────────────────────────
  {
    kind: 'law', slug: 'hospital-price-transparency-rule', sort_order: 10,
    title: 'Hospital Price Transparency Rule',
    jurisdiction: 'US federal', effective_date: 'January 1, 2021', citation: '45 CFR 180',
    penalty: 'Civil monetary penalties up to roughly $2M per hospital per year, scaled by bed count',
    summary: 'Every hospital in the U.S. must publicly post all of its prices — including the cash/self-pay price and every insurer-negotiated rate — in a machine-readable file, plus a consumer-friendly list of common shoppable services.',
    detail: 'This is the rule Hosparent is built on. Because hospitals must publish their actual negotiated and cash prices, you can compare the same procedure across hospitals before you ever schedule it. CMS audits a sample of hospitals, investigates complaints, and can fine hospitals that hide prices.',
    bullets: [
      'A machine-readable file listing all items and services with every payer-negotiated rate and the cash price',
      'A consumer-friendly display of at least 300 shoppable services',
      'Updated at least once a year, with no login and no fee to view',
      'CMS audits hospitals and investigates complaints; non-compliant hospitals can be fined',
    ],
    action: 'Before you schedule anything non-emergency, look up the price at several hospitals — they are legally required to publish it. If a hospital refuses to post prices, you can file a complaint with CMS.',
    sources: [
      { title: 'CMS — Hospital Price Transparency', url: 'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency' },
      { title: 'CMS — HPT enforcement actions', url: 'https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency/enforcement-actions' },
    ],
  },
  // ── 2026 upgrade to the transparency rule ───────────────────────────────
  {
    kind: 'law', slug: 'hpt-2026-actual-prices', sort_order: 20,
    title: '2026 Price Transparency Upgrade — actual dollar amounts',
    jurisdiction: 'US federal', effective_date: 'January 1, 2026 (enforced April 1, 2026)',
    citation: 'CY 2026 OPPS/ASC Final Rule (CMS-1834-FC); 45 CFR 180.50',
    penalty: 'CMP reduced 35% if a hospital waives its hearing — but not for core violations (no MRF or no shoppable services)',
    summary: 'Starting in 2026, hospitals must post the actual dollar amounts they are paid — the median and the 10th and 90th percentile of allowed amounts — instead of vague estimates, plus their NPI and a senior official’s signed attestation that the data is true.',
    detail: 'This makes published prices far more useful: instead of an "estimated" charge, you can see what a hospital actually collects for a service, and the 10th-percentile figure is a realistic "good price" to aim for. Hospitals compute these from 12–15 months of real remittance data.',
    bullets: [
      'Median plus 10th and 90th percentile "allowed amounts," in real dollars, from 12–15 months of actual payment data',
      'Replaces the old "estimated allowed amount"',
      'Hospitals must encode their organizational (Type 2) NPI in the file',
      'A named CEO/president/senior official must attest the file is true, accurate, and complete',
      'Enforcement of the new requirements begins April 1, 2026',
    ],
    action: 'On 2026 files, look at the 10th-percentile allowed amount — it shows a genuinely low price the hospital has accepted, which is a strong number to ask for as a cash or negotiated rate.',
    sources: [
      { title: 'CMS — CY2026 OPPS/ASC Final Rule: HPT policy changes', url: 'https://www.cms.gov/newsroom/fact-sheets/cy-2026-opps-ambulatory-surgical-center-final-rule-hospital-price-transparency-policy-changes' },
      { title: 'CMS — HPT fact sheet (MLN)', url: 'https://www.cms.gov/files/document/mln7215754-hospital-price-transparency.pdf' },
    ],
  },
  // ── No Surprises Act ────────────────────────────────────────────────────
  {
    kind: 'law', slug: 'no-surprises-act', sort_order: 30,
    title: 'No Surprises Act',
    jurisdiction: 'US federal', effective_date: 'January 1, 2022',
    citation: 'No Surprises Act (Consolidated Appropriations Act, 2021)',
    penalty: 'Providers who violate can face federal civil monetary penalties',
    summary: 'You cannot be balance-billed at out-of-network rates for emergency care, or for out-of-network providers (like anesthesiology or radiology) at an in-network facility. You owe only your in-network cost-sharing.',
    detail: 'The classic "surprise bill" — an ER visit, or an out-of-network anesthesiologist at an in-network hospital — is now largely banned. Any payment fight happens between the provider and the insurer through a federal Independent Dispute Resolution (IDR) process, not with you.',
    bullets: [
      'Emergency care is billed at in-network rates no matter where you go',
      'Out-of-network providers at an in-network facility generally cannot balance-bill you',
      'Provider–insurer payment disputes go through federal Independent Dispute Resolution (IDR)',
      'Applies to most employer and marketplace plans',
    ],
    action: 'If you get a surprise out-of-network bill from an ER, or from a provider you didn’t choose at an in-network hospital, do not just pay it — you likely owe only your in-network share. Dispute it.',
    sources: [
      { title: 'CMS — No Surprises Act', url: 'https://www.cms.gov/nosurprises' },
    ],
  },
  // ── Good Faith Estimate ─────────────────────────────────────────────────
  {
    kind: 'law', slug: 'good-faith-estimate', sort_order: 40,
    title: 'Good Faith Estimate',
    jurisdiction: 'US federal', effective_date: 'January 1, 2022', citation: 'No Surprises Act § 2799B-6',
    penalty: 'Bills exceeding the estimate by $400+ can be disputed through federal patient–provider dispute resolution',
    summary: 'If you are uninsured or paying cash, the provider must give you a written estimate of the total expected cost before scheduled care. If the final bill is $400 or more over that estimate, you can dispute it.',
    detail: 'The Good Faith Estimate is your leverage. It must bundle everything — facility, physician, anesthesia, labs — so you are not blindsided by add-on charges after the fact.',
    bullets: [
      'A written estimate for uninsured and self-pay patients',
      'Must include all expected charges — facility, provider, anesthesia, labs',
      'Ask for it at least one business day before your appointment',
      'If the final bill exceeds the estimate by $400 or more, you can dispute it',
    ],
    action: 'Always request a Good Faith Estimate before self-pay care and keep it. If the bill balloons past it by $400+, file a patient–provider dispute.',
    sources: [
      { title: 'CMS — Good Faith Estimates for consumers', url: 'https://www.cms.gov/nosurprises/consumers/good-faith-estimates' },
    ],
  },
  // ── Appeal rights ───────────────────────────────────────────────────────
  {
    kind: 'right', slug: 'appeal-denied-claim', sort_order: 50,
    title: 'Your right to appeal a denied claim',
    jurisdiction: 'US federal', effective_date: 'Affordable Care Act (2010)', citation: 'ACA §2719 / 45 CFR 147.136',
    penalty: null,
    summary: 'If your insurer denies a claim, you have the right to a full internal appeal, and then to an independent external review by a third party whose decision the insurer must follow.',
    detail: 'A first denial is not the end. Insurers must give you a written reason and a path to appeal. If the internal appeal fails, an independent external reviewer — not the insurer — makes the final call, and that decision is binding.',
    bullets: [
      'First, an internal appeal: the insurer re-reviews its own decision',
      'Then, external review by an independent organization',
      'The external reviewer’s decision is binding on the insurer',
      'You generally have up to 4 months (180 days) from the denial to file; urgent cases can be expedited',
    ],
    action: 'Never accept the first "no." Get the denial reason in writing, file the internal appeal, and if it’s denied again, request an external review.',
    sources: [
      { title: 'HealthCare.gov — Appeal an insurance company decision', url: 'https://www.healthcare.gov/appeal-insurance-company-decision/' },
    ],
  },
  // ── ACA preventive services ─────────────────────────────────────────────
  {
    kind: 'right', slug: 'preventive-services-no-cost', sort_order: 60,
    title: 'Free in-network preventive care',
    jurisdiction: 'US federal', effective_date: 'Affordable Care Act (2010)', citation: 'ACA §2713',
    penalty: null,
    summary: 'In-network preventive care — many screenings, immunizations, and annual wellness visits — must be covered with no copay, coinsurance, or deductible.',
    detail: 'A large set of recommended preventive services is fully covered when you stay in-network, so routine screenings that catch problems early should cost you nothing out of pocket.',
    bullets: [
      'No cost-sharing for recommended preventive services received in-network',
      'Includes many cancer screenings, immunizations, and wellness visits',
      'You pay nothing out of pocket when the visit is coded as preventive and in-network',
    ],
    action: 'Schedule your recommended screenings and annual visit in-network and confirm they’re billed as preventive — they should cost you $0.',
    sources: [
      { title: 'HealthCare.gov — Preventive care benefits', url: 'https://www.healthcare.gov/coverage/preventive-care-benefits/' },
    ],
  },
  // ── IRS 501(r) charity care ─────────────────────────────────────────────
  {
    kind: 'law', slug: 'irs-501r-financial-assistance', sort_order: 70,
    title: 'Nonprofit hospital financial assistance (charity care)',
    jurisdiction: 'US federal', effective_date: 'IRC §501(r)', citation: '26 U.S.C. §501(r); 26 CFR 1.501(r)',
    penalty: 'A hospital can lose its federal tax-exempt status for non-compliance',
    summary: 'Every nonprofit hospital must have a written financial assistance policy and must check whether you qualify before taking aggressive collection action. Many patients qualify for free or steeply discounted care — even after the bill arrives.',
    detail: 'This is one of the most under-used patient protections. Nonprofit hospitals (the majority of U.S. hospitals) must publicize a financial assistance policy, give you months to apply, and pause collections while you do. If you qualify, they can’t charge you more than they charge insured patients.',
    bullets: [
      'Nonprofit hospitals must have and publicize a written financial assistance policy',
      'You have at least 240 days from your first bill to apply',
      'The hospital must wait 120 days and check your eligibility before "extraordinary collection actions" (credit reporting, lawsuits, wage garnishment)',
      'If you qualify, you can’t be charged more than the "amounts generally billed" to insured patients',
    ],
    action: 'At any nonprofit hospital, ask for the "financial assistance policy" and apply — you have 240 days, even after the bill arrives, and applying pauses collections.',
    sources: [
      { title: 'IRS — Financial Assistance Policy, §501(r)(4)', url: 'https://www.irs.gov/charities-non-profits/financial-assistance-policy-and-emergency-medical-care-policy-section-501r4' },
      { title: 'Cornell Law — 26 CFR 1.501(r)-6', url: 'https://www.law.cornell.edu/cfr/text/26/1.501(r)-6' },
    ],
  },
  // ── Texas SB 1264 (surprise billing) ────────────────────────────────────
  {
    kind: 'law', slug: 'texas-sb-1264-surprise-billing', sort_order: 80,
    title: 'Texas surprise-billing protection (SB 1264)',
    jurisdiction: 'Texas', effective_date: 'January 1, 2020', citation: 'Texas SB 1264 (2019)',
    penalty: null,
    summary: 'Texans on state-regulated health plans are protected from surprise balance bills in emergencies and from out-of-network providers at in-network facilities. Check your insurance card for "TDI" or "DOI."',
    detail: 'Texas passed its own surprise-billing shield before the federal No Surprises Act. It covers state-regulated plans and Texas teacher/state-employee plans. The provider and insurer settle payment through an independent dispute-resolution process — you’re out of the middle.',
    bullets: [
      'Applies to Texas state-regulated plans and teacher/state-employee plans',
      'Look for "TDI" or "DOI" on your insurance card to know if you’re covered',
      'Provider and insurer resolve payment through independent dispute resolution — not you',
      'You can only waive the protection with 10 business days’ written notice, never in an emergency',
    ],
    action: 'Check your card for TDI/DOI. If you have it and receive a surprise bill, you’re protected — dispute it with the Texas Department of Insurance.',
    sources: [
      { title: 'Texas Dept. of Insurance — SB 1264', url: 'https://www.tdi.texas.gov/rules/2019/senate-bill-1264.html' },
      { title: 'TDI — Medical billing help', url: 'https://www.tdi.texas.gov/medical-billing/' },
    ],
  },
  // ── Texas SB 490 (itemized bill) ────────────────────────────────────────
  {
    kind: 'law', slug: 'texas-sb-490-itemized-bill', sort_order: 90,
    title: 'Texas itemized-bill law (SB 490)',
    jurisdiction: 'Texas', effective_date: 'September 1, 2023', citation: 'Texas SB 490 (2023)',
    penalty: 'A non-compliant provider can face licensing-board discipline and cannot pursue collection',
    summary: 'A Texas provider must give you an itemized bill — with a plain-language description and billing code for each charge — before it can send you to debt collection.',
    detail: 'This flips the leverage on surprise lump-sum bills. Until a Texas provider hands you a compliant itemized bill, it is prohibited from pursuing collection against you — so you can force detail before you pay a dime.',
    bullets: [
      'Itemized bill required, with a plain-language description and billing code for each service',
      'Must show amounts billed to and paid by your insurer, and the amount you owe',
      'A provider that hasn’t sent a compliant itemized bill cannot pursue debt collection',
      'Non-compliance can trigger discipline by the provider’s licensing board',
    ],
    action: 'If you get a lump-sum bill or a collections notice with no itemized bill, demand the itemized bill first — until they provide it, they legally can’t collect.',
    sources: [
      { title: 'Texas Legislature — SB 490 bill text', url: 'https://capitol.texas.gov/tlodocs/88R/billtext/pdf/SB00490I.pdf' },
      { title: 'Texas Association of Health Plans — patient rights bill', url: 'https://tahp.org/new-patient-rights-bill-signed-by-the-governor/' },
    ],
  },
];

async function main() {
  console.log('=== SEEDING LEARN REFERENCE (verified patient-protection laws & rights) ===\n');
  let n = 0;
  for (const e of ENTRIES) {
    await upsertReference(e);
    console.log(`  ✓ [${e.kind}] ${e.title} (${e.jurisdiction})`);
    n++;
  }
  console.log(`\nSeeded/updated ${n} entries into learn_reference.`);
  console.log('Test: curl "http://localhost:3001/learn/reference"');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}
module.exports = { ENTRIES, main };
