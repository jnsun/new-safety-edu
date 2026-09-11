const { getApiBaseUrl } = require('../config/env')

function rawRequest(path, method, data, token) {
  return new Promise((resolve, reject) => wx.request({
    url: `${getApiBaseUrl()}${path}`, method, data: data ?? (method === 'GET' ? undefined : {}),
    header: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data)
      else { const error = new Error(response.data?.error?.message || '请求失败'); error.statusCode = response.statusCode; error.code = response.data?.error?.code; reject(error) }
    }, fail: reject
  }))
}

function saveSession(data) {
  wx.setStorageSync('accessToken', data.accessToken)
  wx.setStorageSync('refreshToken', data.refreshToken)
}

async function request(path, method = 'GET', data) {
  try { return await rawRequest(path, method, data, wx.getStorageSync('accessToken')) }
  catch (error) {
    const refreshToken = wx.getStorageSync('refreshToken')
    if (error.statusCode !== 401 || !refreshToken) throw error
    const session = await rawRequest('/api/auth/refresh', 'POST', { refreshToken })
    saveSession(session)
    return rawRequest(path, method, data, session.accessToken)
  }
}
const publicRequest = (path, method = 'GET', data) => rawRequest(path, method, data)

function upload(filePath, kind) {
  return new Promise((resolve, reject) => wx.uploadFile({
    url: `${getApiBaseUrl()}/api/files?kind=${kind}`, filePath, name: 'file',
    header: { Authorization: `Bearer ${wx.getStorageSync('accessToken')}` },
    success(response) {
      const body = JSON.parse(response.data)
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(body.data)
      else reject(new Error(body.error?.message || '文件上传失败'))
    }, fail: reject
  }))
}

const uploadPhoto = (filePath) => upload(filePath, 'photo')
const uploadSignature = (filePath) => upload(filePath, 'signature')
module.exports = { request, publicRequest, saveSession, uploadPhoto, uploadSignature }
