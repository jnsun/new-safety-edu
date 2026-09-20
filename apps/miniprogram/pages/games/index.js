const api = require('../../utils/api')
const { syncTabBar } = require('../../utils/tab-bar')

Page({
  data: { loading: true, error: '', challenge: null, points: null },
  onShow() { syncTabBar(this, 2); return this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const challenge = await api.request('/api/me/daily-challenge')
      let points = null
      try { points = await api.request('/api/me/challenge-points') } catch (_) {}
      this.setData({ challenge, points })
    } catch (error) {
      this.setData({ error: error.message || '闯关中心加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },
  openChallenge() {
    if (!this.data.challenge?.totalCount) return wx.showToast({ title: '管理员尚未启用挑战题', icon: 'none' })
    wx.navigateTo({ url: '/pages/challenge/index' })
  },
  openLeaderboard() { wx.navigateTo({ url: '/pages/leaderboard/index' }) },
  notReady() { wx.showToast({ title: '该游戏正在准备中', icon: 'none' }) }
})
