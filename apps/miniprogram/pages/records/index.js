const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
Page({ data: { records: [], loading: true, error: '' }, async onShow() { try { await getApp().globalData.ready; const rows = await api.request('/api/me/assignments?scope=records'); this.setData({ records: rows.map(decorate), error: '' }) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) } }, open(e) { wx.navigateTo({ url: `/pages/record-detail/index?id=${e.currentTarget.dataset.id}` }) } })
