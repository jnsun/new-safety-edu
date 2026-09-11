const versions = { develop: 'http://localhost:3000', trial: '', release: '' }

function getApiBaseUrl() {
  const version = wx.getAccountInfoSync().miniProgram.envVersion || 'develop'
  const value = versions[version]
  if (!value) throw new Error(`当前 ${version} 环境尚未配置 API 域名`)
  return value
}

module.exports = { getApiBaseUrl }
