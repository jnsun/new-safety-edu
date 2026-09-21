import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(app, /login-card-shell\$\{loginMode === "password" \? " is-flipped" : ""\}/);
assert.match(app, /className="login-flip-inner"/);
assert.match(app, /login-face login-face-wechat/);
assert.match(app, /login-face login-face-password/);
assert.match(app, /inert=\{loginMode !== "wechat"\}/);
assert.match(app, /inert=\{loginMode !== "password"\}/);

assert.match(styles, /\.login-card-shell \{ width: 420px; height: 590px; min-height: 590px;/);
assert.match(styles, /\.login-flip-inner \{ width: 100%; height: 100%; min-height: 0;/);
assert.match(styles, /\.login-face \.login-card \{ width: 100%; height: 100%; \}/);
assert.match(styles, /\.login-card \.ant-card-body \{ height: 100%; min-height: 0; box-sizing: border-box;/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.login-flip-inner,/);

console.log("LOGIN_CARD_UI_OK");
