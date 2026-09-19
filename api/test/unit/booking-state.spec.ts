import { assertValidTransition } from '../../src/modules/booking/booking-state';

describe('assertValidTransition', () => {
  it('allows confirmed -> in_progress', () => {
    expect(() => assertValidTransition('confirmed', 'in_progress')).not.toThrow();
  });

  it('allows confirmed -> cancelled', () => {
    expect(() => assertValidTransition('confirmed', 'cancelled')).not.toThrow();
  });

  it('allows confirmed -> no_show', () => {
    expect(() => assertValidTransition('confirmed', 'no_show')).not.toThrow();
  });

  it('allows in_progress -> completed', () => {
    expect(() => assertValidTransition('in_progress', 'completed')).not.toThrow();
  });

  it('rejects completed -> in_progress (no going backwards)', () => {
    expect(() => assertValidTransition('completed', 'in_progress')).toThrow("Cannot move a booking from 'completed' to 'in_progress'");
  });

  it('rejects cancelled -> confirmed (a cancelled booking is terminal)', () => {
    expect(() => assertValidTransition('cancelled', 'confirmed')).toThrow();
  });

  it('rejects confirmed -> completed (must pass through in_progress)', () => {
    expect(() => assertValidTransition('confirmed', 'completed')).toThrow();
  });

  it('rejects a no-op transition to the same status', () => {
    expect(() => assertValidTransition('confirmed', 'confirmed')).toThrow("already 'confirmed'");
  });

  it('rejects any transition out of a terminal state', () => {
    for (const terminal of ['completed', 'no_show', 'cancelled'] as const) {
      expect(() => assertValidTransition(terminal, 'in_progress')).toThrow();
    }
  });
});
