import { lightSeconds, earthMarsKm, solAt, msAtSol } from './orbits.js';

export const WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';

/**
 * Proveedor «NASA · historial de manejos».
 * Lee el GeoJSON público del mapa MMGIS de Mars 2020 (permite CORS) una sola vez
 * y responde por los datos de tipo 'nasa.waypoint'.
 * Solo usa los puntos final === 'y' (fin de cada manejo): los puntos de mitad
 * de manejo traen dist_total_m = 0 y romperían la gráfica.
 */
export function nasaWaypointsProvider(url = WAYPOINTS_URL) {
  let loading = null;
  const load = () => {
    loading ??= fetch(url, { signal: AbortSignal.timeout(30_000) })
      .then((r) => {
        if (!r.ok) throw new Error(`la NASA respondió HTTP ${r.status}`);
        return r.json();
      })
      .then((geo) =>
        geo.features
          .map((f) => f.properties)
          .filter((p) => p.final === 'y')
          .map((p) => ({ sol: p.sol, dist_km: p.dist_total_m / 1000, elev_m: p.elev_geoid, tilt_deg: p.tilt })),
      )
      .catch((err) => {
        loading = null; // permite reintentar
        throw err;
      });
    return loading;
  };

  return {
    name: 'NASA · historial de manejos',
    source: url,
    supportsRequest: (obj) => obj.type === 'nasa.waypoint',
    request: () => load(),
  };
}

/**
 * Proveedor «Cálculo en vivo»: tiempo de luz Tierra–Marte.
 * request() da un punto por sol desde el aterrizaje hasta hoy;
 * subscribe() manda el valor de este instante cada segundo.
 */
export function lightTimeProvider() {
  const datumAt = (ms) => ({ sol: solAt(ms), light_s: lightSeconds(ms), km: earthMarsKm(ms) });
  const supports = (obj) => obj.type === 'calculo.luz';
  return {
    name: 'Cálculo en vivo · órbitas JPL',
    source: 'Elementos orbitales aproximados de JPL (Standish), calculados en tu navegador',
    supportsRequest: supports,
    async request() {
      const now = Date.now();
      const out = [];
      for (let sol = 0; sol < Math.floor(solAt(now)); sol++) out.push(datumAt(msAtSol(sol + 0.5)));
      out.push(datumAt(now));
      return out;
    },
    supportsSubscribe: supports,
    subscribe(obj, callback) {
      const tick = () => callback(datumAt(Date.now()));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    },
  };
}
