/* models.js — all visual model builders:
     • terrain features: trees, crystals, spires, mushrooms, flowers, rocks
     • item sprites: coin, potion, gem, chest
     • particle system (pickup sparks)
     • decorative sprites: birds, clouds
   Loads after terrain.js and graphics.js. Purely builds geometry/sprites and
   attaches them onto the shared window.GTF namespace. */
(function () {
'use strict';
var GTF = window.GTF = window.GTF || {};

/* ============================================================ HELPERS */
var heightAt   = GTF.heightAt;
var hash2      = GTF.hash2;
var smoothstep = GTF.smoothstep;
var climateAt  = GTF.climateAt;
var cvsTex     = GTF.cvsTex;

/* ============================================================ FEATURE MODEL SPAWNERS */
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

GTF.spawnTree     = spawnTree;
GTF.spawnCrystal  = spawnCrystal;
GTF.spawnSpire    = spawnSpire;
GTF.spawnMushroom = spawnMushroom;
GTF.spawnFlower   = spawnFlower;
GTF.spawnRock     = spawnRock;

/* ============================================================ ITEM SPRITES */
function makeItemSprite(typ, x, z) {
  var base = GTF.itemMaterials[typ];
  var s = new THREE.Sprite(base.clone());
  s.center.set(0.5, 0.5);
  s.scale.set(0.75, 0.75, 1);
  var h = heightAt(x, z);
  s.position.set(x, h + 0.7, z);
  s.userData.baseY = h + 0.7;
  s.userData.phase = hash2(Math.floor(x), Math.floor(z), GTF.SEED + 1717) * Math.PI * 2;
  s.userData.key = Math.round(x) + ',' + Math.round(z);
  s.userData.typ = typ;
  s.userData.value = typ === 'coin' ? 1 : typ === 'potion' ? 3 : typ === 'gem' ? 5 : 12;
  return s;
}
GTF.makeItemSprite = makeItemSprite;

/* ============================================================ PARTICLES */
function tParticle(g) {
  var grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,240,160,0.7)');
  grad.addColorStop(1, 'rgba(255,220,80,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 16);
}

var particlePool = [];
function initParticles(scene) {
  var tex = cvsTex(16, 16, tParticle, false);
  for (var i = 0; i < 100; i++) {
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending });
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
    p.sprite.scale.set(0.35, 0.35, 1);
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
    p.sprite.scale.setScalar(0.35 * (0.4 + t * 0.6));
    if (p.life <= 0) p.sprite.visible = false;
  }
}
GTF.initParticles   = initParticles;
GTF.spawnParticles  = spawnParticles;
GTF.updateParticles = updateParticles;

/* ============================================================ BIRDS / CLOUDS */
function tCloud(g) {
  var r = (function (seed) {
    var a = seed | 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })(31337);
  for (var i = 0; i < 14; i++) {
    var cx = (r() * 24 + 4) | 0;
    var cy = (r() * 10 + 8) | 0;
    var rad = (r() * 6 + 4) | 0;
    var gg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gg.addColorStop(0, 'rgba(255,255,255,0.9)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
}
function tBird(g) {
  g.fillStyle = '#202028';
  g.fillRect(2, 4, 8, 2); g.fillRect(3, 2, 2, 2);
  g.fillRect(7, 2, 2, 2); g.fillRect(9, 4, 2, 1); g.fillRect(0, 4, 2, 1);
}

var birds = [], clouds = [];
function initBirds(scene) {
  var tex = cvsTex(12, 6, tBird, false);
  for (var i = 0; i < 14; i++) {
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    s.scale.set(1.2, 0.6, 1);
    s.userData.angle = Math.random() * Math.PI * 2;
    s.userData.radius = 15 + Math.random() * 25;
    s.userData.height = 14 + Math.random() * 8;
    s.userData.speed = 0.15 + Math.random() * 0.15;
    s.userData.wing = Math.random() * Math.PI * 2;
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
    b.userData.wing += dt * 8;
    var w = 0.6 + Math.abs(Math.sin(b.userData.wing)) * 0.6;
    b.scale.set(1.2, w, 1);
    b.position.set(
      player.x + Math.cos(b.userData.angle) * b.userData.radius,
      player.y + b.userData.height + Math.sin(time * 0.3 + i) * 1.5,
      player.z + Math.sin(b.userData.angle) * b.userData.radius
    );
  }
}
function initClouds(scene) {
  var tex = cvsTex(32, 16, tCloud, false);
  for (var i = 0; i < 22; i++) {
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.75 });
    var s = new THREE.Sprite(mat);
    s.center.set(0.5, 0.5);
    var ang = Math.random() * Math.PI * 2;
    var rad = 30 + Math.random() * 70;
    var sz = 8 + Math.random() * 12;
    s.scale.set(sz, sz * 0.6, 1);
    s.position.set(Math.cos(ang) * rad, 30 + Math.random() * 15, Math.sin(ang) * rad);
    s.userData.angle = ang; s.userData.radius = rad;
    s.userData.speed = 0.008 + Math.random() * 0.012;
    scene.add(s);
    clouds.push(s);
  }
}
function updateClouds(dt) {
  var player = GTF.player;
  if (!player) return;
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.userData.angle += c.userData.speed * dt;
    c.position.x = player.x + Math.cos(c.userData.angle) * c.userData.radius;
    c.position.z = player.z + Math.sin(c.userData.angle) * c.userData.radius;
  }
}
GTF.initBirds    = initBirds;
GTF.updateBirds  = updateBirds;
GTF.initClouds   = initClouds;
GTF.updateClouds = updateClouds;

})();
