# Isla-Deskpet

请注意这是本人第一次尝试 vibe coding 写的小玩意儿，所以欢迎同好帮助维护或者更新新的功能。

一个基于 [**Claude Code Skill**](https://github.com/CyanWong-pm/create-pet-skill) 的对话式桌宠生成工具。你只需要准备一张人物参考图，就可以跟着 Claude 的中文提示生成 Q 版动漫桌宠动作、精灵图，并打包Windows 桌面应用。

---

## 适合谁使用？

- 想用一张照片或角色图生成桌面宠物的人
- 不熟悉代码，但可以按步骤填写配置、运行命令的小白用户
- 想定制动作、语气、陪伴风格的用户
- 想把桌宠打包成安装包分享给别人的用户

---

## 仓库里已经有一只桌宠：isla

这个仓库内置了一只生成好的桌宠 **isla**（艾拉：银白长发、红瞳、白色制服 + 红色胸结的 Q 版形象），共 **10 个动作**（后续添加）：

| 动作 id | 动作名 | 触发方式 |
|---|---|---|
| idle-buddy | 陪班待机 | 启动后默认动作 |
| cheer-up | 傲娇打气 | 右键切换 |
| drink-water | 喝水提醒 | 右键切换 |
| rest-reminder | 休息提醒 | 右键切换 |
| off-work | 下班提醒 | 右键切换 |
| poke-react | 戳一戳撒娇 | 右键切换 |
| celebrate | 完成任务庆祝 | 右键切换 |
| sleep | 睡觉挂机 | 双击她切换 |
| new-message | 消息提醒 | 右键切换 |
| date-weather | 日期天气播报 | 右键切换 |

### 怎么召唤 isla（Windows）

**双击项目根目录的 `启动isla桌宠.bat`**，她就会出现。

如果双击 bat 没反应，直接双击打包好的程序也一样：

```text
output/isla-20260815-120437/export/dist/win-unpacked/isla.exe
```

这个 exe 是打包好的完整程序，不需要装 Node.js、不需要联网。

### 怎么和她互动

| 操作 | 效果 |
|---|---|
| **右键点击她** | 弹出动作菜单：切换任意动作 / 退出 |
| **按住拖动** | 移动她的位置 |
| **单击她** | 按顺序循环切换动作 |
| **双击她** | 睡觉 ↔ 唤醒 |
| 放着不动 | 她会随机表演动作 |

开发模式运行（需要 Node.js 和依赖）：

```bash
cd output/isla-20260815-120437/export
npm start
```

isla 的所有档案（角色设定、10 个动作的 prompt 和精灵图、导出的应用）都在：

```text
output/isla-20260815-120437/
```

---

## 从零生成一只新桌宠

### 你需要准备什么？

#### 1. 本地环境

| 依赖 | 用途 | 建议 |
|---|---|---|
| Node.js | 运行脚本、安装依赖 | 建议 Node.js 20+ |
| npm | 安装依赖 | 随 Node.js 一起安装 |
| Claude Code | 运行 `/create-pet` skill | 必需 |
| macOS 或 Windows | 打包/运行桌宠 | macOS 上可打 mac 包；Windows 包建议在 Windows 上验证 |

确认 Node.js 已安装：

```bash
node -v
npm -v
```

#### 2. 图像生成 API

生成动作图需要一个兼容 OpenAI Images API 的图像模型接口：

```env
IMAGE_API_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=你的图像模型密钥
IMAGE_MODEL=gpt-image-1
IMAGE_SIZE=1536x1024
IMAGE_QUALITY=high
IMAGE_N=1
```

#### 3. 文本模型 API（可选）

当前 `/create-pet` 主要由 Claude Code 自己完成对话、动作设计和 prompt 创作。只有使用 Web UI 或额外自动化脚本时，才可能需要文本模型配置：

```env
TEXT_API_BASE_URL=
TEXT_API_KEY=
TEXT_MODEL=gpt-5.5
```

---

### 第一次使用

**Step 1：安装依赖**

```bash
npm install
```

**Step 2：配置 `.env`**

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

**Step 3：启动 Claude Code，执行 skill**

在项目根目录打开 Claude Code：

```text
/create-pet /你的/参考图/路径.png
```

也可以把图片拖进 Claude Code，再执行 `/create-pet`。

---

### `/create-pet` 会做什么？

完整流程：

1. **获取参考图** —— 你提供一张人物图或角色图。
2. **先确认项目名** —— Claude 建议一个桌宠项目名，你确认或改名后，才创建 `output/<名字>-<时间戳>/` 工作区。
3. **询问是否生成标准参考图** —— 需要则提取人物特征生成标准参考图；不需要则直接用原图作为 `reference.png`。
4. **设计动作列表** —— 不套固定模板，根据你的描述生成动作，用表格展示：

   | 序号 | id | 动作名 | 帧数 | FPS | 动作说明 |
   |---:|---|---|---:|---:|---|
   | 1 | online-buddy | 男友搭子上线 | 6 | 2 | 抬手打招呼，轻松上线陪你工作 |

5. **生成每个动作的 Prompt** —— 每个动作一个 prompt 文件，生成时显示进度：

   ```text
   正在生成 Prompt 1/8：男友搭子上线（online-buddy）
   正在生成 Prompt 2/8：想你啦（miss-you）
   Prompt 已全部生成：8/8
   ```

6. **先试生成一个动作** —— 确认人物像不像、动作对不对、绿幕干不干净。
7. **安全切片** —— 使用 `scripts/repack-sprite-safe.ts`，完整保留人物（头发、手、脚、道具都不能切掉），并清理绿幕边缘。
8. **批量生成剩余动作** —— 显示进度：

   ```text
   正在生成动作 1/8：男友搭子上线（online-buddy）
   - 生成 raw 图中：sprites/online-buddy_raw.png
   - 安全切片中：sprites/online-buddy.png
   - 已完成 1/8
   ```

9. **确认最终效果** —— 人物一致性、动作尺寸一致性、无串帧/残留/毛边。
10. **询问打包平台** —— 打包前 Claude 必须问你：`mac、windows，还是两个都要？`
11. **生成图标并打包** —— 图标从 `reference.png` 生成（自动清理绿色背景，默认透明底），再生成对应平台的安装包。

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

## 项目结构（精简版）

如果只运行 `/create-pet` skill，核心必需文件是：

```text
.claude/skills/create-pet/SKILL.md   # skill 定义

.env / .env.example                  # API 配置
package.json / package-lock.json

scripts/generate-sprite.ts           # 调图像 API 生成 raw 图
scripts/repack-sprite-safe.ts        # 安全切片 + 绿幕清理
scripts/export-pet.ts                # 导出并打包 Electron 应用

preload.js                           # Electron 运行时
renderer/index.html
renderer/style.css
renderer/sprite-engine.js
renderer/app.js

output/                              # 每只桌宠的工作区

启动isla桌宠.bat                      # isla 一键启动（Windows，双击即可）
```

依赖安装后还会有 `node_modules/`，不建议入库，其他机器上用 `npm install` 重新安装即可。

---

## 关键脚本说明

### `scripts/generate-sprite.ts`

调用图像 API 生成动作 sprite raw 图：

```bash
npx tsx scripts/generate-sprite.ts \
  --prompt-file output/<session>/prompts/<action-id>.txt \
  --output output/<session>/sprites/<action-id>_raw.png \
  --reference-image output/<session>/reference.png
```

传了 `--reference-image` 时，脚本会把 `reference.png` 作为参考图上传，使用图片编辑接口。

### `scripts/repack-sprite-safe.ts`

安全切片脚本，把 raw 图切成最终运行时使用的横向 sprite strip：

```bash
npx tsx scripts/repack-sprite-safe.ts \
  --input output/<session>/sprites/<action-id>_raw.png \
  --output output/<session>/sprites/<action-id>.png \
  --frames 6 \
  --padding 36
```

它会：

- 检测非绿幕前景区域
- 确保检测到的帧数和动作定义一致
- 给每帧加 padding，避免切掉人物
- 清理纯绿、近绿、半透明绿边缘
- 输出纯 `#00ff00` 背景的最终 sprite

### `scripts/export-pet.ts`

导出并打包 Electron 桌宠应用：

```bash
npx tsx scripts/export-pet.ts \
  --session-dir output/<session> \
  --app-name "我的桌宠" \
  --app-id "com.desktoy.custom" \
  --platform win \
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
- 使用固定 `STAGE_WIDTH` / `STAGE_HEIGHT`，避免切换动作时位置跳动
- 默认 `DISPLAY_SCALE = 0.32`
- 从 `reference.png` 生成透明背景 app icon
- 调用 `electron-builder` 打包

> ⚠️ 重新运行 export-pet.ts 会**删除并重建** `export/` 目录（包括里面已经打好的包和安装的依赖）。

---

## 常见问题

### 1. 提示找不到 `.env`

```bash
cp .env.example .env
```

然后填写 `IMAGE_API_KEY` 等配置。

### 2. 生成的人物不像原图

优先确认：

- 是否使用了 `reference.png`
- `generate-sprite.ts` 是否传了 `--reference-image`
- prompt 中是否强调"必须和 reference.png 是同一个人"

如果还是不像，建议重新生成标准参考图，或加强角色锁定描述。

### 3. 切片后人物被切掉

当前主流程使用 `scripts/repack-sprite-safe.ts`，不要回退到固定坐标切片。

### 4. 边缘有绿色毛边

说明绿幕边缘清理不够。当前安全切片和 app icon 生成都会清理近绿色/半透明绿边缘。如果仍有明显毛边，可以重新生成 raw 图或调整绿幕清理阈值。

### 5. 桌宠太大或太小

默认展示比例 `DISPLAY_SCALE = 0.32`，可以在 `scripts/export-pet.ts` 里调整。数值越小，桌宠越小。

### 6. 右键切换动作时位置跳动

导出产物包含固定舞台 `STAGE_WIDTH` / `STAGE_HEIGHT`，所有动作在同一个舞台内底部对齐、水平居中。

### 7. 双击启动后窗口开了但看不到角色

任务栏有 isla 图标但看不到她，通常是**默认动作 id 不匹配**导致画面一直空白。当前 `renderer/app.js` 已修复：默认动作会优先取 `idle`，没有则取 `idle-buddy`，再没有则取动作表的第一个动作。如果你的桌宠动作表没有叫 `idle` 的动作，确认用的是修复后的 `app.js`。

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
