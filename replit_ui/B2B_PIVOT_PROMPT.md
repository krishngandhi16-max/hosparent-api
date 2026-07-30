# Hosparent B2B pivot — public site (NO PHI). Paste into the Replit Agent.

> SCOPE GUARD: this prompt builds the PUBLIC marketing/compliance site only.
> The claims-upload portal and analytics dashboards handle PHI and must NOT be
> built here — they belong on a HIPAA-eligible cloud with a signed BAA.
> This site must never collect claims files, member IDs, diagnoses, or any
> health information.

---

Reposition this app. Hosparent is no longer a consumer price-search tool — it is a
**healthcare cost consulting firm for self-funded employers in Texas**. Rebuild the
site around that business. Keep the existing design system exactly (Fraunces +
Public Sans, #FAFAF7 background, #0F6B5C teal, #1F7A3D for savings, 1080px max
width, 8px spacing scale, sentence case, no gradients/emoji/exclamation marks).

**Audience:** HR and finance leaders at self-funded employers, 50–1,000 employees,
in DFW/Texas. Write for a CFO: specific, quantified, calm. Not consumer-facing.

## CRITICAL — this site collects NO protected health information

- No claims file upload anywhere on this site.
- No forms asking for diagnoses, conditions, member IDs, or medical details.
- The employer portal is a **link out** to `app.hosparent.com` (a separate secure
  system) — build a "Client login" button in the header that points there. Do not
  build upload or dashboard functionality in this app.
- If you add any form, it collects business contact info only.

## Pages to build

### 1. Home
- H1 (Fraunces): "Self-funded employers are overpaying. Your own data proves it."
- Sub: "Hosparent helps Texas employers cut healthcare spend through claims
  analytics, direct provider contracting, and care model redesign — with no
  carrier or PBM commissions."
- Primary CTA: "Request a data audit" → contact page. One primary button only.
- Three value cards:
  - **Conflict-free** — "We take no commissions from carriers, PBMs, or TPAs. Our
    only revenue is your fee, so our only incentive is your savings."
  - **Your data, quantified** — "We analyze your own claims to show exactly where
    the money goes and what changing it is worth."
  - **Compliance-first** — "HIPAA business associate under a signed BAA. We are a
    consultant, never a plan fiduciary — you retain all decision authority."
- "What we do" strip: five services (below), each a card linking to its section.
- Proof section: "We maintain a live database of published cash prices for DFW
  hospitals, sourced from federally required machine-readable files (45 CFR 180)."
  Keep the existing price-search tool reachable here as a **demo/proof asset** at
  `/price-data` — reframed as "See our price data" (evidence of capability), not
  as the main product.
- Who it's for: "Self-funded employers, 50–1,000 employees, in Dallas–Fort Worth
  and across Texas."

### 2. Services (one page, five anchored sections)
1. **Claims data & analytics** — secure intake, HIPAA-compliant de-identification,
   dashboards on top cost drivers, price variation, and steering opportunities.
2. **Direct contracting** — identify high-volume services (imaging, ortho, primary
   care), build RFPs, negotiate with providers, coordinate rate loading with the TPA.
3. **Care model optimization** — telemedicine design, concierge/direct primary care
   with employer subsidies, ER diversion.
4. **PBM optimization** — pharmacy claims analysis, pass-through PBM models,
   specialty carve-outs, reference pricing.
5. **Benefits navigation** — 24/7 support for employees on cost and logistics.
   Label clearly: "Financial and logistical guidance only — not medical advice."

Each section: what it is, what the employer gets (deliverables), and a one-line
"typical outcome" written conservatively (no invented savings percentages — if a
number isn't sourced or contractually typical, don't print one).

### 3. Pricing
Real numbers, in a clean table. Two models side by side:

**Ongoing retainer**
| Item | Fee |
|---|---|
| Base analytics + consulting | $3–$6 PEPM (per employee per month) |
| Monthly minimum | $1,500–$2,500 |
| Implementation projects | $5,000–$25,000 one-time, by scope |
| Optional performance fee | 10–20% of verified first-year savings, capped and defined in contract |

