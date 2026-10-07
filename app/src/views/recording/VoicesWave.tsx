// The "two voices" line: one continuous wave from teal (you) to violet (the
// other side), flat at the edges, two lobes with a node in the middle. Each
// lobe follows its side's real loudness when the recorder reports it (mic on
// the left, the PC's audio on the right): a side that stays flat is a side
// Mori is not hearing. Still when the user asks for less motion.
import { useEffect, useRef } from "react";

export default function VoicesWave({
  width = 140,
  height = 26,
  mic,
  sys,
}: {
  width?: number;
  height?: number;
  /** 0…1 loudness of each side; undefined = no numbers yet, a calm breathing. */
  mic?: number;
  sys?: number;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const gid = useRef(`vw-${Math.random().toString(36).slice(2, 8)}`).current;
  // Targets come from props twice a second; the drawn amplitude eases toward
  // them every frame, so the line moves like a voice and not in steps.
  const target = useRef({ mic: 0.7, sys: 0.7 });
  target.current = { mic: mic ?? 0.7, sys: sys ?? 0.7 };
  const shown = useRef({ mic: 0.7, sys: 0.7 });

  useEffect(() => {
    const W = width, H = height, mid = H / 2, N = 110, CYCLES = 9, AMP = H * 0.4;
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const draw = (t: number) => {
      let d = "";
      for (let i = 0; i <= N; i++) {
        const x = i / N;
        const win = smooth(0.04, 0.2, x) * smooth(0.04, 0.2, 1 - x);
        const dip = 1 - 0.6 * Math.exp(-Math.pow((x - 0.5) / 0.08, 2));
        // Left lobe: you; right lobe: the other side; blended across the node.
        const side = smooth(0.42, 0.58, x);
        const level = 0.08 + 0.92 * (shown.current.mic * (1 - side) + shown.current.sys * side);
        const y = mid + win * dip * level * AMP * Math.sin(x * CYCLES * 2 * Math.PI - t * 3.2);
        d += (i === 0 ? "M " : " L ") + (x * W).toFixed(1) + " " + y.toFixed(2);
      }
      pathRef.current?.setAttribute("d", d);
    };
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      draw(0.6);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = 0.12; // easing per frame
      shown.current.mic += (target.current.mic - shown.current.mic) * k;
      shown.current.sys += (target.current.sys - shown.current.sys) * k;
      draw((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);

  return (
    <svg className="voices-wave" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "var(--accent-bright)" }} />
          <stop offset="1" style={{ stopColor: "var(--accent-2-bright)" }} />
        </linearGradient>
      </defs>
      <path ref={pathRef} d={`M 0 ${height / 2} L ${width} ${height / 2}`} fill="none" stroke={`url(#${gid})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
