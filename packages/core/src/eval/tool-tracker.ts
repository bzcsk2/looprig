let enabled = false;
let callCount = 0;
let failureCount = 0;

export const evalToolTracker = {
  enable() {
    enabled = true;
    callCount = 0;
    failureCount = 0;
  },

  disable() {
    enabled = false;
  },

  record(isError: boolean) {
    if (!enabled) return;
    callCount++;
    if (isError) failureCount++;
  },

  getStats() {
    return { calls: callCount, failures: failureCount };
  },
};
