# 软泥守望 · 网页试玩版

一个零依赖横屏玩法原型，支持“自由建造 → 主动开启防守 → 暂停出牌”的核心循环，可直接在浏览器和 GitHub Pages 运行。

## 运行

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`。建议使用横屏或桌面浏览器。

## 发布到 GitHub Pages

生成可提交的 Pages 白名单包：

```bash
npm run build:docs
```

构建会读取 `assets/rig-parts.json`，并要求清单引用的 8 张角色图集都真实存在且具有 PNG 文件签名。每张图集在运行时继续裁成身体、眼睛、嘴巴及必要的前后配件骨骼层。`docs/` 只会包含 `index.html`、`styles.css`、`src/`、骨骼素材清单，以及该清单精确引用的 `assets/generated-v2/rig/` 图片；预览图、旧素材和未被引用的图片不会进入发布包。缺少任何一张图集时，构建会列出具体路径并保留上一次成功产物。

构建通过后提交 `docs/` 并推送 `main`，再到仓库的 **Settings → Pages**：

1. 将 **Source** 设为 **Deploy from a branch**。
2. 选择 **main /docs** 并保存。

此方案不需要 GitHub Actions 或额外的 workflow 权限。仓库目前若仍使用 **main /(root)**，需要手动改为 **main /docs** 后，白名单发布包才会生效。项目内全部使用相对资源路径，可直接运行在 `https://用户名.github.io/仓库名/` 这类子路径。

本地检查发布包时使用：

```bash
npm run build
python3 -m http.server 8080 --directory _site
```

## 测试

```bash
npm test
npm run check
npm run build
```

## 渲染与动画

- 默认使用 Canvas 2D 矢量绘制，不加载 `assets/generated` 下的 PNG。
- 只有在 `#game` 上显式设置 `data-raster-assets="enabled"` 才会启用 PNG 预加载。
- 4 名幸存者和 4 类敌人均已接入部件骨骼动画，覆盖待机、移动、攻击、受击、倒地与死亡状态；酸壳蜗王另有可被打断的蓄力状态。
- 骨骼定义、动作片段和播放器位于 `src/animation/`，视觉控制器不进入存档数据。

## 第一版内容

- 6×6 建造区，左侧软核、右侧怪物入口。
- 无限时建造、手动开波、随时暂停。
- 4 名幸存者、5 种建筑、4 张技能、3 件道具。
- 3 波敌人和 1 名精英。
- 布局与软晶本地保存。

当前不接正式抽卡、广告、云存档和微信开放能力。核心数据与 Canvas 绘制已分层，后续可以增加微信小游戏运行适配层。
