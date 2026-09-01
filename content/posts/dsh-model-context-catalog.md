+++
title = '解决 DeepSeek Harness 长会话被误判为上下文溢出的问题'
date = '2026-09-01T20:00:00+08:00'
lastmod = '2026-09-01T20:00:00+08:00'
draft = false
description = 'DSH 把服务端已成功返回的响应重新判定为 context overflow，根因是 llm-pi-ai 对未声明 contextWindow 的模型使用 262144 默认值。本文记录排查过程，并发布用于修正模型上下文窗口配置的插件 dsh-model-context-catalog。'
summary = '长会话被 DSH 误判为上下文溢出、/compact 反复失败，根因是 llm-pi-ai 对未声明 contextWindow 的模型默认按 262K 处理。本文记录完整排查过程，并给出插件 dsh-model-context-catalog 作为通用解法。'

[cover]
  image = '/images/posts/dsh-model-context-catalog/settings-context-window.jpg'
  alt = 'DSH 插件 dsh-model-context-catalog 的上下文窗口设置页'
  caption = 'dsh-model-context-catalog：为每条 provider/model 路由维护真实的上下文窗口'
+++

> 本文记录一次 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（DSH）长会话被误判为 context overflow 的排查过程，结论其实很简单：把 `contextWindow` 配置对就好。为此我写了一个插件 **[dsh-model-context-catalog](https://github.com/HOWILLMAKEIT/dsh-model-context-catalog)**，为每条 `provider/model` 路由维护真实的上下文窗口，已发布到 npm。

## Bug 现象

最近我在使用 DSH 跑长程任务时，遇到了一个很奇怪的问题：

![DSH 报 pi-ai detected context overflow 错误](/images/posts/dsh-model-context-catalog/context-overflow-error.png "报错信息：pi-ai detected context overflow for model glm-5.3-flash")

1. DSH 报错 `pi-ai detected context overflow for model "glm-5.3-flash"`；
2. 然而 `context` 插件显示，当前上下文只占用了大约 500K，而 `glm-5.3-flash` 的上下文窗口明明有 1M；
3. 同时，`context` 插件读取到的上下文窗口最大值却是 `262144`；
4. 报错以后继续发送消息，会话仍然可以进行下去；
5. `/compact` 命令会失败。

基于以上现象，基本可以判断：这并不是真的上下文溢出了，而是 DSH 认为我们的模型上下文只有 262K。

## 原因分析

DSH 的通用模型 Provider 接入基于 pi-ai，问题出在 `llm-pi-ai` 的模型配置上。

如果一个自定义模型没有声明 `contextWindow`，DSH 会使用下面这个默认值：

```text
262144
```

也就是 262K tokens。但这只是 DSH/pi-ai 在**不知道模型真实上下文窗口时**的默认值，并不一定是模型服务端真正支持的上限——在我的实际会话中，GLM 服务端已经成功处理了超过 50 万、甚至超过 70 万 tokens 的请求。也就是说，模型服务端其实没有发生上下文溢出。

问题在于，pi-ai 在收到最终响应后，会检查：

```text
输入 token + cache read token > contextWindow
```

由于 DSH 记录的 `contextWindow` 仍然是 262144，所以只要请求超过 262K，pi-ai 就可能把服务端**已经成功返回的响应**重新判定为 context overflow。整个过程大概是：

1. DSH 向 GLM 发送一个超过 262K tokens 的请求；
2. GLM 服务端成功处理请求；
3. GLM 返回正常结果；
4. pi-ai 发现请求用量超过了配置中的 262K；
5. pi-ai 将这个成功响应重新判定为 context overflow；
6. DSH 最终显示错误。

因此，这次报错并不能证明模型真的超过了上下文窗口——**是一个"事后误判"，不是"真实溢出"**。

## 为什么 /compact 也会失败

`/compact` 会使用当前模型对历史会话进行总结，但用来生成摘要的模型，仍然带着那个错误的 262K 上下文窗口：

1. DSH 把长会话发送给 GLM 生成摘要；
2. GLM 成功生成摘要；
3. pi-ai 发现请求超过配置中的 262K；
4. 摘要响应被重新判定为 context overflow；
5. 压缩结果没有真正写入会话。

由于历史记录没有缩短，下一次执行 `/compact` 时还会重复同样的问题——"压缩失败 → 上下文没变短 → 继续失败"的死循环。

## 解决方案

解决方法其实很简单：

> 为模型配置正确的 `contextWindow`。

例如，我使用的 GLM Coding Plan 路由实际支持接近 1M tokens 的上下文。将它的 `contextWindow` 从默认的 `262144` 修改为 `1000000` 之后，之前的 context overflow 误报就消失了，`/compact` 也可以正常工作。

但手动修改配置比较麻烦，而且同一个模型可能通过不同 provider 或网关使用，例如：

```text
glm-coding/glm-5.3-flash
zai-coding-cn/glm-5.3-flash
```

虽然模型 ID 相同，但实际部署和上下文窗口不一定相同。上下文窗口应该是**按路由精确到 `provider/model`** 的配置，而不是按模型名一刀切。

因此，我写了一个 DSH 插件：

```text
dsh-model-context-catalog
```

## 插件做了什么

这个插件会为已经配置的 `llm-pi-ai` 模型维护一份上下文窗口目录，主要完成三件事：

1. 读取 DSH 中已经配置的 provider 和模型；
2. 为精确的 `provider/model` 路由保存 `contextWindow`；
3. 通过 DSH 的 Settings API，将正确的数值同步到 `llm-pi-ai`。

插件不会修改 DSH 或 pi-ai 的内部代码，也不会读取或接管 provider 的 API Key，它只负责修正模型的上下文窗口信息。

## 安装与使用

插件已发布到 npm，运行下方命令即可安装（GitHub 仓库欢迎 star：[HOWILLMAKEIT/dsh-model-context-catalog](https://github.com/HOWILLMAKEIT/dsh-model-context-catalog)）：

```bash
dsh plugin --profile web add dsh-model-context-catalog
```

安装后打开 **设置 → 上下文窗口**，即可直接管理模型的上下文窗口：

![dsh-model-context-catalog 插件的上下文窗口设置页](/images/posts/dsh-model-context-catalog/settings-context-window.jpg "设置 → 上下文窗口")

使用步骤：

1. 点击"添加模型"；
2. 选择已经配置的模型；
3. 输入该模型真实支持的上下文窗口（例如部署明确支持 1M tokens，就填 `1000000`）；
4. 根据需要填写备注；
5. 点击保存；
6. 等待状态变为"已生效"。

之后长会话的 overflow 误报消失，`/compact` 也能正常完成压缩。如果你也在 DSH 里接入自定义网关或第三方 provider，遇到"明明没满却报 context overflow"的情况，大概率就是同一个问题。
