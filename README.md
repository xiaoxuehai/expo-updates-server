# expo-updates-server

自托管的 Expo Updates 服务端，用 [Hono](https://hono.dev) + `@hono/node-server` 实现，按 [expo-updates 协议](https://docs.expo.dev/technical-specs/expo-updates-1/) 给客户端下发 OTA manifest / 资源 / 回滚指令。

## 特性

- **HTTP API 驱动** — 发布 / 回滚全部走 REST 接口，CI 友好
- **Scalar API 文档** — 访问 `/reference` 即可查看完整 API 文档
- **显式 `deployment.json` 管理 active 版本** — 可回滚到任意历史发布或 embedded
- **每次发布带 `release.json` 元数据** — UUID、备注、来源
- **代码签名支持** — RSA-SHA256，对齐 `expo-updates` 客户端 `codeSigningCertificate` 配置
- **协议级 directive** — 支持 v1 的 `rollBackToEmbedded` 和 `noUpdateAvailable`

---

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备代码签名密钥（可选但推荐）

项目自带一组示例 key 在 `code-signing-keys/`，**生产环境务必自己重新生成**：

```bash
npx expo-updates codesigning:generate \
  --key-output-directory code-signing-keys/ \
  --certificate-output-directory code-signing-keys/ \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "Your App"
```

会产出：

| 文件 | 用途 |
|---|---|
| `private-key.pem` | 服务端签名用（**别进版本控制**） |
| `certificate.pem` | 客户端验签用（拷到客户端工程） |
| `public-key.pem` | 一般不直接用 |

### 3. 配置环境变量

复制 `.env.example` 为 `.env.local` 并修改：

```ini
HOSTNAME=http://10.0.2.2:3000
PRIVATE_KEY_PATH=code-signing-keys/private-key.pem
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOSTNAME` | （必填） | 拼进 manifest 里的 asset URL，**必须是客户端能访问到的地址**。Android emulator 用 `http://10.0.2.2:<port>`；iOS / 真机 / 生产用真实 IP 或域名 |
| `PRIVATE_KEY_PATH` | 不签名 | 私钥路径，相对项目根；不设则不支持签名 |
| `UPDATES_DIR` | `updates` | 发布产物根目录 |
| `PORT` | `3000` | 服务端口 |

### 4. 启动

```bash
pnpm dev    # tsx watch，开发用
pnpm start  # 无 watch，部署用
```

启动后访问 `http://localhost:3000/reference` 查看 API 文档。

---

## Docker 部署

### 用 docker compose（推荐）

创建 `.env` 文件配置环境变量：

```ini
HOSTNAME=https://updates.example.com
PRIVATE_KEY_PATH=/secrets/private-key.pem
```

如果需要代码签名，在 `docker-compose.yml` 中挂载私钥文件：

```yaml
volumes:
  - updates-data:/data/updates
  - ./code-signing-keys/private-key.pem:/secrets/private-key.pem:ro  # 可选
```

然后启动：

```bash
# 构建并启动
docker compose up -d --build

# 看日志
docker compose logs -f

# 停掉但保留卷里的数据
docker compose down

# 连数据一起清掉（小心）
docker compose down -v
```

### 用纯 docker run

```bash
docker build -t expo-updates-server:latest .

docker run -d \
  --name expo-updates-server \
  --restart unless-stopped \
  -p 3000:3000 \
  -e HOSTNAME=https://updates.example.com \
  -e PRIVATE_KEY_PATH=/secrets/private-key.pem \
  -v "$(pwd)/updates:/data/updates" \
  -v "$(pwd)/code-signing-keys/private-key.pem:/secrets/private-key.pem:ro" \
  expo-updates-server:latest
```

### 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | |
| `UPDATES_DIR` | `updates` | 挂载到 `./updates` |
| `PRIVATE_KEY_PATH` | `/secrets/private-key.pem` | 挂载文件 |
| `HOSTNAME` | （Docker 默认会设容器 ID，**必须覆盖**） | 客户端可访问的 base URL |
| `NODE_ENV` | `production` | |

### 数据备份

挂载在宿主的 `./updates` 是**唯一的状态**：

```bash
tar czf updates-$(date +%F).tar.gz updates/
```

私钥单独备份到 secrets manager / 加密存储，**不要**和 updates 数据混在一起。

---

## 客户端配置

### 修改 app.json

```json
{
  "expo": {
    "runtimeVersion": "2",
    "updates": {
      "url": "http://10.0.2.2:3000/api/manifest",
      "enabled": true,
      "fallbackToCacheTimeout": 30000,
      "codeSigningCertificate": "./code-signing/certificate.pem",
      "codeSigningMetadata": {
        "keyid": "main",
        "alg": "rsa-v1_5-sha256"
      }
    },
    "plugins": [
      ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
    ]
  }
}
```

| 字段 | 说明 |
|---|---|
| `runtimeVersion` | 必须和服务端 `updates/<rv>/` 目录的 rv 字符串完全一致 |
| `updates.url` | 指向 `/api/manifest`，host:port 必须能从客户端访问到 |
| `usesCleartextTraffic: true` | 只在用 `http://` 时需要；生产用 HTTPS 可以删 |
| `codeSigningCertificate` | 客户端工程里的证书文件路径；不签名可整段删 |

### 拷证书到客户端

```bash
mkdir -p path/to/your-client/code-signing
cp code-signing-keys/certificate.pem path/to/your-client/code-signing/certificate.pem
```

---

## API

启动后访问 `/reference` 查看完整的交互式 API 文档（Scalar）。

### `GET /`

健康检查。

### `GET /api/manifest`

Expo 客户端拉 manifest（**协议规定路径**）。

请求头：`expo-platform` / `expo-runtime-version` / `expo-protocol-version` / `expo-current-update-id` / `expo-embedded-update-id` / `expo-expect-signature`。

Query（浏览器调试用）：`platform` / `runtime-version`。

响应：`multipart/mixed`，根据 `deployment.active` 状态返回 manifest / rollBack directive / noUpdate directive。

### `GET /api/assets`

Expo 客户端拉具体资源（**协议规定路径**）。

Query：`asset` / `runtimeVersion` / `platform`。

### `POST /api/deploy`

上传一份新发布。`multipart/form-data`：

| 字段 | 类型 | 必传 | 说明 |
|---|---|---|---|
| `runtimeVersion` | string | 是 | 目标 runtimeVersion |
| `bundle` | file (zip) | 是 | dist/ 内容打成的 zip，根直接是 metadata.json / expoConfig.json |
| `notes` | string | 否 | 备注信息 |
| `setActive` | `"true"` / `"false"` | 否 | 默认 `"true"`；`"false"` 时只落盘不切流量 |

响应 `201`：

```json
{ "id": "<uuid>", "runtimeVersion": "2", "dir": "20260524121143", "publishedAt": "...", "active": true }
```

### `POST /api/rollback`

回滚到指定版本。`application/json`：

```json
{
  "runtimeVersion": "2",
  "target": "20260524103217",
  "reason": "payment crash"
}
```

| 字段 | 说明 |
|---|---|
| `runtimeVersion` | 目标 runtimeVersion |
| `target` | 发布目录名 或 `"embedded"`（回滚到原生包内嵌版本） |
| `reason` | 可选，回滚原因 |

响应 `200`：

```json
{ "runtimeVersion": "2", "from": "20260524121143", "to": "20260524103217", "reason": "payment crash" }
```

---

## 发布流程

### zip 包要求

上传的 zip 包必须包含以下文件，**根目录直接是这些文件**（不能套一层目录）：

| 文件 | 必须 | 来源 |
|---|---|---|
| `metadata.json` | 是 | `npx expo export` 自动生成 |
| `expoConfig.json` | 是 | 需手动生成（见下方脚本） |
| `_expo/` | 是 | `npx expo export` 自动生成，包含 JS bundle |
| `assets/` | 是 | `npx expo export` 自动生成，包含静态资源 |

> **`expoConfig.json` 不会由 `expo export` 自动生成**，需要用 `@expo/config` 从 `app.json` 导出。缺少此文件服务端会返回 `Bundle missing required file: expoConfig.json`。

### 方式一：使用 example 中的脚本（推荐）

`example/scripts/deploy.ts` 是一键发布脚本，自动完成导出、生成 `expoConfig.json`、打包、上传：

```bash
cd example

# 基础用法（runtimeVersion 从 app.json 自动读取）
pnpm deploy

# 带备注
pnpm deploy --notes "fix login crash"

# 指定服务端地址
pnpm deploy --server http://192.168.1.100:3000

# 只落盘不切流量（用于灰度/staging）
pnpm deploy --no-set-active

# 组合使用
SERVER=http://192.168.1.100:3000 pnpm deploy --notes "hotfix"
```

脚本流程：
1. `npx expo export` — 导出 bundle 和 assets 到 `dist/`
2. `@expo/config` — 从 `app.json` 生成 `expoConfig.json` 到 `dist/`
3. `archiver` — 将 `dist/` 内容打成 zip
4. `POST /api/deploy` — 上传到服务端

### 方式二：手动操作

```bash
# 1. 导出 bundle
npx expo export

# 2. 生成 expoConfig.json
node -e "const {getConfig}=require('@expo/config');const {exp}=getConfig('.',{skipSDKVersionRequirement:true,isPublicConfig:true});require('fs').writeFileSync('dist/expoConfig.json',JSON.stringify(exp))"

# 3. 打包（在 dist/ 目录内打包，确保 zip 根直接是文件）
cd dist && zip -r ../bundle.zip . && cd ..

# 4. 上传
curl -X POST http://localhost:3000/api/deploy \
  -F "runtimeVersion=2" \
  -F "bundle=@bundle.zip" \
  -F "notes=fix login crash"
```

---

## 目录结构

```
updates/
├─ 2/                          <- runtimeVersion
│  ├─ deployment.json          <- active 指针 + history
│  ├─ 20260524121143/          <- 一次发布（YYYYMMDDHHmmss）
│  │  ├─ release.json          <- UUID + publishedAt + notes + source
│  │  ├─ metadata.json         <- expo export 索引
│  │  ├─ expoConfig.json       <- app.json 公开配置快照
│  │  ├─ _expo/static/js/{ios,android}/AppEntry-xxx.hbc
│  │  └─ assets/<md5>
│  └─ 20260524103217/
│     └─ ...
└─ 1/
   └─ ...
```

`deployment.json` 示例：

```json
{
  "active": "20260524121143",
  "previous": "20260524103217",
  "history": [
    { "at": "...", "from": null,              "to": "20260524103217", "reason": "upload" },
    { "at": "...", "from": "20260524103217",  "to": "embedded",      "reason": "payment crash" },
    { "at": "...", "from": "embedded",        "to": "20260524121143", "reason": "fix verified" }
  ]
}
```

---

## 项目结构

```
src/
├─ index.ts                    <- OpenAPIHono 入口 + 路由挂载
├─ openapi.ts                  <- OpenAPI 路由定义 + Zod schemas
├─ core/                       <- 非 HTTP 层业务/协议逻辑
│  ├─ crypto.ts                <- 哈希 / Base64URL / RSA 签名
│  ├─ signing.ts               <- 私钥读取 + signPayloadIfRequestedAsync
│  ├─ directives.ts            <- rollBack / noUpdate directive 工厂
│  ├─ deployment.ts            <- deployment.json + release.json 读取
│  └─ bundle.ts                <- metadata.json / expoConfig.json / asset 读取
└─ routes/
   ├─ health/index.ts         <- GET /
   ├─ manifest/index.ts       <- GET /api/manifest
   ├─ assets/index.ts         <- GET /api/assets
   └─ release/
      ├─ deploy.ts            <- POST /api/deploy
      ├─ rollback.ts          <- POST /api/rollback
      └─ query.ts             <- GET /api/runtime-versions | /api/updates | /api/deployment
```

---

## 上生产前的检查清单

- [ ] **`HOSTNAME` 改成线上域名**（不是 `localhost` / `10.0.2.2`）
- [ ] **走 HTTPS** — 生产删掉 `usesCleartextTraffic`，用 nginx/Caddy/Traefik 反代
- [ ] **`/api/deploy` 和 `/api/rollback` 加鉴权** — 当前裸跑，任何能访问端口的人都能上传更新或回滚
- [ ] **`updates/` 目录纳入备份** — 这是服务端唯一的状态
- [ ] **私钥别进版本控制**，从 secrets manager 注入
- [ ] **runtimeVersion 改动 = 全量切换通道**，老 app 拉不到新 rv 的更新
- [ ] **磁盘水位监控** — 每次发布 5–20 MB，可定期归档老 release 目录

---

## 常见问题

### 拉到 manifest 但 app 不更新

1. **HOSTNAME 不对** — manifest 里 asset URL 用的 host 客户端访问不到
2. **runtimeVersion 不匹配** — 客户端 app.json 的 rv 和服务端目录名对不上
3. **代码签名不匹配** — 客户端配了证书但服务端没配私钥（或反过来），或密钥不是一对

### `POST /api/deploy` 返回 `Bundle missing required file: metadata.json`

zip 的根必须**直接是** `metadata.json` 等文件。打包时进 `dist/` 再 `zip -r ../bundle.zip .`。

### `No deployment found for runtime version: X`

该 runtimeVersion 还没做过任何发布。第一次发布会自动创建 `deployment.json`。

---

## 进一步阅读

- [Expo Updates 协议规范](https://docs.expo.dev/technical-specs/expo-updates-1/)
