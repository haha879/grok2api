# Grok2API - 项目文档

> 基于 FastAPI 的 Grok API 代理服务，提供 OpenAI 兼容接口，支持流/非流式对话、图像生成/编辑、视频生成，集成 Token 池管理、OAuth 登录与积分系统。

## 项目愿景

将 Grok AI 服务转换为标准 OpenAI 兼容 API，便于现有应用无缝集成，同时提供企业级的 Token 池管理、配额追踪和多存储后端支持。本 fork 额外集成了 LINUX DO OAuth 登录和积分系统。

## 架构总览

```
grok2api/
├── main.py                 # FastAPI 应用入口，路由注册与生命周期管理
├── _public/                # 前端静态资源（v1.6.0 新目录结构）
│   ├── favicon.ico
│   └── static/
│       ├── admin/          # 管理后台页面 (login, token, config, cache)
│       ├── common/         # 公共资源 (CSS, JS, HTML headers, i18n)
│       ├── function/       # 功能玩法页面 (chat, imagine, video, voice, login)
│       └── i18n/           # 国际化语言文件
├── app/
│   ├── api/v1/             # RESTful API 路由层
│   │   ├── chat.py         # POST /v1/chat/completions
│   │   ├── image.py        # POST /v1/images/generations, /v1/images/edits
│   │   ├── video.py        # POST /v1/videos (视频生成 API)
│   │   ├── response.py     # POST /v1/responses (responses API)
│   │   ├── models.py       # GET /v1/models
│   │   ├── files.py        # 文件服务
│   │   ├── admin/          # 管理后台 API
│   │   ├── admin_api/      # 管理后台 API (v2)
│   │   └── function/       # 功能玩法 API（原 public_api）
│   │       ├── __init__.py # 路由聚合
│   │       ├── imagine.py  # 图像瀑布流
│   │       ├── video.py    # 视频生成
│   │       ├── voice.py    # 语音对话
│   │       └── oauth.py    # [Fork] LINUX DO OAuth 登录
│   ├── api/pages/          # HTML 页面路由
│   │   ├── admin.py        # 管理后台页面
│   │   └── function.py     # 功能玩法页面
│   ├── core/               # 核心基础设施
│   │   ├── config.py       # 配置管理 (TOML + 多存储后端 + 废弃配置迁移)
│   │   ├── storage.py      # 统一存储抽象 (Local/Redis/MySQL/PgSQL)
│   │   ├── auth.py         # API 密钥验证 + OAuth token 验证
│   │   ├── logger.py       # Loguru 日志配置
│   │   ├── exceptions.py   # 异常体系
│   │   └── response_middleware.py  # 请求日志中间件
│   ├── services/
│   │   ├── grok/           # Grok 上游服务封装
│   │   │   ├── services/   # 业务服务 (chat, image, media, voice, usage, nsfw)
│   │   │   ├── processors/ # 流式响应处理器
│   │   │   ├── protocols/  # gRPC-Web 协议
│   │   │   ├── models/     # 模型元数据管理
│   │   │   └── utils/      # 工具函数 (headers, retry, statsig, stream)
│   │   ├── token/          # Token 池管理
│   │   │   ├── manager.py  # TokenManager 单例
│   │   │   ├── pool.py     # TokenPool 实现
│   │   │   ├── models.py   # TokenInfo 数据模型
│   │   │   ├── scheduler.py# 定时刷新调度器
│   │   │   └── service.py  # Token 服务接口
│   │   ├── credits/        # [Fork] 积分系统
│   │   │   ├── manager.py  # CreditsManager (Local/Redis/SQL)
│   │   │   └── models.py   # UserCredits 数据模型
│   │   └── cf_refresh/     # CF Clearance 自动刷新
├── config.defaults.toml    # 默认配置基线
├── data/                   # 运行时数据目录
│   ├── config.toml         # 用户配置
│   ├── token.json          # Token 持久化
│   └── credits.json        # 积分数据持久化 (LocalStorage)
├── Dockerfile              # 容器构建 (granian)
└── docker-compose.yml      # 编排配置
```

## 模块索引

| 模块路径 | 职责 | 入口文件 |
|---------|------|---------|
| `app/api/v1` | RESTful API 路由定义 | `chat.py`, `image.py`, `video.py` |
| `app/api/v1/function` | 功能玩法 API (原 public_api) | `imagine.py`, `video.py`, `voice.py`, `oauth.py` |
| `app/api/v1/admin` | 管理后台 API | - |
| `app/api/pages` | HTML 页面路由 | `admin.py`, `function.py` |
| `app/core` | 基础设施：配置、存储、认证、日志 | `config.py`, `storage.py`, `auth.py` |
| `app/services/grok` | Grok 上游服务封装与流式处理 | `services/chat.py`, `services/image.py` |
| `app/services/token` | Token 池管理、配额追踪、自动刷新 | `manager.py`, `pool.py` |
| `app/services/credits` | [Fork] 积分系统 | `manager.py`, `models.py` |
| `_public/static` | 前端静态资源 | `admin/`, `common/`, `function/` |

## Fork 特有功能

### LINUX DO OAuth 登录
- 路由: `/v1/function/oauth/*`
- 配置: `config.toml` → `[oauth]` 段
- 支持 linux.do 社区账号登录，自动创建积分账户

### 积分系统
- 模块: `app/services/credits/`
- 配置: `config.toml` → `[credits]` 段
- 功能: 新用户初始积分、每日签到、图片/视频消耗积分
- 存储: 自动适配 Local/Redis/SQL 后端

