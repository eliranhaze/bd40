// Forty clicks, forty years. Each click on the blank page opens a brief glimpse of
// the first drawing around the cursor, a little wider than the last; the fortieth
// click keeps opening until the whole drawing is there. After that, each click
// erases the drawing and draws the next one in, from the top left to the bottom right.

const DRAWINGS = ['images/california_2019.webp', 'images/california_2019b.webp'];
const CLICKS = 6;

// Glimpse radii, as a fraction of the drawing's height.
const FIRST_RADIUS = 0.05;
const LAST_RADIUS = 0.38;
const SOFT_CORE = 0.45; // share of the radius shown fully before the edge starts to fade

// Timings, in milliseconds.
const OPEN = 140;
const HOLD = 220;
const FADE = 950;
const BLOOM = 1800;
const TALLY_LINGER = 1200;
const ERASE = 2000;
const DRAW = 6000;
const SETTLE = 800; // clicks are ignored this long after a drawing is complete

// Erasing and drawing sweep diagonally, measured from 0 at the top left corner to 1
// at the bottom right. Marks land within a band behind the sweep's front; behind the
// band, everything is fully erased or fully drawn.
const BAND = 0.18;
const EDGE = 0.08; // softness of the fully erased or drawn edge
const RUBS = 900; // eraser rubs per drawing
const STROKES = 9000; // pencil strokes per drawing
const STROKE_ANGLE = 60; // degrees, like the diagonal shading in the drawings

const stage = document.querySelector('.stage');
const canvas = document.querySelector('.drawing');
const tally = document.querySelector('.tally');
const tallyMarks = tally.querySelector('.marks');
const ctx = canvas.getContext('2d');

// Erase and draw marks build up here, at the drawing's own resolution.
const mask = document.createElement('canvas');
const maskCtx = mask.getContext('2d');

const drawings = DRAWINGS.map(src => ({ src, image: new Image(), ready: false }));

let mode = 'loading'; // then landing and blooming, then shown, erasing and drawing in turn
let current = 0;
let clicks = 0;
let glimpses = []; // { x, y, r, start }, with x, y and r relative to the drawing
let bloom = null;
let sweep = null; // { marks, painted, start, duration }
let shownAt = 0;
let frame = 0;

const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2);
const wobble = n => (Math.random() - 0.5) * 2 * n;

(async () => {
  await load(0);
  mode = 'landing';
  fitStage();
  for (let i = 1; i < drawings.length; i++) await load(i);
})();

addEventListener('resize', resize);

addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  if (mode === 'landing') glimpse(event);
  else if (mode === 'shown') turn();
});

function load(i) {
  const drawing = drawings[i];
  drawing.image.src = drawing.src;
  return drawing.image.decode().then(() => {
    drawing.ready = true;
  });
}

function fitStage() {
  const { image } = drawings[current];
  stage.style.setProperty('--ar', `${image.naturalWidth} / ${image.naturalHeight}`);
  resize();
}

function resize() {
  const box = stage.getBoundingClientRect();
  canvas.width = Math.round(box.width * devicePixelRatio);
  canvas.height = Math.round(box.height * devicePixelRatio);
  draw(performance.now());
}

function glimpse(event) {
  const box = stage.getBoundingClientRect();
  const x = (event.clientX - box.left) / box.width;
  const y = (event.clientY - box.top) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;

  clicks++;
  addTallyMark(clicks - 1);

  const r = FIRST_RADIUS + ((LAST_RADIUS - FIRST_RADIUS) * (clicks - 1)) / Math.max(1, CLICKS - 2);
  const start = performance.now();
  if (clicks < CLICKS) {
    glimpses.push({ x, y, r, start });
  } else {
    bloom = { x, y, r, start };
    mode = 'blooming';
  }
  animate();
}

function turn() {
  if (!drawings[current + 1]?.ready || performance.now() - shownAt < SETTLE) return;
  startErasing(performance.now());
  animate();
}

function startErasing(now) {
  resetMask();
  maskCtx.fillRect(0, 0, mask.width, mask.height); // the whole drawing starts out visible
  maskCtx.globalCompositeOperation = 'destination-out';
  maskCtx.lineCap = maskCtx.lineJoin = 'round';
  sweep = { marks: rubs(mask.width, mask.height), painted: 0, start: now, duration: ERASE };
  mode = 'erasing';
}

