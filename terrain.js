/* terrain.js — pure data, math, and geometry for the world.
   Expanded world: mesas, badlands terraces, deep canyons, ravines,
   cave sinkholes (with cave-mouth geometry), natural stone arches,
   hoodoos, cliff overhangs (cliffhangers), floating rocks, boulders,
   and per-vertex stone-blending so grass and stone textures mix. */
(function () {
'use strict';
var GTF = window.GTF = window.GTF || {};

/* ============================================================ MATH */
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

function hash2(x, y, s) {
  var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
function noise(x, y, s) {
  var xi = Math.floor(x), yi = Math.floor(y);
  var xf = x - xi, yf = y - yi;
  var u = xf * xf * (3 - 2 * xf);
  var v = yf * yf * (3 - 2 * yf);
  var a = hash2(xi, yi, s),     b = hash2(xi + 1, yi, s);
  var c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, s, oct) {
  var sum = 0, amp = 1, freq = 1, total = 0;
  for (var i = 0; i < oct; i++) {
    sum += amp * noise(x * freq, y * freq, s + i * 997);
    total += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / total;
}

GTF.clamp = clamp;
GTF.lerp = lerp;
GTF.smoothstep = smoothstep;
GTF.hash2 = hash2;
GTF.noise = noise;
GTF.fbm = fbm;

/* ============================================================ CONFIG */
var SEED = 1337;
var CHUNK = 16;
var CHUNK_RES = 20;
var VIEW_RADIUS = 4;
var UV_SCALE = 0.4;
var SEA_LEVEL = 0;

GTF.SEED = SEED;
GTF.CHUNK = CHUNK;
GTF.CHUNK_RES = CHUNK_RES;
GTF.VIEW_RADIUS = VIEW_RADIUS;
GTF.UV_SCALE = UV_SCALE;
GTF.SEA_LEVEL = SEA_LEVEL;

/* ============================================================ CAVE SYSTEM */
/* Caves are a grid of sinkholes carved into the terrain.
   Each 12-unit grid cell may host one cave. The sinkhole is what makes
   the cave visible — a deep pit with rock rim, stalactites and
   stalagmites spawned as separate geometry. */
var CAVE_GRID = 12;
var _caveCache = new Map();

function getCaveInfo(gx, gz) {
  var key = gx * 131071 + gz;
  var info = _caveCache.get(key);
  if (info !== undefined) return info;

  var r = hash2(gx, gz, SEED + 12100);
  if (r < 0.62) { _caveCache.set(key, null); return null; }   /* 38% of cells host a cave */

  /* reject caves too close to origin so spawn area is safe */
  var cx = Math.round(gx * CAVE_GRID + CAVE_GRID * 0.5 + (hash2(gx, gz, 12101) - 0.5) * 6);
  var cz = Math.round(gz * CAVE_GRID + CAVE_GRID * 0.5 + (hash2(gx, gz, 12102) - 0.5) * 6);
  if (cx * cx + cz * cz < 40 * 40) { _caveCache.set(key, null); return null; }

  var radius = 2.4 + hash2(gx, gz, 12103) * 1.8;
  var depth  = 4.5 + hash2(gx, gz, 12104) * 3.5;
  info = { x: cx, z: cz, r: radius, d: depth, gx: gx, gz: gz };
  _caveCache.set(key, info);
  if (_caveCache.size > 40000) _caveCache.clear();
  return info;
}

function caveCarveAt(x, z) {
  var gx = Math.floor(x / CAVE_GRID), gz = Math.floor(z / CAVE_GRID);
  var info = getCaveInfo(gx, gz);
  if (!info) return 0;
  var dx = x - info.x, dz = z - info.z;
  var dist2 = dx * dx + dz * dz;
  var r2 = info.r * info.r;
  if (dist2 > r2) return 0;
  var t = 1 - Math.sqrt(dist2) / info.r;
  /* steep-sided sinkhole: most of the depth appears in the inner 60% */
  var shape = smoothstep(0, 0.62, t);
  return shape * info.d;
}

/* ============================================================ TERRAIN
   Layers (bottom to top of stack):
     - continents (very slow)
     - rolling hills
     - mountain ridges (ridged noise)
     - mesas: flat-topped buttes with sheer sides (Monument Valley)
     - badlands: terraced stepped cliffs
     - deep canyons and narrow ravines
     - cave sinkholes (pit carved by caveCarveAt)
     - detail noise
*/
function baseHeight(x, z) {
  var d = Math.sqrt(x * x + z * z);
  var spawnBoost = Math.max(0, 1 - d / 50) * 3.0;

  /* Continents */
  var cont = fbm(x * 0.006, z * 0.006, SEED, 4);
  var land = (cont - 0.34) * 30 + 1.5 + spawnBoost;

  /* Mountains (ridged) */
  var r = fbm(x * 0.011, z * 0.011, SEED + 555, 3);
  var ridged = 1 - Math.abs(r * 2 - 1);
  ridged = ridged * ridged;
  var mountainAmp = Math.max(0, (cont - 0.48) * 5);
  var mountain = ridged * 22 * mountainAmp;

  /* ---- Mesas: flat-topped plateaus with abrupt vertical edges ---- */
  var mesaN = fbm(x * 0.013, z * 0.013, SEED + 3333, 3);
  var mesa = 0;
  if (mesaN > 0.575) {
    /* very tight threshold window = near-vertical walls */
    var mt = smoothstep(0.575, 0.615, mesaN);
    mesa = mt * 11.5;
    /* faint terracing on the top surface */
    var cap = fbm(x * 0.09, z * 0.09, SEED + 3334, 2);
    mesa += Math.floor(cap * 3) * 0.35 * mt;
  }

  /* ---- Badlands: stacked, terrace-like cliffs ---- */
  var badN = fbm(x * 0.021, z * 0.021, SEED + 4444, 3);
  var badlands = 0;
  if (badN > 0.60) {
    var bt = smoothstep(0.60, 0.68, badN);
    var steps = 7;
    var sn = fbm(x * 0.048, z * 0.048, SEED + 4445, 2) * steps;
    var stepIdx = Math.floor(sn);
    var stepFrac = sn - stepIdx;
    /* steep staircase: flat treads with sharp risers */
    var sharp = stepFrac < 0.78 ? 0 : (stepFrac - 0.78) / 0.22;
    badlands = (stepIdx + sharp) * 0.85 * bt;
  }

  /* ---- Deep canyons (wide V profiles) ---- */
  var canyonN = fbm(x * 0.022, z * 0.022, SEED + 5555, 3);
  var distToLine = Math.abs(canyonN - 0.5);
  var canyonCut = 0;
  if (distToLine < 0.032) {
    var cn = (1 - distToLine / 0.032);
    canyonCut = cn * cn * cn * 13.0;
    canyonCut *= smoothstep(0.1, 0.5, land);
  }

  /* ---- Ravines (narrow, deeper gorges) ---- */
  var ravineN = fbm(x * 0.017, z * 0.017, SEED + 6666, 3);
  var ravineDist = Math.abs(ravineN - 0.42);
  var ravineCut = 0;
  if (ravineDist < 0.017) {
    var rn = (1 - ravineDist / 0.017);
    ravineCut = rn * rn * 9.0;
    ravineCut *= smoothstep(0.1, 0.55, land);
  }

  /* ---- Cave sinkholes ---- */
  var caveCut = caveCarveAt(x, z);

  /* Hills & fine detail */
  var hill   = (fbm(x * 0.038, z * 0.038, SEED + 777, 3) - 0.5) * 3.5;
  var detail = (fbm(x * 0.13,  z * 0.13,  SEED + 999, 2) - 0.5) * 1.0;

  return land + mountain + mesa + badlands + hill + detail
       - canyonCut - ravineCut - caveCut;
}

var _hcache = new Map();
function heightAt(x, z) {
  var kx = Math.round(x * 4), kz = Math.round(z * 4);
  var key = (kx + 200000) * 400001 + (kz + 200000);
  var v = _hcache.get(key);
  if (v !== undefined) return v;
  v = baseHeight(x, z);
  if (_hcache.size > 400000) _hcache.clear();
  _hcache.set(key, v);
  return v;
}
function normalAt(x, z) {
  var e = 0.35;
  var hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  var hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  var dx = (hr - hl) / (2 * e);
  var dz = (hu - hd) / (2 * e);
  var nx = -dx, ny = 1, nz = -dz;
  var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}
function climateAt(x, z) {
  return {
    temp:  fbm(x * 0.007, z * 0.007, SEED + 1111, 3),
    moist: fbm(x * 0.010, z * 0.010, SEED + 2222, 3)
  };
}
function colorAt(x, z, h) {
  var c = climateAt(x, z);
  var tint = 0.92 + 0.16 * hash2(Math.floor(x * 3), Math.floor(z * 3), 777);
  var r, g, b;
  if (h < -1.5) { r = 0.32; g = 0.30; b = 0.24; }
  else if (h < 0.6) {
    var t = smoothstep(-1.5, 0.6, h);
    r = lerp(0.42, 1.02, t); g = lerp(0.38, 0.90, t); b = lerp(0.28, 0.60, t);
  } else if (h < 3) {
    var t2 = smoothstep(0.6, 3, h);
    r = lerp(1.02, 0.86, t2); g = lerp(0.90, 1.00, t2); b = lerp(0.60, 0.68, t2);
  } else if (h < 8) {
    r = 0.82; g = 1.00; b = 0.68;
    if (c.temp > 0.56 && c.moist < 0.44) {
      r = lerp(r, 1.18, 0.8); g = lerp(g, 1.05, 0.8); b = lerp(b, 0.72, 0.8);
    } else if (c.moist > 0.58) {
      r = lerp(r, 0.48, 0.6); g = lerp(g, 0.78, 0.6); b = lerp(b, 0.42, 0.6);
    }
  } else if (h < 13) {
    var t3 = smoothstep(8, 13, h);
    r = lerp(0.82, 0.72, t3); g = lerp(1.00, 0.72, t3); b = lerp(0.68, 0.80, t3);
  } else {
    var t4 = smoothstep(13, 17, h);
    r = lerp(0.72, 1.0, t4); g = lerp(0.72, 1.0, t4); b = lerp(0.80, 1.0, t4);
  }

  /* Mesa tint — reddish sandstone */
  var mesaN = fbm(x * 0.013, z * 0.013, SEED + 3333, 3);
  var mesaT = smoothstep(0.56, 0.62, mesaN) * smoothstep(1, 5, h);
  if (mesaT > 0.05) {
    r = lerp(r, 0.92, mesaT); g = lerp(g, 0.55, mesaT); b = lerp(b, 0.36, mesaT);
  }

  /* Badlands banded strata */
  var badN = fbm(x * 0.021, z * 0.021, SEED + 4444, 3);
  var badT = smoothstep(0.60, 0.68, badN) * smoothstep(1, 4, h);
  if (badT > 0.05) {
    var band = Math.abs(Math.floor(h / 1.4)) % 3;
    var br = [0.82, 0.62, 0.90][band];
    var bg = [0.55, 0.44, 0.72][band];
    var bb = [0.38, 0.32, 0.56][band];
    r = lerp(r, br, badT); g = lerp(g, bg, badT); b = lerp(b, bb, badT);
  }

  /* Cave interior darkens toward the pit floor */
  var cave = caveCarveAt(x, z);
  if (cave > 0.6) {
    var caveT = smoothstep(0.6, 4.0, cave);
    r = lerp(r, 0.16, caveT); g = lerp(g, 0.13, caveT); b = lerp(b, 0.12, caveT);
  }

  return [r * tint, g * tint, b * tint];
}

/* Per-vertex "stone-ness": 0 = grass/soil, 1 = solid rock.
   Used by graphics.js to blend grass.png and stone.png on the terrain. */
function stoneAmountFromNormal(x, z, h, n) {
  /* steep faces are stone */
  var slope = 1 - n[1];
  var steep = smoothstep(0.22, 0.55, slope);
  /* high altitude treeline */
  var high  = smoothstep(10, 14, h);
  /* badlands terraces */
  var badN  = fbm(x * 0.021, z * 0.021, SEED + 4444, 3);
  var bad   = smoothstep(0.60, 0.68, badN) * smoothstep(2, 5, h);
  /* mesa walls & tops */
  var mesaN = fbm(x * 0.013, z * 0.013, SEED + 3333, 3);
  var mesa  = smoothstep(0.56, 0.62, mesaN);
  /* cave interior */
  var cave  = smoothstep(0.4, 2.5, caveCarveAt(x, z));
  var amt = Math.max(steep, high, bad, mesa, cave);
  return clamp(amt, 0, 1);
}
function stoneAmountAt(x, z) {
  var h = heightAt(x, z);
  var n = normalAt(x, z);
  return stoneAmountFromNormal(x, z, h, n);
}

/* Ground type for particle colors */
function groundTypeAt(x, z) {
  var h = heightAt(x, z);
  if (h < SEA_LEVEL) return 'water';
  if (h < 1) return 'sand';
  if (h < 8) {
    var c = climateAt(x, z);
    if (c.temp > 0.56 && c.moist < 0.44) return 'sand';
    if (c.moist > 0.58) return 'forest';
    return 'grass';
  }
  if (h < 13) return 'stone';
  return 'snow';
}

GTF.baseHeight = baseHeight;
GTF.heightAt = heightAt;
GTF.normalAt = normalAt;
GTF.climateAt = climateAt;
GTF.colorAt = colorAt;
GTF.stoneAmountAt = stoneAmountAt;
GTF.stoneAmountFromNormal = stoneAmountFromNormal;
GTF.groundTypeAt = groundTypeAt;
GTF.getCaveInfo = getCaveInfo;
GTF.CAVE_GRID = CAVE_GRID;

/* ============================================================ FEATURE TESTS */
function hasTreeAt(x, z) {
  var h = heightAt(x, z);
  if (h < 2.2 || h > 12) return false;
  /* no trees inside a cave pit */
  if (caveCarveAt(x, z) > 1.0) return false;
  var c = climateAt(x, z);
  if (c.moist < 0.50) return false;
  var density = smoothstep(0.50, 0.72, c.moist) * 0.55;
  return hash2(Math.floor(x), Math.floor(z), SEED + 4242) < density;
}
function hasItemAt(x, z) {
  var h = heightAt(x, z);
  if (h < 1.5 || h > 12) return false;
  if (caveCarveAt(x, z) > 1.0) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 8888) > 0.982;
}
function itemTypeAt(x, z) {
  var r = hash2(Math.floor(x), Math.floor(z), SEED + 7777);
  return r < 0.55 ? 'coin' : r < 0.78 ? 'potion' : r < 0.94 ? 'gem' : 'chest';
}
function hasCrystalAt(x, z) {
  var h = heightAt(x, z);
  if (h < 11) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6100) > 0.955;
}
function hasSpireAt(x, z) {
  var h = heightAt(x, z);
  if (h < 8 || h > 15) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6200) > 0.965;
}
function hasMushroomAt(x, z) {
  var h = heightAt(x, z);
  if (h < 2 || h > 8) return false;
  var c = climateAt(x, z);
  if (c.moist < 0.55 || c.temp < 0.45) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6300) > 0.982;
}
function hasFlowerAt(x, z) {
  var h = heightAt(x, z);
  if (h < 1.5 || h > 6) return false;
  if (caveCarveAt(x, z) > 0.5) return false;
  var c = climateAt(x, z);
  if (c.temp > 0.56 && c.moist < 0.44) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6400) > 0.92;
}
function hasRockAt(x, z) {
  var h = heightAt(x, z);
  if (h < 6 || h > 15) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6500) > 0.97;
}

