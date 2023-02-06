// TODO: @sk-saru, @sk-umiuma: Share these constants with contracts

export const INACTIVE_PROJECT_UTXO_ADA = 2_000_000n;
export const PROJECT_DETAIL_UTXO_ADA = 2_000_000n;
export const PROJECT_SCRIPT_UTXO_ADA = 20_000_000n;
export const PROJECT_MIN_FUNDS_WITHDRAWAL_ADA = 100_000_000n;
export const PROJECT_FUNDS_WITHDRAWAL_DISCOUNT_RATIO = 100n;
export const PROJECT_NEW_MILESTONE_DISCOUNT_CENTS = 100n;
export const PROJECT_CLOSE_DISCOUNT_CENTS = 50n;
export const PROJECT_DELIST_DISCOUNT_CENTS = 50n;
export const PROJECT_SCRIPT_CLOSE_DISCOUNT_CENTS = 50n;
export const PROJECT_SCRIPT_DELIST_DISCOUNT_CENTS = 50n;

export const TREASURY_UTXO_MIN_ADA = 2_000_000n;
export const TREAUSRY_MIN_WITHDRAWAL_ADA = 100_000_000n;
// Should be 100, however the current deploy is 10000;
// export const TREASURY_WITHDRAWAL_DISCOUNT_RATIO = 100n;
export const TREASURY_WITHDRAWAL_DISCOUNT_RATIO = 10_000n;

export const TREASURY_REVOKE_DISCOUNT_CENTS = 50n;

export const RATIO_MULTIPLIER = BigInt(1e6);

// TODO: @sk-saru: find the proper number
export const FRACTION_LIMIT = 2_000_000n;
