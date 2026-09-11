const { getApiBaseUrl } = require('../config/env')

function rawRequest(path, method, data, token) {
  return new Promise((resolve, reject) => wx.request({
    url: `${getApiBaseUrl()}${path}`, method, data,
    header: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    success(response) {
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data.data)
      else reject(new Error(response.data?.error?.message || '请求失败'))
    }, fail: reject
  }))
}

const request = (path, method = 'GET', data) => rawRequest(path, method, data, wx.getStorageSync('accessToken'))
const publicRequest = (path, method = 'GET', data) => rawRequest(path, method, data)

function uploadPhoto(filePath) {
  return new Promise((resolve, reject) => wx.uploadFile({
    url: `${getApiBaseUrl()}/api/files?kind=photo`, filePath, name: 'file',
    header: { Authorization: `Bearer ${wx.getStorageSync('accessToken')}` },
    success(response) {
      const body = JSON.parse(response.data)
      if (response.statusCode >= 200 && response.statusCode < 300) resolve(body.data)
      else reject(new Error(body.error?.message || '照片上传失败'))
    }, fail: reject
  }))
}

module.exports = { request, publicRequest, uploadPhoto }
