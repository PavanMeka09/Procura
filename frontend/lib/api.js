/**
 * Base client API client for communicating with the Procura backend.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Core JSON fetch wrapper with standard error handling.
 */
async function apiRequest(path, options = {}) {
  const url = `${API_URL}${path}`;
  const headers = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  return body;
}

/**
 * Creates a new procurement request from natural language input.
 */
export async function createProcurement(rawRequest) {
  return apiRequest('/api/procurements', {
    method: 'POST',
    body: JSON.stringify({ rawRequest }),
  });
}

/**
 * Initiates the multi-agent negotiation session for a given procurement request.
 */
export async function startProcurement(requestId) {
  return apiRequest(`/api/procurements/${requestId}/start`, {
    method: 'POST',
  });
}

/**
 * Fetches the latest snapshot of a procurement session.
 */
export async function getProcurement(requestId) {
  return apiRequest(`/api/procurements/${requestId}`);
}

/**
 * Resolves a pending human review with an 'approve', 'reject', or 'stop' decision.
 */
export async function resolveReview(requestId, decision) {
  return apiRequest(`/api/procurements/${requestId}/${decision}`, {
    method: 'POST',
  });
}

/**
 * Triggers the 20-case evaluation test suite.
 */
export async function runEvaluation() {
  return apiRequest('/api/evaluation/run', {
    method: 'POST',
  });
}

/**
 * Subscribes to Server-Sent Events (SSE) for real-time negotiation trace updates.
 * Returns an unsubscribe teardown function.
 */
export function subscribeEvents(requestId, onEvent, onError) {
  const abortController = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${API_URL}/api/procurements/${requestId}/events/stream`, {
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Event stream unavailable.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const dataLine = chunk
            .split('\n')
            .find((line) => line.startsWith('data: '));

          if (dataLine) {
            const rawJson = dataLine.slice(6).trim();
            if (rawJson) {
              try {
                const parsedEvent = JSON.parse(rawJson);
                onEvent(parsedEvent);
              } catch {
                // Ignore malformed heartbeats/comments
              }
            }
          }
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        onError?.(error);
      }
    }
  })();

  return () => abortController.abort();
}
