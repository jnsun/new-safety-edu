const api = require('../../utils/api')

function monthKey(date = new Date()) {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`
}

Page({
  data: { month: monthKey(), tab: 'person', loading: true, error: '', points: null, personal: null, organizations: [] },
  async onLoad() { await this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const month = this.data.month
      const [points, personal, organization] = await Promise.all([
        api.request('/api/me/challenge-points'),
        api.request(`/api/challenge/leaderboards?month=${month}&type=person`),
        api.request(`/api/challenge/leaderboards?month=${month}&type=organization`)
      ])
      this.setData({ points, personal, organizations: organization.rows.map((row) => ({ ...row, averageText: row.averagePoints.toFixed(2), rateText: `${Math.round(row.participationRate * 100)}%` })) })
    } catch (error) { this.setData({ error: error.message || '排行榜加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  switchTab(event) { this.setData({ tab: event.currentTarget.dataset.tab }) },
  changeMonth(event) { this.setData({ month: event.detail.value }); return this.load() },
  retry() { return this.load() }
})
