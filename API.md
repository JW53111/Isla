# Isla 本地 Agent Bridge

Isla 可以在本机提供一个受令牌保护的 HTTP 接口，供 AstrBot 插件或其他可信本地程序调用。接口直接使用 Isla 的 Agent runtime，因此聊天会复用 DeepSeek/OpenAI-compatible 配置、SOUL、记忆、技能和工具；每个外部会话会持久化到 Isla 工作空间。

Bridge 默认关闭。启动 Isla 前设置环境变量：

```powershell
$env:ISLA_BRIDGE_TOKEN = [guid]::NewGuid().ToString('N')
$env:ISLA_BRIDGE_PORT = '43123'
npm start
```

令牌至少需要 32 字节。服务只绑定 `127.0.0.1`，所有端点都要求 `Authorization: Bearer <令牌>`。不要把令牌提交到 Git，也不要把 Bridge 端口转发到公网。AstrBot 与 Isla 需要运行在同一台电脑上，或由你自行配置可信的安全隧道。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/health` | 查看服务是否可用 |
| `GET` | `/v1/pet/state` | 读取当前动作、窗口位置和显示状态 |
| `POST` | `/v1/pet/action` | 切换到 Isla 已有的动作 |
| `POST` | `/v1/pet/say` | 在 Isla 头顶显示短气泡，可选触发动作 |
| `POST` | `/v1/chat` | 使用 Isla Agent 对话并保存指定会话 |

所有 POST 请求都使用 JSON，最大请求体 32 KB；每个本机地址每分钟最多 30 个请求。

## 示例

```powershell
$headers = @{ Authorization = "Bearer $env:ISLA_BRIDGE_TOKEN" }

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:43123/v1/chat' `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body (@{ sessionId = 'qq:private:123456'; text = 'Isla，帮我列一下今天的计划' } | ConvertTo-Json)
```

`sessionId` 必须是 1–120 位的字母、数字、下划线、点、冒号、`@` 或连字符。建议 QQ 私聊使用 `qq:private:<user_id>`，群聊使用 `qq:group:<group_id>:<user_id>`，避免不同人的上下文混在一起。

让桌宠说话：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:43123/v1/pet/say' `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body (@{ text = '收到，我来帮你看看。'; actionId = 'new-message' } | ConvertTo-Json)
```

`/v1/pet/action` 和 `/v1/pet/say` 的 `actionId` 必须存在于当前桌宠动作表中。Bridge 没有任意命令执行或文件读写端点。
