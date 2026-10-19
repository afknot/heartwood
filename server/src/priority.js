// Which open follow-ups matter most right now. Three signals, each shown as a reason you can see:
//   - time-bound: a due date (stated, or "by Friday" in the text), overdue or coming up soon
//   - repeated: the same ask showing up in more than one note
//   - your manager: it came out of a conversation with, or is about, someone you report to
// Pure functions (no database) so they're easy to test; followups.js supplies the context.

const DAY = 864e5;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fridayOf = d => { const x = startOfDay(d); const dow = x.getDay(); return addDays(x, dow === 6 ? 6 : dow === 0 ? 5 : 5 - dow); };
const endOfMonth = (y, m) => new Date(y, m + 1, 0);

/** Pick the year that puts month/day on or after the anchor (allowing a month of slack for past dates). */
function inferYear(m, day, anchor) {
  const a = new Date(anchor);
  for (const y of [a.getFullYear(), a.getFullYear() + 1]) {
    const d = new Date(y, m, day);
    if (d.getTime() >= a.getTime() - 30 * DAY) return d;
  }
  return new Date(a.getFullYear() + 1, m, day);
}

function weekdayAfter(anchor, dow, next) {
  const a = startOfDay(anchor);
  let diff = (dow - a.getDay() + 7) % 7 || 7;
  // "next Tuesday" said on a Monday usually means the Tuesday of next week.
  if (next && diff < 7 && a.getDay() !== 0 && dow > a.getDay()) diff += 7;
  return addDays(a, diff);
}

/**
 * Turn "Friday", "by Oct 15", "end of month", "next week", "ASAP" into a date, relative to when
 * it was written (`anchor`). Returns { date, asap } or null when there's no time in it.
 * `strict` (for scanning a follow-up's own text) only accepts phrases that clearly set a deadline.
 */
export function parseDue(input, anchor = new Date(), { strict = false } = {}) {
  const s = ` ${String(input || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ')} `;
  if (!s.trim()) return null;
  const a = new Date(anchor);
  const lead = strict ? '(?:by|before|due|until|no later than|on or before)\\s+(?:the\\s+|this\\s+|end of\\s+)?' : '';

  if (/\b(asap|urgent(ly)?|immediately|right away)\b/.test(s)) return { date: startOfDay(a), asap: true };
  // In a follow-up's own text, "today" is often just narration ("what happened today"), so need "by today".
  const pre = strict ? '(?:by|before|due|until)\\s+' : '';
  if (/\b(eod|end of (the )?day|cob|close of business)\b/.test(s) || new RegExp(`\\b${pre}(today|tonight)\\b`).test(s)) return { date: startOfDay(a) };
  if (new RegExp(`\\b${pre}tomorrow\\b`).test(s)) return { date: addDays(startOfDay(a), 1) };

  let m;
  const re = p => new RegExp(strict ? `\\b${lead}${p}` : `\\b${p}`);
  // 2026-10-15
  if ((m = s.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/))) return { date: new Date(+m[1], +m[2] - 1, +m[3]) };
  // 10/15 or 10/15/26
  if ((m = s.match(re('(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b')))) {
    const mo = +m[1] - 1, d = +m[2];
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) return { date: m[3] ? new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d) : inferYear(mo, d, a) };
  }
  // Oct 15, October 15th, 15 October
  if ((m = s.match(re('(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b')))) {
    return { date: inferYear(MONTHS.indexOf(m[1].slice(0, 3)), +m[2], a) };
  }
  if ((m = s.match(re('(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\b')))) {
    return { date: inferYear(MONTHS.indexOf(m[2]), +m[1], a) };
  }
  // in 3 days / within 2 weeks
  if ((m = s.match(/\b(?:in|within)\s+(\d{1,2}|a|one|two|three)\s+(day|week)s?\b/))) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[m[1]] || +m[1];
    return { date: addDays(startOfDay(a), n * (m[2] === 'week' ? 7 : 1)) };
  }
  if (/\b(end of (the )?week|eow|this week|by the weekend|before the weekend)\b/.test(s)) return { date: fridayOf(a) };
  if (/\bnext week\b/.test(s)) return { date: fridayOf(addDays(a, 7)) };
  if (/\b(end of (the )?month|eom|this month)\b/.test(s)) return { date: endOfMonth(a.getFullYear(), a.getMonth()) };
  if (/\bnext month\b/.test(s)) return { date: endOfMonth(a.getFullYear(), a.getMonth() + 1) };
  if (/\b(end of (the )?quarter|eoq|this quarter)\b/.test(s)) { const q = Math.floor(a.getMonth() / 3); return { date: endOfMonth(a.getFullYear(), q * 3 + 2) }; }
  if ((m = s.match(re('q([1-4])\\b')))) {
    const q = +m[1] - 1; let y = a.getFullYear();
    if (q * 3 + 2 < a.getMonth()) y += 1;
    return { date: endOfMonth(y, q * 3 + 2) };
  }
  // Friday, by Tuesday, next Monday
  if ((m = s.match(re('(next\\s+|this\\s+|on\\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?s?\\b')))) {
    return { date: weekdayAfter(a, WEEKDAYS.indexOf(m[2].slice(0, 3)), /next/.test(m[1] || '')) };
  }
  // by November (start of that month)
  if ((m = s.match(re('(january|february|march|april|june|july|august|september|october|november|december)\\b')))) {
    return { date: inferYear(MONTHS.indexOf(m[1].slice(0, 3)), 1, a) };
  }
  return null;
}

