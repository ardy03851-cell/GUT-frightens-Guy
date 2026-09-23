/* terrain.js — world generation: deterministic terrain math, biome/feature queries,
   terrain geometry, and shared geometry helpers. Exposes APIs on window.GTF. */
(function () {
'use strict';
var GTF = window.GTF = window.GTF || {};
GTF.modules = GTF.modules || {};

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

/* ============================================================ TERRAIN
   Layers:
     - continents (very slow)
     - rolling hills
     - mountain ridges (ridged noise)
     - flat-topped plateaus
     - sharp canyons carved by a narrow noise band
     - spawn plateau near origin
*/
function baseHeight(x, z) {
  var d = Math.sqrt(x * x + z * z);
  var spawnBoost = Math.max(0, 1 - d / 50) * 3.0;

  // Continents
  var cont = fbm(x * 0.006, z * 0.006, SEED, 4);
  var land = (cont - 0.34) * 30 + 1.5 + spawnBoost;

  // Mountains
  var r = fbm(x * 0.011, z * 0.011, SEED + 555, 3);
  var ridged = 1 - Math.abs(r * 2 - 1);
  ridged = ridged * ridged;
  var mountainAmp = Math.max(0, (cont - 0.48) * 5);
  var mountain = ridged * 18 * mountainAmp;

  // Plateaus
  var platN = fbm(x * 0.018, z * 0.018, SEED + 3333, 3);
  var plateau = 0;
  if (platN > 0.60) {
    var pt = smoothstep(0.60, 0.72, platN);
    plateau = pt * 7.0;
  }

  // Canyons
  var canyonN = fbm(x * 0.022, z * 0.022, SEED + 4444, 3);
  var distToLine = Math.abs(canyonN - 0.5);
  var canyonCut = 0;
  if (distToLine < 0.028) {
    canyonCut = (1 - distToLine / 0.028) * 6.5;
    canyonCut = canyonCut * smoothstep(0.0, 0.5, land);
  }

  // Hills & detail
  var hill   = (fbm(x * 0.038, z * 0.038, SEED + 777, 3) - 0.5) * 3.5;
  var detail = (fbm(x * 0.13,  z * 0.13,  SEED + 999, 2) - 0.5) * 1.0;

  return land + mountain + plateau + hill + detail - canyonCut;
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
  return [r * tint, g * tint, b * tint];
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
GTF.groundTypeAt = groundTypeAt;

/* ============================================================ FEATURE TESTS */
function hasTreeAt(x, z) {
  var h = heightAt(x, z);
  if (h < 2.2 || h > 12) return false;
  var c = climateAt(x, z);
  if (c.moist < 0.50) return false;
  var density = smoothstep(0.50, 0.72, c.moist) * 0.55;
  return hash2(Math.floor(x), Math.floor(z), SEED + 4242) < density;
}
function hasItemAt(x, z) {
  var h = heightAt(x, z);
  if (h < 1.5 || h > 12) return false;
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
  var c = climateAt(x, z);
  if (c.temp > 0.56 && c.moist < 0.44) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6400) > 0.92;
}
function hasRockAt(x, z) {
  var h = heightAt(x, z);
  if (h < 6 || h > 15) return false;
  return hash2(Math.floor(x), Math.floor(z), SEED + 6500) > 0.97;
}

GTF.hasTreeAt = hasTreeAt;
GTF.hasItemAt = hasItemAt;
GTF.itemTypeAt = itemTypeAt;
GTF.hasCrystalAt = hasCrystalAt;
GTF.hasSpireAt = hasSpireAt;
GTF.hasMushroomAt = hasMushroomAt;
GTF.hasFlowerAt = hasFlowerAt;
GTF.hasRockAt = hasRockAt;

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
function buildChunkTerrainGeo(cx, cz) {
  var geo = new THREE.PlaneGeometry(CHUNK, CHUNK, CHUNK_RES, CHUNK_RES);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx * CHUNK + CHUNK / 2, 0, cz * CHUNK + CHUNK / 2);
  var pos = geo.attributes.position;
  var uv  = geo.attributes.uv;
  var count = pos.count;
  var colors  = new Float32Array(count * 3);
  var normals = new Float32Array(count * 3);
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
  }
  pos.needsUpdate = true; uv.needsUpdate = true;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color',  new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}
GTF.buildChunkTerrainGeo = buildChunkTerrainGeo;

GTF.modules.terrain = true;

})();
