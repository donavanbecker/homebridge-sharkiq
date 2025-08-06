/**
 * Application constants for homebridge-sharkiq
 */

export const VACUUM_SPEEDS = {
  OFF: 0,
  ECO: 30,
  NORMAL: 60,
  MAX: 90,
} as const;

export const TIMEOUTS = {
  LOGIN_DELAY: 1000,
  CAPTCHA_DELAY: 5000,
  PAUSED_UPDATE_DELAY: 100,
  DEFAULT_DOCKED_UPDATE_INTERVAL: 5000,
  TOKEN_EXPIRATION_BUFFER: 600,
} as const;