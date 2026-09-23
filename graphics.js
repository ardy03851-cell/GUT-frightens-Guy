/* graphics.js — WebGL renderer, textures, materials, chunks, sprites,
   particles, day/night, minimap. Depends on terrain.js being loaded first. */
(function () {
'use strict';
var GTF = window.GTF = window.GTF || {};

/* Short-hand terrain helpers (must exist — loaded from terrain.js) */
var hash2  = GTF.hash2;
var smooth = GTF.smoothstep;
var CHUNK  = GTF.CHUNK;
var VIEW_RADIUS = GTF.VIEW_RADIUS;
var SEA_LEVEL   = GTF.SEA_LEVEL;

/* ============================================================ RENDERER */
function createRenderer() {
  var inIframe = false;
  try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
  var pr = Math.min(window.devicePixelRatio || 1, inIframe ? 1 : 1.5);
  var cfgs = [
    { antialias: true, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    { antialias: false, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    { antialias: false, alpha: false, powerPreference: 'default' },
    { antialias: false, alpha: false, powerPreference: 'low-power' }
  ];
  for (var i = 0; i < cfgs.length; i++) {
    var canvas = document.createElement('canvas');
    var cfg = Object.assign({}, cfgs[i], { canvas: canvas });
    try {
      var r = new THREE.WebGLRenderer(cfg);
      var gl = r.getContext && r.getContext();
      if (gl && !gl.isContextLost()) {
        console.log('[renderer] OK config #' + i);
        r.setPixelRatio(pr);
        r.setSize(window.innerWidth, window.innerHeight, false);
        r.setClearColor(0x08111b, 1);
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        r.outputEncoding = THREE.sRGBEncoding;
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.15;
        r.physicallyCorrectLights = true;
        r.sortObjects = true;
        r.domElement.style.width = '100%';
        r.domElement.style.height = '100%';
        return r;
      }
      try { r.dispose(); } catch (e) {}
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
    for (var x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    cb(img, w, h);
    return;
  }

  var cw = maxX - minX + 1;
  var ch = maxY - minY + 1;
  var out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d').drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
  cb(out, cw, ch);
}

/* ============================================================ PARTICLES */
var particleSystem = null;
var particlePositions = null;
var particleVelocity = null;
var particleLife = null;

function initParticles(scene) {
  var count = 350;
  particlePositions = new Float32Array(count * 3);
  particleVelocity = new Float32Array(count * 3);
  particleLife = new Float32Array(count);

  for (var i = 0; i < count; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 30;
    particlePositions[i * 3 + 1] = Math.random() * 12;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 30;

    particleVelocity[i * 3] = (Math.random() - 0.5) * 0.4;
    particleVelocity[i * 3 + 1] = 0.4 + Math.random() * 1.2;
    particleVelocity[i * 3 + 2] = (Math.random() - 0.5) * 0.4;

    particleLife[i] = Math.random() * 4;
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

  var mat = new THREE.PointsMaterial({
    color: 0xffe8a0,
    size: 0.08,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  particleSystem = new THREE.Points(geo, mat);
  particleSystem.frustumCulled = false;
  scene.add(particleSystem);
  GTF.particleSystem = particleSystem;
}

function updateParticles(dt) {
  if (!particleSystem || !GTF.player) return;

  var p = GTF.player;

  for (var i = 0; i < particleLife.length; i++) {
    particleLife[i] -= dt;

    if (particleLife[i] <= 0) {
      particleLife[i] = 1.5 + Math.random() * 4;

      particlePositions[i * 3] = p.x + (Math.random() - 0.5) * 22;
      particlePositions[i * 3 + 1] = p.y + Math.random() * 7;
      particlePositions[i * 3 + 2] = p.z + (Math.random() - 0.5) * 22;
    }

    particlePositions[i * 3] += particleVelocity[i * 3] * dt;
    particlePositions[i * 3 + 1] += particleVelocity[i * 3 + 1] * dt;
    particlePositions[i * 3 + 2] += particleVelocity[i * 3 + 2] * dt;
  }

  particleSystem.geometry.attributes.position.needsUpdate = true;
}
GTF.initParticles = initParticles;
GTF.updateParticles = updateParticles;

/* ============================================================ BIRDS */
var birds = [];
function initBirds(scene) {
  var tex = cvsTex(12, 8, tBird, false);

  for (var i = 0; i < 12; i++) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.2,
      depthWrite: false
    }));

    s.scale.set(0.8, 0.55, 1);
    s.position.set(
      (Math.random() - 0.5) * 90,
      10 + Math.random() * 12,
      (Math.random() - 0.5) * 90
    );

    s.userData.speed = 1.0 + Math.random() * 1.8;
    s.userData.phase = Math.random() * Math.PI * 2;

    scene.add(s);
    birds.push(s);
  }
}

function updateBirds(dt, time) {
  for (var i = 0; i < birds.length; i++) {
    var b = birds[i];

    b.position.x += b.userData.speed * dt;
    b.position.y += Math.sin(time * 1.4 + b.userData.phase) * dt * 0.7;

    if (b.position.x > 55) b.position.x = -55;
  }
}
GTF.updateBirds = updateBirds;

/* ============================================================ CLOUDS */
var clouds = [];
function initClouds(scene) {
  var tex = cvsTex(32, 24, tCloud, false);

  for (var i = 0; i < 16; i++) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.35
    }));

    s.scale.set(
      8 + Math.random() * 10,
      4 + Math.random() * 4,
      1
    );

    s.position.set(
      (Math.random() - 0.5) * 150,
      25 + Math.random() * 20,
      (Math.random() - 0.5) * 150
    );

    s.userData.speed = 0.4 + Math.random() * 0.5;
    scene.add(s);
    clouds.push(s);
  }
}

function updateClouds(dt) {
  for (var i = 0; i < clouds.length; i++) {
    clouds[i].position.x += clouds[i].userData.speed * dt;

    if (clouds[i].position.x > 90) {
      clouds[i].position.x = -90;
    }
  }
}
GTF.updateClouds = updateClouds;

/* ============================================================ WATER */
function buildWaterPlane(scene) {
  var geo = new THREE.PlaneGeometry(180, 180, 64, 64);
  geo.rotateX(-Math.PI / 2);

  var mat = new THREE.MeshStandardMaterial({
    color: 0x1b5d83,
    transparent: true,
    opacity: 0.76,
    roughness: 0.08,
    metalness: 0.42,
    depthWrite: false
  });

  mat.onBeforeCompile = function(shader) {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWeather = { value: 0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uWeather;'
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = vec3(position);' +
        'float wave1 = sin(position.x * 0.17 + uTime * 1.5);' +
        'float wave2 = cos(position.z * 0.23 + uTime * 1.15);' +
        'float wave3 = sin((position.x + position.z) * 0.09 + uTime * 0.8);' +
        'transformed.y += wave1 * 0.12 + wave2 * 0.09 + wave3 * 0.08;' +
        'transformed.y *= 1.0 + uWeather * 0.5;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uWeather;'
      )
      .replace(
        '#include <dithering_fragment>',
        'float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0), 3.0);' +
        'vec3 reflectionTint = vec3(0.28,0.48,0.66) * fresnel;' +
        'gl_FragColor.rgb += reflectionTint;' +
        'gl_FragColor.rgb += vec3(0.02,0.05,0.08) * uWeather;' +
        '#include <dithering_fragment>'
      );

    mat.userData.shader = shader;
    GTF.waterMaterial = mat;
  };

  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL + 0.02;
  mesh.receiveShadow = true;
  scene.add(mesh);

  return mesh;
}

/* ============================================================ WEATHER */
var rain = null;
var rainPositions = null;
var rainVelocity = null;
var weatherClock = 0;
var weatherIntensity = 0;
var lightningTimer = 8;
var lightningFlash = 0;

function initWeather(scene) {
  var count = 1300;
  rainPositions = new Float32Array(count * 3);
  rainVelocity = new Float32Array(count);

  var pg = new THREE.BufferGeometry();

  for (var i = 0; i < count; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 90;
    rainPositions[i * 3 + 1] = Math.random() * 38;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    rainVelocity[i] = 15 + Math.random() * 10;
  }

  pg.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

  var rm = new THREE.PointsMaterial({
    color: 0xb9dcff,
    size: 0.10,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });

  rain = new THREE.Points(pg, rm);
  rain.frustumCulled = false;
  scene.add(rain);
  GTF.rain = rain;
}

function updateWeather(dt, time) {
  if (!rain || !GTF.player) return;

  weatherClock += dt;

  var cycle = (Math.sin(weatherClock * 0.045) + 1) * 0.5;
  var target = cycle > 0.62 ? 0.45 + (cycle - 0.62) * 1.8 : 0.02;

  weatherIntensity += (target - weatherIntensity) * Math.min(1, dt * 0.7);

  var pos = rain.geometry.attributes.position.array;
  var p = GTF.player;

  for (var i = 0; i < rainVelocity.length; i++) {
    var j = i * 3;

    pos[j] += 0.55 * dt;
    pos[j + 1] -= rainVelocity[i] * dt;
    pos[j + 2] += 0.18 * dt;

    if (pos[j + 1] < 0) {
      pos[j] = (Math.random() - 0.5) * 90 + p.x;
      pos[j + 1] = 22 + Math.random() * 30;
      pos[j + 2] = (Math.random() - 0.5) * 90 + p.z;
    } else {
      pos[j] += (p.x - rain.position.x) * 0.0005;
      pos[j + 2] += (p.z - rain.position.z) * 0.0005;
    }
  }

  rain.position.set(p.x, 0, p.z);
  rain.geometry.attributes.position.needsUpdate = true;
  rain.material.opacity = Math.min(0.75, weatherIntensity * 0.85);

  if (GTF.waterMaterial && GTF.waterMaterial.userData.shader) {
    GTF.waterMaterial.userData.shader.uniforms.uTime.value = time;
    GTF.waterMaterial.userData.shader.uniforms.uWeather.value = weatherIntensity;
  }

  var storm = weatherIntensity > 0.55;

  if (storm) {
    lightningTimer -= dt;

    if (lightningTimer <= 0) {
      lightningTimer = 7 + Math.random() * 13;
      lightningFlash = 1.0;
    }
  } else {
    lightningTimer = Math.max(lightningTimer, 4);
  }

  if (lightningFlash > 0) {
    lightningFlash = Math.max(0, lightningFlash - dt * 5.5);

    if (GTF.sunLight) {
      GTF.sunLight.intensity += lightningFlash * 5.0;
    }
  }

  if (GTF.scene && GTF.scene.fog) {
    GTF.scene.fog.density = 0.004 + weatherIntensity * 0.008;
    GTF.scene.fog.near = 28 - weatherIntensity * 10;
    GTF.scene.fog.far = 105 - weatherIntensity * 24;
  }
}

/* ============================================================ POST FX */
var postTarget = null;
var postScene = null;
var postCamera = null;
var postQuad = null;
var postMaterial = null;
var postClock = 0;

function initPostFX(renderer) {
  var w = Math.max(
    1,
    Math.floor(window.innerWidth * Math.min(window.devicePixelRatio || 1, 1.5))
  );

  var h = Math.max(
    1,
    Math.floor(window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.5))
  );

  postTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false
  });

  postScene = new THREE.Scene();

  postCamera = new THREE.OrthographicCamera(
    -1, 1, 1, -1, 0, 1
  );

  postMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: postTarget.texture },
      uTime: { value: 0 },
      uFlash: { value: 0 }
    },

    vertexShader:
      'varying vec2 vUv;' +
      'void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }',

    fragmentShader:
      'uniform sampler2D tScene; uniform float uTime; uniform float uFlash; varying vec2 vUv;' +
      'void main(){' +
      'vec2 uv=vUv;' +
      'vec2 p=uv-0.5;' +
      'float d=dot(p,p);' +
      'float vign=1.0-smoothstep(0.20,0.72,d);' +
      'float grain=sin(dot(uv*vec2(912.0,618.0),vec2(12.9898,78.233))+uTime*17.0)*0.012;' +
      'vec3 c=texture2D(tScene,uv).rgb;' +
      'c*=0.78+0.30*vign;' +
      'c+=grain;' +
      'c+=vec3(0.42,0.50,0.62)*uFlash;' +
      'c=pow(max(c,vec3(0.0)),vec3(0.92));' +
      'gl_FragColor=vec4(c,1.0);' +
      '}'
  });

  postQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    postMaterial
  );

  postScene.add(postQuad);
  GTF.postTarget = postTarget;
}

