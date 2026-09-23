/* models.js — all visual model builders:
     • terrain features: trees, crystals, spires, mushrooms, flowers, rocks
     • item sprites: coin, potion, gem, chest
     • particle system (pickup sparks)
     • decorative sprites: birds, clouds
   Loads after terrain.js and graphics.js. Purely owns spawned models/sprites,
   particles, and decorative animated objects through the shared window.GTF namespace.
   v2 — every model rebuilt with more parts, larger silhouettes and richer
   colour variation. Same public API as before. */
(function () {
'use strict';
var GTF = window.GTF = window.GTF || {};
GTF.modules = GTF.modules || {};
if (!GTF.modules.terrain || !GTF.modules.graphics) {
  throw new Error('models.js requires terrain.js and graphics.js to be loaded first.');
}

/* ============================================================ HELPERS */
var heightAt   = GTF.heightAt;
var hash2      = GTF.hash2;
var smoothstep = GTF.smoothstep;
var climateAt  = GTF.climateAt;
var cvsTex     = GTF.cvsTex;

/* Axis-aligned box placed by centre-x / bottom-y / centre-z + half-extents. */
function blk(acc, x, y, z, hw, hh, hd, r, g, b) {
  acc.box(x - hw, y, z - hd, x + hw, y + hh, z + hd, r, g, b);
}

/* Tiny deterministic RNG seeded from a world position — keeps every tree
   unique but stable across reloads. */
function makeRnd(x, z) {
  var a = Math.round(x * 32) | 0;
  var b = Math.round(z * 32) | 0;
  var i = 0;
  return function () { i++; return hash2(a + i * 17, b - i * 29, 9176); };
}

/* mulberry32 — used only for baking sprite textures. */
function mulberry(seed) {
  var a = seed | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Small root flare / rubble ring around a trunk or boulder. */
function rootFlare(acc, x, y, z, rad, n, R, cr, cg, cb) {
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2 + R() * 0.9;
    var d = rad * (0.75 + R() * 0.55);
    blk(acc, x + Math.cos(a) * d, y, z + Math.sin(a) * d,
        0.09 + R() * 0.07, 0.18 + R() * 0.16, 0.09 + R() * 0.07, cr, cg, cb);
  }
}

/* ============================================================ FEATURE MODEL SPAWNERS */
function spawnTree(trunks, leaves, x, z) {
  var h = heightAt(x, z);
  var c = climateAt(x, z);
  var R = makeRnd(x, z);

  var isPine  = c.temp  < 0.42;
  var isBirch = !isPine && c.temp > 0.55 && c.moist > 0.65;

  var barkR = 0.90, barkG = 0.72, barkB = 0.52;
  var leafR = 0.72, leafG = 1.02, leafB = 0.66;
  if (isBirch) { barkR = 1.00; barkG = 0.98; barkB = 0.92; }
  if (isPine)  { leafR = 0.50; leafG = 0.80; leafB = 0.50; }
  if (c.moist > 0.75) { leafR *= 0.85; leafG *= 0.95; leafB *= 0.82; }

  /* tiny sway so a forest never looks grid-perfect */
  var lean  = (R() - 0.5) * 0.30;
  var leanZ = (R() - 0.5) * 0.30;

  /* ---------------------------------------------- PINE : tall stepped cone */
  if (isPine) {
    var pth = 3.2 + R() * 1.4;              // visible trunk height
    var ptr = 0.17 + R() * 0.07;            // trunk half-width

    blk(trunks, x, h - 0.05, z, ptr * 1.45, 1.0, ptr * 1.45,
        barkR * 0.84, barkG * 0.70, barkB * 0.56);
    blk(trunks, x, h + 0.95, z, ptr, pth - 0.95, ptr,
        barkR * 0.90, barkG * 0.75, barkB * 0.60);
    rootFlare(trunks, x, h - 0.05, z, ptr * 1.9, 4, R,
              barkR * 0.78, barkG * 0.64, barkB * 0.50);

    var tiers = 7;
    var baseY = h + pth * 0.55;
    var step  = 0.95 + R() * 0.22;
    var baseW = 1.75 + R() * 0.60;

    for (var i = 0; i < tiers; i++) {
      var t  = i / (tiers - 1);
      var w  = baseW * (1 - t * 0.87) + 0.05;
      var y0 = baseY + i * step;
      var sh = 0.80 + t * 0.32;                       // brighter towards the top
      blk(leaves, x + lean * t, y0, z + leanZ * t, w, step * 1.20, w,
          leafR * sh * 0.92, leafG * sh, leafB * sh * 0.86);

      /* ragged branch tips poking out of the mid tiers */
      if (i > 0 && i < tiers - 1) {
        var a = R() * Math.PI * 2;
        blk(leaves, x + Math.cos(a) * w * 1.02, y0 - step * 0.25,
            z + Math.sin(a) * w * 1.02,
            w * 0.42, step * 0.50, w * 0.42,
            leafR * sh * 1.10, leafG * sh * 1.08, leafB * sh * 0.95);
      }
    }
    /* crown spike */
    blk(leaves, x + lean, baseY + tiers * step - step * 0.30, z + leanZ,
        0.20, 0.70, 0.20, leafR * 1.15, leafG * 1.30, leafB);
    return;
  }

  /* ---------------------------------------------- BIRCH : slender + speckled */
  if (isBirch) {
    var bth = 5.0 + R() * 2.4;
    var btr = 0.11 + R() * 0.04;

    blk(trunks, x, h - 0.05, z, btr * 1.5, bth, btr * 1.5, barkR, barkG, barkB);
    rootFlare(trunks, x, h - 0.05, z, btr * 2.0, 4, R,
              barkR * 0.80, barkG * 0.78, barkB * 0.72);

    /* the dark bark dashes birch is known for */
    for (var m = 0; m < 5; m++) {
      var my = h + 0.9 + (m / 5) * (bth - 1.6) + R() * 0.35;
      var ma = R() * Math.PI * 2;
      blk(trunks, x + Math.cos(ma) * btr * 1.02, my, z + Math.sin(ma) * btr * 1.02,
          btr * 0.62, 0.09 + R() * 0.09, btr * 0.62, 0.26, 0.24, 0.22);
    }

    /* airy, offset leaf clusters */
    var layers = 4;
    var bcy = h + bth * 0.68;
    for (var l = 0; l < layers; l++) {
      var lt = l / (layers - 1);
      var lw = (1.45 - lt * 0.85) * (0.90 + R() * 0.30);
      var lo = (R() - 0.5) * 0.40;
      blk(leaves, x + lo, bcy + l * 0.90, z + lo * 0.6, lw, 1.0, lw,
          leafR * (1.02 + lt * 0.22),
          leafG * (1.08 + lt * 0.28),
          leafB * (0.95 + lt * 0.12));
    }
    blk(leaves, x, bcy + layers * 0.90 - 0.25, z, 0.40, 0.70, 0.40,
        leafR * 1.20, leafG * 1.30, leafB);
    return;
  }

  /* ---------------------------------------------- BROADLEAF : fat dome */
  var th = 3.0 + R() * 1.6;
  var tr = 0.16 + R() * 0.08;

  blk(trunks, x, h - 0.05, z, tr * 1.45, th * 0.55, tr * 1.45,
      barkR * 0.85, barkG * 0.70, barkB * 0.56);
  blk(trunks, x, h + th * 0.50, z, tr, th * 0.50, tr,
      barkR, barkG * 0.85, barkB * 0.70);
  rootFlare(trunks, x, h - 0.05, z, tr * 2.0, 4, R,
            barkR * 0.78, barkG * 0.64, barkB * 0.50);

  /* a couple of chunky lower branches */
  for (var b = 0; b < 2; b++) {
    var ba = R() * Math.PI * 2;
    var bd = 0.30 + R() * 0.35;
    blk(trunks, x + Math.cos(ba) * bd, h + th * 0.55, z + Math.sin(ba) * bd,
        tr * 0.65, 0.80, tr * 0.65, barkR * 0.92, barkG * 0.78, barkB * 0.62);
  }

  var cy = h + th * 0.82;
  var cw = 1.55 + R() * 0.60;
  for (var k3 = 0; k3 < 3; k3++) {
    var kt = k3 / 2;
    var kw = cw * (1 - kt * 0.55);
    var ky = cy + k3 * 0.95;
    blk(leaves, x, ky, z, kw, 1.10, kw, leafR, leafG * 1.05, leafB * 0.85);
    /* two side clumps per layer → lumpy organic silhouette */
    for (var s = 0; s < 2; s++) {
      var sa = (s / 2) * Math.PI * 2 + k3 * 0.9 + R() * 0.8;
      var sd = kw * 0.70;
      blk(leaves, x + Math.cos(sa) * sd, ky - 0.20 + R() * 0.25,
          z + Math.sin(sa) * sd,
          kw * 0.68, 0.85, kw * 0.68,
          leafR * 0.94, leafG * 1.12, leafB * 0.90);
    }
  }
  /* rounded crown cap */
  blk(leaves, x, cy + 2.90, z, 0.75, 0.65, 0.75, leafR * 1.15, leafG * 1.30, leafB);
}

function spawnCrystal(acc, x, z) {
  var h = heightAt(x, z);
  var R = makeRnd(x + 3.7, z - 1.9);

  var hue = R(), cr, cg, cb;
  if (hue < 0.33)      { cr = 0.55; cg = 1.30; cb = 1.50; }   // ice blue
  else if (hue < 0.66) { cr = 1.40; cg = 0.65; cb = 1.50; }   // amethyst
  else                 { cr = 0.75; cg = 1.40; cb = 0.80; }   // emerald

  /* glowing base slab */
  var bw = 0.55 + R() * 0.35;
  blk(acc, x, h - 0.06, z, bw, 0.22, bw, cr * 0.45, cg * 0.45, cb * 0.45);

  var shards = 4 + Math.floor(R() * 5);
  for (var i = 0; i < shards; i++) {
    var a  = (i / shards) * Math.PI * 2 + R() * 0.9;
    var d  = (i === 0) ? 0 : 0.22 + R() * 0.60;
    var px = x + Math.cos(a) * d;
    var pz = z + Math.sin(a) * d;
    var sh = (i === 0 ? 2.4 : 0.8) + R() * 1.7;      // shard 0 is the big one
    var sw = 0.09 + R() * 0.11;
    var tn = 0.75 + R() * 0.50;

    /* two-step taper reads as a faceted point */
    blk(acc, px, h, pz, sw, sh * 0.66, sw, cr * tn, cg * tn, cb * tn);
    blk(acc, px, h + sh * 0.66, pz, sw * 0.62, sh * 0.34, sw * 0.62,
        cr * tn * 1.25, cg * tn * 1.25, cb * tn * 1.20);
  }
}

function spawnSpire(acc, x, z) {
  var h = heightAt(x, z);
  var R = makeRnd(x - 5.1, z + 2.3);

  var height = 4.0 + R() * 6.0;          // up to ~10 units tall
  var width  = 0.45 + R() * 0.45;
  var segs   = 9;

  /* plinth */
  blk(acc, x, h - 0.06, z, width * 1.70, 0.35, width * 1.70, 0.60, 0.60, 0.66);

  /* four buttresses around the base */
  for (var b = 0; b < 4; b++) {
    var a = b * Math.PI * 0.5 + R() * 0.40;
    blk(acc, x + Math.cos(a) * width * 1.25, h, z + Math.sin(a) * width * 1.25,
        width * 0.30, height * 0.16, width * 0.30, 0.70, 0.70, 0.75);
  }

  /* tapering shaft with occasional ledges */
  for (var i = 0; i < segs; i++) {
    var t  = i / segs;
    var w  = width * (1 - t * 0.85) + 0.02;
    var y0 = h + height * i / segs;
    var y1 = h + height * (i + 1) / segs;
    var tn = 0.68 + t * 0.28;
    blk(acc, x, y0, z, w, y1 - y0, w, tn, tn, tn * 1.06);
    if (i % 3 === 1) {
      blk(acc, x, y0, z, w * 1.35, 0.09, w * 1.35, tn * 1.10, tn * 1.10, tn * 1.16);
    }
  }

  /* bright tip */
  blk(acc, x, h + height, z, 0.09, 0.55, 0.09, 1.15, 1.15, 1.25);
}

function spawnMushroom(accStalk, accCap, x, z) {
  var h = heightAt(x, z);
  var R = makeRnd(x + 9.4, z + 4.2);

  var height = 1.8 + R() * 1.6;
  var capW   = 0.70 + R() * 0.50;
  var red    = 1.30 + R() * 0.20;

  /* tapered stalk + skirt ring */
  blk(accStalk, x, h, z, 0.16, height * 0.60, 0.16, 1.25, 1.15, 1.00);
  blk(accStalk, x, h + height * 0.60, z, 0.13, height * 0.40, 0.13, 1.30, 1.20, 1.05);
  blk(accStalk, x, h + height * 0.55, z, 0.26, 0.12, 0.26, 1.15, 1.05, 0.90);

  /* dome built from three shrinking layers */
  blk(accCap, x, h + height - 0.15, z, capW, 0.22, capW, red, 0.42, 0.42);
  blk(accCap, x, h + height + 0.05, z, capW * 0.78, 0.26, capW * 0.78, red * 1.08, 0.50, 0.45);
  blk(accCap, x, h + height + 0.29, z, capW * 0.42, 0.22, capW * 0.42, red * 1.15, 0.60, 0.50);

  /* white spots */
  for (var i = 0; i < 5; i++) {
    var a  = (i / 5) * Math.PI * 2 + R();
    var d  = capW * (0.30 + R() * 0.50);
    blk(accCap, x + Math.cos(a) * d, h + height + 0.22, z + Math.sin(a) * d,
        0.09, 0.12, 0.09, 1.50, 1.50, 1.30);
  }

  /* a little companion mushroom beside the big one */
  var ca  = R() * Math.PI * 2;
  var cd  = 0.85 + R() * 0.45;
  var cx2 = x + Math.cos(ca) * cd;
  var cz2 = z + Math.sin(ca) * cd;
  var ch  = height * (0.40 + R() * 0.20);
  var cw2 = capW  * (0.40 + R() * 0.18);
  blk(accStalk, cx2, h, cz2, 0.09, ch, 0.09, 1.20, 1.12, 0.98);
  blk(accCap, cx2, h + ch - 0.05, cz2, cw2, 0.16, cw2, red * 0.95, 0.40, 0.40);
  blk(accCap, cx2, h + ch + 0.09, cz2, cw2 * 0.62, 0.14, cw2 * 0.62, red * 1.10, 0.52, 0.46);
}

function spawnFlower(acc, x, z) {
  var h = heightAt(x, z);
  var R = makeRnd(x * 1.7, z * 1.7);

  var fr = R(), r, g, b;
  if (fr < 0.33)      { r = 1.35; g = 0.50; b = 0.72; }   // pink
  else if (fr < 0.66) { r = 1.35; g = 1.10; b = 0.40; }   // gold
  else                { r = 0.75; g = 0.78; b = 1.40; }   // blue

  var stemH = 0.45 + R() * 0.35;
  blk(acc, x, h, z, 0.030, stemH, 0.030, 0.45, 0.90, 0.40);

  /* two little leaves on the stem */
  blk(acc, x - 0.11, h + stemH * 0.35, z, 0.10, 0.03, 0.055, 0.50, 0.95, 0.42);
  blk(acc, x + 0.11, h + stemH * 0.55, z, 0.10, 0.03, 0.055, 0.50, 0.95, 0.42);

  /* five petals around a bright centre */
  var top = h + stemH;
  for (var i = 0; i < 5; i++) {
    var a = (i / 5) * Math.PI * 2 + R() * 0.4;
    blk(acc, x + Math.cos(a) * 0.10, top, z + Math.sin(a) * 0.10,
        0.065, 0.06, 0.065, r, g, b);
  }
  blk(acc, x, top + 0.01, z, 0.05, 0.08, 0.05, 1.40, 1.30, 0.50);
}

function spawnRock(acc, x, z) {
  var h = heightAt(x, z);
  var R = makeRnd(x + 12.6, z - 7.4);

  var n = 2 + Math.floor(R() * 3);       // 2–4 boulders per cluster
  for (var i = 0; i < n; i++) {
    var a  = R() * Math.PI * 2;
    var d  = (i === 0) ? 0 : R() * 0.75;
    var px = x + Math.cos(a) * d;
    var pz = z + Math.sin(a) * d;

    var w  = (i === 0 ? 0.45 : 0.22) + R() * 0.35;
    var hh = w * (0.70 + R() * 0.80);
    var tn = 0.66 + R() * 0.28;

    blk(acc, px, h - 0.05, pz, w, hh, w * (0.85 + R() * 0.30), tn, tn, tn * 1.06);
    /* lighter cap slab so boulders read as faceted */
    blk(acc, px, h - 0.05 + hh, pz, w * 0.60, w * 0.50, w * 0.55,
        tn * 1.12, tn * 1.12, tn * 1.16);
  }
}

GTF.spawnTree     = spawnTree;
GTF.spawnCrystal  = spawnCrystal;
GTF.spawnSpire    = spawnSpire;
GTF.spawnMushroom = spawnMushroom;
GTF.spawnFlower   = spawnFlower;
GTF.spawnRock     = spawnRock;

/* ============================================================ ITEM SPRITES */
var glowTex = null;
var glowMats = {};
var ITEM_GLOW = { coin: 0xffe066, potion: 0xff5fa8, gem: 0x66e0ff, chest: 0xffc04d };

function tGlow(g) {
  var grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0.00, 'rgba(255,255,255,0.90)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
}

/* Soft additive halo parented to an item sprite (shared material per type). */
function addHalo(parent, typ) {
  if (!glowTex) glowTex = cvsTex(32, 32, tGlow, false);
  var mat = glowMats[typ];
  if (!mat) {
    mat = new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: ITEM_GLOW[typ] || 0xffffff, opacity: 0.85
    });
    glowMats[typ] = mat;
  }
  var halo = new THREE.Sprite(mat);
  halo.center.set(0.5, 0.5);
  halo.scale.set(2.3, 2.3, 1);
  parent.add(halo);
  return halo;
}

