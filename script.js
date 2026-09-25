// Forty clicks, forty years. Each click on the blank page opens a brief glimpse of
// the first drawing around the cursor, a little wider than the last; the fortieth
// click keeps opening until the whole drawing is there. After that, each click fades
// the drawing away and draws the next one in, from the top left to the bottom right.
// Once the last one is complete, a restart button leads back to the blank page.

// By year, then place, then letter.
const DRAWINGS = [
  'california_2019',
  'california_2019b',
  'oregon_2021',
  'yellowstone_2021',
  'yellowstone_2021b',
  'yellowstone_2021c',
  'scotland_2022',
  'norway_2022',
  'norway_2022b',
  'japan_2023',
  'japan_2023b',
  'japan_2023c',
  'japan_2023d',
  'iceland_2024',
  'iceland_2024b',
  'iceland_2024c',
].map(name => `images/${name}.webp`);
const CLICKS = 40;

// Where the sheep in the last drawing opens its mouth, as a fraction of the drawing's
// width and height; the tail of its speech bubble points there.
const MOUTH = { x: 0.586, y: 0.595 };

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
const FADE_AWAY = 1000; // a drawing fading back to blank paper before the next is drawn
const DRAW = 5000;
const SETTLE = 800; // clicks are ignored this long after a drawing is complete
const RESTART_DELAY = 1000; // after the last drawing is complete, before the restart button
const BUBBLE_DRAW = 1200; // the speech bubble's outline drawing itself

// Fading and drawing both sweep diagonally, measured from 0 at the top left corner to 1
// at the bottom right. Pencil strokes land within a band behind the drawing sweep's
// front; behind the band, the drawing is complete.
const BAND = 0.18;
const EDGE = 0.08; // softness of the completed drawing's edge
const FADE_EDGE = 0.4; // width of the fading edge, wide enough to read as a fade rather than a wipe
const STROKES = 9000; // pencil strokes per drawing
const STROKE_ANGLE = 60; // degrees, like the diagonal shading in the drawings

const stage = document.querySelector('.stage');
const canvas = document.querySelector('.drawing');
const tally = document.querySelector('.tally');
const tallyMarks = tally.querySelector('.marks');
const caption = document.querySelector('.caption');
const captionPlace = caption.querySelector('.place');
const captionYear = caption.querySelector('.year');
const title = document.querySelector('.title');
const restartButton = document.querySelector('.restart');
const bubble = document.querySelector('.bubble');
const [bubbleFill, bubbleLine] = bubble.children;
const speech = document.querySelector('.speech');
const ctx = canvas.getContext('2d');

// Pencil strokes build up here, at the drawing's own resolution.
const mask = document.createElement('canvas');
const maskCtx = mask.getContext('2d');

const drawings = DRAWINGS.map(src => ({ src, ...placeAndYear(src), image: new Image(), ready: false }));

let mode = 'loading'; // then landing and blooming, then shown, fading and drawing in turn
let current = 0;
let clicks = 0;
let glimpses = []; // { x, y, r, start }, with x, y and r relative to the drawing
let bloom = null;
let sweep = null; // { marks, painted, start, duration }
let fadeStart = 0;
let afterFade = null; // what follows a fade: the next drawing, or the home page
let shownAt = 0;
let frame = 0;

const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2);
const wobble = n => (Math.random() - 0.5) * 2 * n;

(async () => {
  const handwriting = document.fonts.load('1em "La Belle Aurore"');
  const first = load(0);
  await handwriting; // so nothing is written in a stand-in font
  title.classList.add('written');
  await first;
  mode = 'landing';
  fitStage();
  for (let i = 1; i < drawings.length; i++) await load(i);
})();

addEventListener('resize', resize);

addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || event.target.closest('.restart')) return;
  if (mode === 'landing') glimpse(event);
  else if (mode === 'shown') turn();
});

restartButton.addEventListener('click', restart);

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
  if (bubble.classList.contains('shown')) shapeBubble();
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
    title.classList.remove('written'); // making way for the first drawing
  }
  animate();
}

function turn() {
  if (!drawings[current + 1]?.ready || performance.now() - shownAt < SETTLE) return;
  fadeAway(startDrawing);
}

function restart() {
  if (mode !== 'shown') return;
  restartButton.classList.remove('written');
  bubble.classList.remove('shown');
  speech.classList.remove('written');
  fadeAway(home);
}

function fadeAway(then) {
  fadeStart = performance.now();
  afterFade = then;
  mode = 'fading';
  animate();
}

// Back to the blank page and the title, to click through the years again.
function home() {
  current = 0;
  clicks = 0;
  tallyMarks.replaceChildren();
  tally.classList.remove('done');
  stage.classList.remove('speaking');
  mode = 'landing';
  fitStage();
  title.classList.add('written');
}

function startDrawing(now) {
  current++;
  resetMask();
  maskCtx.lineCap = 'round';
  sweep = { marks: strokes(mask.width, mask.height), painted: 0, start: now, duration: DRAW };
  mode = 'drawing';
  stage.classList.toggle('speaking', current === drawings.length - 1);
  fitStage(); // the page is blank at this moment, so a differently shaped drawing can swap in unseen
}

function show(now) {
  sweep = null;
  mode = 'shown';
  shownAt = now;
  if (current === drawings.length - 1) {
    speak();
    setTimeout(() => restartButton.classList.add('written'), RESTART_DELAY);
  }
}

