/**
 * Kwikset cloud API constants, reverse-engineered from the official app
 * (via the aiokwikset 0.7.3 Python library) and confirmed live against real
 * hardware. These are Kwikset's own public app-client identifiers — the same
 * ones every Kwikset app install uses. This is an unofficial, undocumented API
 * and may change without notice.
 */

// --- AWS Cognito (us-east-1) ---
export const POOL_ID = 'us-east-1_6B3uo6uKN';
export const CLIENT_ID = '5eu1cdkjp1itd1fi7b91m6g79s';
export const POOL_REGION = 'us-east-1';

// --- REST API ---
export const API_BASE_URL = 'https://ynk95r1v52.execute-api.us-east-1.amazonaws.com/prod_v1';

export const GET_HOMES_URL = `${API_BASE_URL}/users/me/homes?top=200`;
export const getHomeDevicesUrl = (homeId: string) => `${API_BASE_URL}/homes/${homeId}/devices`;
export const lockCommandUrl = (serialNumber: string) => `${API_BASE_URL}/devices/${serialNumber}/status`;

// --- HTTP headers (mirror the official app for parity with the unofficial API) ---
export const REST_USER_AGENT = 'okhttp/5.0.0-alpha.14';
export const ACCEPT_ENCODING = 'gzip';

// --- Custom challenge (verification-code) answer ---
// Requests the cloud to send a login verification code via email.
export const CUSTOM_CHALLENGE_GENERATE_ANSWER = 'answerType:generateCode,medium:email,codeType:login';

// --- Lock command "source" identity (shows who/what operated the lock in
// history). The cloud truncates these fields to 7 characters. ---
export const SOURCE_NAME_MAX_LEN = 7;
export const SOURCE_DEVICE = 'apikwik'; // "apikwikset" truncated to 7

// --- Tuning ---
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1_000;
// Renew the ID token when it is within this window of expiry.
export const TOKEN_RENEW_SKEW_MS = 5 * 60_000;
// HTTP statuses worth retrying as transient (vs. 401 = auth, other 4xx = fatal).
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
// Cap how long we will wait on a 429 Retry-After before falling back to backoff.
export const MAX_RETRY_AFTER_MS = 30_000;
