const api = require('../../utils/api')
const { decorate } = require('../../utils/format')

function buildStages(task) {
  const learningDone = task.progress.completed === task.progress.total
  const examDone = !task.batch.examRequired || task.latestAttempt?.passed || ['pending_signature', 'confirmation_pending', 'completed'].includes(task.status)
  const examCurrent = task.status === 'pending_exam' || task.status === 'locked' || (task.status === 'remediation_required' && learningDone)
  const signatureDone = !!task.signedAt || ['confirmation_pending', 'completed'].includes(task.status)

  return [
    { key: 'learning', label: '学习', state: learningDone ? 'done' : 'current', stateText: learningDone ? (task.progress.total ? '已完成' : '无需课件') : '进行中' },
    { key: 'exam', label: '考试', state: examDone ? 'done' : (examCurrent ? 'current' : 'waiting'), stateText: !task.batch.examRequired ? '无需考试' : (task.status === 'locked' ? '已锁定' : (examDone ? '已通过' : (task.status === 'remediation_required' ? (learningDone ? '待重考' : '待补学') : (examCurrent ? '待考试' : '未开始')))) },
    { key: 'signature', label: '签字', state: signatureDone ? 'done' : (task.status === 'pending_signature' ? 'current' : 'waiting'), stateText: signatureDone ? '已签字' : (task.status === 'pending_signature' ? '待签字' : '未开始') },
    { key: 'complete', label: '完成', state: task.status === 'completed' ? 'done' : (task.status === 'confirmation_pending' ? 'current' : 'waiting'), stateText: task.status === 'completed' ? '已完成' : (task.status === 'confirmation_pending' ? '待项目确认' : '未完成') }
  ]
}

function buildPrimaryAction(task) {
  const nextCourseware = task.coursewares.find((item) => !item.completedAt)
  if (['pending_learning', 'learning', 'remediation_required'].includes(task.status) && nextCourseware) {
    return { kind: 'study', label: task.nextAction, versionId: nextCourseware.versionId }
  }
  if (task.status === 'pending_exam' || (task.status === 'remediation_required' && task.progress.completed === task.progress.total)) {
    return { kind: 'exam', label: task.latestAttempt ? '继续考试流程' : '开始考试' }
  }
  if (task.status === 'pending_signature') return { kind: 'sign', label: '查看记录并本人签字' }
  return null
}

Page({
  data: { id: '', task: null, stageItems: [], primaryAction: null, loading: true, error: '' },
  onLoad(options) { this.setData({ id: options.id }) },
  onShow() { return this.load() },
  async load() {
    if (!this.data.id) return
    this.setData({ loading: true, error: '' })
    try {
      const task = decorate(await api.request(`/api/me/assignments/${this.data.id}`))
      this.setData({ task, stageItems: buildStages(task), primaryAction: buildPrimaryAction(task) })
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
