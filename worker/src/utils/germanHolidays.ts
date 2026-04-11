// Deutsche Feiertage Berechnung
// Berechnet Feiertage basierend auf Jahr und Bundesland

// Bundesländer Codes
export type Bundesland =
  | 'BW' // Baden-Württemberg
  | 'BY' // Bayern
  | 'BE' // Berlin
  | 'BB' // Brandenburg
  | 'HB' // Bremen
  | 'HH' // Hamburg
  | 'HE' // Hessen
  | 'MV' // Mecklenburg-Vorpommern
  | 'NI' // Niedersachsen
  | 'NW' // Nordrhein-Westfalen
  | 'RP' // Rheinland-Pfalz
  | 'SL' // Saarland
  | 'SN' // Sachsen
  | 'ST' // Sachsen-Anhalt
  | 'SH' // Schleswig-Holstein
  | 'TH'; // Thüringen

export interface Holiday {
  date: Date;
  name: string;
}

// Berechnet Ostersonntag für ein gegebenes Jahr (Gaußsche Osterformel)
function calculateEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-basiert
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month, day);
}

// Buß- und Bettag: Mittwoch vor dem 23. November
function calculateBussUndBettag(year: number): Date {
  const nov23 = new Date(year, 10, 23); // 23. November
  const dayOfWeek = nov23.getDay();
  // Mittwoch = 3, wir gehen zurück zum vorherigen Mittwoch
  const daysBack = dayOfWeek >= 3 ? dayOfWeek - 3 : dayOfWeek + 4;
  return new Date(year, 10, 23 - daysBack);
}

// Berechnet alle Feiertage für ein Jahr und Bundesland
export function getGermanHolidays(year: number, bundesland: Bundesland): Holiday[] {
  const holidays: Holiday[] = [];
  const easter = calculateEasterSunday(year);

  // Hilfsfunktion: Datum relativ zu Ostern
  const easterOffset = (days: number): Date => {
    const date = new Date(easter);
    date.setDate(easter.getDate() + days);
    return date;
  };

  // ========== BUNDESWEITE FEIERTAGE ==========

  // Neujahr (1. Januar)
  holidays.push({ date: new Date(year, 0, 1), name: 'Neujahr' });

  // Karfreitag (Ostern -2)
  holidays.push({ date: easterOffset(-2), name: 'Karfreitag' });

  // Ostermontag (Ostern +1)
  holidays.push({ date: easterOffset(1), name: 'Ostermontag' });

  // Tag der Arbeit (1. Mai)
  holidays.push({ date: new Date(year, 4, 1), name: 'Tag der Arbeit' });

  // Christi Himmelfahrt (Ostern +39)
  holidays.push({ date: easterOffset(39), name: 'Christi Himmelfahrt' });

  // Pfingstmontag (Ostern +50)
  holidays.push({ date: easterOffset(50), name: 'Pfingstmontag' });

  // Tag der Deutschen Einheit (3. Oktober)
  holidays.push({ date: new Date(year, 9, 3), name: 'Tag der Deutschen Einheit' });

  // 1. Weihnachtstag (25. Dezember)
  holidays.push({ date: new Date(year, 11, 25), name: '1. Weihnachtstag' });

  // 2. Weihnachtstag (26. Dezember)
  holidays.push({ date: new Date(year, 11, 26), name: '2. Weihnachtstag' });

  // ========== REGIONALE FEIERTAGE ==========

  // Heilige Drei Könige (6. Januar) - BW, BY, ST
  if (['BW', 'BY', 'ST'].includes(bundesland)) {
    holidays.push({ date: new Date(year, 0, 6), name: 'Heilige Drei Könige' });
  }

  // Internationaler Frauentag (8. März) - BE
  if (bundesland === 'BE') {
    holidays.push({ date: new Date(year, 2, 8), name: 'Internationaler Frauentag' });
  }

  // Fronleichnam (Ostern +60) - BW, BY, HE, NW, RP, SL
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(bundesland)) {
    holidays.push({ date: easterOffset(60), name: 'Fronleichnam' });
  }

  // Mariä Himmelfahrt (15. August) - BY (überwiegend katholisch), SL
  // Wir nehmen BY und SL, da es in Bayern nur in katholischen Gemeinden gilt
  if (['BY', 'SL'].includes(bundesland)) {
    holidays.push({ date: new Date(year, 7, 15), name: 'Mariä Himmelfahrt' });
  }

  // Weltkindertag (20. September) - TH
  if (bundesland === 'TH') {
    holidays.push({ date: new Date(year, 8, 20), name: 'Weltkindertag' });
  }

  // Reformationstag (31. Oktober) - BB, HB, HH, MV, NI, SN, SH, ST, TH
  if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'SH', 'ST', 'TH'].includes(bundesland)) {
    holidays.push({ date: new Date(year, 9, 31), name: 'Reformationstag' });
  }

  // Allerheiligen (1. November) - BW, BY, NW, RP, SL
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(bundesland)) {
    holidays.push({ date: new Date(year, 10, 1), name: 'Allerheiligen' });
  }

  // Buß- und Bettag - SN (einziges Bundesland)
  if (bundesland === 'SN') {
    holidays.push({ date: calculateBussUndBettag(year), name: 'Buß- und Bettag' });
  }

  // Sortieren nach Datum
  holidays.sort((a, b) => a.date.getTime() - b.date.getTime());

  return holidays;
}

