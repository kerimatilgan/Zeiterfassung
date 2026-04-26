/**
 * Adress-Geocoding via Nominatim (OpenStreetMap).
 * Limit: ~1 req/sec laut Nominatim-Policy. Wir nutzen es selten genug.
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address || !address.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=de`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Zeiterfassung/1.0' } });
    if (!res.ok) return null;
    const data = await res.json() as any[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const hit = data[0];
    const lat = parseFloat(hit.lat);
    const lon = parseFloat(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    return {
      latitude: lat,
      longitude: lon,
      displayName: hit.display_name || address,
    };
  } catch (err) {
    console.error('Geocoding failed for', address, err);
    return null;
  }
}
