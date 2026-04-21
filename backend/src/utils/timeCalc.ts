/**
 * Zeitberechnungs-Helfer.
 *
 * Stempelungen behalten in der DB ihre exakte Zeit (inkl. Sekunden) für
 * Audit-Zwecke. Für die Berechnung der Arbeitszeit werden die Sekunden
 * jedoch abgeschnitten — ein MA der um 08:49:22 einstempelt wird so
 * abgerechnet wie 08:49:00.
 */

/** Gibt den Unix-Timestamp (ms) zurück, auf die volle Minute abgeschnitten. */
export const truncateToMinuteMs = (d: Date): number =>
  Math.floor(d.getTime() / 60000) * 60000;

/** Gibt ein neues Date zurück mit Sekunden & ms auf 0 gesetzt. */
export const truncateToMinute = (d: Date): Date => new Date(truncateToMinuteMs(d));

/**
 * Minuten zwischen zwei Zeitpunkten — beide auf volle Minuten abgeschnitten.
 * Negative Werte werden nicht geclampt; Aufrufer entscheidet.
 */
export const minutesBetween = (start: Date, end: Date): number =>
  (truncateToMinuteMs(end) - truncateToMinuteMs(start)) / 60000;

/** Stunden zwischen zwei Zeitpunkten (sekundengenau abgeschnitten). */
export const hoursBetween = (start: Date, end: Date): number =>
  minutesBetween(start, end) / 60;
