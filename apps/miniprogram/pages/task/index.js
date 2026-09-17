const api = require('../../utils/api')
const { decorate } = require('../../utils/format')

function buildStages(task) {
  const learningDone = task.progress.completed === task.progress.total
  const examDone = !task.batch.examRequired || task.latestAttempt?.passed || ['pending_signature', 'confirmation_pending', 'completed'].includes(task.status)
  const examCurrent = task.status === 'pending_exam' || task.status === 'locked' || (task.status === 'remediation_required' && learningDone)
  const signatureNotRequired = task.batch.source === 'reconfirmation'
  const signatureDone = !!task.signedAt || signatureNotRequired

  return [
    { key: 'learning', label: '学习', state: learningDone ? 'done' : 'current', stateText: learningDone ? (task.progress.total ? '已完成' : '无需课件') : '进行中' },
    { key: 'exam', label: '考试', state: examDone ? 'done' : (examCurrent ? 'current' : 'waiting'), stateText: !task.batch.examRequired ? '无需考试' : (task.status === 'locked' ? '已锁定' : (examDone ? '已通过' : (task.status === 'remediation_required' ? (learningDone ? '待重考' : '待补学') : (examCurrent ? '待考试' : '未开始')))) },
    { key: 'signature', label: '签字', state: signatureDone ? 'done' : (task.status === 'pending_signature' ? 'current' : 'waiting'), stateText: signatureNotRequired ? '无需签字' : (task.signedAt ? '已签字' : (task.status === 'pending_signature' ? '待签字' : '未开始')) },
    { key: 'complete', label: '完成', state: task.status === 'completed' ? 'done' : (task.status === 'confirmation_pending' ? 'current' : 'waiting'), stateText: task.status === 'completed' ? '已完成' : (task.status === 'confirmation_pending' ? '待项目确认' : '未完成') }
  ]
}

function buildConfirmationText(task) {
  if (task.batch.source === 'reconfirmation') return '等待项目管理员确认重新到场和现场交底。'
  return task.signedAt ? '已签字，等待项目管理员确认到场和现场交底。' : '等待项目管理员确认到场和现场交底。'
}

function buildExamResultText(task) {
  if (!task.batch.examRequired) return '本次不要求考试'
  if (!task.latestAttempt) return '尚未考试'
  if (task.latestAttempt.status === 'in_progress') return '考试进行中'
  if (task.latestAttempt.status !== 'submitted' || task.latestAttempt.score === null || typeof task.latestAttempt.passed !== 'boolean') return '考试已提交'
  return `${task.latestAttempt.score} 分，${task.latestAttempt.passed ? '通过' : '未通过'}`
}

function buildSignatureResultText(task) {
  if (task.batch.source === 'reconfirmation') return '重新现场确认无需签字'
  return task.signedAt ? '已签字' : '未签字'
}

function buildPrimaryAction(task) {
  const nextCourseware = task.coursewares.find((item) => !item.completedAt)
  if (['pending_learning', 'learning', 'remediation_required'].includes(task.status) && nextCourseware) {
    return { kind: 'study', label: task.nextAction, versionId: nextCourseware.versionId }
  }
  if (task.status === 'pending_exam' || (task.status === 'remediation_required' && task.progress.completed === task.progress.total)) {
    return { kind: 'exam', label: task.latestAttempt?.status === 'in_progress' ? '继续考试' : '开始考试' }
  }
  if (task.status === 'pending_signature') return { kind: 'sign', label: '查看记录并本人签字' }
  return null
}

Page({
  data: { id: '', task: null, stageItems: [], primaryAction: null, confirmationText: '', examResultText: '', signatureResultText: '', loading: true, error: '' },
  onLoad(options) { this.setData({ id: options.id }) },
  onShow() { return this.load() },
  async load() {
    if (!this.data.id) return
    this.setData({ loading: true, error: '' })
    try {
      const task = decorate(await api.request(`/api/me/assignments/${this.data.id}`))
      this.setData({ task, stageItems: buildStages(task), primaryAction: buildPrimaryAction(task), confirmationText: buildConfirmationText(task), examResultText: buildExamResultText(task), signatureResultText: buildSignatureResultText(task) })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },
  retry() { return this.load() },
  runPrimaryAction() {
    const action = this.data.primaryAction
    if (!action) return
    if (action.kind === 'study') return wx.navigateTo({ url: `/pages/courseware/index?assignmentId=${this.data.id}&versionId=${action.versionId}` })
    if (action.kind === 'exam') return this.exam()
    if (action.kind === 'sign') return this.sign()
  },
  study(e) { const item = e.currentTarget.dataset; wx.navigateTo({ url: `/pages/courseware/index?assignmentId=${this.data.id}&versionId=${item.versionId}` }) },
  exam() { wx.navigateTo({ url: `/pages/exam/index?assignmentId=${this.data.id}` }) },
  sign() { wx.navigateTo({ url: `/pages/signature/index?assignmentId=${this.data.id}` }) }
})