function makeItemSprite(typ, x, z) {
  var base = GTF.itemMaterials[typ];
  if (!base) {
    console.warn('[models] Missing material for item type: ' + typ);
    return null;
  }
  var s = new THREE.Sprite(base.clone());
  s.center.set(0.5, 0.5);
  s.scale.set(1.05, 1.05, 1);
  var h = heightAt(x, z);
  s.position.set(x, h + 0.85, z);
  s.userData.baseY = h + 0.85;
  s.userData.phase = hash2(Math.floor(x), Math.floor(z), GTF.SEED + 1717) * Math.PI * 2;
  s.userData.key   = Math.round(x) + ',' + Math.round(z);
  s.userData.typ   = typ;
  s.userData.value = typ === 'coin' ? 1 : typ === 'potion' ? 3 : typ === 'gem' ? 5 : 12;
  s.userData.halo  = addHalo(s, typ);
  return s;
}
GTF.makeItemSprite = makeItemSprite;

/* ============================================================ PARTICLES */
function tParticle(g) {
  var grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,246,190,0.95)');
  grad.addColorStop(0.55, 'rgba(255,212,90,0.45)');
  grad.addColorStop(1.00, 'rgba(255,180,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 16);

  /* four-point star flare */
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,235,0.55)';
  g.fillRect(7, 1, 2, 14);
  g.fillRect(1, 7, 14, 2);
}

