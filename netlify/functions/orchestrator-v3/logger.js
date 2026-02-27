function logExecution(payload) {
  const log = {
    timestamp: new Date().toISOString(),
    domain: payload.domain || 'MENU',
    intent: payload.intent || 'info',
    ingredientsDetected: Array.isArray(payload.ingredientsDetected) ? payload.ingredientsDetected : [],
    executionTimeMs: Number(payload.executionTimeMs) || 0,
    status: payload.status || 'success',
    error: payload.error || null
  };

  console.log(JSON.stringify(log));
}

module.exports = {
  logExecution
};