/* ---- new feature tests ---- */

/* Natural stone arch — rare, standalone, needs flat-ish ground. */
function hasArchAt(x, z) {
  var h = heightAt(x, z);
  if (h < 4 || h > 14) return false;
  if (caveCarveAt(x, z) > 0.5) return false;
  var n = normalAt(x, z);
  if (n[1] < 0.85) return false;   /* must sit on reasonably flat ground */
  return hash2(Math.floor(x), Math.floor(z), SEED + 7200) > 0.9965;
}

/* Hoodoo — thin rock pillar with a cap. Prefers dry, high, rocky terrain. */
function hasHoodooAt(x, z) {
  var h = heightAt(x, z);
  if (h < 6 || h > 16) return false;
  var c = climateAt(x, z);
  if (c.moist > 0.55) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 7300) > 0.993;
}

/* Boulder — chunky rock cluster, prefers rocky biomes. */
function hasBoulderAt(x, z) {
  var h = heightAt(x, z);
  if (h < 2 || h > 15) return false;
  var stone = stoneAmountAt(x, z);
  if (stone < 0.35) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 7400) > 0.980;
}

/* Cliffhanger — overhanging rock slab near a steep drop. */
function hasCliffhangerAt(x, z) {
  var h = heightAt(x, z);
  if (h < 5) return false;
  /* check local steepness */
  var e = 1.6;
  var hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  var hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  var gx = (hr - hl) / (2 * e);
  var gz = (hu - hd) / (2 * e);
  var grad = Math.sqrt(gx * gx + gz * gz);
  if (grad < 1.4) return false;   /* need a real cliff nearby */
  return hash2(Math.floor(x), Math.floor(z), SEED + 7500) > 0.988;
}

