const api = require('../../utils/api')
Page({ data: { messages: [], error: '' }, async onShow() { try { this.setData({ messages: await api.request('/api/me/notifications'), error: '' }); } catch (error) { this.setData({ error: error.message }); } }, async read(e) { await api.request(`/api/me/notifications/${e.currentTarget.dataset.id}/read`, 'PATCH'); this.onShow(); } })