function resizePostFX(renderer) {
  if (!postTarget) return;

  var pr = Math.min(window.devicePixelRatio || 1, 1.5);

  postTarget.setSize(
    Math.max(1, Math.floor(window.innerWidth * pr)),
    Math.max(1, Math.floor(window.innerHeight * pr))
  );
}

function renderFrame() {
  var renderer = GTF.renderer;

  if (!renderer || !GTF.scene || !GTF.camera) return;

  postClock += 0.016;

  if (!postTarget) {
    renderer.render(GTF.scene, GTF.camera);
    return;
  }

  renderer.setRenderTarget(postTarget);
  renderer.clear();
  renderer.render(GTF.scene, GTF.camera);

  renderer.setRenderTarget(null);

  postMaterial.uniforms.uTime.value = postClock;
  postMaterial.uniforms.uFlash.value = lightningFlash;

  renderer.render(postScene, postCamera);
}

GTF.initWeather = initWeather;
GTF.updateWeather = updateWeather;
GTF.initPostFX = initPostFX;
GTF.resizePostFX = resizePostFX;
GTF.renderFrame = renderFrame;

/* ============================================================ SCENE SETUP */
function setupScene() {
  var scene = new THREE.Scene();

  scene.background = new THREE.Color(0x5d7892);
  scene.fog = new THREE.FogExp2(0x5d7892, 0.006);

  GTF.scene = scene;

  GTF.camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.08,
    360
  );

  GTF.hemiLight = new THREE.HemisphereLight(
    0xb9d8f2,
    0x1a241c,
    0.72
  );

  scene.add(GTF.hemiLight);

  GTF.sunLight = new THREE.DirectionalLight(
    0xffe7c2,
    2.4
  );

  GTF.sunLight.position.set(55, 90, 35);
  GTF.sunLight.castShadow = true;

  GTF.sunLight.shadow.mapSize.set(2048, 2048);
  GTF.sunLight.shadow.camera.near = 1;
  GTF.sunLight.shadow.camera.far = 220;
  GTF.sunLight.shadow.camera.left = -75;
  GTF.sunLight.shadow.camera.right = 75;
  GTF.sunLight.shadow.camera.top = 75;
  GTF.sunLight.shadow.camera.bottom = -75;
  GTF.sunLight.shadow.bias = -0.00012;

  scene.add(GTF.sunLight);

  GTF.ambientLight = new THREE.AmbientLight(
    0x9fb8c8,
    0.22
  );

  scene.add(GTF.ambientLight);

  GTF.terrainMaterial = new THREE.MeshStandardMaterial({
    map: cvsTex(16, 16, tGrass),
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02
  });

  GTF.barkMaterial = new THREE.MeshStandardMaterial({
    map: cvsTex(16, 16, tBark),
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.0
  });

  GTF.leafMaterial = new THREE.MeshStandardMaterial({
    map: cvsTex(16, 16, tLeaves),
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  GTF.leafMaterial.onBeforeCompile = function(shader) {
    shader.uniforms.uWindTime = { value: 0 };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uWindTime;'
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      'vec3 transformed = vec3(position);' +
      'float wind = sin(position.x * 0.55 + position.z * 0.33 + uWindTime * 1.6) * 0.035;' +
      'float heightFactor = clamp(position.y * 0.08, 0.0, 1.0);' +
      'transformed.x += wind * heightFactor;' +
      'transformed.z += cos(position.z * 0.42 + uWindTime * 1.2) * 0.025 * heightFactor;'
    );

    GTF.leafMaterial.userData.shader = shader;
  };

  GTF.crystalMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.18,
    metalness: 0.08,
    emissive: 0x1d5670,
    emissiveIntensity: 0.65
  });

  GTF.mushroomCapMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.0,
    emissive: 0x220505,
    emissiveIntensity: 0.35
  });

  GTF.itemMaterials = GTF.itemMaterials || {};

  GTF.itemMaterials.coin = new THREE.SpriteMaterial({
    map: cvsTex(12, 12, tCoin, false),
    transparent: true,
    alphaTest: 0.4
  });

  GTF.itemMaterials.potion = new THREE.SpriteMaterial({
    map: cvsTex(12, 12, tPotion, false),
    transparent: true,
    alphaTest: 0.4
  });

  GTF.itemMaterials.gem = new THREE.SpriteMaterial({
    map: cvsTex(12, 12, tGem, false),
    transparent: true,
    alphaTest: 0.4
  });

  GTF.itemMaterials.chest = new THREE.SpriteMaterial({
    map: cvsTex(12, 12, tChest, false),
    transparent: true,
    alphaTest: 0.4
  });

  GTF.waterPlane = buildWaterPlane(scene);

  var fallbackTex = cvsTex(
    16,
    24,
    tPlayerFallback,
    false
  );

  var pMat = new THREE.SpriteMaterial({
    map: fallbackTex,
    transparent: true,
    alphaTest: 0.5,
    depthWrite: true
  });

  GTF.playerSprite = new THREE.Sprite(pMat);

  GTF.playerSprite.center.set(0.5, 0.0);

  var spriteHeight = 1.8;

  GTF.playerSprite.userData.baseScaleX =
    spriteHeight * (16 / 24);

  GTF.playerSprite.userData.baseScaleY =
    spriteHeight;

  GTF.playerSprite.scale.set(
    GTF.playerSprite.userData.baseScaleX,
    spriteHeight,
    1
  );

  scene.add(GTF.playerSprite);

  initParticles(scene);
  initBirds(scene);
  initClouds(scene);
  initWeather(scene);

  return scene;
}

GTF.setupScene = setupScene;

/* ============================================================ APPLY PROBED TEXTURES */
function applyTextures(texMap) {
  applyProbedTexture(
    GTF.terrainMaterial,
    texMap['assets/grass.png']
  );

  applyProbedTexture(
    GTF.barkMaterial,
    texMap['assets/tree_bark.png']
  );

  applyProbedTexture(
    GTF.leafMaterial,
    texMap['assets/tree_leaves.png']
  );

  applyProbedTexture(
    GTF.waterMaterial,
    texMap['assets/water.png']
  );

  applyProbedSprite(
    GTF.itemMaterials.coin,
    texMap['assets/coin.png']
  );

  applyProbedSprite(
    GTF.itemMaterials.potion,
    texMap['assets/potion.png']
  );

  applyProbedSprite(
    GTF.itemMaterials.gem,
    texMap['assets/gem.png']
  );

  applyProbedSprite(
    GTF.itemMaterials.chest,
    texMap['assets/chest.png']
  );

  applyPlayerTexture(
    texMap['assets/player.png'],
    GTF.playerSprite
  );
}

GTF.applyTextures = applyTextures;

})();
