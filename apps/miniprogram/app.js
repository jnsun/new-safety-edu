const api = require('./utils/api')

function loginCode() {
  if (wx.getAccountInfoSync().miniProgram.envVersion === 'develop') return Promise.resolve('dev:miniprogram-preview')
  return wx.login().then(({ code }) => code)
}

App({
  globalData: { session: null, ready: null },
  onLaunch() { this.globalData.ready = this.bootstrap() },
  async bootstrap() {
    try {
      const code = await loginCode()
      const data = await api.publicRequest('/api/wechat/login', 'POST', { code })
      this.globalData.session = data
      api.saveSession(data)
      if (data.bindingStatus !== 'bound') wx.reLaunch({ url: '/pages/bind/index' })
    } catch (_) {
      wx.reLaunch({ url: '/pages/login/index' })
    }
  }
})