// PLZ zu Bundesland Mapping
// Deutsche PLZ-Bereiche sind nicht perfekt nach Bundesländern aufgeteilt,
// aber diese Zuordnung deckt die meisten Fälle ab
export function getBundeslandFromPLZ(plz: string): Bundesland | null {
  const plzNum = parseInt(plz.replace(/\D/g, '').substring(0, 5), 10);

  if (isNaN(plzNum) || plzNum < 1000 || plzNum > 99999) {
    return null;
  }

  // PLZ-Bereiche nach Bundesland (grobe Zuordnung)
  // Quelle: Deutsche Post PLZ-Verzeichnis

  // 01xxx-09xxx: Sachsen, Sachsen-Anhalt, Thüringen
  if (plzNum >= 1000 && plzNum <= 9999) {
    if (plzNum >= 1000 && plzNum <= 4999) return 'SN'; // Dresden, Leipzig
    if (plzNum >= 6000 && plzNum <= 6999) return 'ST'; // Halle, Dessau
    if (plzNum >= 7000 && plzNum <= 9999) return 'TH'; // Gera, Jena
  }

  // 10xxx-14xxx: Berlin
  if (plzNum >= 10000 && plzNum <= 14199) return 'BE';

  // 14xxx-16xxx: Brandenburg
  if (plzNum >= 14200 && plzNum <= 16999) return 'BB';

  // 17xxx-19xxx: Mecklenburg-Vorpommern
  if (plzNum >= 17000 && plzNum <= 19999) return 'MV';

  // 20xxx-22xxx: Hamburg
  if (plzNum >= 20000 && plzNum <= 22999) return 'HH';

  // 23xxx-25xxx: Schleswig-Holstein
  if (plzNum >= 23000 && plzNum <= 25999) return 'SH';

  // 26xxx-27xxx: Niedersachsen (Oldenburg, Wilhelmshaven)
  if (plzNum >= 26000 && plzNum <= 27999) return 'NI';

  // 28xxx-29xxx: Bremen, Niedersachsen
  if (plzNum >= 28000 && plzNum <= 28999) return 'HB';
  if (plzNum >= 29000 && plzNum <= 29999) return 'NI';

  // 30xxx-38xxx: Niedersachsen (Hannover, Braunschweig, Göttingen)
  if (plzNum >= 30000 && plzNum <= 38999) return 'NI';

  // 39xxx: Sachsen-Anhalt (Magdeburg)
  if (plzNum >= 39000 && plzNum <= 39999) return 'ST';

  // 40xxx-47xxx: Nordrhein-Westfalen (Düsseldorf, Duisburg, Essen)
  if (plzNum >= 40000 && plzNum <= 47999) return 'NW';

  // 48xxx-49xxx: Niedersachsen, Nordrhein-Westfalen (Münster, Osnabrück)
  if (plzNum >= 48000 && plzNum <= 49999) return 'NW'; // Münster ist NW

  // 50xxx-53xxx: Nordrhein-Westfalen (Köln, Bonn)
  if (plzNum >= 50000 && plzNum <= 53999) return 'NW';

  // 54xxx-56xxx: Rheinland-Pfalz (Trier, Koblenz)
  if (plzNum >= 54000 && plzNum <= 56999) return 'RP';

  // 57xxx-59xxx: Nordrhein-Westfalen (Siegen, Hagen, Dortmund)
  if (plzNum >= 57000 && plzNum <= 59999) return 'NW';

  // 60xxx-65xxx: Hessen (Frankfurt, Wiesbaden)
  if (plzNum >= 60000 && plzNum <= 65999) return 'HE';

  // 66xxx: Saarland
  if (plzNum >= 66000 && plzNum <= 66999) return 'SL';

  // 67xxx-69xxx: Rheinland-Pfalz, Baden-Württemberg (Ludwigshafen, Heidelberg, Mannheim)
  if (plzNum >= 67000 && plzNum <= 67999) return 'RP';
  if (plzNum >= 68000 && plzNum <= 69999) return 'BW';

  // 70xxx-76xxx: Baden-Württemberg (Stuttgart, Karlsruhe)
  if (plzNum >= 70000 && plzNum <= 76999) return 'BW';

  // 77xxx-79xxx: Baden-Württemberg (Freiburg, Offenburg)
  if (plzNum >= 77000 && plzNum <= 79999) return 'BW';

  // 80xxx-87xxx: Bayern (München, Augsburg)
  if (plzNum >= 80000 && plzNum <= 87999) return 'BY';

  // 88xxx-89xxx: Baden-Württemberg (Friedrichshafen, Ulm)
  if (plzNum >= 88000 && plzNum <= 89999) return 'BW';

  // 90xxx-96xxx: Bayern (Nürnberg, Würzburg)
  if (plzNum >= 90000 && plzNum <= 96999) return 'BY';

  // 97xxx: Bayern (Würzburg, Schweinfurt)
  if (plzNum >= 97000 && plzNum <= 97999) return 'BY';

  // 98xxx-99xxx: Thüringen (Erfurt, Weimar)
  if (plzNum >= 98000 && plzNum <= 99999) return 'TH';

  return null;
}

// Extrahiert die PLZ aus einer Adresszeile
export function extractPLZFromAddress(address: string): string | null {
  if (!address) return null;

  // Suche nach 5-stelliger Zahl (deutsche PLZ)
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

// Bundesland Namen
export const BUNDESLAND_NAMES: Record<Bundesland, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};
