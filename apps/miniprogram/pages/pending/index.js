const api = require('../../utils/api')

Page({
  data: { requestId: '', departments: [], departmentIndex: -1, submitted: false, busy: false, error: '' },
  async onLoad(options) {
    if (!options.requestId) return this.setData({ submitted: true })
    this.setData({ requestId: options.requestId })
    try { const data = await api.request('/api/wechat/registration-options'); this.setData({ departments: data.departments || [] }) }
    catch (error) { this.setData({ error: error.message }) }
  },
  chooseDepartment(event) { this.setData({ departmentIndex: Number(event.detail.value) }) },
  async submit(event) {
    const { requestId, departments, departmentIndex } = this.data
    if (departmentIndex < 0) return wx.showToast({ title: '请选择申请部门', icon: 'none' })
    this.setData({ busy: true, error: '' })
    try {
      await api.request(`/api/wechat/binding-requests/${requestId}/profile`, 'PUT', { ...event.detail.value, organizationId: departments[departmentIndex].id })
      this.setData({ submitted: true })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ busy: false }) }
  },
  back() { wx.reLaunch({ url: '/pages/login/index' }) }
})