/* Floating rock — decorative boulder drifting above the terrain. */
function hasFloatingRockAt(x, z) {
  var h = heightAt(x, z);
  if (h < 6 || h > 16) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 7600) > 0.994;
}

GTF.hasTreeAt = hasTreeAt;
GTF.hasItemAt = hasItemAt;
GTF.itemTypeAt = itemTypeAt;
GTF.hasCrystalAt = hasCrystalAt;
GTF.hasSpireAt = hasSpireAt;
GTF.hasMushroomAt = hasMushroomAt;
GTF.hasFlowerAt = hasFlowerAt;
GTF.hasRockAt = hasRockAt;
GTF.hasArchAt = hasArchAt;
GTF.hasHoodooAt = hasHoodooAt;
GTF.hasBoulderAt = hasBoulderAt;
GTF.hasCliffhangerAt = hasCliffhangerAt;
GTF.hasFloatingRockAt = hasFloatingRockAt;

/* ============================================================ GEOMETRY ACCUM */
function GeoAccum() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
GeoAccum.prototype.box = function (x0, y0, z0, x1, y1, z1, r, g, b) {
  var p = this.pos, n = this.nor, u = this.uv, c = this.col, ix = this.idx;
  function quad(ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx, dy, dz, nx, ny, nz) {
    var base = p.length / 3;
    p.push(ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx, dy, dz);
    for (var i = 0; i < 4; i++) n.push(nx, ny, nz);
    u.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (var j = 0; j < 4; j++) c.push(r, g, b);
    ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0);
  quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0);
  quad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, 0, 0, -1);
  quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1);
  quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0);
  quad(x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0);
};
/* Rounded-ish boulder: three overlapping boxes with slightly different sizes. */
GeoAccum.prototype.boulder = function (cx, cy, cz, size, r, g, b) {
  var s = size;
  this.box(cx - s, cy, cz - s, cx + s, cy + s * 1.1, cz + s, r * 0.85, g * 0.85, b * 0.85);
  this.box(cx - s * 0.8, cy + s * 0.9, cz - s * 0.8, cx + s * 0.8, cy + s * 1.55, cz + s * 0.8, r * 0.92, g * 0.92, b * 0.92);
  this.box(cx - s * 0.5, cy + s * 1.4, cz - s * 0.5, cx + s * 0.5, cy + s * 1.85, cz + s * 0.5, r, g, b);
};
GeoAccum.prototype.toGeometry = function () {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(this.nor, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(this.uv, 2));
  g.setAttribute('color',    new THREE.Float32BufferAttribute(this.col, 3));
  g.setIndex(this.idx);
  g.computeBoundingSphere();
  return g;
};
GTF.GeoAccum = GeoAccum;

