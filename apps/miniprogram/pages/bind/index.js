const api = require('../../utils/api')

Page({
  data: { busy: false, wechatPhoneBusy: false, sending: false, showSmsFallback: false, error: '', phone: '', code: '', name: '', reason: '', purpose: 'wechat_bind', departments: [], departmentIndex: -1, countdown: 0 },
  async onLoad() {
    try { const data = await api.request('/api/wechat/registration-options'); this.setData({ departments: data.departments || [] }) }
    catch (error) { this.setData({ error: error.message }) }
  },
  setPhone(e) { this.setData({ phone: e.detail.value }) }, setCode(e) { this.setData({ code: e.detail.value }) }, setName(e) { this.setData({ name: e.detail.value }) }, setReason(e) { this.setData({ reason: e.detail.value }) },
  chooseDepartment(e) { this.setData({ departmentIndex: Number(e.detail.value) }) },
  toggleSmsFallback() { this.setData({ showSmsFallback: !this.data.showSmsFallback, error: '' }) },
  identityDetails() {
    const { name, reason, departments, departmentIndex } = this.data
    if (name.trim().length < 2 || departmentIndex < 0) return null
    return { name, reason, organizationId: departments[departmentIndex].id }
  },
  finish(data) {
    if (data.accessToken) api.saveSession(data)
    wx.reLaunch({ url: data.status === 'bound' ? '/pages/todo/index' : `/pages/pending/index?requestId=${data.requestId}` })
  },
  async verifyWechatPhone(e) {
    const details = this.identityDetails()
    if (!details) return wx.showToast({ title: '请先填写姓名并选择部门', icon: 'none' })
    if (!e.detail?.code) return this.setData({ error: '未取得微信手机号授权，可重试或使用短信验证。' })
    this.setData({ wechatPhoneBusy: true, error: '' })
    try { this.finish(await api.request('/api/wechat/identity/confirm', 'POST', { ...details, wechatPhoneCode: e.detail.code })) }
    catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ wechatPhoneBusy: false }) }
  },
  async sendCode() {
    if (!/^1\d{10}$/.test(this.data.phone) || this.data.countdown) return wx.showToast({ title: '请输入正确手机号', icon: 'none' })
    this.setData({ sending: true, error: '' })
    try {
      const result = await api.request('/api/wechat/identity/phone-code', 'POST', { phone: this.data.phone })
      this.setData({ purpose: result.purpose })
      this.setData({ countdown: 60 })
      const timer = setInterval(() => { const countdown = this.data.countdown - 1; this.setData({ countdown }); if (countdown <= 0) clearInterval(timer) }, 1000)
      wx.showToast({ title: '验证码已发送' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ sending: false }) }
  },
  async submit() {
    const { phone, code, name, reason, purpose, departments, departmentIndex } = this.data
    if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code) || name.trim().length < 2 || departmentIndex < 0) return wx.showToast({ title: '请完整填写身份信息', icon: 'none' })
    this.setData({ busy: true, error: '' })
    try {
      const data = await api.request('/api/wechat/identity/confirm', 'POST', { phone, code, name, reason, purpose, organizationId: departments[departmentIndex].id })
      this.finish(data)
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ busy: false }) }
  }
})