var particlePool = [];
var modelScene = null;
function initParticles(scene) {
  if (particlePool.length > 0) return;
  var tex = cvsTex(16, 16, tParticle, false);
  for (var i = 0; i < 160; i++) {
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    var s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    particlePool.push({ sprite: s, life: 0, maxLife: 0, vx: 0, vy: 0, vz: 0 });
  }
}
function spawnParticles(x, y, z, count, color) {
  for (var i = 0; i < count; i++) {
    var p = null;
    for (var j = 0; j < particlePool.length; j++) {
      if (particlePool[j].life <= 0) { p = particlePool[j]; break; }
    }
    if (!p) return;
    var ang = Math.random() * Math.PI * 2;
    var spd = 1.5 + Math.random() * 2;
    p.vx = Math.cos(ang) * spd; p.vz = Math.sin(ang) * spd;
    p.vy = 2 + Math.random() * 2;
    p.sprite.position.set(x, y, z);
    p.sprite.material.color.setHex(color || 0xfff0a0);
    p.sprite.material.opacity = 1;
    p.sprite.scale.set(0.45, 0.45, 1);
    p.sprite.visible = true;
    p.life = p.maxLife = 0.6 + Math.random() * 0.3;
  }
}
function updateParticles(dt) {
  for (var i = 0; i < particlePool.length; i++) {
    var p = particlePool[i];
    if (p.life <= 0) continue;
    p.life -= dt; p.vy -= 9 * dt;
    p.sprite.position.x += p.vx * dt;
    p.sprite.position.y += p.vy * dt;
    p.sprite.position.z += p.vz * dt;
    var t = p.life / p.maxLife;
    p.sprite.material.opacity = t;
    p.sprite.scale.setScalar(0.45 * (0.4 + t * 0.6));
    if (p.life <= 0) {
      p.life = 0;
      p.vx = p.vy = p.vz = 0;
      p.sprite.visible = false;
      p.sprite.material.opacity = 0;
    }
  }
}
GTF.initParticles   = initParticles;
GTF.spawnParticles  = spawnParticles;
GTF.updateParticles = updateParticles;

