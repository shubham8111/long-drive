// Tiny event bus so independent systems (wildlife, traffic, weather, discoveries) can tell the radio
// announcer and the UI what just happened, without knowing about each other.
//   bus.emit('sighting', { what: 'deer', label: 'a mule deer', side: 'left' })
//   bus.on('sighting', (e) => ...)
const handlers = new Map();
export const bus = {
  on(type, fn) { (handlers.get(type) || handlers.set(type, []).get(type)).push(fn); return () => this.off(type, fn); },
  off(type, fn) { const l = handlers.get(type); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
  emit(type, data = {}) { for (const fn of handlers.get(type) || []) { try { fn(data); } catch (e) { console.warn('event handler failed', type, e); } } },
};
