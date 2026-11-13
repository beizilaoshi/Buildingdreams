import { describe, it, expect } from 'vitest';
import { SnakeField } from '../src/renderer/components/launch-snake-engine';
describe('launch snake field', () => {
  it('prioritizes clicked food and eats it while keeping resources bounded', () => {
    const field = new SnakeField(20, 15, () => .7);
    field.feed(2, 2);
    field.step();
    expect(field.body[0]).toEqual({ x: 9, y: 7 });
    for (let i = 0; i < 60; i++) field.step();
    expect(field.eaten).toBeGreaterThan(0);
    for (let i = 0; i < 500; i++) field.feed(i % 20, i % 15);
    expect(field.food.length).toBeLessThanOrEqual(80);
    expect(field.body.length).toBeLessThanOrEqual(30);
  });
  it('scales the scattered field and clicked target when shrinking', () => {
    const field = new SnakeField(80, 60);
    field.food = Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 20 + 10, y: Math.floor(i / 4) * 15 + 7 }));
    field.feed(70, 52);
    field.resize(40, 30);
    expect(field.food[0]).toEqual({ x: 35, y: 26 });
    expect(field.food.filter(p => p.x === 39 || p.y === 29)).toHaveLength(0);
    expect(new Set(field.food.map(p => Math.floor(p.x / 10) + ':' + Math.floor(p.y / 8))).size).toBeGreaterThanOrEqual(12);
    field.body = [{ x: 34, y: 26 }]; field.step();
    expect(field.eaten).toBe(1);
  });
  it('clamps food and body after a resize', () => {
    const field = new SnakeField(80, 60);
    field.feed(79, 59); field.resize(10, 8);
    expect([...field.food, ...field.body].every(p => p.x >= 0 && p.x < 10 && p.y >= 0 && p.y < 8)).toBe(true);
  });
});
