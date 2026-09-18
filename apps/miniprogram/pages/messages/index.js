const api = require('../../utils/api')
Page({
  data: { messages: [], loading: true, error: '' },
  async onShow() {
    this.setData({ loading: true, error: '' })
    try { this.setData({ messages: await api.request('/api/me/notifications') }) }
    catch (error) { this.setData({ error: error.message || '消息加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  async read(e) {
    try {
      await api.request(`/api/me/notifications/${e.currentTarget.dataset.id}/read`, 'PATCH')
      await this.onShow()
    } catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
  }
})
