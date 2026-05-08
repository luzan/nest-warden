import { describe, expect, it } from 'vitest';
import {
  callPolicyHandler,
  isPolicyHandlerObject,
  type PolicyHandler,
} from '../../src/nestjs/policy-handler.js';

const fakeAbility = { can: () => true } as never;

describe('PolicyHandler helpers', () => {
  it('isPolicyHandlerObject returns true for objects with a handle method', () => {
    const handler: PolicyHandler = { handle: () => true };
    expect(isPolicyHandlerObject(handler)).toBe(true);
  });

  it('isPolicyHandlerObject returns false for inline functions', () => {
    expect(isPolicyHandlerObject(() => true)).toBe(false);
  });

  it('isPolicyHandlerObject returns false for null/non-objects (defensive)', () => {
    // Cast through unknown — runtime defensiveness only.
    expect(isPolicyHandlerObject(null as unknown as PolicyHandler)).toBe(false);
  });

  it('callPolicyHandler invokes object handlers via .handle()', () => {
    let called = false;
    const handler: PolicyHandler = {
      handle: () => {
        called = true;
        return true;
      },
    };
    expect(callPolicyHandler(handler, fakeAbility)).toBe(true);
    expect(called).toBe(true);
  });

  it('callPolicyHandler invokes function handlers directly', () => {
    let called = false;
    const handler = (): boolean => {
      called = true;
      return false;
    };
    expect(callPolicyHandler(handler, fakeAbility)).toBe(false);
    expect(called).toBe(true);
  });

  it('callPolicyHandler forwards the request argument', () => {
    let captured: unknown;
    const handler = (_a: unknown, req: unknown): boolean => {
      captured = req;
      return true;
    };
    callPolicyHandler(handler, fakeAbility, { url: '/x' });
    expect(captured).toEqual({ url: '/x' });
  });
});
