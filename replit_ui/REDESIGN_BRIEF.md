# Zip Reality (Hosparent UI) — full redesign brief

Paste everything below the line into the Replit Agent as ONE message. It keeps
the existing pages, routes, and API calls — it only replaces the visual layer
with a clean, trustworthy design system. (Claude can also apply this directly
through the Replit connector when it's working.)

---

Redesign this app's entire visual layer. Keep every existing route, page,
data fetch, and piece of functionality exactly as it is — this is a reskin to
a professional, trustworthy healthcare-finance product, not a rebuild.

## Design system (apply globally, no exceptions)

**Typography.** Two fonts only: "Fraunces" (serif, 600/700) for page titles
and section headings; "Public Sans" (400/500/600) for everything else. Load
from Google Fonts. Base size 16px, line-height 1.6. Headings: h1 34px, h2
24px, h3 18px. Prices always render in a tabular-numbers class
(font-variant-numeric: tabular-nums) at 600 weight so columns of dollars align.
No other fonts anywhere. Never use Inter, Roboto, or system-ui as the display
face.

**Color.** Light theme only. Background #FAFAF7 (warm off-white), surfaces
#FFFFFF with a 1px #E7E5DF border and NO drop shadows except a single subtle
shadow on sticky elements. Ink #1C1B18 for text, #6B6960 for secondary text.
Primary (links, buttons, active states): deep teal #0F6B5C. Accent for savings
and positive deltas: #1F7A3D. Warnings (high price, stale data): #A65A00.
Danger only for errors: #B3261E. Kill every gradient, every purple, every
glassmorphism blur, every emoji used as iconography. Icons are Lucide, 16-20px,
stroke 1.75, always paired with a text label.

**Layout.** Max content width 1080px, centered, 24px side padding. Spacing on
an 8px scale only (8/16/24/32/48/64). Cards: 12px radius, 24px padding.
Buttons: 10px radius, 44px tall, primary = solid #0F6B5C white text, secondary
= 1px border, ghost for tertiary. One primary button per view. Tables for
price comparisons — real <table> semantics, sticky header row, zebra-free,
14px, generous 12px cell padding.

**Voice.** Sentence case everywhere (never Title Case buttons, never ALL
CAPS). Microcopy is calm and specific: "Prices from hospital-published files,
updated {date}" not "AI-POWERED SAVINGS!". No exclamation marks anywhere in
the UI.

## Trust layer (this is what makes it not look vibe-coded)

Every price shown carries, in small secondary text: the price type badge
(cash / negotiated / list price — small outlined pill, not colored candy),
the hospital or pharmacy name, and "from the hospital's published price file"
or "from Cost Plus Drugs" as source. Every results view gets one line at the
top: "Data: hospital machine-readable files required by federal rule 45 CFR
180 · last refreshed {date}". Footer on every page: plain links (About, Learn,
Data sources, Contact), a one-line disclaimer "Prices are published rates and
estimates, not a guarantee — confirm with the provider," and no social icons.
Remove any fake trust badges, star ratings, or testimonial-style content that
can't be sourced.

## Page-by-page

**Home.** One job: search. Fraunces headline ("See what healthcare actually
costs"), one-sentence subline, then a single large search input (56px tall,
full width up to 640px) with placeholder "Procedure, CPT code, or drug name".
Under it, 6 quiet suggestion chips (Colonoscopy, MRI brain, Knee replacement,
CBC blood test, Insulin, EKG). Below the fold: three plain cards — "Compare
hospital prices", "Find cheaper drugs", "Know your rights" (links to Learn).
Nothing else. No hero image, no floating shapes, no stats counters.

**Search results.** A comparison table sorted by price ascending: Hospital ·
City · Price type · Price. The cheapest row gets a subtle #1F7A3D left border
and a "lowest listed" pill — no giant green banners. A small explainer
accordion above the table: "Why do prices differ so much?" with two sentences
and a link to Learn. Empty state: honest text ("No published prices for this
search yet — we cover 46 DFW-area hospitals so far") plus the suggestion chips
again.

**Drug results.** Same table pattern: Medication · Strength/form · Pack ·
Seller · Price. Cost Plus rows show "mail order" in secondary text. When a
J-code search returns hospital rows, add one line above: "No retail pharmacy
sells this — these are hospital-administered prices from published files."

**Learn.** Keep the three-tab structure (Get a lower price / Know your rights
/ News). Render entries as a readable article list: Fraunces entry titles,
70ch max text width, sources as a "Sources" list of real links at the end of
each entry, jurisdiction as a small pill. News items show source + date.

**Agent Office page.** Keep it, but restyle to match: same fonts/colors,
agent status as small dot + label (working/idle), tasks in a plain table.
Remove any cartoon/isometric styling that clashes with the consumer pages —
it should look like a status page, not a game.

**Header.** Left: wordmark "Hosparent" in Fraunces 600 (teal), tagline hidden
on mobile. Right: Search, Learn, Office as plain links, active state =
underline + teal, no pill backgrounds. Sticky, white, 1px bottom border.

## Quality bar

Responsive at 360px, 768px, 1080px — tables scroll horizontally inside their
card on mobile, never the page. All interactive elements keyboard-focusable
with a visible 2px teal focus ring. Lighthouse accessibility ≥ 95: real
labels on inputs, aria-sort on sortable columns, color contrast AA. Loading
states are skeleton rows in the table, not spinners. Every fetch error shows
a retry button with honest copy ("Couldn't reach the price server — it may be
restarting. Retry").

Do not add new features, new pages, new dependencies beyond the two Google
Fonts and Lucide (already present). When done, list every file you changed.
