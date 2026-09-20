const api = require('../../utils/api')

const methodNames = { wechat: '微信登录', password: '密码登录', phone: '手机号验证' }
function maskPhone(value) {
  const phone = String(value || '')
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : (phone || '待补录')
}

Page({
  data: { loading: true, error: '', security: null, phoneMasked: '', busyId: '', showPhoneForm: false, newPhone: '', phoneCode: '', phoneChanging: false, sendingCode: false },
  onShow() { return this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const [security, person] = await Promise.all([api.request('/api/auth/security'), api.request('/api/me/profile')])
      const current = security.sessions.find((item) => item.current)
      this.setData({ security: { ...security, methodText: methodNames[current?.loginMethod] || '已验证登录' }, phoneMasked: security.verifiedPhoneMasked || maskPhone(person.phone) })
    } catch (error) {
      this.setData({ error: error.message || '账号安全信息加载失败' })
    } finally {
      this.setData({ loading: false })
    }
  },
  togglePhoneForm() { this.setData({ showPhoneForm: !this.data.showPhoneForm }) },
  setNewPhone(event) { this.setData({ newPhone: event.detail.value }) },
  setPhoneCode(event) { this.setData({ phoneCode: event.detail.value }) },
  async sendPhoneCode() {
    if (!/^1\d{10}$/.test(this.data.newPhone)) return wx.showToast({ title: '请输入正确手机号', icon: 'none' })
    this.setData({ sendingCode: true })
    try {
      await api.request('/api/me/phone/code', 'POST', { phone: this.data.newPhone })
      wx.showToast({ title: '验证码已发送' })
    } catch (error) {
      wx.showToast({ title: error.message || '发送失败', icon: 'none' })
    } finally {
      this.setData({ sendingCode: false })
    }
  },
  async confirmPhone() {
    if (!/^\d{6}$/.test(this.data.phoneCode)) return wx.showToast({ title: '请输入六位验证码', icon: 'none' })
    this.setData({ phoneChanging: true })
    try {
      await api.request('/api/me/phone/confirm', 'POST', { phone: this.data.newPhone, code: this.data.phoneCode })
      wx.showModal({ title: '手机号已更新', content: '为保护账号安全，请使用新手机号重新登录。', showCancel: false, success: () => { api.clearSession(); wx.reLaunch({ url: '/pages/login/index' }) } })
    } catch (error) {
      wx.showToast({ title: error.message || '修改失败', icon: 'none' })
    } finally {
      this.setData({ phoneChanging: false })
    }
  },
  async revoke(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    const { confirm } = await wx.showModal({ title: '退出该设备', content: '该设备需要重新登录后才能继续使用。', confirmText: '确认退出' })
    if (!confirm) return
    this.setData({ busyId: id })
    try { await api.request(`/api/auth/sessions/${id}/revoke`, 'POST'); await this.load() } catch (error) { wx.showToast({ title: error.message || '退出失败', icon: 'none' }) } finally { this.setData({ busyId: '' }) }
  },
  async logout() {
    const { confirm } = await wx.showModal({ title: '退出当前设备', content: '退出后需要重新登录。', confirmText: '退出' })
    if (!confirm) return
    await api.logout(); getApp().globalData.session = null; wx.reLaunch({ url: '/pages/login/index' })
  },
  async logoutAll() {
    const { confirm } = await wx.showModal({ title: '退出全部设备', content: '账号在所有设备上的登录都将失效。', confirmText: '全部退出' })
    if (!confirm) return
    await api.logoutAll(); getApp().globalData.session = null; wx.reLaunch({ url: '/pages/login/index' })
  }
})
