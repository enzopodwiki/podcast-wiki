#!/bin/bash
# 一键发布播客 wiki 到网站。
# 流程：从 Obsidian vault 同步内容 → 转换链接 → 提交 → 推送（GitHub 自动构建上线）。
# 原始 vault 只读，绝不被修改。

set -e
cd "$(dirname "$0")"

echo "① 从 vault 同步 wiki 内容并转换链接..."
node sync.mjs

echo "② 检查变化并提交..."
git add -A
if git diff --cached --quiet; then
  echo "内容没有变化，无需发布。"
  exit 0
fi
git commit -q -m "更新 wiki 内容 $(date '+%Y-%m-%d %H:%M')"

echo "③ 推送到 GitHub..."
git push -q origin main

echo ""
echo "✅ 已推送。GitHub 正在自动构建，约 1-2 分钟后更新生效。"
echo "   网站： https://enzopodwiki.github.io/podcast-wiki/"
