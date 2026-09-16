const api = require('../../utils/api')

const statusNames = { pending_learning: '待学习', learning: '学习中', pending_exam: '待考试', remediation_required: '需补学', locked: '已锁定', pending_signature: '待签字', confirmation_pending: '待项目确认', completed: '已完成' }
const requestTypeNames = { binding: '身份绑定', registration: '人员注册', profile_change: '资料变更', binding_change: '微信换绑', department_transfer: '调换部门', project_join: '加入项目' }
const identityActions = [
  { value: 'bind_existing', label: '绑定本部门已有人员', needsPerson: true },
  { value: 'update_phone_and_bind', label: '修正手机号后绑定', needsPerson: true },
  { value: 'create_employee_and_bind', label: '新建正式员工并绑定', needsPerson: false },
  { value: 'repair_membership_and_bind', label: '修复部门归属后绑定', needsPerson: true },
  { value: 'escalate_company', label: '升级公司管理员处理', needsPerson: false },
  { value: 'reject', label: '驳回', needsPerson: false }
]

Page({
  data: {
    assignments: [], requests: [], unlockReason: '', reviewNote: '', error: '',
    identityActions, activeReview: null, actionIndex: -1, candidateIndex: -1, needsPerson: false
  },
  async onShow() {
    try {
      const [assignments, requests, identityRequests] = await Promise.all([
        api.request('/api/management/assignments'),
        api.request('/api/management/requests'),
        api.request('/api/binding-requests')
      ])
      const identityIds = new Set(identityRequests.map((row) => row.id))
      const normalizedIdentity = identityRequests.map((row) => ({ ...row, payload: row.payload || {}, summary: row.summary || {}, identityReview: row.type === 'binding', typeText: requestTypeNames[row.type] || row.type }))
      const normalizedOther = requests.filter((row) => row.status === 'pending' && !identityIds.has(row.id)).map((row) => ({ ...row, payload: row.payload || {}, summary: row.summary || {}, typeText: requestTypeNames[row.type] || row.type }))
      this.setData({
        assignments: assignments.filter((row) => row.status !== 'completed').map((row) => ({ ...row, statusText: statusNames[row.status] || row.status })),
        requests: [...normalizedIdentity, ...normalizedOther], error: ''
      })
    } catch (error) {
      if (error.statusCode === 403) wx.navigateBack()
      else this.setData({ error: error.message })
    }
  },
  reason(e) { this.setData({ unlockReason: e.detail.value }) },
  note(e) { this.setData({ reviewNote: e.detail.value }) },
  chooseIdentityAction(e) {
    const actionIndex = Number(e.detail.value)
    this.setData({ actionIndex, candidateIndex: -1, needsPerson: identityActions[actionIndex].needsPerson })
  },
  chooseCandidate(e) { this.setData({ candidateIndex: Number(e.detail.value) }) },
  async openIdentityReview(e) {
    const row = this.data.requests[Number(e.currentTarget.dataset.index)]
    try {
      const candidates = await api.request(`/api/identity-binding-requests/${row.id}/candidates`)
      this.setData({ activeReview: { ...row, candidates }, actionIndex: -1, candidateIndex: -1, needsPerson: false, reviewNote: '' })
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
  },
  closeIdentityReview() { this.setData({ activeReview: null, actionIndex: -1, candidateIndex: -1, needsPerson: false, reviewNote: '' }) },
  async submitIdentityReview() {
    const { activeReview, actionIndex, candidateIndex, reviewNote } = this.data
    if (!activeReview || actionIndex < 0) return wx.showToast({ title: '请选择处理方式', icon: 'none' })
    if (reviewNote.trim().length < 2) return wx.showToast({ title: '请填写至少2个字的意见', icon: 'none' })
    const action = identityActions[actionIndex]
    if (action.needsPerson && candidateIndex < 0) return wx.showToast({ title: '请选择人员档案', icon: 'none' })
    const personId = action.needsPerson ? activeReview.candidates[candidateIndex].id : undefined
    const succeeded = await this.run(
      () => api.request(`/api/identity-binding-requests/${activeReview.id}/review`, 'POST', { action: action.value, note: reviewNote, ...(personId ? { personId } : {}) }),
      action.value === 'reject' ? '申请已驳回' : action.value === 'escalate_company' ? '已升级公司处理' : '身份绑定已处理'
    )
    if (succeeded) this.closeIdentityReview()
  },
  async remind(e) { await this.run(() => api.request('/api/management/reminders', 'POST', { assignmentIds: [e.currentTarget.dataset.id] }), '已催办') },
  async unlock(e) { if (this.data.unlockReason.trim().length < 2) return wx.showToast({ title: '请先填写解锁原因', icon: 'none' }); await this.run(() => api.request(`/api/management/assignments/${e.currentTarget.dataset.id}/unlock`, 'POST', { reason: this.data.unlockReason }), '已解锁，需补学') },
  async confirm(e) { await this.run(() => api.request('/api/management/confirmations', 'POST', { assignmentIds: [e.currentTarget.dataset.id] }), '已确认') },
  async review(e) {
    const row = this.data.requests[Number(e.currentTarget.dataset.index)]
    const decision = e.currentTarget.dataset.decision
    if (decision === 'reject' && this.data.reviewNote.trim().length < 2) return wx.showToast({ title: '请填写驳回意见', icon: 'none' })
    const path = decision === 'reject' ? `/api/management/requests/${row.id}/reject` : row.type === 'registration' ? `/api/binding-requests/${row.id}/approve` : `/api/management/requests/${row.id}/approve`
    await this.run(() => api.request(path, 'POST', { note: this.data.reviewNote }), '审核完成')
  },
  async run(action, title) {
    try { await action(); wx.showToast({ title }); await this.onShow(); return true }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }); return false }
  }
})
