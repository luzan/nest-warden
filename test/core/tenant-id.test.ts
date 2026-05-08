import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_FIELD } from '../../src/core/tenant-id.js';

describe('tenant-id module', () => {
  it('exposes DEFAULT_TENANT_FIELD as the canonical tenant column name', () => {
    expect(DEFAULT_TENANT_FIELD).toBe('tenantId');
  });
});
