# Ironmanfood 販售據點 Web App

這是一個可直接部署的獨立販售據點系統，參考附件 WordPress 外掛的資料欄位與流程改寫而成，不依賴 WordPress，也不使用 Google Map API。地圖採用 Leaflet + OpenStreetMap 圖資。

## 功能

- 前台：搜尋、區域/行政區篩選、地圖標記、據點列表、附近排序。
- 後台：登入、據點新增/編輯/刪除、負責人與電話前台顯示控制、外送支援勾選、顯示/隱藏、地圖取座標、CSV 匯入與匯出。
- 資料欄位：站別代碼、區域、商家名稱、縣市、行政區、地址、負責人、電話、是否顯示負責人、是否顯示電話、營業時間、是否支援 Uber、是否支援熊貓、緯度、經度、狀態、排序、地圖連結。
- LINE Official：可把前台網址或 LIFF URL 設到圖文選單的「販售據點」URI。

## 本機啟動

```bash
node server.js
```

開啟：

- 前台：http://localhost:3000/
- 後台：http://localhost:3000/admin.html

預設後台帳密：

- 帳號：`admin`
- 密碼：`admin12345`

正式上線前請改用環境變數設定：

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-strong-password
SESSION_SECRET=your-long-random-secret
node server.js
```

Windows PowerShell 可用：

```powershell
$env:ADMIN_USERNAME="admin"
$env:ADMIN_PASSWORD="your-strong-password"
$env:SESSION_SECRET="your-long-random-secret"
node server.js
```

也可以複製 `.env.example` 為 `.env` 後修改內容，`server.js` 會在啟動時讀取。

## 部署

此專案沒有 npm 套件依賴，支援 Node 18 以上。可部署到 Render、Railway、Zeabur、Fly.io、VPS 或 Docker 環境。

建議環境變數：

- `PORT`：平台指定連接埠，預設 `3000`
- `HOST`：預設 `0.0.0.0`
- `ADMIN_USERNAME`：後台帳號
- `ADMIN_PASSWORD`：後台密碼
- `SESSION_SECRET`：Cookie Session 簽章密鑰
- `DATA_DIR`：資料存放目錄，正式部署請指到持久化磁碟

Docker：

```bash
docker build -t store-locator .
docker run -p 3000:3000 -e ADMIN_PASSWORD=your-strong-password -e SESSION_SECRET=your-long-random-secret store-locator
```

## LINE Official 設定

1. 將此網站部署到 HTTPS 網址。
2. LINE Official Account Manager 的圖文選單中，把「販售據點」動作設為 URI。
3. 若只需要在 LINE 內建瀏覽器開啟，URI 填入前台網址即可，例如 `https://your-domain.example/`。
4. 若要更像 LINE 內嵌體驗，請在 LINE Developers 建立 LIFF App，Endpoint URL 填入前台網址，再把圖文選單 URI 改成 `https://liff.line.me/{LIFF_ID}`。

LINE 圖文選單本身不能把網頁直接嵌在聊天訊息泡泡內；URI 或 LIFF 會在 LINE 內建瀏覽器中顯示，使用者不需要跳到外部瀏覽器。

## CSV 欄位

匯入 CSV 第一列可使用英文欄位：

```csv
station_code,region,name,city,district,address,manager_name,phone,show_manager,show_phone,business_hours,support_uber,support_panda,lat,lng,status,sort_order,map_url
```

也支援常見中文欄位，例如：站別代碼、區域、商家名稱、縣市、行政區、地址、負責人、電話、顯示負責人、顯示電話、營業時間、是否支援Uber、是否支援熊貓、緯度、經度、狀態、排序、地圖連結。

外送與前台顯示欄位可填 `1`、`true`、`yes`、`是`、`有` 或 `支援` 表示開啟；空白或 `0` 表示關閉。

## 地圖與圖資

程式沒有使用 Google Map API。前台與後台地圖由 Leaflet 載入 OpenStreetMap tile。若正式站台流量很大，建議改接商用或自架的 OSM 相容 tile server。
