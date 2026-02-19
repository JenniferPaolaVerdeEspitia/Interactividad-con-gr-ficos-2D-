const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Panel stats
const killedCountEl  = document.getElementById("killedCount");
const killedPctEl    = document.getElementById("killedPct");
const escapedCountEl = document.getElementById("escapedCount");
const escapedPctEl   = document.getElementById("escapedPct");
const levelNowEl     = document.getElementById("levelNow");
const speedNowEl     = document.getElementById("speedNow");
const progressTextEl = document.getElementById("progressText");
const progressBarEl  = document.getElementById("progressBar");

// Navbar buttons
const pauseBtn  = document.getElementById("pauseBtn");
const pauseIcon = document.getElementById("pauseIcon");
const pauseText = document.getElementById("pauseText");

const muteBtn   = document.getElementById("muteBtn");
const muteIcon  = document.getElementById("muteIcon");
const muteText  = document.getElementById("muteText");

// Toast
const levelToastEl = document.getElementById("levelToast");
const toastTitleEl = document.getElementById("toastTitle");
const toastSpeedEl = document.getElementById("toastSpeed");
let levelToast = null;

// =================== CANVAS SIZE ===================
function resizeCanvas() {
  const window_height = window.innerHeight / 2;
  const window_width  = window.innerWidth  / 2;
  canvas.width = window_width;
  canvas.height = window_height;
  canvas.style.background = "#eaf6ff";
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);
// ===================================================

// =================== CONFIG ===================
const PER_LEVEL = 10;
const TOTAL_ELEMENTS = 150;
const TOTAL_LEVELS = Math.ceil(TOTAL_ELEMENTS / PER_LEVEL);

// Nivel 1 lento + crecimiento
const BASE_SPEED = 0.60;
const SPEED_INC  = 0.22;

// Física
const RESTITUTION = 0.9;
const SEPARATION_SLOP = 0.6;
const MAX_SPEED = 7.0;

// Fade
const FADE_RATE = 0.035;

// Colores
const COLOR_NORMAL  = "#2563eb";
const COLOR_HOVER   = "#22c55e";
const COLOR_COLLIDE = "#ef4444";

// Anti-trabado
const COLLISION_COOLDOWN_MS = 80;

// Spawn (aparecen rápido al cambiar nivel)
const SPAWN_OFFSET_MIN = 0;
const SPAWN_OFFSET_MAX = 18;

// Mezcla (sin pausas)
const MIX_AT = 2;

// HUD
const HUD_PAD = 12;

// Flash cambio nivel
const FLASH_DURATION_MS = 420;
// ======================================================

function rand(min, max) { return Math.random() * (max - min) + min; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function levelSpeed(level) { return BASE_SPEED + (level - 1) * SPEED_INC; }

function clampSpeed(circle) {
  const v = Math.hypot(circle.dx, circle.dy);
  if (v > MAX_SPEED) {
    const s = MAX_SPEED / v;
    circle.dx *= s;
    circle.dy *= s;
  }
}

// =================== PAUSE / MUTE ===================
let paused = false;
let muted = false;

function setPauseUI() {
  if (!pauseIcon || !pauseText) return;
  if (paused) {
    pauseIcon.className = "bi bi-play-fill me-1";
    pauseText.textContent = "Reanudar";
  } else {
    pauseIcon.className = "bi bi-pause-fill me-1";
    pauseText.textContent = "Pausar";
  }
}

function setMuteUI() {
  if (!muteIcon || !muteText) return;
  if (muted) {
    muteIcon.className = "bi bi-volume-mute-fill me-1";
    muteText.textContent = "Unmute";
  } else {
    muteIcon.className = "bi bi-volume-up-fill me-1";
    muteText.textContent = "Mute";
  }
}

pauseBtn?.addEventListener("click", () => {
  paused = !paused;
  setPauseUI();
});

muteBtn?.addEventListener("click", () => {
  muted = !muted;
  setMuteUI();
});

// inicial
setPauseUI();
setMuteUI();
// ===================================================

// =================== SONIDO (WebAudio) ===================
let audioCtx = null;

function ensureAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
}

