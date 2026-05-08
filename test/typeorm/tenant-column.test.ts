import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  TENANT_COLUMN_METADATA,
  TenantColumn,
  getTenantColumn,
} from '../../src/typeorm/tenant-column.decorator.js';

describe('@TenantColumn / getTenantColumn', () => {
  it('marks the property with TENANT_COLUMN_METADATA on the constructor', () => {
    class Merchant {
      @TenantColumn()
      tenantId!: string;
    }
    expect(Reflect.getMetadata(TENANT_COLUMN_METADATA, Merchant)).toBe('tenantId');
  });

  it('getTenantColumn reads back the marked property', () => {
    class Merchant {
      @TenantColumn()
      orgId!: string;
    }
    expect(getTenantColumn(Merchant)).toBe('orgId');
  });

  it('returns undefined for a class without @TenantColumn', () => {
    class System {
      id!: string;
    }
    expect(getTenantColumn(System)).toBeUndefined();
  });

  it('rejects symbol-keyed properties (TypeORM column names are strings)', () => {
    const sym = Symbol('weird');
    expect(() => {
      // Manually invoke the decorator with a symbol — bypasses TS's
      // PropertyKey union to exercise the runtime guard.
      class Bad {}
      const decorate = TenantColumn();
      decorate(Bad.prototype, sym);
    }).toThrow(TypeError);
  });

  it('rejects double-marking the same class on different properties', () => {
    expect(() => {
      class Twice {
        @TenantColumn()
        tenantId!: string;

        @TenantColumn()
        orgId!: string;
      }
      void Twice;
    }).toThrow(/already has a @TenantColumn/);
  });

  it('allows re-applying @TenantColumn to the same property (idempotent)', () => {
    expect(() => {
      class Same {
        @TenantColumn()
        @TenantColumn()
        tenantId!: string;
      }
      void Same;
    }).not.toThrow();
  });
});
