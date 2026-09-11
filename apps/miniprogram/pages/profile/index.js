const api = require('../../utils/api')
Page({ data: { canManage: false }, async onShow() { try { const me = await api.request('/api/auth/me'); this.setData({ canManage: me.roles.some((role) => role.role !== 'learner') }); } catch (_) {} }, changeRequest() { wx.navigateTo({ url: '/pages/change-request/index' }) }, manage() { wx.navigateTo({ url: '/pages/management/index' }) } })
