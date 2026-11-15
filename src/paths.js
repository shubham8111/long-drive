// Where the game's files live. In development everything comes from the local Vite server (which also
// keeps the map tiles cached on disk, data/tiles). The static build for GitHub Pages (VITE_STATIC=1,
// see .github/workflows/pages.yml) is served from a sub-path and has no server: map tiles then come
// straight from their open sources, which allow it (CORS), and the announcer uses the browser's voice.
export const BASE = import.meta.env?.BASE_URL ?? '/';
export const STATIC = import.meta.env?.VITE_STATIC === '1';
export const asset = (p) => BASE + p.replace(/^\//, '');
export function tileUrl(kind, z, x, y) {
  if (!STATIC) return `${BASE}tiles/${kind}/${z}/${x}/${y}.${kind === 'elev' ? 'png' : 'jpg'}`;
  return kind === 'elev'
    ? `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}
