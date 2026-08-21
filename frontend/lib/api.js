const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request(path, options) {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

export const createProcurement = (rawRequest) => request('/api/procurements', { method: 'POST', body: JSON.stringify({ rawRequest }) });
export const startProcurement = (id) => request(`/api/procurements/${id}/start`, { method: 'POST' });
export const getProcurement = (id) => request(`/api/procurements/${id}`);
export const resolveReview = (id, decision) => request(`/api/procurements/${id}/${decision}`, { method: 'POST' });
export const runEvaluation = () => request('/api/evaluation/run', { method: 'POST' });
export const eventsUrl = (id) => `${API_URL}/api/procurements/${id}/events/stream`;
