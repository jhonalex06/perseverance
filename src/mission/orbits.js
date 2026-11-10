/**
 * Reloj de Marte y distancia Tierra–Marte, calculados en el navegador.
 *
 * Órbitas: elementos keplerianos aproximados de E. M. Standish (JPL),
 * «Keplerian Elements for Approximate Positions of the Major Planets»,
 * tabla válida 1800–2050. Error en distancia muy por debajo del 1 %.
 * Comprobado: el día del aterrizaje da 11 min 22 s de luz (cifra de la NASA)
 * y la oposición del 12-ene-2025 da 96,1 millones de km.
 *
 * Soles: fórmula Mars24 (NASA GISS) para la fecha solar marciana, con la
 * longitud de Jezero. El sol 0 es el día del aterrizaje (18-feb-2021).
 */
const DEG = Math.PI / 180;
const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const JEZERO_LON_E = 77.45;
const TT_MINUS_UTC_S = 69.184;
const MARS_DAY_IN_EARTH_DAYS = 1.0274912517;
export const LANDING_MS = Date.parse('2021-02-18T20:55:00Z');

// [a, a/siglo, e, e/siglo, I, I/siglo, L, L/siglo, ϖ, ϖ/siglo, Ω, Ω/siglo] (UA y grados)
const ELEMENTS = {
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0],
  mars: [1.52371034, 0.00001847, 0.0933941, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
};

const julianDayUTC = (ms) => ms / 864e5 + 2440587.5;

function heliocentric(planet, ms) {
  const T = (julianDayUTC(ms) - 2451545) / 36525; // siglos desde J2000
  const k = ELEMENTS[planet];
  const a = k[0] + k[1] * T;
  const e = k[2] + k[3] * T;
  const I = (k[4] + k[5] * T) * DEG;
  const L = k[6] + k[7] * T;
  const varpi = k[8] + k[9] * T;
  const node = (k[10] + k[11] * T) * DEG;
  const M = ((((L - varpi) % 360) + 540) % 360 - 180) * DEG;
  const w = varpi * DEG - node;

  let E = M + e * Math.sin(M); // ecuación de Kepler por Newton
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));

  const x1 = a * (Math.cos(E) - e);
  const y1 = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(I), si = Math.sin(I);
  return [
    (cw * cn - sw * sn * ci) * x1 + (-sw * cn - cw * sn * ci) * y1,
    (cw * sn + sw * cn * ci) * x1 + (-sw * sn + cw * cn * ci) * y1,
    sw * si * x1 + cw * si * y1,
  ];
}

/** Distancia Tierra–Marte en km en el instante ms. */
export function earthMarsKm(ms) {
  const t = heliocentric('earth', ms);
  const m = heliocentric('mars', ms);
  return Math.hypot(m[0] - t[0], m[1] - t[1], m[2] - t[2]) * AU_KM;
}

/** Segundos que tarda la luz (y una orden por radio) en ir de la Tierra a Marte. */
export const lightSeconds = (ms) => earthMarsKm(ms) / C_KM_S;

// Fecha solar marciana local en Jezero (días marcianos, con decimales)
const marsDayNumber = (ms) =>
  (julianDayUTC(ms) + TT_MINUS_UTC_S / 86400 - 2405522.0028779) / MARS_DAY_IN_EARTH_DAYS + JEZERO_LON_E / 360;
const SOL0 = Math.floor(marsDayNumber(LANDING_MS));

/** Sol de la misión con decimales (sol 13,5 = mediodía del sol 13). */
export const solAt = (ms) => marsDayNumber(ms) - SOL0;

/** Instante (ms) en que transcurre el sol indicado. */
export const msAtSol = (sol) =>
  ((sol + SOL0 - JEZERO_LON_E / 360) * MARS_DAY_IN_EARTH_DAYS + 2405522.0028779 - TT_MINUS_UTC_S / 86400 - 2440587.5) * 864e5;

/** Hora solar media en Jezero, en horas marcianas (0–24). */
export const jezeroHour = (ms) => (marsDayNumber(ms) % 1) * 24;
