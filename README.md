# 桌宠生成器

一个基于 **Claude Code Skill** 的对话式桌宠生成工具。你只需要准备一张人物参考图，就可以跟着 Claude 的中文提示生成 Q 版动漫桌宠动作、精灵图，并打包成 macOS / Windows 桌面应用。

当前主流程是 Claude Code 里的 `/create-pet` skill。

---

## 适合谁使用？

- 想用一张照片或角色图生成桌面宠物的人
- 不熟悉代码，但可以按步骤填写配置、运行命令的小白用户
- 想定制动作、语气、陪伴风格的用户
- 想把桌宠打包成安装包分享给别人的用户

---

## 你需要准备什么？

### 1. 本地环境

需要先安装：

| 依赖 | 用途 | 建议 |
|---|---|---|
| Node.js | 运行脚本、安装依赖 | 建议 Node.js 20+ |
| npm | 安装依赖 | 随 Node.js 一起安装 |
| Claude Code | 运行 `/create-pet` skill | 必需 |
| macOS 或 Windows | 打包/运行桌宠 | macOS 上可打 mac 包；Windows 包建议在 Windows 上验证 |

如果你不确定是否装好了 Node.js，可以在终端运行：

```bash
node -v
npm -v
```

### 2. 图像生成 API

生成动作图需要一个兼容 OpenAI Images API 的图像模型接口。

必须配置：

```env
IMAGE_API_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=你的图像模型密钥
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1536x1024
IMAGE_QUALITY=high
IMAGE_N=1
```

### 3. 文本模型 API（可选）

当前 `/create-pet` 主要由 Claude Code 自己完成对话、动作设计和 prompt 创作。只有你使用 Web UI 或额外自动化脚本时，才可能需要文本模型配置：

```env
TEXT_API_BASE_URL=
TEXT_API_KEY=
TEXT_MODEL=gpt-5.5
```

---

## 第一次使用

### Step 1：安装依赖

在项目根目录执行：

```bash
npm install
```

### Step 2：配置 `.env`

如果项目里没有 `.env`，先复制模板：

```bash
cp .env.example .env
```

然后打开 `.env`，至少填写：

```env
IMAGE_API_BASE_URL=你的图像接口地址
IMAGE_API_KEY=你的图像接口密钥
IMAGE_MODEL=你的图像模型名
IMAGE_SIZE=1536x1024
IMAGE_QUALITY=high
IMAGE_N=1
```

### Step 3：启动 Claude Code

在项目根目录打开 Claude Code，然后执行：

```text
/create-pet /你的/参考图/路径.png
```

也可以把图片拖进 Claude Code，再执行 `/create-pet`。

---

## `/create-pet` 会做什么？

完整流程如下：

1. **获取参考图**
   - 你提供一张人物图或角色图。

2. **先确认项目名**
   - Claude 会先建议一个桌宠项目名。
   - 你可以确认或改名。
   - 确认后才会创建 `output/<名字>-<时间戳>/` 工作区。

3. **询问是否生成标准参考图**
   - Claude 会问你：
     - 要不要先基于原始图提取人物特征，生成一张更适合后续动作的标准参考图？
   - 如果你说“不需要”：
     - 直接把原图复制成 `reference.png`。
     - 后续所有动作都严格以这张图为准。
   - 如果你说“需要”：
     - Claude 会先提取人物特征。
     - 生成并确认一张标准参考图。
     - 确认后的图会写入 `reference.png`。

4. **设计动作列表**
   - 动作不会套固定默认模板。
   - Claude 会根据你的描述生成动作。
   - 动作概览会用表格展示，例如：

   | 序号 | id | 动作名 | 帧数 | FPS | 动作说明 |
   |---:|---|---|---:|---:|---|
   | 1 | online-buddy | 男友搭子上线 | 6 | 2 | 抬手打招呼，轻松上线陪你工作 |

5. **生成每个动作的 Prompt**
   - 每个动作会生成一个独立 prompt 文件。
   - 生成多个 prompt 时会显示进度：

   ```text
   正在生成 Prompt 1/8：男友搭子上线（online-buddy）
   正在生成 Prompt 2/8：想你啦（miss-you）
   Prompt 已全部生成：8/8
   ```

6. **先试生成一个动作**
   - 默认先生成一个最能代表角色气质的动作。
   - 你确认人物是否像、动作是否对、绿幕是否干净。

7. **安全切片**
   - 使用 `scripts/repack-sprite-safe.ts`。
   - 目标是完整保留人物，不能切掉头发、手、脚或道具。
   - 会清理绿幕边缘，减少脏绿毛边。

8. **批量生成剩余动作**
   - 生成多个动作时会显示进度：

   ```text
   正在生成动作 1/8：男友搭子上线（online-buddy）
   - 生成 raw 图中：sprites/online-buddy_raw.png
   - 安全切片中：sprites/online-buddy.png
   - 已完成 1/8
   ```

9. **确认最终效果**
   - 检查人物是否像 reference。
   - 检查不同动作大小是否一致。
   - 检查是否有串帧、残留、毛边。

10. **询问打包平台**
    - 打包前 Claude 必须问你：

    ```text
    你要打包成哪个平台？mac、windows，还是两个都要？
    ```

11. **生成安装包图标并打包**
    - 图标会从 `reference.png` 生成。
    - 会自动清理绿色背景，默认使用透明背景。
    - 然后生成 mac / windows / all 对应安装包。

---

## 输出目录说明

每次创建桌宠都会生成一个独立工作区：

