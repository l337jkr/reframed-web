// Reframed — shared site behaviour
// Nav logo: split into letters, flip one at a time with a glitch glyph mid-spin.
(function () {
  const logo = document.querySelector(".nav-logo");
  if (!logo) return;

  const text = logo.textContent.trim();
  logo.textContent = "";
  // Screen readers get the word once; the animated letters are hidden from them.
  const name = document.createElement("span");
  name.className = "sr-only";
  name.textContent = text;
  logo.appendChild(name);
  const letters = [...text].map((ch) => {
    const s = document.createElement("span");
    s.className = "lg";
    s.setAttribute("aria-hidden", "true");
    s.textContent = ch;
    logo.appendChild(s);
    return s;
  });

  const GLYPHS = "#%/\\*+=?<>[]{}~:;";

  function glitch(el) {
    if (el.classList.contains("glitch")) return;
    const orig = el.textContent;
    el.classList.add("glitch");
    // Swap while the letter is edge-on (25% of the 560ms flip), restore mid-spin.
    setTimeout(() => { el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; }, 140);
    setTimeout(() => { el.textContent = orig; }, 320);
    setTimeout(() => { el.classList.remove("glitch"); }, 580);
  }

  function loop() {
    glitch(letters[Math.floor(Math.random() * letters.length)]);
    setTimeout(loop, 1800 + Math.random() * 4200);
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Opening cascade left to right, then settle into random single flips.
    letters.forEach((el, i) => setTimeout(() => glitch(el), 400 + i * 90));
    setTimeout(loop, 2800);
  }
})();

// Thought rain — faint matrix-style columns, each one a thinking trap playing
// out as a loop: the trap's name, a chain of thoughts linked by ↓, then ↺ back
// to where it started. Columns wrap from the bottom of the screen to the top,
// so the loop keeps going. Opt in per page with <body data-thought-rain>.
(function () {
  if (!document.body.hasAttribute("data-thought-rain")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const LOOPS = [
    ["jumping to conclusions", "they didn't text back", "they're mad at me", "i said something wrong", "i always say the wrong thing"],
    ["catastrophising", "i made one mistake", "everyone noticed", "i'll lose my job", "i can't afford mistakes", "i'm so on edge"],
    ["mind reading", "they looked away", "they think i'm boring", "i should stop talking", "now i'm being weird"],
    ["all-or-nothing", "it's not perfect", "so it's a failure", "so i'm a failure", "why even try"],
    ["overgeneralising", "this went wrong", "things always go wrong", "nothing works for me", "so why bother"],
    ["should statements", "i should be further along", "everyone else is", "i'm wasting my life", "i'm too tired to start"],
    ["personalisation", "they seem off today", "it must be me", "what did i do", "i ruin everything"],
    ["fortune telling", "it won't work out", "so don't start", "nothing changes", "see, it didn't work out"],
    ["emotional reasoning", "i feel anxious", "so something is wrong", "i need to check again", "checking didn't help"],
    ["labelling", "i forgot again", "i'm an idiot", "idiots don't get it right", "i can't focus"],
    ["discounting the positive", "they said well done", "they're just being nice", "it was luck", "i'm a fraud"],
  ];
  const ARROW = " ↓ ", RETURN = " ↺ ";
  // Per-character colour: 0 thought, 1 trap name, 2 arrow.
  const COLORS = ["245,241,232", "224,107,90", "201,164,78"];

  function build(loop) {
    const [name, ...thoughts] = loop;
    let text = "", kind = [];
    const add = (s, k) => { text += s; for (const _ of s) kind.push(k); };
    add(`[${name}]`, 1);
    add(ARROW, 2);
    thoughts.forEach((t, i) => { add(t, 0); add(i < thoughts.length - 1 ? ARROW : RETURN, 2); });
    add(thoughts[0], 0); // back where it started
    return { text: [...text], kind };
  }
  const CHAINS = LOOPS.map(build);

  const canvas = document.createElement("canvas");
  canvas.className = "thought-rain";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const FONT = 13, LINE = 17, TRAIL = 24;
  let w = 0, h = 0, drops = [], last = 0, raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${FONT}px Inconsolata, ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
  }

  function freeColumn() {
    const cols = Math.floor(w / 24);
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.floor(Math.random() * cols) * 24 + 12;
      if (!drops.some((d) => Math.abs(d.x - x) < 48)) return x;
    }
    return Math.floor(Math.random() * cols) * 24 + 12;
  }

  function spawn(initial) {
    const chain = CHAINS[Math.floor(Math.random() * CHAINS.length)];
    return {
      chain,
      x: freeColumn(),
      y: Math.random() * h * 0.4 - 60,
      head: initial ? Math.random() * chain.text.length : 0,
      speed: 3 + Math.random() * 2.5, // chars per second
    };
  }

  function target() { return Math.max(4, Math.round(w / 95)); }

  function frame(t) {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    ctx.clearRect(0, 0, w, h);

    while (drops.length < target()) drops.push(spawn(false));

    const span = h + LINE * 2; // column height before wrapping to the top
    for (let d = drops.length - 1; d >= 0; d--) {
      const p = drops[d], { text, kind } = p.chain;
      p.head += p.speed * dt;
      if (p.head - text.length > TRAIL) { drops.splice(d, 1); continue; }

      // Quieter over the centre column so body copy stays readable.
      const edge = Math.min(1, Math.abs(p.x - w / 2) / (w * 0.35));
      const fade = 0.4 + 0.6 * edge;

      const end = Math.min(Math.floor(p.head), text.length - 1);
      const from = Math.max(0, Math.floor(p.head - TRAIL));
      for (let i = from; i <= end; i++) {
        const ch = text[i];
        if (ch === " ") continue;
        const behind = p.head - i;
        let a = Math.max(0, 1 - behind / TRAIL) * 0.14;
        if (behind < 1) a = 0.34; // leading glyph glows
        if (a <= 0.003) continue;
        const y = ((p.y + i * LINE) % span + span) % span - LINE;
        ctx.fillStyle = `rgba(${COLORS[kind[i]]},${(a * fade).toFixed(3)})`;
        ctx.fillText(ch, p.x, y);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function start() { last = performance.now(); raf = requestAnimationFrame(frame); }

  resize();
  for (let i = 0; i < target(); i++) drops.push(spawn(true));
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) start();
  });
  start();
})();