/* ============================================================ FEATURE SPAWNERS */
function spawnTree(trunks, leaves, x, z) {
  var h = heightAt(x, z);
  var c = climateAt(x, z);
  var isPine  = c.temp  < 0.42;
  var isBirch = !isPine && c.temp > 0.55 && c.moist > 0.65;
  var barkR = 0.9, barkG = 0.72, barkB = 0.52;
  if (isBirch) { barkR = 1.0; barkG = 0.98; barkB = 0.92; }
  var leafR = 0.72, leafG = 1.02, leafB = 0.66;
  if (isPine)  { leafR = 0.50; leafG = 0.80; leafB = 0.50; }
  if (c.moist > 0.75) { leafR *= 0.85; leafG *= 0.95; leafB *= 0.82; }
  var cx = x, cz = z;
  if (isPine) {
    trunks.box(cx - 0.09, h, cz - 0.09, cx + 0.09, h + 2.4, cz + 0.09, barkR * 0.9, barkG * 0.75, barkB * 0.6);
    leaves.box(cx - 0.55, h + 2.0, cz - 0.55, cx + 0.55, h + 3.1, cz + 0.55, leafR * 0.75, leafG * 0.9, leafB * 0.7);
    leaves.box(cx - 0.42, h + 2.9, cz - 0.42, cx + 0.42, h + 3.9, cz + 0.42, leafR * 0.85, leafG, leafB * 0.8);
    leaves.box(cx - 0.26, h + 3.7, cz - 0.26, cx + 0.26, h + 4.7, cz + 0.26, leafR, leafG * 1.1, leafB * 0.9);
    leaves.box(cx - 0.10, h + 4.5, cz - 0.10, cx + 0.10, h + 5.2, cz + 0.10, leafR * 1.1, leafG * 1.2, leafB);
  } else if (isBirch) {
    trunks.box(cx - 0.07, h, cz - 0.07, cx + 0.07, h + 2.6, cz + 0.07, barkR, barkG, barkB);
    leaves.box(cx - 0.42, h + 2.3, cz - 0.42, cx + 0.42, h + 3.3, cz + 0.42, leafR * 1.1, leafG * 1.25, leafB * 0.95);
    leaves.box(cx - 0.26, h + 3.1, cz - 0.26, cx + 0.26, h + 4.0, cz + 0.26, leafR * 1.2, leafG * 1.35, leafB);
  } else {
    trunks.box(cx - 0.11, h, cz - 0.11, cx + 0.11, h + 1.8, cz + 0.11, barkR, barkG * 0.85, barkB * 0.7);
    leaves.box(cx - 0.55, h + 1.6, cz - 0.55, cx + 0.55, h + 2.7, cz + 0.55, leafR, leafG * 1.05, leafB * 0.85);
    leaves.box(cx - 0.42, h + 2.6, cz - 0.42, cx + 0.42, h + 3.5, cz + 0.42, leafR * 1.05, leafG * 1.15, leafB * 0.9);
    leaves.box(cx - 0.22, h + 3.4, cz - 0.22, cx + 0.22, h + 4.1, cz + 0.22, leafR * 1.15, leafG * 1.25, leafB);
  }
}
function spawnCrystal(acc, x, z) {
  var h = heightAt(x, z);
  var hueR = hash2(Math.floor(x), Math.floor(z), 7101);
  var cr, cg, cb;
  if (hueR < 0.33) { cr = 0.5; cg = 1.2; cb = 1.4; }
  else if (hueR < 0.66) { cr = 1.3; cg = 0.6; cb = 1.4; }
  else { cr = 0.7; cg = 1.3; cb = 0.7; }
  var shards = 3 + Math.floor(hash2(Math.floor(x), Math.floor(z), 7102) * 3);
  for (var i = 0; i < shards; i++) {
    var ox = (hash2(Math.floor(x * 10 + i), Math.floor(z * 10), 7103) - 0.5) * 0.7;
    var oz = (hash2(Math.floor(x * 10), Math.floor(z * 10 + i), 7104) - 0.5) * 0.7;
    var sh = 0.4 + hash2(i, 1, 7105) * 1.0;
    var sw = 0.06 + hash2(i, 2, 7105) * 0.09;
    acc.box(x + ox - sw, h, z + oz - sw, x + ox + sw, h + sh, z + oz + sw, cr, cg, cb);
  }
}
function spawnSpire(acc, x, z) {
  var h = heightAt(x, z);
  var height = 1.5 + hash2(Math.floor(x), Math.floor(z), 8101) * 3.5;
  var width = 0.25 + hash2(Math.floor(x), Math.floor(z), 8102) * 0.25;
  var segs = 4;
  for (var i = 0; i < segs; i++) {
    var t = i / segs;
    var w = width * (1 - t * 0.7);
    var y0 = h + (height * i / segs);
    var y1 = h + (height * (i + 1) / segs);
    var tint = 0.72 + t * 0.15;
    acc.box(x - w, y0, z - w, x + w, y1, z + w, tint, tint, tint * 1.05);
  }
}
function spawnMushroom(accStalk, accCap, x, z) {
  var h = heightAt(x, z);
  var height = 1.4 + hash2(Math.floor(x), Math.floor(z), 9101) * 1.0;
  var capW = 0.45 + hash2(Math.floor(x), Math.floor(z), 9102) * 0.25;
  accStalk.box(x - 0.10, h, z - 0.10, x + 0.10, h + height, z + 0.10, 1.2, 1.1, 0.95);
  accCap.box(x - capW, h + height - 0.1, z - capW, x + capW, h + height + 0.35, z + capW, 1.3, 0.4, 0.4);
  var spots = 3;
  for (var i = 0; i < spots; i++) {
    var ang = (i / spots) * Math.PI * 2 + 0.5;
    var sx = x + Math.cos(ang) * capW * 0.5;
    var sz = z + Math.sin(ang) * capW * 0.5;
    accCap.box(sx - 0.06, h + height + 0.34, sz - 0.06, sx + 0.06, h + height + 0.42, sz + 0.06, 1.4, 1.4, 1.2);
  }
}
function spawnFlower(acc, x, z) {
  var h = heightAt(x, z);
  var fr = hash2(Math.floor(x * 3), Math.floor(z * 3), 10101);
  var r, g, b;
  if (fr < 0.33) { r = 1.3; g = 0.5; b = 0.7; }
  else if (fr < 0.66) { r = 1.3; g = 1.1; b = 0.4; }
  else { r = 0.75; g = 0.75; b = 1.35; }
  acc.box(x - 0.025, h, z - 0.025, x + 0.025, h + 0.30, z + 0.025, 0.5, 0.95, 0.4);
  acc.box(x - 0.09, h + 0.28, z - 0.09, x + 0.09, h + 0.42, z + 0.09, r, g, b);
}
function spawnRock(acc, x, z) {
  var h = heightAt(x, z);
  var w1 = 0.25 + hash2(Math.floor(x), Math.floor(z), 11101) * 0.30;
  var w2 = 0.15 + hash2(Math.floor(x), Math.floor(z), 11102) * 0.20;
  acc.box(x - w1, h, z - w1, x + w1, h + 0.30, z + w1, 0.8, 0.8, 0.85);
  acc.box(x - w2, h, z - w2 * 0.8, x + w2, h + 0.55, z + w2, 0.7, 0.7, 0.78);
}

