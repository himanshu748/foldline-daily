interface HingePosition {
  index: number;
  x: number;
  y: number;
}

export function separateHinges(
  positions: readonly HingePosition[],
  width: number,
  height: number
): HingePosition[] {
  const left = Math.min(14, width / 2);
  const top = Math.min(14, height / 2);
  const right = Math.max(left, width - 14);
  const bottom = Math.max(top, height - 14);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const placed: HingePosition[] = [];

  for (const position of [...positions].sort((a, b) => a.index - b.index)) {
    let x = clamp(position.x, left, right);
    let y = clamp(position.y, top, bottom);
    let attempts = 0;
    let collision = placed.find((other) => Math.hypot(x - other.x, y - other.y) < 26);
    while (collision && attempts++ < 100) {
      const dx = x - collision.x;
      const dy = y - collision.y;
      const distance = Math.hypot(dx, dy);
      x = clamp(collision.x + (distance ? (dx / distance) * 28 : 0), left, right);
      y = clamp(collision.y + (distance ? (dy / distance) * 28 : 28), top, bottom);
      collision = placed.find((other) => Math.hypot(x - other.x, y - other.y) < 26);
    }
    if (collision) {
      let bestDistance = Infinity;
      for (let candidateY = top; candidateY <= bottom; candidateY += 28) {
        for (let candidateX = left; candidateX <= right; candidateX += 28) {
          if (placed.some((other) => Math.hypot(candidateX - other.x, candidateY - other.y) < 26))
            continue;
          const distance = Math.hypot(candidateX - position.x, candidateY - position.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            x = candidateX;
            y = candidateY;
          }
        }
      }
    }
    placed.push({ index: position.index, x, y });
  }
  return placed;
}
