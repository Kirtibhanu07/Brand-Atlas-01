export const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

export function classifyFailure(error) {
  const message = String(error?.message || error || 'Unknown failure');
  if (/private|reserved|local hosts|unsupported URL|standard web ports/i.test(message)) return 'unsafe_url';
  if (/robots/i.test(message)) return 'robots_disallowed';
  if (/timed?\s*out|deadline|Timeout/i.test(message)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(message)) return 'dns_error';
  if (/certificate|SSL|TLS|ERR_CERT/i.test(message)) return 'tls_error';
  if (/redirect/i.test(message)) return 'redirect_error';
  if (/closed|crash|Target page/i.test(message)) return 'browser_error';
  return 'network_error';
}

export async function retry(operation, {attempts = 2, delayMs = 400, shouldRetry = () => true, pause = sleep} = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(attempt); }
    catch (error) {
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      await pause(delayMs * 2 ** (attempt - 1));
    }
  }
}

// Keep original ordering, including per-item failures. One failure never cancels a batch.
export async function mapLimit(items, concurrency, operation) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(concurrency, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = {status:'fulfilled', value:await operation(items[index], index)}; }
      catch (reason) { results[index] = {status:'rejected', reason}; }
    }
  }));
  return results;
}