function startDrawing(now) {
  current++;
  resetMask();
  maskCtx.lineCap = 'round';
  sweep = { marks: strokes(mask.width, mask.height), painted: 0, start: now, duration: DRAW };
  mode = 'drawing';
  fitStage(); // the page is blank at this moment, so a differently shaped drawing can swap in unseen
}

function show(now) {
  sweep = null;
  mode = 'shown';
  shownAt = now;
}

// Matches the mask to the current drawing; resizing a canvas also clears it.
function resetMask() {
  const { image } = drawings[current];
  mask.width = image.naturalWidth;
  mask.height = image.naturalHeight;
}

function animate() {
  if (!frame) frame = requestAnimationFrame(tick);
}

function tick(now) {
  frame = 0;
  glimpses = glimpses.filter(g => now - g.start < OPEN + HOLD + FADE);
  if (mode === 'blooming' && now - bloom.start >= BLOOM) {
    bloom = null;
    glimpses = [];
    show(now);
    setTimeout(() => tally.classList.add('done'), TALLY_LINGER);
  } else if (mode === 'erasing' && now - sweep.start >= ERASE) {
    startDrawing(now);
  } else if (mode === 'drawing' && now - sweep.start >= DRAW) {
    show(now);
  }
  draw(now);
  if (glimpses.length || bloom || sweep) animate();
}

function draw(now) {
  if (mode === 'loading') return;
  const { width: w, height: h } = canvas;
  const { image } = drawings[current];
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);

  if (mode === 'shown') {
    ctx.drawImage(image, 0, 0, w, h);
    return;
  }
  if (sweep) paintSweep(now, w, h);
  else paintGlimpses(now, w, h);

  // Keep the drawing only where the mask was painted.
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(image, 0, 0, w, h);
}

function paintGlimpses(now, w, h) {
  for (const g of glimpses) {
    const t = Math.max(0, now - g.start);
    spot(g.x * w, g.y * h, g.r * h * widen(t), visibility(t));
  }

  if (bloom) {
    const t = Math.max(0, now - bloom.start);
    const x = bloom.x * w;
    const y = bloom.y * h;
    const start = bloom.r * h;
    const cover = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) / SOFT_CORE;
    spot(x, y, start + (cover - start) * easeInOut(Math.min(1, t / BLOOM)), easeOut(Math.min(1, t / OPEN)));
  }
}