## 运行与开发

### 环境要求

- Python >= 3.13
- 包管理器：[uv](https://github.com/astral-sh/uv)
- Web 服务器：Granian（v1.6.0 替换了 Uvicorn）

### 本地开发

```bash
# 安装依赖
uv sync

# 启动服务（推荐方式）
uv run granian --interface asgi --host 0.0.0.0 --port 8000 main:app

# 开发模式（自动重载）
uv run granian --interface asgi --host 0.0.0.0 --port 8000 --reload main:app
```

### Docker 部署

```bash
docker compose up -d
```

### 环境变量

| 变量名 | 说明 | 默认值 |
|-------|------|-------|
| `LOG_LEVEL` | 日志级别 | `INFO` |
| `DATA_DIR` | 数据目录 | `./data` |
| `SERVER_HOST` | 监听地址 | `0.0.0.0` |
| `SERVER_PORT` | 监听端口 | `8000` |
| `SERVER_WORKERS` | Worker 数 | `1` |
| `SERVER_STORAGE_TYPE` | 存储类型 (local/redis/mysql/pgsql) | `local` |
| `SERVER_STORAGE_URL` | 存储连接串 | `""` |
| `FLARESOLVERR_URL` | FlareSolverr 地址 (CF 自动刷新) | `""` |

### 配置文件

主配置文件：`data/config.toml`（基于 `config.defaults.toml`），结构分为：

- `[app]` - 应用设置 (app_url, app_key, api_key, function_enabled, function_key)
- `[proxy]` - 代理配置 (base_proxy_url, cf_cookies, browser, user_agent)
- `[retry]` - 重试策略
- `[token]` - Token 池管理
- `[cache]` - 缓存管理
- `[chat]` - 对话配置
- `[image]` - 图像配置
- `[imagine_fast]` - SuperImage 配置
- `[video]` - 视频配置
- `[voice]` - 语音配置
- `[asset]` - 资产管理
- `[nsfw]` - NSFW 批量配置
- `[usage]` - 用量配置
- `[oauth]` - [Fork] OAuth 登录配置
- `[credits]` - [Fork] 积分系统配置

## 对外接口

### OpenAI 兼容 API

| 端点 | 方法 | 说明 |
|-----|------|-----|
| `/v1/chat/completions` | POST | 聊天补全 (支持流式、多模态、Tool Calling) |
| `/v1/images/generations` | POST | 图像生成 |
| `/v1/images/edits` | POST | 图像编辑 (multipart/form-data) |
| `/v1/videos` | POST | 视频生成 |
| `/v1/models` | GET | 可用模型列表 |

### 功能玩法接口

| 端点 | 说明 |
|-----|------|
| `/v1/function/verify` | Function Key 验证 |
| `/v1/function/imagine/*` | 图像瀑布流 |
| `/v1/function/video/*` | 视频生成 (SSE) |
| `/v1/function/voice/*` | 语音对话 |
| `/v1/function/oauth/*` | [Fork] OAuth 登录 |

### 管理接口

| 端点 | 说明 |
|-----|------|
| `/admin/login` | 管理后台登录 |
| `/v1/admin/verify` | 登录验证 |
| `/v1/admin/config` | 配置管理 |
| `/v1/admin/tokens` | Token 管理 |
| `/v1/admin/cache` | 缓存管理 |

## 编码规范

- 代码风格: `ruff` (配置在 pyproject.toml)
- 类型提示: 推荐使用 Python 3.13+ 类型语法
- 异步: 全异步 I/O (aiohttp, aiofiles, async SQLAlchemy)
- 日志: 使用 `app.core.logger.logger` 而非 print
- 配置: 通过 `get_config("section.key", default)` 访问
- Web 服务器: Granian (替代 Uvicorn)

## AI 使用指引

### 代码修改

1. 修改 API 路由在 `app/api/v1/`
2. 修改功能玩法在 `app/api/v1/function/`
3. 修改 Grok 服务逻辑在 `app/services/grok/`
4. 修改 Token 管理在 `app/services/token/`
5. 修改积分系统在 `app/services/credits/`
6. 修改前端页面在 `_public/static/`（注意：不再使用 `app/static/`）
7. 配置默认值在 `config.defaults.toml` 和 `app/services/grok/defaults.py`

### 关键依赖

- FastAPI + Granian: Web 框架 + ASGI 服务器
- curl_cffi: HTTP 客户端 (浏览器指纹模拟)
- aiohttp/aiohttp-socks: WebSocket 与代理
- SQLAlchemy: 数据库 ORM
- Redis: 分布式缓存/存储
- Pydantic: 数据验证
- orjson: 高性能 JSON 序列化

### 调试建议

```bash
# 启用调试日志
LOG_LEVEL=DEBUG uv run granian --interface asgi --host 0.0.0.0 --port 8000 main:app

# 检查 Token 状态
curl -X GET http://localhost:8000/v1/admin/tokens -H "Authorization: Bearer YOUR_API_KEY"
```

## 变更记录 (Changelog)

### 2026-03-06

- 同步上游 v1.6.0 (rebuild-v1.6.0 分支)
- 目录重构: `app/static/` → `_public/`, `public_api` → `function`
- Web 服务器: uvicorn → granian
- 移植 OAuth 登录到 `app/api/v1/function/oauth.py`
- 移植积分系统到 `app/services/credits/`
- 前端适配新路径和 i18n 支持

### 2026-02-09

- 初始化项目架构文档
- 完成全仓扫描与模块识引

---

*本文档最后更新：2026-03-06*
