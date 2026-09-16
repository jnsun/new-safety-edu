const api = require('../../utils/api')

Page({
  data: { busy: false, error: '', wechatLoginEnabled: false },
  async onLoad() {
    try { const capabilities = await api.publicRequest('/api/auth/capabilities'); this.setData({ wechatLoginEnabled: !!capabilities.wechatLogin }) }
    catch (error) { this.setData({ error: error.message }) }
  },
  finish(data) { api.saveSession(data); wx.reLaunch({ url: data.bindingStatus === 'bound' ? '/pages/todo/index' : data.bindingStatus === 'pending_review' ? `/pages/pending/index?requestId=${data.requestId}` : '/pages/bind/index' }) },
  async login() {
    this.setData({ busy: true, error: '' })
    try { const { code } = await wx.login(); this.finish(await api.publicRequest('/api/wechat/login', 'POST', { code })) }
    catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ busy: false }) }
  }
})
