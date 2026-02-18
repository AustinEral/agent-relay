/**
 * Deep Sea Particles — minimal marine-snow / bioluminescent debris
 * Slow drift with gentle wave motion. Very subtle.
 */

interface Particle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  drift: number;     // horizontal drift speed
  sink: number;      // vertical drift speed (sinking)
  phase: number;     // wave phase offset
  waveAmp: number;   // wave amplitude
  waveFreq: number;  // wave frequency
}

export function initDeepSea(): void {
  const canvas = document.getElementById('deep-sea') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let particles: Particle[] = [];
  let w = 0;
  let h = 0;
  let animId: number;

  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = document.documentElement.clientWidth;
    // On mobile, use screen height to completely avoid address bar resize thrash
    h = isMobile ? screen.height : window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createParticles() {
    // ~1 particle per 12000px² — very sparse
    const count = Math.floor((w * h) / 12000);
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: Math.random() * 1.8 + 0.4,
        opacity: Math.random() * 0.35 + 0.05,
        drift: (Math.random() - 0.5) * 0.15,
        sink: Math.random() * 0.12 + 0.03,
        phase: Math.random() * Math.PI * 2,
        waveAmp: Math.random() * 12 + 4,
        waveFreq: Math.random() * 0.0008 + 0.0003,
      });
    }
  }

  function draw(time: number) {
    ctx!.clearRect(0, 0, w, h);

    for (const p of particles) {
      // Gentle wave on x
      const wx = Math.sin(time * p.waveFreq + p.phase) * p.waveAmp;

      const px = p.x + wx;
      const py = p.y;

      // Teal-white color for that bioluminescent look
      ctx!.beginPath();
      ctx!.arc(px, py, p.size, 0, Math.PI * 2);
      ctx!.fillStyle = `rgba(140, 210, 220, ${p.opacity})`;
      ctx!.fill();

      // Very faint glow on larger particles
      if (p.size > 1.2) {
        ctx!.beginPath();
        ctx!.arc(px, py, p.size * 3, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(120, 200, 210, ${p.opacity * 0.12})`;
        ctx!.fill();
      }

      // Update position — slow drift
      p.x += p.drift;
      p.y += p.sink;

      // Wrap around
      if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
      if (p.x < -20) p.x = w + 20;
      if (p.x > w + 20) p.x = -20;
    }

    animId = requestAnimationFrame(draw);
  }

  resize();
  createParticles();
  animId = requestAnimationFrame(draw);

  // Debounce resize — don't recreate particles, just rescale canvas.
  // Particles that end up out of bounds will naturally wrap back in.
  let resizeTimer: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const newW = document.documentElement.clientWidth;
      const newH = Math.max(document.documentElement.clientHeight, window.innerHeight);
      // Skip if dimensions haven't actually changed (mobile address bar noise)
      if (newW === w && newH === h) return;
      const oldW = w;
      const oldH = h;
      resize();
      // Scale existing particle positions proportionally instead of recreating
      if (oldW && oldH) {
        for (const p of particles) {
          p.x = (p.x / oldW) * w;
          p.y = (p.y / oldH) * h;
        }
      }
    }, 150);
  });

  // Pause when tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(animId);
    } else {
      animId = requestAnimationFrame(draw);
    }
  });
}
