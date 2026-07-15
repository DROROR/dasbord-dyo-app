export interface AppSettings {
  DEFAULT_OTP_PRICE:      number  // ₪ per OTP sent
  DEFAULT_USER_THRESHOLD: number  // users included in base package
  DEFAULT_BLOCK_SIZE:     number  // users per additional block
  DEFAULT_BLOCK_PRICE:    number  // ₪ per block
}

export const DEFAULTS: AppSettings = {
  DEFAULT_OTP_PRICE:      1,
  DEFAULT_USER_THRESHOLD: 250,
  DEFAULT_BLOCK_SIZE:     250,
  DEFAULT_BLOCK_PRICE:    100,
}
