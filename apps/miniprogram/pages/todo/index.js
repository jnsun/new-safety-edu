const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
const { syncTabBar } = require('../../utils/tab-bar')

function splitTasks(tasks) {
  return { primaryTask: tasks[0] || null, remainingTasks: tasks.slice(1), totalTasks: tasks.length }
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 11) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

Page({
  data: { primaryTask: null, remainingTasks: [], totalTasks: 0, challenge: null, person: null, photoPath: '', greeting: greeting(), loading: true, error: '' },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const [rows, person] = await Promise.all([
        api.request('/api/me/assignments?scope=todo'),
        api.request('/api/me/profile').catch(() => null)
      ])
      let challenge = null
      try { challenge = await api.request('/api/me/daily-challenge') } catch (_) {}
      this.setData({ ...splitTasks(rows.map(decorate)), challenge, person, greeting: greeting() })
      if (person?.photoFileId) {
        try { this.setData({ photoPath: await api.download(`/api/files/${person.photoFileId}`) }) } catch (_) {}
      }
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },
  onShow() { syncTabBar(this, 0); return this.load() },
  retry() { return this.load() },
  open(e) { wx.navigateTo({ url: `/pages/task/index?id=${e.currentTarget.dataset.id}` }) },
  openChallenge() { wx.navigateTo({ url: '/pages/challenge/index' }) },
  openGames() { wx.switchTab({ url: '/pages/games/index' }) },
  openRecords() { wx.switchTab({ url: '/pages/records/index' }) }
})