/* ---- new spawners ---- */

/* Natural stone arch: two legs plus an arced lintel. */
function spawnArch(acc, x, z) {
  var h = heightAt(x, z);
  var scale = 0.9 + hash2(Math.floor(x), Math.floor(z), 7700) * 0.7;
  var span  = 3.4 * scale;   /* distance between legs */
  var legW  = 0.55 * scale;
  var height = 3.2 * scale;
  var thick = 0.55 * scale;

  /* sandstone tint */
  var r = 0.86, g = 0.66, b = 0.46;
  /* legs */
  acc.box(x - span * 0.5 - legW, h, z - legW, x - span * 0.5 + legW, h + height, z + legW, r * 0.85, g * 0.85, b * 0.85);
  acc.box(x + span * 0.5 - legW, h, z - legW, x + span * 0.5 + legW, h + height, z + legW, r * 0.85, g * 0.85, b * 0.85);

  /* arced top — build a shallow arc from six segments */
  var segs = 6;
  for (var i = 0; i < segs; i++) {
    var t0 = i / segs;
    var t1 = (i + 1) / segs;
    var segX0 = x - span * 0.5 + span * t0;
    var segX1 = x - span * 0.5 + span * t1;
    var midT = (t0 + t1) * 0.5;
    /* arc height peaks in the middle, ~0.9*scale above the legs */
    var arcY = Math.sin(midT * Math.PI) * 0.9 * scale;
    var segThick = thick * (0.7 + 0.4 * Math.abs(Math.sin(midT * Math.PI)));
    acc.box(
      Math.min(segX0, segX1) - legW * 0.8, h + height + arcY - segThick,
      z - segThick,
      Math.max(segX0, segX1) + legW * 0.8, h + height + arcY + segThick,
      z + segThick,
      r, g, b
    );
  }
  /* little capstone highlight on top */
  acc.box(x - 0.5 * scale, h + height + 1.0 * scale, z - 0.35 * scale,
          x + 0.5 * scale, h + height + 1.35 * scale, z + 0.35 * scale, r * 1.05, g * 1.05, b * 1.05);
}