const short = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const weekday = d => d.toLocaleDateString('en-US', { weekday: 'short' });

/** Score and explain one follow-up's timing. */
function timing(f, today) {
  const anchor = f.entry_date || f.created_at || today;
  const parsed = parseDue(f.due, anchor) || parseDue(f.text, anchor, { strict: true });
  if (!parsed) {
    if (!f.due) return null;
    // Unparsed ("before the board meeting"): show it whole if short, else just that there's a deadline.
    const d = String(f.due).trim();
    return { score: 12, reason: { kind: 'due', label: d.length <= 22 ? `Due ${d.replace(/^(by|due)\s+/i, '')}` : 'Has a deadline' } };
  }
  const age = (today - new Date(anchor)) / DAY;
  if (parsed.asap) return age <= 21 ? { score: 40, reason: { kind: 'due', label: 'ASAP', urgent: true } } : { score: 12, reason: { kind: 'due', label: 'Was ASAP' } };
  const days = Math.round((startOfDay(parsed.date) - startOfDay(today)) / DAY);
  const iso = startOfDay(parsed.date).toISOString();
  if (days < 0) {
    const late = -days;
    const label = late === 1 ? 'Was due yesterday' : `Was due ${short(parsed.date)}`;
    return { score: late <= 14 ? 50 : late <= 45 ? 30 : 10, due_at: iso, reason: { kind: 'due', label, urgent: late <= 14 } };
  }
  if (days === 0) return { score: 50, due_at: iso, reason: { kind: 'due', label: 'Due today', urgent: true } };
  if (days === 1) return { score: 45, due_at: iso, reason: { kind: 'due', label: 'Due tomorrow', urgent: true } };
  if (days <= 6) return { score: days <= 3 ? 40 : 30, due_at: iso, reason: { kind: 'due', label: `Due ${weekday(parsed.date)}` } };
  return { score: days <= 30 ? 15 : 6, due_at: iso, reason: { kind: 'due', label: `Due ${short(parsed.date)}` } };
}

// ---------- repeated asks ----------
const STOP = new Set(('about after again also because before being between could doing during every first their there these thing '
  + 'things think those through under until where which while would should other really still maybe going follow check share update '
  + 'meeting meetings email schedule people person someone work team next week weeks month with from that this have make sure send '
  + 'talk about need needs want back into what when will your them they then than just like more some time each over').split(' '));
const stem = w => w.replace(/(ings|ing|ies|ied|ed|es|s)$/, '').slice(0, 7);
export const keySet = text => new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
  .filter(w => w.length >= 4 && !STOP.has(w)).map(stem));

