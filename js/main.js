const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Tabla de choques (se mantiene aunque ya no la muestres; no afecta)
const collisionTableBody = document.getElementById("collisionTableBody");

// Stats (si existen en tu HTML)
const killedCountEl  = document.getElementById("killedCount");
const killedPctEl    = document.getElementById("killedPct");
const levelNowEl     = document.getElementById("levelNow");
const speedNowEl     = document.getElementById("speedNow");
const progressTextEl = document.getElementById("progressText");
const progressBarEl  = document.getElementById("progressBar");
const levelsValueEl  = document.getElementById("levelsValue");

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

// =================== CONFIG NEGOCIO ===================
const PER_LEVEL = 10;
const TOTAL_ELEMENTS = 150;
const TOTAL_LEVELS = Math.ceil(TOTAL_ELEMENTS / PER_LEVEL);

const BASE_SPEED = 0.60;
const SPEED_INC  = 0.12;

// ✅ rebote más suave (antes 1)
const RESTITUTION = 0.9;

// Fade
const FADE_RATE = 0.035;

// Colores
const COLOR_NORMAL  = "#2563eb";
const COLOR_HOVER   = "#22c55e";
const COLOR_COLLIDE = "#ef4444";

// ✅ Anti-trabado (cooldown por par)
const COLLISION_COOLDOWN_MS = 80;

// ✅ Evita vibración por micro-penetraciones
const SEPARATION_SLOP = 0.5; // px extra

// ✅ Limita velocidad para que no explote con impulsos
const MAX_SPEED = 3.2;
// ======================================================

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function clampSpeed(circle) {
  const v = Math.hypot(circle.dx, circle.dy);
  if (v > MAX_SPEED) {
    const s = MAX_SPEED / v;
    circle.dx *= s;
    circle.dy *= s;
  }
}

// =================== MOUSE (CORREGIDO CON ESCALA) ===================
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
  if (c) c.startFade();
});
// ===================================================================

class Circle {
  constructor(id, x, y, radius, speed) {
    this.id = id;
    this.text = String(id);
    this.hits = 0;

    this.posX = x;
    this.posY = y;
    this.radius = radius;

    this.mass = radius * radius;

    // movimiento (arriba + direcciones distintas)
    this.dx = rand(-0.9, 0.9) * speed;
    this.dy = -rand(0.7, 1.3) * speed;

    this.isColliding = false;

    // fade
    this.alpha = 1;
    this.fading = false;
  }

  contains(px, py) {
    const dx = px - this.posX;
    const dy = py - this.posY;
    return (dx * dx + dy * dy) <= (this.radius * this.radius);
  }

  startFade() {
    this.fading = true;
  }

  update() {
    this.posX += this.dx;
    this.posY += this.dy;

    // Rebote lateral
    if (this.posX + this.radius > canvas.width) {
      this.posX = canvas.width - this.radius;
      this.dx *= -1;
    }
    if (this.posX - this.radius < 0) {
      this.posX = this.radius;
      this.dx *= -1;
    }

    // Fade-out
    if (this.fading) {
      this.alpha -= FADE_RATE;
      if (this.alpha <= 0) {
        this.alpha = 0;
        return { dead: true, reason: "killed" };
      }
    }

    // Si sale por arriba, se elimina
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

// ✅ mapa de cooldown por par
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

  // ✅ Separar con slop para evitar que se queden pegados
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

  // ✅ limita velocidad
  clampSpeed(a);
  clampSpeed(b);
}

// =================== NIVELES + STATS ===================
let circles = [];
let lastFrameUpdatedTable = 0;

let currentLevel = 1;
let spawnedTotal = 0;
let killedTotal = 0;

let nextId = 1;

function buildCollisionTable() {
  if (!collisionTableBody) return;
  collisionTableBody.innerHTML = "";
  for (const c of circles) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">#${c.text}</td>
      <td class="mono" id="hit-${c.id}">${c.hits}</td>
    `;
    collisionTableBody.appendChild(tr);
  }
}

function updateCollisionTableFast() {
  for (const c of circles) {
    const cell = document.getElementById(`hit-${c.id}`);
    if (cell) cell.textContent = c.hits;
  }
}

function updateStatsUI() {
  const pct = TOTAL_ELEMENTS > 0 ? (killedTotal / TOTAL_ELEMENTS) * 100 : 0;
  const speed = BASE_SPEED + (currentLevel - 1) * SPEED_INC;

  if (levelsValueEl) levelsValueEl.textContent = String(TOTAL_LEVELS);
  if (levelNowEl) levelNowEl.textContent = String(currentLevel);
  if (speedNowEl) speedNowEl.textContent = speed.toFixed(2);

  if (killedCountEl) killedCountEl.textContent = String(killedTotal);
  if (killedPctEl) killedPctEl.textContent = `${pct.toFixed(1)}%`;

  if (progressTextEl) progressTextEl.textContent = `${killedTotal} / ${TOTAL_ELEMENTS}`;
  if (progressBarEl) progressBarEl.style.width = `${clamp(pct, 0, 100)}%`;
}

function spawnNextLevel() {
  if (spawnedTotal >= TOTAL_ELEMENTS) return;

  const remaining = TOTAL_ELEMENTS - spawnedTotal;
  const count = Math.min(PER_LEVEL, remaining);

  const levelSpeed = BASE_SPEED + (currentLevel - 1) * SPEED_INC;

  circles = [];

  for (let i = 0; i < count; i++) {
    const r = rand(20, 45);
    const x = rand(r, canvas.width - r);
    const y = canvas.height + rand(40, 180);

    circles.push(new Circle(nextId++, x, y, r, levelSpeed));
    spawnedTotal++;
  }

  // limpiar cooldowns para no crecer infinito
  lastCollisionAt.clear();

  buildCollisionTable();
  updateStatsUI();
}

function resetGame() {
  circles = [];
  currentLevel = 1;
  spawnedTotal = 0;
  killedTotal = 0;
  hoverId = null;
  nextId = 1;

  lastCollisionAt.clear();

  spawnNextLevel();
  updateStatsUI();
}

resetGame();

function animate(timestamp = 0) {
  requestAnimationFrame(animate);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const c of circles) c.isColliding = false;

  // colisiones + contador (con cooldown)
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];

      const d = distance(a, b);
      const minDist = a.radius + b.radius;

      if (d <= minDist) {
        const key = pairKey(a.id, b.id);
        const last = lastCollisionAt.get(key) ?? -1e9;

        // ✅ evita múltiples “choques” por frame
        if (timestamp - last >= COLLISION_COOLDOWN_MS) {
          lastCollisionAt.set(key, timestamp);

          a.isColliding = true;
          b.isColliding = true;

          a.hits += 1;
          b.hits += 1;
        }

        // ✅ aunque haya cooldown, igual resolvemos para que no se atraviesen
        resolveCollision(a, b);
      }
    }
  }

  // update/draw + remover si muere o sale
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];

    const res = c.update();
    c.draw(c.id === hoverId);

    if (res.dead) {
      circles.splice(i, 1);
      if (res.reason === "killed") killedTotal++;
    }
  }

  // siguiente nivel
  if (circles.length === 0 && spawnedTotal < TOTAL_ELEMENTS) {
    currentLevel = Math.min(currentLevel + 1, TOTAL_LEVELS);
    spawnNextLevel();
  }

  updateStatsUI();

  // tabla ~10 veces/seg
  if (timestamp - lastFrameUpdatedTable > 100) {
    updateCollisionTableFast();
    lastFrameUpdatedTable = timestamp;
  }
}

animate();
