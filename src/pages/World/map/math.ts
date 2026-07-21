export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export function pseudoRandom(x: number, y: number, seed: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 0.001) * 43758.5453;
  return s - Math.floor(s);
}

export function noise2D(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const topRight = pseudoRandom(xi + 1, yi + 1, seed);
  const topLeft = pseudoRandom(xi, yi + 1, seed);
  const bottomRight = pseudoRandom(xi + 1, yi, seed);
  const bottomLeft = pseudoRandom(xi, yi, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = topLeft + u * (topRight - topLeft);
  const bottom = bottomLeft + u * (bottomRight - bottomLeft);
  return bottom + v * (top - bottom);
}

export function fbm(x: number, y: number, seed: number) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 5; i += 1) {
    value += amplitude * noise2D(x * frequency, y * frequency, seed + i * 79);
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}
