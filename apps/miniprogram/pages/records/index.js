const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
const { syncTabBar } = require('../../utils/tab-bar')

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

function filteredRecords(records, typeFilter, statusFilter) {
  return records.filter((record) => {
    const typeMatches = typeFilter === 'all' || record.batch.type === typeFilter
    const completed = record.status === 'completed'
    const statusMatches = statusFilter === 'all' || (statusFilter === 'completed' ? completed : !completed)
    return typeMatches && statusMatches
  })
}

Page({
  data: {
    records: [], visibleRecords: [], loading: true, error: '', typeFilter: 'all', statusFilter: 'all',
    typeFilters: [
      { value: 'all', label: '全部培训' }, { value: 'three_level', label: '三级教育' },
      { value: 'project_induction', label: '项目入场' }, { value: 'routine', label: '日常/年度' },
      { value: 'change_update', label: '变化内容' }
    ],
    statusFilters: [{ value: 'all', label: '全部状态' }, { value: 'completed', label: '已完成' }, { value: 'active', label: '进行中' }]
  },
  onShow() { syncTabBar(this, 1); this.load() },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const rows = await api.request('/api/me/assignments?scope=records')
      const records = rows.map(recordItem)
      this.setData({ records, visibleRecords: filteredRecords(records, this.data.typeFilter, this.data.statusFilter) })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseType(event) {
    const typeFilter = event.currentTarget.dataset.value
    this.setData({ typeFilter, visibleRecords: filteredRecords(this.data.records, typeFilter, this.data.statusFilter) })
  },

  chooseStatus(event) {
    const statusFilter = event.currentTarget.dataset.value
    this.setData({ statusFilter, visibleRecords: filteredRecords(this.data.records, this.data.typeFilter, statusFilter) })
  },

  open(e) {
    wx.navigateTo({ url: `/pages/record-detail/index?id=${e.currentTarget.dataset.id}` })
  }
})
