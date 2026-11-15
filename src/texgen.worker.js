// Generates a road's texture pixels off the main thread (see prepareRoadTextures in ground.js).
import { genRoadRaw } from './ground.js';
self.onmessage = (e) => {
  const { id, HALF, style } = e.data;
  const raw = genRoadRaw(HALF, style);
  const bufs = [raw.mc.map, raw.mc.mac, raw.wx.data, raw.mi].filter((a) => a?.buffer).map((a) => a.buffer);
  self.postMessage({ id, raw }, bufs);
};
