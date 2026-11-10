/**
 * Diccionario de telemetría de Percy, con la forma de un objeto de Open MCT:
 * identifier {namespace, key}, name, type (decide qué proveedor responde) y
 * telemetry.values con unidad y hints (domain = eje X, range = eje Y).
 * Ejemplo equivalente en Open MCT: API.md:459-493.
 *
 * Además, cada dato sabe escribirse para el panel: formato() y frase().
 */
const num = (v, decimals) =>
  v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace('-', '−');

const SOL = { key: 'sol', name: 'Sol de la misión', unit: 'sol', hints: { domain: 1 } };

export const DATOS = [
  {
    identifier: { namespace: 'percy', key: 'distancia' },
    name: 'Distancia recorrida',
    type: 'nasa.waypoint',
    telemetry: {
      values: [SOL, { key: 'distancia', source: 'dist_km', name: 'Distancia total', unit: 'km', hints: { range: 1 } }],
    },
    formato: (v) => [[num(v, 2), 'km']],
    frase: ({ value }) =>
      `Ya rodó ${num(value, 1)} km desde que aterrizó${value > 42.195 ? ', más que una maratón,' : ''} y nunca pasa de 0,15 km/h.`,
  },
  {
    identifier: { namespace: 'percy', key: 'altura' },
    name: 'Altura del terreno',
    type: 'nasa.waypoint',
    telemetry: {
      values: [SOL, { key: 'altura', source: 'elev_m', name: 'Altura sobre el nivel cero', unit: 'm', hints: { range: 1 } }],
    },
    formato: (v) => [[num(v, 0), 'm']],
    frase: ({ value, values }) => {
      const delta = value - values[0];
      return `Ya ${delta >= 0 ? 'subió' : 'bajó'} ${num(Math.abs(delta), 0)} m desde el fondo del cráter Jezero. Marte no tiene mar: el cero es una altura promedio.`;
    },
  },
  {
    identifier: { namespace: 'percy', key: 'inclinacion' },
    name: 'Inclinación',
    type: 'nasa.waypoint',
    telemetry: {
      values: [SOL, { key: 'inclinacion', source: 'tilt_deg', name: 'Inclinación del rover', unit: '°', hints: { range: 1 } }],
    },
    formato: (v) => [[num(v, 1), '°']],
    frase: ({ value, values, data }) => {
      let i = 0;
      values.forEach((v, j) => { if (v > values[i]) i = j; });
      return `Quedó inclinado ${num(value, 1)}°. Lo más empinado: ${num(values[i], 1)}° (sol ${data[i].sol}). Una rampa para sillas de ruedas tiene unos 5°.`;
    },
  },
  {
    identifier: { namespace: 'percy', key: 'luz' },
    name: 'Tiempo de luz Tierra → Marte',
    type: 'calculo.luz',
    telemetry: {
      values: [
        SOL,
        { key: 'luz', source: 'light_s', name: 'Tiempo de luz', unit: 's', hints: { range: 1 } },
        { key: 'km', name: 'Distancia Tierra–Marte', unit: 'km' },
      ],
    },
    formato: (v) => {
      const t = Math.round(v * 10) / 10; // redondear antes de partir, para no mostrar «60,0 s»
      const min = Math.floor(t / 60);
      return [[String(min), 'min'], [num(t - min * 60, 1), 's']];
    },
    detalle: (datum) => `a ${Math.round(datum.km).toLocaleString('es-ES')} km`,
    frase: ({ value }) => {
      const t = Math.round(value);
      const min = Math.floor(t / 60);
      const s = t % 60;
      return `Una orden enviada ahora tarda ${min} min ${s} s en llegar. Por eso Percy no se conduce con mando: recibe un plan cada día.`;
    },
  },
];
