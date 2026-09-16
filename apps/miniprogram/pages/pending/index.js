const api = require('../../utils/api')

const statusText = {
  organization_review: '待部门审核', company_review: '已升级公司处理',
  approved: '已通过', rejected: '已驳回', withdrawn: '已撤回',
  cancelled: '已取消', duplicate: '重复申请', failed: '处理失败'
}

Page({
  data: { requestId: '', status: 'pending', statusText: '待部门审核', reviewNote: '', busy: false, canEnter: false, error: '' },
  onLoad(options) { this.setData({ requestId: options.requestId || '' }) },
  onShow() { this.load(false) },
  async load(relogged) {
    this.setData({ busy: true, error: '' })
    try {
      const requests = await api.request('/api/me/change-requests')
      const row = requests.find((item) => item.id === this.data.requestId) || requests.find((item) => item.type === 'binding')
      if (!row) return this.setData({ statusText: '未找到身份绑定申请', reviewNote: '', canEnter: false })
      const stage = row.reviewStage || row.status
      this.setData({ requestId: row.id, status: row.status, statusText: statusText[stage] || row.status, reviewNote: row.reviewNote || '', canEnter: row.status === 'approved' })
    } catch (error) {
      if (error.statusCode === 401 && !relogged) return this.relogin()
      this.setData({ error: error.message })
    } finally { this.setData({ busy: false }) }
  },
  async relogin() {
    try {
      const { code } = await wx.login()
      const session = await api.publicRequest('/api/wechat/login', 'POST', { code })
      api.saveSession(session)
      if (session.bindingStatus === 'bound') return this.setData({ status: 'approved', statusText: '已通过', canEnter: true, error: '' })
      if (session.requestId) this.setData({ requestId: session.requestId })
      await this.load(true)
    } catch (error) { this.setData({ error: error.message }) }
  },
  refresh() { this.load(false) },
  enter() { wx.reLaunch({ url: '/pages/todo/index' }) },
  back() { api.clearSession(); wx.reLaunch({ url: '/pages/login/index' }) }
})
