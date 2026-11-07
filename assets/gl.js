// Raw WebGL2, no libraries. Two small scenes built from the same instanced cube:
//   GLFX.terrain(canvas)  the hero: a field of matrix cells rolling out to a horizon
//   GLFX.towers(canvas)   the matrix section: cells rise as each loop order reads them
(() => {
  const context = (canvas) => {
    try {
      return canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      return null;
    }
  };

  const program = (gl, vs, fs) => {
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };

  // A unit column, open at the bottom: x and z in -0.5..0.5, y in 0..1. Position then normal.
  const CUBE = (() => {
    const P = (x, y, z) => [x, y, z];
    const face = (n, a, b, c, d) => [a, b, c, a, c, d].flatMap((v) => [...v, ...n]);
    const l = -0.5, r = 0.5, f = 0.5, k = -0.5;
    return new Float32Array([
      ...face([0, 1, 0], P(l, 1, f), P(r, 1, f), P(r, 1, k), P(l, 1, k)),
      ...face([0, 0, 1], P(l, 0, f), P(r, 0, f), P(r, 1, f), P(l, 1, f)),
      ...face([1, 0, 0], P(r, 0, f), P(r, 0, k), P(r, 1, k), P(r, 1, f)),
      ...face([-1, 0, 0], P(l, 0, k), P(l, 0, f), P(l, 1, f), P(l, 1, k)),
      ...face([0, 0, -1], P(r, 0, k), P(l, 0, k), P(l, 1, k), P(r, 1, k)),
    ]);
  })();

  const bindCube = (gl) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  };

  // Column-major 4x4 helpers.
  // Writes into o: new typed arrays every frame would keep triggering major garbage collections.
  const mul = (o, a, b) => {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  };
  const perspective = (tanHalf, aspect, near, far) => [
    1 / (tanHalf * aspect), 0, 0, 0,
    0, 1 / tanHalf, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ];
  const rotX = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
  const rotZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
  const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const lookAt = (e, t) => {
    const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
    const z = norm([e[0] - t[0], e[1] - t[1], e[2] - t[2]]);
    const x = norm([z[2], 0, -z[0]]);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  };

  const fit = (gl, canvas, ratio) => {
    const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    return w / h;
  };

  /* ---------- hero terrain ---------- */
  const TERRAIN_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNor;
  layout(location=2) in vec2 aCell;
  uniform mat4 uVP;
  uniform float uTime, uZ, uRows, uAmp, uPull, uDim, uBlue, uNear, uBack, uGap, uCap;
  uniform vec2 uPointer;
  out vec3 vColor;
  float field(vec2 p) {
    float t = uTime;
    return 0.5 * sin(p.x * 0.21 + t * 0.6)
         + 0.5 * sin(p.y * 0.17 - t * 0.45)
         + 0.7 * sin((p.x + p.y) * 0.09 + t * 0.3)
         + 0.35 * sin(length(p - vec2(9.0, 34.0)) * 0.42 - t * 1.1);
  }
  void main() {
    float wrapped = mod(aCell.y - uZ, uRows);
    // Some rows sit behind the camera, so there is still ground below when it tilts right down.
    float row = wrapped - uBack;
    vec2 here = vec2(aCell.x, row);
    float n = field(vec2(aCell.x, wrapped + uZ));
    float d = distance(here, uPointer);
    float pull = uPull * (exp(-d * d * 0.012) * 3.4 + 0.7 * sin(d * 0.8 - uTime * 3.4) * exp(-d * 0.09));
    // Capped below eye level, so no cell ever rises behind the name and tints its inverted ink.
    float h = clamp(0.45 + uAmp * (n + 2.05) * 0.62 + pull, 0.08, uCap);
    vec3 p = aPos;
    p.xz *= 1.0 - uGap;
    p.y *= h;
    p.x += aCell.x;
    p.z -= row;
    gl_Position = uVP * vec4(p, 1.0);

    float fog = smoothstep((uRows - uBack) * 0.16, (uRows - uBack) * 0.92, row);
    float lit = max(dot(aNor, normalize(vec3(0.35, 0.85, 0.42))), 0.0);
    float crest = smoothstep(0.58, 1.0, (n + 2.05) / 4.1 + pull * 0.16);
    float shade = 0.045 + lit * (0.1 + crest * 0.56);
    vec3 col = vec3(shade);
    // Blue never sits under the name: its inverted ink would turn orange. The caller fades it accordingly.
    float near = 1.0 - smoothstep(uNear * 0.42, uNear, abs(row));
    col = mix(col, vec3(0.0, 0.44, 0.89) * (0.35 + 0.75 * lit), crest * near * uBlue);
    vColor = col * (1.0 - fog) * uDim;
  }`;
  const COLOR_FS = `#version 300 es
  precision mediump float;
  in vec3 vColor;
  out vec4 outColor;
  void main() { outColor = vec4(vColor, 1.0); }`;
  const PLANE_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;
  uniform mat4 uVP;
  out vec3 vColor;
  void main() { gl_Position = uVP * vec4(aPos, 1.0); vColor = vec3(0.0); }`;

  function terrain(canvas) {
    const gl = context(canvas);
    if (!gl) return null;
    const small = Math.min(innerWidth, innerHeight) < 620;
    const NX = small ? 70 : 120;
    const BACK = small ? 22 : 30;
    const NZ = (small ? 64 : 104) + BACK;
    let cubes, plane;
    try {
      cubes = program(gl, TERRAIN_VS, COLOR_FS);
      plane = program(gl, PLANE_VS, COLOR_FS);
    } catch (e) {
      return null;
    }

    const cubeVao = gl.createVertexArray();
    gl.bindVertexArray(cubeVao);
    bindCube(gl);
    const cells = new Float32Array(NX * NZ * 2);
    let at = 0;
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) { cells[at++] = x - NX / 2; cells[at++] = z; }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    const planeVao = gl.createVertexArray();
    gl.bindVertexArray(planeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    const S = 7000;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-S, 0, 30, S, 0, 30, S, 0, -S, -S, 0, 30, S, 0, -S, -S, 0, -S]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(1, 1, 1, 1);

    const TAN = Math.tan((50 * Math.PI) / 180 / 2);
    let ratio = Math.min(devicePixelRatio || 1, 1.75);
    let rows = NZ, z = 0, pull = 0;
    const ptr = { x: 0, row: 30 };
    const m1 = new Float32Array(16), m2 = new Float32Array(16), m3 = new Float32Array(16);

    return {
      // Lower the load: first resolution and distance, and the caller gives up after that.
      lower() { ratio = Math.max(0.75, ratio * 0.68); rows = Math.max(BACK + 40, Math.round(rows * 0.72)); },
      draw(s) {
        const aspect = fit(gl, canvas, ratio);
        const pitch = Math.atan(s.ndc * TAN) + s.dive;
        const camZ = 2;
        z += s.speed * s.dt;

        // Where the pointer meets the ground, so the cells can rise to it.
        if (s.pointer) {
          const c = Math.cos(pitch), si = Math.sin(pitch);
          const dx = s.nx * TAN * aspect, vy = s.ny * TAN;
          const dy = vy * c - si, dz = -vy * si - c;
          if (dy < -0.01) {
            const t = s.camH / -dy;
            ptr.x += (s.camX + dx * t - ptr.x) * 0.14;
            ptr.row += (Math.min(rows, -(camZ + dz * t)) - ptr.row) * 0.14;
          }
        }
        pull += ((s.pointer ? 1 : 0) - pull) * 0.05;

        mul(m1, rotX(pitch), translate(-s.camX, -s.camH, -camZ));
        mul(m2, rotZ(s.roll), m1);
        const vp = mul(m3, perspective(TAN, aspect, 0.3, 9000), m2);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(plane.p);
        gl.uniformMatrix4fv(plane.u.uVP, false, vp);
        gl.bindVertexArray(planeVao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.useProgram(cubes.p);
        gl.uniformMatrix4fv(cubes.u.uVP, false, vp);
        gl.uniform1f(cubes.u.uTime, s.t);
        gl.uniform1f(cubes.u.uZ, z);
        gl.uniform1f(cubes.u.uRows, rows);
        gl.uniform1f(cubes.u.uBack, BACK);
        gl.uniform1f(cubes.u.uCap, s.camH * 0.62);
        // Narrower gaps as the camera climbs, so they never read as black lines straight below it.
        gl.uniform1f(cubes.u.uGap, s.gap == null ? 0.09 : s.gap);
        gl.uniform1f(cubes.u.uAmp, s.amp);
        gl.uniform1f(cubes.u.uPull, pull);
        gl.uniform1f(cubes.u.uDim, s.dim);
        gl.uniform1f(cubes.u.uBlue, s.blue);
        gl.uniform1f(cubes.u.uNear, s.near);
        gl.uniform2f(cubes.u.uPointer, ptr.x, ptr.row);
        gl.bindVertexArray(cubeVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, NX * rows);
      },
    };
  }

  /* ---------- matrix towers ---------- */
  const TOWERS_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNor;
  layout(location=2) in vec4 aPlace;
  layout(location=3) in float aKind;
  layout(location=4) in float aLevel;
  uniform mat4 uVP;
  out vec3 vColor;
  void main() {
    vec3 p = aPos;
    p.xz *= aPlace.zw;
    p.y *= 0.14 + aLevel * (aPlace.z < 0.5 ? 2.4 : 5.2);
    p.xz += aPlace.xy;
    gl_Position = uVP * vec4(p, 1.0);
    float lit = 0.35 + 0.65 * max(dot(aNor, normalize(vec3(0.3, 0.86, 0.42))), 0.0);
    vec3 tint = aKind < 0.5 ? vec3(0.66, 0.66, 0.69) : vec3(0.16, 0.59, 1.0);
    vec3 col = mix(vec3(0.17, 0.17, 0.18), tint, min(1.0, aLevel * 1.5));
    col = mix(col, vec3(1.0), smoothstep(0.92, 1.0, aLevel));
    vColor = col * lit;
  }`;

  function towers(canvas) {
    const gl = context(canvas);
    if (!gl) return null;
    let prog;
    try { prog = program(gl, TOWERS_VS, COLOR_FS); } catch (e) { return null; }

    const N = 16, CELLS = N * N, count = CELLS * 4;
    const place = new Float32Array(count * 4);
    const kind = new Float32Array(count);
    const target = new Float32Array(count);
    const level = new Float32Array(count);
    for (let g = 0; g < 2; g++) {
      const base = g * CELLS * 2;
      const cx = (g ? 1 : -1) * (N / 2 + 2.4);
      for (let i = 0; i < CELLS; i++) {
        const r = Math.floor(i / N), c = i % N;
        place.set([cx + c - (N - 1) / 2, r - (N - 1) / 2, 0.84, 0.84], (base + i) * 4);
        // The same cells as they sit in memory, one long row in front of the grid.
        place.set([cx + (i / (CELLS - 1) - 0.5) * (N - 0.6), N / 2 + 1.5, 0.06, 1.1], (base + CELLS + i) * 4);
        kind[base + i] = g;
        kind[base + CELLS + i] = g;
      }
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindCube(gl);
    const attr = (loc, size, data, usage) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(loc, 1);
      return b;
    };
    attr(2, 4, place, gl.STATIC_DRAW);
    attr(3, 1, kind, gl.STATIC_DRAW);
    const levelBuf = attr(4, 1, level, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(22 / 255, 22 / 255, 23 / 255, 1);

    const ratio = Math.min(devicePixelRatio || 1, 2);
    // The real access patterns: i-j-k walks down a column of b, i-k-j walks along a row.
    const cellAt = (order, step) => {
      const a = Math.floor(step / N) % N, b = step % N;
      return order === 'ijk' ? b * N + a : a * N + b;
    };
    const walk = [{ order: 'ijk', t: 0, rate: 54 }, { order: 'ikj', t: 0, rate: 54 }];
    const vpOut = new Float32Array(16);
    let yaw = 0, tilt = 0;

    return {
      setRate(order, rate) { walk.find((w) => w.order === order).rate = rate; },
      draw(s) {
        const aspect = fit(gl, canvas, ratio);
        const decay = Math.exp(-s.dt * 1.7);
        walk.forEach((w, g) => {
          const base = g * CELLS * 2;
          const from = Math.floor(w.t);
          w.t += w.rate * s.dt;
          for (let k = from; k <= Math.floor(w.t); k++) {
            const i = cellAt(w.order, k % CELLS);
            target[base + i] = 1;
            target[base + CELLS + i] = 1;
          }
        });
        for (let i = 0; i < count; i++) {
          target[i] *= decay;
          level[i] += (target[i] - level[i]) * 0.34;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, levelBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, level);

        yaw += ((s.x || 0) * 0.34 + Math.sin(s.t * 0.25) * 0.1 - yaw) * 0.06;
        tilt += ((s.y || 0) * 0.14 - tilt) * 0.06;
        // Far enough back that both grids, at any yaw, stay inside the frame.
        const R = Math.max(40, 78 / aspect);
        const el = 0.86 + tilt;
        const eye = [Math.sin(yaw) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(yaw) * Math.cos(el) * R + 1];
        const TAN = Math.tan((32 * Math.PI) / 180 / 2);
        const vp = mul(vpOut, perspective(TAN, aspect, 1, 300), lookAt(eye, [0, 0.8, 1]));

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(prog.p);
        gl.uniformMatrix4fv(prog.u.uVP, false, vp);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, count);
      },
    };
  }

  window.GLFX = { terrain, towers };
})();
