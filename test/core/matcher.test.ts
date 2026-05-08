import { describe, expect, it } from 'vitest';
import { tenantConditionsMatcher } from '../../src/core/matcher.js';

describe('matcher (forward-direction conditions)', () => {
  it('produces a matcher function that returns true for matching objects', () => {
    const matches = tenantConditionsMatcher({ tenantId: 't1', status: 'active' });
    expect(matches({ tenantId: 't1', status: 'active', other: 'x' })).toBe(true);
  });

  it('produces a matcher function that returns false for non-matching objects', () => {
    const matches = tenantConditionsMatcher({ tenantId: 't1' });
    expect(matches({ tenantId: 't2' })).toBe(false);
  });

  it('honors $in operator', () => {
    const matches = tenantConditionsMatcher({ status: { $in: ['active', 'pending'] } });
    expect(matches({ status: 'pending' })).toBe(true);
    expect(matches({ status: 'closed' })).toBe(false);
  });

  it('honors $gt operator', () => {
    const matches = tenantConditionsMatcher({ amount: { $gt: 100 } });
    expect(matches({ amount: 200 })).toBe(true);
    expect(matches({ amount: 50 })).toBe(false);
  });
});
