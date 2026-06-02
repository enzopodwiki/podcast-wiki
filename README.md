# 播客知识库 — 公开网站

把 Obsidian 里的播客 wiki 发布成网站，私下分享给朋友。

- **网站地址**：https://enzopodwiki.github.io/podcast-wiki/
- **不被搜索引擎收录**（每页带 `noindex`），只有拿到链接的人能看。
- 只发布 `wiki/` 内容；`raw/` 原始文章（第三方版权）**不发布**。

## 怎么更新网站

在 Obsidian 里更新完 wiki 后，跟 Claude 说一句「**发布播客 wiki**」即可；
Claude 会运行：

```bash
bash /Users/enzo/podcast-wiki-site/publish.sh
```

脚本会自动：从 vault 同步内容 → 转换链接 → 推送到 GitHub → 网站 1-2 分钟后更新。

## 原理（给好奇的你）

- `sync.mjs`：从 vault 的 `wiki/` 复制内容到 `content/`，并转换链接：
  - 去掉 `[[wiki/...]]` 的多余前缀；
  - 把指向 `raw/` 原文的链接转成纯文字（保留出处标题，不可点）；
  - 把每页正文首个标题提取为正式页面标题。
- 原始 vault **只读**，永远不会被这套流程修改。
- 用 [Quartz](https://quartz.jzhao.xyz) 生成静态网站，GitHub Actions 自动构建部署。
