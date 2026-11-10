/**
 * Mini centralita de telemetría con el patrón de Open MCT.
 *
 * - Cada dato es un objeto con su metadata: nombre, unidad y qué valor va en
 *   cada eje (hints.domain = eje X, hints.range = eje Y).
 * - Los proveedores dicen qué datos saben dar (supportsRequest / supportsSubscribe).
 * - Las vistas nunca hablan con el proveedor: piden el historial con request()
 *   y lo nuevo con subscribe() a esta centralita.
 *
 * Equivalentes en Open MCT (commit e09bfaf):
 *   addProvider → src/api/telemetry/TelemetryAPI.js:167
 *   request     → src/api/telemetry/TelemetryAPI.js:470
 *   subscribe   → src/api/telemetry/TelemetryAPI.js:529
 *   source = source || key → src/api/telemetry/TelemetryMetadataManager.js:26
 */
export class TelemetryAPI {
  #providers = [];

  /** El último proveedor registrado tiene prioridad, como en Open MCT. */
  addProvider(provider) {
    this.#providers.unshift(provider);
  }

  #find(capability, obj) {
    return this.#providers.find((p) => p[capability]?.(obj));
  }

  /** Proveedor que responde por este dato (para mostrar de dónde viene). */
  providerOf(obj) {
    return this.#find('supportsRequest', obj) ?? this.#find('supportsSubscribe', obj) ?? null;
  }

  /** Historial: una promesa con la lista de datums, del más antiguo al más nuevo. */
  async request(obj, options = {}) {
    const provider = this.#find('supportsRequest', obj);
    if (!provider) throw new Error(`Ningún proveedor sabe dar «${obj.name}»`);
    return provider.request(obj, options);
  }

  /** En vivo: llama a callback con cada datum nuevo. Devuelve la función para darse de baja. */
  subscribe(obj, callback) {
    const provider = this.#find('supportsSubscribe', obj);
    return provider ? provider.subscribe(obj, callback) : () => {};
  }

  /** Metadata del dato: qué valor es el eje X (domain) y cuál el eje Y (range). */
  getMetadata(obj) {
    const values = obj.telemetry.values.map((v) => ({ ...v, source: v.source || v.key }));
    return {
      values,
      domain: values.find((v) => v.hints?.domain),
      range: values.find((v) => v.hints?.range),
    };
  }
}
