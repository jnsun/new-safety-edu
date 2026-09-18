const environments = Object.freeze({
  test: Object.freeze({ name: 'test', apiBaseUrl: 'https://test.safety.sx.cn/api' }),
  prod: Object.freeze({ name: 'prod', apiBaseUrl: 'https://www.safety.sx.cn/api' })
})

function resolveEnvironment(envVersion) {
  if (envVersion === 'develop' || envVersion === 'trial') return environments.test
  if (envVersion === 'release') return environments.prod
  throw new Error('无法确认微信小程序运行环境，已停止网络请求。')
}

function assertSafeApiBaseUrl(environmentName, apiBaseUrl) {
  if (environmentName === 'test' && apiBaseUrl !== environments.test.apiBaseUrl) throw new Error('当前为测试版小程序，已阻止连接生产环境。')
  if (environmentName === 'prod' && apiBaseUrl !== environments.prod.apiBaseUrl) throw new Error('正式版小程序只能连接生产环境。')
  return apiBaseUrl
}

function getRuntimeEnvironment() {
  const envVersion = wx.getAccountInfoSync()?.miniProgram?.envVersion
  const environment = resolveEnvironment(envVersion)
  assertSafeApiBaseUrl(environment.name, environment.apiBaseUrl)
  return environment
}

function getApiBaseUrl() { return getRuntimeEnvironment().apiBaseUrl }
function getMiniProgramEnvironment() { return getRuntimeEnvironment().name }
function isTestEnvironment() { return getMiniProgramEnvironment() === 'test' }
function getMiniProgramRequestHeaders() { return { 'X-MiniProgram-Env': getMiniProgramEnvironment() } }
function resolveApiUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('API 请求路径无效。')
  return `${getApiBaseUrl()}${path.replace(/^\/api(?=\/|$)/, '')}`
}

module.exports = {
  resolveEnvironment, assertSafeApiBaseUrl, getRuntimeEnvironment, getApiBaseUrl,
  getMiniProgramEnvironment, getMiniProgramRequestHeaders, isTestEnvironment, resolveApiUrl
}
