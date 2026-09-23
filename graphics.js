/* graphics.js — dramatic Webgl renderer: PBR-ish shading, soft shadows,
   procedural sky, planar water reflections, dynamic weather (rain / storm /
   snow / fog / overcast), bloom + ACES post-processing and a looping
   soundtrack.  Depends on terrain.js being loaded first. */
(function () {
  'use strict';
  var GTF = window.GTF = window.GTF || {};

  /* Short-hand terrain helpers (must exist — loaded from terrain.js) */
  var hash2 = GTF.hash2;
  var smooth = GTF.smoothstep;
  var CHUNK = GTF.CHUNK;
  var VIEW_RADIUS = GTF.VIEW_RADIUS;
  var SEA_LEVEL = GTF.SEA_LEVEL;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function srgb(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

  var _v1 = new THREE.Vector3();
  var _v2 = new THREE.Vector3();
  var _v3 = new THREE.Vector3();

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

          /* --- cinematic defaults --- */
          r.shadowMap.enabled = true;
          r.shadowMap.type = THREE.PCFSoftShadowMap;
          r.toneMapping = THREE.NoToneMapping;      // done in the composite pass
          r.outputEncoding = THREE.LinearEncoding;  // composite writes sRGB itself

          r.domElement.style.width = '100%';
          r.domElement.style.height = '100%';
          GTF.pixelRatio = pr;
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
    t.encoding = THREE.sRGBEncoding;
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
    t.encoding = THREE.sRGBEncoding;
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
      tex.encoding = THREE.sRGBEncoding;
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
    t.encoding = THREE.sRGBEncoding;
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
  function tSoftDot(g) {
    var grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 16, 16);
  }
  function tBlobShadow(g) {
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
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
      p.sprite.material.color.setHex(color || 0xfff0a0).convertSRGBToLinear();
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
  var birds = [], clouds = [], cloudMaterial = null;

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
    var wc = weather.cur;
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i];
      /* birds hide in bad weather */
      var vis = wc.rain < 0.35 && wc.snow < 0.35;
      b.visible = vis;
      if (!vis) continue;
      b.userData.angle += b.userData.speed * dt * (1 + wc.wind * 0.5);
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
    cloudMaterial = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.75 });
    for (var i = 0; i < 26; i++) {
      var s = new THREE.Sprite(cloudMaterial);
      s.center.set(0.5, 0.5);
      var ang = Math.random() * Math.PI * 2;
      var rad = 30 + Math.random() * 70;
      var sz = 8 + Math.random() * 12;
      s.scale.set(sz, sz * 0.6, 1);
      s.position.set(Math.cos(ang) * rad, 30 + Math.random() * 15, Math.sin(ang) * rad);
      s.userData.angle = ang; s.userData.radius = rad;
      s.userData.speed = 0.008 + Math.random() * 0.012;
      s.userData.baseY = s.position.y;
      scene.add(s);
      clouds.push(s);
    }
  }
  function updateClouds(dt) {
    var player = GTF.player;
    if (!player) return;
    var wc = weather.cur;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.userData.angle += c.userData.speed * dt * (1 + wc.wind * 1.6);
      c.position.x = player.x + Math.cos(c.userData.angle) * c.userData.radius;
      c.position.z = player.z + Math.sin(c.userData.angle) * c.userData.radius;
      c.position.y = c.userData.baseY - wc.cloud * 8;   /* storm clouds hang lower */
      c.scale.y = c.scale.x * (0.45 + wc.cloud * 0.45);
      c.visible = wc.cloud > 0.05;
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
  GTF.sky = null;
  GTF.sunLight = null;
  GTF.hemiLight = null;
  GTF.ambientLight = null;
  var blobShadow = null;
  var lastPlayerChunk = '';

  /* time of day */
  var timeOfDay = 0.35;
  var hudTimeEl = document.getElementById('hudTime');
  var hudWxEl = document.getElementById('hudWx');
  var sunDir = new THREE.Vector3(0.4, 0.7, 0.3);
  var flash = 0;

  /* ============================================================ SKY DOME */
  var skyU = {
    uZenith: { value: srgb(0x2f6fc4) },
    uHorizon: { value: srgb(0xbcd8f2) },
    uGround: { value: srgb(0x6b6f7a) },
    uSunColor: { value: srgb(0xfff0d0) },
    uMoonColor: { value: srgb(0xcfe0ff) },
    uSunDir: { value: sunDir },
    uTime: { value: 0 },
    uCloudAmt: { value: 0.25 },
    uNight: { value: 0 },
    uWind: { value: 0.5 }
  };

  var SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = normalize(position);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_Position.z = gl_Position.w;',
    '}'
  ].join('\n');

  var SKY_FS = [
    'uniform vec3 uZenith, uHorizon, uGround, uSunColor, uMoonColor;',
    'uniform vec3 uSunDir;',
    'uniform float uTime, uCloudAmt, uNight, uWind;',
    'varying vec3 vDir;',
    'float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i);',
    '  float b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0));',
    '  float d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }',
    '  return v;',
    '}',
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float h = d.y;',
    '  float t = pow(clamp(h, 0.0, 1.0), 0.55);',
    '  vec3 col = mix(uHorizon, uZenith, t);',
    '  col = mix(col, uGround, smoothstep(0.0, -0.28, h));',
    '  float sd = max(dot(d, uSunDir), 0.0);',
    '  col += uSunColor * (pow(sd, 1400.0) * 14.0 + pow(sd, 40.0) * 0.45 + pow(sd, 6.0) * 0.10);',
    '  float md = max(dot(d, -uSunDir), 0.0);',
    '  col += uMoonColor * (pow(md, 2600.0) * 5.0 + pow(md, 80.0) * 0.05) * uNight;',
    '  if (uNight > 0.01) {',
    '    vec3 sp = d * 95.0;',
    '    vec3 ip = floor(sp);',
    '    vec3 fp = fract(sp) - 0.5;',
    '    float hs = hash21(ip.xy + ip.z * 13.7);',
    '    float star = smoothstep(0.30, 0.0, length(fp)) * step(0.986, hs);',
    '    float tw = 0.55 + 0.45 * sin(uTime * 2.3 + hs * 90.0);',
    '    col += vec3(0.85, 0.90, 1.0) * star * tw * uNight * 1.7;',
    '  }',
    '  if (h > 0.012) {',
    '    vec2 cuv = d.xz / max(h, 0.012) * 0.5;',
    '    cuv += vec2(uTime * 0.0035 * uWind, uTime * 0.0018 * uWind);',
    '    float f = fbm(cuv * 1.25);',
    '    float cov = smoothstep(0.50, 0.80, f) * uCloudAmt;',
    '    vec3 ccol = mix(vec3(0.42, 0.45, 0.52), vec3(1.0, 0.98, 0.95), smoothstep(0.5, 0.92, f));',
    '    ccol = mix(ccol, uSunColor, pow(sd, 3.0) * 0.55);',
    '    ccol *= (0.35 + 0.85 * (1.0 - uNight * 0.8));',
    '    col = mix(col, ccol, cov * smoothstep(0.012, 0.14, h) * 0.96);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function buildSky(scene) {
    var geo = new THREE.SphereBufferGeometry(300, 32, 20);
    var mat = new THREE.ShaderMaterial({
      uniforms: skyU,
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    scene.add(mesh);
    return mesh;
  }

  /* ============================================================ WATER + REFLECTION */
  var reflRT = null;
  var reflCamera = null;
  var reflMatrix = new THREE.Matrix4();

  var WATER_VS = [
    'uniform float uTime;',
    'uniform mat4 uTexMatrix;',
    'varying vec4 vRefl;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'float wh(vec2 p, float t){',
    '  float h = 0.0;',
    '  h += sin(p.x * 0.31 + t * 1.10) * 0.20;',
    '  h += sin(p.y * 0.24 - t * 0.85) * 0.17;',
    '  h += sin((p.x + p.y) * 0.13 + t * 0.55) * 0.26;',
    '  h += sin((p.x - p.y * 0.7) * 0.55 - t * 1.60) * 0.075;',
    '  return h;',
    '}',
    'void main(){',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  float t = uTime;',
    '  float h = wh(wp.xz, t);',
    '  wp.y += h;',
    '  float e = 0.75;',
    '  float hx = wh(wp.xz + vec2(e, 0.0), t);',
    '  float hz = wh(wp.xz + vec2(0.0, e), t);',
    '  vNrm = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));',
    '  vWorld = wp.xyz;',
    '  vRefl = uTexMatrix * wp;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var WATER_FS = [
    'uniform sampler2D uRefl;',
    'uniform vec3 uSunDir, uSunCol, uDeep, uShallow, uFogColor;',
    'uniform float uTime, uFogDensity, uOpacity, uRain, uSunPow;',
    'varying vec4 vRefl;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'void main(){',
    '  vec3 N = normalize(vNrm);',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  if (uRain > 0.01) {',
    '    vec2 rp = vWorld.xz * 1.7;',
    '    float r = sin(rp.x * 3.0 + uTime * 9.0) * sin(rp.y * 3.3 - uTime * 8.0);',
    '    N = normalize(N + vec3(r, 0.0, r * 0.7) * 0.14 * uRain);',
    '  }',
    '  float ndv = clamp(dot(N, V), 0.0, 1.0);',
    '  float fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.2);',
    '  vec2 ruv = vRefl.xy / max(vRefl.w, 0.0001);',
    '  ruv += N.xz * 0.055;',
    '  ruv = clamp(ruv, vec2(0.002), vec2(0.998));',
    '  vec3 refl = texture2D(uRefl, ruv).rgb;',
    '  float dist = length(cameraPosition - vWorld);',
    '  float depthMix = clamp(dist / 60.0, 0.0, 1.0);',
    '  vec3 body = mix(uShallow, uDeep, depthMix);',
    '  vec3 col = mix(body, refl, clamp(fres * 1.15, 0.0, 0.96));',
    '  vec3 H = normalize(uSunDir + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 420.0);',
    '  col += uSunCol * spec * uSunPow;',
    '  float wide = pow(max(dot(N, H), 0.0), 24.0);',
    '  col += uSunCol * wide * 0.05 * uSunPow;',
    '  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);',
    '  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, uOpacity);',
    '}'
  ].join('\n');

  function buildWaterPlane(scene) {
    var geo = new THREE.PlaneBufferGeometry(600, 600, 96, 96);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTexMatrix: { value: new THREE.Matrix4() },
        uRefl: { value: null },
        uSunDir: { value: sunDir },
        uSunCol: { value: srgb(0xfff2d8) },
        uSunPow: { value: 1.0 },
        uDeep: { value: srgb(0x0d2f4d) },
        uShallow: { value: srgb(0x2a6c8f) },
        uFogColor: { value: srgb(0xbcd8f2) },
        uFogDensity: { value: 0.006 },
        uOpacity: { value: 0.86 },
        uRain: { value: 0 }
      },
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    GTF.waterMaterial = mat;
    var plane = new THREE.Mesh(geo, mat);
    plane.position.set(0, SEA_LEVEL, 0);
    plane.renderOrder = -1;
    plane.frustumCulled = false;
    scene.add(plane);
    return plane;
  }

  function initReflection(renderer) {
    var size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    var w = Math.max(64, Math.min(1024, (size.x * 0.5) | 0));
    var h = Math.max(64, Math.min(1024, (size.y * 0.5) | 0));
    var type = (renderer.capabilities.isWebGL2 ||
      renderer.extensions.has('OES_texture_half_float')) ? THREE.HalfFloatType : THREE.UnsignedByteType;
    reflRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: type,
      depthBuffer: true,
      stencilBuffer: false
    });
    reflRT.texture.encoding = THREE.LinearEncoding;
    reflCamera = new THREE.PerspectiveCamera();
    if (GTF.waterMaterial) GTF.waterMaterial.uniforms.uRefl.value = reflRT.texture;
    console.log('[water] reflection RT ' + w + 'x' + h);
  }
  GTF.initReflection = initReflection;

  function updateReflection(renderer, scene, camera) {
    if (!reflRT || !reflCamera || !GTF.waterPlane) return;
    var planeY = SEA_LEVEL;

    reflCamera.fov = camera.fov;
    reflCamera.aspect = camera.aspect;
    reflCamera.near = camera.near;
    reflCamera.far = camera.far;
    reflCamera.updateProjectionMatrix();

    reflCamera.position.set(camera.position.x, planeY * 2 - camera.position.y, camera.position.z);
    camera.getWorldDirection(_v1);
    var tx = camera.position.x + _v1.x;
    var ty = camera.position.y + _v1.y;
    var tz = camera.position.z + _v1.z;
    _v2.set(0, 1, 0).applyQuaternion(camera.quaternion);
    reflCamera.up.set(_v2.x, -_v2.y, _v2.z);
    reflCamera.lookAt(tx, planeY * 2 - ty, tz);
    reflCamera.updateMatrixWorld(true);

    reflMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    reflMatrix.multiply(reflCamera.projectionMatrix);
    reflMatrix.multiply(reflCamera.matrixWorldInverse);
    GTF.waterMaterial.uniforms.uTexMatrix.value.copy(reflMatrix);

    var water = GTF.waterPlane;
    water.visible = false;
    var sky = GTF.sky;
    if (sky) sky.position.copy(reflCamera.position);

    var prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(reflRT);
    renderer.render(scene, reflCamera);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = prevAuto;

    water.visible = true;
    if (sky) sky.position.copy(camera.position);
  }

  /* ============================================================ POST PROCESSING */
  var post = null;

  var QUAD_VS = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  var BRIGHT_FS = [
    'uniform sampler2D tDiffuse;',
    'uniform float uThreshold, uKnee;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
    '  float l = max(c.r, max(c.g, c.b));',
    '  float s = smoothstep(uThreshold, uThreshold + uKnee, l);',
    '  gl_FragColor = vec4(c * s, 1.0);',
    '}'
  ].join('\n');

  var BLUR_FS = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;',
    '  s += texture2D(tDiffuse, vUv + uDir * 1.3846).rgb * 0.316216;',
    '  s += texture2D(tDiffuse, vUv - uDir * 1.3846).rgb * 0.316216;',
    '  s += texture2D(tDiffuse, vUv + uDir * 3.2308).rgb * 0.070270;',
    '  s += texture2D(tDiffuse, vUv - uDir * 3.2308).rgb * 0.070270;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var COMP_FS = [
    'uniform sampler2D tScene;',
    'uniform sampler2D tBloom;',
    'uniform float uTime, uExposure, uBloom, uFlash, uVignette, uSat, uGrain;',
    'varying vec2 vUv;',
    'vec3 aces(vec3 x){',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'void main(){',
    '  vec3 c = texture2D(tScene, vUv).rgb;',
    '  c += texture2D(tBloom, vUv).rgb * uBloom;',
    '  c *= uExposure;',
    '  c *= 1.0 + uFlash * 2.2;',
    '  c = aces(c);',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(vec3(l), c, uSat);',
    '  vec2 q = vUv - 0.5;',
    '  float v = smoothstep(1.05, 0.22, length(q) * 1.45);',
    '  c *= mix(1.0, v, uVignette);',
    '  float g = fract(sin(dot(vUv * (uTime + 1.0), vec2(12.9898, 78.233))) * 43758.5453);',
    '  c += (g - 0.5) * uGrain;',
    '  gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);',
    '}'
  ].join('\n');

  function makePost(renderer) {
    var size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    var W = Math.max(4, size.x | 0), H = Math.max(4, size.y | 0);
    var halfOK = renderer.capabilities.isWebGL2 || renderer.extensions.has('OES_texture_half_float');
    var type = halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType;

    var sceneRT = new THREE.WebGLRenderTarget(W, H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: type, depthBuffer: true, stencilBuffer: false
    });
    var bw = Math.max(4, W >> 2), bh = Math.max(4, H >> 2);
    var brightRT = new THREE.WebGLRenderTarget(bw, bh, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: type, depthBuffer: false, stencilBuffer: false
    });
    var blurA = brightRT.clone();
    var blurB = brightRT.clone();

    var quadScene = new THREE.Scene();
    var quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var quadGeo = new THREE.PlaneBufferGeometry(2, 2);
    var quad = new THREE.Mesh(quadGeo, null);
    quad.frustumCulled = false;
    quadScene.add(quad);

    var brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.78 }, uKnee: { value: 0.55 } },
      vertexShader: QUAD_VS, fragmentShader: BRIGHT_FS,
      depthTest: false, depthWrite: false, toneMapped: false
    });
    var blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS, fragmentShader: BLUR_FS,
      depthTest: false, depthWrite: false, toneMapped: false
    });
    var compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uTime: { value: 0 },
        uExposure: { value: 1.05 },
        uBloom: { value: 0.62 },
        uFlash: { value: 0 },
        uVignette: { value: 0.85 },
        uSat: { value: 1.12 },
        uGrain: { value: 0.028 }
      },
      vertexShader: QUAD_VS, fragmentShader: COMP_FS,
      depthTest: false, depthWrite: false, toneMapped: false
    });

    var api = {
      sceneRT: sceneRT,
      material: compMat,
      render: function (r) {
        quad.material = brightMat;
        brightMat.uniforms.tDiffuse.value = sceneRT.texture;
        r.setRenderTarget(brightRT);
        r.render(quadScene, quadCam);

        quad.material = blurMat;
        blurMat.uniforms.tDiffuse.value = brightRT.texture;
        blurMat.uniforms.uDir.value.set(1 / bw, 0);
        r.setRenderTarget(blurA);
        r.render(quadScene, quadCam);

        blurMat.uniforms.tDiffuse.value = blurA.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / bh);
        r.setRenderTarget(blurB);
        r.render(quadScene, quadCam);

        blurMat.uniforms.tDiffuse.value = blurB.texture;
        blurMat.uniforms.uDir.value.set(2.2 / bw, 0);
        r.setRenderTarget(blurA);
        r.render(quadScene, quadCam);

        blurMat.uniforms.tDiffuse.value = blurA.texture;
        blurMat.uniforms.uDir.value.set(0, 2.2 / bh);
        r.setRenderTarget(blurB);
        r.render(quadScene, quadCam);

        quad.material = compMat;
        compMat.uniforms.tScene.value = sceneRT.texture;
        compMat.uniforms.tBloom.value = blurB.texture;
        r.setRenderTarget(null);
        r.render(quadScene, quadCam);
      },
      setSize: function (r, w, h) {
        sceneRT.setSize(w, h);
        var nw = Math.max(4, w >> 2), nh = Math.max(4, h >> 2);
        brightRT.setSize(nw, nh);
        blurA.setSize(nw, nh);
        blurB.setSize(nw, nh);
      }
    };
    return api;
  }

  /* ============================================================ WEATHER */
  var PROFILES = {
    clear:    { cloud: 0.22, fog: 0.0055, sun: 1.15, sky: 1.00, rain: 0.0, snow: 0.0, wind: 0.35, amb: 1.00, wet: 0.0 },
    overcast: { cloud: 0.85, fog: 0.0105, sun: 0.38, sky: 0.55, rain: 0.0, snow: 0.0, wind: 0.75, amb: 0.88, wet: 0.2 },
    rain:     { cloud: 0.95, fog: 0.0150, sun: 0.22, sky: 0.40, rain: 1.0, snow: 0.0, wind: 0.95, amb: 0.76, wet: 1.0 },
    storm:    { cloud: 1.00, fog: 0.0230, sun: 0.12, sky: 0.24, rain: 1.7, snow: 0.0, wind: 1.70, amb: 0.62, wet: 1.0 },
    snow:     { cloud: 0.80, fog: 0.0170, sun: 0.38, sky: 0.62, rain: 0.0, snow: 1.0, wind: 0.50, amb: 0.92, wet: 0.3 },
    fog:      { cloud: 0.60, fog: 0.0400, sun: 0.50, sky: 0.72, rain: 0.0, snow: 0.0, wind: 0.15, amb: 0.95, wet: 0.5 }
  };
  var WEATHER_ORDER = ['clear', 'overcast', 'rain', 'storm', 'snow', 'fog'];

  var weather = GTF.weather = {
    type: 'clear',
    cur: Object.assign({}, PROFILES.clear),
    timer: 55,
    wetness: 0,
    time: 0,
    boltTimer: 4,
    flash: 0
  };

  /* --- rain --- */
  var RAIN_N = 2000;
  var rainGeo = null, rainPos = null, rainData = null, rainMesh = null;

  function initRain(scene) {
    rainPos = new Float32Array(RAIN_N * 6);
    rainData = new Array(RAIN_N);
    for (var i = 0; i < RAIN_N; i++) {
      rainData[i] = {
        x: rnd(-30, 30), y: rnd(-5, 35), z: rnd(-30, 30),
        sp: rnd(30, 46), len: rnd(0.7, 1.5)
      };
    }
    rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    rainGeo.setDrawRange(0, RAIN_N * 2);
    var mat = new THREE.LineBasicMaterial({
      color: srgb(0xa9c8e8), transparent: true, opacity: 0.42, depthWrite: false, fog: false
    });
    rainMesh = new THREE.LineSegments(rainGeo, mat);
    rainMesh.frustumCulled = false;
    rainMesh.visible = false;
    scene.add(rainMesh);
  }

  function updateRain(dt, px, py, pz, amount) {
    if (!rainMesh) return;
    rainMesh.visible = amount > 0.03;
    if (!rainMesh.visible) return;
    rainMesh.material.opacity = 0.18 + amount * 0.30;
    var w = weather.cur.wind * 4.5;
    for (var i = 0; i < RAIN_N; i++) {
      var d = rainData[i];
      d.y -= d.sp * dt;
      d.x += w * dt;
      if (d.y < py - 16 || Math.abs(d.x - px) > 42 || Math.abs(d.z - pz) > 42) {
        d.y = py + rnd(16, 34);
        d.x = px + rnd(-28, 28);
        d.z = pz + rnd(-28, 28);
      }
      var j = i * 6;
      rainPos[j] = d.x;
      rainPos[j + 1] = d.y;
      rainPos[j + 2] = d.z;
      rainPos[j + 3] = d.x - w * 0.035;
      rainPos[j + 4] = d.y + d.len;
      rainPos[j + 5] = d.z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  /* --- snow --- */
  var SNOW_N = 1400;
  var snowGeo = null, snowPos = null, snowData = null, snowPts = null;

  function initSnow(scene) {
    snowPos = new Float32Array(SNOW_N * 3);
    snowData = new Array(SNOW_N);
    for (var i = 0; i < SNOW_N; i++) {
      snowData[i] = {
        x: rnd(-28, 28), y: rnd(-5, 30), z: rnd(-28, 28),
        sp: rnd(1.2, 3.2), ph: Math.random() * 6.28
      };
      snowPos[i * 3] = snowData[i].x;
      snowPos[i * 3 + 1] = snowData[i].y;
      snowPos[i * 3 + 2] = snowData[i].z;
    }
    snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    var mat = new THREE.PointsMaterial({
      map: cvsTex(16, 16, tSoftDot, false),
      size: 0.32, sizeAttenuation: true, transparent: true,
      opacity: 0.9, depthWrite: false, fog: false,
      blending: THREE.NormalBlending
    });
    snowPts = new THREE.Points(snowGeo, mat);
    snowPts.frustumCulled = false;
    snowPts.visible = false;
    scene.add(snowPts);
  }

  function updateSnow(dt, px, py, pz, amount) {
    if (!snowPts) return;
    snowPts.visible = amount > 0.03;
    if (!snowPts.visible) return;
    snowPts.material.opacity = 0.35 + amount * 0.55;
    var w = weather.cur.wind * 2.5;
    var t = weather.time;
    for (var i = 0; i < SNOW_N; i++) {
      var d = snowData[i];
      d.y -= d.sp * dt;
      d.x += (Math.sin(t * 1.6 + d.ph) * 0.7 + w) * dt;
      d.z += Math.cos(t * 1.2 + d.ph * 1.4) * 0.6 * dt;
      if (d.y < py - 12 || Math.abs(d.x - px) > 40 || Math.abs(d.z - pz) > 40) {
        d.y = py + rnd(14, 30);
        d.x = px + rnd(-26, 26);
        d.z = pz + rnd(-26, 26);
      }
      snowPos[i * 3] = d.x;
      snowPos[i * 3 + 1] = d.y;
      snowPos[i * 3 + 2] = d.z;
    }
    snowGeo.attributes.position.needsUpdate = true;
  }

  /* --- thunder --- */
  function playThunder() {
    var ctx = GTF.audioCtx;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var dur = 2.4;
      var sr = ctx.sampleRate;
      var buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < d.length; i++) {
        var n = Math.random() * 2 - 1;
        last = last * 0.965 + n * 0.035;
        var tt = i / d.length;
        d[i] = last * Math.pow(1 - tt, 2.3) * 5.5;
      }
      var src = ctx.createBufferSource(); src.buffer = buf;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      src.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start();
    } catch (e) { }
  }

  /* --- looping rain ambience --- */
  var rainGain = null;
  function ensureRainAudio() {
    var ctx = GTF.audioCtx;
    if (!ctx || rainGain) return;
    try {
      var sr = ctx.sampleRate;
      var dur = 3;
      var buf = ctx.createBuffer(1, sr * dur, sr);
      var d = buf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      var src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.5;
      var g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp); bp.connect(g); g.connect(ctx.destination);
      src.start();
      rainGain = g;
    } catch (e) { }
  }

  function pickWeather() {
    var t = weather.type;
    var pool = [];
    for (var i = 0; i < WEATHER_ORDER.length; i++) {
      if (WEATHER_ORDER[i] === t) continue;
      pool.push(WEATHER_ORDER[i]);
      if (WEATHER_ORDER[i] === 'clear' || WEATHER_ORDER[i] === 'overcast') pool.push(WEATHER_ORDER[i]);
    }
    return pool[(Math.random() * pool.length) | 0];
  }

  function updateWeather(dt) {
    weather.time += dt;
    weather.timer -= dt;
    if (weather.timer <= 0) {
      weather.type = pickWeather();
      weather.timer = rnd(55, 140);
      console.log('[weather] → ' + weather.type);
    }
    var prof = PROFILES[weather.type];
    var k = 1 - Math.pow(0.16, dt);
    for (var key in prof) {
      if (weather.cur[key] === undefined) weather.cur[key] = prof[key];
      weather.cur[key] = lerp(weather.cur[key], prof[key], k);
    }

    /* ground wetness lags behind the rain */
    var wetTarget = weather.cur.wet;
    var rate = wetTarget > weather.wetness ? 0.35 : 0.10;
    weather.wetness += (wetTarget - weather.wetness) * Math.min(1, rate * dt * 4);

    /* lightning */
    if (weather.type === 'storm' && weather.cur.rain > 0.6) {
      weather.boltTimer -= dt;
      if (weather.boltTimer <= 0) {
        weather.boltTimer = rnd(2.0, 8.0);
        weather.flash = 1;
        var delay = rnd(250, 2600);
        setTimeout(playThunder, delay);
      }
    }
    weather.flash = Math.max(0, weather.flash - dt * 3.2);
    flash = weather.flash * weather.flash;

    if (hudWxEl) hudWxEl.textContent = weather.type.toUpperCase();

    /* audio */
    if (GTF.audioCtx) {
      if (!rainGain) ensureRainAudio();
      if (rainGain) {
        var target = Math.min(0.09, weather.cur.rain * 0.055 + weather.cur.snow * 0.012);
        rainGain.gain.value += (target - rainGain.gain.value) * Math.min(1, dt * 2);
      }
    }

    /* particle systems */
    var p = GTF.player;
    if (p) {
      updateRain(dt, p.x, p.y, p.z, weather.cur.rain);
      updateSnow(dt, p.x, p.y, p.z, weather.cur.snow);
    }
  }
  GTF.updateWeather = updateWeather;

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
    if (terrainGeo && !terrainGeo.attributes.normal) terrainGeo.computeVertexNormals();

    var terrainMesh = new THREE.Mesh(terrainGeo, GTF.terrainMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = false;
    group.add(terrainMesh);

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

    function addMesh(accum, mat, cast) {
      if (accum.pos.length === 0) return null;
      var g = accum.toGeometry();
      if (!g.attributes.normal) g.computeVertexNormals();
      var m = new THREE.Mesh(g, mat);
      m.castShadow = !!cast;
      m.receiveShadow = true;
      group.add(m);
      return m;
    }
    var trunkMesh = addMesh(trunkAccum, GTF.barkMaterial, true);
    var leafMesh = addMesh(leafAccum, GTF.leafMaterial, true);
    var spireMesh = addMesh(spireAccum, GTF.barkMaterial, true);
    var crystalMesh = addMesh(crystalAccum, GTF.crystalMaterial, true);
    var mushStalkMesh = addMesh(mushStalkAccum, GTF.barkMaterial, true);
    var mushCapMesh = addMesh(mushCapAccum, GTF.mushroomCapMaterial, true);

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

  /* ============================================================ DAY / NIGHT + SKY */
  var dayZenith = srgb(0x2f6fc4);
  var dayHorizon = srgb(0xbcd8f2);
  var dayGround = srgb(0x6d7280);
  var nightZenith = srgb(0x05070f);
  var nightHorizon = srgb(0x101c30);
  var nightGround = srgb(0x05070c);
  var sunsetHorizon = srgb(0xff6a2a);
  var sunsetZenith = srgb(0x39406e);
  var sunColDay = srgb(0xfff3dc);
  var sunColSet = srgb(0xff9a4d);
  var moonCol = srgb(0xcfe0ff);
  var _fogCol = new THREE.Color();

  function updateDayNight(dt) {
    var scene = GTF.scene, sun = GTF.sunLight, hemi = GTF.hemiLight, amb = GTF.ambientLight;
    if (!scene || !sun) return;

    timeOfDay = (timeOfDay + dt / 150) % 1;
    var sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
    var sunY = Math.sin(sunAngle);
    var sunX = Math.cos(sunAngle);
    sunDir.set(sunX, sunY, 0.35).normalize();

    var dayAmount = smooth(-0.14, 0.24, sunY);
    var sunset = Math.max(0, 1 - Math.abs(sunY) * 4.5);
    var wc = weather.cur;

    /* ---- sky dome ---- */
    skyU.uZenith.value.copy(nightZenith).lerp(dayZenith, dayAmount);
    skyU.uHorizon.value.copy(nightHorizon).lerp(dayHorizon, dayAmount);
    skyU.uGround.value.copy(nightGround).lerp(dayGround, dayAmount);
    skyU.uHorizon.value.lerp(sunsetHorizon, sunset * 0.75 * dayAmount + sunset * 0.25);
    skyU.uZenith.value.lerp(sunsetZenith, sunset * 0.5 * dayAmount);
    skyU.uZenith.value.multiplyScalar(wc.sky);
    skyU.uHorizon.value.multiplyScalar(wc.sky);
    skyU.uGround.value.multiplyScalar(wc.sky);
    skyU.uSunColor.value.copy(sunColDay).lerp(sunColSet, sunset);
    skyU.uMoonColor.value.copy(moonCol);
    skyU.uNight.value = 1 - dayAmount;
    skyU.uCloudAmt.value = wc.cloud;
    skyU.uWind.value = 0.3 + wc.wind;
    skyU.uTime.value = weather.time;

    /* ---- lights ---- */
    sun.color.copy(sunColDay).lerp(sunColSet, sunset);
    sun.intensity = (0.10 + dayAmount * 1.35) * wc.sun + flash * 4.0;
    hemi.intensity = (0.20 + dayAmount * 0.62) * wc.amb + flash * 2.0;
    amb.intensity = (0.10 + dayAmount * 0.24) * wc.amb + flash * 1.6;
    hemi.color.copy(skyU.uHorizon.value);
    hemi.groundColor.copy(skyU.uGround.value);

    /* ---- fog / background ---- */
    _fogCol.copy(skyU.uHorizon.value).multiplyScalar(0.92);
    scene.fog.color.copy(_fogCol);
    scene.fog.density = wc.fog * (1.0 + (1 - dayAmount) * 0.25);
    if (scene.background && scene.background.isColor) scene.background.copy(_fogCol);
    GTF.renderer.setClearColor(_fogCol, 1);

    /* ---- water uniforms ---- */
    var wu = GTF.waterMaterial && GTF.waterMaterial.uniforms;
    if (wu) {
      wu.uTime.value = weather.time;
      wu.uFogColor.value.copy(_fogCol);
      wu.uFogDensity.value = scene.fog.density;
      wu.uSunCol.value.copy(sun.color).multiplyScalar(0.35 + dayAmount * 0.95);
      wu.uSunPow.value = (0.25 + dayAmount * 1.1) * wc.sun + flash * 3.0;
      wu.uRain.value = Math.min(1.5, wc.rain);
      var shade = 0.35 + dayAmount * 0.65;
      wu.uDeep.value.setRGB(0.012 * shade, 0.055 * shade, 0.10 * shade);
      wu.uShallow.value.setRGB(0.05 * shade, 0.18 * shade, 0.26 * shade);
    }

    /* ---- wet materials ---- */
    var wet = weather.wetness;
    if (GTF.terrainMaterial) {
      GTF.terrainMaterial.roughness = lerp(0.98, 0.45, wet);
      GTF.terrainMaterial.color.setScalar(lerp(1.0, 0.72, wet));
    }
    if (GTF.barkMaterial) GTF.barkMaterial.roughness = lerp(0.95, 0.55, wet);

    /* ---- cloud tint ---- */
    if (cloudMaterial) {
      cloudMaterial.color.copy(skyU.uHorizon.value).lerp(new THREE.Color(1, 1, 1), 0.55);
      cloudMaterial.opacity = 0.32 + wc.cloud * 0.5;
    }

    /* ---- HUD clock ---- */
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
    scene.background = srgb(0x9cc6ec);
    scene.fog = new THREE.FogExp2(srgb(0xbcd8f2), 0.006);
    GTF.scene = scene;

    var camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 420);
    GTF.camera = camera;

    /* ---- lights ---- */
    GTF.hemiLight = new THREE.HemisphereLight(0xd6ecff, 0x556b50, 0.78);
    scene.add(GTF.hemiLight);

    GTF.sunLight = new THREE.DirectionalLight(0xffe9c9, 1.05);
    GTF.sunLight.position.set(60, 100, 45);
    GTF.sunLight.castShadow = true;
    var sc = GTF.sunLight.shadow;
    sc.mapSize.set(2048, 2048);
    sc.camera.near = 1;
    sc.camera.far = 260;
    sc.camera.left = -46;
    sc.camera.right = 46;
    sc.camera.top = 46;
    sc.camera.bottom = -46;
    sc.bias = -0.0006;
    sc.normalBias = 0.06;
    scene.add(GTF.sunLight);
    scene.add(GTF.sunLight.target);

    GTF.ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
    scene.add(GTF.ambientLight);

    /* ---- sky ---- */
    GTF.sky = buildSky(scene);

    /* ---- materials (PBR) ---- */
    GTF.terrainMaterial = new THREE.MeshStandardMaterial({
      map: cvsTex(16, 16, tGrass), vertexColors: true,
      roughness: 0.98, metalness: 0.0
    });
    GTF.barkMaterial = new THREE.MeshStandardMaterial({
      map: cvsTex(16, 16, tBark), vertexColors: true,
      roughness: 0.95, metalness: 0.0
    });
    GTF.leafMaterial = new THREE.MeshStandardMaterial({
      map: cvsTex(16, 16, tLeaves), vertexColors: true,
      roughness: 0.9, metalness: 0.0
    });
    GTF.crystalMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.12, metalness: 0.25,
      emissive: srgb(0x4488cc), emissiveIntensity: 1.35
    });
    GTF.mushroomCapMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6, metalness: 0.0,
      emissive: srgb(0x551111), emissiveIntensity: 0.55
    });

    GTF.itemMaterials.coin = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tCoin, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.potion = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tPotion, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.gem = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tGem, false), transparent: true, alphaTest: 0.4 });
    GTF.itemMaterials.chest = new THREE.SpriteMaterial({ map: cvsTex(12, 12, tChest, false), transparent: true, alphaTest: 0.4 });

    /* ---- water ---- */
    GTF.waterPlane = buildWaterPlane(scene);

    /* ---- blob shadow under the player ---- */
    var blobMat = new THREE.MeshBasicMaterial({
      map: cvsTex(64, 64, tBlobShadow, false),
      transparent: true, depthWrite: false, opacity: 0.7, fog: true
    });
    blobShadow = new THREE.Mesh(new THREE.PlaneBufferGeometry(1.9, 1.9), blobMat);
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.renderOrder = 2;
    scene.add(blobShadow);

    /* ---- player billboard ---- */
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

    /* ---- weather particles ---- */
    initRain(scene);
    initSnow(scene);

    initParticles(scene);
    initBirds(scene);
    initClouds(scene);

    /* ---- post processing ---- */
    try {
      post = makePost(GTF.renderer);
      console.log('[post] bloom chain ready');
    } catch (e) {
      post = null;
      console.warn('[post] disabled: ' + (e.message || e));
      GTF.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      GTF.renderer.toneMappingExposure = 1.05;
      GTF.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    try { initReflection(GTF.renderer); } catch (e) { console.warn('[water] no reflection: ' + e); }

    return scene;
  }
  GTF.setupScene = setupScene;

  /* ============================================================ APPLY PROBED TEXTURES */
  function applyTextures(texMap) {
    applyProbedTexture(GTF.terrainMaterial, texMap['assets/grass.png']);
    applyProbedTexture(GTF.barkMaterial, texMap['assets/tree_bark.png']);
    applyProbedTexture(GTF.leafMaterial, texMap['assets/tree_leaves.png']);
    /* water uses a shader now, but the png is still used as the shallow tint if present */
    applyProbedSprite(GTF.itemMaterials.coin, texMap['assets/coin.png']);
    applyProbedSprite(GTF.itemMaterials.potion, texMap['assets/potion.png']);
    applyProbedSprite(GTF.itemMaterials.gem, texMap['assets/gem.png']);
    applyProbedSprite(GTF.itemMaterials.chest, texMap['assets/chest.png']);
    applyPlayerTexture(texMap['assets/player.png'], GTF.playerSprite);
  }
  GTF.applyTextures = applyTextures;

  /* ============================================================ FRAME */
  function updateShadowFollow() {
    var sun = GTF.sunLight, player = GTF.player;
    if (!sun || !player) return;
    sun.target.position.set(player.x, player.y, player.z);
    sun.target.updateMatrixWorld();
    sun.position.set(
      player.x + sunDir.x * 90,
      player.y + sunDir.y * 90 + 6,
      player.z + sunDir.z * 90
    );
    sun.updateMatrixWorld();
  }

  function updateBlobShadow() {
    var player = GTF.player;
    if (!blobShadow || !player) return;
    var h = GTF.heightAt(player.x, player.z);
    blobShadow.position.set(player.x, h + 0.07, player.z);
    var nightDim = 1 - Math.min(0.6, (1 - smooth(-0.14, 0.24, sunDir.y)) * 0.6);
    blobShadow.material.opacity = 0.42 * nightDim * (1 - weather.wetness * 0.25);
  }

  function renderFrame(dt) {
    var renderer = GTF.renderer, scene = GTF.scene, camera = GTF.camera;
    if (!renderer || !scene || !camera) return;

    updateWeather(dt);
    updateShadowFollow();
    updateBlobShadow();

    if (GTF.sky) GTF.sky.position.copy(camera.position);

    /* planar reflection (mirror world below the sea level) */
    try {
      if (camera.position.y > SEA_LEVEL - 2) updateReflection(renderer, scene, camera);
    } catch (e) { /* keep rendering */ }

    if (post) {
      renderer.setRenderTarget(post.sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      post.material.uniforms.uTime.value = weather.time;
      post.material.uniforms.uFlash.value = flash;
      post.material.uniforms.uBloom.value = 0.55 + weather.cur.rain * 0.15;
      post.material.uniforms.uExposure.value = 1.05;
      post.material.uniforms.uVignette.value = 0.80 + weather.cur.cloud * 0.15;
      post.render(renderer);
    } else {
      renderer.render(scene, camera);
    }
  }
  GTF.renderFrame = renderFrame;

  function onResize() {
    var renderer = GTF.renderer, camera = GTF.camera;
    if (!renderer || !camera) return;
    var size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    if (post) post.setSize(renderer, Math.max(4, size.x | 0), Math.max(4, size.y | 0));
    if (reflRT) {
      var w = Math.max(64, Math.min(1024, (size.x * 0.5) | 0));
      var h = Math.max(64, Math.min(1024, (size.y * 0.5) | 0));
      reflRT.setSize(w, h);
    }
  }
  GTF.onResize = onResize;

})();
