# 史莱姆自走防线

零依赖的竖屏 2D 塔防游戏，可直接发布到浏览器、GitHub Pages 和微信小游戏 Canvas。

在线版：<https://nornttyy.github.io/shilaimutuwei/>

## 玩法

- 三个顺序解锁的关卡，以及通关后开放的无尽模式。
- 每局操控一名英雄移动、自动普攻并手动释放技能；桌面支持方向键/WASD，触屏使用正式摇杆。
- 备战期直接购买近战小队（100）、远程小队（150）或固定范围炮塔（175）。
- 每支小队占一格并真实显示四名史莱姆兵；近战会自动接敌，远程会齐射，减员后人数与输出同步下降。
- 小队可在备战期点击或拖动换位；固定炮塔占专用炮位，不能移动，攻击可跨路线造成范围伤害。
- 局外召唤用于解锁和强化英雄，不干扰局内购买规则。
- 首次游玩只保留“购买近战、放到指定格、开战”的聚光步骤。
- 局内抽取不连接支付；未配置广告或服务端支付时，商业接口保持关闭。

## 本地运行

```bash
python3 -m http.server 8080
```

打开 `http://localhost:8080`，建议使用手机竖屏或将浏览器窗口调整为竖屏比例。

## 测试与构建

```bash
npm test
npm run check
npm run build
```

只验收公开可玩链路：

```bash
npm run test:playable
```

核心模块：

- `src/tower-defense-core.js`：英雄、小队购买、固定炮塔、波次、敌人、召唤、胜负及进度。
- `src/tower-defense-game.js`：Canvas 渲染、点击/拖动、聚光教程、骨骼动画控制、存档和生命周期。
- `src/draw.js`：正式 PNG、分层骨骼、弹丸与动态特效渲染。
- `src/main.js`：浏览器素材门禁与启动。
- `src/platform/wechat-entry.js`：微信 Canvas、触摸、加载和前后台适配。

旧基地/远征模块暂时保留并继续测试，但公开入口已经切换到英雄带队的自走塔防。

## 正式素材

`assets/asset-spec.json` 精确声明 134 张正式游戏 PNG；`assets/rig-parts.json` 另引用 8 张角色主图集和 8 张表情图集。构建会检查路径、尺寸、透明通道和体积，缺失或不合格时不会覆盖上一次成功产物。

塔防使用四名正式英雄、两种四人史莱姆兵、一座正式凝胶炮塔、四类敌人、核心、传送门、三套区域地表、卡框、弹丸与动态粒子。新手教程手势位于：

```text
assets/generated/ui/ui-tutorial-hand.png
```

加载完成前不会创建游戏实例，避免正式贴图尚未到齐时短暂显示矢量兜底。

四名史莱姆和四类敌人都使用运行时分层骨骼：身体、表情和配件按节点组合，待机、行走、攻击、受伤、死亡会采样独立关键帧；眼睛与嘴巴单独换层并自动眨眼。正式 rig 一旦声明就启用严格渲染，合成失败会停留在加载错误页，不会静默退回未分层整图。微信端通过 2D 离屏 Canvas 合成相同的骨骼与表情层。

## GitHub Pages

生成可提交的白名单发布包：

```bash
npm run build:docs
```

`docs/` 只包含网页入口、运行模块、两份素材清单以及清单引用的正式 PNG；旧预览、候选图和校对图不会进入发布包。仓库使用 `main /docs` 发布。

## 微信小游戏

先发布 HTTPS 素材，再生成可导入微信开发者工具的 `_wxgame/`：

```bash
WECHAT_ASSET_BASE_URL=https://nornttyy.github.io/shilaimutuwei node scripts/build-wechat.mjs
```

正式上线时可替换为自己的 HTTPS CDN，并在微信公众平台配置合法下载域名。微信主包只放代码和素材清单，正式 PNG 通过带内容哈希的 HTTPS 地址加载，主包内不复制 PNG。