function beep(freq = 440, duration = 0.08, gain = 0.05) {
  if (muted) return;

  ensureAudio();
  if (!audioCtx) return;

  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  g.gain.value = 0;
  g.gain.setValueAtTime(0, audioCtx.currentTime);
  g.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.01);
  g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);

  osc.connect(g);
  g.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration + 0.02);
}

canvas.addEventListener("pointerdown", () => {
  // desbloquea audio al primer gesto
  ensureAudio();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
});
// =========================================================

// =================== TOAST ===================
function initToast() {
  if (!levelToastEl || typeof bootstrap === "undefined") return;
  levelToast = bootstrap.Toast.getOrCreateInstance(levelToastEl, {
    delay: 1400,
    autohide: true
  });
}
function showLevelToast(level) {
  if (!levelToast || !toastTitleEl || !toastSpeedEl) return;
  toastTitleEl.textContent = `Nivel ${level} iniciado`;
  toastSpeedEl.textContent = `Velocidad ${levelSpeed(level).toFixed(2)}`;
  levelToast.show();
}
initToast();
// ===================================================

// =================== FLASH ===================
let flashUntil = 0;
function triggerFlash(now) { flashUntil = now + FLASH_DURATION_MS; }
function drawFlash(now) {
  if (now >= flashUntil) return;
  const t = 1 - (flashUntil - now) / FLASH_DURATION_MS;
  const alpha = (1 - t) * 0.22;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#22d3ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
// ===================================================

// =================== MOUSE ===================
let mouse = { x: -9999, y: -9999 };
let hoverId = null;

function getMouseCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("mousemove", (e) => {
  const m = getMouseCanvasPos(e);
  mouse.x = m.x;
  mouse.y = m.y;

  hoverId = null;
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    if (c.alpha > 0 && c.contains(mouse.x, mouse.y)) {
      hoverId = c.id;
      break;
    }
  }
});

canvas.addEventListener("mouseleave", () => {
  mouse = { x: -9999, y: -9999 };
  hoverId = null;
});

canvas.addEventListener("click", () => {
  if (!hoverId) return;
  const c = circles.find(x => x.id === hoverId);
  if (c) {
    c.startFade();
    beep(520, 0.07, 0.05); // kill sound
  }
});
// ===================================================

class Circle {
  constructor(id, x, y, radius, speed) {
    this.id = id;
    this.text = String(id);

    this.posX = x;
    this.posY = y;
    this.radius = radius;
    this.mass = radius * radius;

    this.dx = rand(-1.15, 1.15) * speed;
    this.dy = -rand(0.70, 1.05) * speed;

    this.isColliding = false;

    this.alpha = 1;
    this.fading = false;

    clampSpeed(this);
  }

  contains(px, py) {
    const dx = px - this.posX;
    const dy = py - this.posY;
    return (dx * dx + dy * dy) <= (this.radius * this.radius);
  }

  startFade() { this.fading = true; }

  update() {
    this.posX += this.dx;
    this.posY += this.dy;

    if (this.posX + this.radius > canvas.width) {
      this.posX = canvas.width - this.radius;
      this.dx *= -1;
    }
    if (this.posX - this.radius < 0) {
      this.posX = this.radius;
      this.dx *= -1;
    }

    if (this.fading) {
      this.alpha -= FADE_RATE;
      if (this.alpha <= 0) {
        this.alpha = 0;
        return { dead: true, reason: "killed" };
      }
    }

    if (this.posY + this.radius < 0) {
      return { dead: true, reason: "escaped" };
    }

    return { dead: false, reason: null };
  }

