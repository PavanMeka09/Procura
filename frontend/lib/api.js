const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const authHeaders = () => ({});

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...authHeaders(), ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export const createProcurement = (rawRequest) => request('/api/procurements', { method: 'POST', body: JSON.stringify({ rawRequest }) });
export const startProcurement = (id) => request(`/api/procurements/${id}/start`, { method: 'POST' });
export const getProcurement = (id) => request(`/api/procurements/${id}`);
export const resolveReview = (id, decision) => request(`/api/procurements/${id}/${decision}`, { method: 'POST' });
export const runEvaluation = () => request('/api/evaluation/run', { method: 'POST' });

export function subscribeEvents(id, onEvent, onError) {
  const controller = new AbortController();
  (async () => {
    try {
      const response = await fetch(`${API_URL}/api/procurements/${id}/events/stream`, { headers: authHeaders(), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('Event stream unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (data) onEvent(JSON.parse(data));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) onError?.(error);
    }
  })();
  return () => controller.abort();
}
