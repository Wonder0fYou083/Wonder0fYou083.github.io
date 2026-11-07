(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const nav = $('.nav');
  const hero = $('.hero');
  const heroStage = $('.hero-stage');
  const heroName = $('.hero-name');
  const heroSub = $('.hero-sub');
  // One formatter per precision: toLocaleString builds a new one on every call, far too slow for rolling digits.
  const formatters = {};
  const number = (v, dec = 0) => {
    formatters[dec] = formatters[dec] || new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return formatters[dec].format(v);
  };
  const fields = $$('[data-field]');
  const decoding = reduced ? [] : $$('[data-decode]');
  const bioField = $('.bio-field');
  const navBar = $('.nav-bar');
  const waiting = [];

  if (!reduced) { root.classList.add('seam-on'); root.classList.add('bio-live'); }

  /* ---------- hero seam: follows the pointer, wipes in on load, rises with the scroll ---------- */
  const pointer = { x: 0, y: 0, on: false };
  const seam = { off: 0, tilt: 0, y: 0, base: 0, nameH: 0 };
  const loadStart = performance.now();

  function measureSeam() {
    const n = heroName.getBoundingClientRect();
    const s = heroStage.getBoundingClientRect();
    seam.base = n.top - s.top + n.height / 2;
    seam.nameH = n.height;
    seam.pinned = getComputedStyle(heroStage).position === 'sticky';
  }
  if (!reduced) {
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      pointer.on = true;
      pointer.x = e.clientX / innerWidth - 0.5;
      pointer.y = e.clientY / innerHeight - 0.5;
    }, { passive: true });
    addEventListener('resize', measureSeam);
    measureSeam();
    if (document.fonts) document.fonts.ready.then(measureSeam);
  }

  /* ---------- hero: a 3D field when the GPU can carry it, the flat seam when it can't ---------- */
  let heroGL = null;
  const heroFrames = { times: [], strikes: 0 };
  root.dataset.hero = 'static';
  function startHeroGL() {
    if (reduced || !window.GLFX) return;
    heroGL = GLFX.terrain($('.hero-gl'));
    if (!heroGL) return;
    root.dataset.hero = 'webgl';
    measureSeam();
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  function dropHeroGL() {
    heroGL = null;
    $('.hero-gl').style.display = 'none';
    root.dataset.hero = 'static';
    measureSeam();
    if (towers) {
      towers = null;
      towersOn = false;
      root.classList.remove('towers-on');
      startFlatWalkers();
    }
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  // Software rendering on an old laptop must not cost anyone the page: lighten it, then give up on it,
  // all within a couple of seconds. Hopelessly slow frames skip straight to the flat version.
  function watchHero(rawDt) {
    if (rawDt <= 0 || rawDt > 1) return;
    heroFrames.times.push(rawDt);
    if (heroFrames.times.length < 21) return;
    // The median, so one hiccup from the browser or a scroll can't cost anyone the 3D.
    const typical = heroFrames.times.sort((a, b) => a - b)[10];
    heroFrames.times.length = 0;
    if (typical > 0.07) { dropHeroGL(); return; }
    if (typical <= 0.03) return;
    heroFrames.strikes++;
    if (heroFrames.strikes >= 3) dropHeroGL();
    else heroGL.lower();
  }
  function soft(a, b, v) { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }

  function drawHero(now, dt, rawDt) {
    const travel = hero.offsetHeight - innerHeight;
    const p = seam.pinned && travel > 0 ? clamp(scrollY / travel, 0, 1) : 0;
    const t = now / 1000;
    // Without a pointer the seam breathes, so the page is alive on a phone too.
    const wantOff = pointer.on ? pointer.y * seam.nameH * 0.6 : Math.sin(t * 0.7) * seam.nameH * 0.09;
    const wantTilt = pointer.on ? pointer.x * seam.nameH * 0.44 : Math.sin(t * 0.45) * seam.nameH * 0.06;
    seam.off += (wantOff - seam.off) * 0.08;
    seam.tilt += (wantTilt - seam.tilt) * 0.08;
    // On load the ink wipes from the foot of the name up to the seam.
    const age = clamp((now - loadStart) / 1000, 0, 1);
    const wipe = (1 - age) ** 3 * seam.nameH * 0.5;
    seam.y = (seam.base + seam.off + wipe) * (1 - p * 2.3);
    const tilt = seam.tilt * clamp(1 - p * 2.3, 0, 1);
    const style = heroStage.style;
    if (heroGL) {
      const vh = heroStage.clientHeight, vw = heroStage.clientWidth;
      heroGL.draw({
        t, dt,
        ndc: 1 - (2 * seam.y) / vh,
        roll: -Math.atan2(2 * tilt, vw),
        camH: 6.5 + 8.5 * soft(0.05, 1, p),
        camX: pointer.x * 6,
        speed: 0.8 + p * 20,
        amp: 1 + p * 1.2,
        dim: 1,
        gap: 0.09 - 0.055 * soft(0.2, 0.7, p),
        dive: soft(0.3, 1, p) * 0.62,
        blue: (1 - soft(0.01, 0.08, p)) * 0.9 + soft(0.52, 0.66, p),
        near: 18 + 68 * soft(0.45, 0.7, p),
        pointer: pointer.on,
        nx: pointer.x * 2,
        ny: -pointer.y * 2,
      });
      watchHero(rawDt);
    } else {
      style.setProperty('--sl', `${(seam.y - tilt).toFixed(1)}px`);
      style.setProperty('--sr', `${(seam.y + tilt).toFixed(1)}px`);
    }
    // The dive: the words clear first, then the camera flies through the name.
    const so = 1 - soft(0.03, 0.17, p);
    const no = 1 - soft(0.3, 0.52, p);
    if (p !== seam.lastP) {
      // Only when the scroll moved: rewriting these every frame makes the browser restyle for nothing.
      seam.lastP = p;
      style.setProperty('--so', so.toFixed(3));
      style.setProperty('--no', no.toFixed(3));
      style.setProperty('--ns', (1 + 5 * p * p).toFixed(3));
      heroName.style.visibility = no < 0.02 ? 'hidden' : '';
      heroSub.style.visibility = so < 0.02 ? 'hidden' : '';
    }
  }

  /* ---------- figures that roll up to their real values ---------- */
  function rollFigure(el, to, { dec = 0, suffix = '', from = 0, ms = 1100 } = {}) {
    const fmt = (v) => number(v, dec) + suffix;
    if (reduced) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function step(now) {
      const k = clamp((now - t0) / ms, 0, 1);
      const e = 1 - (1 - k) ** 3;
      el.textContent = fmt(k === 1 ? to : from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ---------- headings decode from code to words; every letter keeps its width, so nothing reflows ---------- */
  const GLYPHS = '0123456789ABCDEFGHKLMNPRSTXZ{}[]<>=+';
  function decode(el) {
    const html = el.innerHTML;
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    const cells = [];
    [...el.childNodes].forEach((node) => {
      if (node.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      node.nodeValue.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (!part.trim()) { frag.append(' '); return; }
        const word = document.createElement('span');
        word.className = 'dw';
        word.setAttribute('aria-hidden', 'true');
        [...part].forEach((c) => {
          const s = document.createElement('span');
          s.className = 'dc';
          s.textContent = c;
          word.append(s);
          cells.push({ s, c });
        });
        frag.append(word);
      });
      node.replaceWith(frag);
    });
    // Read every width first, then write: alternating the two forces a full layout per letter.
    const widths = cells.map((x) => x.s.getBoundingClientRect().width);
    cells.forEach((x, i) => { x.s.style.width = `${widths[i]}px`; });
    const t0 = performance.now();
    let n = 0;
    (function step(now) {
      const k = clamp((now - t0) / 620, 0, 1);
      const done = Math.floor(cells.length * k);
      cells.forEach((x, i) => {
        if (i < done) x.s.textContent = x.c;
        else if (n % 3 === 0) x.s.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      });
      n++;
      if (k < 1) requestAnimationFrame(step);
      else { el.innerHTML = html; el.removeAttribute('aria-label'); }
    })(t0);
  }

  /* ---------- nav ink, reveals and scroll-linked effects: all follow the scroll ---------- */
  function onScroll() {
    const probe = nav.offsetHeight / 2;
    let ink = 'light';
    for (const field of fields) {
      const r = field.getBoundingClientRect();
      if (r.top > probe || r.bottom <= probe) continue;
      const kind = field.dataset.field;
      if (kind === 'hero') {
        const y = reduced ? parseFloat(getComputedStyle(heroName).top) || 0 : seam.y;
        ink = heroStage.getBoundingClientRect().top + y > probe ? 'light' : 'dark';
      } else if (kind === 'seam') {
        const s = $('[data-seam]', field);
        ink = s && getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().bottom > probe ? 'light' : 'dark';
      } else {
        ink = kind;
        const after = parseFloat(field.dataset.darkAfter);
        const until = parseFloat(field.dataset.darkUntil) || 2;
        const p = field.sceneProgress;
        if (after && p >= after && p < until) ink = 'dark';
      }
      break;
    }
    if (nav.dataset.ink !== ink) nav.dataset.ink = ink;

    for (let i = waiting.length - 1; i >= 0; i--) {
      const el = waiting[i];
      if (el.getBoundingClientRect().top >= innerHeight * 0.9) continue;
      el.classList.add('in');
      $$('.pre, .pre-lift', el).forEach((m) => m.classList.add('in'));
      if (el.parentElement) $$(':scope > .threads', el.parentElement).forEach((m) => m.classList.add('in'));
      $$('[data-roll]', el).forEach((f) => rollFigure(f, +f.dataset.roll, { dec: +f.dataset.dec || 0, suffix: f.dataset.suffix || '' }));
      waiting.splice(i, 1);
    }

    if (!reduced) {
      // The seam rises through the bio as the section passes; no pin, so it never holds the page up.
      const b = bioField.getBoundingClientRect();
      if (b.bottom > 0 && b.top < innerHeight) {
        const k = soft(innerHeight * 0.34, -b.height * 0.42, b.top);
        bioField.style.setProperty('--sy', `${(-k * 100).toFixed(2)}%`);
      }
      for (let i = decoding.length - 1; i >= 0; i--) {
        if (decoding[i].getBoundingClientRect().top < innerHeight * 0.82) {
          decode(decoding[i]);
          decoding.splice(i, 1);
        }
      }
      const max = document.documentElement.scrollHeight - innerHeight;
      navBar.style.setProperty('--pg', max > 0 ? (scrollY / max).toFixed(4) : '0');
    }
  }

  /* ---------- entrances: each kind of content arrives its own way, once ---------- */
  if (!reduced) {
    const hide = (el, delay, cls) => {
      el.classList.add('pre');
      if (cls) el.classList.add(cls);
      el.style.setProperty('--d', `${delay}ms`);
    };
    $$('[data-r]').forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight * 0.9) return;
      const kind = el.dataset.r;
      if (kind === 'group') {
        [...el.children].forEach((c, i) => hide(c, i * 80));
      } else if (kind === 'rows') {
        [...el.children].forEach((c, i) => hide(c, i * 110));
      } else if (kind === 'settle') {
        hide(el, 0, 'pre-settle');
      } else if (kind === 'flip') {
        // Each word flips up on its own hinge, like a departures board.
        let index = 0;
        [...el.childNodes].forEach((node) => {
          if (node.nodeType !== 3) return;
          const frag = document.createDocumentFragment();
          node.nodeValue.split(' ').forEach((word, i) => {
            if (i) frag.append(' ');
            const s = document.createElement('span');
            s.className = 'fl';
            s.textContent = word;
            s.style.setProperty('--fd', `${index++ * 130}ms`);
            frag.append(s);
          });
          node.replaceWith(frag);
        });
        el.classList.add('pre-flip');
      } else if (kind === 'letters') {
        const text = el.textContent;
        el.textContent = '';
        text.split(' ').forEach((word, i) => {
          if (i) el.append(' ');
          const s = document.createElement('span');
          s.textContent = word;
          s.classList.add('pre-lift');
          s.style.setProperty('--d', `${i * 140}ms`);
          el.append(s);
        });
      } else if (kind === 'threads') {
        // Letters arrive out of order on their own threads, then join.
        const h = $('h2', el);
        const text = h.textContent;
        h.setAttribute('aria-label', text);
        h.textContent = '';
        [...text].forEach((c) => {
          if (c === ' ') { h.append(' '); return; }
          const s = document.createElement('span');
          s.className = 'tc';
          s.setAttribute('aria-hidden', 'true');
          s.textContent = c;
          s.style.setProperty('--td', `${Math.round(Math.random() * 620)}ms`);
          s.style.setProperty('--tx', `${-Math.round(30 + Math.random() * 70)}vw`);
          h.append(s);
        });
        el.classList.add('pre-tc');
        const lanes = document.createElement('div');
        lanes.className = 'threads';
        lanes.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 9; i++) {
          const b = document.createElement('i');
          b.style.top = `${8 + i * 10.6}%`;
          b.style.setProperty('--td', `${Math.round(Math.random() * 420)}ms`);
          b.style.setProperty('--dur', `${Math.round(780 + Math.random() * 620)}ms`);
          lanes.append(b);
        }
        el.parentElement.prepend(lanes);
        const statement = $('.statement', el);
        if (statement) hide(statement, 1100);
      } else {
        hide(el, 0);
      }
      waiting.push(el);
    });
    // Tabbing must never land on something still waiting to fade in.
    addEventListener('focusin', (e) => {
      for (let n = e.target; n && n !== document.body; n = n.parentElement) {
        if (n.classList.contains('pre')) {
          n.style.setProperty('--d', '0ms');
          n.classList.add('in');
        }
      }
    });
  }

  /* ---------- memory walkers: how each loop order reads matrix b ---------- */
  const N = 12;
  const walkers = $$('.walk-c').map((canvas) => {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = 480 * dpr;
    canvas.height = 560 * dpr;
    ctx.scale(dpr, dpr);
    return { canvas, ctx, order: canvas.dataset.order, t: 0, rate: 34, visible: false };
  });
  const cellAt = (order, t) => {
    const a = Math.floor(t / N) % N;
    const b = Math.floor(t) % N;
    return order === 'ijk' ? { row: b, col: a } : { row: a, col: b };
  };
  function drawWalker(w) {
    const { ctx, order } = w;
    const size = 480, gap = 4, cell = (size - gap * (N - 1)) / N;
    const base = '#2c2c2e', lit = order === 'ijk' ? [161, 161, 166] : [41, 151, 255];
    ctx.clearRect(0, 0, size, 560);
    const ribbonY = 500, ribbonH = 44, rib = size / (N * N);
    const alpha = new Map();
    const LEN = 30;
    for (let k = 0; k < LEN; k++) {
      const c = cellAt(order, Math.max(0, w.t - k));
      const i = c.row * N + c.col;
      if (!alpha.has(i)) alpha.set(i, 1 - k / LEN);
    }
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const a = alpha.get(r * N + c);
        ctx.fillStyle = a ? `rgba(${lit[0]},${lit[1]},${lit[2]},${(0.18 + 0.82 * a).toFixed(3)})` : base;
        ctx.fillRect(c * (cell + gap), r * (cell + gap), cell, cell);
      }
    }
    ctx.fillStyle = base;
    ctx.fillRect(0, ribbonY, size, ribbonH);
    alpha.forEach((a, i) => {
      ctx.fillStyle = `rgba(${lit[0]},${lit[1]},${lit[2]},${(0.18 + 0.82 * a).toFixed(3)})`;
      ctx.fillRect(i * rib, ribbonY, Math.max(rib, 2), ribbonH);
    });
    const head = cellAt(order, w.t);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(head.col * (cell + gap), head.row * (cell + gap), cell, cell);
    ctx.fillRect((head.row * N + head.col) * rib, ribbonY, Math.max(rib, 2), ribbonH);
  }
  let towers = null, towersOn = false;
  if (!reduced && window.GLFX) {
    const canvas = $('.towers');
    root.classList.add('towers-on');
    towers = GLFX.towers(canvas);
    if (towers) {
      new IntersectionObserver((es) => { towersOn = es[0].isIntersecting; }).observe(canvas);
    } else {
      root.classList.remove('towers-on');
    }
  }
  function startFlatWalkers() {
    if (!walkers.length) return;
    if (reduced) {
      walkers.forEach((w) => { w.t = N * 2 + 6; drawWalker(w); });
    } else if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        const w = walkers.find((x) => x.canvas === e.target);
        if (w) w.visible = e.isIntersecting;
      }));
      walkers.forEach((w) => { drawWalker(w); io.observe(w.canvas); });
    }
  }
  if (!towers) startFlatWalkers();

  /* ---------- skills marquee: speeds up with the scroll ---------- */
  const mqAnims = reduced ? [] : $$('.mq-track').flatMap((t) => (t.getAnimations ? t.getAnimations() : []));
  let mqRate = 1;

  /* ---------- for a mouse only: an inverting cursor, magnetic buttons, a card that tilts ---------- */
  let blob = null;
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const el = document.createElement('div');
    el.className = 'blob';
    el.setAttribute('aria-hidden', 'true');
    el.style.transform = 'translate(-100px, -100px)';
    document.body.append(el);
    blob = { el, x: -100, y: -100, tx: -100, ty: -100, s: 1, ws: 1 };
    addEventListener('pointermove', (e) => {
      blob.tx = e.clientX;
      blob.ty = e.clientY;
      const hit = e.target.closest ? e.target : null;
      blob.ws = hit && hit.closest('a, button') ? 3.4 : 1;
      blob.overBlue = !!(hit && hit.closest('.field-blue, a, button, [data-ui], canvas'));
    }, { passive: true });

    $$('.pill').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.setProperty('--mx', `${((e.clientX - r.left - r.width / 2) * 0.28).toFixed(1)}px`);
        b.style.setProperty('--my', `${((e.clientY - r.top - r.height / 2) * 0.4).toFixed(1)}px`);
      });
      b.addEventListener('pointerleave', () => { b.style.setProperty('--mx', '0px'); b.style.setProperty('--my', '0px'); });
    });

    $$('[data-tilt]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transition = 'transform 220ms ease-out';
        card.style.transform = `perspective(1600px) rotateX(${(-y * 2.6).toFixed(2)}deg) rotateY(${(x * 2.6).toFixed(2)}deg)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  /* ---------- one loop for everything that moves on its own ---------- */
  if (reduced) {
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    onScroll();
  } else {
    let lastY = -1, lastT = performance.now(), settle = 60;
    (function tick(now) {
      requestAnimationFrame(tick);
      if (document.hidden) { lastT = now; return; }
      const rawDt = (now - lastT) / 1000;
      const dt = Math.min(0.1, rawDt);
      lastT = now;
      const y = scrollY;
      const v = lastY < 0 ? 0 : Math.abs(y - lastY);
      if (y !== lastY) settle = 60; // scrubbed scenes keep catching up for a moment after the scroll stops
      lastY = y;
      if (heroStage.getBoundingClientRect().bottom > 0) drawHero(now, dt, rawDt);
      if (settle > 0) { onScroll(); settle--; }
      if (towers && towersOn) towers.draw({ t: now / 1000, dt, x: pointer.x, y: pointer.y });
      for (const w of walkers) {
        if (!w.visible) continue;
        w.t += w.rate * dt;
        drawWalker(w);
      }
      if (blob) {
        blob.x += (blob.tx - blob.x) * 0.22;
        blob.y += (blob.ty - blob.y) * 0.22;
        blob.s += (blob.ws - blob.s) * 0.18;
        blob.el.style.transform = `translate(${blob.x.toFixed(1)}px, ${blob.y.toFixed(1)}px) scale(${blob.s.toFixed(3)})`;
        // Inverting over blue gives orange, so anything blue or interactive gets a neutral gray instead.
        const diving = y > innerHeight * 0.45 && y < hero.offsetHeight;
        const neutral = blob.overBlue || diving;
        if (neutral !== blob.neutral) { blob.neutral = neutral; blob.el.classList.toggle('on-blue', neutral); }
      }
      if (mqAnims.length) {
        const want = 1 + Math.min(7, v * 0.35);
        const next = mqRate + (want - mqRate) * (want > mqRate ? 0.25 : 0.04);
        if (Math.abs(next - mqRate) > 0.005) {
          mqRate = next;
          mqAnims.forEach((a) => { if (a.updatePlaybackRate) a.updatePlaybackRate(mqRate); else a.playbackRate = mqRate; });
        }
      }
    })(performance.now());
  }

  /* ---------- scene 1: the terminal opens and the trace types itself ---------- */
  window.Scenes = window.Scenes || {};
  const code = $('#trace');
  if (code) {
    // Each trace record is its own block, wrapped or not.
    code.innerHTML = code.innerHTML.split('\n').map((l) => `<span class="tl">${l}</span>`).join('');
  }
  let chars = null;
  function splitChars() {
    if (chars) return chars;
    chars = [];
    const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      [...node.textContent].forEach((c) => {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = c;
        frag.append(s);
        chars.push(s);
      });
      node.replaceWith(frag);
    });
    return chars;
  }
  Scenes['swe-run'] = (rootEl) => Stage.scene(rootEl, {
    hold: 2,
    scrub: 0.35,
    build(tl, { q }) {
      const all = splitChars();
      const head = q('.swe-head')[0], term = q('.term')[0], inner = q('.term-in')[0], cap = q('.term figcaption')[0];
      const loop = q('.loop li');
      const m = { steps: $('#m-steps'), cost: $('#m-cost'), time: $('#m-time') };
      const b = { steps: $('#b-steps'), cost: $('#b-cost'), time: $('#b-time') };
      const sample = { steps: 4, cost: 0.02, time: 38 };
      const budget = { steps: 30, cost: 0.5, time: 600 };
      const lineEnds = [];
      let n = 0;
      q('#trace .tl').forEach((l) => { n += $$('.ch', l).length; lineEnds.push(n); });

      let shown = -1;
      // The first record is already there when the terminal starts to open.
      const render = (k) => {
        const count = Math.round(lineEnds[0] + (all.length - lineEnds[0]) * k);
        if (count !== shown) {
          const was = Math.max(0, shown);
          for (let i = Math.min(was, count); i < Math.max(was, count); i++) all[i].classList.toggle('on', i < count);
          if (shown >= 0 && all[shown - 1]) all[shown - 1].classList.remove('cur');
          if (all[count - 1] && count < all.length) all[count - 1].classList.add('cur');
          shown = count;
        }
        const steps = lineEnds.slice(1, 5).filter((e) => count >= e).length;
        const frac = clamp(k * 1.02, 0, 1);
        m.steps.textContent = String(steps);
        m.cost.textContent = `$${(sample.cost * frac).toFixed(2)}`;
        m.time.textContent = `${Math.round(sample.time * frac)} s`;
        b.steps.style.setProperty('--v', (steps / budget.steps).toFixed(3));
        b.cost.style.setProperty('--v', (sample.cost * frac / budget.cost).toFixed(3));
        b.time.style.setProperty('--v', (sample.time * frac / budget.time).toFixed(3));
        const phase = k <= 0 || k >= 1 ? -1 : Math.floor(k * 12) % 3;
        loop.forEach((li, i) => li.classList.toggle('is-on', i === phase));
      };
      render(0);

      gsap.set(cap, { autoAlpha: 0 });
      tl.fromTo(term, { clipPath: 'inset(56% 9% 0% 9% round 18px 18px 0px 0px)', rotationX: 30, scale: 0.92, transformPerspective: 1500, transformOrigin: '50% 100%' }, { clipPath: 'inset(0% 0% 0% 0% round 0px 0px 0px 0px)', rotationX: 0, scale: 1, duration: 0.32, ease: 'power1.inOut' }, 0)
        .fromTo(inner, { y: '25svh', scale: 0.84 }, { y: 0, scale: 1, duration: 0.32, ease: 'power1.inOut' }, 0)
        .to(head, { y: -70, autoAlpha: 0, duration: 0.16 }, 0.02)
        .to({ k: 0 }, { k: 1, duration: 0.66, onUpdate() { render(this.targets()[0].k); } }, 0.2)
        .to(cap, { autoAlpha: 1, duration: 0.06 }, 0.88);
    },
  });

  /* ---------- scene 2: the path draws and the grid opens as volatility rises ---------- */
  Scenes['grid-open'] = (rootEl) => Stage.scene(rootEl, {
    hold: 2,
    scrub: 0.35,
    build(tl, { q }) {
      const svg = q('.chart svg')[0];
      const rect = q('#reveal-rect')[0];
      const wins = q('.win');
      const band = q('.band')[0];
      const plot = q('.chart-plot')[0];
      const dot = q('.chart-dot')[0];
      const xOut = $('#chart-x');
      const peak = $('#chart-peak');
      const formula = q('.formula')[0];
      const cap = q('.chart figcaption')[0];
      const W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
      const pts = (q('.path')[0].getAttribute('d').match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const deltas = wins.map((g) => +g.dataset.delta);
      const from = wins.map((g) => +g.dataset.from);
      const START = 0.04, SPAN = 0.84;
      if (peak) peak.textContent = '';

      gsap.set([formula, cap], { autoAlpha: 0 });
      const render = (k) => {
        const px = k * W;
        const i = clamp(Math.round(k * (pts.length / 2 - 1)), 0, pts.length / 2 - 1);
        const py = pts[i * 2 + 1];
        const s = svg.getBoundingClientRect(), o = plot.getBoundingClientRect();
        dot.style.transform = `translate(${(s.left - o.left + (px / W) * s.width).toFixed(1)}px, ${(s.top - o.top + (py / H) * s.height).toFixed(1)}px)`;
        let w = 0;
        while (w < from.length - 1 && from[w + 1] <= px) w++;
        xOut.textContent = `×${(deltas[w] / deltas[0]).toFixed(1)}`;
      };
      render(0);

      tl.fromTo(rect, { attr: { width: 0 } }, { attr: { width: W }, duration: SPAN }, START)
        .to({ k: 0 }, { k: 1, duration: SPAN, onUpdate() { render(this.targets()[0].k); } }, START);
      wins.forEach((g, i) => {
        tl.fromTo(g, { scaleY: 0, autoAlpha: 0, svgOrigin: `0 ${H / 2}` }, { scaleY: 1, autoAlpha: 1, duration: 0.05, ease: 'power2.out' }, START + SPAN * (from[i] / W));
      });
      const on = START + SPAN * 0.3, off = START + SPAN * 0.66, d = 0.035;
      const flip = q('.grid-flip')[0], lede = q('.lede')[0], link = q('.lede .go')[0];
      const path = q('.path')[0], read = q('.chart-read')[0], mid = q('.mid')[0];
      tl.fromTo(band, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, on);
      [[on, ['#f5f5f7', '#2997ff', '#ffffff', '#a1a1a6', '#141416', '#3a3a3c']], [off, ['#1d1d1f', '#0066cc', '#1d1d1f', '#6e6e73', '#e8e8ed', '#a1a1a6']]].forEach(([at, c]) => {
        tl.to(lede, { color: c[0], duration: d }, at)
          .to(link, { color: c[1], duration: d }, at)
          .to(path, { stroke: c[2], duration: d }, at)
          .to(read, { color: c[3], duration: d }, at)
          .to(band, { fill: c[4], duration: d }, at)
          .to(mid, { stroke: c[5], duration: d }, at);
      });
      tl.fromTo(flip, { autoAlpha: 0 }, { autoAlpha: 1, duration: d }, on)
        .to(flip, { autoAlpha: 0, duration: d }, off)
        .to([formula, cap], { autoAlpha: 1, duration: 0.05 }, 0.92);
    },
  });

  /* ---------- scene 3: experience runs sideways while the figures roll up to the real numbers ---------- */
  Scenes['xp-run'] = (rootEl) => Stage.scene(rootEl, {
    hold: 2,
    scrub: 0.35,
    phone: 'rest',
    build(tl, { q }) {
      const track = q('.xp-track')[0];
      const bigs = q('.xp-big');
      // Two slides with a rest either side, so each role can actually be read.
      const slides = [[0.14, 0.42], [0.58, 0.86]];
      slides.forEach(([a, b], i) => {
        tl.to(track, { xPercent: -33.3333 * (i + 1), duration: b - a, ease: 'power2.inOut' }, a);
        // The figures travel further than their panels, so the numbers feel closer than the names.
        tl.to(bigs[i], { x: '-30vw', duration: b - a, ease: 'power2.inOut' }, a);
        tl.fromTo(bigs[i + 1], { x: '30vw' }, { x: '0vw', duration: b - a, ease: 'power2.inOut' }, a);
      });
      q('[data-roll]').forEach((f) => {
        const panel = q('.xp-panel').indexOf(f.closest('.xp-panel'));
        const dec = +f.dataset.dec || 0, suffix = f.dataset.suffix || '', goal = +f.dataset.roll;
        const fmt = (v) => number(v, dec) + suffix;
        const [a, b] = slides[panel - 1];
        const counter = { v: 0 };
        let shown = fmt(0);
        f.textContent = shown;
        tl.to(counter, {
          v: goal,
          duration: b - a + 0.04,
          ease: 'power1.out',
          onUpdate() {
            const next = fmt(counter.v);
            if (next !== shown) { shown = next; f.textContent = next; }
          },
        }, a);
      });
    },
    rest({ q }) { q('[data-roll]').forEach((f) => { f.textContent = number(+f.dataset.roll, +f.dataset.dec || 0) + (f.dataset.suffix || ''); }); },
  });

  if (window.Stage) { Stage.smooth(); Stage.init(); }
  // The name is already on screen; the 3D field joins it after the first paint.
  requestAnimationFrame(() => requestAnimationFrame(startHeroGL));

  /* ---------- the benchmark: really runs, on this device ---------- */
  const run = $('#bench-run');
  if (!run) return;

  const SIZE = 512;
  const PASSES = 3;
  const big = $('#bench-big');
  const sub = $('#bench-sub');
  const note = $('#bench-note');
  const bars = { ijk: $('#bar-ijk'), ikj: $('#bar-ikj') };
  const times = { ijk: $('#time-ijk'), ikj: $('#time-ikj') };

  // An inline worker keeps the page responsive and also works when opened from file://.
  const workerSource = `
    self.onmessage = (event) => {
      const { n, passes } = event.data;
      const a = new Float32Array(n * n), b = new Float32Array(n * n);
      const c = new Float32Array(n * n), check = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) { a[i] = Math.random() - 0.5; b[i] = Math.random() - 0.5; }

      const ijk = (out) => {
        out.fill(0);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++)
            for (let k = 0; k < n; k++)
              out[i * n + j] += a[i * n + k] * b[k * n + j];
      };
      const ikj = (out) => {
        out.fill(0);
        for (let i = 0; i < n; i++)
          for (let k = 0; k < n; k++)
            for (let j = 0; j < n; j++)
              out[i * n + j] += a[i * n + k] * b[k * n + j];
      };

      const best = { ijk: Infinity, ikj: Infinity };
      for (let pass = 1; pass <= passes; pass++) {
        for (const [name, fn, out] of [['ijk', ijk, check], ['ikj', ikj, c]]) {
          self.postMessage({ type: 'start', name, pass });
          const t0 = performance.now();
          fn(out);
          best[name] = Math.min(best[name], performance.now() - t0);
          self.postMessage({ type: 'lap', best });
        }
      }
      let identical = true;
      for (let i = 0; i < n * n; i++) if (c[i] !== check[i]) { identical = false; break; }
      self.postMessage({ type: 'done', best, identical });
    };
  `;

  const label = { ijk: 'i‑j‑k', ikj: 'i‑k‑j' };
  const fmt = (ms) => (ms === Infinity ? 'Running' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

  function drawBars(best) {
    const known = [best.ijk, best.ikj].filter((v) => v !== Infinity);
    const top = known.length ? Math.max(...known) : 1;
    for (const name of ['ijk', 'ikj']) {
      times[name].textContent = fmt(best[name]);
      bars[name].style.transform = best[name] === Infinity ? 'scaleX(0)' : `scaleX(${(best[name] / top).toFixed(4)})`;
    }
  }

  run.hidden = false;
  run.addEventListener('click', () => {
    let worker;
    const fail = () => {
      if (worker) worker.terminate();
      big.classList.remove('is-result');
      big.textContent = 'How much faster?';
      sub.textContent = "This browser couldn't run the benchmark.";
      run.disabled = false;
      run.textContent = 'Try again';
    };
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
    } catch (error) {
      fail();
      return;
    }

    run.disabled = true;
    run.textContent = 'Running';
    big.classList.remove('is-result');
    big.textContent = 'Measuring…';
    sub.textContent = `Running ${PASSES} passes of each order on this device.`;
    drawBars({ ijk: Infinity, ikj: Infinity });
    if (towers) { towers.setRate('ijk', 150); towers.setRate('ikj', 150); }

    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (data.type === 'start') {
        sub.textContent = `Pass ${data.pass} of ${PASSES}: ${label[data.name]}`;
      } else if (data.type === 'lap') {
        drawBars(data.best);
      } else if (data.type === 'done') {
        worker.terminate();
        const ratio = data.best.ijk / data.best.ikj;
        drawBars(data.best);
        big.classList.add('is-result');
        rollFigure(big, ratio, { dec: 1, suffix: '×', from: 1, ms: 1200 });
        if (towers) { towers.setRate('ijk', 54); towers.setRate('ikj', 54 * Math.max(1, ratio)); }
        sub.textContent = ratio >= 1.05
          ? 'faster, measured just now on this device.'
          : 'No real difference on this device, measured just now.';
        note.textContent = `512 × 512 floats, best of ${PASSES}.${data.identical ? ' Both orders matched exactly.' : ''} Runs in JavaScript on this device; the repo itself is C.`;
        // The walker for the faster order now really does move faster.
        const fast = walkers.find((w) => w.order === 'ikj');
        if (fast && ratio >= 1) fast.rate = 34 * ratio;
        run.disabled = false;
        run.textContent = 'Run again';
      }
    };
    worker.postMessage({ n: SIZE, passes: PASSES });
  });
})();