```text
output/<pet-name>-<YYYYMMDD-HHMMSS>/
├── meta.json
├── original.png              # 用户最初上传的原始图备份
├── reference.png             # 后续动作生成的唯一人物基准图
├── character.json            # 角色锁定策略或标准参考图特征
├── actions.json              # 动作定义
├── prompts/                  # 每个动作的 prompt
│   ├── <action-id>.txt
│   └── ...
├── sprites/
│   ├── <action-id>_raw.png   # 图像 API 原始输出
│   ├── <action-id>.png       # 安全切片后的最终 sprite
│   └── ...
└── export/                   # 导出的 Electron 应用和安装包
```

重点：

- `original.png`：只做原始备份，不要改。
- `reference.png`：后续所有动作生成和校验的唯一人物基准。
- `actions.json`：记录哪些动作已生成、帧数、FPS、frameWidth、frameHeight。
- `sprites/<action-id>.png`：最终运行时使用的 sprite。
- `export/`：最终可运行应用和安装包。

---

## 当前 create-pet 必需文件

如果只运行 Claude Code 的 `/create-pet` skill，核心必需文件是：

```text
.claude/skills/create-pet/SKILL.md

.env
.env.example
package.json
package-lock.json

scripts/generate-sprite.ts
scripts/repack-sprite-safe.ts
scripts/export-pet.ts

preload.js
renderer/index.html
renderer/style.css
renderer/sprite-engine.js
renderer/app.js

output/
```

依赖安装后还会有：

```text
node_modules/
```

`node_modules/` 不建议入库，其他机器上用 `npm install` 重新安装即可。

---

## 关键脚本说明

### `scripts/generate-sprite.ts`

调用图像 API 生成动作 sprite raw 图。

常见用法：

```bash
npx tsx scripts/generate-sprite.ts \
  --prompt-file output/<session>/prompts/<action-id>.txt \
  --output output/<session>/sprites/<action-id>_raw.png \
  --reference-image output/<session>/reference.png
```

如果传了 `--reference-image`，脚本会使用图片编辑接口，把 `reference.png` 作为参考图上传。

---

### `scripts/repack-sprite-safe.ts`

安全切片脚本。用于把 raw sprite 图切成最终运行时使用的横向 sprite strip。

常见用法：

```bash
npx tsx scripts/repack-sprite-safe.ts \
  --input output/<session>/sprites/<action-id>_raw.png \
  --output output/<session>/sprites/<action-id>.png \
  --frames 6 \
  --padding 36
```

它会：

- 检测非绿幕前景区域
- 确保帧数和动作定义一致
- 给每帧加 padding，避免切掉人物
- 清理纯绿、近绿、半透明绿边缘
- 输出纯 `#00ff00` 背景的最终 sprite

---

### `scripts/export-pet.ts`

导出并打包 Electron 桌宠应用。

常见用法：

```bash
npx tsx scripts/export-pet.ts \
  --session-dir output/<session> \
  --app-name "我的桌宠" \
  --app-id "com.desktoy.custom" \
  --platform mac \
  --build
```

`--platform` 可选：

| 值 | 说明 |
|---|---|
| `mac` | 生成 macOS 包 |
| `win` | 生成 Windows 包 |
| `all` | 两个平台都生成 |

导出时会：

- 复制 Electron 运行时模板
- 根据 `actions.json` 生成 `renderer/actions.js`
- 使用固定 `STAGE_WIDTH` / `STAGE_HEIGHT`，避免右键切换动作时位置跳动
- 默认 `DISPLAY_SCALE = 0.32`
- 从 `reference.png` 生成透明背景 app icon
- 调用 `electron-builder` 打包

---

## 常见问题

### 1. 提示找不到 `.env`

复制模板：

```bash
cp .env.example .env
```

然后填写 `IMAGE_API_KEY` 等配置。

### 2. 生成的人物不像原图

优先确认：

- 是否使用了 `reference.png`
- `generate-sprite.ts` 是否传了 `--reference-image`
- prompt 中是否强调“必须和 reference.png 是同一个人”

如果还是不像，建议重新生成标准参考图，或加强角色锁定描述。

### 3. 切片后人物被切掉

当前主流程应使用：

```text
scripts/repack-sprite-safe.ts
```

不要回退到旧的固定坐标切片 `scripts/repack-sprite.ts`。

### 4. 边缘有绿色毛边

说明绿幕边缘清理不够。当前安全切片和 app icon 生成都会清理近绿色/半透明绿边缘。如果仍有明显毛边，可以重新生成 raw 图或调整绿幕清理阈值。

### 5. 桌宠太大或太小

默认展示比例是：

```text
DISPLAY_SCALE = 0.32
```

可以在 `scripts/export-pet.ts` 里调整。数值越小，桌宠越小。

### 6. 右键切换动作时位置跳动

导出产物应包含固定舞台：

```text
STAGE_WIDTH
STAGE_HEIGHT
```

所有动作会在同一个舞台内底部对齐、水平居中，避免切换动作时窗口变化。

### 7. macOS 提示应用未签名或打不开

这是本地测试包常见现象。因为没有 Apple Developer 证书签名和公证。

自己测试时可以在系统设置的“隐私与安全”里允许打开。正式分发给别人时，需要签名和公证。

---

## 技术栈

| 组件 | 技术 |
|---|---|
| 创建流程 | Claude Code Skill |
| 图像生成 | OpenAI-compatible Images API |
| 图像处理 | sharp |
| 脚本运行 | TypeScript + tsx |
| 桌宠运行时 | Electron + Canvas |
| 打包 | electron-builder |

---

## License

MIT
