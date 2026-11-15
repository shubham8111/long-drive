// The exact set of map tiles a place can ever need, by walking the game's own tile rule (src/tiles.js)
// along the route.
//   play:  what the game asks for while driving (this is what has to be kept / shipped)
//   build: what the bakers read once while building a place (only needed to rebuild it; refetched then)
import { Geo, lon2tx, lat2ty, tx2lon, ty2lat } from '../src/geo.js';
import { Route } from '../src/route.js';
import { MIN_Z, ELEV_MAX_Z, SPLIT, PLAN_LINES, VIEW_RANGE, wantSplit } from '../src/tiles.js';

// how far the terrain's centre can be from the road: 60 m look-ahead streaming, the chase and
// cinematic cameras (<= 14 m), the title-screen orbit (26 m), the road's width, half a sample step
export const MARGIN = 90;
const STEP = 20; // metres between route samples

// lines: the sharpest picture the tiles must serve; split: the mode's split factor
export function planPlay(data, lines = PLAN_LINES, { split = SPLIT } = {}) {
  const geo = new Geo(data.origin.lat, data.origin.lon), route = new Route(data), lat = data.origin.lat;
  const need = { elev: new Set(), img: new Set(), terr: new Set() }; // terr: the terrain tiles z/x/y themselves
  const visit = (z, x, y, cx, cz) => {
    const x0 = geo.x(tx2lon(x, z)), x1 = geo.x(tx2lon(x + 1, z));
    const z0 = geo.z(ty2lat(y, z)), z1 = geo.z(ty2lat(y + 1, z));
    const d = Math.max(0, Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1)) - MARGIN);
    need.terr.add(`${z}/${x}/${y}`);
    const sh = Math.max(0, z - ELEV_MAX_Z);
    need.elev.add(`${Math.min(z, ELEV_MAX_Z)}/${x >> sh}/${y >> sh}`);
    for (let k = 0; k < 4; k++) need.img.add(`${z + 1}/${x * 2 + (k & 1)}/${y * 2 + (k >> 1)}`);
    if (wantSplit(z, x1 - x0, d, Math.min(split, SPLIT), lat, lines)) for (let k = 0; k < 4; k++) visit(z + 1, x * 2 + (k & 1), y * 2 + (k >> 1), cx, cz);
  };
  const P = {};
  for (let s = 0; s <= route.length; s += STEP) {
    route.sample(s, P);
    const rx = Math.floor(lon2tx(geo.lon(P.x), MIN_Z)), ry = Math.floor(lat2ty(geo.lat(P.z), MIN_Z));
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) {
        const x = rx + dx, y = ry + dy;
        const x0 = geo.x(tx2lon(x, MIN_Z)), x1 = geo.x(tx2lon(x + 1, MIN_Z)), z0 = geo.z(ty2lat(y, MIN_Z)), z1 = geo.z(ty2lat(y + 1, MIN_Z));
        if (Math.hypot(Math.max(x0 - P.x, 0, P.x - x1), Math.max(z0 - P.z, 0, P.z - z1)) - MARGIN > VIEW_RANGE * 1.1) continue;
        visit(MIN_Z, x, y, P.x, P.z);
      }
  }
  return need;
}
