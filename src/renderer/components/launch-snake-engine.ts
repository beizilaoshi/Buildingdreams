export interface Pixel { x: number; y: number }
export class SnakeField {
  body: Pixel[]; food: Pixel[] = []; eaten = 0; private priority?: Pixel;
  constructor(public cols: number, public rows: number, private random = Math.random) {
    this.body = Array.from({ length: 12 }, (_, i) => ({ x: Math.max(0, Math.floor(cols / 2) - i), y: Math.floor(rows / 2) })); this.scatter();
  }
  private scatter() { while (this.food.length < Math.min(64, Math.max(45, Math.floor(this.cols * this.rows / 70)))) this.food.push({ x: Math.floor(this.random() * this.cols), y: Math.floor(this.random() * this.rows) }); }
  feed(x: number, y: number) { this.priority = { x: Math.max(0, Math.min(this.cols - 1, Math.floor(x))), y: Math.max(0, Math.min(this.rows - 1, Math.floor(y))) }; this.food.unshift(this.priority); this.food.length = Math.min(80, this.food.length); }
  resize(cols: number, rows: number) {
    const oldCols = this.cols, oldRows = this.rows;
    this.cols = Math.max(1, cols); this.rows = Math.max(1, rows);
    // Priority food shares its object with food; transform each coordinate only once.
    for (const p of new Set([...this.body, ...this.food, ...(this.priority ? [this.priority] : [])])) {
      p.x = Math.min(this.cols - 1, Math.floor(p.x / oldCols * this.cols));
      p.y = Math.min(this.rows - 1, Math.floor(p.y / oldRows * this.rows));
    }
  }
  step() {
    const head = this.body[0];
    const target = this.priority ?? this.food.reduce((a, b) => Math.abs(a.x - head.x) + Math.abs(a.y - head.y) <= Math.abs(b.x - head.x) + Math.abs(b.y - head.y) ? a : b);
    const next = { ...head }; if (next.x !== target.x) next.x += Math.sign(target.x - next.x); else next.y += Math.sign(target.y - next.y);
    this.body.unshift(next); const found = this.food.findIndex(p => p.x === next.x && p.y === next.y);
    if (found >= 0) { this.food.splice(found, 1); this.eaten++; if (this.priority?.x === next.x && this.priority.y === next.y) this.priority = undefined; } else this.body.pop();
    this.body.length = Math.min(30, this.body.length); this.scatter();
  }
}
