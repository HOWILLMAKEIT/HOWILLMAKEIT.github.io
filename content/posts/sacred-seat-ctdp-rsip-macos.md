+++
title = '神圣座位：把 CTDP 与 RSIP 做成一款 macOS 应用'
date = '2026-07-29T12:00:00+08:00'
lastmod = '2026-07-29T12:31:00+08:00'
draft = false
description = '从 edmond 关于自制力的知乎回答出发，我将神圣座位、下必为例与国策树整理成了一款 macOS 桌面应用。'
summary = '从 edmond 关于自制力的知乎回答出发，我将神圣座位、下必为例与国策树整理成了一款 macOS 桌面应用。本文介绍 CTDP、RSIP 的核心思想与项目设计。'

[cover]
  image = '/images/posts/sacred-seat/focus-dashboard.png'
  alt = '神圣座位 macOS 应用的专注主界面'
  caption = '神圣座位：将一次行为承诺与长期稳态调整放进同一款桌面应用'
+++

> 本项目的思想主要来自 edmond 的知乎回答 [《如何提高自制力？》](https://www.zhihu.com/question/19888447/answer/1930799480401293785)。项目代码与安装包已开源，详见 [HOWILLMAKEIT/sacred-seat](https://github.com/HOWILLMAKEIT/sacred-seat)。

## 从一篇关于自制力的文章开始

很多自控工具都在做相似的事情：列出任务、启动计时、连续打卡，再用积分或提醒鼓励用户坚持。edmond 的文章提供了另一种视角：自制力也可以被看作一个行为约束与长期稳态的工程问题。

文章提出了两套方法：

- **链式时延协议（CTDP）** 关注一次具体行为如何开始、维持，以及规则出现例外时如何处理。它用“神圣座位”标记承诺已经开始，用链式记录积累约束，并通过“下必为例”避免临场修改规则；
- **递归稳态迭代协议（RSIP）** 关注如何从容易维持的小改变出发，逐步调整影响长期状态的边界条件。它不要求直接完成宏大目标，而是先寻找可以稳定存活的小规则，再把它们组织成一棵国策树。

原文篇幅很长，包含价值函数、时间贴现、稳态与递归回溯等讨论。这个项目没有尝试复刻整套理论，而是选择了其中更适合交互产品的几个部分，将它们整理成可以直接操作的桌面工具。

## 功能介绍

### 1. 创建并触发神圣座位

“神圣座位”不一定真是一把椅子。它也可以是戴上某顶帽子、坐到书桌前，或者完成一个固定的准备动作。关键在于：**触发动作发生之前可以自由选择；一旦触发，就不再临场修改承诺。**

用户可以为每个座位设置名称、触发动作、行为边界和持续时间。点击“触发神圣座位”后，应用进入专注计时；完成后当前链长增加，中止时则必须承认失败，或者把这次例外写成以后永久允许的判例。

{{< figure
    src="/images/posts/sacred-seat/focus-dashboard.png"
    link="/images/posts/sacred-seat/focus-dashboard.png"
    target="_blank"
    rel="noopener"
    alt="神圣座位应用主界面，展示实验室座位、专注计时、当前链长和永久判例"
    title="图 1 · 神圣座位主界面"
    caption="触发条件、专注行为、当前链长和永久判例集中在同一个界面中。"
>}}

### 2. 管理不同场景并查看坚持记录

书房、实验室、图书馆等场景可以分别建立座位，每个座位独立保存行为规则、当前链长、累计坚持天数和每日完成次数。侧边栏使用类似 GitHub Contributions 的热力方格展示最近十二周记录，颜色越深，代表当天完成次数越多。

{{< figure
    src="/images/posts/sacred-seat/seat-management.png"
    link="/images/posts/sacred-seat/seat-management.png"
    target="_blank"
    rel="noopener"
    alt="神圣座位应用的多座位切换和最近十二周完成记录"
    title="图 2 · 多座位与坚持记录"
    caption="书房、实验室等场景可以分别维护，最近十二周的完成次数以热力方格展示。"
>}}

### 3. 用国策树整理长期目标

单次专注并不能自动解决作息、精力或生活环境问题。RSIP 更关心长期状态：与其反复要求自己“从今天开始彻底改变”，不如先寻找维护成本低、在状态较差时也能成立的小规则。

应用使用一棵可编辑的国策树保存这些关系：下层节点是最终目标，上层节点是当前更容易做到的小目标。节点可以通过拖动交换顺序、改变层级或建立分支；画布支持缩放和平移，也不限制固定节点数量。

例如，“晚饭后不摄入热量”很难直接依赖意志力维持，但可以先建立三个更具体的上层节点：不提前购买夜宵、饭后立即刷牙并停止使用厨房、想进食时只选择无热量饮品。它们并不保证目标一定实现，却在逐步改变目标所处的环境。

{{< figure
    src="/images/posts/sacred-seat/policy-tree-example.png"
    link="/images/posts/sacred-seat/policy-tree-example.png"
    target="_blank"
    rel="noopener"
    alt="晚饭后不摄入热量的国策树示例，三个上层行为共同服务于下层最终目标"
    title="图 3 · 一棵简单的国策树"
    caption="下层保留最终目标，上层记录可以率先建立的具体行为。"
>}}

### 4. 使用 Codex 辅助整理国策

国策树规模较小时，手动整理已经足够。节点逐渐增多以后，重复规则、冗长表述和混乱层级会让树变得难以维护；有时用户只有一个最终目标，也不知道应该从哪个小节点开始。

因此，应用提供了一个可选的 Codex 辅助入口：

- 合并含义重复的节点并压缩表述；
- 修复明显混乱的父子关系；
- 根据一个最终目标生成一条参考链。

Codex 不会直接接管国策树。应用只把当前目标和节点 JSON 交给本机 Codex CLI，要求返回结构化建议；用户预览并确认以后，修改才会写入本地数据。不需要这项功能时，也无需安装 Codex。

{{< figure
    src="/images/posts/sacred-seat/codex-organizer.png"
    link="/images/posts/sacred-seat/codex-organizer.png"
    target="_blank"
    rel="noopener"
    alt="神圣座位应用中的 Codex 国策整理器"
    title="图 4 · 可选的 Codex 辅助"
    caption="Codex 负责提出整理方案，是否应用仍由用户决定。"
>}}

### 5. 在应用内复习方法

为了避免工具与方法脱节，应用内保留了一份三分钟复习版，并整理了知乎原文阅读页面。左下角每天展示一条来自原文的摘录，也可以直接跳转到作者页面阅读全文。

{{< figure
    src="/images/posts/sacred-seat/article-reader.png"
    link="/images/posts/sacred-seat/article-reader.png"
    target="_blank"
    rel="noopener"
    alt="神圣座位应用内的方法说明与知乎原文阅读页面"
    title="图 5 · 方法说明与原文阅读"
    caption="应用同时保留简洁复习版和知乎原文入口，工具不会替代对方法本身的理解。"
>}}

## 项目框架与设计

这是一个体量较小的本地桌面应用，技术结构也尽量保持简单：

| 层次 | 实现 | 负责内容 |
| --- | --- | --- |
| 界面 | React、TypeScript | 神圣座位、专注计时、判例管理、活动统计与国策树交互 |
| 桌面运行时 | Tauri 2、Rust | macOS 窗口、Codex CLI 调用、系统代理读取与自动更新 |
| 本地数据 | `localStorage` | 座位配置、完成记录、永久判例和国策节点 |
| 可选智能能力 | Codex CLI | 生成或精简国策树建议 |
| 发布 | GitHub Actions、GitHub Releases | 构建 Apple Silicon / Intel 安装包并提供签名更新 |

设计上有三个明确边界。

第一，**本地优先**。当前没有账号、云同步或自建服务器，行为记录只保存在用户自己的电脑上。

第二，**模型能力是可选项**。不配置 Codex 时，计时、记录、判例和国策树仍能完整使用；AI 只用于难以手工维护的整理工作。

第三，**不把方法伪装成医疗建议**。它是一套自我观察与行为管理工具，不能替代针对 ADHD、焦虑或其他健康问题的专业诊断和治疗。

## 当前状态

项目目前提供 Apple Silicon 与 Intel 两种 macOS 安装包，并通过 GitHub Releases 提供自动更新。由于尚未加入 Apple Developer Program，安装包采用 ad-hoc 签名，首次打开时可能需要在“系统设置 → 隐私与安全性”中手动确认。

- 项目仓库：[HOWILLMAKEIT/sacred-seat](https://github.com/HOWILLMAKEIT/sacred-seat)
- 最新版本：[GitHub Releases](https://github.com/HOWILLMAKEIT/sacred-seat/releases/latest)
- 思想来源：[edmond《如何提高自制力？》](https://www.zhihu.com/question/19888447/answer/1930799480401293785)

这仍然是一个早期项目。它真正想做的事情并不复杂：让一次承诺的边界更清楚，也让那些看起来过于宏大的长期目标，能够被拆成今天可以先做的一小步。
