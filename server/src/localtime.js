// Dates in your server's time zone (TZ), for "today" and "this week".
export const tz = () => process.env.TZ || 'America/New_York';

/** { ymd: 'YYYY-MM-DD', hm: 'HH:MM' } in your time zone. */
export function local(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

/** The Monday (YYYY-MM-DD) of the week a moment falls in, in your time zone. */
export function weekOf(date = new Date()) {
  const ymd = local(date).ymd;
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Start of the local day `ymd` as a Date (accurate to the hour across DST changes). */
export function startOfLocalDay(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const l = local(noonUtc);
  const offsetMs = Date.parse(`${l.ymd}T${l.hm}:00Z`) - noonUtc.getTime(); // how far local time is ahead of UTC
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - offsetMs);
}

export const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
