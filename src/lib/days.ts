/**
 * Calendar days as 'YYYY-MM-DD' strings - the shape task dates travel in.
 *
 * A task is due on a day, not at a moment, so these never go through local
 * time: the arithmetic is done at UTC midnight, where no day is 23 or 25 hours
 * long. Only `today()` asks the browser's clock, because "today" is wherever
 * the person looking is. No `server-only`: the Gantt and the calendar run on it.
 */

export type Day = string;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDay(value: unknown): value is Day {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function toUtc(day: Day): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function fromUtc(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A stored @db.Date (Prisma hands it back at UTC midnight) as a day. */
export function dayOf(date: Date): Day {
  return date.toISOString().slice(0, 10);
}

/** Today where the person is. */
export function today(): Day {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(day: Day, n: number): Day {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** Whole days from `a` to `b`: 0 for the same day, negative when b is earlier. */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. The week here starts on a Monday. */
export function weekdayOf(day: Day): number {
  return (new Date(toUtc(day)).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: Day): Day {
  return addDays(day, -weekdayOf(day));
}

export function startOfMonth(day: Day): Day {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: Day, n: number): Day {
  const d = new Date(toUtc(startOfMonth(day)));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUtc(d.getTime());
}

export function minDay(a: Day, b: Day): Day {
  return a < b ? a : b;
}

export function maxDay(a: Day, b: Day): Day {
  return a > b ? a : b;
}

function format(day: Day, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(toUtc(day)));
}

/** "14 Oct", or "14 Oct 2027" outside the current year. */
export function formatDay(day: Day, now: Day = today()): string {
  return format(day, day.slice(0, 4) === now.slice(0, 4) ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "October 2026". */
export function formatMonth(day: Day): string {
  return format(day, { month: 'long', year: 'numeric' });
}

/** "Mon". */
export function formatWeekday(day: Day): string {
  return format(day, { weekday: 'short' });
}

/** A date range as people say it: "14 Oct", "14 - 18 Oct", "28 Oct - 3 Nov". */
export function formatSpan(start: Day | null, end: Day | null, now: Day = today()): string {
  if (!start && !end) return '';
  if (!start || !end || start === end) return formatDay((start ?? end)!, now);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))} - ${formatDay(end, now)}`;
  return `${formatDay(start, now)} - ${formatDay(end, now)}`;
}
