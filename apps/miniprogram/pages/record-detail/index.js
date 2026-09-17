const api = require('../../utils/api')
const { date, decorate } = require('../../utils/format')

function recordDetail(row) {
  const record = decorate(row)
  const attempt = record.latestAttempt
  const projectRequired = record.batch.type === 'project_induction' || record.batch.source === 'reconfirmation'
  return {
    ...record,
    completedText: record.completedAt ? record.completedText : '尚未完成',
    coursewares: record.coursewares.map((item) => ({ ...item, completedText: item.completedAt ? date(item.completedAt) : '未完成' })),
    examAttemptText: !record.batch.examRequired ? '不要求考试' : attempt ? `第 ${attempt.attemptNumber} 次` : '暂无考试记录',
    examScoreText: !record.batch.examRequired ? '—' : attempt?.score === null || attempt?.score === undefined ? '暂无成绩' : `${attempt.score} 分`,
    examPassText: !record.batch.examRequired ? '不要求考试' : !attempt ? '暂无结果' : attempt.passed ? '已通过' : '未通过',
    signedAtText: record.signedAt ? date(record.signedAt) : '',
    signatureText: record.batch.source === 'reconfirmation' ? '本次重新确认无需签字' : record.signedAt ? '正式签字已提交' : '未签字',
    projectRequired,
    projectConfirmationText: !projectRequired ? '本次培训无需项目现场确认' : record.projectConfirmation ? '项目现场确认已完成' : '尚未记录项目现场确认',
    projectConfirmedAtText: record.projectConfirmation ? date(record.projectConfirmation.confirmedAt) : '',
    projectConfirmerName: record.projectConfirmation?.confirmerName || ''
  }
}

Page({
  data: { id: '', record: null, loading: true, error: '' },
  onLoad(options) {
    this.setData({ id: options.id || '' })
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const row = await api.request(`/api/me/records/${this.data.id}`)
      this.setData({ record: recordDetail(row) })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  }
})
