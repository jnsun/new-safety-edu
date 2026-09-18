const api = require('./utils/api')
const { getRuntimeEnvironment } = require('./config/env')

function loginCode() {
  return wx.login().then(({ code }) => code)
}

App({
  globalData: { session: null, ready: null, environment: null },
  onLaunch() {
    try {
      const environment = getRuntimeEnvironment()
      this.globalData.environment = environment.name
      if (environment.name === 'test') console.info(`MiniProgram environment: test\nAPI: ${environment.apiBaseUrl.replace(/\/api$/, '')}`)
      this.globalData.ready = this.bootstrap()
    } catch (error) {
      this.globalData.ready = Promise.resolve()
      wx.showModal({ title: '环境校验失败', content: error.message, showCancel: false })
    }
  },
  async bootstrap() {
    if (wx.getStorageSync('loggedOut')) return wx.reLaunch({ url: '/pages/login/index' })
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
