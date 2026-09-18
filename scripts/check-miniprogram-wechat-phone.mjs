import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const wxml = read('apps/miniprogram/pages/bind/index.wxml')
const page = read('apps/miniprogram/pages/bind/index.js')
const route = read('apps/api/src/routes/wechat.ts')

assert.match(wxml, /open-type="getPhoneNumber"/)
assert.match(wxml, /bindgetphonenumber="verifyWechatPhone"/)
assert.match(wxml, /改用短信验证/)
assert.match(page, /\/api\/wechat\/identity\/wechat-phone/)
assert.match(page, /wechatPhoneVerificationToken/)
assert.match(page, /showSmsFallback/)
assert.match(route, /getWechatPhoneNumber\(input\.code, deps\.env\)/)
assert.match(route, /status: "profile_required"/)
assert.doesNotMatch(wxml, /disabled="\{\{name\.length < 2 \|\| departmentIndex < 0/)
assert.doesNotMatch(`${wxml}\n${page}`, /WECHAT_APP_SECRET|access_token/)

console.log('MINIPROGRAM_WECHAT_PHONE_CHECK=PASS')
