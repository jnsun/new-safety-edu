const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
Page({ data: { tasks: [], loading: true, error: '' }, async onShow() { try { await getApp().globalData.ready; const rows = await api.request('/api/me/assignments?scope=todo'); this.setData({ tasks: rows.map(decorate), error: '' }) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) } }, open(e) { wx.navigateTo({ url: `/pages/task/index?id=${e.currentTarget.dataset.id}` }) } })