/* Hoodoo: tapered column with a protective cap rock. */
function spawnHoodoo(acc, x, z) {
  var h = heightAt(x, z);
  var height = 3.2 + hash2(Math.floor(x), Math.floor(z), 7400) * 3.2;
  var wBase  = 0.42;
  var wNeck  = 0.16;
  var segs = 5;
  var rBase = 0.88, gBase = 0.74, bBase = 0.56;
  for (var i = 0; i < segs; i++) {
    var t0 = i / segs;
    var t1 = (i + 1) / segs;
    var wA = lerp(wBase, wNeck, t0);
    var wB = lerp(wBase, wNeck, t1);
    var w = (wA + wB) * 0.5;
    var y0 = h + height * t0;
    var y1 = h + height * t1;
    var shade = 1.0 - t0 * 0.15;
    acc.box(x - w, y0, z - w, x + w, y1, z + w, rBase * shade, gBase * shade, bBase * shade);
  }
  /* cap rock */
  var capW = 0.5 + hash2(Math.floor(x), Math.floor(z), 7401) * 0.15;
  acc.box(x - capW, h + height, z - capW, x + capW, h + height + 0.45, z + capW,
          rBase * 0.72, gBase * 0.72, bBase * 0.72);
}

/* Cave mouth: ring of rock around the sinkhole rim plus stalactites
   hanging down and stalagmites rising from the pit floor. */
