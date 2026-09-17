const api = require('../../utils/api')
const { decorate } = require('../../utils/format')

function splitTasks(tasks) {
  return { primaryTask: tasks[0] || null, remainingTasks: tasks.slice(1) }
}

Page({
  data: { primaryTask: null, remainingTasks: [], loading: true, error: '' },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const rows = await api.request('/api/me/assignments?scope=todo')
      this.setData(splitTasks(rows.map(decorate)))
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },
  onShow() { return this.load() },
  retry() { return this.load() },
  open(e) { wx.navigateTo({ url: `/pages/task/index?id=${e.currentTarget.dataset.id}` }) }
})
