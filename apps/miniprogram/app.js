const api = require('./utils/api')

App({
  globalData: { session: null },
  async onLaunch() {
    try {
      const { code } = await wx.login()
      const data = await api.publicRequest('/api/wechat/login', 'POST', { code })
      this.globalData.session = data
      wx.setStorageSync('accessToken', data.accessToken)
      wx.setStorageSync('refreshToken', data.refreshToken)
      if (data.bindingStatus !== 'bound') wx.reLaunch({ url: '/pages/bind/index' })
    } catch (_) {
      wx.reLaunch({ url: '/pages/login/index' })
    }
  }
})