function spawnCaveMouth(accStal, accRock, cave) {
  var x = cave.x, z = cave.z, r = cave.r;
  var hCenter = heightAt(x, z);   /* pit floor */

  /* Rock rim — small blocks around the lip of the pit */
  var ringSegs = 10;
  for (var i = 0; i < ringSegs; i++) {
    var a = (i / ringSegs) * Math.PI * 2;
    var rx = x + Math.cos(a) * r * 0.92;
    var rz = z + Math.sin(a) * r * 0.92;
    var rh = heightAt(rx, rz);
    var w = 0.35 + hash2(i, cave.gx, 7501) * 0.25;
    var hh = 0.30 + hash2(i, cave.gz, 7502) * 0.35;
    accRock.box(rx - w, rh - 0.15, rz - w, rx + w, rh + hh, rz + w, 0.55, 0.48, 0.42);
  }

  /* A dark interior wall — a ring of tall rock reaching up from the pit
     floor so the inside of the cave reads as enclosed. */
  var wallSegs = 8;
  for (var i = 0; i < wallSegs; i++) {
    var a = (i / wallSegs) * Math.PI * 2;
    var rx = x + Math.cos(a) * r * 0.78;
    var rz = z + Math.sin(a) * r * 0.78;
    var lipH = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    var top = lipH - 0.1;
    accRock.box(rx - 0.35, hCenter - 0.3, rz - 0.35, rx + 0.35, top, rz + 0.35, 0.20, 0.16, 0.14);
  }

  /* Stalactites hanging from the rim */
  var nStal = 6 + ((hash2(cave.gx, cave.gz, 7503) * 4) | 0);
  for (var i = 0; i < nStal; i++) {
    var a = (i / nStal) * Math.PI * 2 + 0.7;
    var rr = r * (0.55 + hash2(i, 1, 7504) * 0.25);
    var sx = x + Math.cos(a) * rr;
    var sz = z + Math.sin(a) * rr;
    var topY = heightAt(sx, sz) - 0.4;
    var len = 0.5 + hash2(i, 2, 7505) * 0.8;
    var w = 0.07 + hash2(i, 3, 7506) * 0.05;
    accStal.box(sx - w, topY - len, sz - w, sx + w, topY, sz + w, 0.72, 0.66, 0.60);
    /* pointed tip */
    accStal.box(sx - w * 0.4, topY - len - 0.15, sz - w * 0.4, sx + w * 0.4, topY - len, sz + w * 0.4, 0.62, 0.56, 0.50);
  }

  /* Stalagmites rising from the pit floor */
  var nStag = 5 + ((hash2(cave.gx, cave.gz, 7507) * 4) | 0);
  for (var i = 0; i < nStag; i++) {
    var a = (i / nStag) * Math.PI * 2 + 1.3;
    var rr = r * hash2(i, 4, 7508) * 0.55;
    var sx = x + Math.cos(a) * rr;
    var sz = z + Math.sin(a) * rr;
    var by = heightAt(sx, sz) - 0.1;
    var len = 0.35 + hash2(i, 5, 7509) * 0.6;
    var w = 0.10 + hash2(i, 6, 7510) * 0.06;
    accStal.box(sx - w, by, sz - w, sx + w, by + len, sz + w, 0.78, 0.72, 0.66);
    accStal.box(sx - w * 0.5, by + len, sz - w * 0.5, sx + w * 0.5, by + len + 0.18, sz + w * 0.5, 0.68, 0.62, 0.56);
  }

  /* A couple of glowing crystals inside the cave to sell "wow" */
  var nCrystal = 2 + ((hash2(cave.gx, cave.gz, 7511) * 2) | 0);
  for (var i = 0; i < nCrystal; i++) {
    var a = (i / nCrystal) * Math.PI * 2 + 0.4;
    var rr = r * (0.3 + hash2(i, 7, 7512) * 0.3);
    var sx = x + Math.cos(a) * rr;
    var sz = z + Math.sin(a) * rr;
    var by = heightAt(sx, sz) - 0.2;
    var sh = 0.4 + hash2(i, 8, 7513) * 0.5;
    var sw = 0.10;
    /* pick a hue: blue, magenta, or green */
    var hue = hash2(i, 9, 7514);
    var cr, cg, cb;
    if (hue < 0.33) { cr = 0.5; cg = 1.3; cb = 1.5; }
    else if (hue < 0.66) { cr = 1.4; cg = 0.6; cb = 1.5; }
    else { cr = 0.6; cg = 1.5; cb = 0.8; }
    accStal.box(sx - sw, by, sz - sw, sx + sw, by + sh, sz + sw, cr, cg, cb);
  }
}

