# 软泥守望 · 网页试玩版

一个零依赖横屏玩法原型，支持“自由建造 → 主动开启防守 → 暂停出牌”的核心循环，可直接在浏览器和 GitHub Pages 运行。

## 运行

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`。建议使用横屏或桌面浏览器。

## 发布到 GitHub Pages

将项目推送到 GitHub 的 `main` 分支后，在仓库的 **Settings → Pages** 中将 **Source** 设为 **Deploy from a branch**，分支选择 **main / (root)**；当前版本和以后每次推送都会自动发布。

发布包只包含 `index.html`、`styles.css` 与 `src/`，不会上传旧图片、素材规范或测试文件。项目内全部使用相对资源路径，可直接运行在 `https://用户名.github.io/仓库名/` 这类子路径。

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