  draw(isHover) {
    ctx.save();
    ctx.globalAlpha = this.alpha;

    let stroke = COLOR_NORMAL;
    if (this.isColliding) stroke = COLOR_COLLIDE;
    else if (isHover) stroke = COLOR_HOVER;

    ctx.beginPath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.arc(this.posX, this.posY, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.closePath();

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "18px Arial";
    ctx.fillText(this.text, this.posX, this.posY);

    ctx.restore();
  }
}

function distance(a, b) {
  const dx = a.posX - b.posX;
  const dy = a.posY - b.posY;
  return Math.sqrt(dx * dx + dy * dy);
}

// cooldown por par
const lastCollisionAt = new Map();
function pairKey(aId, bId) {
  const x = Math.min(aId, bId);
  const y = Math.max(aId, bId);
  return `${x}-${y}`;
}

function resolveCollision(a, b) {
  let dx = b.posX - a.posX;
  let dy = b.posY - a.posY;
  let dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) dist = 0.0001;

  const minDist = a.radius + b.radius;
  const nx = dx / dist;
  const ny = dy / dist;

  if (dist < minDist) {
    const overlap = (minDist - dist) + SEPARATION_SLOP;
    const totalMass = a.mass + b.mass;

    const moveA = overlap * (b.mass / totalMass);
    const moveB = overlap * (a.mass / totalMass);

    a.posX -= nx * moveA;
    a.posY -= ny * moveA;
    b.posX += nx * moveB;
    b.posY += ny * moveB;
  }

  const rvx = b.dx - a.dx;
  const rvy = b.dy - a.dy;
  const velAlongNormal = rvx * nx + rvy * ny;
  if (velAlongNormal > 0) return;

  const e = RESTITUTION;
  const j = -(1 + e) * velAlongNormal / (1 / a.mass + 1 / b.mass);

  const impulseX = j * nx;
  const impulseY = j * ny;

  a.dx -= impulseX / a.mass;
  a.dy -= impulseY / a.mass;
  b.dx += impulseX / b.mass;
  b.dy += impulseY / b.mass;

  clampSpeed(a);
  clampSpeed(b);
}

// =================== NIVELES + CONTADORES ===================
let circles = [];

let currentLevel = 1;
let spawnedTotal = 0;

let killedTotal = 0;
let escapedTotal = 0;

let nextId = 1;
let injectedLevelUpTo = 1;

function updateStatsUI() {
  const killedPct = TOTAL_ELEMENTS ? (killedTotal / TOTAL_ELEMENTS) * 100 : 0;
  const escapedPct = TOTAL_ELEMENTS ? (escapedTotal / TOTAL_ELEMENTS) * 100 : 0;

  if (levelNowEl) levelNowEl.textContent = String(currentLevel);
  if (speedNowEl) speedNowEl.textContent = levelSpeed(currentLevel).toFixed(2);

  if (killedCountEl) killedCountEl.textContent = String(killedTotal);
  if (killedPctEl) killedPctEl.textContent = `${killedPct.toFixed(1)}%`;

  if (escapedCountEl) escapedCountEl.textContent = String(escapedTotal);
  if (escapedPctEl) escapedPctEl.textContent = `${escapedPct.toFixed(1)}%`;

  if (progressTextEl) progressTextEl.textContent = `${killedTotal} / ${TOTAL_ELEMENTS}`;
  if (progressBarEl) progressBarEl.style.width = `${clamp(killedPct, 0, 100)}%`;
}

function addBatchForLevel(level) {
  if (spawnedTotal >= TOTAL_ELEMENTS) return;

  const remaining = TOTAL_ELEMENTS - spawnedTotal;
  const count = Math.min(PER_LEVEL, remaining);

  const spd = levelSpeed(level);

  for (let i = 0; i < count; i++) {
    const r = rand(20, 45);
    const x = rand(r, canvas.width - r);
    const y = canvas.height + rand(SPAWN_OFFSET_MIN, SPAWN_OFFSET_MAX);
    circles.push(new Circle(nextId++, x, y, r, spd));
  }

  spawnedTotal += count;
  lastCollisionAt.clear();
}

