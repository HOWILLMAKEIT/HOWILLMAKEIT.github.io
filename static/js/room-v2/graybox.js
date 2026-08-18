(function roomGraybox() {
  "use strict";

  if (!window.THREE) {
    document.getElementById("room-loading").innerHTML = "<p>Three.js 加载失败，请返回主页。</p>";
    return;
  }

  const canvas = document.getElementById("room-canvas");
  const scene = new THREE.Scene();
  // Orthographic projection keeps the room composition stable and architectural.
  const camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const clock = new THREE.Clock();

  const palette = {
    paper: 0xf4f0e7,
    ink: 0x21312b,
    subtle: 0x7c867f,
    green: 0x6f8a71,
    mustard: 0xb49a55,
    lavender: 0xa8a2b3,
    added: 0xb68146,
    white: 0xf8f6ef,
    black: 0x252b29,
  };

  renderer.setClearColor(palette.paper, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const root = new THREE.Group();
  root.rotation.y = -0.03;
  scene.add(root);

  const lineMaterials = {
    main: new THREE.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.78 }),
    soft: new THREE.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.42 }),
    detail: new THREE.LineBasicMaterial({ color: palette.subtle, transparent: true, opacity: 0.38 }),
    added: new THREE.LineBasicMaterial({ color: palette.added, transparent: true, opacity: 0.94 }),
  };
  const interactiveObjects = [];

  const fillMaterial = (color) => new THREE.MeshBasicMaterial({
    color,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
    toneMapped: false,
  });

  function outlinedBox(name, size, position, options = {}) {
    const group = new THREE.Group();
    group.name = name;

    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(
      geometry,
      fillMaterial(options.fill || palette.white, options.opacity ?? 0.16),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, options.threshold || 24),
      options.line || lineMaterials.main,
    );

    group.add(mesh, edges);
    group.position.set(position[0], position[1] + size[1] / 2, position[2]);
    if (options.rotationY) group.rotation.y = options.rotationY;
    if (options.parent) options.parent.add(group);
    else root.add(group);
    return group;
  }

  // 简易补间：一次性动画（开门/弹跳/旋转等），在渲染循环里推进。
  const tweens = [];
  function tween(duration, onUpdate, onDone) {
    tweens.push({ startedAt: performance.now(), duration, onUpdate, onDone });
  }
  function stepTweens(now) {
    for (let index = tweens.length - 1; index >= 0; index -= 1) {
      const job = tweens[index];
      const progress = Math.min((now - job.startedAt) / job.duration, 1);
      job.onUpdate(easeInOutCubic(progress), progress);
      if (progress === 1) {
        tweens.splice(index, 1);
        if (job.onDone) job.onDone();
      }
    }
  }
  // 把已挂到 root 的物体重新挂到指定铰链点上（保持世界位置不变）。
  function hingeTo(object, hx, hy, hz) {
    const pivot = new THREE.Group();
    pivot.position.set(hx, hy, hz);
    root.add(pivot);
    const relative = object.position.clone().sub(pivot.position);
    pivot.add(object);
    object.position.copy(relative);
    return pivot;
  }

  function line(points, material = lineMaterials.soft, parent = root) {
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
    );
    const result = new THREE.Line(geometry, material);
    parent.add(result);
    return result;
  }

  function wallText(lines, position, width, height) {
    const textCanvas = document.createElement("canvas");
    textCanvas.width = 1024;
    textCanvas.height = 560;
    const context = textCanvas.getContext("2d");
    context.clearRect(0, 0, textCanvas.width, textCanvas.height);
    context.fillStyle = "#f1eadb";
    context.fillRect(0, 0, textCanvas.width, textCanvas.height);
    context.strokeStyle = "#34594b";
    context.lineWidth = 6;
    context.strokeRect(18, 18, textCanvas.width - 36, textCanvas.height - 36);
    lines.forEach((entry, index) => {
      context.fillStyle = index === 0 ? "#17231f" : "#4d5d55";
      context.font = index === 0
        ? "700 72px 'PingFang SC', sans-serif"
        : "500 42px 'PingFang SC', sans-serif";
      context.fillText(entry, 72, 112 + index * 112);
    });
    const texture = new THREE.CanvasTexture(textCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    panel.position.set(...position);
    panel.rotation.y = Math.PI / 2;
    root.add(panel);
    return panel;
  }

  function hitProxy(id, label, position, size, cameraPreset, interact) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const proxy = new THREE.Mesh(geometry, material);
    proxy.position.set(position[0], position[1], position[2]);
    proxy.userData.roomObjectId = id;
    root.add(proxy);

    const highlight = new THREE.Group();
    const glow = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x38b8bf,
        transparent: true,
        opacity: 0.055,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x138b96,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const outerEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0x68dce0,
      transparent: true,
      opacity: 0.3,
      depthTest: false,
    });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    const outerEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), outerEdgeMaterial);
    outerEdges.scale.setScalar(1.025);
    highlight.add(glow, edges, outerEdges);
    highlight.position.copy(proxy.position);
    highlight.visible = false;
    highlight.renderOrder = 12;
    root.add(highlight);

    const entry = { id, label, proxy, highlight, edgeMaterial, outerEdgeMaterial, cameraPreset, interact };
    interactiveObjects.push(entry);
    return entry;
  }

  // Room shell. The front and right walls remain open so the fixed camera can see inside.
  outlinedBox("floor", [8.2, 0.08, 9.8], [0, -0.08, 0], { fill: 0xd8d3c7, opacity: 0.22 });
  for (let z = -4.4; z <= 4.4; z += 0.48) {
    line([[-4.02, 0.012, z], [4.02, 0.012, z]], lineMaterials.detail);
  }
  outlinedBox("left-wall", [0.08, 5.35, 9.8], [-4.1, 0, 0], { opacity: 0.08 });
  outlinedBox("back-wall", [8.2, 5.35, 0.08], [0, 0, -4.9], { opacity: 0.08 });

  // Green carpet establishes the room center without becoming a realistic texture.
  outlinedBox("carpet", [5.8, 0.035, 7.2], [0.25, 0.01, 0.35], {
    fill: palette.green,
    opacity: 0.18,
    line: lineMaterials.soft,
  });
  outlinedBox("carpet-inner-border", [5.42, 0.018, 6.82], [0.25, 0.048, 0.35], {
    fill: palette.green,
    opacity: 0.035,
    line: lineMaterials.detail,
  });
  for (let x = -2.5; x <= 3; x += 0.28) {
    line([[x, 0.055, -3.26], [x, 0.055, -3.38]], lineMaterials.detail);
    line([[x, 0.055, 3.96], [x, 0.055, 4.08]], lineMaterials.detail);
  }

  // Bed along the right wall.
  outlinedBox("bed-base", [2.72, 0.54, 5.38], [2.55, 0, 2.2], { opacity: 0.16 });
  outlinedBox("mattress", [2.6, 0.36, 5.12], [2.55, 0.54, 2.2], {
    fill: palette.green,
    opacity: 0.16,
  });
  const blanket = outlinedBox("blanket", [2.5, 0.13, 4.48], [2.55, 0.9, 2.37], {
    fill: palette.mustard,
    opacity: 0.28,
    line: lineMaterials.soft,
  });
  outlinedBox("bed-headboard", [2.78, 1.34, 0.14], [2.55, 0.02, -0.55], {
    fill: 0xc8b89a,
    opacity: 0.13,
  });
  outlinedBox("bed-left-rail", [0.12, 0.58, 5.42], [1.16, 0.02, 2.2], { opacity: 0.12, line: lineMaterials.detail });
  outlinedBox("bed-right-rail", [0.12, 0.58, 5.42], [3.94, 0.02, 2.2], { opacity: 0.12, line: lineMaterials.detail });
  outlinedBox("pillow-left", [1.02, 0.24, 0.82], [1.93, 0.95, -0.05], { opacity: 0.2, line: lineMaterials.soft });
  outlinedBox("pillow-right", [1.02, 0.24, 0.82], [3.17, 0.95, -0.05], { opacity: 0.2, line: lineMaterials.soft });
  outlinedBox("blanket-fold", [2.51, 0.1, 0.42], [2.55, 1.02, 4.33], {
    fill: palette.mustard,
    opacity: 0.2,
    line: lineMaterials.detail,
  });
  [1.0, 2.1, 3.2].forEach((z) => {
    line([[1.33, 1.055, z], [3.77, 1.055, z]], lineMaterials.detail);
  });
  let blanketFolded = false;
  hitProxy("bed", "床 · 折叠被子", [2.55, 0.6, 2.2], [2.8, 1.3, 5.5], null, () => {
    blanketFolded = !blanketFolded;
    playMaterialSound("fabric", blanketFolded);
    const fromScale = blanket.scale.z;
    const fromZ = blanket.position.z;
    const fromY = blanket.position.y;
    const toScale = blanketFolded ? 0.26 : 1;
    const toZ = blanketFolded ? 3.9 : 2.37;
    const toY = blanketFolded ? 1.08 : 0.965;
    tween(720, (value) => {
      blanket.scale.z = fromScale + (toScale - fromScale) * value;
      blanket.position.z = fromZ + (toZ - fromZ) * value;
      blanket.position.y = fromY + (toY - fromY) * value;
    });
  });

  // Poster only: no tapestry backing or decorative green canvas.
  const aboutFallback = wallText([
    "郭昊 · Hao Guo",
    "华南理工大学",
    "网络工程 · 2023 级",
    "强化学习 · 智能优化 · LLM Agent",
  ], [-3.955, 2.72, 1.62], 3.08, 1.45);
  new THREE.TextureLoader().load("/images/room/about-canvas.png?v=20260818", (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    const imagePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(3.1, 1.74),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
    );
    imagePanel.position.set(-3.935, 2.74, 1.62);
    imagePanel.rotation.y = Math.PI / 2;
    root.add(imagePanel);
    aboutFallback.visible = false;
  });
  hitProxy("about", "About Me", [-3.9, 2.74, 1.62], [0.35, 2.12, 3.72], "about");

  // Wardrobe at the back wall. Four hinged doors swing open to reveal the rail and clothes.
  outlinedBox("wardrobe-body", [2.05, 3.28, 1.05], [3.075, 0.14, -4.18], {
    fill: 0xc4ae8f,
    opacity: 0.17,
  });
  outlinedBox("wardrobe-interior", [1.86, 3.0, 0.04], [3.075, 0.2, -3.68], {
    fill: 0xefe9dc,
    opacity: 0.5,
    line: lineMaterials.detail,
  });
  line([[2.165, 2.92, -3.72], [3.985, 2.92, -3.72]], lineMaterials.detail);
  const wardrobeDoors = [];
  function wardrobeDoor(name, size, position, hingeX) {
    const panel = outlinedBox(name, size, position, {
      fill: palette.lavender,
      opacity: 0.24,
      line: lineMaterials.soft,
    });
    const pivot = hingeTo(panel, hingeX, position[1] + size[1] / 2, position[2]);
    wardrobeDoors.push({ pivot, dir: hingeX < position[0] ? -1 : 1 });
  }
  wardrobeDoor("wardrobe-upper-left", [0.93, 0.95, 0.07], [2.575, 2.25, -3.63], 2.11);
  wardrobeDoor("wardrobe-upper-right", [0.93, 0.95, 0.07], [3.555, 2.25, -3.63], 4.02);
  wardrobeDoor("wardrobe-lower-left", [0.93, 1.62, 0.07], [2.575, 0.6, -3.63], 2.11);
  wardrobeDoor("wardrobe-lower-right", [0.93, 1.62, 0.07], [3.555, 0.6, -3.63], 4.02);
  const clothesColors = [0x6f8a71, 0xb49a55, 0xa8a2b3];
  [2.525, 2.965, 3.425].forEach((x, index) => {
    outlinedBox(`wardrobe-cloth-${index}`, [0.3, 0.78, 0.1], [x, 2.05, -3.75], {
      fill: clothesColors[index],
      opacity: 0.4,
      line: lineMaterials.detail,
    });
  });
  let wardrobeOpen = false;
  hitProxy("wardrobe", "衣柜 · 开门", [3.075, 1.7, -3.7], [2.2, 3.4, 0.9], null, () => {
    wardrobeOpen = !wardrobeOpen;
    wardrobeDoors.forEach((door) => {
      const from = door.pivot.rotation.y;
      const to = wardrobeOpen ? door.dir * 0.95 : 0;
      tween(620, (value) => {
        door.pivot.rotation.y = from + (to - from) * value;
      });
    });
  });

  // Open wooden bookcase: a visible frame rather than a closed storage box.
  outlinedBox("bookshelf-back", [1.48, 3.16, 0.06], [0.38, 0.12, -4.5], { fill: 0xd6c5a7, line: lineMaterials.detail });
  [-0.38, 1.14].forEach((x) => {
    outlinedBox("bookshelf-side", [0.14, 3.28, 0.76], [x, 0.06, -4.18], { fill: 0xb89567, line: lineMaterials.added });
  });
  const shelfLevels = [0.1, 0.86, 1.62, 2.38, 3.14];
  shelfLevels.forEach((y) => {
    outlinedBox("bookshelf-slab", [1.66, 0.13, 0.78], [0.38, y, -4.18], { fill: 0xb89567, line: lineMaterials.added });
  });
  const bookColors = [0x9b6e58, 0x6f8a71, 0xb49a55, 0x7e8790, 0xa8a2b3];
  [0.23, 0.99, 1.75, 2.51].forEach((baseY, row) => {
    let cursor = -0.25;
    for (let index = 0; index < 7; index += 1) {
      const width = 0.13 + ((index + row) % 3) * 0.03;
      const height = 0.46 + ((index * 2 + row) % 4) * 0.055;
      const book = outlinedBox(`book-${row}-${index}`, [width, height, 0.5], [cursor, baseY, -3.83], {
        fill: bookColors[(index + row) % bookColors.length],
        line: lineMaterials.detail,
      });
      if ((index + row) % 6 === 0) book.rotation.x = -0.07;
      cursor += width + 0.045;
    }
  });
  hitProxy("blog", "博客书架", [0.38, 1.72, -4.02], [1.9, 3.55, 1.05], "blog");

  // Upright pedal bin by the back-right corner: cylinder body, rim and a flip lid.
  const bin = new THREE.Group();
  const binBody = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.74, 16), fillMaterial(0x9aa1a3, 0.22));
  binBody.position.y = 0.37;
  const binEdges = new THREE.LineSegments(new THREE.EdgesGeometry(binBody.geometry, 40), lineMaterials.soft);
  binEdges.position.y = 0.37;
  const binRim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 8, 26), fillMaterial(palette.subtle, 0.85));
  binRim.rotation.x = Math.PI / 2;
  binRim.position.y = 0.74;
  const binLidPivot = new THREE.Group();
  binLidPivot.position.set(0, 0.76, -0.24);
  const binLid = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 16), fillMaterial(0x6d7477, 0.42));
  binLid.position.set(0, 0.02, 0.24);
  const binLidEdge = new THREE.LineSegments(new THREE.EdgesGeometry(binLid.geometry), lineMaterials.soft);
  binLidEdge.position.copy(binLid.position);
  binLidPivot.add(binLid, binLidEdge);
  bin.add(binBody, binEdges, binRim, binLidPivot);
  bin.position.set(-3.23, 0, -0.45);
  root.add(bin);
  let binOpen = false;
  hitProxy("bin", "垃圾桶 · 踩一脚", [-3.23, 0.48, -0.45], [0.72, 1.1, 0.72], null, () => {
    binOpen = !binOpen;
    const from = binLidPivot.rotation.x;
    const to = binOpen ? -1.15 : 0;
    tween(360, (value) => { binLidPivot.rotation.x = from + (to - from) * value; });
  });

  // Air conditioner above wardrobe: click toggles the louver and airflow lines.
  outlinedBox("air-conditioner", [1.85, 0.48, 0.46], [3.075, 3.9, -4.5], { opacity: 0.13 });
  const acLouver = outlinedBox("air-conditioner-louver", [1.52, 0.08, 0.12], [3.075, 3.84, -4.22], {
    fill: 0xd8ddd8,
    line: lineMaterials.detail,
  });
  const acIndicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa19d, toneMapped: false });
  const acIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), acIndicatorMaterial);
  acIndicator.position.set(3.765, 4.17, -4.25);
  root.add(acIndicator);
  const acAirflow = new THREE.Group();
  acAirflow.visible = false;
  root.add(acAirflow);
  [2.475, 2.875, 3.275].forEach((x) => {
    line([[x, 3.72, -4.24], [x - 0.34, 3.42, -4.08], [x - 0.42, 3.12, -4.04]], lineMaterials.detail, acAirflow);
  });
  let acOn = false;
  hitProxy("air-conditioner", "空调 · 打开 / 关闭", [3.075, 4.14, -4.5], [2.05, 0.72, 0.72], null, () => {
    acOn = !acOn;
    if (acOn) {
      playObjectSound("air-conditioner-on");
      playMaterialSound("air-on", true);
    } else {
      stopObjectSound("air-conditioner-on");
      playMaterialSound("air-off", false);
    }
    acAirflow.visible = acOn;
    acIndicatorMaterial.color.setHex(acOn ? 0x4f9b68 : 0x9aa19d);
    const from = acLouver.rotation.x;
    const to = acOn ? 0.72 : 0;
    tween(420, (value) => { acLouver.rotation.x = from + (to - from) * value; });
  });

  // The room has one left-wall window. Two independent curtains gather toward both sides.
  outlinedBox("left-window-glass", [0.05, 2.9, 3.12], [-4.035, 0.6, -2.0], { fill: 0x9fb9c9, line: lineMaterials.detail });
  [-3.56, -0.44].forEach((z) => outlinedBox("left-window-vertical-frame", [0.12, 3.12, 0.12], [-3.96, 0.48, z], { line: lineMaterials.main }));
  [0.48, 3.48].forEach((y) => outlinedBox("left-window-horizontal-frame", [0.12, 0.12, 3.24], [-3.96, y, -2.0], { line: lineMaterials.main }));
  outlinedBox("left-window-middle", [0.12, 2.92, 0.08], [-3.94, 0.58, -2.0], { line: lineMaterials.soft });
  outlinedBox("curtain-rod", [0.12, 0.1, 3.58], [-3.86, 3.62, -2.0], { fill: palette.black, line: lineMaterials.soft });

  function createCurtainPanel(name, centerZ) {
    const panel = new THREE.Group();
    panel.position.set(-3.78, 0, centerZ);
    root.add(panel);
    outlinedBox(name, [0.12, 3.45, 1.52], [0, 0.14, 0], { fill: 0xd2c7a9, line: lineMaterials.soft, parent: panel });
    [-0.55, -0.18, 0.18, 0.55].forEach((z) => {
      line([[0.08, 3.48, z], [0.08, 0.22, z + (z < 0 ? 0.08 : -0.08)]], lineMaterials.detail, panel);
    });
    for (let y = 0.55; y < 3.3; y += 0.5) {
      [-0.48, 0, 0.48].forEach((z) => {
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: palette.white, side: THREE.DoubleSide }));
        dot.position.set(0.085, y, z + ((Math.round(y * 10) % 2) ? 0.12 : 0));
        dot.rotation.y = Math.PI / 2;
        panel.add(dot);
      });
    }
    return panel;
  }
  const leftCurtain = createCurtainPanel("curtain-left", -2.78);
  const rightCurtain = createCurtainPanel("curtain-right", -1.22);
  let curtainGathered = false;
  hitProxy("curtain", "窗帘 · 拉开", [-3.92, 1.95, -2.0], [0.34, 3.9, 3.3], null, () => {
    curtainGathered = !curtainGathered;
    playMaterialSound("curtain", curtainGathered);
    const fromLeftZ = leftCurtain.position.z;
    const fromRightZ = rightCurtain.position.z;
    const fromScale = leftCurtain.scale.z;
    tween(760, (value) => {
      leftCurtain.position.z = fromLeftZ + ((curtainGathered ? -3.35 : -2.78) - fromLeftZ) * value;
      rightCurtain.position.z = fromRightZ + ((curtainGathered ? -0.65 : -1.22) - fromRightZ) * value;
      const scale = fromScale + ((curtainGathered ? 0.28 : 1) - fromScale) * value;
      leftCurtain.scale.z = scale;
      rightCurtain.scale.z = scale;
    });
    if (curtainGathered) {
      window.setTimeout(() => {
        setCameraPreset("links", false);
        openPanel("links");
      }, 520);
    }
  });

  // Exterior door on the front-left facade, matching the marked reference position.
  outlinedBox("room-door", [1.46, 2.88, 0.1], [-3.34, 0.02, 4.94], {
    fill: 0xcbb998,
    opacity: 0.2,
    line: lineMaterials.added,
  });
  outlinedBox("door-upper-panel", [1.08, 0.95, 0.035], [-3.34, 1.66, 5.01], { opacity: 0.07, line: lineMaterials.detail });
  outlinedBox("door-lower-panel", [1.08, 0.95, 0.035], [-3.34, 0.34, 5.01], { opacity: 0.07, line: lineMaterials.detail });
  line([[-4.12, 0.02, 4.87], [-4.12, 3.03, 4.87], [-2.56, 3.03, 4.87], [-2.56, 0.02, 4.87]], lineMaterials.main);
  outlinedBox("exterior-door-mat", [1.08, 0.035, 0.72], [-3.34, 0.005, 5.28], { fill: 0xb9b09d, line: lineMaterials.detail });
  const doorKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 18, 12),
    fillMaterial(palette.added, 0.5),
  );
  doorKnob.position.set(-2.78, 1.34, 5.08);
  root.add(doorKnob);
  hitProxy("door", "推门 · 关于我", [-3.34, 1.5, 4.92], [1.7, 3.12, 0.65], "door");

  // A physical wall switch beside the entrance controls the room atmosphere.
  outlinedBox("wall-light-switch-plate", [0.34, 0.48, 0.07], [-2.3, 1.6, 4.9], {
    fill: 0xe8e1d3,
    opacity: 0.42,
    line: lineMaterials.detail,
  });
  const lightSwitchPaddle = new THREE.Group();
  lightSwitchPaddle.position.set(-2.3, 1.84, 4.96);
  const lightSwitchGeometry = new THREE.BoxGeometry(0.16, 0.25, 0.06);
  lightSwitchPaddle.add(
    new THREE.Mesh(lightSwitchGeometry, fillMaterial(0xd8cdbb, 0.72)),
    new THREE.LineSegments(new THREE.EdgesGeometry(lightSwitchGeometry), lineMaterials.main),
  );
  root.add(lightSwitchPaddle);
  const lightSwitchIndicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x78958a, toneMapped: false });
  const lightSwitchIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 12, 8),
    lightSwitchIndicatorMaterial,
  );
  lightSwitchIndicator.position.set(-2.3, 2.07, 5.015);
  root.add(lightSwitchIndicator);
  const lightSwitchInteraction = hitProxy(
    "wall-light-switch",
    "灯光 · 切换到夜晚",
    [-2.3, 1.84, 4.96],
    [0.52, 0.68, 0.34],
    null,
    () => setRoomNight(!roomNight, true),
  );

  // Refrigerator between curtain and desk. Double doors swing open to reveal the interior.
  outlinedBox("fridge-lower", [1.16, 1.35, 1.08], [-3.25, 0, -4.28], { opacity: 0.17 });
  outlinedBox("fridge-upper", [1.16, 0.98, 1.08], [-3.25, 1.35, -4.28], { opacity: 0.17 });
  outlinedBox("fridge-interior", [1.02, 2.2, 0.94], [-3.25, 0.06, -4.27], {
    fill: 0xf3efe2,
    opacity: 0.55,
    line: lineMaterials.detail,
  });
  const fridgeContents = new THREE.Group();
  fridgeContents.visible = false;
  root.add(fridgeContents);
  line([[-3.72, 1.18, -3.81], [-2.78, 1.18, -3.81]], lineMaterials.detail, fridgeContents);
  outlinedBox("fridge-milk", [0.22, 0.38, 0.22], [-3.52, 0.32, -4.27], {
    fill: 0x759aaa,
    opacity: 0.45,
    line: lineMaterials.detail,
    parent: fridgeContents,
  });
  outlinedBox("fridge-cake", [0.3, 0.2, 0.3], [-2.97, 1.28, -4.33], {
    fill: palette.mustard,
    opacity: 0.5,
    line: lineMaterials.detail,
    parent: fridgeContents,
  });
  const fridgeDoors = [];
  function fridgeDoor(name, size, position) {
    const panel = outlinedBox(name, size, position, { opacity: 0.2, line: lineMaterials.soft });
    const pivot = hingeTo(panel, -3.79, position[1] + size[1] / 2, position[2]);
    fridgeDoors.push(pivot);
  }
  fridgeDoor("fridge-door-upper", [1.06, 0.9, 0.05], [-3.24, 1.39, -3.71]);
  fridgeDoor("fridge-door-lower", [1.06, 1.25, 0.05], [-3.24, 0.06, -3.71]);
  const beefBallBag = outlinedBox("chaoshan-beef-ball-bag", [0.5, 0.34, 0.16], [-3.22, 0.52, -3.9], {
    fill: 0xc96f55,
    line: lineMaterials.added,
    parent: fridgeContents,
  });
  const beefBallLabelCanvas = document.createElement("canvas");
  beefBallLabelCanvas.width = 512;
  beefBallLabelCanvas.height = 180;
  const beefBallLabelContext = beefBallLabelCanvas.getContext("2d");
  beefBallLabelContext.fillStyle = "#f7e7c4";
  beefBallLabelContext.fillRect(0, 0, 512, 180);
  beefBallLabelContext.fillStyle = "#8f3328";
  beefBallLabelContext.font = "700 54px 'PingFang SC', sans-serif";
  beefBallLabelContext.textAlign = "center";
  beefBallLabelContext.fillText("潮汕牛肉丸", 256, 112);
  const beefBallLabelTexture = new THREE.CanvasTexture(beefBallLabelCanvas);
  beefBallLabelTexture.colorSpace = THREE.SRGBColorSpace;
  const beefBallLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.43, 0.16),
    new THREE.MeshBasicMaterial({ map: beefBallLabelTexture, side: THREE.DoubleSide, toneMapped: false }),
  );
  beefBallLabel.scale.set(0.82, 0.82, 0.82);
  beefBallLabel.position.set(-3.22, 0.72, -3.79);
  fridgeContents.add(beefBallLabel);

  const qiaoleziIceCream = outlinedBox("qiaolezi-yellow-ice-cream", [0.28, 0.56, 0.11], [-3.24, 1.34, -3.93], {
    fill: 0xf0c84b,
    line: lineMaterials.added,
    parent: fridgeContents,
  });
  const qiaoleziLabelCanvas = document.createElement("canvas");
  qiaoleziLabelCanvas.width = 280;
  qiaoleziLabelCanvas.height = 560;
  const qiaoleziLabelContext = qiaoleziLabelCanvas.getContext("2d");
  qiaoleziLabelContext.fillStyle = "#f4cf4f";
  qiaoleziLabelContext.fillRect(0, 0, 280, 560);
  qiaoleziLabelContext.fillStyle = "#8d2f28";
  qiaoleziLabelContext.font = "700 62px 'PingFang SC', sans-serif";
  qiaoleziLabelContext.textAlign = "center";
  qiaoleziLabelContext.fillText("巧乐兹", 140, 205);
  qiaoleziLabelContext.fillStyle = "#fff8dc";
  qiaoleziLabelContext.fillRect(48, 255, 184, 84);
  qiaoleziLabelContext.fillStyle = "#8d2f28";
  qiaoleziLabelContext.font = "700 42px 'PingFang SC', sans-serif";
  qiaoleziLabelContext.fillText("雪糕", 140, 315);
  qiaoleziLabelContext.fillStyle = "#6f472f";
  qiaoleziLabelContext.fillRect(112, 382, 56, 132);
  const qiaoleziLabelTexture = new THREE.CanvasTexture(qiaoleziLabelCanvas);
  qiaoleziLabelTexture.colorSpace = THREE.SRGBColorSpace;
  const qiaoleziLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.23, 0.46),
    new THREE.MeshBasicMaterial({ map: qiaoleziLabelTexture, side: THREE.DoubleSide, toneMapped: false }),
  );
  qiaoleziLabel.scale.set(0.78, 0.78, 0.78);
  qiaoleziLabel.position.set(-3.24, 1.64, -3.81);
  fridgeContents.add(qiaoleziLabel);

  // The refrigerator cavity is a transparent closed volume. Render its contents
  // after the shell so food and the small product labels remain legible when open.
  fridgeContents.traverse((child) => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const visibleMaterials = materials.map((material) => {
      const cloned = material.clone();
      cloned.depthTest = false;
      cloned.depthWrite = false;
      cloned.needsUpdate = true;
      return cloned;
    });
    child.material = Array.isArray(child.material) ? visibleMaterials : visibleMaterials[0];
    child.renderOrder = 12;
  });
  const qiaoleziInteraction = hitProxy(
    "qiaolezi-ice-cream",
    "巧乐兹雪糕 · 黄色包装",
    [-3.24, 1.62, -3.9],
    [0.46, 0.72, 0.38],
    null,
    () => {},
  );
  qiaoleziInteraction.proxy.visible = false;

  // Slim water dispenser between the refrigerator and bookshelf.
  outlinedBox("water-dispenser-body", [0.5, 0.82, 0.5], [-2.28, 0, -4.22], {
    fill: 0xe7e3da,
    line: lineMaterials.soft,
  });
  outlinedBox("water-dispenser-head", [0.5, 0.38, 0.5], [-2.28, 0.82, -4.22], {
    fill: 0xd9dedb,
    line: lineMaterials.soft,
  });
  outlinedBox("water-dispenser-recess", [0.32, 0.2, 0.035], [-2.28, 0.92, -3.95], {
    fill: palette.black,
    line: lineMaterials.detail,
  });
  const coldTap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), fillMaterial(0x5799b5, 0.8));
  coldTap.position.set(-2.38, 1.18, -3.92);
  const hotTap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), fillMaterial(0xc96f55, 0.8));
  hotTap.position.set(-2.18, 1.18, -3.92);
  root.add(coldTap, hotTap);
  const waterBottleGeometry = new THREE.CylinderGeometry(0.17, 0.14, 0.48, 16);
  const waterBottle = new THREE.Mesh(
    waterBottleGeometry,
    new THREE.MeshBasicMaterial({ color: 0x8fc6d2, transparent: true, opacity: 0.42, side: THREE.DoubleSide }),
  );
  const waterBottleEdges = new THREE.LineSegments(new THREE.EdgesGeometry(waterBottleGeometry), lineMaterials.detail);
  waterBottle.position.set(-2.28, 1.52, -4.22);
  waterBottleEdges.position.copy(waterBottle.position);
  root.add(waterBottle, waterBottleEdges);
  let fridgeOpen = false;
  hitProxy("fridge", "冰箱 · 开门", [-3.25, 1.15, -4.03], [1.25, 2.35, 1.15], null, () => {
    fridgeOpen = !fridgeOpen;
    playMaterialSound(fridgeOpen ? "fridge-open" : "fridge-close", fridgeOpen);
    if (fridgeOpen) {
      fridgeContents.visible = true;
      qiaoleziInteraction.proxy.visible = true;
    }
    fridgeDoors.forEach((pivot) => {
      const from = pivot.rotation.y;
      const to = fridgeOpen ? -1.12 : 0;
      tween(560, (value) => { pivot.rotation.y = from + (to - from) * value; });
    });
    if (!fridgeOpen) {
      qiaoleziInteraction.highlight.visible = false;
      window.setTimeout(() => {
        if (!fridgeOpen) {
          fridgeContents.visible = false;
          qiaoleziInteraction.proxy.visible = false;
        }
      }, 560);
    }
  });

  // Desk along the left wall. Monitors face into the room (+X), toward the camera corner.
  outlinedBox("desk-top", [1.5, 0.12, 3.52], [-3.1, 1.05, 1.75], { opacity: 0.2 });
  [-3.62, -2.58].forEach((x) => {
    [0.33, 3.12].forEach((z) => outlinedBox("desk-leg", [0.08, 1.05, 0.08], [x, 0, z], { opacity: 0.2 }));
  });

  function createMonitorScreen(name, title, position, width, height, mode) {
    const screenCanvas = document.createElement("canvas");
    screenCanvas.width = Math.round(width > height ? 1280 : 720);
    screenCanvas.height = Math.round(width > height ? 720 : 1280);
    const context = screenCanvas.getContext("2d");
    context.fillStyle = "#f6f8fa";
    context.fillRect(0, 0, screenCanvas.width, screenCanvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, screenCanvas.width, 78);
    context.strokeStyle = "#d0d7de";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(0, 78);
    context.lineTo(screenCanvas.width, 78);
    context.stroke();
    [28, 52, 76].forEach((x, index) => {
      context.fillStyle = ["#ff7b72", "#d29922", "#3fb950"][index];
      context.beginPath();
      context.arc(x, 38, 8, 0, Math.PI * 2);
      context.fill();
    });
    context.fillStyle = "#24292f";
    context.font = `700 ${Math.round(screenCanvas.width * 0.032)}px monospace`;
    context.fillText(title, 108, 49);

    const sidebarWidth = Math.round(screenCanvas.width * (mode === "code" ? 0.24 : 0.29));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 80, sidebarWidth, screenCanvas.height - 80);
    context.strokeStyle = "#d8dee4";
    context.beginPath();
    context.moveTo(sidebarWidth, 80);
    context.lineTo(sidebarWidth, screenCanvas.height);
    context.stroke();

    if (mode === "code") {
      context.fillStyle = "#57606a";
      context.font = `600 ${Math.round(screenCanvas.width * 0.019)}px monospace`;
      context.fillText("EXPLORER", 24, 126);
      ["src", "  agents", "  prompts", "  evaluators", "tests", "README.md"].forEach((entry, index) => {
        context.fillStyle = index === 2 ? "#0969da" : "#57606a";
        context.fillText(entry, 28, 176 + index * 46);
      });

      const editorX = sidebarWidth + 38;
      context.fillStyle = "#ffffff";
      context.fillRect(sidebarWidth + 2, 80, screenCanvas.width - sidebarWidth - 2, screenCanvas.height - 80);
      context.font = `500 ${Math.round(screenCanvas.width * 0.021)}px monospace`;
      const codeLines = [
        ["from", " agents ", "import", " ReviewAgent"],
        ["from", " tools ", "import", " code_search"],
        ["", "", "", ""],
        ["class", " RepositoryReview", "", ":"],
        ["    async def", " run", "", "(self, diff):"],
        ["        context", " = ", "await", " self.plan(diff)"],
        ["        findings", " = []", "", ""],
        ["        for", " file ", "in", " context.files:"],
        ["            findings", " += ", "await", " self.review(file)"],
        ["        return", " findings", "", ""],
      ];
      codeLines.forEach((segments, index) => {
        const y = 138 + index * 48;
        context.fillStyle = "#8c959f";
        context.fillText(String(index + 1).padStart(2, " "), sidebarWidth + 10, y);
        let x = editorX;
        const colors = ["#cf222e", "#24292f", "#8250df", "#0a3069"];
        segments.forEach((segment, segmentIndex) => {
          context.fillStyle = colors[segmentIndex];
          context.fillText(segment, x, y);
          x += context.measureText(segment).width;
        });
      });
      context.fillStyle = "#ddf4ff";
      context.fillRect(sidebarWidth + 2, screenCanvas.height - 62, screenCanvas.width - sidebarWidth - 2, 62);
      context.fillStyle = "#0969da";
      context.fillText("main  ✓ tests 18 passed", editorX, screenCanvas.height - 24);
    } else {
      context.fillStyle = "#57606a";
      context.font = `600 ${Math.round(screenCanvas.width * 0.027)}px sans-serif`;
      context.fillText("CONTENTS", 22, 132);
      ["Overview", "Architecture", "Agent Loop", "Evaluation", "Deployment"].forEach((entry, index) => {
        context.fillStyle = index === 2 ? "#0969da" : "#57606a";
        context.fillText(entry, 22, 190 + index * 58);
      });
      const docX = sidebarWidth + 34;
      context.fillStyle = "#24292f";
      context.font = `700 ${Math.round(screenCanvas.width * 0.05)}px sans-serif`;
      context.fillText("Agent Loop", docX, 150);
      context.fillStyle = "#57606a";
      context.font = `500 ${Math.round(screenCanvas.width * 0.026)}px sans-serif`;
      [0.86, 0.72, 0.9, 0.63].forEach((ratio, index) => {
        context.fillRect(docX, 205 + index * 42, (screenCanvas.width - docX - 34) * ratio, 8);
      });
      context.fillStyle = "#ddf4ff";
      context.fillRect(docX, 410, screenCanvas.width - docX - 34, 190);
      context.fillStyle = "#0969da";
      context.font = `600 ${Math.round(screenCanvas.width * 0.025)}px monospace`;
      ["plan(diff)", "review(file)", "validate(output)"].forEach((entry, index) => {
        context.fillText(entry, docX + 22, 466 + index * 48);
      });
      context.fillStyle = "#1a7f37";
      context.font = `700 ${Math.round(screenCanvas.width * 0.028)}px sans-serif`;
      ["✓ Context collected", "✓ Tools validated", "✓ Output grounded"].forEach((entry, index) => {
        context.fillText(entry, docX, 680 + index * 62);
      });
    }

    const gloss = context.createLinearGradient(0, 0, screenCanvas.width, screenCanvas.height);
    gloss.addColorStop(0, "rgba(9,105,218,0.07)");
    gloss.addColorStop(0.2, "rgba(255,255,255,0.02)");
    gloss.addColorStop(0.48, "rgba(255,255,255,0)");
    context.fillStyle = gloss;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(screenCanvas.width * 0.5, 0);
    context.lineTo(screenCanvas.width * 0.16, screenCanvas.height);
    context.lineTo(0, screenCanvas.height);
    context.closePath();
    context.fill();

    const texture = new THREE.CanvasTexture(screenCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
    );
    screen.name = name;
    screen.position.set(...position);
    screen.rotation.y = Math.PI / 2;
    root.add(screen);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 0.985, height * 0.985),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.position.set(position[0] + 0.008, position[1], position[2]);
    glass.rotation.y = Math.PI / 2;
    root.add(glass);

    const ledMaterial = new THREE.MeshBasicMaterial({ color: 0x69e0d2, toneMapped: false });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), ledMaterial);
    led.position.set(position[0] + 0.02, position[1] - height / 2 - 0.035, position[2] + width * 0.36);
    root.add(led);
  }

  const monitorLandscape = outlinedBox("main-monitor-projects", [0.035, 1.08, 1.84], [-3.1, 1.26, 1.38], {
    fill: palette.black,
    opacity: 0.22,
  });
  createMonitorScreen("main-monitor-screen", "HOWILLMAKEIT / CODE", [-3.075, 1.8, 1.38], 1.72, 0.96, "code");
  outlinedBox("portrait-monitor", [0.035, 1.42, 0.78], [-3.1, 1.2, 2.69], {
    fill: palette.black,
    opacity: 0.2,
  });
  createMonitorScreen("portrait-screen", "DOCS", [-3.075, 1.91, 2.69], 0.65, 1.26, "docs");
  // Thin center stands and long flat bases based on the supplied monitor reference.
  outlinedBox("main-monitor-neck", [0.09, 0.4, 0.12], [-3.16, 1.16, 1.38], { fill: palette.black, line: lineMaterials.detail });
  outlinedBox("main-monitor-base", [0.42, 0.035, 1.24], [-3.15, 1.15, 1.38], { fill: palette.black, line: lineMaterials.soft });
  outlinedBox("portrait-monitor-neck", [0.08, 0.34, 0.1], [-3.16, 1.16, 2.69], { fill: palette.black, line: lineMaterials.detail });
  outlinedBox("portrait-monitor-base", [0.38, 0.035, 0.56], [-3.15, 1.15, 2.69], { fill: palette.black, line: lineMaterials.soft });
  hitProxy("projects", "科研项目", [-2.96, 1.82, 1.38], [0.45, 1.42, 2.02], "projects");
  hitProxy("experience", "实习与经历", [-2.96, 1.9, 2.69], [0.45, 1.72, 0.9], "experience");

  outlinedBox("keyboard", [0.34, 0.065, 1.08], [-2.48, 1.17, 1.55], { fill: palette.white, line: lineMaterials.detail });
  for (let z = 1.12; z <= 1.98; z += 0.14) {
    line([[-2.3, 1.208, z], [-2.64, 1.208, z]], lineMaterials.detail);
  }
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 12), fillMaterial(palette.black, 0.34));
  mouse.scale.set(0.72, 0.34, 1);
  mouse.position.set(-2.46, 1.225, 0.62);
  root.add(mouse);
  outlinedBox("desk-tablet", [0.32, 0.035, 0.58], [-2.52, 1.17, 2.62], {
    fill: palette.black,
    line: lineMaterials.soft,
  });
  const tabletScreenCanvas = document.createElement("canvas");
  tabletScreenCanvas.width = 420;
  tabletScreenCanvas.height = 760;
  const tabletContext = tabletScreenCanvas.getContext("2d");
  tabletContext.fillStyle = "#f6f8fa";
  tabletContext.fillRect(0, 0, 420, 760);
  tabletContext.fillStyle = "#0969da";
  tabletContext.fillRect(34, 46, 352, 12);
  tabletContext.fillStyle = "#24292f";
  tabletContext.font = "700 40px sans-serif";
  tabletContext.fillText("TODAY", 34, 118);
  [0.82, 0.64, 0.75, 0.52].forEach((ratio, index) => {
    tabletContext.fillStyle = index === 0 ? "#ddf4ff" : "#d8dee4";
    tabletContext.fillRect(34, 174 + index * 112, 352 * ratio, 56);
  });
  const tabletTexture = new THREE.CanvasTexture(tabletScreenCanvas);
  tabletTexture.colorSpace = THREE.SRGBColorSpace;
  const tabletScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.25, 0.49),
    new THREE.MeshBasicMaterial({ map: tabletTexture, side: THREE.DoubleSide, toneMapped: false }),
  );
  tabletScreen.position.set(-2.515, 1.211, 2.62);
  tabletScreen.rotation.x = -Math.PI / 2;
  root.add(tabletScreen);

  // Tall ergonomic chair with a segmented mesh back, lumbar support and headrest.
  const chairGroup = new THREE.Group();
  chairGroup.position.set(-0.62, 0.28, 1.8);
  root.add(chairGroup);
  outlinedBox("chair-seat", [1.12, 0.2, 1.04], [0, 0.72, 0], { fill: palette.black, opacity: 0.26, parent: chairGroup });
  const chairLowerBack = outlinedBox("chair-lower-back", [0.12, 0.58, 0.92], [0.48, 0.92, 0], { fill: palette.black, opacity: 0.16, line: lineMaterials.soft, parent: chairGroup });
  chairLowerBack.rotation.z = -0.08;
  const chairUpperBack = outlinedBox("chair-upper-back", [0.12, 0.72, 1.02], [0.55, 1.46, 0], { fill: palette.black, opacity: 0.13, line: lineMaterials.soft, parent: chairGroup });
  chairUpperBack.rotation.z = -0.13;
  outlinedBox("chair-headrest-post", [0.08, 0.38, 0.08], [0.64, 2.08, 0], { fill: palette.black, line: lineMaterials.detail, parent: chairGroup });
  const chairHeadrest = outlinedBox("chair-headrest", [0.16, 0.38, 0.84], [0.68, 2.35, 0], { fill: palette.black, line: lineMaterials.soft, parent: chairGroup });
  chairHeadrest.rotation.z = -0.12;
  outlinedBox("chair-lumbar", [0.14, 0.24, 0.68], [0.55, 1.08, 0], { fill: palette.green, line: lineMaterials.detail, parent: chairGroup });
  [-0.52, 0.52].forEach((z) => {
    outlinedBox("chair-arm", [0.68, 0.08, 0.08], [0.12, 1.16, z], { fill: palette.black, opacity: 0.2, line: lineMaterials.detail, parent: chairGroup });
    outlinedBox("chair-arm-post", [0.08, 0.38, 0.08], [0.12, 0.78, z], { opacity: 0.16, line: lineMaterials.detail, parent: chairGroup });
  });
  outlinedBox("chair-center-post", [0.1, 0.56, 0.1], [0, 0.12, 0], { opacity: 0.16, line: lineMaterials.detail, parent: chairGroup });
  for (let index = 0; index < 5; index += 1) {
    const spoke = outlinedBox("chair-spoke", [0.58, 0.055, 0.07], [0, 0.12, 0], { opacity: 0.16, line: lineMaterials.detail, parent: chairGroup });
    spoke.rotation.y = (Math.PI * 2 * index) / 5;
  }
  [-0.43, -0.22, 0, 0.22, 0.43].forEach((z) => {
    line([[0.58, 1.02, z], [0.71, 2.05, z]], lineMaterials.detail, chairGroup);
  });
  hitProxy("chair", "人体工学椅 · 转一圈", [-0.62, 1.45, 1.8], [1.55, 2.95, 1.55], null, () => {
    const from = chairGroup.rotation.y;
    const to = from + Math.PI * 2;
    tween(880, (value) => { chairGroup.rotation.y = from + (to - from) * value; });
  });

  // Football remains as the only loose object in this area.
  const footballGroup = new THREE.Group();
  footballGroup.position.set(-0.9, 0.34, -0.55);
  const footballGeometry = new THREE.IcosahedronGeometry(0.32, 1);
  const football = new THREE.Mesh(footballGeometry, fillMaterial(palette.white, 0.32));
  const footballEdges = new THREE.LineSegments(new THREE.EdgesGeometry(footballGeometry), lineMaterials.detail);
  footballGroup.add(football, footballEdges);
  root.add(footballGroup);
  hitProxy("football", "足球 · 颠一下", [-0.9, 0.34, -0.55], [0.8, 0.9, 0.8], null, () => {
    playBounceSound();
    const baseY = footballGroup.position.y;
    const baseRot = footballGroup.rotation.x;
    tween(820, (value, raw) => {
      footballGroup.position.y = baseY + Math.sin(raw * Math.PI) * 1.15;
      footballGroup.rotation.x = baseRot + raw * 2.4;
    }, () => { footballGroup.position.y = baseY; });
  });

  // Three medals now occupy the former left-wall doorway position.
  [-0.42, 0, 0.42].forEach((offset, index) => {
    const medal = new THREE.Group();
    const ribbonLeft = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-3.99, 2.82, 3.82 + offset),
        new THREE.Vector3(-3.92, 2.48, 3.82 + offset - 0.13),
      ]),
      lineMaterials.added,
    );
    const ribbonRight = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-3.99, 2.82, 3.82 + offset),
        new THREE.Vector3(-3.92, 2.48, 3.82 + offset + 0.13),
      ]),
      lineMaterials.added,
    );
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.155, 32),
      new THREE.MeshBasicMaterial({ color: index === 1 ? palette.mustard : palette.added, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    );
    disc.position.set(-3.9, 2.32, 3.82 + offset);
    disc.rotation.y = Math.PI / 2;
    const medalRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.155, 0.018, 8, 30),
      new THREE.MeshBasicMaterial({ color: palette.added, transparent: true, opacity: 0.9 }),
    );
    medalRing.position.copy(disc.position);
    medalRing.rotation.y = Math.PI / 2;
    const medalCenter = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 20),
      new THREE.MeshBasicMaterial({ color: palette.white, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    medalCenter.position.set(-3.875, 2.32, 3.82 + offset);
    medalCenter.rotation.y = Math.PI / 2;
    medal.add(ribbonLeft, ribbonRight, disc, medalRing, medalCenter);
    root.add(medal);
  });
  hitProxy("honors", "荣誉", [-3.82, 2.52, 3.82], [0.55, 1.08, 1.55], "honors");

  const cameraPresets = {
    overview: {
      position: new THREE.Vector3(8.8, 7.1, 8.15),
      target: new THREE.Vector3(-0.85, 2, -0.25),
      zoom: 0.96,
    },
    desk: {
      position: new THREE.Vector3(2.5, 3.65, 4.25),
      target: new THREE.Vector3(-2.55, 1.45, 1.75),
      zoom: 1.48,
    },
    room: {
      position: new THREE.Vector3(8.8, 7.5, 8.7),
      target: new THREE.Vector3(0, 1.15, -0.45),
      zoom: 0.9,
    },
    mobile: {
      position: new THREE.Vector3(12.8, 10.2, 11.4),
      target: new THREE.Vector3(-1.25, 1.3, -0.4),
      zoom: 0.68,
    },
    blog: { position: new THREE.Vector3(2.6, 3.5, -0.45), target: new THREE.Vector3(-0.42, 1.52, -4.05), zoom: 1.48 },
    links: { position: new THREE.Vector3(3.9, 3.8, 2.2), target: new THREE.Vector3(-3.95, 2.0, -2.0), zoom: 1.38 },
    projects: { position: new THREE.Vector3(2.25, 3.35, 3.55), target: new THREE.Vector3(-2.45, 1.62, 1.7), zoom: 1.65 },
    experience: { position: new THREE.Vector3(1.9, 3.45, 4.35), target: new THREE.Vector3(-3.05, 1.91, 2.69), zoom: 1.68 },
    honors: { position: new THREE.Vector3(2.1, 3.55, 6.2), target: new THREE.Vector3(-3.85, 2.42, 3.82), zoom: 1.58 },
    about: { position: new THREE.Vector3(2.9, 4.35, 5.25), target: new THREE.Vector3(-3.95, 2.72, 1.62), zoom: 1.42 },
    door: { position: new THREE.Vector3(2.2, 3.8, 7.4), target: new THREE.Vector3(-3.34, 1.52, 4.94), zoom: 1.52 },
  };

  let activePreset = "overview";
  let cameraTarget = cameraPresets.overview.target.clone();
  let transition = null;
  let hoveredObject = null;
  let soundEnabled = true;
  const roomThemeStorageKey = "pref-theme";
  let roomNight = false;
  const screenGlowPlanes = [];
  let screenGlowTexture = null;
  let screenBeamTexture = null;
  let audioContext = null;
  const activeObjectAudios = new Map();
  const objectSounds = {
    "air-conditioner-on": { src: "/audio/room/air-conditioner-on.mp3", volume: 0.27 },
    "light-switch": { src: "/audio/room/light-switch.mp3", volume: 0.26 },
    "office-chair-roll": { src: "/audio/room/office-chair-roll.mp3", volume: 0.24 },
    "window-open": { src: "/audio/room/window-open.mp3", volume: 0.3 },
  };

  function createScreenGlowTexture() {
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const context = glowCanvas.getContext("2d");
    const gradient = context.createRadialGradient(128, 116, 18, 128, 128, 126);
    gradient.addColorStop(0, "rgba(224, 247, 255, 0.78)");
    gradient.addColorStop(0.34, "rgba(153, 218, 238, 0.34)");
    gradient.addColorStop(1, "rgba(93, 164, 188, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(glowCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function createScreenBeamTexture() {
    const beamCanvas = document.createElement("canvas");
    beamCanvas.width = 320;
    beamCanvas.height = 640;
    const context = beamCanvas.getContext("2d");
    context.clearRect(0, 0, beamCanvas.width, beamCanvas.height);

    const paintBeam = (blur, alpha, inset) => {
      const gradient = context.createLinearGradient(0, 0, 0, beamCanvas.height);
      gradient.addColorStop(0, `rgba(210, 242, 252, ${alpha})`);
      gradient.addColorStop(0.34, `rgba(164, 219, 237, ${alpha * 0.58})`);
      gradient.addColorStop(1, "rgba(112, 178, 202, 0)");
      context.save();
      context.filter = `blur(${blur}px)`;
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(132 + inset, 6);
      context.lineTo(188 - inset, 6);
      context.lineTo(308 - inset, 628);
      context.lineTo(12 + inset, 628);
      context.closePath();
      context.fill();
      context.restore();
    };

    paintBeam(24, 0.16, 0);
    paintBeam(12, 0.13, 18);
    paintBeam(5, 0.08, 34);
    const texture = new THREE.CanvasTexture(beamCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function ensureScreenGlows() {
    if (screenGlowPlanes.length) return;
    if (!screenGlowTexture) screenGlowTexture = createScreenGlowTexture();
    if (!screenBeamTexture) screenBeamTexture = createScreenBeamTexture();
    const targets = [];
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry || !object.material) return;
      const objectPath = [object.name, object.parent?.name, object.parent?.parent?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (/(monitor|screen|display)/.test(objectPath) && materials.some((material) => material.map)) {
        targets.push(object);
      }
    });

    targets.forEach((screen) => {
      screen.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      screen.geometry.boundingBox.getSize(size);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(size.x * 1.5, 0.75), Math.max(size.y * 1.55, 0.6)),
        new THREE.MeshBasicMaterial({
          map: screenGlowTexture,
          color: 0xbdefff,
          transparent: true,
          opacity: 0.56,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.position.set(0, -size.y * 0.12, Math.max(size.z * 0.5, 0.025) + 0.045);
      glow.renderOrder = 10;
      glow.visible = false;
      screen.add(glow);
      screenGlowPlanes.push(glow);

      // A soft textured sheet suggests projected light without producing the
      // hard geometric sides of a solid frustum.
      const beamLength = 2.45;
      const beamWidth = Math.max(size.x * 2.25, 1.15);
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(beamWidth, beamLength),
        new THREE.MeshBasicMaterial({
          map: screenBeamTexture,
          color: 0xaeddeb,
          transparent: true,
          opacity: 0.46,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      beam.position.set(0, -size.y * 0.18, beamLength * 0.49 + 0.08);
      beam.rotation.x = Math.PI * 0.57;
      beam.renderOrder = 4;
      beam.visible = false;
      screen.add(beam);
      screenGlowPlanes.push(beam);
    });
  }

  function setRoomNight(night, withSound) {
    roomNight = Boolean(night);
    document.body.classList.toggle("room-night", roomNight);
    document.body.classList.toggle("dark", roomNight);
    lightSwitchInteraction.label = roomNight ? "灯光 · 切换到白天" : "灯光 · 切换到夜晚";
    lightSwitchIndicatorMaterial.color.setHex(roomNight ? 0xe2bc65 : 0x78958a);

    // Displays remain self-lit after the room light is switched off.
    root.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const objectPath = [object.name, object.parent?.name, object.parent?.parent?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!/(monitor|screen|display)/.test(objectPath)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material.color) return;
        if (material.userData.roomDayColor === undefined) {
          material.userData.roomDayColor = material.color.getHex();
        }
        material.color.setHex(material.userData.roomDayColor);
        material.opacity = 1;
        material.toneMapped = false;
        material.needsUpdate = true;
      });
    });
    ensureScreenGlows();
    screenGlowPlanes.forEach((glow) => {
      glow.visible = roomNight;
    });

    const from = lightSwitchPaddle.rotation.x;
    const to = roomNight ? -0.34 : 0.34;
    if (withSound) {
      playObjectSound("light-switch");
      tween(180, (value) => {
        lightSwitchPaddle.rotation.x = from + (to - from) * value;
      });
    } else {
      lightSwitchPaddle.rotation.x = to;
    }

    try {
      window.localStorage.setItem(roomThemeStorageKey, roomNight ? "dark" : "light");
    } catch (error) {
      // The room remains functional when storage is unavailable.
    }
  }

  function restoreRoomTheme() {
    let savedTheme = null;
    try {
      savedTheme = window.localStorage.getItem(roomThemeStorageKey);
    } catch (error) {
      savedTheme = null;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setRoomNight(savedTheme ? savedTheme === "dark" : prefersDark, false);
  }
  let siteData = { posts: [], projects: [], honors: [] };

  const objectCopy = {
    blog: { eyebrow: "BOOKSHELF · BLOG", title: "文章与笔记", lead: "好记性不如烂笔头" },
    projects: { eyebrow: "MAIN MONITOR · PROJECTS", title: "科研项目", lead: "强化学习、智能优化、大模型与 Agent，是我持续投入的主线。" },
    experience: { eyebrow: "PORTRAIT MONITOR · EXPERIENCE", title: "经历与方向", lead: "从课堂到真实业务，一段一段慢慢来。" },
    honors: { eyebrow: "THREE BRONZE MEDALS · HONORS", title: "华南理工大学金阳光杯足球赛铜牌 ×3", lead: "五次参加华南理工大学金阳光杯足球赛，三次获得铜牌。" },
    about: { eyebrow: "MONET · ABOUT ME", title: "关于我", lead: "华南理工大学 · 2023 级本科生" },
    links: { eyebrow: "WINDOW · LINKS", title: "窗外与链接", lead: "从这间房间出发，连接更大的世界。" },
  };

  async function loadSiteData() {
    try {
      const response = await fetch("/", { credentials: "same-origin" });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const source = doc.getElementById("room-data");
      if (source) siteData = { ...siteData, ...JSON.parse(source.textContent) };
    } catch (error) {
      console.warn("Room content adapter fell back to local links.", error);
    }
  }

  function ensureAudio() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext && audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function playObjectSound(type) {
    if (!soundEnabled || !objectSounds[type]) return;
    const previous = activeObjectAudios.get(type);
    if (previous) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }

    const settings = objectSounds[type];
    const audio = new Audio(settings.src);
    const release = () => {
      if (activeObjectAudios.get(type) === audio) activeObjectAudios.delete(type);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    activeObjectAudios.set(type, audio);
    audio.volume = settings.volume;
    audio.addEventListener("ended", release, { once: true });
    audio.addEventListener("error", release, { once: true });
    audio.play().catch(release);
  }

  function stopObjectSound(type) {
    const audio = activeObjectAudios.get(type);
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    activeObjectAudios.delete(type);
  }

  function playMaterialSound(type, active) {
    if (!soundEnabled) return;
    const context = ensureAudio();
    if (!context) return;

    const presets = {
      curtain: { duration: 0.62, filter: "bandpass", startHz: 1250, endHz: 720, volume: 0.026 },
      fabric: { duration: 0.48, filter: "highpass", startHz: 780, endHz: 1180, volume: 0.022 },
      "fridge-open": { duration: 0.3, filter: "lowpass", startHz: 460, endHz: 230, volume: 0.032 },
      "fridge-close": { duration: 0.22, filter: "lowpass", startHz: 290, endHz: 120, volume: 0.042 },
      "air-on": { duration: 0.72, filter: "lowpass", startHz: 280, endHz: 620, volume: 0.018 },
      "air-off": { duration: 0.58, filter: "lowpass", startHz: 560, endHz: 130, volume: 0.02 },
    };
    const preset = presets[type];
    if (!preset) return;

    [-0.52, 0.52].forEach((pan, channel) => {
      const frameCount = Math.ceil(context.sampleRate * preset.duration);
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let index = 0; index < frameCount; index += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.58 + white * 0.42;
        const progress = index / frameCount;
        const texture = type === "curtain" || type === "fabric"
          ? 0.72 + Math.sin(progress * Math.PI * 10 + channel) * 0.28
          : 1;
        data[index] = previous * texture;
      }

      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const panner = context.createStereoPanner ? context.createStereoPanner() : null;
      const start = context.currentTime + channel * 0.018;
      source.buffer = buffer;
      filter.type = preset.filter;
      filter.Q.value = type === "curtain" ? 0.7 : 0.45;
      filter.frequency.setValueAtTime(preset.startHz, start);
      filter.frequency.exponentialRampToValueAtTime(preset.endHz, start + preset.duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(preset.volume, start + 0.035);
      if (type === "air-on" && active) {
        gain.gain.setValueAtTime(preset.volume * 0.8, start + preset.duration * 0.7);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, start + preset.duration);

      source.connect(filter);
      if (panner) {
        panner.pan.value = pan;
        filter.connect(panner).connect(gain);
      } else {
        filter.connect(gain);
      }
      gain.connect(context.destination);
      source.start(start);
      source.stop(start + preset.duration + 0.03);
    });

    if (type.startsWith("fridge")) {
      const thump = context.createOscillator();
      const thumpGain = context.createGain();
      const start = context.currentTime + (type === "fridge-close" ? 0.11 : 0.02);
      thump.type = "sine";
      thump.frequency.setValueAtTime(type === "fridge-close" ? 105 : 86, start);
      thump.frequency.exponentialRampToValueAtTime(48, start + 0.13);
      thumpGain.gain.setValueAtTime(0.0001, start);
      thumpGain.gain.linearRampToValueAtTime(type === "fridge-close" ? 0.045 : 0.025, start + 0.012);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      thump.connect(thumpGain).connect(context.destination);
      thump.start(start);
      thump.stop(start + 0.16);
    }
  }

  function stopObjectSounds() {
    activeObjectAudios.forEach((audio) => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
    activeObjectAudios.clear();
  }

  function playCue(type) {
    if (!soundEnabled) return;
    const context = ensureAudio();
    if (!context) return;
    const now = context.currentTime;
    const notes = type === "open"
      ? [440, 660]
      : type === "switch"
        ? [640, 420]
        : type === "fridge"
          ? [145, 105]
          : [190];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.055;
      oscillator.type = type === "switch" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(type === "open" ? 0.018 : 0.012, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
  }

  /* 拟真开门：锁舌咔哒 → 门轴吱呀（带颤音与随机性）→ 门缝气流 */
  function playDoorSound() {
    if (!soundEnabled) return;
    const context = ensureAudio();
    if (!context) return;
    const now = context.currentTime;

    /* 1) 锁舌咔哒：短促方波 + 高频噪声瞬态 */
    const latch = context.createOscillator();
    const latchGain = context.createGain();
    latch.type = "square";
    latch.frequency.setValueAtTime(920, now);
    latch.frequency.exponentialRampToValueAtTime(340, now + 0.07);
    latchGain.gain.setValueAtTime(0.0001, now);
    latchGain.gain.linearRampToValueAtTime(0.05, now + 0.008);
    latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    latch.connect(latchGain).connect(context.destination);
    latch.start(now); latch.stop(now + 0.11);

    /* 2) 门轴吱呀：锯齿波带 vibrato + 带通噪声，音调每次略有随机 */
    const creakHz = 190 + Math.random() * 60;
    const creak = context.createOscillator();
    const creakGain = context.createGain();
    creak.type = "sawtooth";
    creak.frequency.setValueAtTime(creakHz, now + 0.05);
    creak.frequency.linearRampToValueAtTime(creakHz + 140, now + 0.62);
    const vibrato = context.createOscillator();
    const vibratoGain = context.createGain();
    vibrato.frequency.value = 6 + Math.random() * 3;
    vibratoGain.gain.value = 18;
    vibrato.connect(vibratoGain).connect(creak.frequency);
    const creakFilter = context.createBiquadFilter();
    creakFilter.type = "bandpass";
    creakFilter.frequency.setValueAtTime(creakHz * 1.6, now + 0.05);
    creakFilter.frequency.linearRampToValueAtTime((creakHz + 140) * 1.6, now + 0.62);
    creakFilter.Q.value = 1.4;
    const creakFiltered = context.createGain();
    creakGain.gain.setValueAtTime(0.0001, now + 0.05);
    creakGain.gain.linearRampToValueAtTime(0.026, now + 0.12);
    creakGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.68);
    creak.connect(creakFilter).connect(creakGain).connect(context.destination);
    vibrato.start(now + 0.05); vibrato.stop(now + 0.7);
    creak.start(now + 0.05); creak.stop(now + 0.72);

    /* 3) 门缝气流：低通噪声扫频 */
    const frameCount = Math.ceil(context.sampleRate * 0.55);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.55 + white * 0.45;
      data[index] = previous * (0.6 + Math.sin((index / frameCount) * Math.PI) * 0.4);
    }
    const source = context.createBufferSource();
    const whoosh = context.createBiquadFilter();
    const whooshGain = context.createGain();
    source.buffer = buffer;
    whoosh.type = "lowpass";
    whoosh.frequency.setValueAtTime(1500, now + 0.06);
    whoosh.frequency.exponentialRampToValueAtTime(280, now + 0.62);
    whooshGain.gain.setValueAtTime(0.0001, now + 0.06);
    whooshGain.gain.linearRampToValueAtTime(0.022, now + 0.18);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    source.connect(whoosh).connect(whooshGain).connect(context.destination);
    source.start(now + 0.06); source.stop(now + 0.66);
  }

  /* 拟真颠球：单次低频撞击声 */
  function playBounceSound() {
    if (!soundEnabled) return;
    const context = ensureAudio();
    if (!context) return;
    const now = context.currentTime;

    const thump = (at, volume) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(115, at);
      oscillator.frequency.exponentialRampToValueAtTime(42, at + 0.13);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(volume, at + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at); oscillator.stop(at + 0.16);

      /* 撞击瞬间的轻微噪声毛刺，增加真实感 */
      const burst = context.createBufferSource();
      const burstBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.03), context.sampleRate);
      const burstData = burstBuffer.getChannelData(0);
      for (let index = 0; index < burstData.length; index += 1) {
        burstData[index] = (Math.random() * 2 - 1) * (1 - index / burstData.length);
      }
      const burstFilter = context.createBiquadFilter();
      const burstGain = context.createGain();
      burst.buffer = burstBuffer;
      burstFilter.type = "highpass";
      burstFilter.frequency.value = 700;
      burstGain.gain.setValueAtTime(volume * 0.4, at);
      burstGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      burst.connect(burstFilter).connect(burstGain).connect(context.destination);
      burst.start(at);
    };

    thump(now, 0.09);   // 单次落地声
  }

  function listMarkup(items, type) {
    if (!items || items.length === 0) {
      return '<div class="panel-static-item"><strong>内容正在整理</strong><small>可以先从 About Me 或博客继续了解。</small></div>';
    }
    return `<ul class="panel-list">${items.slice(0, 6).map((item) => {
      if (typeof item === "string") return `<li><div class="panel-static-item"><strong>${item}</strong></div></li>`;
      const title = item.title || item.name || "未命名内容";
      const meta = type === "posts" ? (item.date || "") : (item.tag || item.desc || "");
      if (!item.url) return `<li><div class="panel-static-item"><strong>${title}</strong>${meta ? `<small>${meta}</small>` : ""}</div></li>`;
      const external = /^https?:/.test(item.url);
      return `<li><a href="${item.url}"${external ? ' target="_blank" rel="noopener"' : ""}><strong>${title}${external ? " ↗" : ""}</strong>${meta ? `<small>${meta}</small>` : ""}</a></li>`;
    }).join("")}</ul>`;
  }

  function panelMarkup(id) {
    if (id === "blog") return `${listMarkup(siteData.posts, "posts")}<a class="panel-primary-link" href="/posts/">查看全部文章 →</a>`;
    if (id === "projects") return `${listMarkup(siteData.projects, "projects")}<a class="panel-primary-link" href="https://github.com/HOWILLMAKEIT">GitHub 项目主页 →</a>`;
    if (id === "honors") return `${listMarkup(siteData.honors, "honors")}<a class="panel-primary-link" href="/about/">查看完整履历 →</a>`;
    if (id === "links") {
      const linkItems = (siteData.links || []).map((item) => `<li><a href="${item.url}"><strong>${item.name}</strong>${item.sub ? `<small>${item.sub}</small>` : ""}</a></li>`).join("");
      return `<ul class="panel-list">${linkItems}</ul><a class="panel-primary-link"`;
    }
    if (id === "experience") return '<ul class="panel-list"><li><div class="panel-static-item"><strong>大型央企 · 内部代码审查 Agent</strong><small>2026.07 — 2026.08 · 面向企业内网研发场景，负责仓库级代码审查 Agent 的方案设计与工程落地，覆盖多文件审查、工具调用闭环与结构化评论生成，已部署至内网试用。</small></div></li><li><div class="panel-static-item"><strong>广州骑士集团 · AI 算法工程师</strong><small>2026.04 — 2026.06 · 服务年销超 20 亿元、粉丝超 300 万的头部内衣品牌 LUCKMEEY 幸棉（赵露思代言）：搭建 Benchmark 与 Agent 评测体系，迭代提示词与架构，落地 Function Calling 商品推荐；上线后独立接待率与转化率显著提升。</small></div></li><li><div class="panel-static-item"><strong>未完待续 ……</strong><small>下一段经历正在路上。</small></div></li></ul><a class="panel-primary-link" href="/about/">阅读个人经历 →</a>';
    return '<ul class="panel-list"><li><div class="panel-static-item"><strong>华南理工大学 · 计算机科学与工程学院</strong><small>网络工程本科 · 2023.09 — 2027.06</small></div></li><li><div class="panel-static-item"><strong>华南理工大学 · 计算机科学与工程学院</strong><small>计算机科学硕士 · 2027.09 — 2030.06</small></div></li><li><div class="panel-static-item"><strong>强化学习 · 智能优化 · LLM 与 Agent</strong></div></li></ul><a class="panel-primary-link" href="/about/">进入 About Me →</a>';
  }

  function openPanel(id) {
    const copy = objectCopy[id];
    if (!copy) return;
    document.getElementById("room-panel-eyebrow").textContent = copy.eyebrow;
    document.getElementById("room-panel-title").textContent = copy.title;
    document.getElementById("room-panel-lead").textContent = copy.lead;
    document.getElementById("room-panel-content").innerHTML = panelMarkup(id);
    const panel = document.getElementById("room-panel");
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    playCue("open");
  }

  function closePanel(returnToOverview) {
    const panel = document.getElementById("room-panel");
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    if (returnToOverview) setCameraPreset("overview", false);
  }

  function focusObject(id) {
    const item = interactiveObjects.find((entry) => entry.id === id);
    if (!item) return;
    if (item.cameraPreset) setCameraPreset(item.cameraPreset, false);
    if (item.interact) {
      if (item.id.includes("window")) {
        playObjectSound("window-open");
      } else if (item.id.includes("chair")) {
        playObjectSound("office-chair-roll");
      } else if (
        !item.id.includes("bed")
        && !item.id.includes("fridge")
        && !item.id.includes("curtain")
        && !item.id.includes("air-conditioner")
        && item.id !== "ac"
      ) {
        playCue("soft");
      }
      item.interact();
      return;
    }
    if (id === "door") {
      playDoorSound();
      window.setTimeout(() => { window.location.href = "/about/"; }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 80 : 520);
      return;
    }
    window.setTimeout(() => openPanel(id), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280);
  }

  function setCameraPreset(name, immediate) {
    const preset = window.innerWidth <= 760 && name === "overview"
      ? cameraPresets.mobile
      : cameraPresets[name];
    if (!preset) return;

    activePreset = name;
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.position.copy(preset.position);
      cameraTarget.copy(preset.target);
      camera.zoom = responsiveZoom(preset.zoom);
      camera.updateProjectionMatrix();
      transition = null;
      return;
    }

    transition = {
      startedAt: performance.now(),
      duration: 720,
      fromPosition: camera.position.clone(),
      toPosition: preset.position.clone(),
      fromTarget: cameraTarget.clone(),
      toTarget: preset.target.clone(),
      fromZoom: camera.zoom,
      toZoom: responsiveZoom(preset.zoom),
    };
  }

  function responsiveZoom(zoom) {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    if (window.innerWidth <= 760) return zoom * 0.72;
    if (aspect > 1.8) return zoom * 1.08;
    return zoom;
  }

  function easeInOutCubic(value) {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width <= 760 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    const halfHeight = 5.35;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    if (activePreset === "overview") setCameraPreset("overview", true);
  }

  function render(now) {
    const elapsed = clock.getElapsedTime();

    stepTweens(now);

    if (transition) {
      const progress = Math.min((now - transition.startedAt) / transition.duration, 1);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
      cameraTarget.lerpVectors(transition.fromTarget, transition.toTarget, eased);
      camera.zoom = THREE.MathUtils.lerp(transition.fromZoom, transition.toZoom, eased);
      camera.updateProjectionMatrix();
      if (progress === 1) transition = null;
    }

    interactiveObjects.forEach(({ highlight, edgeMaterial, outerEdgeMaterial }, index) => {
      if (!highlight.visible) return;
      const pulse = (Math.sin(elapsed * 3.2 + index * 0.4) + 1) / 2;
      edgeMaterial.opacity = 0.78 + pulse * 0.22;
      outerEdgeMaterial.opacity = 0.18 + pulse * 0.2;
      highlight.scale.setScalar(1 + pulse * 0.008);
    });

    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById("room-tooltip");

  function objectFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(interactiveObjects.map((item) => item.proxy), false);
    if (!intersections.length) return null;
    const id = intersections[0].object.userData.roomObjectId;
    return interactiveObjects.find((item) => item.id === id) || null;
  }

  canvas.addEventListener("pointermove", (event) => {
    const item = objectFromPointer(event);
    canvas.style.cursor = item ? "pointer" : "default";
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
    tooltip.textContent = item ? item.label : "";
    tooltip.classList.toggle("is-visible", Boolean(item));
    interactiveObjects.forEach((entry) => {
      entry.highlight.visible = Boolean(item && entry.id === item.id);
    });
    hoveredObject = item ? item.id : null;
  });

  canvas.addEventListener("pointerleave", () => {
    hoveredObject = null;
    interactiveObjects.forEach((entry) => { entry.highlight.visible = false; });
    tooltip.classList.remove("is-visible");
  });

  canvas.addEventListener("click", (event) => {
    const item = objectFromPointer(event);
    if (item) focusObject(item.id);
  });

  const overviewButton = document.querySelector("[data-action='overview']");
  if (overviewButton) overviewButton.addEventListener("click", () => closePanel(true));
  /* 浏览器自动播放策略：音频需一次用户手势解锁，默认音效开启，首次点击即激活 */
  window.addEventListener("pointerdown", () => ensureAudio(), { once: true, passive: true });
  document.querySelector(".panel-close").addEventListener("click", () => closePanel(true));
  document.querySelectorAll("[data-room-object]").forEach((button) => {
    button.addEventListener("click", () => focusObject(button.dataset.roomObject));
  });
  document.getElementById("sound-toggle").addEventListener("click", (event) => {
    soundEnabled = !soundEnabled;
    event.currentTarget.textContent = soundEnabled ? "音效开" : "音效关";
    event.currentTarget.setAttribute("aria-pressed", String(soundEnabled));
    if (soundEnabled) {
      ensureAudio();
      playCue("switch");
    } else {
      stopObjectSounds();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel(true);
  });

  window.addEventListener("resize", resize, { passive: true });

  window.addEventListener("storage", (event) => {
    if (event.key === roomThemeStorageKey && event.newValue) {
      setRoomNight(event.newValue === "dark", false);
    }
  });

  resize();
  restoreRoomTheme();
  setCameraPreset("overview", true);
  loadSiteData();
  requestAnimationFrame(render);
  requestAnimationFrame(() => document.body.classList.add("is-ready"));
}());