**Packages**
| Package | What's included | Price |
|---|---|---|
| Starter | Claims audit, savings report, 90-day roadmap | $7,500–$15,000 one-time |
| Growth | Ongoing analytics, vendor management, plan design support | $2,500–$5,000/month |
| Transform | Full redesign + direct contracts | $10,000–$30,000 setup + $5,000–$10,000/month (6–12 months) |

Add a worked example: "A 200-employee self-funded employer at $4 PEPM is $800/month
of base analytics; with the monthly minimum, typical engagements run $2,000–$3,000
per month plus project fees."
Add: "We accept no commissions from carriers, PBMs, or TPAs."

### 4. Compliance & security  (make this a real page — it is a differentiator)
- **HIPAA** — "Hosparent acts as a business associate to self-funded health plans.
  We execute a Business Associate Agreement with every client before any protected
  health information is transferred. Data is encrypted in transit and at rest,
  access is role-based and multi-factor, and all access is logged."
- **De-identification** — "Analytics are performed on de-identified data using HIPAA
  Safe Harbor or Expert Determination methods."
- **ERISA positioning** — "Hosparent is a non-fiduciary consultant. The employer
  remains the sole Plan Administrator and named fiduciary. We provide analysis and
  recommendations; the employer approves all plan changes. We hold no discretionary
  authority over plan assets or claims adjudication."
- **What we are not** — "We are not an insurer, a third-party administrator, a
  broker, or a medical provider."
- Link to Terms, Privacy Policy, HIPAA notice.

### 5. How it works
Four steps: 1) Discovery call → 2) Data audit proposal → 3) Pilot (1–3 months) →
4) Full engagement. Note under step 2: "A signed BAA is executed before any data
is shared."

### 6. Benefits navigation (public info page for employees)
- What the service does and how to reach it.
- **Prominent, high-contrast emergency notice at the top:** "If you are
  experiencing a medical emergency, call 911. This service does not provide medical
  advice or clinical care."
- If you include a request form, it collects **name, employer, contact method, and
  a general service category only** (Imaging / Specialist / Primary care /
  Pharmacy / Other). Do NOT collect diagnoses, symptoms, conditions, or any
  medical detail — add helper text: "Please do not include medical details in this
  form." Include a non-skippable checkbox: "I understand this service provides
  financial and logistical navigation only, not medical advice. If I am
  experiencing a medical emergency, I will call 911."

### 7. Contact
Business contact form only: name, company, role, email, phone, employee count,
whether the plan is self-funded, message. CTA: "Request a data audit."

### 8. Legal pages (static)
- **Terms of service** — non-fiduciary consulting role; no medical advice; data used
  only for the services described; link to privacy policy.
- **Privacy policy** — what's collected (account and business contact data,
  navigation requests), how it's used, HIPAA business-associate status, retention
  and deletion, security measures, privacy contact.
- **HIPAA notice** — PHI handling under BAA, de-identification methods, and that
  individual rights are exercised through the employee's health plan.

Mark these clearly as templates requiring attorney review before launch — add an
HTML comment at the top of each: `<!-- DRAFT — must be reviewed by counsel before publication -->`

## Global requirements

- **Header:** logo, nav (Services, Pricing, Compliance, How it works, Contact), and
  a secondary "Client login" button linking to `app.hosparent.com`.
- **Footer on every page:** "Hosparent LLC is a healthcare cost consulting firm. We
  do not provide medical advice or clinical care. If you are experiencing a medical
  emergency, call 911." Plus plain links: Terms, Privacy, HIPAA notice, Data
  sources, Contact. No social icons, no fake trust badges, no testimonials you
  can't source.
- **Price-data pages** keep the existing sourcing line: "Data: hospital
  machine-readable files required by federal rule 45 CFR 180 · last refreshed
  {date}" and the disclaimer "Prices are published rates and estimates, not a
  guarantee — confirm with the provider."
- Responsive, accessible (real semantic HTML, labeled form fields, visible focus
  states, sufficient contrast).
- Keep the Learn tab — reframe it as a public resource that demonstrates expertise.

When done: list every page you created or changed, and confirm that (a) no page
collects claims files or medical details, (b) the emergency and non-fiduciary
disclaimers appear where specified, and (c) the "Client login" points to the
external portal rather than an in-app upload.