/** Two follow-ups are the same ask if most of the shorter one's key words appear in the other. */
export function sameAsk(a, b) {
  if (a.person_id && b.person_id && a.person_id !== b.person_id) return false;
  const [x, y] = a.keys.size <= b.keys.size ? [a.keys, b.keys] : [b.keys, a.keys];
  if (x.size < 2) return false;
  let shared = 0;
  for (const k of x) if (y.has(k)) shared++;
  return shared >= 2 && shared / x.size >= 0.6;
}

/**
 * Rank open follow-ups. `ctx`:
 *   managers: Map(person_id → name) of people with relationship 'manager'
 *   entryPeople: Map(entry_id → [person_id])
 *   history: [{ id, entry_id, person_id, text }] of all follow-ups (any status) from the last ~6 months, for repeats
 * Repeats of the same ask among the open ones are folded into the newest, with `also` listing the others.
 */
export function prioritize(open, ctx = {}, today = new Date()) {
  const managers = ctx.managers || new Map();
  const entryPeople = ctx.entryPeople || new Map();
  const items = open.map(f => ({ ...f, keys: keySet(f.text) }));
  const hist = (ctx.history || []).map(h => ({ ...h, keys: keySet(h.text) }));

  // Inverted index over key words so matching stays fast with thousands of items.
  const index = new Map();
  hist.forEach((h, i) => { for (const k of h.keys) { if (!index.has(k)) index.set(k, []); index.get(k).push(i); } });
  const asks = f => {
    const seen = new Set(), entries = new Set([f.entry_id || f.id]);
    for (const k of f.keys) for (const i of index.get(k) || []) {
      if (seen.has(i)) continue; seen.add(i);
      if (sameAsk(f, hist[i])) entries.add(hist[i].entry_id || hist[i].id);
    }
    return entries.size;
  };

  // Fold duplicates among the open ones (newest first wins).
  const sorted = [...items].sort((p, q) => String(q.entry_date || q.created_at).localeCompare(String(p.entry_date || p.created_at)));
  const groups = [];
  const byKey = new Map();
  for (const f of sorted) {
    const candidates = new Set();
    for (const k of f.keys) for (const g of byKey.get(k) || []) candidates.add(g);
    const g = [...candidates].find(g => g.lead.mine === f.mine && sameAsk(g.lead, f));
    if (g) { g.also.push(f.id); g.entries.add(f.entry_id || f.id); continue; }
    const ng = { lead: f, also: [], entries: new Set([f.entry_id || f.id]) };
    groups.push(ng);
    for (const k of f.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(ng); }
  }

  const ranked = groups.map(({ lead: f, also, entries }) => {
    const reasons = [];
    let score = 0;
    const t = timing(f, today);
    let dueAt = null;
    if (t) { score += t.score; reasons.push(t.reason); dueAt = t.due_at || null; }

    const times = Math.max(entries.size, hist.length ? asks(f) : 0);
    if (times >= 2) { score += Math.min(36, 14 * (times - 1)); reasons.push({ kind: 'repeat', label: `${f.mine ? 'Asked' : 'Raised'} ${times}×` }); }

    const linked = entryPeople.get(f.entry_id) || [];
    const bossId = (f.person_id && managers.has(f.person_id) && f.person_id) || linked.find(id => managers.has(id));
    const named = !bossId && [...managers].find(([, name]) => name && new RegExp(`\\b${name.split(' ')[0].replace(/[^\p{L}]/gu, '')}\\b`, 'iu').test(f.text));
    const boss = bossId ? managers.get(bossId) : named ? named[1] : null;
    if (boss) {
      score += f.mine ? 32 : 12;
      reasons.push({ kind: 'manager', label: `${boss.split(' ')[0]} · your manager` });
    }

    const age = (today - new Date(f.entry_date || f.created_at || today)) / DAY;
    score += age <= 7 ? 10 : age <= 30 ? 5 : age > 120 ? -5 : 0;

    const priority = score >= 50 ? 'high' : score >= 28 ? 'medium' : 'low';
    const { keys, ...rest } = f;
    return { ...rest, score, priority, reasons, due_at: dueAt, also };
  });
  ranked.sort((p, q) => q.score - p.score || String(q.entry_date || q.created_at).localeCompare(String(p.entry_date || p.created_at)));
  return ranked;
}