/* ============================================================ BIRDS / CLOUDS */
function tCloud(g) {
  var r = mulberry(31337);
  for (var i = 0; i < 22; i++) {
    var cx  = r() * 46 + 2;
    var cy  = r() * 22 + 5;
    var rad = r() * 9 + 5;
    var gg  = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gg.addColorStop(0.0, 'rgba(255,255,255,0.85)');
    gg.addColorStop(0.6, 'rgba(250,252,255,0.45)');
    gg.addColorStop(1.0, 'rgba(240,246,255,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
}

function tBird(g) {
  g.fillStyle = '#1c1c22';
  /* body + head + beak */
  g.fillRect(6, 3, 4, 2);
  g.fillRect(9, 2, 2, 2);
  g.fillRect(11, 3, 2, 1);
  /* wings raised */
  g.fillRect(2, 1, 4, 1);
  g.fillRect(1, 2, 5, 1);
  g.fillRect(10, 1, 4, 1);
  g.fillRect(11, 2, 5, 1);
  /* tail */
  g.fillRect(3, 4, 3, 1);
}

var birds = [], clouds = [];
function initBirds(scene) {
  if (birds.length > 0) return;
  var tex = cvsTex(16, 8, tBird, false);
  for (var i = 0; i < 18; i++) {
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    var size = 1.6 + Math.random() * 1.4;
    s.scale.set(size * 2, size, 1);
    s.userData.size    = size;
    s.userData.angle   = Math.random() * Math.PI * 2;
    s.userData.radius  = 15 + Math.random() * 30;
    s.userData.height  = 14 + Math.random() * 10;
    s.userData.speed   = 0.15 + Math.random() * 0.15;
    s.userData.wing    = Math.random() * Math.PI * 2;
    s.userData.flap    = 6 + Math.random() * 4;
    scene.add(s);
    birds.push(s);
  }
}
function updateBirds(dt, time) {
  var player = GTF.player;
  if (!player) return;
  for (var i = 0; i < birds.length; i++) {
    var b = birds[i];
    b.userData.angle += b.userData.speed * dt;
    b.userData.wing  += dt * b.userData.flap;

    var w = 0.55 + Math.abs(Math.sin(b.userData.wing)) * 0.85;
    var sz = b.userData.size;
    b.scale.set(sz * 2, sz * w, 1);
    b.material.rotation = Math.sin(b.userData.wing) * 0.10;   // subtle banking

    b.position.set(
      player.x + Math.cos(b.userData.angle) * b.userData.radius,
      player.y + b.userData.height + Math.sin(time * 0.3 + i) * 1.5,
      player.z + Math.sin(b.userData.angle) * b.userData.radius
    );
  }
}
function initClouds(scene) {
  if (clouds.length > 0) return;
  var tex = cvsTex(64, 32, tCloud, false);
  for (var i = 0; i < 20; i++) {
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      opacity: 0.62 + Math.random() * 0.28
    });
    var s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    var ang = Math.random() * Math.PI * 2;
    var rad = 30 + Math.random() * 80;
    var sz  = 14 + Math.random() * 18;
    s.scale.set(sz, sz * 0.55, 1);
    s.position.set(Math.cos(ang) * rad, 30 + Math.random() * 18, Math.sin(ang) * rad);
    s.userData.angle  = ang;
    s.userData.radius = rad;
    s.userData.speed  = 0.008 + Math.random() * 0.012;
    s.userData.bob    = Math.random() * Math.PI * 2;
    s.userData.baseY  = s.position.y;
    scene.add(s);
    clouds.push(s);
  }
}
function updateClouds(dt, time) {
  var player = GTF.player;
  if (!player) return;
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.userData.angle += c.userData.speed * dt;
    c.position.x = player.x + Math.cos(c.userData.angle) * c.userData.radius;
    c.position.z = player.z + Math.sin(c.userData.angle) * c.userData.radius;
    if (time !== undefined) {
      c.position.y = c.userData.baseY + Math.sin(time * 0.15 + c.userData.bob) * 2.0;
    }
  }
}
GTF.initBirds    = initBirds;
GTF.updateBirds  = updateBirds;
GTF.initClouds   = initClouds;
GTF.updateClouds = updateClouds;

function initModelSystems(scene) {
  if (modelScene === scene) return;
  modelScene = scene;
  initParticles(scene);
  initBirds(scene);
  initClouds(scene);
}
GTF.initModelSystems = initModelSystems;

GTF.modules.models = true;

})();
