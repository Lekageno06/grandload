import { describe, expect, it } from 'vitest';

describe('Grandload bootstrap', () => {
  it('initializes the project shell', () => {
    expect('grandload').toBe('grandload');
  });
});
