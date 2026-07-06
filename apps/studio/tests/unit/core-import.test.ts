import { describe, it, expect } from 'vitest';
import { classifyRisk } from 'wigolo/studio';

// Proves the `wigolo` file:../.. dependency + the `./studio` exports subpath
// resolve the built core from the app workspace (P0 §13.5 locked mechanism).
describe('wigolo/studio subpath resolves the built core', () => {
  it('imports a pure salvaged domain symbol and it works', () => {
    const tier = classifyRisk({ action: 'click', pageUrl: 'https://shop.example.com/checkout' });
    expect(tier).toBe('money');
  });
});
