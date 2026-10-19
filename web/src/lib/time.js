// Time zone helpers for people who live and work somewhere else.

export const MY_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();

const COMMON = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico', 'America/Toronto', 'America/Mexico_City',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Singapore',
  'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'
];

/** Common zones first, then everything the browser knows. */
export function zoneOptions() {
  let all = [];
  try { all = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers */ }
  const rest = all.filter(z => !COMMON.includes(z));
  return { common: COMMON, rest };
}

/** "Mountain Time (Denver)" style label. */
export function tzLabel(tz) {
  if (!tz) return '';
  let name = '';
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value || '';
  } catch { /* unsupported option or bad tz */ }
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return name ? `${name} (${city})` : city;
}

export function timeIn(tz, date = new Date()) {
  try { return new Date(date).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

/** Minutes ahead of me (negative = behind). */
function offsetMin(tz, date = new Date()) {
  const at = z => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(date).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  };
  try { return Math.round((at(tz) - at(MY_TZ)) / 60000); } catch { return 0; }
}

export const differentZone = (tz, date) => !!tz && offsetMin(tz, date) !== 0;

/** "2 hours behind you", "5½ hours ahead of you" */
export function relativeZone(tz) {
  const m = offsetMin(tz);
  if (!m) return 'same time as you';
  const h = Math.abs(m) / 60;
  const n = Number.isInteger(h) ? String(h) : h % 1 === 0.5 ? `${Math.floor(h)}½` : h.toFixed(2).replace(/0+$/, '');
  return `${n} hour${h === 1 ? '' : 's'} ${m < 0 ? 'behind' : 'ahead of'} you`;
}

/** One line for a person: "Denver · 1:42 PM there" (or just the city when it's the same time). */
export function whereLine(p) {
  if (!p) return '';
  const bits = [];
  if (p.city) bits.push(p.city);
  if (differentZone(p.tz)) bits.push(`${timeIn(p.tz)} there`);
  return bits.join(' · ');
}

// A few cities, so typing one can fill in the time zone. Not exhaustive; the picker covers the rest.
const CITY_TZ = {
  'new york': 'America/New_York', boston: 'America/New_York', philadelphia: 'America/New_York', trenton: 'America/New_York', newark: 'America/New_York',
  'jersey city': 'America/New_York', princeton: 'America/New_York', baltimore: 'America/New_York', washington: 'America/New_York', 'washington dc': 'America/New_York',
  atlanta: 'America/New_York', miami: 'America/New_York', orlando: 'America/New_York', charlotte: 'America/New_York', raleigh: 'America/New_York',
  pittsburgh: 'America/New_York', detroit: 'America/Detroit', columbus: 'America/New_York', cleveland: 'America/New_York', richmond: 'America/New_York',
  toronto: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  chicago: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', austin: 'America/Chicago', 'san antonio': 'America/Chicago',
  minneapolis: 'America/Chicago', 'st. louis': 'America/Chicago', 'kansas city': 'America/Chicago', nashville: 'America/Chicago', 'new orleans': 'America/Chicago',
  milwaukee: 'America/Chicago', 'mexico city': 'America/Mexico_City',
  denver: 'America/Denver', boulder: 'America/Denver', 'salt lake city': 'America/Denver', albuquerque: 'America/Denver', boise: 'America/Boise',
  phoenix: 'America/Phoenix', tucson: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', oakland: 'America/Los_Angeles', 'san jose': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles', seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', sacramento: 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles',
  vancouver: 'America/Vancouver', anchorage: 'America/Anchorage', honolulu: 'Pacific/Honolulu', 'san juan': 'America/Puerto_Rico',
  london: 'Europe/London', dublin: 'Europe/Dublin', paris: 'Europe/Paris', berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam', madrid: 'Europe/Madrid',
  lisbon: 'Europe/Lisbon', rome: 'Europe/Rome', stockholm: 'Europe/Stockholm', warsaw: 'Europe/Warsaw', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg', cairo: 'Africa/Cairo', dubai: 'Asia/Dubai', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', hyderabad: 'Asia/Kolkata', chennai: 'Asia/Kolkata', pune: 'Asia/Kolkata', manila: 'Asia/Manila',
  singapore: 'Asia/Singapore', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', 'hong kong': 'Asia/Hong_Kong', tokyo: 'Asia/Tokyo', seoul: 'Asia/Seoul',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', auckland: 'Pacific/Auckland'
};

/** Guess a zone from "Denver", "Denver, CO" or "Austin TX". */
export function guessTz(city) {
  const c = String(city || '').toLowerCase().replace(/[,]+.*$/, '').replace(/\s+[a-z]{2}$/, '').trim();
  return CITY_TZ[c] || '';
}
