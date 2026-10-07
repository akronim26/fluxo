import { useEffect, useRef } from 'react';

const glyphs = ['·', '┐', '░', '│', '─', '┘', '+', '▪'];
// Sphere geometry stays fixed; each frame only applies a rotation.
const points = Array.from({ length: 34 }, (_, row) => {
  const lat = row + 1, phi = Math.PI * lat / 35;
  const ring = Math.sin(phi), y = Math.cos(phi), count = Math.round(90 * ring);
  return Array.from({ length: count }, (_, lng) => {
    const theta = 2 * Math.PI * lng / count;
    return { x: ring * Math.cos(theta), y, z: ring * Math.sin(theta), glyph: (lat * 7 + lng * 3) % glyphs.length };
  });
}).flat();

/** Decorative, deterministic ASCII sphere; pauses off screen and in hidden tabs. */
export function AsciiGlobe({ small = false }: { small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const context = canvas.getContext('2d');
    if (!context) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const atlas = document.createElement('canvas');
    const atlasContext = atlas.getContext('2d');
    if (!atlasContext) return;
    let visible = false, frame = 0, previous = 0, angle = 0;
    let size = 0, ratio = 1, cell = 0, disposed = false;

    const buildAtlas = () => {
      const fontSize = Math.max(8, size / 65);
      cell = Math.ceil(fontSize * 2 * ratio);
      atlas.width = cell * glyphs.length;
      atlas.height = cell;
      atlasContext.font = `${fontSize * ratio}px 'JetBrains Mono Variable', monospace`;
      atlasContext.textAlign = 'center';
      atlasContext.textBaseline = 'middle';
      atlasContext.fillStyle = '#2d2a25';
      glyphs.forEach((glyph, i) => atlasContext.fillText(glyph, (i + .5) * cell, cell / 2));
    };
    const paint = () => {
      if (!size) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size, size);
      const radius = size * .43, center = size / 2, glyphSize = cell / ratio;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (const point of points) {
        const x = point.x * cos - point.z * sin;
        const z = point.x * sin + point.z * cos;
        const tiltY = point.y * .94 - z * .34, tiltZ = point.y * .34 + z * .94;
        if (tiltZ <= -.3) continue;
        // Fade through the silhouette instead of popping glyphs in and out.
        const edge = Math.min(1, (tiltZ + .3) / .2);
        context.globalAlpha = (.09 + Math.max(0, tiltZ) * .28) * edge * edge * (3 - 2 * edge);
        context.drawImage(atlas, point.glyph * cell, 0, cell, cell,
          center + x * radius - glyphSize / 2, center + tiltY * radius - glyphSize / 2, glyphSize, glyphSize);
      }
      context.globalAlpha = 1;
    };
    const canAnimate = () => visible && size > 0 && !document.hidden && !motion.matches;
    const draw = (time: number) => {
      frame = 0;
      if (!canAnimate()) { previous = 0; return; }
      // Time-based speed is consistent on both 60 Hz and 120 Hz displays.
      if (previous) angle = (angle + Math.min(time - previous, 64) * .000045) % (Math.PI * 2);
      previous = time;
      paint();
      frame = requestAnimationFrame(draw);
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; previous = 0;
      if (visible && !document.hidden) paint();
      if (canAnimate()) frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      size = canvas.clientWidth;
      ratio = Math.min(devicePixelRatio, 2);
      const pixels = Math.round(size * ratio);
      if (canvas.width !== pixels || canvas.height !== pixels) {
        canvas.width = pixels; canvas.height = pixels;
        buildAtlas();
      }
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    const resizeObserver = new ResizeObserver(resize);
    resize();
    observer.observe(canvas);
    resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    window.addEventListener('resize', resize, { passive: true });
    void document.fonts.ready.then(() => { if (!disposed) { buildAtlas(); sync(); } });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame); observer.disconnect(); resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return <canvas ref={ref} className={`ascii-globe ${small ? 'ascii-globe-small' : ''}`} aria-hidden="true" />;
}