/* Cliffhanger: overhanging slab jutting out from a steep drop. */
function spawnCliffhanger(acc, x, z) {
  var h = heightAt(x, z);
  /* downhill direction */
  var e = 1.6;
  var hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  var hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  var gx = (hr - hl) / (2 * e);
  var gz = (hu - hd) / (2 * e);
  var gl = Math.sqrt(gx * gx + gz * gz) || 1;
  /* downhill vector is the negative gradient */
  var dx = -gx / gl;
  var dz = -gz / gl;

  var extent = 2.0 + hash2(Math.floor(x), Math.floor(z), 7600) * 1.2;
  var thick  = 0.42;
  var width  = 0.9 + hash2(Math.floor(x), Math.floor(z), 7601) * 0.5;

  /* the slab body */
  var sx = x + dx * extent * 0.5;
  var sz = z + dz * extent * 0.5;
  acc.box(
    sx - width, h - thick, sz - width,
    sx + width, h,          sz + width,
    0.80, 0.76, 0.70
  );
  /* tip block hanging past the shelf */
  var tx = x + dx * extent;
  var tz = z + dz * extent;
  acc.box(tx - 0.45, h - thick - 0.20, tz - 0.45, tx + 0.45, h - 0.05, tz + 0.45, 0.72, 0.68, 0.62);
  /* anchor root */
  acc.box(x - 0.55, h - thick - 0.35, z - 0.55, x + 0.55, h + 0.10, z + 0.55, 0.85, 0.80, 0.72);
  /* thin support strut under the tip so it doesn't look floating */
  acc.box(tx - 0.18, h - thick - 0.20 - 0.90, tz - 0.18, tx + 0.18, h - thick - 0.20, tz + 0.18, 0.62, 0.58, 0.52);
}

/* Floating rock: small boulder drifting above the terrain. */
function spawnFloatingRock(acc, x, z) {
  var h = heightAt(x, z);
  var lift = 2.5 + hash2(Math.floor(x), Math.floor(z), 7700) * 2.0;
  var size = 0.55 + hash2(Math.floor(x), Math.floor(z), 7701) * 0.5;
  acc.boulder(x, h + lift, z, size, 0.78, 0.74, 0.70);
  /* small orbiting pebble */
  var a = hash2(Math.floor(x), Math.floor(z), 7702) * Math.PI * 2;
  var d = size * 2.0;
  acc.box(x + Math.cos(a) * d - 0.12, h + lift + 0.6, z + Math.sin(a) * d - 0.12,
          x + Math.cos(a) * d + 0.12, h + lift + 0.84, z + Math.sin(a) * d + 0.12,
          0.72, 0.68, 0.64);
}

/* Boulder: chunky rock cluster on the ground. */
function spawnBoulder(acc, x, z) {
  var h = heightAt(x, z);
  var size = 0.7 + hash2(Math.floor(x), Math.floor(z), 7800) * 0.8;
  var r = 0.72, g = 0.68, b = 0.64;
  acc.boulder(x, h - 0.1, z, size, r, g, b);
  /* a couple of smaller companions */
  var n = 1 + ((hash2(Math.floor(x), Math.floor(z), 7801) * 3) | 0);
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2 + hash2(i, 1, 7802) * 1.5;
    var d = size * 1.4;
    var ss = size * (0.4 + hash2(i, 2, 7803) * 0.35);
    acc.boulder(x + Math.cos(a) * d, h - 0.15, z + Math.sin(a) * d, ss, r * 0.9, g * 0.9, b * 0.9);
  }
}

GTF.spawnTree = spawnTree;
GTF.spawnCrystal = spawnCrystal;
GTF.spawnSpire = spawnSpire;
GTF.spawnMushroom = spawnMushroom;
GTF.spawnFlower = spawnFlower;
GTF.spawnRock = spawnRock;
GTF.spawnArch = spawnArch;
GTF.spawnHoodoo = spawnHoodoo;
GTF.spawnCaveMouth = spawnCaveMouth;
GTF.spawnCliffhanger = spawnCliffhanger;
GTF.spawnFloatingRock = spawnFloatingRock;
GTF.spawnBoulder = spawnBoulder;

/* ============================================================ GROUND PARTICLE COLORS */
var GROUND_PARTICLE_COLORS = {
  grass:  0x6fae58,
  forest: 0x3a7a3a,
  sand:   0xdcbf6e,
  stone:  0x9a9aa2,
  snow:   0xf0f5ff,
  water:  0x7fbfe8
};
function groundColorAt(x, z) {
  return GROUND_PARTICLE_COLORS[groundTypeAt(x, z)] || 0xd0d0d0;
}
GTF.groundColorAt = groundColorAt;

/* ============================================================ CHUNK TERRAIN GEOMETRY */
/* Adds a per-vertex "stone" attribute (0..1) that graphics.js uses to
   blend grass.png with stone.png on the terrain mesh. */
function buildChunkTerrainGeo(cx, cz) {
  var geo = new THREE.PlaneGeometry(CHUNK, CHUNK, CHUNK_RES, CHUNK_RES);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2);
  var pos = geo.attributes.position;
  var uv  = geo.attributes.uv;
  var count = pos.count;
  var colors  = new Float32Array(count * 3);
  var normals = new Float32Array(count * 3);
  var stones  = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    var x = pos.getX(i);
    var z = pos.getZ(i);
    var h = heightAt(x, z);
    pos.setY(i, h);
    var n = normalAt(x, z);
    normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2];
    var c = colorAt(x, z, h);
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    uv.setXY(i, x * UV_SCALE, z * UV_SCALE);
    stones[i] = stoneAmountFromNormal(x, z, h, n);
  }
  pos.needsUpdate = true; uv.needsUpdate = true;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color',  new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('stone',  new THREE.BufferAttribute(stones, 1));
  geo.computeBoundingSphere();
  return geo;
}
GTF.buildChunkTerrainGeo = buildChunkTerrainGeo;

})();
