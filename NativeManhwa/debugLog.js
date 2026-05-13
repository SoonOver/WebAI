/** NDJSON debug ingest (session 2ab9e9). Metro also prints [AGENT_DEBUG] when __DEV__. */
export function debugLog(location, message, data, hypothesisId) {
  const payload = {
    sessionId: '2ab9e9',
    location,
    message,
    data: data || {},
    timestamp: Date.now(),
    hypothesisId: hypothesisId || 'none',
  };
  // #region agent log
  fetch('http://127.0.0.1:7650/ingest/6fe766a2-b2e0-4f71-bb40-664c3c5670e7', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2ab9e9' },
    body: JSON.stringify(payload),
  }).catch(() => {});
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[AGENT_DEBUG]', JSON.stringify(payload));
  }
  // #endregion
}
