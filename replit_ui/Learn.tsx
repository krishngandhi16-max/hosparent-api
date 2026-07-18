// src/pages/Learn.tsx — FREE public Learn tab for the Hosparent Replit UI.
// Drop this file into src/pages/ then follow replit_ui/INSTALL_LEARN_TAB.md
// (adds the route in App.tsx + the header link in Header.tsx).
//
// Answers two consumer questions, exactly as specified:
//   1. "How do I get a lower price?"   -> /learn/how-to-save (static, always live)
//                                          + /learn/content?category=lower_price (Indy-researched)
//   2. "What rules do I fall under?"   -> /learn/content?category=your_rights (Indy-researched)
//                                          + /learn/rights-navigator (ask-a-question, rate-limited)
// Plus the insurance-news feed. No auth anywhere — this is the free awareness layer.

import React, { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { API_BASE } from '@/lib/api';
import {
  BookOpen, ShieldCheck, Newspaper, DollarSign, Loader2, ExternalLink,
  Landmark, Send, AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type LearnEntry = {
  category: 'lower_price' | 'your_rights';
  title: string;
  body: string;
  jurisdiction: string | null;
  sources: { title?: string; url?: string }[] | string;
  updated_at: string;
};
type Tip = { title: string; body: string };
type NewsStory = { headline?: string; title?: string; summary?: string; url?: string; source?: string };

const TABS = [
  { id: 'save', label: 'Get a Lower Price', icon: DollarSign },
  { id: 'rights', label: 'Know Your Rights', icon: ShieldCheck },
  { id: 'news', label: 'Insurance News', icon: Newspaper },
] as const;
type TabId = (typeof TABS)[number]['id'];

function parseSources(s: LearnEntry['sources']): { title?: string; url?: string }[] {
  if (Array.isArray(s)) return s;
  try { const p = JSON.parse(s as string); return Array.isArray(p) ? p : []; } catch { return []; }
}

function EntryCard({ entry }: { entry: LearnEntry }) {
  const sources = parseSources(entry.sources).filter((x) => x && (x.url || x.title));
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-primary text-lg leading-snug">{entry.title}</h3>
        {entry.jurisdiction && (
          <Badge variant="secondary" className="flex-shrink-0 gap-1 text-xs">
            <Landmark className="w-3 h-3" /> {entry.jurisdiction}
          </Badge>
        )}
      </div>
      <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-line">{entry.body}</p>
      {sources.length > 0 && (
        <div className="pt-2 border-t flex flex-wrap gap-x-4 gap-y-1">
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
               className="text-xs text-accent hover:underline inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> {s.title || s.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function TipCard({ tip, idx }: { tip: Tip; idx: number }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-6 flex gap-4">
      <div className="w-8 h-8 rounded-full bg-secondary/10 text-secondary font-black flex items-center justify-center flex-shrink-0">
        {idx + 1}
      </div>
      <div>
        <h3 className="font-bold text-primary mb-1">{tip.title}</h3>
        <p className="text-sm text-foreground/80 leading-relaxed">{tip.body}</p>
      </div>
    </div>
  );
}

function RightsNavigator() {
  const [situation, setSituation] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async () => {
    if (!situation.trim() || busy) return;
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const r = await fetch(`${API_BASE}/learn/rights-navigator`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situation }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Request failed');
      setAnswer(j.answer || j.guidance || JSON.stringify(j));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-primary/[0.03] rounded-2xl border border-primary/10 p-6 mt-8">
      <h3 className="font-bold text-primary text-lg mb-1 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-secondary" /> Ask about your situation
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Describe your billing situation and we&apos;ll explain which rules protect you. Free, limited per day.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder='e.g. "I got a $3,000 bill for an out-of-network anesthesiologist I never chose"'
          className="flex-1 px-4 py-3 rounded-xl border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button onClick={ask} disabled={busy || !situation.trim()} className="rounded-xl px-6">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="ml-2">Ask</span>
        </Button>
      </div>
      {err && (
        <p className="mt-3 text-sm text-destructive flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {err}</p>
      )}
      {answer && (
        <div className="mt-4 bg-white rounded-xl border p-5 text-sm leading-relaxed whitespace-pre-line">{answer}</div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Educational information, not legal advice. Verify with your state insurance department or an attorney.
      </p>
    </div>
  );
}

export default function Learn() {
  // Header needs viewMode props; Learn keeps its own lightweight copy so the
  // patient/provider toggle still renders (it links back to "/" behavior).
  const [viewMode, setViewMode] = useState<'patient' | 'provider' | 'employer'>(
    (sessionStorage.getItem('hosparent_view') as any) || 'patient'
  );
  const [tab, setTab] = useState<TabId>('save');
  const [tips, setTips] = useState<Tip[]>([]);
  const [entries, setEntries] = useState<LearnEntry[]>([]);
  const [news, setNews] = useState<NewsStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tipsR, contentR, newsR] = await Promise.allSettled([
          fetch(`${API_BASE}/learn/how-to-save`).then((r) => r.json()),
          fetch(`${API_BASE}/learn/content`).then((r) => r.json()),
          fetch(`${API_BASE}/learn/insurance-news`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (tipsR.status === 'fulfilled' && Array.isArray(tipsR.value)) setTips(tipsR.value);
        if (contentR.status === 'fulfilled' && Array.isArray(contentR.value?.content)) setEntries(contentR.value.content);
        if (newsR.status === 'fulfilled' && Array.isArray(newsR.value?.stories)) setNews(newsR.value.stories);
        if (tipsR.status === 'rejected' && contentR.status === 'rejected') setOffline(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const lowerPrice = entries.filter((e) => e.category === 'lower_price');
  const rights = entries.filter((e) => e.category === 'your_rights');

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Header viewMode={viewMode} setViewMode={setViewMode} />
      <main className="flex-1 w-full pb-20">
        {/* Hero */}
        <div className="py-14 md:py-20 bg-white border-b">
          <div className="container mx-auto px-4 text-center">
            <Badge variant="secondary" className="mb-4 gap-1.5 px-3 py-1">
              <BookOpen className="w-3.5 h-3.5" /> Free — no sign-up, ever
            </Badge>
            <h1 className="text-3xl md:text-5xl font-black text-primary tracking-tight mb-3">
              Pay less. Know the{' '}
              <span className="text-secondary relative">
                rules
                <svg className="absolute -bottom-2 left-0 w-full h-3 text-secondary/30" viewBox="0 0 100 10" preserveAspectRatio="none">
                  <path d="M0,5 Q50,10 100,5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>{' '}
              on your side.
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
              Proven ways to get a lower price on care, and the federal and state rules that protect
              you from surprise bills — researched daily, with sources.
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 pt-8 max-w-4xl">
          {/* Tabs */}
          <div className="flex bg-muted p-1 rounded-lg border w-fit mx-auto mb-8">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  tab === id ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex flex-col items-center py-16 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
              <p>Loading…</p>
            </div>
          )}

          {!loading && offline && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl p-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold">Could not reach the Learn service</p>
                <p className="text-sm">Check that the Hosparent API is online and refresh.</p>
              </div>
            </div>
          )}

          {!loading && !offline && tab === 'save' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              {tips.map((t, i) => <TipCard key={t.title} tip={t} idx={i} />)}
              {lowerPrice.length > 0 && (
                <>
                  <h2 className="text-lg font-bold text-primary pt-6">Researched this week</h2>
                  {lowerPrice.map((e) => <EntryCard key={e.title} entry={e} />)}
                </>
              )}
            </div>
          )}

          {!loading && !offline && tab === 'rights' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              {rights.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                  Rights research is being compiled — check back soon.
                </p>
              )}
              {rights.map((e) => <EntryCard key={e.title} entry={e} />)}
              <RightsNavigator />
            </div>
          )}

          {!loading && !offline && tab === 'news' && (
            <div className="space-y-4 animate-in fade-in duration-300">
              {news.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No news stories yet — check back soon.</p>
              )}
              {news.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                   className="block bg-white rounded-xl border shadow-sm p-5 hover:border-primary/30 transition-colors">
                  <h3 className="font-bold text-primary">{s.headline || s.title}</h3>
                  {s.summary && <p className="text-sm text-foreground/80 mt-1">{s.summary}</p>}
                  {s.source && <span className="text-xs text-muted-foreground mt-2 inline-block">{s.source}</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
