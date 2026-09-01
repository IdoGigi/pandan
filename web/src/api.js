/** Thin fetch wrapper. Throws `Unauthorized` so the app can bounce back to the login screen. */
async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    const err = new Error('Unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  me: () => request('GET', '/me'),
  login: (password) => request('POST', '/login', { password }),
  logout: () => request('POST', '/logout'),

  about: () => request('GET', '/about'),

  tokens: () => request('GET', '/tokens'),
  createToken: (name) => request('POST', '/tokens', { name }),
  revokeToken: (id) => request('DELETE', `/tokens/${id}`),

  board: () => request('GET', '/board'),

  getProject: (id) => request('GET', `/projects/${id}`),
  createProject: (data) => request('POST', '/projects', data),
  updateProject: (id, data) => request('PATCH', `/projects/${id}`, data),
  deleteProject: (id) => request('DELETE', `/projects/${id}`),

  addLink: (projectId, data) => request('POST', `/projects/${projectId}/links`, data),
  updateLink: (id, data) => request('PATCH', `/links/${id}`, data),
  deleteLink: (id) => request('DELETE', `/links/${id}`),

  addUpdate: (projectId, text) => request('POST', `/projects/${projectId}/updates`, { text }),
  deleteUpdate: (id) => request('DELETE', `/updates/${id}`),

  getCard: (id) => request('GET', `/cards/${id}`),
  createCard: (data) => request('POST', '/cards', data),
  updateCard: (id, data) => request('PATCH', `/cards/${id}`, data),
  moveCard: (id, data) => request('POST', `/cards/${id}/move`, data),
  deleteCard: (id) => request('DELETE', `/cards/${id}`),

  addCheck: (cardId, text) => request('POST', `/cards/${cardId}/checks`, { text }),
  updateCheck: (id, data) => request('PATCH', `/checks/${id}`, data),
  deleteCheck: (id) => request('DELETE', `/checks/${id}`),
};
