const { getApiBaseUrl } = require('../config/env')

const apiUrl = (path) => `${getApiBaseUrl()}${path.replace(/^\/api(?=\/|$)/, '')}`

function rawRequest(path, method, data, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => wx.request({
    url: apiUrl(path), method, data: data ?? (method === 'GET' ? undefined : {}),
    header: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data)
      else { const error = new Error(response.data?.error?.message || '请求失败'); error.statusCode = response.statusCode; error.code = response.data?.error?.code; reject(error) }
    }, fail: reject
  }))
}

function saveSession(data) {
  wx.setStorageSync('accessToken', data.accessToken)
  wx.setStorageSync('refreshToken', data.refreshToken)
  wx.removeStorageSync('loggedOut')
}

function clearSession() {
  wx.removeStorageSync('accessToken')
  wx.removeStorageSync('refreshToken')
  wx.setStorageSync('loggedOut', true)
}

async function logout() {
  try { await request('/api/auth/logout', 'POST') } finally { clearSession() }
}

async function logoutAll() {
  try { await request('/api/auth/logout-all', 'POST') } finally { clearSession() }
}

async function request(path, method = 'GET', data, extraHeaders = {}) {
  try { return await rawRequest(path, method, data, wx.getStorageSync('accessToken'), extraHeaders) }
  catch (error) {
    const refreshToken = wx.getStorageSync('refreshToken')
    if (error.statusCode !== 401 || !refreshToken) throw error
    const session = await rawRequest('/api/auth/refresh', 'POST', { refreshToken })
    saveSession(session)
    return rawRequest(path, method, data, session.accessToken, extraHeaders)
  }
}
const publicRequest = (path, method = 'GET', data) => rawRequest(path, method, data)

function upload(filePath, kind) {
  return new Promise((resolve, reject) => wx.uploadFile({
    url: apiUrl(`/files?kind=${kind}`), filePath, name: 'file',
    header: { Authorization: `Bearer ${wx.getStorageSync('accessToken')}` },
    success(response) {
      const body = JSON.parse(response.data)
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(body.data)
      else reject(new Error(body.error?.message || '文件上传失败'))
    }, fail: reject
  }))
}

function download(path) {
  return new Promise((resolve, reject) => wx.downloadFile({
    url: apiUrl(path), header: { Authorization: `Bearer ${wx.getStorageSync('accessToken')}` },
    success(response) { if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.tempFilePath); else reject(new Error('文件读取失败')); }, fail: reject
  }))
}

function downloadPost(path, data) {
  return new Promise((resolve, reject) => wx.request({
    url: apiUrl(path), method: 'POST', data, responseType: 'arraybuffer',
    header: { 'content-type': 'application/json', Authorization: `Bearer ${wx.getStorageSync('accessToken')}` },
    success(response) {
      if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error('资料文件下载失败'))
      const target = `${wx.env.USER_DATA_PATH}/我的安全生产资料-${Date.now()}.zip`
      wx.getFileSystemManager().writeFile({ filePath: target, data: response.data, success: () => resolve(target), fail: reject })
    }, fail: reject
  }))
}

const uploadPhoto = (filePath) => upload(filePath, 'photo')
const uploadSignature = (filePath) => upload(filePath, 'signature')
const uploadAttachment = (filePath) => upload(filePath, 'attachment')
module.exports = { request, publicRequest, saveSession, clearSession, logout, logoutAll, uploadPhoto, uploadSignature, uploadAttachment, download, downloadPost }
