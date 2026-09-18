const api = require('../../utils/api')
const { decorate } = require('../../utils/format')

function recordItem(row) {
  const record = decorate(row)
  const attempt = record.latestAttempt
  return {
    ...record,
    completedText: record.completedAt ? record.completedText : (record.status === 'confirmation_pending' ? '待项目确认' : '尚未完成'),
    finalScoreText: !record.batch.examRequired ? '不要求考试' : attempt?.score === null || attempt?.score === undefined ? '暂无成绩' : `${attempt.score} 分`,
    passText: !record.batch.examRequired ? '不要求考试' : !attempt ? '暂无结果' : attempt.passed ? '已通过' : '未通过',
    passClass: !record.batch.examRequired || !attempt ? 'neutral' : attempt.passed ? 'success' : 'warning',
    signatureText: record.batch.source === 'reconfirmation' ? '无需签字' : record.signedAt ? '已签字' : '未签字'
  }
}

Page({
  data: { records: [], loading: true, error: '' },
  onShow() { this.load() },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const rows = await api.request('/api/me/assignments?scope=records')
      this.setData({ records: rows.map(recordItem) })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  open(e) {
    wx.navigateTo({ url: `/pages/record-detail/index?id=${e.currentTarget.dataset.id}` })
  }
})
