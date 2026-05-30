export function isFullscreenEnvEnabled(): boolean {
  if (process.env.DEEPCODE_NO_FLICKER === '0') return false;
  if (process.env.DEEPCODE_NO_FLICKER === '1') return true;
  return false;
}

export function isMouseTrackingEnabled(): boolean {
  return !process.env.DEEPCODE_DISABLE_MOUSE;
}

export function isFullscreenActive(): boolean {
  return isFullscreenEnvEnabled();
}
