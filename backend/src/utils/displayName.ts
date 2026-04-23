/**
 * Formatiert einen Mitarbeiter-Namen gemäß Terminal-displayMode.
 *
 * Modi:
 *   "fullName"              → "Max Mustermann"
 *   "firstNameLastInitial"  → "Max M."
 *   "initialsOnly"          → "M. M."
 *
 * Fällt bei unbekanntem Modus auf "fullName" zurück.
 */
export function formatDisplayName(
  firstName: string,
  lastName: string,
  mode: string = 'fullName',
): string {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();

  switch (mode) {
    case 'initialsOnly':
      return `${f.charAt(0).toUpperCase()}. ${l.charAt(0).toUpperCase()}.`.trim();
    case 'firstNameLastInitial':
      return `${f} ${l.charAt(0).toUpperCase()}.`.trim();
    case 'fullName':
    default:
      return `${f} ${l}`.trim();
  }
}
