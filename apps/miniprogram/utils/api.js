const { getApiBaseUrl } = require('../config/env')

const apiUrl = (path) => `${getApiBaseUrl()}${path.replace(/^\/api(?=\/|$)/, '')}`

function rawRequest(path, method, data, token) {
  return new Promise((resolve, reject) => wx.request({
    url: apiUrl(path), method, data: data ?? (method === 'GET' ? undefined : {}),
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

const uploadPhoto = (filePath) => upload(filePath, 'photo')
const uploadSignature = (filePath) => upload(filePath, 'signature')
module.exports = { request, publicRequest, saveSession, clearSession, logout, logoutAll, uploadPhoto, uploadSignature, download }
