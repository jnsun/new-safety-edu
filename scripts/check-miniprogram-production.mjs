import { readFile, readdir } from "node:fs/promises";

const root = new URL("../apps/miniprogram/", import.meta.url);
const project = JSON.parse(await readFile(new URL("project.config.json", root), "utf8"));
const files = (await readdir(root, { recursive: true })).filter((name) => /\.(js|json|wxml|wxss)$/.test(name));
const source = (await Promise.all(files.map((name) => readFile(new URL(name.replaceAll("\\", "/"), root), "utf8")))).join("\n");
const requiredBase = "https://www.safety.sx.cn/api";
const failures = [];

if (!source.includes(requiredBase)) failures.push("正式 API base 未配置");
if (/http:\/\/|140\.143\.247\.55|dev:/.test(source)) failures.push("仍包含 HTTP、IP 或 Mock 标记");
if (/WECHAT_APP_SECRET/.test(source)) failures.push("小程序包包含 AppSecret 配置");
if (project.setting?.urlCheck !== true) failures.push("合法域名校验未开启");
if (!project.appid || project.appid === "touristappid") failures.push("尚未写入正式 AppID");

if (failures.length) throw new Error(failures.join("；"));
console.log("MINIPROGRAM_PRODUCTION_CHECK=PASS");