// Hero brain — a slowly rotating dot-cloud brain. Dots trace the folds of the
// cortex; now and then a "neuron" fires in vermillion.
(function () {
  const canvas = document.querySelector(".hero-brain");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Deterministic random so the brain looks the same on every load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = []; // [x, y, z, kind] kind: 0 fold line, 1 faint body, 2 cerebellum, 3 stem

  function dir() {
    const u = rand() * 2 - 1, t = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    return [r * Math.cos(t), u, r * Math.sin(t)];
  }
  const fold = (x, y, z) =>
    Math.sin(x * 9 + Math.sin(y * 7) * 1.6) +
    Math.sin(y * 8 + Math.sin(z * 6) * 1.6) +
    Math.sin(z * 10 + Math.sin(x * 5) * 1.6);

  // Cerebrum: two hemispheres with a flat inner face and a gap between them.
  for (const s of [-1, 1]) {
    let lines = 0, body = 0;
    for (let i = 0; i < 60000 && (lines < 1100 || body < 260); i++) {
      const [dx, dy, dz] = dir();
      let lx = dx * 0.5 * (1 - 0.15 * Math.max(0, dz)); // narrower at the front
      if (lx < 0) lx *= 0.28;                            // flat medial wall
      const y = dy * (dy > 0 ? 0.58 : 0.36);
      const z = dz * 0.95;
      const x = s * (lx + 0.2);
      const f = Math.abs(fold(lx, y, z));
      if (f < 0.2 && lines < 1100) { pts.push([x, y, z, 0]); lines++; }
      else if (rand() < 0.02 && body < 260) { pts.push([x, y, z, 1]); body++; }
    }
  }
  // Cerebellum: tucked under the back, with horizontal ridges.
  for (let n = 0, i = 0; i < 20000 && n < 320; i++) {
    const [dx, dy, dz] = dir();
    const x = dx * 0.42, y = -0.36 + dy * 0.2, z = -0.6 + dz * 0.28;
    if (Math.abs(Math.sin(y * 48 + z * 8)) < 0.35) { pts.push([x, y, z, 2]); n++; }
  }
  // Brain stem.
  for (let i = 0; i < 120; i++) {
    const t = rand(), a = rand() * Math.PI * 2, r = 0.11 - t * 0.03;
    pts.push([Math.cos(a) * r, -0.3 - t * 0.55, -0.18 - t * 0.12 + Math.sin(a) * r, 3]);
  }

  const sparks = new Float32Array(pts.length); // firing intensity per dot
  let size = 0, angle = 0.6, last = 0, raf = 0, visible = true;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = canvas.clientWidth;
    canvas.width = canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(dt) {
    ctx.clearRect(0, 0, size, size);
    angle += dt * 0.16;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const tilt = 0.32, ct = Math.cos(tilt), st = Math.sin(tilt);
    const scale = size * 0.38, cx = size / 2, cy = size / 2;

    if (!reduced && Math.random() < dt * 9) sparks[Math.floor(Math.random() * pts.length)] = 1;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      // Spin around the vertical axis, then tilt toward the viewer.
      const x1 = p[0] * ca + p[2] * sa;
      const z1 = -p[0] * sa + p[2] * ca;
      const y0 = p[1] + 0.12;
      const y1 = y0 * ct - z1 * st;
      const z2 = y0 * st + z1 * ct;
      const persp = 3.2 / (3.2 - z2);
      const depth = (z2 + 1) / 2; // 0 back … 1 front

      let a = (p[3] === 1 ? 0.12 : 0.22) + depth * (p[3] === 1 ? 0.2 : 0.6);
      let r = (0.7 + depth * 0.8) * Math.sqrt(size / 170);
      let color = p[3] === 2 ? "201,164,78" : p[3] === 3 ? "159,174,224" : "245,241,232";

      const sp = sparks[i];
      if (sp > 0) {
        sparks[i] = Math.max(0, sp - dt * 1.6);
        color = "224,107,90"; a = Math.max(a, sp); r *= 1 + sp * 1.4;
      }
      ctx.fillStyle = `rgba(${color},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx + x1 * scale * persp, cy - y1 * scale * persp, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(t) {
    draw(Math.min((t - last) / 1000, 0.1));
    last = t;
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduced || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  resize();
  draw(0);
  window.addEventListener("resize", () => { resize(); draw(0); });
  document.addEventListener("visibilitychange", start);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
})();

// The loop — a pinned scroll graphic. The section stays on screen while scroll
// walks through nine steps: the past, then six stops around a ring (reminder →
// alarm → body → thought → escape → relief), then the loop tightening, then the
// break at the thought. Without JS the steps read as a plain list.
(function () {
  const section = document.querySelector(".loop");
  if (!section) return;
  const svg = section.querySelector(".loop-diagram");
  const track = section.querySelector(".loop-track");
  const steps = [...section.querySelectorAll(".loop-step")];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const STEPS = steps.length; // 9
  // Geometry: a ring in a wide canvas, leaving room beside each dot for its
  // title. Phones crop to the ring and hide the titles (the text sits below).
  const CX = 290, CY = 230, R = 120;
  const WIDE = "0 0 580 460", NARROW = "70 40 440 400";
  const LABELS = ["reminder", "alarm", "body", "thought", "escape", "relief"];
  const THOUGHT = 3;
  const titleOf = (i) => steps[i].querySelector("h3").textContent.trim();

  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(n);
    return n;
  };
  const ang = (i) => (-90 + i * 60) * Math.PI / 180;
  const pos = (i, r = R) => [CX + r * Math.cos(ang(i)), CY + r * Math.sin(ang(i))];

  const narrow = window.matchMedia("(max-width: 760px)");
  const fitView = () => svg.setAttribute("viewBox", narrow.matches ? NARROW : WIDE);
  fitView();
  narrow.addEventListener("change", fitView);

  // Faint dotted ring, the link from the past to the first reminder, then arcs.
  el("circle", { class: "ring-base", cx: CX, cy: CY, r: R });
  const link = el("path", { class: "link", d: `M${CX} ${CY - 22} L${CX} ${CY - R + 22}`, pathLength: 1 });
  const arcs = LABELS.map((_, i) => {
    const [x1, y1] = pos(i), [x2, y2] = pos((i + 1) % 6);
    return el("path", {
      class: "arc", pathLength: 1, "stroke-dasharray": "1 1", "stroke-dashoffset": 1,
      d: `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    });
  });
  const pulse = el("circle", { class: "pulse", r: 5, opacity: 0 });

  // Split a title into lines of about 20 characters.
  function wrap(str, max = 20) {
    const lines = [""];
    for (const w of str.split(" ")) {
      const cur = lines[lines.length - 1];
      if (cur && (cur + " " + w).length > max) lines.push(w);
      else lines[lines.length - 1] = cur ? cur + " " + w : w;
    }
    return lines;
  }

  // A node: dot, a one-word label, and the step's title beside it.
  // side: "above" | "below" | "start" | "end" (which way the text runs from the dot).
  const LINE = 17;
  function node(x, y, label, title, side) {
    const g = el("g", { class: "node" });
    el("circle", { cx: x, cy: y, r: 12 }, g);
    const anchor = side === "start" || side === "end" ? side : "middle";
    const tx = side === "start" ? x + 24 : side === "end" ? x - 24 : x;
    const word = el("text", { x: tx, "text-anchor": anchor, "dominant-baseline": "middle" }, g);
    word.textContent = label;
    const t = el("text", { class: "title", x: tx, "text-anchor": anchor, "dominant-baseline": "middle" }, g);

    function setTitle(str) {
      t.textContent = "";
      const lines = wrap(str);
      lines.forEach((ln) => { el("tspan", { x: tx, dy: LINE }, t).textContent = ln; });
      // Stack the word + title block on the right side of the dot.
      const block = (lines.length + 1) * LINE;
      const top = side === "above" ? y - 26 - block + LINE / 2
        : side === "below" ? y + 30
        : y - block / 2 + LINE / 2;
      word.setAttribute("y", top);
      t.setAttribute("y", top);
    }
    setTitle(title);
    return { g, word, setTitle };
  }

  const past = node(CX, CY, "the past", titleOf(0), "below");
  past.g.classList.add("past");
  const nodes = LABELS.map((label, i) => {
    const [x, y] = pos(i);
    const c = Math.cos(ang(i)), sn = Math.sin(ang(i));
    const side = c > 0.3 ? "start" : c < -0.3 ? "end" : sn < 0 ? "above" : "below";
    return node(x, y, label, titleOf(i + 1), side);
  });

  section.classList.add("is-live");

  let wasBroken = false, sf = 0, active = -1, dotAngle = ang(0), moving = false, last = 0, raf = 0, inView = false;
  const clamp = (v) => Math.max(0, Math.min(1, v));

  function update() {
    const rect = track.getBoundingClientRect();
    const stageH = section.querySelector(".loop-stage").offsetHeight;
    const p = clamp((60 - rect.top) / Math.max(1, rect.height - stageH));
    sf = p * STEPS;
    const step = Math.min(STEPS - 1, Math.floor(sf));

    if (step !== active) {
      steps.forEach((s, i) => {
        s.classList.toggle("is-active", i === step);
        if (i === step) s.setAttribute("aria-current", "step");
        else s.removeAttribute("aria-current");
      });
      active = step;
    }

    const tight = step === 7, broken = step === 8;
    svg.classList.toggle("is-tight", tight);
    link.style.strokeDasharray = `${clamp(sf / 0.8)} 1`;

    // Each arc grows while its starting node is the current step.
    arcs.forEach((a, i) => {
      a.setAttribute("stroke-dashoffset", 1 - clamp((sf - (i + 1)) / 0.7));
      a.style.opacity = broken ? (i === THOUGHT ? 0.08 : 0.45) : 1;
    });
    nodes.forEach((n, i) => {
      n.g.classList.toggle("on", sf >= i + 1);
      n.g.classList.toggle("current", step === i + 1);
      n.g.classList.toggle("freed", broken && i === THOUGHT);
    });
    if (broken !== wasBroken) {
      nodes[THOUGHT].word.textContent = broken ? "reframe" : "thought";
      nodes[THOUGHT].setTitle(titleOf(broken ? 8 : 4));
      wasBroken = broken;
    }
    past.g.classList.toggle("current", step === 0);

    moving = sf >= 7 && !reduced;
    pulse.setAttribute("opacity", moving || (broken && reduced) ? 1 : 0);
    if (!moving) placeDot();
  }

  function placeDot() {
    pulse.setAttribute("cx", (CX + R * Math.cos(dotAngle)).toFixed(1));
    pulse.setAttribute("cy", (CY + R * Math.sin(dotAngle)).toFixed(1));
  }

  // The dot runs the closed loop, faster as it tightens. At the break it
  // travels on until it reaches the thought, then stops there.
  function frame(t) {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    if (moving) {
      const stop = ang(THOUGHT);
      if (active === 8) {
        const to = ((stop - dotAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        dotAngle += Math.min(to, dt * 4);
      } else {
        dotAngle += dt * (0.9 + 3.2 * clamp(sf - 7));
      }
      dotAngle %= 2 * Math.PI;
      placeDot();
    }
    raf = inView ? requestAnimationFrame(frame) : 0;
  }

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  }, { passive: true });
  window.addEventListener("resize", update);
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }).observe(track);
  if (reduced) { dotAngle = ang(THOUGHT); }
  update();
})();
