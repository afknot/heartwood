// A small, dependency-free iCalendar reader for meeting invites.
// Handles what Outlook, Google and Apple actually send: TZID with Windows or IANA zone names, UTC and
// floating times, all-day events, RRULE (daily / weekly with BYDAY / monthly by day or nth weekday /
// yearly, INTERVAL, COUNT, UNTIL), EXDATE, RECURRENCE-ID overrides and STATUS:CANCELLED.
// Occurrences are expanded in wall-clock time in the event's zone, so daylight saving is right.

const DEFAULT_TZ = () => process.env.TZ || 'America/New_York';

// Windows time zone names (what Exchange/Outlook put in TZID) → IANA.
const WINDOWS_TZ = {
  'Eastern Standard Time': 'America/New_York', 'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns', 'SA Western Standard Time': 'America/Puerto_Rico',
  'Central Standard Time (Mexico)': 'America/Mexico_City', 'Canada Central Standard Time': 'America/Regina',
  'E. South America Standard Time': 'America/Sao_Paulo', 'Argentina Standard Time': 'America/Buenos_Aires', 'SA Pacific Standard Time': 'America/Bogota',
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest', 'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem', 'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos', 'E. Africa Standard Time': 'Africa/Nairobi', 'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh', 'Iran Standard Time': 'Asia/Tehran', 'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Kolkata',
  'Nepal Standard Time': 'Asia/Kathmandu', 'Bangladesh Standard Time': 'Asia/Dhaka', 'SE Asia Standard Time': 'Asia/Bangkok',
  'Singapore Standard Time': 'Asia/Singapore', 'China Standard Time': 'Asia/Shanghai', 'Taipei Standard Time': 'Asia/Taipei',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'W. Australia Standard Time': 'Australia/Perth',
  'AUS Central Standard Time': 'Australia/Darwin', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'New Zealand Standard Time': 'Pacific/Auckland', 'Philippines Standard Time': 'Asia/Manila'
};

const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

