/* ============================================================
   RoomAudio —— 线稿书房的 Web Audio 合成音效引擎
   全部音效由振荡器 / 噪声实时合成，无外部音频文件。
   视觉风格致敬 pure-line-room（Apache-2.0），音频为独立实现。
   ============================================================ */
window.RoomAudio = (function () {
  'use strict';
  function savedSoundOn() {
    try { return localStorage.getItem('howill-room-sound') === 'on'; }
    catch (e) { return false; }
  }
  let ctx = null, master = null, compressor = null, noiseBuffer = null;
  let muted = !savedSoundOn(), unlocked = false;
  const loopNodes = {};   // name -> {gains:[], stop:fn, timer}
  const loopWanted = {};  // name -> bool

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(function () {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.42;
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.22;
    master.connect(compressor); compressor.connect(ctx.destination);
    const len = 2 * ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function unlock() {
    if (ensure()) unlocked = true;
    // 恢复此前被请求但尚未启动的循环音
    for (const k in loopWanted) if (loopWanted[k]) loop(k, true);
  }

  function now() { return ctx ? ctx.currentTime : 0; }
  const mf = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };

  /* 基础单元：单音 */
  function tone(o) {
    if (!ctx || muted) return;
    const t = o.t !== undefined ? o.t : now();
    const os = ctx.createOscillator(), g = ctx.createGain();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f0, t);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.dur || 0.2));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.g || 0.12, t + (o.a || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.2));
    os.connect(g); g.connect(master);
    os.start(t); os.stop(t + (o.dur || 0.2) + 0.05);
  }

  /* 基础单元：滤波噪声 */
  function noise(o) {
    if (!ctx || muted) return;
    const t = o.t !== undefined ? o.t : now();
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 800, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + (o.dur || 0.2));
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.g || 0.08, t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || 0.25));
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + (o.dur || 0.25) + 0.05);
  }

  /* 门轴吱呀 */
  function squeak(dir) {
    if (!ctx || muted) return;
    const t = now();
    const o = ctx.createOscillator(); o.type = 'triangle';
    const f0 = dir > 0 ? 420 : 700, f1 = dir > 0 ? 760 : 480;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + 0.55);
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.value = 22;
    vib.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(master);
    o.start(t); vib.start(t); o.stop(t + 0.65); vib.stop(t + 0.65);
  }

  /* ---- 一次性音效 ---- */
  const SFX = {
    door: function () { squeak(1); noise({ f: 300, f1: 900, dur: 0.5, g: 0.03, q: 2 }); },
    doorClose: function () { squeak(-1); tone({ f0: 95, f1: 55, dur: 0.12, g: 0.16, type: 'triangle' }); noise({ f: 200, dur: 0.1, g: 0.06 }); },
    windowOpen: function () { squeak(1); },
    windowClose: function () { squeak(-1); tone({ f0: 140, f1: 90, dur: 0.08, g: 0.09, type: 'triangle' }); },
    blindsUp: function () { for (let i = 0; i < 7; i++) noise({ t: now() + i * 0.035, f: 1600 + i * 300, dur: 0.05, g: 0.035, q: 3 }); },
    blindsDown: function () { for (let i = 0; i < 7; i++) noise({ t: now() + i * 0.03, f: 3400 - i * 350, dur: 0.05, g: 0.035, q: 3 }); },
    drawerOut: function () { noise({ f: 500, f1: 200, dur: 0.3, g: 0.05, q: 1 }); tone({ f0: 180, f1: 120, dur: 0.25, g: 0.04, type: 'triangle' }); },
    drawerIn: function () { noise({ f: 250, f1: 600, dur: 0.25, g: 0.05, q: 1 }); tone({ f0: 130, f1: 85, dur: 0.07, g: 0.1, type: 'triangle' }); },
    lamp: function () { tone({ f0: 1200, f1: 700, dur: 0.05, g: 0.1, type: 'square' }); },
    mug: function () { tone({ f0: 1500, f1: 1100, dur: 0.09, g: 0.07, type: 'sine' }); tone({ t: now() + 0.09, f0: 900, dur: 0.12, g: 0.05 }); },
    chair: function () { noise({ f: 350, f1: 150, dur: 0.4, g: 0.05 }); },
    book: function () { noise({ f: 2600, dur: 0.14, g: 0.07, q: 0.8 }); noise({ t: now() + 0.12, f: 1800, dur: 0.1, g: 0.05, q: 0.8 }); },
    pageTurn: function () { noise({ f: 3000, f1: 1200, dur: 0.22, g: 0.06, q: 0.7 }); },
    switchOn: function () { tone({ f0: 800, f1: 300, dur: 0.04, g: 0.12, type: 'square' }); },
    switchOff: function () { tone({ f0: 300, f1: 800, dur: 0.04, g: 0.12, type: 'square' }); },
    clockToggle: function () { tone({ f0: 600, dur: 0.06, g: 0.05, type: 'triangle' }); },
    tick: function () { tone({ f0: 950, dur: 0.03, g: 0.045, type: 'square' }); },
    tock: function () { tone({ f0: 720, dur: 0.035, g: 0.045, type: 'square' }); },
    trophy: function () {
      const base = [76, 81, 85, 88];
      base.forEach(function (m, i) { tone({ t: now() + i * 0.09, f0: mf(m), dur: 0.3, g: 0.06 }); });
    },
    chime: function () { [81, 85, 88].forEach(function (m, i) { tone({ t: now() + i * 0.12, f0: mf(m), dur: 0.6, g: 0.05 }); }); },
    globe: function () { tone({ f0: 300, f1: 900, dur: 0.5, g: 0.05, type: 'sine' }); },
    plant: function () { noise({ f: 900, f1: 500, dur: 0.25, g: 0.04, q: 0.6 }); },
    pillow: function () { noise({ f: 400, f1: 150, dur: 0.3, g: 0.06, q: 0.5 }); },
    ball: function () { tone({ f0: 330, f1: 220, dur: 0.09, g: 0.12, type: 'sine' }); },
    cat: function () {
      // 猫：短促的咕噜声
      tone({ f0: 340, f1: 300, dur: 0.5, g: 0.07, type: 'sine', a: 0.08 });
      tone({ f0: 680, f1: 600, dur: 0.5, g: 0.02, type: 'sine', a: 0.08 });
    },
    recordArm: function () { tone({ f0: 500, f1: 250, dur: 0.15, g: 0.06, type: 'triangle' }); },
    click: function () { tone({ f0: 1100, f1: 800, dur: 0.035, g: 0.06, type: 'triangle' }); },
    close: function () { tone({ f0: 700, f1: 1000, dur: 0.05, g: 0.05, type: 'triangle' }); }
  };
  SFX.hover = function () { tone({ f0: 1180, f1: 1040, dur: 0.028, g: 0.018, type: 'sine' }); };
  SFX.welcome = function () {
    [72, 76, 79].forEach(function (m, i) { tone({ t: now() + i * 0.075, f0: mf(m), dur: 0.45, g: 0.035, type: 'sine' }); });
  };

  /* ---- 循环音 ---- */
  function mkNoiseLoop(cfg) {
    // 返回 {stop}，向 g 淡入
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = cfg.type || 'bandpass';
    f.frequency.value = cfg.f; f.Q.value = cfg.q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now());
    g.gain.linearRampToValueAtTime(cfg.g, now() + (cfg.a || 0.6));
    s.connect(f); f.connect(g); g.connect(master);
    s.start();
    return {
      gain: g,
      stop: function () {
        const t = now();
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        s.stop(t + 0.5);
      }
    };
  }

  /* 黑胶上的小旋律：C 大调五声音阶生成式琶音 */
  let melodyTimer = null;
  const SCALE = [72, 74, 76, 79, 81, 84, 81, 79, 76, 74, 76, 79];
  let melodyIdx = 0;
  function melodyStep() {
    if (muted || !ctx) return;
    const m = SCALE[melodyIdx % SCALE.length]; melodyIdx++;
    tone({ f0: mf(m), dur: 0.4, g: 0.045, type: 'triangle' });
    if (melodyIdx % 4 === 1) tone({ f0: mf(m - 24), dur: 0.6, g: 0.03, type: 'sine' });
    melodyTimer = setTimeout(melodyStep, 430);
  }

  function loop(name, on) {
    loopWanted[name] = on;
    if (!ctx || muted) { if (!on && loopNodes[name]) { kill(name); } return; }
    if (on && !loopNodes[name]) {
      if (name === 'steam') loopNodes[name] = mkNoiseLoop({ f: 5000, q: 0.6, g: 0.006, a: 1.2 });
      else if (name === 'hum') loopNodes[name] = (function () {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 118;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 236;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now());
        g.gain.linearRampToValueAtTime(0.012, now() + 0.8);
        o.connect(g); o2.connect(g); const g2 = ctx.createGain(); g2.gain.value = 0.3; o2.connect(g2); g2.connect(g);
        g.connect(master); o.start(); o2.start();
        return { stop: function () { const t = now(); g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.stop(t + 0.5); o2.stop(t + 0.5); } };
      })();
      else if (name === 'fan') loopNodes[name] = mkNoiseLoop({ f: 260, q: 0.4, g: 0.02, a: 1.5 });
      else if (name === 'chimes') loopNodes[name] = (function () {
        let alive = true;
        (function hit() {
          if (!alive || muted || !ctx) return;
          tone({ f0: mf([84, 88, 91, 96][Math.floor(Math.random() * 4)]), dur: 1.4, g: 0.02, a: 0.01 });
          setTimeout(hit, 1400 + Math.random() * 2600);
        })();
        return { stop: function () { alive = false; } };
      })();
      else if (name === 'plantSway') loopNodes[name] = mkNoiseLoop({ f: 700, q: 0.4, g: 0.004, a: 2 });
      else if (name === 'vinyl') loopNodes[name] = mkNoiseLoop({ f: 3200, q: 0.3, g: 0.012, a: 0.8 });
      else if (name === 'melody') { melodyIdx = 0; melodyTimer = setTimeout(melodyStep, 200); loopNodes[name] = { stop: function () { clearTimeout(melodyTimer); } }; }
      else if (name === 'dayAmb') loopNodes[name] = mkNoiseLoop({ f: 900, q: 0.25, g: 0.006, a: 3 });
      else if (name === 'nightAmb') loopNodes[name] = mkNoiseLoop({ f: 350, q: 0.2, g: 0.008, a: 3 });
      else if (name === 'purr') loopNodes[name] = (function () {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
        const am = ctx.createOscillator(); am.frequency.value = 24;
        const amg = ctx.createGain(); amg.gain.value = 0.5;
        const base = ctx.createGain(); base.gain.value = 0.5;
        am.connect(amg);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now());
        g.gain.linearRampToValueAtTime(0.03, now() + 0.5);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
        o.connect(lp); base.gain.value = 1; lp.connect(base);
        amg.connect(base.gain);
        base.connect(g); g.connect(master);
        o.start(); am.start();
        return { stop: function () { const t = now(); g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4); o.stop(t + 0.5); am.stop(t + 0.5); } };
      })();
    } else if (!on && loopNodes[name]) kill(name);
  }
  function kill(name) {
    const n = loopNodes[name];
    if (n) { try { n.stop(); } catch (e) {} delete loopNodes[name]; }
  }

  function sfx(name) {
    if (!ctx || muted) return;
    if (SFX[name]) SFX[name]();
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('howill-room-sound', m ? 'off' : 'on'); } catch (e) {}
    if (master) master.gain.linearRampToValueAtTime(m ? 0 : 0.42, now() + 0.18);
    if (m) { for (const k in loopNodes) kill(k); }
    else if (unlocked) { for (const k in loopWanted) if (loopWanted[k]) loop(k, true); }
  }

  return {
    unlock: unlock,
    sfx: sfx,
    loop: loop,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    isUnlocked: function () { return unlocked; }
  };
})();