// Paints each mark into the mask once the front reaches it, then finishes the job
// behind the band with one soft-edged diagonal fill.
function paintSweep(now, w, h) {
  const progress = Math.min(1, Math.max(0, (now - sweep.start) / sweep.duration));
  const front = progress * (1 + BAND + EDGE);
  const paint = mode === 'erasing' ? paintRub : paintStroke;
  while (sweep.painted < sweep.marks.length && sweep.marks[sweep.painted].due <= front) {
    paint(sweep.marks[sweep.painted++]);
  }
  ctx.drawImage(mask, 0, 0, w, h);

  // Scaled so the canvas is a unit square, where the sweep position is (x + y) / 2.
  const behind = front - BAND;
  ctx.setTransform(w, 0, 0, h, 0, 0);
  const done = ctx.createLinearGradient(behind - EDGE, behind - EDGE, behind, behind);
  done.addColorStop(0, '#000');
  done.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalCompositeOperation = mode === 'erasing' ? 'destination-out' : 'source-over';
  ctx.fillStyle = done;
  ctx.fillRect(0, 0, 1, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Eraser rubs: quick back-and-forth scribbles along the sweep's front. Each lifts most
// of the drawing under it; the fill behind the band clears whatever is left.
function rubs(w, h) {
  const along = Math.atan2(-h, w);
  return scatter(RUBS, w, h, () => ({
    angle: along + wobble(0.3),
    turns: 5 + Math.floor(Math.random() * 5),
    step: h * (0.012 + Math.random() * 0.008),
    reach: h * (0.03 + Math.random() * 0.025),
    width: h * (0.014 + Math.random() * 0.01),
  }));
}

function paintRub({ x, y, angle, turns, step, reach, width }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  maskCtx.beginPath();
  for (let i = 0; i <= turns; i++) {
    // Zigzag corners in the rub's own frame: along its axis, alternately to either side.
    const a = (i - turns / 2 + wobble(0.4)) * step;
    const b = (i % 2 ? reach : -reach) * (0.5 + Math.random() * 0.5);
    maskCtx.lineTo(x + a * cos - b * sin, y + a * sin + b * cos);
  }
  // A faint wide pass softens the edges of a firmer one.
  maskCtx.globalAlpha = 0.35;
  maskCtx.lineWidth = width * 1.5;
  maskCtx.stroke();
  maskCtx.globalAlpha = 0.8;
  maskCtx.lineWidth = width;
  maskCtx.stroke();
}

// Quick pencil strokes at the drawings' own shading angle. Only the drawing under
// each stroke shows, so it looks shaded in rather than uncovered.
function strokes(w, h) {
  return scatter(STROKES, w, h, () => ({
    angle: (-STROKE_ANGLE * Math.PI) / 180 + wobble(0.12),
    length: h * (0.025 + Math.random() * 0.045),
    width: h * (0.002 + Math.random() * 0.0025),
    alpha: 0.5 + Math.random() * 0.45,
  }));
}

function paintStroke({ x, y, angle, length, width, alpha }) {
  const dx = (Math.cos(angle) * length) / 2;
  const dy = (Math.sin(angle) * length) / 2;
  maskCtx.globalAlpha = alpha;
  maskCtx.lineWidth = width;
  maskCtx.beginPath();
  maskCtx.moveTo(x - dx, y - dy);
  maskCtx.lineTo(x + dx, y + dy);
  maskCtx.stroke();
}

// Scatters marks over the drawing. Each is due a random distance into the band after
// the front passes it, so they pile up gradually behind the front.
function scatter(count, w, h, make) {
  return Array.from({ length: count }, () => {
    const x = Math.random() * w;
    const y = Math.random() * h;
    return { x, y, due: (x / w + y / h) / 2 + Math.random() * BAND, ...make() };
  }).sort((a, b) => a.due - b.due);
}

// A soft round patch: solid in the middle, easing out to nothing at radius r.
function spot(x, y, r, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (let i = 0; i <= 6; i++) {
    const s = i / 6;
    const fade = 1 - s * s * (3 - 2 * s);
    gradient.addColorStop(SOFT_CORE + (1 - SOFT_CORE) * s, `rgba(0, 0, 0, ${(alpha * fade).toFixed(3)})`);
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

// How visible a glimpse is t ms after the click: opens quickly, holds, fades slowly.
function visibility(t) {
  if (t < OPEN) return easeOut(t / OPEN);
  if (t < OPEN + HOLD) return 1;
  return 1 - easeInOut(Math.min(1, (t - OPEN - HOLD) / FADE));
}

// Glimpses widen a little as they open, and keep drifting outward as they fade.
function widen(t) {
  const opening = easeOut(Math.min(1, t / (OPEN + HOLD)));
  const drifting = Math.max(0, t - OPEN - HOLD) / FADE;
  return 0.8 + 0.2 * opening + 0.06 * drifting;
}

// Tally marks in pencil: four strokes down, then a fifth across them, four groups to a row.
function addTallyMark(i) {
  const group = Math.floor(i / 5);
  const left = 5 + (group % 4) * 34;
  const top = 6 + Math.floor(group / 4) * 30;
  const k = i % 5;

  let x1, y1, x2, y2;
  if (k < 4) {
    x1 = left + k * 5.5 + wobble(0.5);
    y1 = top + wobble(1.2);
    x2 = x1 + 1.2 + wobble(0.5);
    y2 = top + 20 + wobble(1.2);
  } else {
    x1 = left - 3 + wobble(1);
    y1 = top + 17 + wobble(1);
    x2 = left + 20.5 + wobble(1);
    y2 = top + 3 + wobble(1);
  }
  const cx = (x1 + x2) / 2 + wobble(0.8);
  const cy = (y1 + y2) / 2 + wobble(0.8);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
  tallyMarks.append(path);

  const length = path.getTotalLength();
  path.style.strokeDasharray = length;
  path.animate({ strokeDashoffset: [length, 0] }, { duration: k < 4 ? 160 : 240, easing: 'ease-out' });
}
