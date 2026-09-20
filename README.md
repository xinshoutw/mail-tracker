<div align="center">

# Mail Tracker

[![License](https://img.shields.io/github/license/xinshoutw/mail-tracker?style=for-the-badge)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](extension)

自架的郵件開信追蹤。五分鐘安裝完成，跑在 Cloudflare 免費額度上。

**繁體中文** | [English](README-en.md)

</div>

## 總覽

Mail Tracker 在你寄出的信裡埋入一個看不見的 1x1 像素。收件人開信時像素會發出請求，
這次開信就被記錄下來 —— 誰、何時、從哪裡。

Chrome 擴充功能會在你按下寄送時把像素注入 Gmail，每位收件人各一個，並在寄件備份旁
顯示已讀標記。Cloudflare Worker 負責提供像素、過濾雜訊，並把資料存進你自己的 KV
namespace。全程沒有第三方碰得到這些資料。

### 功能

- **自動追蹤** — 按下寄送時，擴充功能為每位收件人注入一個像素
- **已讀標記** — Gmail 寄件備份的收件人旁顯示單勾與雙勾
- **自開信過濾** — 你自己打開信件討論串，不會被算成收件人讀了信
- **通知** — Chrome、Slack、Discord，且只在開信通過過濾後才發出
- **自架** — 你的 Cloudflare 帳號、你的 KV namespace，中間沒有任何廠商
- **零執行期相依** — 原生 JavaScript，無框架、無建置步驟

### 運作方式

1. 你在 Gmail 按下寄送。擴充功能為每位收件人建立一個 tracker，並在信件本文放入一個
   隱形的 `<img>`。
2. 收件人開信。他的郵件客戶端向你的 Worker 抓取那個像素。
3. Worker 記錄 IP、國家、user agent 與時間，接著跑三道過濾：寄件者 IP、已知掃描器、
   以及針對重複請求的五秒窗口。
4. 這次開信會先**排入佇列**，而不是立刻通知。
5. 如果打開討論串的其實是你自己，擴充功能會在那個窗口內通知 Worker 重新歸類為自開信。
6. Cron 在幾分鐘內排空佇列，只針對剩下的開信通知你。

第 4 到 6 步的延遲正是重點所在：它讓「你自己讀了那封信」不會被誤報成「收件人開信了」。

## 展示

https://github.com/user-attachments/assets/5470a2ce-9076-407d-8961-1ade0ea8329f

<br/>

## 快速開始

### 需求

- Node 20 以上
- pnpm
- 已啟用 Workers 與 KV 的 Cloudflare 帳號

### 部署

```bash
git clone https://github.com/xinshoutw/mail-tracker.git
cd mail-tracker
pnpm install

pnpm exec wrangler kv namespace create "TRACKER"   # 把輸出的 id 貼進 wrangler.toml
pnpm exec wrangler secret put DASHBOARD_PASSWORD   # 必要
pnpm run deploy
```

> [!IMPORTANT]
> `DASHBOARD_PASSWORD` 不是選用的。沒有設定時，Worker 會對所有路由回應 `503`，
> 而不是把你的收件人、主旨與開信者 IP 攤在任何找到網址的人面前。追蹤端點
> `/t/:id` 維持開放，郵件客戶端才載得到像素。

> [!IMPORTANT]
> `wrangler.toml` 必須宣告 cron trigger。排入佇列的通知是由 scheduled handler
> 排空的，少了它就一則 webhook 都發不出去。
>
> ```toml
> [triggers]
> crons = ["*/5 * * * *"]
> ```

### 擴充功能

到 [Releases](https://github.com/xinshoutw/mail-tracker/releases) 下載 zip 並解壓縮，
在 `chrome://extensions` 開啟開發人員模式，選擇**載入未封裝項目**。開啟擴充功能後填入
你的 Worker 網址與 dashboard 密碼。

### 本機開發

```bash
pnpm dev     # http://localhost:8787
pnpm test    # node --test，不需額外相依
```

本機執行時把 `DASHBOARD_PASSWORD=...` 放進 `.dev.vars`，該檔案已在 `.gitignore` 內。

<br/>

## 技術棧

| 項目 | 選用 |
|---|---|
| 執行環境 | Cloudflare Workers（V8 isolate，無 Node API） |
| 儲存 | Cloudflare KV，binding 為 `TRACKER` |
| 排程 | Cron trigger，每分鐘 |
| 擴充功能 | Chrome Manifest V3，原生 JS |
| 測試 | `node:test`，搭配記憶體內的 KV stub |
| 部署 | Cloudflare Workers Builds，push 到 `main` 觸發 |
| 相依 | 執行期為零；wrangler 僅用於建置 |

### 專案結構

```
src/index.js              Worker 進入點：路由、API handler、cron
src/shared.js             常數、認證、跳脫、像素、KV metadata
src/notifications.js      Slack 與 Discord webhook 發送
src/views/dashboard.js    列表頁（GET /）
src/views/detail.js       追蹤詳細頁（GET /s/:id）
extension/manifest.json   Manifest V3
extension/gmail.js        Content script：寄送時注入、自開信偵測
extension/popup.js        Popup：追蹤清單、詳細、設定
extension/background.js   Service worker：輪詢新的開信
test/worker.test.js       node --test 測試套件
wrangler.toml             KV binding 與 cron trigger
```

<br/>

## API

除了 `/t/:id` 之外所有路由都使用 HTTP Basic 認證。使用者名稱會被忽略，只看密碼，
密碼可以包含冒號。

| 端點 | 認證 | 說明 |
|---|:---:|---|
| `GET /` | 是 | Dashboard |
| `POST /new` | 是 | 以 `{ to?, subject?, bodyPreview?, messageId? }` 建立 tracker |
| `GET /t/:id` | 否 | 提供像素並記錄開信 |
| `GET /s/:id` | 是 | 追蹤詳細頁，或加 `?format=json` 取得 JSON 統計 |
| `GET /list` | 是 | 以 JSON 列出所有 tracker |
| `POST /self` | 是 | 將近期開信重新歸類為自開信，`{ ids: [...] }`，上限 50 |
| `DELETE /d/:id` | 是 | 刪除 tracker |

`/new` 與 `/d/:id` 刻意拒絕 `GET`：任何網頁都能用一個 `<img>` 標籤發出 `GET`，
而瀏覽器會自動帶上已快取的認證資訊。

```bash
curl -u :your-password -X POST -H 'Content-Type: application/json' \
     -d '{"to":"her@example.com","subject":"Hi"}' \
     https://your-worker.workers.dev/new

curl -u :your-password -X DELETE https://your-worker.workers.dev/d/THE_ID
```

<br/>

## 比較

| | Mail Tracker | Mailtrack | Streak | Superhuman | HubSpot |
|---|---|---|---|---|---|
| 價格 | 免費 | $9.99/月 | $49/月 | $30/月 | $45/月 |
| 自架 | 是 | 否 | 否 | 否 | 否 |
| 開源 | AGPL-3.0 | 否 | 否 | 否 | 否 |
| 不蒐集資料 | 是 | 否 | 否 | 否 | 否 |
| 已讀標記 | 是 | 是 | 是 | 是 | 否 |
| Slack 與 Discord | 是 | 否 | 否 | 否 | 是 |
| 自開信過濾 | 是 | 部分 | 部分 | 是 | 是 |

<br/>

## 限制

像素追蹤是推論，不是確證。在你依賴它之前，這些失效情境值得先知道：

- **停用圖片** — 沒有像素載入就沒有訊號。企業版 Outlook 常見。
- **Apple Mail Privacy Protection** — iOS 15 以後會透過 Apple 的代理預先抓取所有圖片，
  於是記錄到的是 Apple 的 IP 而非讀信者的。
- **Gmail 圖片快取** — Gmail 可能提供快取副本，導致同一個人之後的開信沒被記錄。
- **自開信過濾需要擴充功能** — 在 Gmail 以外、或沒安裝擴充功能的情況下讀取被追蹤的信件，
  可能被記成真實開信。
- **純文字** — Gmail 的純文字撰寫模式會剝除 `<img>`，只送純文字的客戶端也一樣。
  Gmail 預設送 HTML，所以只有在你主動切換時才會踩到。

<br/>

## 文件

| 檔案 | 內容 |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | 完整部署教學、擴充功能安裝、使用方式（英文） |
| [`docs/COST.md`](docs/COST.md) | Cloudflare 免費額度上限與實際費用估算（英文） |
| [`PASSWORD_SETUP.md`](PASSWORD_SETUP.md) | 設定 dashboard 密碼的三種方式（英文） |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 如何提出變更（英文） |
| [`CLAUDE.md`](CLAUDE.md) | 架構說明與慣例，供貢獻者與 AI agent 參考（英文） |

### 部署與 CI

| 流程 | 執行於 | 觸發條件 |
|---|---|---|
| Worker 部署 | Cloudflare Workers Builds | push 到 `main` |
| 測試與建置檢查 | GitHub Actions，`ci.yml` | push、pull request、手動 |
| 擴充功能發佈 | GitHub Actions，`release-extension.yml` | 推送 `v*` tag |

發佈擴充功能的做法是先更新 `extension/manifest.json` 的版號，再推送相符的 tag。
兩者不一致時發佈流程會直接失敗，而不會送出版號對不上的 zip。

```bash
git tag v1.2.0 && git push origin main v1.2.0
```

<br/>

## 貢獻

歡迎開 issue 與 pull request。送出前請先跑 `pnpm test`；CI 會執行同一套測試，
外加一次 Worker 的 dry-run 建置。

## 授權

[AGPL-3.0](LICENSE)。第 13 條適用於網路使用：只要你把修改過的版本部署到其他人
連得到的地方，就必須向他們提供原始碼。