function resetGame() {
  circles = [];
  currentLevel = 1;
  injectedLevelUpTo = 1;

  spawnedTotal = 0;
  killedTotal = 0;
  escapedTotal = 0;

  hoverId = null;
  nextId = 1;

  lastCollisionAt.clear();

  addBatchForLevel(1);
  updateStatsUI();
  showLevelToast(1);
  triggerFlash(performance.now());
  beep(330, 0.10, 0.05);
}

resetGame();

function mixNextLevelIfNeeded(now) {
  if (spawnedTotal >= TOTAL_ELEMENTS) return;
  if (injectedLevelUpTo !== currentLevel) return;

  if (circles.length <= MIX_AT) {
    const nextLevel = Math.min(currentLevel + 1, TOTAL_LEVELS);
    currentLevel = nextLevel;
    injectedLevelUpTo = nextLevel;

    addBatchForLevel(nextLevel);
    updateStatsUI();
    showLevelToast(nextLevel);
    triggerFlash(now);

    beep(740, 0.09, 0.05);
    setTimeout(() => beep(980, 0.08, 0.04), 90);
  }
}

// =================== HUD CANVAS ===================
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawHUD() {
  ctx.save();

  const x = HUD_PAD, y = HUD_PAD, w = 250, h = 74;

  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#0b1220";
  ctx.font = "600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.fillText(`Nivel: ${currentLevel} / ${TOTAL_LEVELS}`, x + 12, y + 10);
  ctx.fillText(`Eliminados: ${killedTotal} / ${TOTAL_ELEMENTS}`, x + 12, y + 30);
  ctx.fillText(`Escapados: ${escapedTotal} / ${TOTAL_ELEMENTS}`, x + 12, y + 50);

  // overlay "PAUSADO"
  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 28px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("PAUSADO", canvas.width / 2, canvas.height / 2 - 10);

    ctx.font = "500 14px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText("Presiona Reanudar para continuar", canvas.width / 2, canvas.height / 2 + 22);
  }

  ctx.restore();
}
// ===================================================

// =================== LOOP ===================
function animate(now = 0) {
  requestAnimationFrame(animate);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Si está pausado: solo dibuja HUD + flash (sin mover)
  if (paused) {
    drawHUD();
    drawFlash(now);
    return;
  }

  for (const c of circles) c.isColliding = false;

  // colisiones con cooldown
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];

      const d = distance(a, b);
      const minDist = a.radius + b.radius;

      if (d <= minDist) {
        const key = pairKey(a.id, b.id);
        const last = lastCollisionAt.get(key) ?? -1e9;

        if (now - last >= COLLISION_COOLDOWN_MS) {
          lastCollisionAt.set(key, now);
          a.isColliding = true;
          b.isColliding = true;
        }
        resolveCollision(a, b);
      }
    }
  }

  // update/draw + remover
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    const res = c.update();
    c.draw(c.id === hoverId);

    if (res.dead) {
      circles.splice(i, 1);
      if (res.reason === "killed") killedTotal++;
      if (res.reason === "escaped") escapedTotal++;
    }
  }

  // mezcla de nivel (sin pausas)
  mixNextLevelIfNeeded(now);

  // failsafe si queda vacío
  if (circles.length === 0 && spawnedTotal < TOTAL_ELEMENTS) {
    const nextLevel = Math.min(currentLevel + 1, TOTAL_LEVELS);
    currentLevel = nextLevel;
    injectedLevelUpTo = nextLevel;
    addBatchForLevel(nextLevel);

    updateStatsUI();
    showLevelToast(nextLevel);
    triggerFlash(now);
  }

  drawHUD();
  drawFlash(now);
  updateStatsUI();
}
animate();
