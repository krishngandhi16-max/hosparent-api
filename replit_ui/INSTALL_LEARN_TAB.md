# Install the Learn tab in the Replit UI (3 edits, ~2 minutes)

The backend already serves everything the page needs (`/learn/how-to-save`,
`/learn/content`, `/learn/insurance-news`, `/learn/rights-navigator`). These
edits add the page + route + header link to the Replit React project. The page
matches the existing theme exactly (navy `#1B3A6B` primary, green `#22C55E`
secondary, Inter, shadcn cards) — nothing else changes.

## 1. Copy the page

Copy `replit_ui/Learn.tsx` from this repo into the Replit project at:

```
src/pages/Learn.tsx
```

## 2. Add the route — `src/App.tsx`

Add the import next to the other page imports:

```tsx
import Learn from '@/pages/Learn';
```

Add the route inside `<Switch>` (before the `NotFound` catch-all):

```tsx
<Route path="/learn" component={Learn} />
```

## 3. Add the header link — `src/components/Header.tsx`

Add `BookOpen` to the lucide import:

```tsx
import { Stethoscope, UserCircle, Briefcase, MonitorDot, BookOpen } from 'lucide-react';
```

Right next to the existing "Agent Office" link, add:

```tsx
<Link href="/learn" className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${useLocation()[0] === '/learn' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
  <BookOpen className="w-4 h-4" /> Learn
</Link>
```

## 4. IMPORTANT — restart the API server on the tunnel machine first

The live server at `live.hosparent.com` is running OLD code — `/learn/content`
currently 404s there. On the machine that runs the Cloudflare tunnel:

```powershell
git pull origin claude/baylor-price-discrepancy-scbllh
node setup_all.js     # creates learn_content/stories/post_queue tables if missing
# restart the server (Ctrl+C the old one, then)
node server.js
```

Verify: `curl https://live.hosparent.com/learn/content` should return
`{"content":[...]}` (empty array is fine — it fills when Indy's research runs).

## What renders when

| Section | Source | Available |
|---|---|---|
| "Get a Lower Price" numbered tips | `/learn/how-to-save` (static) | Immediately after server restart |
| "Researched this week" cards | `/learn/content?category=lower_price` | After first `node run_hoser_daily.js` |
| "Know Your Rights" cards + sources | `/learn/content?category=your_rights` | After first `node run_hoser_daily.js` |
| Rights navigator (ask a question) | `/learn/rights-navigator` (rate-limited) | Immediately |
| Insurance News | `/learn/insurance-news` | After `node refresh_insurance_news.js` |
