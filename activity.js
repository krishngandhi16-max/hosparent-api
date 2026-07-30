// activity.js — in-memory live search activity for the Command Center.
// Records every /search call (query, top match, result count) so the office UI
// can animate Chester (the UI courier) and show a live ticker + daily stats.
// Resets on server restart; the ring keeps the last 100 searches.

const MAX_RECENT = 100;
let seq = 0;
let recent = [];
let total = 0;
let day = null;          // 'YYYY-MM-DD'
let dayTotal = 0;
let dayTop = {};         // query -> count (today)
let hourHist = new Array(24).fill(0);

function rollDay(now) {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    dayTotal = 0;
    dayTop = {};
    hourHist = new Array(24).fill(0);
  }
}

function recordSearch(q, rows) {
  const now = new Date();
  rollDay(now);
  const query = String(q || '').trim();
  if (!query) return;
  recent.push({
    id: ++seq,
    q: query,
    label: (rows && rows[0] && rows[0].standard_name) || null,
    results: Array.isArray(rows) ? rows.length : 0,
    at: now.toISOString(),
  });
  if (recent.length > MAX_RECENT) recent = recent.slice(-MAX_RECENT);
  total += 1;
  dayTotal += 1;
  const key = query.toLowerCase();
  dayTop[key] = (dayTop[key] || 0) + 1;
  hourHist[now.getHours()] += 1;
}

function getActivity() {
  rollDay(new Date());
  const top_today = Object.entries(dayTop)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([q, n]) => ({ q, n }));
  let busiest = null, best = 0;
  hourHist.forEach((n, h) => { if (n > best) { best = n; busiest = h; } });
  return {
    recent: recent.slice(-30),
    stats: {
      today: dayTotal,
      total,
      top_today,
      busiest_hour: busiest === null ? null : `${String(busiest).padStart(2, '0')}:00`,
    },
  };
}

module.exports = { recordSearch, getActivity };
