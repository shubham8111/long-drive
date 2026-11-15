// Which terrain tiles exist where: shared by the game (terrain.js) and the build/prune scripts, so the
// tiles kept on disk are exactly the ones the game can ask for.
//
// A terrain tile of zoom z carries elevation of zoom min(z, ELEV_MAX_Z) and imagery of zoom z + 1
// (four 256 px tiles -> one 512 px texture). A tile is split into its four children when the camera
// is closer than SPLIT x its size. Beyond zoom ELEV_MAX_Z the children add no shape (there is no finer
// elevation), only sharper photos, so there they are made only where a screen could show that
// sharpness: where one imagery pixel would cover no more than about 1.5 screen pixels across (the
// soft look blurs anything finer). From the road, the ground is seen at a grazing angle, so in practice
// this only matters for hillsides facing you.
export const MIN_Z = 10, MAX_Z = 17, ELEV_MAX_Z = 15, SPLIT = 1.35;
// The coarsest tiles (zoom MIN_Z) are loaded only within sight: in the clearest weather (fog density
// 0.000032, sky.js WEATHER.clear) less than 8% of the land shows through the haze beyond ~50 km.
export const VIEW_RANGE = 1.6 / 0.000032;
export const FOV = 62; // camera vertical field of view, degrees (main.js)
export const PLAN_LINES = 1080; // the sharpest graphics mode: what is kept on disk must serve it

// metres per pixel of a 256 px imagery tile at zoom zi and latitude lat
export const texel = (zi, lat) => (156543.034 * Math.cos((lat * Math.PI) / 180)) / 2 ** zi;
// how far away imagery of zoom zi can still be told apart from the zoom below, for a picture `lines` tall
export const imageryReach = (zi, lat, lines) => texel(zi, lat) / (1.5 * ((FOV * Math.PI) / 180 / lines));

// should a tile of zoom z (edge `size` m, nearest point `dist` m from the camera) be split?
export function wantSplit(z, size, dist, split, lat, lines) {
  if (z >= MAX_Z || dist >= size * split) return false;
  if (z >= ELEV_MAX_Z) return dist < imageryReach(z + 2, lat, lines); // children would carry imagery z + 2
  return true;
}
