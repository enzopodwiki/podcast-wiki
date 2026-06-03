#!/usr/bin/env node
// 把 Obsidian 播客 wiki 同步到 Quartz content/，并转换链接以适配公开发布。
// 原始 vault 只读，绝不修改。raw/ 第三方版权文章不发布。
//
// 转换规则：
//  1. [[wiki/X|disp]]  -> [[X|disp]]      去掉冗余的 wiki/ 前缀（content 根即 wiki/）
//  2. [[platforms/X]]  -> [[roles/X]]     历史笔误目录名修正
//  3. [[raw/...|disp]] -> disp            指向未发布原文的链接转纯文字（保留出处标题，不可点）
//     [[raw/...]]      -> 路径末段标题
//     同样处理 [[../raw/...]]
//
// 用法：node sync.mjs

import { promises as fs } from "node:fs";
import path from "node:path";

const VAULT = "/Users/enzo/Documents/文章/播客资料/资料汇总/wiki";
const DEST = path.join(import.meta.dirname, "content");

// 不发布的运营/盘点页面
const EXCLUDE_FILES = new Set([
  "log.md",
  "sources/source-inventory.md",
]);
const EXCLUDE_PREFIX = ["log-archive-"]; // log-archive-2026-05.md 等

function shouldExclude(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  const base = path.basename(rel);
  return EXCLUDE_PREFIX.some((p) => base.startsWith(p));
}

// 发布时的针对性文字替换（按文件路径）。原始 vault 不改；这里只改副本。
// 用途：来源盘点只公开高质量部分，故首页对它的描述也相应改写。
const TEXT_FIXES = {
  "index.md": [
    [
      "**raw/ 文章来源盘点**（197 篇全量，按来源 + 质量评级分类）",
      "**高质量来源盘点**（★★★ 来源，按来源 + 类型分类）",
    ],
  ],
};

function applyTextFixes(rel, text) {
  const fixes = TEXT_FIXES[rel];
  if (!fixes) return text;
  let out = text;
  for (const [from, to] of fixes) out = out.split(from).join(to);
  return out;
}

// 转换单个 wikilink 的内部文本（不含 [[ ]] 和前导 !）
function transformTarget(inner, isEmbed) {
  // inner 形如 "wiki/shows/stolen|Stolen" 或 "raw/news/xxx" 或 "spotify"
  const pipeIdx = inner.indexOf("|");
  let target = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
  const display = pipeIdx === -1 ? null : inner.slice(pipeIdx + 1);

  const norm = target.replace(/^\.\.\//, ""); // 去掉开头 ../

  // raw 链接 -> 纯文字
  if (norm.startsWith("raw/")) {
    if (display && display.trim()) return display;
    // 取路径末段作为标题
    const seg = norm.split("/").pop();
    return seg;
  }

  // 指向未发布附件（PDF/图片/音视频等）的链接 -> 纯文字
  // 这些文件多在 raw/research 里，链接常写成 [[2025-xxx报告.pdf]]，无 raw/ 前缀
  const ATTACHMENT_RE = /\.(pdf|png|jpe?g|gif|svg|webp|mp3|wav|m4a|mp4|mov|xlsx?|docx?|pptx?|zip)$/i;
  const targetBase = norm.split("/").pop();
  if (ATTACHMENT_RE.test(targetBase)) {
    if (display && display.trim()) return display;
    return targetBase.replace(ATTACHMENT_RE, ""); // 去掉扩展名，保留报告标题
  }

  // wiki/ 前缀 -> 去掉
  let newTarget = target;
  if (newTarget.startsWith("wiki/")) newTarget = newTarget.slice("wiki/".length);
  // platforms/ -> roles/
  if (newTarget.startsWith("platforms/")) newTarget = "roles/" + newTarget.slice("platforms/".length);

  const link = display === null ? newTarget : `${newTarget}|${display}`;
  return `${isEmbed ? "!" : ""}[[${link}]]`;
}

function transformLinks(text) {
  // 匹配 [[...]] 和 ![[...]]，inner 不含 ]
  return text.replace(/(!?)\[\[([^\]]+)\]\]/g, (m, bang, inner) => {
    return transformTarget(inner, bang === "!");
  });
}

// 拆分 frontmatter 与正文
function splitFrontmatter(text) {
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end !== -1) {
      const fmEnd = text.indexOf("\n", end + 1); // 指向 "---" 行行尾
      const fm = text.slice(0, fmEnd + 1); // 含首尾 ---
      const body = text.slice(fmEnd + 1);
      return { fm, body };
    }
  }
  return { fm: null, body: text };
}

// 处理单个文件：注入 title（取正文首个 H1）、删除重复 H1、转换链接
function processFile(raw) {
  let { fm, body } = splitFrontmatter(raw);

  // 找正文里第一个 H1
  const h1Match = body.match(/^# (.+?)\s*$/m);
  const h1 = h1Match ? h1Match[1].trim() : null;

  if (h1) {
    // 删掉这一行 H1（避免与 Quartz 顶部标题重复）
    body = body.replace(h1Match[0] + "\n", "").replace(h1Match[0], "");

    const titleLine = `title: ${JSON.stringify(h1)}`;
    if (fm === null) {
      fm = `---\n${titleLine}\n---\n`;
    } else if (!/^title:/m.test(fm)) {
      // 在结尾 --- 之前插入 title
      fm = fm.replace(/---\s*$/, `${titleLine}\n---\n`);
    }
  }

  const out = (fm ?? "") + transformLinks(body);
  return out;
}

async function walk(dir, baseDir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, baseDir, out);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(path.relative(baseDir, full));
    }
  }
  return out;
}

async function main() {
  // 1. 清空 content（保留 .gitkeep 之类无）
  await fs.rm(DEST, { recursive: true, force: true });
  await fs.mkdir(DEST, { recursive: true });

  // 2. 遍历 vault wiki 下所有 md
  const files = await walk(VAULT, VAULT);
  let copied = 0,
    skipped = 0;
  for (const rel of files) {
    if (shouldExclude(rel)) {
      skipped++;
      continue;
    }
    const src = path.join(VAULT, rel);
    const dst = path.join(DEST, rel);
    const raw = await fs.readFile(src, "utf8");
    const transformed = applyTextFixes(rel, processFile(raw));
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, transformed, "utf8");
    copied++;
  }
  // 3. 叠加 overrides/：手工维护的发布专用版本，覆盖自动同步的内容。
  //    用于需要"删改后才公开"的页面（如来源盘点只公开高质量部分）。
  //    overrides/ 里的文件已是发布最终形态，直接复制、不再做链接转换。
  const OVERRIDES = path.join(import.meta.dirname, "overrides");
  let overridden = 0;
  try {
    const ovFiles = await walk(OVERRIDES, OVERRIDES);
    for (const rel of ovFiles) {
      const raw = await fs.readFile(path.join(OVERRIDES, rel), "utf8");
      const dst = path.join(DEST, rel);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.writeFile(dst, raw, "utf8");
      overridden++;
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // 没有 overrides/ 目录时跳过
  }

  console.log(
    `同步完成：复制 ${copied} 个页面，跳过 ${skipped} 个运营页面，覆盖 ${overridden} 个精选页面。`,
  );
}

main().catch((err) => {
  console.error("同步失败：", err);
  process.exit(1);
});