/** TZID → IANA zone. Falls back to the VTIMEZONE's standard offset, then the server's zone. */
export function resolveTz(tzid, vtimezones = {}) {
  if (!tzid) return null;
  const t = String(tzid).replace(/^"|"$/g, '').trim();
  if (WINDOWS_TZ[t]) return WINDOWS_TZ[t];
  if (validTz(t)) return t;
  const tail = t.match(/[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?/)?.[0]; // "/mozilla.org/20050126_1/America/New_York"
  if (tail && validTz(tail)) return tail;
  const vt = vtimezones[t];
  if (vt) {
    // Pick a well-known zone with the same standard / daylight offsets (good enough for US & Europe).
    const std = vt.standard, dst = vt.daylight;
    const guess = { '-0500/-0400': 'America/New_York', '-0600/-0500': 'America/Chicago', '-0700/-0600': 'America/Denver', '-0700/': 'America/Phoenix',
      '-0800/-0700': 'America/Los_Angeles', '+0000/+0100': 'Europe/London', '+0100/+0200': 'Europe/Berlin', '+0200/+0300': 'Europe/Athens', '+0530/': 'Asia/Kolkata' }[`${std}/${dst || ''}`];
    if (guess) return guess;
  }
  return DEFAULT_TZ();
}

// ---------- wall clock ↔ UTC ----------
const pad = n => String(n).padStart(2, '0');
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi, s = 0] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const offsetAt = t => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}
export function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${pad(+p.hour % 24)}:${p.minute}:${p.second}` };
}

// ---------- calendar-date arithmetic (YYYY-MM-DD, no zones) ----------
const toDays = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const fromDays = n => new Date(n * 864e5).toISOString().slice(0, 10);
const weekday = ymd => new Date(toDays(ymd) * 864e5).getUTCDay(); // 0 = Sunday
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---------- parsing ----------
const unescape = v => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":value   (colons inside quoted params are allowed)
  let i = 0, inQ = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ':' && !inQ) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [head];
  const params = {};
  for (const p of parts.slice(1)) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: parts[0].toUpperCase(), params, value };
}

/** Split into components: [{ type, props: [{name, params, value}], children: [...] }] */
function parseComponents(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(l => l.length);
  const root = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const raw of lines) {
    const l = parseLine(raw);
    if (l.name === 'BEGIN') { const c = { type: l.value.toUpperCase(), props: [], children: [] }; stack.at(-1).children.push(c); stack.push(c); }
    else if (l.name === 'END') { if (stack.length > 1) stack.pop(); }
    else stack.at(-1).props.push(l);
  }
  return root;
}
const first = (c, name) => c.props.find(p => p.name === name);
const all = (c, name) => c.props.filter(p => p.name === name);

/** A DTSTART-like property → { ymd, hm, tz, allDay } in wall-clock terms, or null. */
function readTime(p, tzs, fallbackTz) {
  if (!p) return null;
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const ymd = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || p.params.VALUE === 'DATE') return { ymd, hm: '00:00:00', tz: fallbackTz, allDay: true };
  const hm = `${m[4]}:${m[5]}:${m[6] || '00'}`;
  if (m[7]) return { ymd, hm, tz: 'UTC', allDay: false };
  return { ymd, hm, tz: resolveTz(p.params.TZID, tzs) || fallbackTz, allDay: false };
}
const instant = t => (t.allDay ? zonedToUtc(t.ymd, '00:00:00', t.tz) : zonedToUtc(t.ymd, t.hm, t.tz));
/** The same moment expressed in another zone's wall clock. */
function inZone(t, tz) {
  if (t.allDay || t.tz === tz) return { ...t, tz };
  const lp = localParts(instant(t), tz);
  return { ymd: lp.ymd, hm: lp.hm, tz, allDay: false };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = (((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60e3 + +(m[6] || 0) * 1e3;
  return m[1] === '-' ? -ms : ms;
}

function readRule(v) {
  const r = Object.fromEntries(String(v).split(';').map(kv => kv.split('=')).filter(x => x.length === 2).map(([k, x]) => [k.toUpperCase(), x]));
  return {
    freq: (r.FREQ || '').toUpperCase(),
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : null,
    until: r.UNTIL || null,
    byday: r.BYDAY ? r.BYDAY.split(',').map(x => { const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim()); return m ? { n: m[1] ? Number(m[1]) : null, wd: WD[m[2].toUpperCase()] } : null; }).filter(Boolean) : [],
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : [],
    bymonth: r.BYMONTH ? r.BYMONTH.split(',').map(Number) : [],
    bysetpos: r.BYSETPOS ? Number(r.BYSETPOS) : null,
    wkst: WD[(r.WKST || 'MO').toUpperCase()] ?? 1
  };
}

/** nth weekday of a month: n=1..5 or -1..-5 → day of month, or null. */
function nthWeekday(y, m, wd, n) {
  const dim = daysInMonth(y, m);
  const firstWd = weekday(`${y}-${pad(m)}-01`);
  const days = [];
  for (let d = 1 + ((wd - firstWd + 7) % 7); d <= dim; d += 7) days.push(d);
  const d = n > 0 ? days[n - 1] : days[days.length + n];
  return d ?? null;
}

/** Recurrence dates (local YYYY-MM-DD in the event's zone), in order, up to `toYmd`. */
function expandDates(rule, startYmd, toYmd, untilYmd) {
  const out = [];
  const limit = rule.count || 5000;
  const stop = untilYmd && untilYmd < toYmd ? untilYmd : toYmd;
  const push = d => { if (d >= startYmd && d <= stop) out.push(d); };
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  let guard = 0;
  if (rule.freq === 'DAILY') {
    for (let d = toDays(startYmd); fromDays(d) <= stop && out.length < limit && guard++ < 5000; d += rule.interval) {
      const ymd = fromDays(d);
      if (rule.byday.length && !rule.byday.some(b => b.wd === weekday(ymd))) continue;
      push(ymd);
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byday.length ? rule.byday.map(b => b.wd) : [weekday(startYmd)];
    const ws = toDays(startYmd) - ((weekday(startYmd) - rule.wkst + 7) % 7); // start of the first week
    for (let w = ws; fromDays(w) <= stop && out.length < limit && guard++ < 3000; w += 7 * rule.interval) {
      const week = days.map(wd => fromDays(w + ((wd - rule.wkst + 7) % 7))).sort();
      for (const ymd of week) { if (out.length >= limit) break; push(ymd); }
    }
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    const step = rule.freq === 'MONTHLY' ? rule.interval : 12 * rule.interval;
    for (let i = 0; out.length < limit && guard++ < 1200; i += step) {
      const y = sy + Math.floor((sm - 1 + i) / 12), m = ((sm - 1 + i) % 12) + 1;
      if (`${y}-${pad(m)}-01` > stop) break;
      if (rule.freq === 'YEARLY' && rule.bymonth.length && !rule.bymonth.includes(m)) continue;
      let cands = [];
      if (rule.byday.length) {
        for (const b of rule.byday) {
          if (b.n) { const d = nthWeekday(y, m, b.wd, b.n); if (d) cands.push(d); }
          else for (let n = 1; n <= 5; n++) { const d = nthWeekday(y, m, b.wd, n); if (d) cands.push(d); }
        }
        cands.sort((a, b) => a - b);
        if (rule.bysetpos) cands = [cands[rule.bysetpos > 0 ? rule.bysetpos - 1 : cands.length + rule.bysetpos]].filter(Boolean);
      } else if (rule.bymonthday.length) {
        cands = rule.bymonthday.map(d => (d < 0 ? daysInMonth(y, m) + 1 + d : d)).filter(d => d >= 1 && d <= daysInMonth(y, m));
      } else if (sd <= daysInMonth(y, m)) cands = [sd];
      for (const d of cands) { if (out.length >= limit) break; push(`${y}-${pad(m)}-${pad(d)}`); }
    }
  } else {
    push(startYmd);
  }
  return out;
}

function attendeesOf(c, exclude) {
  return all(c, 'ATTENDEE').map(a => ({ email: a.value.replace(/^mailto:/i, '').trim().toLowerCase(), name: (a.params.CN || '').trim() }))
    .filter(a => (a.email || a.name) && !exclude.includes(a.email)).slice(0, 50);
}

export const cleanTitle = t => String(t || '').replace(/^\s*((fw|fwd|re|accepted|updated|tentative)\s*:\s*)+/i, '').trim() || '(no title)';

/**
 * Expand every event in an iCalendar text into occurrences overlapping [from, to].
 * Returns [{ key, uid, title, start, end, all_day, location, attendees }] sorted by start.
 */
export function expandIcs(text, { from, to, exclude = [] } = {}) {
  const root = parseComponents(text);
  const cal = root.children.find(c => c.type === 'VCALENDAR') || root;
  const fallbackTz = resolveTz(first(cal, 'X-WR-TIMEZONE')?.value) || DEFAULT_TZ();
  const tzs = {};
  for (const vt of cal.children.filter(c => c.type === 'VTIMEZONE')) {
    const id = first(vt, 'TZID')?.value;
    if (!id) continue;
    const off = type => first(vt.children.find(c => c.type === type) || { props: [] }, 'TZOFFSETTO')?.value || '';
    tzs[id] = { standard: off('STANDARD'), daylight: off('DAYLIGHT') };
  }
  const events = cal.children.filter(c => c.type === 'VEVENT');
  // Group by UID: the series (no RECURRENCE-ID) plus changed occurrences.
  const byUid = new Map();
  for (const e of events) {
    const uid = first(e, 'UID')?.value;
    if (!uid) continue;
    if (!byUid.has(uid)) byUid.set(uid, { master: null, overrides: [] });
    const g = byUid.get(uid);
    if (first(e, 'RECURRENCE-ID')) g.overrides.push(e); else g.master = e;
  }

  const out = [];
  const fromMs = from.getTime(), toMs = to.getTime();
  const emit = (c, uid, startT, durMs) => {
    if (String(first(c, 'STATUS')?.value || '').toUpperCase() === 'CANCELLED') return;
    const s = instant(startT);
    const e = new Date(s.getTime() + Math.max(0, durMs));
    if (e.getTime() < fromMs || s.getTime() > toMs) return;
    out.push({
      key: `${uid}|${s.toISOString()}`,
      uid,
      title: cleanTitle(unescape(first(c, 'SUMMARY')?.value || '')).slice(0, 300),
      start: s.toISOString(),
      end: e.toISOString(),
      all_day: startT.allDay,
      location: unescape(first(c, 'LOCATION')?.value || '').slice(0, 300),
      attendees: attendeesOf(c, exclude)
    });
  };
  const durationOf = (c, startT) => {
    const endT = readTime(first(c, 'DTEND'), tzs, startT.tz);
    if (endT) return instant(endT) - instant(startT);
    const d = parseDuration(first(c, 'DURATION')?.value);
    return d ?? (startT.allDay ? 864e5 : 30 * 60e3);
  };

  for (const [uid, g] of byUid) {
    const m = g.master;
    // Changed occurrences, keyed by the original local date in the series' zone.
    const startT = m ? readTime(first(m, 'DTSTART'), tzs, fallbackTz) : null;
    const zone = startT?.tz || fallbackTz;
    const overrides = new Map();
    for (const o of g.overrides) {
      const rid = readTime(first(o, 'RECURRENCE-ID'), tzs, zone);
      if (rid) overrides.set(inZone(rid, zone).ymd, o);
    }
    if (m && startT) {
      const dur = durationOf(m, startT);
      const rruleP = first(m, 'RRULE');
      if (!rruleP) {
        emit(m, uid, startT, dur);
      } else {
        const rule = readRule(rruleP.value);
        let untilYmd = null;
        if (rule.until) { const u = readTime({ value: rule.until, params: {} }, tzs, zone); if (u) untilYmd = inZone(u.tz === 'UTC' ? u : { ...u, tz: zone }, zone).ymd; }
        const ex = new Set();
        for (const p of all(m, 'EXDATE')) for (const v of p.value.split(',')) { const t = readTime({ value: v, params: p.params }, tzs, zone); if (t) ex.add(inZone(t, zone).ymd); }
        const toYmd = localParts(new Date(toMs + 864e5), zone).ymd;
        const dates = expandDates(rule, startT.ymd, toYmd, untilYmd);
        for (const ymd of dates) {
          if (ex.has(ymd)) continue;
          const o = overrides.get(ymd);
          if (o) {
            overrides.delete(ymd);
            const os = readTime(first(o, 'DTSTART'), tzs, zone);
            if (os) emit(o, uid, os, durationOf(o, os));
            continue;
          }
          emit(m, uid, { ...startT, ymd }, dur);
        }
      }
    }
    // Overrides with no series to attach to (or outside its rule): show as they are.
    for (const o of overrides.values()) {
      const os = readTime(first(o, 'DTSTART'), tzs, zone);
      if (os) emit(o, uid, os, durationOf(o, os));
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
