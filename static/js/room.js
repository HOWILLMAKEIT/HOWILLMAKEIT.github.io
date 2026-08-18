/* ============================================================
   郭昊的线稿书房 —— Three.js 矢量线稿可交互房间
   视觉技法致敬 Animnia/pure-line-room（Apache-2.0）：
   白底黑线、EdgesGeometry 棱边、hover 加粗（Line2）、
   昼夜反转、Web Audio 合成音效。房间布局与代码为独立实现。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 数据（由 Hugo 模板注入） ---------- */
  let DATA = { posts: [], projects: [], honors: [], about: {}, contact: [], links: [] };
  try {
    const el = document.getElementById('room-data');
    if (el) DATA = JSON.parse(el.textContent);
  } catch (e) { /* 保底为空 */ }

  /* ---------- 渲染器 ---------- */
  const canvasHost = document.getElementById('room-canvas-host');
  if (!canvasHost || !window.THREE) return;
  document.body.classList.add('room-page');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) {
    const fb = document.getElementById('room-fallback');
    if (fb) fb.style.display = 'flex';
    return;
  }
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8f7f2);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  function layoutCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    if (aspect >= 1.55) { camera.fov = 36; camera.position.set(11.9, 8.7, 12.8); }
    else if (aspect >= 1) { camera.fov = 40; camera.position.set(12.6, 9.2, 13.4); }
    else { camera.fov = Math.min(60, 46 / Math.max(0.55, aspect)); camera.position.set(15.5, 11, 15.5); }
    camera.lookAt(-0.45, 1.65, -0.25);
    camera.updateProjectionMatrix();
  }
  layoutCamera();

  /* ---------- 材质与基础工具 ---------- */
  const MAT = new THREE.LineBasicMaterial({ color: 0x000000 });
  const HIDE = new THREE.MeshBasicMaterial({ visible: false });
  const FILL = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });

  function V(x, y, z) { return new THREE.Vector3(x, y, z); }
  function geo(pts) { const a = []; for (const p of pts) a.push(V(p[0], p[1], p[2])); return new THREE.BufferGeometry().setFromPoints(a); }
  function line(pts) { return new THREE.Line(geo(pts), MAT); }
  function loop(pts) { return new THREE.LineLoop(geo(pts), MAT); }
  function edge(g, t) {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(g, FILL));
    grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, t === undefined ? 20 : t), MAT));
    return grp;
  }
  function box(w, h, d) { return edge(new THREE.BoxGeometry(w, h, d)); }
  function put(o, x, y, z, rx, ry, rz, parent) {
    o.position.set(x, y, z);
    if (rx) o.rotation.x = rx; if (ry) o.rotation.y = ry; if (rz) o.rotation.z = rz;
    (parent || scene).add(o); return o;
  }
  function circleXY(r, n) { const a = []; n = n || 40; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([Math.cos(t) * r, Math.sin(t) * r, 0]); } return loop(a); }
  function circleXZ(r, n) { const a = []; n = n || 40; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([Math.cos(t) * r, 0, Math.sin(t) * r]); } return loop(a); }
  function circleZY(r, n) { const a = []; n = n || 40; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([0, Math.cos(t) * r, Math.sin(t) * r]); } return loop(a); }
  function rectXY(w, h) { return loop([[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]]); }
  function rectXZ(w, d) { return loop([[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]]); }
  function arcXY(r, a0, a1, n) { const a = []; n = n || 16; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; a.push([Math.cos(t) * r, Math.sin(t) * r, 0]); } return line(a); }
  function E(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function rnd(seed) { let s = seed; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  /* ================= 房间外壳 ================= */
  put(new THREE.Mesh(new THREE.PlaneGeometry(12.4, 12.4), FILL), 0, -0.002, 0, -Math.PI / 2, 0, 0);
  put(loop([[-6, 0, -6], [6, 0, -6], [6, 0, 6], [-6, 0, 6]]), 0, 0.01, 0);
  for (let z = -5.2; z < 6; z += 0.8) put(line([[-6, 0.011, z], [6, 0.011, z]]), 0, 0, 0);

  put(box(12.4, 7, 0.24), 0, 3.5, -6.12);                       // 后墙
  const leftShape = new THREE.Shape();                          // 左墙（挖窗洞）
  leftShape.moveTo(-6, 0); leftShape.lineTo(6, 0); leftShape.lineTo(6, 7); leftShape.lineTo(-6, 7); leftShape.closePath();
  const winHole = new THREE.Path();
  winHole.moveTo(2.2, -0.9); winHole.lineTo(5.2, -0.9); winHole.lineTo(5.2, 1.7); winHole.lineTo(2.2, 1.7); winHole.closePath();
  leftShape.holes.push(winHole);
  put(edge(new THREE.ExtrudeGeometry(leftShape, { depth: 0.24, bevelEnabled: false })), -6.0, 0, 0, 0, -Math.PI / 2, 0);
  /* 右侧与前方完全开放（娃娃屋式剖切，与 pure-line-room 一致），保证相机视线无遮挡 */

  put(box(12.4, 0.32, 0.07), 0, 0.16, -6.0);                    // 踢脚线（仅后墙/左墙）
  put(box(0.07, 0.32, 12.4), -5.97, 0.16, 0);
  put(box(12.4, 0.14, 0.09), 0, 6.9, -6.0);                     // 顶角线（仅后墙/左墙）
  put(box(0.09, 0.14, 12.4), -5.95, 6.9, 0);

  /* 地毯 */
  put(rectXZ(3.6, 2.7), -3.5, 0.013, 0.7);
  put(rectXZ(3.3, 2.4), -3.5, 0.014, 0.7);

  /* ================= 门（博客之外的正式入口：简历/联系） ================= */
  const doorFrameG = new THREE.Group(); scene.add(doorFrameG);
  put(line([[-5.18, 0, -5.97], [-5.18, 4.35, -5.97]]), 0, 0, 0, 0, 0, 0, doorFrameG);
  put(line([[-3.32, 0, -5.97], [-3.32, 4.35, -5.97]]), 0, 0, 0, 0, 0, 0, doorFrameG);
  put(line([[-5.18, 4.35, -5.97], [-3.32, 4.35, -5.97]]), 0, 0, 0, 0, 0, 0, doorFrameG);
  put(line([[-5.08, 0, -5.96], [-5.08, 4.25, -5.96], [-3.42, 4.25, -5.96], [-3.42, 0, -5.96]]), 0, 0, 0, 0, 0, 0, doorFrameG);
  const doorG = new THREE.Group(); put(doorG, -5.08, 0, -5.94);
  put(box(1.58, 4.2, 0.08), 0.79, 2.1, 0, 0, 0, 0, doorG);
  put(rectXY(1.05, 1.5), 0.79, 3.25, 0.05, 0, 0, 0, doorG);
  put(rectXY(1.05, 1.7), 0.79, 1.15, 0.05, 0, 0, 0, doorG);
  put(circleZY(0.07, 16), 1.42, 2.05, 0.06, 0, 0, 0, doorG);
  /* 门牌：RESUME（三道笔划示意） */
  put(rectXY(0.62, 0.2), -4.25, 4.0, -5.955);
  for (let i = 0; i < 3; i++) put(line([[-4.48, 3.93 + i * 0.055, -5.95], [-4.02, 3.93 + i * 0.055, -5.95]]), 0, 0, 0, 0, 0, 0, scene);

  /* ================= 窗（左墙）+ 百叶 + 猫 ================= */
  const WZ = 0.7;
  const winFrameG = new THREE.Group(); scene.add(winFrameG);
  put(rectXY(3.3, 2.9), -5.97, 3.5, WZ, 0, Math.PI / 2, 0, winFrameG);
  put(rectXY(3.0, 2.6), -5.96, 3.5, WZ, 0, Math.PI / 2, 0, winFrameG);
  put(box(0.3, 0.1, 3.6), -5.85, 2.02, WZ, 0, 0, 0, winFrameG);
  put(box(0.34, 0.06, 3.4), -5.86, 2.24, WZ, 0, 0, 0, winFrameG);   // 窗台板
  const sashL = new THREE.Group(); put(sashL, -6.05, 3.5, WZ - 1.5);
  const sashR = new THREE.Group(); put(sashR, -6.05, 3.5, WZ + 1.5);
  function sashGeo(parent, dir) {
    const z0 = 0.03 * dir, z1 = 1.47 * dir, zm = dir * 0.75;
    put(loop([[0, -1.25, z0], [0, -1.25, z1], [0, 1.25, z1], [0, 1.25, z0]]), 0, 0, 0, 0, 0, 0, parent);
    put(line([[0, 0, z0], [0, 0, z1]]), 0, 0, 0, 0, 0, 0, parent);
    put(line([[0, -1.25, zm], [0, 1.25, zm]]), 0, 0, 0, 0, 0, 0, parent);
  }
  sashGeo(sashL, 1); sashGeo(sashR, -1);
  /* 窗外远景：山与飞鸟 */
  put(line([[-6.3, 4.1, WZ - 1.2], [-6.3, 4.1, WZ - 0.2], [-6.45, 4.35, WZ + 0.3], [-6.3, 4.1, WZ + 0.8]]), 0, 0, 0, 0, 0, 0, winFrameG);
  put(line([[-6.3, 3.9, WZ + 0.1], [-6.3, 3.9, WZ + 0.9], [-6.2, 4.0, WZ + 1.3]]), 0, 0, 0, 0, 0, 0, winFrameG);
  const blindG = new THREE.Group(); scene.add(blindG);
  const blindTop = 4.72, nSlat = 9;
  put(box(0.07, 0.14, 3.0), -5.9, blindTop + 0.07, WZ, 0, 0, 0, blindG);
  const slats = [], spread = [], collapsed = [];
  for (let i = 0; i < nSlat; i++) {
    slats.push(put(line([[-5.9, 0, WZ - 1.38], [-5.9, 0, WZ + 1.38]]), 0, 0, 0, 0, 0, 0, blindG));
    spread.push(2.32 + i * 0.27);
    collapsed.push(4.42 - (nSlat - 1 - i) * 0.055);
  }
  const cords = [
    put(line([[0, 0, 0], [0, -1, 0]]), -5.9, blindTop, WZ - 0.9, 0, 0, 0, blindG),
    put(line([[0, 0, 0], [0, -1, 0]]), -5.9, blindTop, WZ + 0.9, 0, 0, 0, blindG)
  ];
  /* 窗台上的猫 */
  const catG = new THREE.Group(); put(catG, -5.78, 2.28, 1.75);
  put(new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), FILL), 0, 0, 0, 0, Math.PI / 2, 0, catG);
  put(circleXY(0.26, 24), 0, 0, 0, 0, Math.PI / 2, 0, catG);
  put(arcXY(0.26, 0.3, Math.PI - 0.3, 20), 0, 0, 0, 0, Math.PI / 2, 0, catG);   // 蜷起来的背
  const catHead = new THREE.Group(); put(catHead, 0.16, 0.1, 0.14, 0, 0.4, 0, catG);
  put(circleXY(0.11, 20), 0, 0, 0, 0, Math.PI / 2, 0, catHead);
  /* 耳朵：与头同在 y-z 平面（x≈0），从 +x 方向可见 */
  put(line([[0.0, 0.08, 0.045], [0.01, 0.17, 0.075]]), 0, 0, 0, 0, 0, 0, catHead);
  put(line([[0.0, 0.05, -0.05], [0.01, 0.12, -0.1]]), 0, 0, 0, 0, 0, 0, catHead);
  const catTail = new THREE.Group(); put(catTail, -0.1, -0.05, -0.18, 0, 0, 0, catG);
  const tailPts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; tailPts.push([Math.sin(t * 2.4) * 0.22 - 0.05, Math.sin(t * Math.PI) * 0.1, -t * 0.15]); }
  put(line(tailPts), 0, 0, 0, 0, 0, 0, catTail);

  /* ================= 墙面：画像 / 挂钟 / 开关 ================= */
  const picG = new THREE.Group(); scene.add(picG);
  put(box(1.7, 2.1, 0.07), -0.9, 3.6, -5.94, 0, 0, 0, picG);
  put(rectXY(1.35, 1.75), -0.9, 3.6, -5.885, 0, 0, 0, picG);
  /* 画像内容：自画像简笔（头 + 肩 + 笑） */
  put(circleXY(0.3, 28), -0.9, 4.15, -5.88, 0, 0, 0, picG);
  put(circleXY(0.03, 10), -1.0, 4.2, -5.88, 0, 0, 0, picG);
  put(circleXY(0.03, 10), -0.8, 4.2, -5.88, 0, 0, 0, picG);
  put(arcXY(0.13, Math.PI + 0.5, Math.PI * 2 - 0.5, 12), -0.9, 4.09, -5.88, 0, 0, 0, picG);
  put(arcXY(0.75, 0.35, Math.PI - 0.35, 20), -0.9, 3.35, -5.88, 0, 0, 0, picG);
  /* 挂钟（真实时间） */
  const clockG = new THREE.Group(); scene.add(clockG);
  put(circleXY(0.44, 44), 1.7, 4.35, -5.94, 0, 0, 0, clockG);
  put(new THREE.Mesh(new THREE.CircleGeometry(0.43, 44), FILL), 1.7, 4.35, -5.945, 0, 0, 0, clockG);
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6;
    put(line([[1.7 + Math.sin(a) * 0.36, 4.35 + Math.cos(a) * 0.36, -5.93], [1.7 + Math.sin(a) * 0.4, 4.35 + Math.cos(a) * 0.4, -5.93]]), 0, 0, 0, 0, 0, 0, clockG);
  }
  const secH = put(line([[0, 0, 0], [0, 0.34, 0]]), 1.7, 4.35, -5.92, 0, 0, 0, clockG);
  const minH = put(line([[0, -0.03, 0], [0, 0.3, 0]]), 1.7, 4.35, -5.925, 0, 0, 0, clockG);
  const hourH = put(line([[0, -0.03, 0], [0, 0.2, 0]]), 1.7, 4.35, -5.93, 0, 0, 0, clockG);
  const pendG = new THREE.Group(); put(pendG, 1.7, 3.9, -5.93);
  put(line([[0, 0, 0], [0, -0.55, 0]]), 0, 0, 0, 0, 0, 0, pendG);
  put(circleXY(0.07, 14), 0, -0.62, 0, 0, 0, 0, pendG);
  /* 墙壁开关（昼夜切换）：画像与挂钟之间 */
  const switchG = new THREE.Group(); scene.add(switchG);
  put(rectXY(0.16, 0.24), 0.62, 3.0, -5.955, 0, 0, 0, switchG);
  put(rectXY(0.1, 0.18), 0.62, 3.0, -5.95, 0, 0, 0, switchG);
  const knobG = new THREE.Group(); put(knobG, 0.62, 3.0, -5.94, 0, 0, -0.5, switchG);
  put(line([[0, -0.05, 0], [0, 0.05, 0]]), 0, 0, 0, 0, 0, 0, knobG);
  /* 研究方向小海报（左墙前段）：一条上升的 reward 曲线 */
  const posterG = new THREE.Group(); put(posterG, -5.93, 3.55, 3.35, 0, Math.PI / 2, 0);
  put(box(1.3, 0.95, 0.05), 0, 0, 0, 0, 0, 0, posterG);
  const rewPts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; rewPts.push([-0.5 + t * 1.0, -0.28 + (0.55 - Math.exp(-2.2 * t) * (0.5 + 0.08 * Math.sin(t * 9))), 0.032]); }
  put(line(rewPts), 0, 0, 0, 0, 0, 0, posterG);
  put(line([[-0.55, -0.3, 0.032], [0.55, -0.3, 0.032]]), 0, 0, 0, 0, 0, 0, posterG);
  put(line([[-0.55, -0.3, 0.032], [-0.55, 0.28, 0.032]]), 0, 0, 0, 0, 0, 0, posterG);

  /* ================= 书桌（窗下，面朝窗） ================= */
  const deskG = new THREE.Group(); scene.add(deskG);
  put(box(1.35, 0.045, 2.4), -4.92, 0.755, 0.7, 0, 0, 0, deskG);          // 桌面（进深 1.35m、厚 4.5cm）
  put(box(0.07, 0.735, 0.07), -5.5, 0.3675, -0.42, 0, 0, 0, deskG);      // 桌腿（右前角由抽屉柜承重）
  put(box(0.07, 0.735, 0.07), -5.5, 0.3675, 1.82, 0, 0, 0, deskG);
  put(box(0.07, 0.735, 0.07), -4.34, 0.3675, -0.42, 0, 0, 0, deskG);
  put(box(0.05, 0.16, 2.2), -5.49, 0.66, 0.7, 0, 0, 0, deskG);            // 桌沿抽屉横条（比例细节）
  /* 主显示器（可亮屏：训练曲线）。玻璃面朝 +x 局部，再整体转向办公位/相机（ry<0 朝 +z） */
  function buildMonitor(parent, x, z, ry, w, h, thick) {
    const m = new THREE.Group(); put(m, x, 0.79, z, 0, ry, 0, parent);
    put(box(thick, h, w), 0, 0.17, 0, 0, 0, 0, m);       // 屏幕体（玻璃面朝局部 +x）
    put(box(0.02, 0.14, 0.02), 0, 0.1, 0, 0, 0, 0, m);    // 支架
    put(box(0.3, 0.11, 0.24), 0, 0.025, 0, 0, 0, 0, m);   // 底座
    return m;
  }
  const mon1 = buildMonitor(deskG, -4.95, 0.35, -0.32, 0.9, 0.56, 0.06);
  const scrCurves = new THREE.Group(); scrCurves.visible = false; put(scrCurves, 0.034, 0.17, 0, 0, 0, 0, mon1);
  const lossPts = [], rewPts2 = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    lossPts.push([0, -0.16 + Math.exp(-2.2 * t) * 0.36 - Math.sin(t * 7) * 0.015, 0.38 - t * 0.72]);
    rewPts2.push([0, -0.2 + (1 - Math.exp(-2.5 * t)) * 0.38 + Math.sin(t * 8) * 0.02, 0.38 - t * 0.72]);
  }
  put(line(lossPts), 0, 0, 0, 0, 0, 0, scrCurves);
  put(line(rewPts2), 0, 0, 0, 0, 0, 0, scrCurves);
  put(line([[0, -0.22, 0.4], [0, -0.22, -0.4]]), 0, 0, 0, 0, 0, 0, scrCurves);
  put(line([[0, -0.22, 0.4], [0, 0.24, 0.4]]), 0, 0, 0, 0, 0, 0, scrCurves);
  /* 副屏（竖屏，代码/论文） */
  const mon2 = buildMonitor(deskG, -4.92, 1.35, -0.5, 0.5, 0.68, 0.05);
  const codeLines = new THREE.Group(); codeLines.visible = false; put(codeLines, 0.029, 0.17, 0, 0, 0, 0, mon2);
  for (let i = 0; i < 8; i++) {
    const w = 0.1 + ((i * 37) % 5) * 0.06;
    put(line([[0, 0.24 - i * 0.068, -0.16], [0, 0.24 - i * 0.068, -0.16 + w]]), 0, 0, 0, 0, 0, 0, codeLines);
  }
  /* 键盘 + 鼠标 */
  const kbG = new THREE.Group(); put(kbG, -4.62, 0.79, 0.75, 0, 0.1, 0, deskG);
  put(box(0.3, 0.028, 0.62), 0, 0, 0, 0, 0, 0, kbG);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++)
    put(rectXY(0.045, 0.045), -0.105 + r * 0.072, 0.022, -0.25 + c * 0.055, -Math.PI / 2, 0, 0, kbG);
  put(box(0.09, 0.035, 0.14), -4.6, 0.795, 1.28, 0, 0.3, 0, deskG);
  /* 咖啡杯 + 蒸汽 */
  const mugG = new THREE.Group(); put(mugG, -5.3, 0.7775, 1.72);
  put(edge(new THREE.CylinderGeometry(0.09, 0.08, 0.16, 18)), 0, 0.08, 0, 0, 0, 0, mugG);
  put(circleXY(0.09, 18), 0, 0.16, 0, -Math.PI / 2, 0, 0, mugG);
  put(arcXY(0.06, -Math.PI / 2, Math.PI / 2, 10), 0.1, 0.08, 0, 0, Math.PI / 2, 0, mugG);
  const steamG = new THREE.Group(); steamG.visible = false; put(steamG, 0, 0.18, 0, 0, 0, 0, mugG);
  const steamLines = [], steamMats = [];
  for (let j = 0; j < 3; j++) {
    const m = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 });
    steamMats.push(m);
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0)]), m);
    steamLines.push(l); steamG.add(l);
  }
  /* 台灯 */
  const lampG = new THREE.Group(); scene.add(lampG);
  put(edge(new THREE.CylinderGeometry(0.13, 0.16, 0.04, 18)), -5.15, 0.8, -0.35, 0, 0, 0, lampG);
  const armG = new THREE.Group(); put(armG, -5.15, 0.82, -0.35, 0, 0, 0.35, lampG);
  put(line([[0, 0, 0], [0.28, 0.55, 0.12]]), 0, 0, 0, 0, 0, 0, armG);
  const headG = new THREE.Group(); put(headG, 0.28, 0.55, 0.12, 0, 0, -0.6, armG);
  put(edge(new THREE.CylinderGeometry(0.05, 0.13, 0.16, 16, 1, true)), 0, -0.05, 0, 0.3, 0, 0, headG);
  const rays = new THREE.Group(); rays.visible = false;
  for (let k = 0; k < 7; k++) {
    const a = -0.5 + k * 0.16;
    rays.add(line([[Math.sin(a) * 0.18, -0.16, 0], [Math.sin(a) * 0.75, -1.05, Math.cos(k) * 0.1]]));
  }
  put(rays, 0.28, 0.6, 0.12, 0, 0, 0, lampG);
  /* 抽屉柜（桌下右侧） */
  const drawerG = new THREE.Group(); put(drawerG, -4.62, 0, 1.9);
  put(box(0.5, 0.62, 0.66), 0, 0.31, 0, 0, 0, 0, drawerG);
  put(rectXY(0.42, 0.2), 0.26, 0.42, 0, 0, Math.PI / 2, 0, drawerG);
  put(rectXY(0.42, 0.2), 0.26, 0.17, 0, 0, Math.PI / 2, 0, drawerG);
  put(circleZY(0.035, 12), 0.28, 0.42, 0, 0, 0, 0, drawerG);
  put(circleZY(0.035, 12), 0.28, 0.17, 0, 0, 0, 0, drawerG);

  /* ================= 办公椅 ================= */
  const chairG = new THREE.Group(); scene.add(chairG);
  (function buildChair() {
    const g = chairG;
    put(edge(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 12)), 0, 0.24, 0, 0, 0, 0, g);
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5;
      put(line([[0, 0.03, 0], [Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3]]), 0, 0, 0, 0, 0, 0, g);
      put(circleZY(0.035, 10), Math.cos(a) * 0.3, 0.035, Math.sin(a) * 0.3, 0, -a, 0, g);
    }
    put(box(0.5, 0.07, 0.5), 0, 0.5, 0, 0, 0, 0, g);
    put(box(0.08, 0.08, 0.45), 0.02, 0.56, 0.22, 0, 0, 0, g);
    const back = new THREE.Group(); put(back, -0.02, 0.55, -0.24, 0, 0, 0, g);
    put(box(0.48, 0.62, 0.07), 0, 0.38, 0, 0.12, 0, 0, back);
    put(box(0.2, 0.14, 0.09), 0, 0.1, 0.07, 0, 0, 0, back);
    put(line([[0.1, 0.25, 0], [0.42, 0.44, 0]]), 0, 0, 0, 0, 0, 0, back);
  })();

  /* ================= 书架（后墙右侧，开放式真正的书架）：文章即书 ================= */
  const shelfG = new THREE.Group(); scene.add(shelfG);
  const SHX = 3.95, SHZ = -5.68;                       // 书架中心（后墙右侧，长度沿 x）
  (function buildShelf() {
    /* 开放框架：侧板 ×2 + 顶/底板 + 薄背板 + 4 层搁板 + 顶檐 */
    put(box(0.06, 3.4, 0.55), SHX - 2.03, 1.7, SHZ, 0, 0, 0, shelfG);    // 左侧板
    put(box(0.06, 3.4, 0.55), SHX + 2.03, 1.7, SHZ, 0, 0, 0, shelfG);    // 右侧板
    put(box(4.12, 0.06, 0.55), SHX, 3.37, SHZ, 0, 0, 0, shelfG);         // 顶板
    put(box(4.12, 0.06, 0.55), SHX, 0.03, SHZ, 0, 0, 0, shelfG);         // 底板
    put(box(4.0, 3.28, 0.03), SHX, 1.7, SHZ - 0.26, 0, 0, 0, shelfG);    // 薄背板
    for (let i = 0; i < 4; i++) put(box(4.0, 0.05, 0.5), SHX, 0.34 + i * 0.72, SHZ + 0.02, 0, 0, 0, shelfG);
    put(box(4.2, 0.05, 0.6), SHX, 3.44, SHZ, 0, 0, 0, shelfG);           // 顶檐
  })();
  /* 文章书：每篇文章一本书，书脊朝向相机 */
  const bookItems = [];
  const BOOK_SLOTS = [2.55, 3.95, 5.35];
  DATA.posts.slice(0, 6).forEach(function (p, idx) {
    const shelfIdx = idx < 3 ? 1 : 2;                       // 第 2、3 层
    const yBase = 0.36 + shelfIdx * 0.72 + 0.025;
    const bx = BOOK_SLOTS[idx % 3];
    const h = 0.5 + (idx % 4) * 0.055;
    const g = new THREE.Group(); put(g, bx, yBase, SHZ + 0.06);
    put(box(0.09, h, 0.34), 0, h / 2, 0, 0, 0, 0, g);
    put(line([[-0.035, h - 0.07, 0.172], [0.035, h - 0.07, 0.172]]), 0, 0, 0, 0, 0, 0, g);
    put(line([[-0.035, h * 0.4, 0.172], [0.035, h * 0.4, 0.172]]), 0, 0, 0, 0, 0, 0, g);
    put(line([[0, h + 0.001, 0.08], [0.03, h + 0.06, 0.15]]), 0, 0, 0, 0, 0, 0, g); // 书签带
    g.userData.post = p;
    bookItems.push(g);
  });
  /* 装饰书 */
  (function decoBooks() {
    const r = rnd(7);
    for (let shelfIdx = 0; shelfIdx < 5; shelfIdx++) {
      const yBase = 0.36 + shelfIdx * 0.72 + 0.025;
      let bx = 2.0;
      while (bx < 5.85) {
        const nearPost = BOOK_SLOTS.some(function (s) { return Math.abs(bx - s) < 0.22; }) && shelfIdx >= 1 && shelfIdx <= 2;
        if (!nearPost && r() < 0.72) {
          const h = 0.34 + r() * 0.3, w = 0.06 + r() * 0.06;
          const tilt = r() < 0.12 ? (r() - 0.5) * 0.3 : 0;
          put(box(w, h, 0.3), bx, yBase + h / 2, SHZ + 0.06, 0, 0, tilt, shelfG);
        }
        bx += 0.11 + r() * 0.08;
      }
    }
  })();
  /* 荣誉奖牌（挂在书架上方墙上）：3 枚奖牌 + 1 面匾 */
  const medalG = new THREE.Group(); scene.add(medalG);
  (function medals() {
    function medal(x, y, s) {
      const g = new THREE.Group(); put(g, x, y, -5.9, 0, 0, 0, medalG);
      put(line([[0, 0.32, 0], [-0.09, 0.02, 0]]), 0, 0, 0, 0, 0, 0, g);   // 挂绳
      put(line([[0, 0.32, 0], [0.09, 0.02, 0]]), 0, 0, 0, 0, 0, 0, g);
      put(circleXY(0.018, 10), 0, 0.33, 0, 0, 0, 0, g);                    // 钉子
      put(new THREE.Mesh(new THREE.CircleGeometry(0.15 * s, 28), FILL), 0, 0, 0.002, 0, 0, 0, g);
      put(circleXY(0.15 * s, 28), 0, 0, 0.004, 0, 0, 0, g);                // 奖牌圆盘
      put(circleXY(0.105 * s, 22), 0, 0, 0.006, 0, 0, 0, g);               // 内圈
      put(line([[0, 0.12 * s, 0.008], [0, 0.03 * s, 0.008]]), 0, 0, 0, 0, 0, 0, g); // 绶带竖纹
      put(circleXY(0.022 * s, 10), 0, 0.075 * s, 0.008, 0, 0, 0, g);       // 中心小星点
      return g;
    }
    medal(2.7, 4.5, 1);
    medal(3.6, 4.5, 0.85);
    medal(4.5, 4.5, 1);
    /* 矩形匾（证书） */
    const pl = new THREE.Group(); put(pl, 5.35, 4.45, -5.9, 0, 0, 0, medalG);
    put(line([[0, 0.34, 0], [-0.07, 0.02, 0]]), 0, 0, 0, 0, 0, 0, pl);
    put(line([[0, 0.34, 0], [0.07, 0.02, 0]]), 0, 0, 0, 0, 0, 0, pl);
    put(rectXY(0.36, 0.28), 0, 0, 0, 0, 0, 0, pl);
    put(rectXY(0.28, 0.19), 0, 0, 0.012, 0, 0, 0, pl);
    put(line([[-0.1, 0.05, 0.02], [0.1, 0.05, 0.02]]), 0, 0, 0, 0, 0, 0, pl);
    put(line([[-0.08, -0.02, 0.02], [0.08, -0.02, 0.02]]), 0, 0, 0, 0, 0, 0, pl);
  })();

  /* ================= 黑胶机 + 边几（右前开放区，斜向房间中心） ================= */
  const sideG = new THREE.Group(); put(sideG, 4.15, 0, 1.15, 0, -0.5, 0); scene.add(sideG);
  put(box(1.05, 0.72, 0.75), 0, 0.36, 0, 0, 0, 0, sideG);
  put(rectXY(0.36, 0.22), 0, 0.36, 0.383, 0, 0, 0, sideG);
  put(circleXY(0.03, 10), 0, 0.36, 0.384, 0, 0, 0, sideG);
  const playG = new THREE.Group(); put(playG, 0, 0.75, 0, 0, 0, 0, sideG);
  put(box(0.86, 0.09, 0.7), 0, 0.045, 0, 0, 0, 0, playG);
  const recG = new THREE.Group(); put(recG, -0.08, 0.1, 0);
  put(circleXY(0.24, 30), 0, 0, 0, -Math.PI / 2, 0, 0, recG);
  put(new THREE.Mesh(new THREE.CircleGeometry(0.23, 30), FILL), 0, 0, 0.004, -Math.PI / 2, 0, 0, recG);
  put(circleXY(0.075, 20), 0, 0, 0.006, -Math.PI / 2, 0, 0, recG);
  for (let k = 0; k < 4; k++) put(circleXY(0.19 - k * 0.03, 24), 0, 0, 0.005, -Math.PI / 2, 0, 0, recG);
  const armPlay = new THREE.Group(); put(armPlay, 0.3, 0.1, -0.25);
  put(edge(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10)), 0, 0.02, 0, 0, 0, 0, armPlay);
  put(line([[0, 0.04, 0], [-0.16, 0.05, 0.2]]), 0, 0, 0, 0, 0, 0, armPlay);
  put(line([[-0.16, 0.05, 0.2], [-0.2, 0.03, 0.26]]), 0, 0, 0, 0, 0, 0, armPlay);

  /* ================= 盆栽（右前，与黑胶边几成组；结构参照 pure-line-room） ================= */
  const plantG = new THREE.Group(); put(plantG, 4.85, 0, 2.25, 0, 0.4, 0);
  put(edge(new THREE.CylinderGeometry(0.42, 0.32, 0.7, 14)), 0, 0.35, 0, 0, 0, 0, plantG);   // 盆身
  put(edge(new THREE.CylinderGeometry(0.45, 0.45, 0.09, 14)), 0, 0.72, 0, 0, 0, 0, plantG);  // 盆沿
  const leaves = new THREE.Group(); put(leaves, 0, 0.76, 0, 0, 0, 0, plantG);                 // 草叶：盆沿处生长，plantG 子节点
  (function mkLeaves() {
    for (let k = 0; k < 8; k++) {
      const ang = k / 8 * Math.PI * 2, sp = 0.5 + (k % 3) * 0.16, h = 1.0 + (k % 4) * 0.25;
      const curve = new THREE.QuadraticBezierCurve3(
        V(0, 0, 0),
        V(Math.cos(ang) * sp * 0.35, h * 0.55, Math.sin(ang) * sp * 0.35),
        V(Math.cos(ang) * sp, h, Math.sin(ang) * sp));
      leaves.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(9)), MAT));
    }
  })();

  /* ================= 吊扇 ================= */
  const fanRoot = new THREE.Group(); scene.add(fanRoot);
  put(line([[0, 7, 0], [0, 6.34, 0]]), 0, 0, 0, 0, 0, 0, fanRoot);
  put(edge(new THREE.CylinderGeometry(0.09, 0.15, 0.12, 10)), 0, 6.32, 0, 0, 0, 0, fanRoot);
  put(edge(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 10)), 0, 6.2, 0, 0, 0, 0, fanRoot);
  const fanG = new THREE.Group(); put(fanG, 0, 6.08, 0, 0, 0, 0, fanRoot);
  for (let k = 0; k < 4; k++) {
    const bg = new THREE.Group(); bg.rotation.y = k * Math.PI / 2; fanG.add(bg);
    const blade = box(1.5, 0.03, 0.3); blade.position.set(0.92, 0, 0); blade.rotation.x = 0.14; bg.add(blade);
  }

  /* ================= 交互系统 ================= */
  const items = [], proxies = [];
  function proxy(w, h, d, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIDE); m.position.set(x, y, z); m.userData.vol = w * h * d; return m; }
  function mkItem(px, cfg) {
    const it = Object.assign({ p: 0, target: 0, rate: 1.6, v: 0, tv: 0, apply: null, action: null, bold: null, boldClones: [], label: '' }, cfg);
    if (!it.action) it.action = function () { it.target = it.target ? 0 : 1; };
    (Array.isArray(px) ? px : [px]).forEach(function (m) { m.userData.it = it; scene.add(m); proxies.push(m); });
    items.push(it); return it;
  }

  /* ---- HTML 面板 ---- */
  const panelRoot = document.getElementById('room-panel');
  const panelTitle = panelRoot ? panelRoot.querySelector('.rp-title') : null;
  const panelBody = panelRoot ? panelRoot.querySelector('.rp-body') : null;
  function openPanel(title, html) {
    if (!panelRoot) return;
    panelTitle.textContent = title;
    panelBody.innerHTML = html;
    panelRoot.classList.add('open');
    document.body.classList.add('room-panel-open');
    RoomAudio.sfx('pageTurn');
  }
  function closePanel() {
    if (panelRoot && panelRoot.classList.contains('open')) {
      panelRoot.classList.remove('open');
      document.body.classList.remove('room-panel-open');
      RoomAudio.sfx('close');
    }
  }
  if (panelRoot) {
    panelRoot.querySelector('.rp-close').addEventListener('click', closePanel);
    panelRoot.querySelector('.rp-backdrop').addEventListener('click', closePanel);
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
  }

  function linkRow(url, text, sub) {
    const ext = /^https?:/.test(url);
    return '<a class="rp-link" href="' + url + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '><span class="rp-link-main">' + text + '</span>' + (sub ? '<span class="rp-link-sub">' + sub + '</span>' : '') + '<span class="rp-arrow">→</span></a>';
  }
  function projectCard(pr) {
    let h = '<div class="rp-card"><div class="rp-card-head"><span class="rp-card-name">' + pr.name + '</span>';
    if (pr.tag) h += '<span class="rp-tag">' + pr.tag + '</span>';
    h += '</div><p>' + pr.desc + '</p>';
    if (pr.url) h += '<div class="rp-card-links">' + linkRow(pr.url, 'GitHub 仓库', '') + '</div>';
    h += '</div>';
    return h;
  }

  const PANELS = {
    about: function () {
      const a = DATA.about;
      let h = '<p class="rp-lead">' + a.lead + '</p><ul class="rp-facts">';
      (a.facts || []).forEach(function (f) { h += '<li>' + f + '</li>'; });
      h += '</ul><p>' + a.more + '</p><div class="rp-card-links">' + linkRow('/about/', '完整介绍 → 关于页', '') + '</div>';
      return h;
    },
    projects: function () {
      let h = '<p class="rp-lead">点亮的每一块屏幕，都是一个正在跑的实验。</p>';
      DATA.projects.forEach(function (pr) { h += projectCard(pr); });
      return h;
    },
    honors: function () {
      let h = '<p class="rp-lead">墙上的奖牌，都是真实拿到的。</p><ul class="rp-honors">';
      DATA.honors.forEach(function (x) { h += '<li><span>' + x + '</span></li>'; });
      h += '</ul>';
      return h;
    },
    contact: function () {
      let h = '<p class="rp-lead">推开门，欢迎来聊。</p><div class="rp-card-links">';
      DATA.contact.forEach(function (c) { h += linkRow(c.url, c.name, c.sub || ''); });
      h += '</div>';
      return h;
    },
    links: function () {
      let h = '<p class="rp-lead">窗外世界的入口。</p><div class="rp-card-links">';
      DATA.links.forEach(function (c) { h += linkRow(c.url, c.name, c.sub || ''); });
      h += '</div>';
      return h;
    },
    blog: function () {
      let h = '<p class="rp-lead">书架上的每本书都是一篇文章，点击书本直达；也可以推门进入全部文章。</p><div class="rp-card-links">';
      DATA.posts.forEach(function (p) { h += linkRow(p.url, p.title, p.date); });
      h += '</div>';
      return h;
    }
  };

  /* ---- 各家具的交互定义 ---- */
  mkItem(proxy(2.4, 4.4, 2.4, -4.6, 2.2, -5.2), {
    rate: 1.4, bold: [doorG, doorFrameG], label: '简历 · 联系',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      RoomAudio.sfx(it.target ? 'door' : 'doorClose');
      if (it.target) openPanel('简历 & 联系', PANELS.contact());
      else closePanel();
    },
    apply: function (it) { doorG.rotation.y = -1.9 * E(it.p); }
  });

  const windowIt = mkItem([proxy(0.35, 0.3, 3.5, -5.9, 4.92, WZ), proxy(0.35, 0.3, 3.5, -5.9, 2.12, WZ),
  proxy(0.35, 2.9, 0.3, -5.9, 3.5, WZ - 1.55), proxy(0.35, 2.9, 0.3, -5.9, 3.5, WZ + 1.55)], {
    rate: 1.4, bold: [sashL, sashR, winFrameG], label: '外部链接',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      RoomAudio.sfx(it.target ? 'windowOpen' : 'windowClose');
      if (it.target) openPanel('外部链接', PANELS.links());
      else closePanel();
    },
    apply: function (it) { const e = E(it.p); sashL.rotation.y = -1.45 * e; sashR.rotation.y = 1.45 * e; }
  });

  mkItem(proxy(0.34, 0.6, 3.0, -5.86, 4.6, WZ), {
    rate: 1.2, bold: blindG, label: '百叶窗',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx(it.target ? 'blindsUp' : 'blindsDown'); },
    apply: function (it) {
      const e = E(it.p);
      for (let i = 0; i < nSlat; i++) slats[i].position.y = spread[i] + (collapsed[i] - spread[i]) * e;
      const L = blindTop - (slats[0].position.y - 0.02);
      cords.forEach(function (c) { c.scale.y = L; });
    }
  });

  mkItem(proxy(0.9, 0.55, 0.7, -5.78, 2.35, 1.75), {
    p: 1, target: 1, rate: 2, bold: catG, label: '猫',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('cat'); RoomAudio.loop('purr', it.target === 1); },
    apply: function (it, dt, t) { catTail.rotation.y = 0.5 * Math.sin(t * 2.2) * it.p; catHead.rotation.z = 0.1 * Math.sin(t * 1.7) * it.p; }
  });

  mkItem(proxy(1.9, 2.3, 0.4, -0.9, 3.6, -5.85), {
    rate: 1.5, bold: picG, label: '关于我',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      RoomAudio.sfx('chime');
      if (it.target) openPanel('关于我', PANELS.about()); else closePanel();
    },
    apply: function (it) { picG.rotation.x = 0.15 * E(it.p); }
  });

  mkItem(proxy(1.1, 1.35, 0.4, 1.7, 4.0, -5.85), {
    p: 1, target: 1, rate: 0.8, bold: clockG, label: '钟（静音开关）',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('clockToggle'); },
    apply: function (it, dt, t) {
      pendG.rotation.z = 0.3 * Math.sin(t * Math.PI) * it.p;
      const beat = Math.floor(t + 0.5);
      if (it.p > 0.5 && beat !== it.lastBeat) RoomAudio.sfx(beat % 2 ? 'tick' : 'tock');
      it.lastBeat = beat;
      const now = new Date();
      const s = now.getSeconds() + now.getMilliseconds() / 1000;
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;
      secH.rotation.z = -s / 60 * Math.PI * 2;
      minH.rotation.z = -m / 60 * Math.PI * 2;
      hourH.rotation.z = -h / 12 * Math.PI * 2;
    }
  });

  mkItem(proxy(0.5, 0.5, 0.4, 0.62, 3.0, -5.8), {
    rate: 3, bold: switchG, label: '灯开关（昼/夜）',
    action: function (it) {
      lightState.forcedNight = !lightState.forcedNight;
      RoomAudio.sfx(lightState.forcedNight ? 'switchOff' : 'switchOn');
      it.target = lightState.forcedNight ? 1 : 0;
    },
    apply: function (it) { knobG.rotation.z = -0.5 + E(it.p); }
  });

  mkItem(proxy(1.1, 1.0, 1.2, -4.95, 1.3, 0.75), {
    rate: 1.6, bold: [mon1, mon2], label: '科研项目',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      RoomAudio.sfx('switchOn');
      if (it.target) openPanel('科研项目', PANELS.projects()); else closePanel();
    },
    apply: function (it) {
      const on = it.p > 0.4;
      scrCurves.visible = on; codeLines.visible = on;
    }
  });

  mkItem(proxy(0.6, 1.2, 0.6, -5.3, 0.95, 1.72), {
    p: 1, target: 1, rate: 2, bold: mugG, label: '咖啡',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('mug'); RoomAudio.loop('steam', it.target === 1); },
    apply: function (it, dt, t) {
      steamG.visible = it.p > 0.03;
      if (steamG.visible) for (let j = 0; j < 3; j++) {
        const a = [];
        for (let k = 0; k <= 6; k++) a.push(V(Math.sin(t * 2.6 + j * 2.1 + k * 0.9) * 0.05 * (0.25 + k / 6), k * 0.085, 0));
        steamLines[j].geometry.setFromPoints(a);
        steamMats[j].opacity = 0.8 * it.p;
      }
    }
  });

  const lampIt = mkItem(proxy(1.2, 1.6, 0.9, -5.0, 1.35, -0.35), {
    rate: 1.5, bold: lampG, label: '台灯',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('lamp'); RoomAudio.loop('hum', it.target === 1 && isNight()); },
    apply: function (it) { armG.rotation.z = 0.35 - 0.47 * E(it.p); rays.visible = it.p > 0.55; }
  });

  const chairProxy = proxy(1.3, 2.6, 1.3, -3.75, 1.3, 0.75);
  mkItem(chairProxy, {
    rate: 1.4, bold: chairG, label: '椅子',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('chair'); },
    apply: function (it) { const x = -3.75 + 1.05 * E(it.p); chairG.position.x = x; chairProxy.position.x = x; }
  });

  mkItem(proxy(0.6, 0.72, 0.7, -4.62, 0.31, 1.9), {
    rate: 1.5, bold: drawerG, label: '抽屉',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx(it.target ? 'drawerOut' : 'drawerIn'); },
    apply: function (it) { drawerG.position.x = -4.62 + 0.42 * E(it.p); }
  });

  mkItem(proxy(4.1, 3.5, 0.6, SHX, 1.75, SHZ), {
    rate: 1.5, bold: shelfG, label: '书架 · 博客',
    action: function () { RoomAudio.sfx('book'); openPanel('博客文章', PANELS.blog()); }
  });

  /* 文章书：hover 显示标题，点击直达 */
  bookItems.forEach(function (g) {
    const p = g.userData.post;
    const bx = g.position.x, by = g.position.y, bz = g.position.z;
    mkItem(proxy(0.45, 0.85, 0.3, bx, by + 0.4, bz), {
      rate: 2, bold: g, label: '📄 ' + p.title,
      action: function () { RoomAudio.sfx('pageTurn'); setTimeout(function () { window.location.assign(p.url); }, 240); },
      apply: function (it) { g.position.z = bz + 0.12 * E(it.p); }
    });
  });

  mkItem(proxy(3.3, 1.1, 0.5, 3.95, 4.45, -5.85), {
    rate: 2, bold: medalG, label: '荣誉',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      RoomAudio.sfx('trophy');
      if (it.target) openPanel('荣誉', PANELS.honors()); else closePanel();
    },
    apply: function (it, dt, t) { medalG.rotation.z = 0.02 * Math.sin(t * 1.5) * it.p; }
  });

  mkItem(proxy(1.3, 1.1, 1.4, 4.15, 0.9, 1.15), {
    rate: 1.6, bold: playG, label: '黑胶机 · 音乐',
    action: function (it) {
      it.target = it.target ? 0 : 1;
      it.tv = it.target ? 6 : 0;
      RoomAudio.sfx('recordArm'); RoomAudio.loop('vinyl', it.target === 1); RoomAudio.loop('melody', it.target === 1);
    },
    apply: function (it, dt) { recG.rotation.y += it.v * dt; armPlay.rotation.y = -0.45 * E(it.p); }
  });

  mkItem(proxy(1.3, 2.2, 1.3, 4.85, 1.05, 2.25), {
    p: 1, target: 1, rate: 1, bold: plantG, label: '盆栽',
    action: function (it) { it.target = it.target ? 0 : 1; RoomAudio.sfx('plant'); RoomAudio.loop('plantSway', it.target === 1); },
    apply: function (it, dt, t) { leaves.rotation.x = 0.05 * Math.sin(t * 1.4) * it.p; leaves.rotation.z = 0.05 * Math.cos(t * 1.1) * it.p; }
  });

  mkItem(proxy(4.0, 1.0, 4.0, 0, 6.05, 0), {
    bold: fanRoot, label: '吊扇',
    action: function (it) { it.tv = it.tv ? 0 : 5; RoomAudio.loop('fan', it.tv > 0); },
    apply: function (it, dt) { fanG.rotation.y += it.v * dt; }
  });

  /* ================= hover 加粗（Line2） ================= */
  let BOLDMAT = null;
  if (THREE.LineSegments2 && THREE.LineSegmentsGeometry && THREE.LineMaterial) {
    BOLDMAT = new THREE.LineMaterial({ color: 0x000000, linewidth: 1.6 });
    BOLDMAT.resolution.set(window.innerWidth, window.innerHeight);
    BOLDMAT.polygonOffset = true; BOLDMAT.polygonOffsetFactor = -2; BOLDMAT.polygonOffsetUnits = -2;
  }
  function lineSegments(o) {
    const pos = o.geometry.attributes.position;
    if (!pos) return null;
    const arr = [];
    if (o.isLineSegments) {
      for (let i = 0; i < pos.count; i++) arr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    } else if (o.isLine || o.isLineLoop) {
      const n = pos.count;
      for (let i = 0; i < n - 1; i++) arr.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      if (o.isLineLoop && n > 2) arr.push(pos.getX(n - 1), pos.getY(n - 1), pos.getZ(n - 1), pos.getX(0), pos.getY(0), pos.getZ(0));
    } else return null;
    return arr;
  }
  function boldify(root, out) {
    const targets = [];
    root.traverse(function (o) {
      if ((o.isLine || o.isLineLoop || o.isLineSegments) && !o.userData.noBold) targets.push(o);
    });
    targets.forEach(function (o) {
      const seg = lineSegments(o);
      if (!seg || !seg.length) return;
      const g = new THREE.LineSegmentsGeometry();
      g.setPositions(seg);
      const b = new THREE.LineSegments2(g, BOLDMAT);
      b.visible = false;
      o.add(b);
      out.push(b);
    });
  }
  if (BOLDMAT) {
    items.forEach(function (it) {
      if (!it.bold) return;
      (Array.isArray(it.bold) ? it.bold : [it.bold]).forEach(function (r) { boldify(r, it.boldClones); });
    });
  }

  /* ================= 拾取 + 悬停提示 ================= */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hovered = null;
  const tip = document.getElementById('room-tip');
  function pick(e) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(proxies, false);
    if (!hits.length) return null;
    /* 近距命中里优先小代理：书本赢过书架、奖杯赢过柜体 */
    const d0 = hits[0].distance;
    let best = null;
    for (const h of hits) {
      if (h.distance > d0 + 2.0) break;
      if (!best || (h.object.userData.vol || 1) < (best.object.userData.vol || 1)) best = h;
    }
    return (best || hits[0]).object.userData.it;
  }
  function setHover(it, e) {
    if (hovered === it) { if (it && tip) moveTip(e); return; }
    if (hovered) hovered.boldClones.forEach(function (b) { b.visible = false; });
    hovered = it;
    if (hovered) RoomAudio.sfx('hover');
    if (hovered) hovered.boldClones.forEach(function (b) { b.visible = true; });
    document.body.style.cursor = it ? 'pointer' : '';
    if (tip) {
      if (it && it.label) {
        tip.textContent = it.label;
        tip.style.opacity = '1';
        moveTip(e);
      } else tip.style.opacity = '0';
    }
  }
  function moveTip(e) {
    if (!tip) return;
    tip.style.left = Math.min(window.innerWidth - 20, e.clientX + 16) + 'px';
    tip.style.top = Math.max(8, e.clientY - 34) + 'px';
  }
  window.addEventListener('pointerdown', function () { RoomAudio.unlock(); });
  window.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.room-hud,.rp-card,.rp-panel')) return;
    const it = pick(e); if (it && it.action) it.action(it);
  });
  window.addEventListener('pointermove', function (e) { setHover(pick(e), e); });
  window.addEventListener('pointerleave', function () { setHover(null); });
  window.addEventListener('resize', function () {
    renderer.setSize(window.innerWidth, window.innerHeight);
    layoutCamera();
    if (BOLDMAT) BOLDMAT.resolution.set(window.innerWidth, window.innerHeight);
  });

  /* ================= 昼夜与台灯光锥 ================= */
  const lightState = { autoNight: false, forcedNight: null, switchOn: false };
  function isNight() { return lightState.forcedNight !== null ? lightState.forcedNight : lightState.autoNight; }
  function updateLight() {
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    lightState.autoNight = (h >= 19 || h < 7);
    const night = isNight();
    const wOpen = windowIt.p > 0.4;
    scene.background.set(night ? 0x11130f : 0xf8f7f2);
    MAT.color.set(night ? 0xffffff : 0x000000);
    FILL.color.set(night ? 0x11130f : 0xfdfcf8);
    if (BOLDMAT) BOLDMAT.color.set(night ? 0xffffff : 0x000000);
    for (const m of steamMats) m.color.set(night ? 0xffffff : 0x000000);
    RoomAudio.loop('dayAmb', !night && wOpen);
    RoomAudio.loop('nightAmb', night && wOpen);
  }

  /* 台灯光锥：夜间亮灯时用裁剪面做二次渲染 */
  const coneA = new THREE.Vector3(-4.87, 1.45, -0.2);
  const conePlanes = [];
  for (let k = 0; k < 24; k++) {
    const ph = k * Math.PI / 12;
    const n = new THREE.Vector3(1.35 * Math.cos(ph), -1.6, 1.35 * Math.sin(ph)).normalize();
    const pl = new THREE.Plane(n, -n.dot(coneA));
    pl.userData = { c: -n.dot(coneA) };
    conePlanes.push(pl);
  }
  MAT.clippingPlanes = conePlanes;
  FILL.clippingPlanes = conePlanes;
  function setClip(on) { for (const p of conePlanes) p.constant = on ? p.userData.c : 1e10; }
  setClip(false);
  function renderNightLit() {
    const BG = scene.background;
    setClip(false);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    setClip(true);
    renderer.autoClear = false;
    scene.background = null;
    MAT.color.set(0x000000); FILL.color.set(0xffffff);
    renderer.render(scene, camera);
    MAT.color.set(0xffffff); FILL.color.set(0x000000);
    setClip(false);
    scene.background = BG;
  }

  RoomAudio.loop('steam', true); RoomAudio.loop('purr', true); RoomAudio.loop('plantSway', true);

  /* ================= HUD ================= */
  const soundBtn = document.getElementById('room-sound-btn');
  function refreshSoundUI() {
    if (!soundBtn) return;
    const muted = RoomAudio.isMuted();
    soundBtn.textContent = muted ? '开启声音' : '关闭声音';
    soundBtn.setAttribute('aria-pressed', String(!muted));
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      RoomAudio.unlock();
      RoomAudio.setMuted(!RoomAudio.isMuted());
      if (!RoomAudio.isMuted()) RoomAudio.sfx('welcome');
      refreshSoundUI();
    });
    refreshSoundUI();
    const pollUnlock = setInterval(function () {
      if (RoomAudio.isUnlocked()) { refreshSoundUI(); clearInterval(pollUnlock); }
    }, 400);
  }
  const blogBtn = document.getElementById('room-blog-btn');
  if (blogBtn) blogBtn.addEventListener('click', function () { RoomAudio.sfx('pageTurn'); });
  const namecard = document.getElementById('room-namecard');
  if (namecard) namecard.addEventListener('click', function () { openPanel('关于我', PANELS.about()); });

  /* 首帧后隐去 loading */
  const loader = document.getElementById('room-loading');
  let loaderHidden = false;
  function hideLoader() {
    if (loaderHidden) return; loaderHidden = true;
    if (loader) { loader.classList.add('done'); setTimeout(function () { loader.remove(); }, 700); }
  }

  /* ================= 手写体导览标签（常驻提示，防一头雾水） ================= */
  const roomLabelsRoot = document.getElementById('room-labels');
  const roomLabels = [];
  if (roomLabelsRoot) {
    /* dir: 0=箭头↘ 1=箭头↓ 2=箭头↙ ；min: 移动端隐藏 */
    const defs = [
      { p: [6.35, 4.3, SHZ + 0.3], t: '博客文章', dir: 2, dx: -56, dy: -2 },
      { p: [-4.95, 2.05, 0.85], t: '科研项目', dir: 1, dx: 10, dy: -10 },
      { p: [-0.9, 4.85, -5.9], t: '关于我', dir: 1, dx: 0, dy: -8 },
      { p: [-4.25, 4.8, -5.9], t: '联系我', dir: 1, dx: 0, dy: -8 },
      { p: [-5.88, 5.25, WZ], t: '外部链接', dir: 2, dx: -4, dy: -8 },
      { p: [3.6, 5.15, SHZ + 0.15], t: '荣誉', dir: 0, dx: -36, dy: 2, min: true },
      { p: [4.15, 1.9, 1.15], t: '音乐 ♪', dir: 0, dx: -34, dy: 2, min: true },
      { p: [0.62, 3.42, -5.9], t: '昼 / 夜', dir: 1, dx: 0, dy: -6, min: true }
    ];
    const ARROWS = [
      '<svg viewBox="0 0 24 26" width="19" height="21"><path d="M6 2 C 14 6, 16 14, 13 21" fill="none"/><path d="M9.5 17 L13 22 L16.5 17.5" fill="none"/></svg>',   /* ↘ */
      '<svg viewBox="0 0 24 26" width="19" height="21"><path d="M12 1 C 10 8, 13 14, 12 20" fill="none"/><path d="M8 16.5 L12 22 L16 16.5" fill="none"/></svg>',             /* ↓ */
      '<svg viewBox="0 0 24 26" width="19" height="21"><path d="M18 2 C 10 6, 8 14, 11 21" fill="none"/><path d="M7.5 17.5 L11 22 L14.5 17" fill="none"/></svg>'              /* ↙ */
    ];
    defs.forEach(function (d, i) {
      const el = document.createElement('div');
      el.className = 'room-label' + (d.min ? ' lab-min' : '');
      el.innerHTML = '<span class="lab-arrow">' + ARROWS[d.dir] + '</span><span class="lab-text">' + d.t + '</span>';
      roomLabelsRoot.appendChild(el);
      roomLabels.push({ v: new THREE.Vector3(d.p[0], d.p[1], d.p[2]), el: el, dx: d.dx, dy: d.dy, rot: ((i * 7919) % 100) / 100 * 4 - 2 });
    });
  }
  const projV = new THREE.Vector3();
  function updateLabels() {
    if (!roomLabels.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const L of roomLabels) {
      projV.copy(L.v).project(camera);
      if (projV.z > 1 || projV.x < -1.05 || projV.x > 1.05 || projV.y < -1.05 || projV.y > 1.05) { L.el.style.opacity = '0'; continue; }
      const x = (projV.x * 0.5 + 0.5) * w + L.dx;
      const y = (-projV.y * 0.5 + 0.5) * h + L.dy;
      L.el.style.opacity = '';
      L.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) rotate(' + L.rot.toFixed(1) + 'deg)';
    }
  }

  /* ================= 主循环 ================= */
  const clockT = new THREE.Clock();
  let firstFrame = true;
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clockT.getDelta(), 0.05), t = clockT.elapsedTime;
    for (const it of items) {
      if (it.p < it.target) it.p = Math.min(it.target, it.p + dt * it.rate);
      else if (it.p > it.target) it.p = Math.max(it.target, it.p - dt * it.rate);
      it.v += (it.tv - it.v) * Math.min(1, dt * 2.2);
      if (it.apply) it.apply(it, dt, t);
    }
    updateLight();
    if (isNight() && lampIt.p > 0.55) renderNightLit();
    else { renderer.autoClear = true; renderer.render(scene, camera); }
    updateLabels();
    if (firstFrame) { firstFrame = false; hideLoader(); }
  }
  animate();
})();
