// Helfer für Datums-Range-Filter in Prisma-Queries.
//
// Hintergrund: Frontend schickt häufig YYYY-MM-DD (z.B. aus <input type="date">).
// `new Date("2026-04-30")` parst das als UTC-Mitternacht — in Deutschland (CEST,
// UTC+2) entspricht das 2026-04-30 02:00 LOCAL. Mit `lte` als Range-Ende werden
// dann alle Einträge des letzten Tages (clockIn nach 02:00 lokal) verschluckt.
//
// Lösung: bei YYYY-MM-DD wird `to` inklusiv als "Ende des Tages" behandelt
// (+1 Tag, mit `lt` statt `lte`). Volle ISO-Strings mit Uhrzeit werden 1:1
// durchgereicht.

export interface DateRange {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dateRangeFilter(from?: unknown, to?: unknown): DateRange {
  const range: DateRange = {};

  if (from) {
    range.gte = new Date(String(from));
  }

  if (to) {
    const toStr = String(to);
    if (DATE_ONLY.test(toStr)) {
      // YYYY-MM-DD: als Ende-des-Tages interpretieren → +1 Tag und `lt`
      // (pragmatisch unter der Annahme keine Schichten zwischen Mitternacht
      // und 2 Uhr lokal — entspricht ~99% der Fälle hier).
      const d = new Date(toStr + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      range.lt = d;
    } else {
      range.lte = new Date(toStr);
    }
  }

  return range;
}
