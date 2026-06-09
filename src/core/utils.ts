/* Helpers genéricos compartidos por todas las fases */

export const rand = (min: number, max: number) => Math.random() * (max - min) + min
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const inRect = (px: number, py: number, r: { x: number; y: number; w: number; h: number }) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h

export function formatNum(n: number): string {
  if (n < 1000) return Math.floor(n).toString()
  const u = ['', 'K', 'M', 'B', 'T']
  let i = 0
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++ }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i]
}
