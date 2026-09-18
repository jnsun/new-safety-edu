const api = require('../../utils/api')
const { decorate } = require('../../utils/format')

function splitTasks(tasks) {
  return { primaryTask: tasks[0] || null, remainingTasks: tasks.slice(1) }
}

Page({
  data: { primaryTask: null, remainingTasks: [], challenge: null, loading: true, error: '' },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const rows = await api.request('/api/me/assignments?scope=todo')
      let challenge = null
      try { challenge = await api.request('/api/me/daily-challenge') } catch (_) {}
      this.setData({ ...splitTasks(rows.map(decorate)), challenge })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },
  onShow() { return this.load() },
  retry() { return this.load() },
  open(e) { wx.navigateTo({ url: `/pages/task/index?id=${e.currentTarget.dataset.id}` }) },
  openChallenge() { wx.navigateTo({ url: '/pages/challenge/index' }) }
})
