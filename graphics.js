/* graphics.js — WebGL renderer, textures, materials, chunks, sprites,
   particles, day/night, minimap. Depends on terrain.js being loaded first. */
(function () {
  'use strict';
  var GTF = window.GTF = window.GTF || {};

  /* Short-hand terrain helpers (must exist — loaded from terrain.js) */
  var hash2 = GTF.hash2;
  var smooth = GTF.smoothstep;
  var CHUNK = GTF.CHUNK;
  var VIEW_RADIUS = GTF.VIEW_RADIUS;
  var SEA_LEVEL = GTF.SEA_LEVEL;

  /* ============================================================ RENDERER */
  function createRenderer() {
    var inIframe = false;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
    var pr = Math.min(window.devicePixelRatio || 1, inIframe ? 1 : 1.5);
    var cfgs = [
      { antialias: true, alpha: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
      { antialias: false, alpha: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
      { antialias: false, alpha: false, powerPreference: 'low-power' },
      { antialias: false, alpha: false },
      { antialias: false }
    ];
    for (var i = 0; i < cfgs.length; i++) {
      var canvas = document.createElement('canvas');
      var cfg = Object.assign({}, cfgs[i], { canvas: canvas });
      try {
        var r = new THREE.WebGLRenderer(cfg);
        var gl = r.getContext && r.getContext();
        if (gl && !gl.isContextLost()) {
          console.log('[renderer] OK config #' + i);
          try { r.setPixelRatio(pr); } catch (e) { }
          r.setSize(window.innerWidth, window.innerHeight, false);
          r.setClearColor(0x9cc6ec, 1);
          r.domElement.style.width = '100%';
          r.domElement.style.height = '100%';
          return r;
        }
        try { r.dispose(); } catch (e) { }
      } catch (e) {
        console.warn('[renderer] config #' + i + ' threw: ' + (e.message || e));
      }
    }
    return null;
  }
  GTF.createRenderer = createRenderer;

  /* ============================================================ TEXTURE PROBE */
  function probeTexture(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var done = false;
      var t = setTimeout(function () {
        if (!done) { done = true; resolve({ ok: false, src: src, reason: 'timeout' }); }
      }, 5000);
      img.onload = function () {
        if (done) return;
        done = true; clearTimeout(t);
        resolve({ ok: true, src: src, img: img, w: img.width, h: img.height });
      };
      img.onerror = function () {
        if (done) return;
        done = true; clearTimeout(t);
        resolve({ ok: false, src: src, reason: 'load error' });
      };
      img.src = src;
    });
  }
  function probeAllTextures(paths) {
    return Promise.all(paths.map(probeTexture)).then(function (results) {
      var map = {};
      results.forEach(function (r) { map[r.src] = r; });
      return map;
    });
  }
  GTF.probeTexture = probeTexture;
  GTF.probeAllTextures = probeAllTextures;

  /* ============================================================ TEXTURE APPLY */
  function applyProbedTexture(material, result) {
    if (!result || !result.ok) return;
    var t = new THREE.Texture(result.img);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    if (material.map && material.map.dispose) material.map.dispose();
    material.map = t;
    material.needsUpdate = true;
    console.log('[tex APPLIED] ' + result.src + '  ' + result.w + 'x' + result.h);
  }
  function applyProbedSprite(material, result) {
    if (!result || !result.ok) return;
    var t = new THREE.Texture(result.img);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    if (material.map && material.map.dispose) material.map.dispose();
    material.map = t;
    material.needsUpdate = true;
    console.log('[sprite APPLIED] ' + result.src + '  ' + result.w + 'x' + result.h);
  }
  function applyPlayerTexture(result, sprite) {
    if (!result || !result.ok) return;
    cropTransparent(result.img, function (cropped, cw, ch) {
      var tex = new THREE.Texture(cropped);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      if (sprite.material.map && sprite.material.map.dispose) sprite.material.map.dispose();
      sprite.material.map = tex;
      sprite.material.needsUpdate = true;
      var spriteHeight = 1.8;
      var aspect = cw / ch;
      sprite.userData.baseScaleX = spriteHeight * aspect;
      sprite.userData.baseScaleY = spriteHeight;
      sprite.scale.set(sprite.userData.baseScaleX, sprite.userData.baseScaleY, 1);
      console.log('[player APPLIED] cropped ' + cw + 'x' + ch + ' aspect=' + aspect.toFixed(3));
    });
  }
  GTF.applyProbedTexture = applyProbedTexture;
  GTF.applyProbedSprite = applyProbedSprite;
  GTF.applyPlayerTexture = applyPlayerTexture;

  /* ============================================================ PROCEDURAL TEXTURES */
  function cvsTex(w, h, drawFn, repeat) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    drawFn(g, w, h);
    var t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = (repeat === false) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }
  GTF.cvsTex = cvsTex;

  function rngFrom(seed) {
    var a = seed | 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function scatterFill(g, base, palette, count, seed) {
    g.fillStyle = base; g.fillRect(0, 0, 16, 16);
    var r = rngFrom(seed);
    for (var i = 0; i < count; i++) {
      g.fillStyle = palette[(r() * palette.length) | 0];
      g.fillRect((r() * 16) | 0, (r() * 16) | 0, 1, 1);
    }
  }
  function tGrass(g) { scatterFill(g, '#5b9c46', ['#4e8f3c', '#6fae58', '#457f35', '#77bb5d'], 120, 101); }
  function tWater(g) {
    scatterFill(g, '#2f6fb5', ['#3a7fc7', '#2a63a3', '#4a8fd7'], 55, 505);
    g.fillStyle = '#5aa5e5'; g.fillRect(0, 3, 16, 1);
    g.fillStyle = '#3d83c9'; g.fillRect(0, 10, 16, 1);
  }
  function tBark(g) {
    scatterFill(g, '#5a3d22', ['#6d4b2b', '#3f2a17', '#4a3220'], 90, 707);
    g.fillStyle = '#7a5a38'; g.fillRect(3, 0, 1, 16);
    g.fillStyle = '#3f2a17'; g.fillRect(9, 0, 1, 16);
  }
  function tLeaves(g) { scatterFill(g, '#2c6e30', ['#3a8a3d', '#4aa04c', '#22581f', '#2c6e30'], 140, 808); }
  function tPlayerFallback(g) {
    g.fillStyle = '#3a2a1a'; g.fillRect(5, 0, 6, 3);
    g.fillStyle = '#f0c090'; g.fillRect(5, 3, 6, 5);
    g.fillStyle = '#151525'; g.fillRect(6, 5, 1, 1); g.fillRect(9, 5, 1, 1);
    g.fillStyle = '#c98d63'; g.fillRect(7, 7, 2, 1);
    g.fillStyle = '#3f6fd0'; g.fillRect(4, 8, 8, 8);
    g.fillStyle = '#2a2a3a'; g.fillRect(4, 13, 8, 1);
    g.fillStyle = '#f0c090'; g.fillRect(2, 8, 2, 6); g.fillRect(12, 8, 2, 6);
    g.fillStyle = '#2a3a5a'; g.fillRect(4, 16, 3, 6); g.fillRect(9, 16, 3, 6);
    g.fillStyle = '#4a3020'; g.fillRect(3, 21, 4, 3); g.fillRect(9, 21, 4, 3);
  }
  function tCoin(g) {
    g.fillStyle = '#ffd94a'; g.fillRect(4, 2, 4, 1); g.fillRect(2, 3, 8, 1);
    g.fillRect(1, 4, 10, 4); g.fillRect(2, 8, 8, 1); g.fillRect(4, 9, 4, 1);
    g.fillStyle = '#fff3a8'; g.fillRect(4, 4, 2, 4);
    g.fillStyle = '#d9a520'; g.fillRect(7, 4, 1, 4);
  }
  function tGem(g) {
    g.fillStyle = '#7ff2ff'; g.fillRect(5, 1, 2, 1);
    g.fillStyle = '#5fe0f5'; g.fillRect(3, 2, 6, 1);
    g.fillStyle = '#3fd0ee'; g.fillRect(2, 3, 8, 3);
    g.fillStyle = '#2fb8d8'; g.fillRect(3, 6, 6, 2);
    g.fillStyle = '#28a0c0'; g.fillRect(4, 8, 4, 2);
    g.fillStyle = '#c9faff'; g.fillRect(4, 4, 2, 2);
  }
  function tPotion(g) {
    g.fillStyle = '#c8b090'; g.fillRect(5, 0, 2, 2);
    g.fillStyle = '#9fd8e8'; g.fillRect(4, 2, 4, 2);
    g.fillStyle = '#e04a4a'; g.fillRect(3, 4, 6, 7); g.fillRect(2, 5, 1, 5); g.fillRect(9, 5, 1, 5);
    g.fillStyle = '#ff8f8f'; g.fillRect(4, 6, 2, 4);
    g.fillStyle = '#a03030'; g.fillRect(3, 10, 6, 1);
  }
  function tChest(g) {
    g.fillStyle = '#8a5a28'; g.fillRect(1, 3, 10, 8);
    g.fillStyle = '#a8703a'; g.fillRect(1, 3, 10, 2);
    g.fillStyle = '#5a3a18'; g.fillRect(1, 6, 10, 1);
    g.fillStyle = '#ffd94a'; g.fillRect(4, 5, 4, 3);
    g.fillStyle = '#5a3a18'; g.fillRect(5, 6, 2, 1);
    g.fillStyle = '#4a2e12'; g.fillRect(0, 2, 12, 1); g.fillRect(0, 10, 12, 1);
  }
  function tParticle(g) {
    var grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,240,160,0.7)');
    grad.addColorStop(1, 'rgba(255,220,80,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 16, 16);
  }
  function tCloud(g) {
    var r = rngFrom(31337);
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

  /* ============================================================ PNG CROP */
  function cropTransparent(img, cb) {
    var w = img.width, h = img.height;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var data;
    try { data = g.getImageData(0, 0, w, h).data; }
    catch (e) { cb(img, w, h); return; }
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      var row = y * w * 4;
      for (var x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { cb(img, w, h); return; }
    var cw = maxX - minX + 1;
    var chh = maxY - minY + 1;
    var cc = document.createElement('canvas');
    cc.width = cw; cc.height = chh;
    cc.getContext('2d').drawImage(c, minX, minY, cw, chh, 0, 0, cw, chh);
    console.log('[crop] ' + w + 'x' + h + ' → ' + cw + 'x' + chh);
    cb(cc, cw, chh);
  }
  GTF.cropTransparent = cropTransparent;

  /* ============================================================ PARTICLES */
  var particlePool = [];
  function initParticles(scene) {
    var tex = cvsTex(16, 16, tParticle, false);
    for (var i = 0; i < 100; i++) {
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
  GTF.initParticles = initParticles;
  GTF.spawnParticles = spawnParticles;
  GTF.updateParticles = updateParticles;

  /* ============================================================ BIRDS / CLOUDS */
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
  GTF.initBirds = initBirds;
  GTF.updateBirds = updateBirds;
  GTF.initClouds = initClouds;
  GTF.updateClouds = updateClouds;

  /* ============================================================ SCENE STATE */
  GTF.scene = null;
  GTF.camera = null;
  GTF.renderer = null;
  GTF.chunks = new Map();
  GTF.chunkQueue = [];
  GTF.collectedItems = new Set();
  GTF.itemMaterials = {};
  GTF.waterPlane = null;
  GTF.waterMaterial = null;
  GTF.terrainMaterial = null;
  GTF.barkMaterial = null;
  GTF.leafMaterial = null;
  GTF.crystalMaterial = null;
  GTF.mushroomCapMaterial = null;
  GTF.playerSprite = null;
  var lastPlayerChunk = '';

  var daySkyColor = new THREE.Color(0x9cc6ec);
  var nightSkyColor = new THREE.Color(0x141d33);
  var sunsetSkyColor = new THREE.Color(0xff9a5c);
  var currentSkyColor = new THREE.Color();

  /* ============================================================ WATER */
  function buildWaterPlane(scene) {
    var geo = new THREE.PlaneGeometry(600, 600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshLambertMaterial({
      map: cvsTex(16, 16, tWater),
      transparent: true, opacity: 0.72,
      depthWrite: false, color: 0xa8d4ff,
      side: THREE.DoubleSide
    });
    GTF.waterMaterial = mat;
    var plane = new THREE.Mesh(geo, mat);
    plane.position.set(0, SEA_LEVEL, 0);
    plane.renderOrder = -1;
    scene.add(plane);
    return plane;
  }

  /* ============================================================ ITEMS */
  function makeItemSprite(typ, x, z) {
    var base = GTF.itemMaterials[typ];
    var s = new THREE.Sprite(base.clone());
    s.center.set(0.5, 0.5);
    s.scale.set(0.75, 0.75, 1);
    var h = GTF.heightAt(x, z);
    s.position.set(x, h + 0.7, z);
    s.userData.baseY = h + 0.7;
    s.userData.phase = hash2(Math.floor(x), Math.floor(z), GTF.SEED + 1717) * Math.PI * 2;
    s.userData.key = Math.round(x) + ',' + Math.round(z);
    s.userData.typ = typ;
    s.userData.value = typ === 'coin' ? 1 : typ === 'potion' ? 3 : typ === 'gem' ? 5 : 12;
    return s;
  }

  /* ============================================================ CHUNKS */
  function buildChunk(cx, cz) {
    var scene = GTF.scene;
    var group = new THREE.Group();
    var terrainGeo = GTF.buildChunkTerrainGeo(cx, cz);
    group.add(new THREE.Mesh(terrainGeo, GTF.terrainMaterial));

    var trunkAccum = new GTF.GeoAccum();
    var leafAccum = new GTF.GeoAccum();
    var spireAccum = new GTF.GeoAccum();
    var crystalAccum = new GTF.GeoAccum();
    var mushStalkAccum = new GTF.GeoAccum();
    var mushCapAccum = new GTF.GeoAccum();
    var itemSprites = [];

    var baseX = cx * CHUNK, baseZ = cz * CHUNK;

    // Trees & big features on 2-unit grid
    for (var lz = 0; lz < CHUNK; lz += 2) {
      for (var lx = 0; lx < CHUNK; lx += 2) {
        var jx = (hash2(baseX + lx, baseZ + lz, GTF.SEED + 3001) - 0.5) * 0.9;
        var jz = (hash2(baseX + lx, baseZ + lz, GTF.SEED + 3002) - 0.5) * 0.9;
        var wx = baseX + lx + 1 + jx, wz = baseZ + lz + 1 + jz;
        if (GTF.hasTreeAt(wx, wz)) GTF.spawnTree(trunkAccum, leafAccum, wx, wz);
        else if (GTF.hasMushroomAt(wx, wz)) GTF.spawnMushroom(mushStalkAccum, mushCapAccum, wx, wz);
        else if (GTF.hasCrystalAt(wx, wz)) GTF.spawnCrystal(crystalAccum, wx, wz);
        else if (GTF.hasSpireAt(wx, wz)) GTF.spawnSpire(spireAccum, wx, wz);
        else if (GTF.hasRockAt(wx, wz)) GTF.spawnRock(spireAccum, wx, wz);
      }
    }

    // Small flowers on 1-unit grid
    for (var fz = 0; fz < CHUNK; fz += 1) {
      for (var fx = 0; fx < CHUNK; fx += 1) {
        var fjx = (hash2(baseX + fx, baseZ + fz, GTF.SEED + 3501) - 0.5) * 0.6;
        var fjz = (hash2(baseX + fx, baseZ + fz, GTF.SEED + 3502) - 0.5) * 0.6;
        var fwx = baseX + fx + 0.5 + fjx, fwz = baseZ + fz + 0.5 + fjz;
        if (GTF.hasFlowerAt(fwx, fwz)) GTF.spawnFlower(leafAccum, fwx, fwz);
      }
    }

    // Items on 3-unit grid
    for (var iz = 0; iz < CHUNK; iz += 3) {
      for (var ix = 0; ix < CHUNK; ix += 3) {
        var jx2 = (hash2(baseX + ix, baseZ + iz, GTF.SEED + 3011) - 0.5) * 1.4;
        var jz2 = (hash2(baseX + ix, baseZ + iz, GTF.SEED + 3012) - 0.5) * 1.4;
        var wx2 = baseX + ix + 1.5 + jx2, wz2 = baseZ + iz + 1.5 + jz2;
        if (!GTF.hasItemAt(wx2, wz2)) continue;
        var key = Math.round(wx2) + ',' + Math.round(wz2);
        if (GTF.collectedItems.has(key)) continue;
        var typ = GTF.itemTypeAt(wx2, wz2);
        var sp = makeItemSprite(typ, wx2, wz2);
        group.add(sp);
        itemSprites.push(sp);
      }
    }

    function addMesh(accum, mat) {
      if (accum.pos.length === 0) return null;
      var m = new THREE.Mesh(accum.toGeometry(), mat);
      group.add(m);
      return m;
    }
    var trunkMesh = addMesh(trunkAccum, GTF.barkMaterial);
    var leafMesh = addMesh(leafAccum, GTF.leafMaterial);
    var spireMesh = addMesh(spireAccum, GTF.barkMaterial);
    var crystalMesh = addMesh(crystalAccum, GTF.crystalMaterial);
    var mushStalkMesh = addMesh(mushStalkAccum, GTF.barkMaterial);
    var mushCapMesh = addMesh(mushCapAccum, GTF.mushroomCapMaterial);

    scene.add(group);
    return {
      key: cx + ',' + cz, cx: cx, cz: cz, group: group,
      terrainGeo: terrainGeo,
      meshes: [trunkMesh, leafMesh, spireMesh, crystalMesh, mushStalkMesh, mushCapMesh],
      items: itemSprites
    };
  }
  GTF.buildChunk = buildChunk;

  function disposeChunk(chunk) {
    GTF.scene.remove(chunk.group);
    if (chunk.terrainGeo) chunk.terrainGeo.dispose();
    chunk.meshes.forEach(function (m) { if (m && m.geometry) m.geometry.dispose(); });
    for (var i = 0; i < chunk.items.length; i++) {
      if (chunk.items[i].material) chunk.items[i].material.dispose();
    }
  }

  function updateChunks(force) {
    var player = GTF.player;
    if (!player) return;
    var pcx = Math.floor(player.x / CHUNK);
    var pcz = Math.floor(player.z / CHUNK);
    var key = pcx + ',' + pcz;
    if (!force && key === lastPlayerChunk) return;
    lastPlayerChunk = key;
    for (var dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (var dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        var cx = pcx + dx, cz = pcz + dz;
        var k = cx + ',' + cz;
        if (GTF.chunks.has(k)) continue;
        var already = false;
        for (var q = 0; q < GTF.chunkQueue.length; q++) {
          if (GTF.chunkQueue[q].key === k) { already = true; break; }
        }
        if (already) continue;
        GTF.chunkQueue.push({ cx: cx, cz: cz, key: k, d: dx * dx + dz * dz });
      }
    }
    GTF.chunkQueue.sort(function (a, b) { return a.d - b.d; });
    var toRemove = [];
    GTF.chunks.forEach(function (chunk, k) {
      var dx = chunk.cx - pcx, dz = chunk.cz - pcz;
      if (Math.abs(dx) > VIEW_RADIUS + 1 || Math.abs(dz) > VIEW_RADIUS + 1) toRemove.push(k);
    });
    for (var i = 0; i < toRemove.length; i++) {
      var c = GTF.chunks.get(toRemove[i]);
      disposeChunk(c);
      GTF.chunks.delete(toRemove[i]);
    }
  }
  GTF.updateChunks = updateChunks;

  function processChunkQueue(ms) {
    var t0 = performance.now();
    while (GTF.chunkQueue.length > 0 && performance.now() - t0 < ms) {
      var job = GTF.chunkQueue.shift();
      if (GTF.chunks.has(job.key)) continue;
      GTF.chunks.set(job.key, buildChunk(job.cx, job.cz));
    }
  }
  GTF.processChunkQueue = processChunkQueue;

  /* ============================================================ DAY / NIGHT */
  var timeOfDay = 0.35;
  var hudTimeEl = document.getElementById('hudTime');

  function updateDayNight(dt) {
    var scene = GTF.scene, sunLight = GTF.sunLight,
      hemiLight = GTF.hemiLight, ambientLight = GTF.ambientLight,
      renderer = GTF.renderer;
    if (!scene || !sunLight) return;

    timeOfDay = (timeOfDay + dt / 90) % 1;
    var sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
    var sunY = Math.sin(sunAngle);
    var sunX = Math.cos(sunAngle);
    sunLight.position.set(sunX * 100, sunY * 100, 40);
    var dayAmount = smooth(-0.15, 0.25, sunY);
    var sunsetAmount = Math.max(0, 1 - Math.abs(sunY) * 4) * (1 - dayAmount) * 2;
    sunLight.intensity = 0.15 + dayAmount * 1.0;
    hemiLight.intensity = 0.25 + dayAmount * 0.65;
    ambientLight.intensity = 0.15 + dayAmount * 0.20;
    currentSkyColor.copy(nightSkyColor);
    currentSkyColor.lerp(daySkyColor, dayAmount);
    if (sunsetAmount > 0) currentSkyColor.lerp(sunsetSkyColor, Math.min(1, sunsetAmount) * 0.5);
    scene.background.copy(currentSkyColor);
    scene.fog.color.copy(currentSkyColor);
    renderer.setClearColor(currentSkyColor, 1);
    var hh = Math.floor(timeOfDay * 24);
    var mm = Math.floor((timeOfDay * 24 - hh) * 60);
    if (hudTimeEl) hudTimeEl.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  GTF.updateDayNight = updateDayNight;

  /* ============================================================ MINIMAP */
  var minimapEl = document.getElementById('minimap');
  var miniCtx = minimapEl ? minimapEl.getContext('2d') : null;
  function drawMinimap() {
    if (!miniCtx || !GTF.player || !GTF.cam) return;
    var W = minimapEl.width, H = minimapEl.height;
    var player = GTF.player, camYaw = GTF.cam.yaw;
    miniCtx.clearRect(0, 0, W, H);
    var RANGE = 140;
    var step = RANGE / W;
    for (var py = 0; py < H; py += 2) {
      for (var px = 0; px < W; px += 2) {
        var wx = player.x + (px - W / 2) * step;
        var wz = player.z + (py - H / 2) * step;
        var h = GTF.heightAt(wx, wz);
        var c;
        if (h < SEA_LEVEL) c = '#2f6fb5';
        else if (h < 1) c = '#e2cfa0';
        else if (h < 8) c = '#4e8f3c';
        else if (h < 13) c = '#8a8a93';
        else c = '#eff3fb';
        miniCtx.fillStyle = c;
        miniCtx.fillRect(px, py, 2, 2);
      }
    }
    miniCtx.strokeStyle = 'rgba(255,255,255,.2)';
    miniCtx.lineWidth = 1;
    miniCtx.beginPath();
    miniCtx.arc(W / 2, H / 2, W / 2 - 4, 0, Math.PI * 2);
    miniCtx.stroke();
    var dirX = -Math.sin(camYaw), dirZ = -Math.cos(camYaw);
    miniCtx.strokeStyle = '#ffea4a';
    miniCtx.lineWidth = 2;
    miniCtx.beginPath();
    miniCtx.moveTo(W / 2, H / 2);
    miniCtx.lineTo(W / 2 + dirX * 16, H / 2 + dirZ * 16);
    miniCtx.stroke();
    miniCtx.fillStyle = '#ff4444';
    miniCtx.beginPath();
    miniCtx.arc(W / 2, H / 2, 3.5, 0, Math.PI * 2);
    miniCtx.fill();
    miniCtx.strokeStyle = '#fff';
    miniCtx.lineWidth = 1;
    miniCtx.stroke();
  }
  GTF.drawMinimap = drawMinimap;

  /* ============================================================ SCENE SETUP */
  function setupScene() {
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc6ec);
    scene.fog = new THREE.Fog(0x9cc6ec, 40, 95);
    GTF.scene = scene;

    GTF.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 320);

    GTF.hemiLight = new THREE.HemisphereLight(0xd6ecff, 0x556b50, 0.78);
    scene.add(GTF.hemiLight);
    GTF.sunLight = new THREE.DirectionalLight(0xffe9c9, 1.05);
    GTF.sunLight.position.set(60, 100, 45);
    scene.add(GTF.sunLight);
    GTF.ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
    scene.add(GTF.ambientLight);

    GTF.terrainMaterial = new THREE.MeshLambertMaterial({
      map: cvsTex(16, 16, tGrass), vertexColors: true
    });
    GTF.barkMaterial = new THREE.MeshLambertMaterial({
      map: cvsTex(16, 16, tBark), vertexColors: true
    });
    GTF.leafMaterial = new THREE.MeshLambertMaterial({
      map: cvsTex(16, 16, tLeaves), vertexColors: true
    });
    GTF.crystalMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: 0x446688,
      emissiveIntensity: 0.55
    });
    GTF.mushroomCapMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: 0x330000,
      emissiveIntensity: 0.35
    });

    GTF.itemMaterials.coin = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tCoin, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.potion = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tPotion, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.gem = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tGem, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.chest = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tChest, false), transparent: true, alphaTest: 0.4 });

    GTF.waterPlane = buildWaterPlane(scene);

    var fallbackTex = cvsTex(16, 24, tPlayerFallback, false);
    var pMat = new THREE.SpriteMaterial({
      map: fallbackTex, transparent: true, alphaTest: 0.5, depthWrite: true
    });
    GTF.playerSprite = new THREE.Sprite(pMat);
    GTF.playerSprite.center.set(0.5, 0.0);
    var spriteHeight = 1.8;
    GTF.playerSprite.userData.baseScaleX = spriteHeight * (16 / 24);
    GTF.playerSprite.userData.baseScaleY = spriteHeight;
    GTF.playerSprite.scale.set(GTF.playerSprite.userData.baseScaleX, spriteHeight, 1);
    scene.add(GTF.playerSprite);

    initParticles(scene);
    initBirds(scene);
    initClouds(scene);
    return scene;
  }
  GTF.setupScene = setupScene;

  /* ============================================================ APPLY PROBED TEXTURES */
  function applyTextures(texMap) {
    applyProbedTexture(GTF.terrainMaterial, texMap['assets/grass.png']);
    applyProbedTexture(GTF.barkMaterial, texMap['assets/tree_bark.png']);
    applyProbedTexture(GTF.leafMaterial, texMap['assets/tree_leaves.png']);
    applyProbedTexture(GTF.waterMaterial, texMap['assets/water.png']);
    applyProbedSprite(GTF.itemMaterials.coin, texMap['assets/coin.png']);
    applyProbedSprite(GTF.itemMaterials.potion, texMap['assets/potion.png']);
    applyProbedSprite(GTF.itemMaterials.gem, texMap['assets/gem.png']);
    applyProbedSprite(GTF.itemMaterials.chest, texMap['assets/chest.png']);
    applyPlayerTexture(texMap['assets/player.png'], GTF.playerSprite);
  }
  GTF.applyTextures = applyTextures;

})();
