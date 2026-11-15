// Local flat-earth frame around a route origin: +x east, +y up, +z south (metres).
const R = 6378137;
const D2R = Math.PI / 180;

export class Geo {
  constructor(lat0, lon0) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    this.kx = D2R * R * Math.cos(lat0 * D2R);
    this.kz = D2R * R;
  }
  x(lon) { return (lon - this.lon0) * this.kx; }
  z(lat) { return -(lat - this.lat0) * this.kz; }
  lon(x) { return this.lon0 + x / this.kx; }
  lat(z) { return this.lat0 - z / this.kz; }
}

// slippy-map tile maths (fractional tile coordinates)
export const lon2tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2ty = (lat, z) => ((1 - Math.asinh(Math.tan(lat * D2R)) / Math.PI) / 2) * 2 ** z;
export const tx2lon = (x, z) => (x / 2 ** z) * 360 - 180;
export const ty2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / D2R;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