// The sheep's speech bubble draws itself out of its mouth, then the words are written in.
function speak() {
  shapeBubble();
  const length = bubbleLine.getTotalLength();
  bubbleLine.style.strokeDasharray = length;
  bubble.classList.add('shown');
  bubbleLine.animate({ strokeDashoffset: [length, 0] }, { duration: BUBBLE_DRAW, easing: 'ease-in-out' }).onfinish = () => {
    bubbleLine.style.strokeDasharray = ''; // solid again, whatever shape a resize gives it
  };
  bubbleFill.animate({ opacity: [0, 1] }, { duration: BUBBLE_DRAW, easing: 'ease-in' });
  setTimeout(() => speech.classList.add('written'), BUBBLE_DRAW / 2);
}

// Fits the bubble around the words, with its tail reaching into the drawing to just short
// of the sheep's mouth. Coordinates are the stage's own, in CSS pixels.
function shapeBubble() {
  const box = stage.getBoundingClientRect();
  const words = speech.getBoundingClientRect();
  const cx = words.left - box.left + words.width / 2;
  const cy = words.top - box.top + words.height / 2;
  const rx = words.width * 0.66;
  const ry = words.height * 0.75;
  const mouthX = MOUTH.x * box.width;
  const mouthY = MOUTH.y * box.height;

  // The tail leaves the side of the ellipse that faces the mouth.
  const facing = Math.atan2((mouthY - cy) / ry, (mouthX - cx) / rx);
  const x1 = cx + rx * Math.cos(facing - 0.2);
  const y1 = cy + ry * Math.sin(facing - 0.2);
  const x2 = cx + rx * Math.cos(facing + 0.2);
  const y2 = cy + ry * Math.sin(facing + 0.2);
  const reach = Math.hypot(cx - mouthX, cy - mouthY);
  const tipX = mouthX + ((cx - mouthX) / reach) * 0.03 * box.width;
  const tipY = mouthY + ((cy - mouthY) / reach) * 0.03 * box.width;
  // Both sides of the tail bow upward a little.
  const bow = (x, y) => `${(x + tipX) / 2} ${(y + tipY) / 2 - 0.08 * reach}`;

  const d = `M${tipX} ${tipY} Q${bow(x2, y2)} ${x2} ${y2} A${rx} ${ry} 0 1 1 ${x1} ${y1} Q${bow(x1, y1)} ${tipX} ${tipY} Z`;
  bubble.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  bubbleFill.setAttribute('d', d);
  bubbleLine.setAttribute('d', d);
}

function writeCaption() {
  const { place, year } = drawings[current];
  captionPlace.textContent = place;
  captionYear.textContent = year;
  caption.classList.add('written');
}

function hideCaption() {
  caption.classList.remove('written');
}

// "images/yellowstone_2021b.webp" gives { place: 'Yellowstone', year: '2021' }.
function placeAndYear(src) {
  const [, place, year] = /([^/]+)_(\d{4})[a-z]?\.\w+$/.exec(src);
  return { place: place.split(/[_-]/).map(word => word[0].toUpperCase() + word.slice(1)).join(' '), year };
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
    writeCaption();
    setTimeout(() => tally.classList.add('done'), TALLY_LINGER);
  } else if (mode === 'fading' && now - fadeStart >= FADE_AWAY) {
    afterFade(now);
  } else if (mode === 'drawing' && now - sweep.start >= DRAW) {
    show(now);
  }
  // Both sweeps pass the drawing's bottom left corner, beside the caption, at 0.5.
  if (mode === 'fading' && fadeFront(now) >= 0.5 + FADE_EDGE / 2) hideCaption();
  if (sweep && !sweep.captioned && sweepFront(now) >= 0.5) {
    sweep.captioned = true;
    writeCaption();
  }
  draw(now);
  if (glimpses.length || bloom || sweep || mode === 'fading') animate();
}

function draw(now) {
  if (mode === 'loading') return;
  const { width: w, height: h } = canvas;
  const { image } = drawings[current];
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);

  if (mode === 'shown' || mode === 'fading') {
    ctx.drawImage(image, 0, 0, w, h);
    if (mode === 'fading') {
      // Fade away from the top left corner, behind a wide soft edge.
      const front = fadeFront(now);
      ctx.globalCompositeOperation = 'destination-out';
      fillDiagonal(front - FADE_EDGE, front, w, h);
    }
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
    const whole = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) / SOFT_CORE;
    spot(x, y, start + (whole - start) * easeInOut(Math.min(1, t / BLOOM)), easeOut(Math.min(1, t / OPEN)));
  }
}

// Paints each mark into the mask once the front reaches it, then finishes the job
// behind the band with one soft-edged diagonal fill.
function paintSweep(now, w, h) {
  const front = sweepFront(now);
  while (sweep.painted < sweep.marks.length && sweep.marks[sweep.painted].due <= front) {
    paintStroke(sweep.marks[sweep.painted++]);
  }
  ctx.drawImage(mask, 0, 0, w, h);
  const behind = front - BAND;
  fillDiagonal(behind - EDGE, behind, w, h);
}

function sweepFront(now) {
  const progress = Math.min(1, Math.max(0, (now - sweep.start) / sweep.duration));
  return progress * (1 + BAND + EDGE);
}

function fadeFront(now) {
  const progress = Math.min(1, Math.max(0, (now - fadeStart) / FADE_AWAY));
  return progress * (1 + FADE_EDGE);
}

// Fills the canvas solidly up to diagonal position `from`, easing out to nothing at `to`.
function fillDiagonal(from, to, w, h) {
  // Scaled so the canvas is a unit square, where the diagonal position is (x + y) / 2.
  ctx.setTransform(w, 0, 0, h, 0, 0);
  const gradient = ctx.createLinearGradient(from, from, to, to);
  for (let i = 0; i <= 4; i++) {
    const s = i / 4;
    gradient.addColorStop(s, `rgba(0, 0, 0, ${1 - s * s * (3 - 2 * s)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
