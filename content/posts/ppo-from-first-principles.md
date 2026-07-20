+++
title = '一文速通 PPO'
date = '2026-07-20T12:00:00+08:00'
lastmod = '2026-07-20T12:00:00+08:00'
draft = false
description = '从 Actor、Critic 与采样循环出发，梳理 Advantage、Return、GAE、PPO Loss 以及标准 PPO 与 RLHF-PPO 的完整训练流程。'
math = true

[cover]
  image = '/images/posts/ppo-guide/ppo-model-overview.png'
  alt = '标准 PPO 与 RLHF-PPO 中 Actor、Critic、Reward Model 和 Reference Model 的关系'
  caption = 'PPO 与 RLHF-PPO 的模型组成和训练关系'
+++

## 一、PPO 中有哪些模型？

![标准 PPO 与 RLHF-PPO 的模型全景图](/images/posts/ppo-guide/ppo-model-overview.png)

学习 PPO 时需要先区分两种语境：**标准 PPO** 主要包含 Actor 和 Critic；在 LLM 的 RLHF-PPO 中，还会额外出现 Reward Model 和 Reference Model。

### 1. Actor

常见别名：

- **Actor**
- **Policy**
- **Policy Network**
- **Actor Network**
- 在 LLM 训练中也叫 **Policy Model** 或 **Actor Model**

Actor 是真正负责做决策的模型。它接收状态 $s_t$，输出当前状态下各个动作的概率分布：

$$
\pi_\theta(a_t\mid s_t)
$$

然后从这个分布中选择动作 $a_t$。因此可以简单理解为：

> Actor 负责回答“现在应该采取什么动作？”

在 LLM 中，被训练的 llm 本身就是我们的 actor，负责输出下一个 token

### 2. Critic

常见别名：

- **Critic**
- **Value Function**
- **Value Network**
- 在 LLM 训练中也叫 **Value Model**

Critic 接收状态 $s_t$，预测从当前状态出发，未来大约还能获得多少累计回报：

$$
V_\phi(s_t)
$$

因此可以简单理解为：

> Critic 负责回答“当前状态有多好？”

Critic 不负责选择动作，它的预测主要用来估计 Advantage，从而判断某个动作是否比预期更好。

### 3. PPO 更新时保存的 Old Policy 信息

常见别名：

- **Old Policy**
- **Old Actor**
- **Behavior Policy**（采集当前这批轨迹时所使用的策略）
- 记作 $\pi_{\theta_{\text{old}}}$

Old Policy **不是第三个需要长期训练的独立模型**，而是 Actor 更新之前的旧版本或快照。实际实现中通常只需要保存采样时的 `old_log_prob`。PPO 使用它与当前 Actor 比较同一个动作的概率：

$$
r_t(\theta)
=
\frac{\pi_\theta(a_t\mid s_t)}
{\pi_{\theta_{\text{old}}}(a_t\mid s_t)}
$$

这个概率比值用于衡量新策略相对旧策略改变了多少，也是 PPO 限制策略单次更新幅度的基础。

> **要点｜标准 PPO**
> 标准 PPO 通常只有两个需要训练的模型：**Actor + Critic**。Old Policy 是 PPO 更新时所需的旧策略信息，不应当算作第三个独立模型。

### 4. Reward Model（RLHF-PPO 额外模型）

常见别名：

- **Reward Model**
- **RM**
- **Reward Scorer**

Reward Model 根据生成结果给出奖励分数，用来表示回答是否符合人类偏好。它在 PPO 阶段通常保持冻结，不参与 PPO 更新。

> 普通强化学习中的奖励可以直接由环境提供，因此标准 PPO 不一定需要 Reward Model。

### 5. Reference Model（RLHF-PPO 额外模型）

常见别名：

- **Reference Model**
- **Reference Policy**
- **Ref Model**
- 记作 $\pi_{\text{ref}}$

Reference Model 通常是 RL 训练开始前的初始 Policy 副本，并在 PPO 训练期间保持冻结。它用于计算 KL 惩罚，避免 Actor 为了追求奖励而偏离原始语言模型太远。

> **注意｜Old Policy 与 Reference Model 不相同**
> - **Old Policy**：随着 PPO 更新不断刷新，用于计算新旧策略概率比。
> - **Reference Model**：通常在整个 RLHF 训练过程中保持冻结，用于计算 KL 约束。

### 快速总结

| 模型或信息 | 常见别名 | 是否训练 | 主要作用 |
|---|---|---:|---|
| Actor | Policy、Policy Network、Policy Model | 是 | 根据状态选择动作 |
| Critic | Value Function、Value Network、Value Model | 是 | 估计状态价值，辅助计算 Advantage |
| Old Policy 信息 | Old Actor、Behavior Policy、old log probabilities | 不是独立训练模型 | 计算 PPO 的新旧策略概率比 |
| Reward Model | RM、Reward Scorer | RLHF-PPO 中通常冻结 | 为生成结果提供奖励 |
| Reference Model | Reference Policy、Ref Model | 冻结 | 计算 KL 惩罚，约束 Actor 的偏移 |

## 二、马尔可夫决策过程与 PPO 的采样循环

### 1. 什么是马尔可夫决策过程？

PPO 处理的基本问题通常被建模为马尔可夫决策过程（Markov Decision Process，MDP）。一个 MDP 可以写成：

$$
(\mathcal S,\mathcal A,P,R,\gamma)
$$

- $\mathcal S$：状态空间（State Space）。
- $\mathcal A$：动作空间（Action Space）。
- $P$：环境的状态转移规律。
- $R$：执行动作后得到的奖励。
- $\gamma$：折扣因子，控制未来奖励的重要程度。

马尔可夫性的核心是：**只要当前状态 $s_t$ 包含的信息足够完整，下一状态和奖励就只依赖当前状态 $s_t$ 与当前动作 $a_t$，不需要再次查看更早的完整历史。**

$$
P(s_{t+1},r_t\mid s_0,a_0,\ldots,s_t,a_t)
=
P(s_{t+1},r_t\mid s_t,a_t)
$$

### 2. 一轮交互如何发生？

在时间步 $t$，一次交互可以拆成以下步骤：

1. Actor 接收当前状态 $s_t$。
2. Actor 输出动作的概率分布 $\pi_\theta(\cdot\mid s_t)$。
3. 从概率分布中采样动作 $a_t$，交给环境执行。
4. 环境返回奖励 $r_t$ 和新状态 $s_{t+1}$。
5. 每个出现的状态都会送入 Critic，得到对应的价值估计 $V_\phi(s)$。
6. 将 $s_{t+1}$ 作为下一轮的当前状态，重复上述过程，直到任务结束。

### 3. 一条 trajectory 的横向时序图

![PPO Rollout 时序图](/images/posts/ppo-guide/ppo-rollout-timeline.png)

> **要点｜Actor 和 Critic 如何分工？**
> - **Actor 读取状态，输出动作概率，并决定接下来做什么。**
> - **Critic 读取状态，输出 Value，并判断这个状态预计有多好。**
> - Critic 不需要等 Actor 完整执行结束才工作；对于轨迹中出现的每个状态，都可以计算对应的 $V_\phi(s_t)$。

### 4. 最终得到一条 trajectory

不断重复上述交互，就会得到一条轨迹：

$$
\tau
=
(s_0,a_0,r_0,s_1,a_1,r_1,\ldots,s_T)
$$

严格来说，环境 trajectory 主要由状态、动作和奖励组成。为了后续进行 PPO 更新，rollout buffer 通常还会额外保存 Critic 的 Value、旧策略的动作概率以及终止标记：

$$
(s_t,a_t,r_t,s_{t+1},V_\phi(s_t),
\log\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t),\mathrm{done}_t)
$$

这些数据共同用于计算 Return、Advantage 和 PPO Loss。

### 5. 对应到 LLM

| MDP / PPO 概念 | LLM 中的对应物 |
|---|---|
| State $s_t$ | Prompt 加上当前已经生成的 token |
| Actor / Policy | 正在训练的 LLM |
| 动作概率 $\pi_\theta(\cdot\mid s_t)$ | LLM 对词表中下一个 token 的概率分布 |
| Action $a_t$ | 从概率分布中选出的下一个 token |
| 新状态 $s_{t+1}$ | 在原上下文后追加新 token 得到的新上下文 |
| Trajectory $\tau$ | 从 Prompt 开始生成的一整段 token 序列 |
| Reward | 对完整回答或交互结果的评分 |

因此，在 LLM 中，一整个回答不是一个 Action，而是由许多个 token-level Action 依次组成的一条 trajectory。

## 三、从 trajectory到优势和 return，再到 Loss

采集到 trajectory 后，实践中的 PPO 通常会把 Reward、rollout Values、终止标记以及超参数 $\gamma,\lambda$ 一起送入 GAE，再分别构造 Actor 和 Critic 所需的训练信号：

![PPO 从 Rollout 经 GAE 得到 Advantage、Return 与 Loss](/images/posts/ppo-guide/ppo-gae-to-loss.png)

可以先用一句话记住：

> **Return 表示实际获得了多少回报，Value 表示 Critic 原本预计能获得多少回报，Advantage 表示实际结果比预期好多少。Advantage 用于训练 actor，Return 用于训练 critic，**

### 1. 从 Reward 和 Value 计算 Advantage 与 Return

采集到 trajectory 后，我们已经拥有每个时间步的 Reward、rollout Value 和终止标记。接下来需要从这些数据中计算两种训练信号：

- **Advantage**：用于训练 Actor，表示这个动作比当前策略在该状态下的预期好多少；
- **Return target**：用于训练 Critic，表示 Critic 应当拟合的价值目标。

状态价值 $V^\pi(s_t)$ 评价的是：处于状态 $s_t$ 后，继续按照策略 $\pi$ 行动，预期可以获得多少未来回报。动作价值 $Q^\pi(s_t,a_t)$ 则评价：先在 $s_t$ 执行动作 $a_t$，之后再按照策略 $\pi$ 行动，预期可以获得多少未来回报。

因此，Advantage 的理论定义是：

$$
A^\pi(s_t,a_t)=Q^\pi(s_t,a_t)-V^\pi(s_t)
$$

对于离散动作：

$$
V^\pi(s_t)
=
\mathbb E_{a\sim\pi(\cdot\mid s_t)}
\left[Q^\pi(s_t,a)\right]
$$

这里的“预期水平”不是所有动作回报的简单算术平均，也不是整个训练集的平均值，而是**按照当前策略的动作概率加权得到的期望水平**。

直观上：

- $A_t>0$：这个动作比当前策略在该状态下的预期更好，Actor 应提高它的概率；
- $A_t<0$：这个动作比当前策略在该状态下的预期更差，Actor 应降低它的概率；
- $A_t\approx0$：这个动作与预期差不多，不需要大幅调整。

计算时需要区分两条路径：

```text
基础版本：Reward → Monte Carlo Return → Advantage
                         ① Return          ② Advantage

GAE 版本：Reward + rollout Value → TD Error → GAE Advantage → GAE Return target
                                                   ① Advantage      ② Return
```

#### 基础版：先计算 Monte Carlo Return，再计算 Advantage

##### 第一步：对未来 Reward 折扣求和——得到 Return

环境在每个时间步给出即时奖励 $r_t$。最直观的方法是等待一条轨迹结束，然后把从当前时刻开始的未来奖励折扣求和：

$$
G_t^{\text{MC}}
=
\sum_{l=0}^{T-t}\gamma^l r_{t+l}
=
r_t+\gamma r_{t+1}+\gamma^2r_{t+2}+\cdots
$$

也可以递归地写成：

$$
G_t^{\text{MC}}=r_t+\gamma G_{t+1}^{\text{MC}}
$$

其中 $\gamma\in[0,1]$ 是折扣因子：

- $\gamma$ 越接近 $0$，越重视眼前奖励；
- $\gamma$ 越接近 $1$，越重视长期奖励。

基础版本直接把 Monte Carlo Return 作为 Critic 的训练目标：

$$
\boxed{\hat R_t^{\text{MC}}=G_t^{\text{MC}}}
$$

至此，我们算出了基础版本的 **Return target**。

##### 第二步：用 Return 减去 rollout Value——得到 Advantage

理论上的 $Q^\pi(s_t,a_t)$ 无法直接得到，因此用这次采样实际得到的 Monte Carlo Return 近似它：

$$
\boxed{
\hat A_t^{\text{MC}}
=
G_t^{\text{MC}}-V_{\text{rollout}}(s_t)
}
$$

其中 $V_{\text{rollout}}(s_t)$ 表示采集这条 trajectory 时，Critic 对状态 $s_t$ 的预测。至此，我们算出了基础版本的 **Advantage**。

Monte Carlo 方法的特点是：

- 不使用未来状态的 Value 进行 bootstrap，概念简单；
- 必须等轨迹结束才能计算；
- 直接依赖整条轨迹的随机奖励，通常方差较大。

#### 实践版：先用 GAE 计算 Advantage，再构造 Return target

PPO 实践中通常不直接使用完整 Monte Carlo Return，而是使用 GAE（Generalized Advantage Estimation）在“真实长程回报”和“Critic 的短程预测”之间做折中。

##### 第一步：计算每个时间步的 TD Error

$$
\delta_t
=
r_t+\gamma(1-d_t)V_{\text{rollout}}(s_{t+1})
-V_{\text{rollout}}(s_t)
$$

其中 $d_t$ 表示执行 $a_t$ 后是否真正终止。如果轨迹在这里终止，则 $d_t=1$，不再使用下一状态的 Value。

TD Error 的直觉是：

$$
\delta_t
=
\underbrace{r_t+\gamma(1-d_t)V_{\text{rollout}}(s_{t+1})}_{\text{执行动作后得到的新估计}}
-
\underbrace{V_{\text{rollout}}(s_t)}_{\text{执行动作前的旧估计}}
$$

##### 第二步：从轨迹末尾向前递推——得到 Advantage

$$
\boxed{
\hat A_t^{\text{GAE}}
=
\delta_t
+\gamma\lambda(1-d_t)\hat A_{t+1}^{\text{GAE}}
}
$$

展开后等价于：

$$
\hat A_t^{\text{GAE}(\gamma,\lambda)}
=
\delta_t
+(\gamma\lambda)\delta_{t+1}
+(\gamma\lambda)^2\delta_{t+2}
+\cdots
$$

$\lambda$ 控制偏差与方差之间的权衡：

- $\lambda=0$：只使用一步 TD Error，更依赖 Critic，方差低但偏差可能更大；
- $\lambda$ 越接近 $1$：考虑越长的未来信息，更接近 Monte Carlo 方法，偏差降低但方差增大。

在完整轨迹正常终止、终点不再 bootstrap 的条件下，$\lambda=1$ 时的 GAE Advantage 会退化为 $G_t^{\text{MC}}-V_{\text{rollout}}(s_t)$。

至此，我们算出了实践中用于训练 Actor 的 **GAE Advantage**。

##### 第三步：把 Advantage 加回 rollout Value——得到 Return target

$$
\boxed{
\hat R_t^{\text{GAE}}
=
\hat A_t^{\text{GAE}}
+V_{\text{rollout}}(s_t)
}
$$

至此，我们算出了实践中用于训练 Critic 的 **GAE Return target**。代码中的变量 `returns` 通常指这个量，它不一定等于直接对完整轨迹计算出的 Monte Carlo Return。

完整的反向计算过程可以写成：

```python
last_advantage = 0

for t in reversed(range(T)):
    nonterminal = 1 - done[t]
    next_value = values[t + 1]

    delta = (
        rewards[t]
        + gamma * next_value * nonterminal
        - values[t]
    )

    advantages[t] = (
        delta
        + gamma * gae_lambda * nonterminal * last_advantage
    )
    last_advantage = advantages[t]

returns = advantages + values
```

> **要点｜不要混淆**
> - $G_t^{\text{MC}}$：轨迹结束后，直接对未来奖励折扣求和，是基础版的 Return target。
> - $\hat A_t^{\text{GAE}}$：由多步 TD Error 加权得到的 Advantage 估计，用于训练 Actor。
> - $\hat R_t^{\text{GAE}}=\hat A_t^{\text{GAE}}+V_{\text{rollout}}(s_t)$：实践中训练 Critic 的 Return target，代码里常叫 `returns`。

#### LLM 中的特殊点：从 sequence reward 开始同一套计算

在 LLM 中，每个 response token 都是一个 Action，所以需要为每个有效 response token 计算一个 Value、Advantage 和 Return target。

经典 RLHF-PPO 中，Reward Model 通常先对完整回答给出一个 sequence-level reward。这里最容易产生一个误解：**不是把一个总奖励平均分给每个 token**。

给定 Prompt $x$，Actor 依次生成回答 $y_1,y_2,\ldots,y_T$。对于第 $t$ 个 token：

$$
s_t=(x,y_{<t}),\qquad a_t=y_t
$$

Reward Model 读取完整的 Prompt 和回答，输出一个标量：

$$
R_{\text{RM}}=\operatorname{RM}(x,y_{1:T})
$$

经典 RLHF-PPO 还常在每个 response token 上计算相对 Reference Model 的采样 KL：

$$
k_t
=
\log\pi_{\text{rollout}}(y_t\mid s_t)
-
\log\pi_{\text{ref}}(y_t\mid s_t)
$$

由此构造一条与 response token 对齐的奖励序列：

$$
r_t=
\begin{cases}
-\beta k_t, & t<T,\\[4pt]
R_{\text{RM}}-\beta k_T, & t=T.
\end{cases}
$$

也就是说：

- 前面的 token 没有直接的任务奖励，但可以有各自的 KL 惩罚；
- 最后一个有效 token 得到完整的 $R_{\text{RM}}$，同时也有自己的 KL 惩罚；
- Prompt token 和 Padding token 通过 mask 排除，不参与这条奖励序列和后续 PPO Loss。

![RLHF-PPO 从 Sequence Reward 到 Token Advantage](/images/posts/ppo-guide/rlhf-sequence-reward-to-token-advantage.png)

得到逐 token Reward 后，GAE 从最后一个有效 response token 开始向前递推。下面具体看最终奖励是如何影响每个 token 的。

假设回答包含 $T$ 个 token，并且第 $T$ 个 token 后真正终止，那么 $d_T=1$。最后一个位置的 TD Error 为：

$$
\delta_T
=
r_T-V_{\text{rollout}}(s_T)
$$

由于 $r_T$ 中包含完整的 $R_{\text{RM}}$，所以最终任务奖励首先进入 $\delta_T$。接着从右向左递推：

$$
\begin{aligned}
\hat A_T
&=\delta_T,\\
\hat A_{T-1}
&=\delta_{T-1}+\gamma\lambda\delta_T,\\
\hat A_{T-2}
&=\delta_{T-2}+\gamma\lambda\delta_{T-1}
+(\gamma\lambda)^2\delta_T,\\
&\ \vdots\\
\hat A_t
&=\delta_t+\gamma\lambda\delta_{t+1}
+\cdots+(\gamma\lambda)^{T-t}\delta_T.
\end{aligned}
$$

因此，只看最终任务奖励 $R_{\text{RM}}$ 对前面位置的贡献，它在第 $t$ 个 token 的 Advantage 中对应：

$$
(\gamma\lambda)^{T-t}R_{\text{RM}}
$$

距离结尾越远，影响通常会被 $\gamma\lambda$ 逐步衰减。如果 $\gamma=\lambda=1$，最终奖励会以相同权重影响前面的所有 token；如果 $\lambda<1$，越早的 token 接收到的信用越弱。

##### 一个四 token 的具体例子

为了单独观察最终奖励的传播，暂时忽略 KL 惩罚，并假设 Critic 在所有位置的初始预测都是 $0$：

$$
[r_1,r_2,r_3,r_4]=[0,0,0,4]
$$

取 $\gamma=1,\lambda=0.95$。因为只有最后一个 token 有奖励，所以：

$$
[\delta_1,\delta_2,\delta_3,\delta_4]=[0,0,0,4]
$$

然后从右向左计算：

| 位置 | 当前 TD Error | GAE 反向计算 | 得到的 Advantage |
|---|---:|---|---:|
| token 4 | $4$ | $\hat A_4=4$ | $4$ |
| token 3 | $0$ | $\hat A_3=0+0.95\times4$ | $3.8$ |
| token 2 | $0$ | $\hat A_2=0+0.95\times3.8$ | $3.61$ |
| token 1 | $0$ | $\hat A_1=0+0.95\times3.61$ | $3.4295$ |

虽然 token 1、2、3 没有直接获得任务奖励，但它们的 Advantage 都受到了最终奖励的影响。这就是 GAE 对终止奖励进行**时间信用分配**的具体过程。

最后，为每个位置构造 Return target：

$$
\hat R_t^{\text{GAE}}
=
\hat A_t^{\text{GAE}}+V_{\text{rollout}}(s_t)
$$

在这个简化例子中 $V_{\text{rollout}}=0$，因此：

$$
[\hat R_1,\hat R_2,\hat R_3,\hat R_4]
=
[3.4295,3.61,3.8,4]
$$

真实训练中，逐 token KL 惩罚通常不为零，Critic 的 Value 也不为零。因此每个位置都有自己的 $\delta_t$；最终 Advantage 是“当前位置的 TD Error”和“后续所有 TD Error 的衰减和”，不会只是上面这组简单的等比数列。

> **要点｜最终奖励不是被平均拆分**
> GAE 没有把 $R_{\text{RM}}$ 平均分成 $T$ 份。它把最终奖励放在最后一个位置，再通过反向递推，让它以不同权重进入前面各 token 的 Advantage。

很多实现还会在 batch 内对 Advantage 做标准化，使其均值接近 $0$、标准差接近 $1$，以提高训练稳定性。

### 2. Actor Loss：根据 Advantage 调整动作概率

PPO 首先比较当前 Actor 和采集 trajectory 时的 Old Policy 对同一个动作给出的概率。为了避免与环境奖励 $r_t$ 混淆，这里把概率比记作 $\rho_t(\theta)$：

$$
\rho_t(\theta)
=
\frac{\pi_\theta(a_t\mid s_t)}
{\pi_{\theta_{\text{old}}}(a_t\mid s_t)}
=
\exp\left(
\log\pi_\theta(a_t\mid s_t)
-
\log\pi_{\theta_{\text{old}}}(a_t\mid s_t)
\right)
$$

![PPO 概率比与梯度传播路径](/images/posts/ppo-guide/ppo-ratio-gradient-path.png)

梯度关系可以简单记成：

- **有梯度**：当前 Actor 重新计算的 `log_prob`、由它得到的 $\rho_t$ 以及 PPO Loss。梯度沿这条路径传回 Actor 参数 $\theta$；
- **无梯度**：rollout 时保存的 `old_log_prob` 和预先计算的 $\hat A_t$，二者都作为 `detach` 后的固定训练信号使用。

如果直接使用 $\rho_t\hat A_t$ 更新，Actor 可能一次改变太多。PPO 使用 clipped surrogate objective 限制这种变化：

$$
L^{\text{CLIP}}(\theta)
=
\mathbb E_t\left[
\min\left(
\rho_t(\theta)\hat A_t,
\operatorname{clip}(\rho_t(\theta),1-\epsilon,1+\epsilon)\hat A_t
\right)
\right]
$$

上式是一套通用模板。代入不同的 Advantage 估计，就得到对应的两个版本。

基础 Monte Carlo 版：

$$
L_{\text{actor}}^{\text{MC}}
=
-\mathbb E_t\left[
\min\left(
\rho_t(\theta)\hat A_t^{\text{MC}},
\operatorname{clip}(\rho_t(\theta),1-\epsilon,1+\epsilon)
\hat A_t^{\text{MC}}
\right)
\right]
$$

实践 GAE 版：

$$
L_{\text{actor}}^{\text{GAE}}
=
-\mathbb E_t\left[
\min\left(
\rho_t(\theta)\hat A_t^{\text{GAE}},
\operatorname{clip}(\rho_t(\theta),1-\epsilon,1+\epsilon)
\hat A_t^{\text{GAE}}
\right)
\right]
$$

这个目标在数学上需要被**最大化**。深度学习框架通常默认最小化 Loss，因此代码里常写成：

$$
L_{\text{actor}}=-L^{\text{CLIP}}
$$

其直觉是：

- Advantage 为正时，提高该动作概率，但不允许一次提高过多；
- Advantage 为负时，降低该动作概率，但不允许一次降低过多。

#### LLM 中的特殊点

LLM 的 Actor Loss 仍然是同一个 PPO clipped objective，只是它作用在 **token-level action** 上：

- 当前 LLM 重新计算生成 token 的 `log_prob`；
- 与 rollout 时保存的 `old_log_prob` 计算概率比；
- 使用对应 token 的 Advantage 计算 clipped loss；
- 最后只对有效 response token 做 masked mean。

Prompt token 和 Padding token 不是这次采样得到的 Action，通常不参与 Actor Loss。

### 3. Critic Loss：让 Value 更接近 Return

Critic 的任务是让当前预测 $V_\phi(s_t)$ 接近 rollout 数据计算出的价值目标。不同 Advantage 估计方法对应不同的 Critic target。

#### 基础 Monte Carlo 版

直接把实际累计回报作为 target：

$$
\hat R_t^{\text{MC}}=G_t^{\text{MC}}
$$

因此：

$$
L_{\text{critic}}^{\text{MC}}
=
\frac{1}{2}\mathbb E_t\left[
\left(V_\phi(s_t)-G_t^{\text{MC}}\right)^2
\right]
$$

#### 实践 GAE 版

先用 rollout 时保存的 Value 计算 GAE Advantage，再构造 GAE Return：

$$
\hat R_t^{\text{GAE}}
=
\hat A_t^{\text{GAE}}
+V_{\text{rollout}}(s_t)
$$

因此：

$$
L_{\text{critic}}^{\text{GAE}}
=
\frac{1}{2}\mathbb E_t\left[
\left(V_\phi(s_t)-\hat R_t^{\text{GAE}}\right)^2
\right]
$$

这里的 $V_{\text{rollout}}$ 是生成训练目标时使用的旧 Value；$V_\phi$ 是正在被优化的 Critic。训练时把 $\hat R_t^{\text{GAE}}$ 当作固定 target，不让梯度通过它反向传播。

因此，Actor 和 Critic 使用的是同一批 rollout 数据，但学习目标不同：

- Actor 根据 Advantage 学习哪些动作应该更常出现；
- Critic 根据 Return target 学习如何更准确地评价状态。

一些 PPO 实现还会对 Value 的变化做 clipping，避免 Critic 在一次更新中变化过大。

#### LLM 中的特殊点

LLM 的 Value Model 通常为每个 token 位置输出一个标量 Value，因此 Critic Loss 同样只在有效 response token 上计算，并排除 Prompt 与 Padding。

Actor 与 Critic 可以是两个独立模型，也可以共享同一个 Transformer backbone，再分别连接 policy head 和 value head；这属于工程结构差异，不改变 PPO 的基本公式。


## 四、总 Loss 和一次完整的 PPO 更新流程

### 1. 总 Loss 的定义

前面已经分别得到了 Actor Loss 和 Critic Loss。常见的 PPO 总 Loss 可以写成：

$$
\boxed{
L_{\text{total}}
=
L_{\text{actor}}
+c_vL_{\text{critic}}
-c_e\mathcal H(\pi_\theta)
}
$$

其中：

- $L_{\text{actor}}$：PPO clipped loss，使用 Advantage 更新策略；
- $L_{\text{critic}}$：Value loss，使 Critic 预测接近 Return target；
- $\mathcal H(\pi_\theta)$：当前策略的熵，鼓励策略保留一定探索能力；
- $c_v$：控制 Critic Loss 的权重；
- $c_e$：控制熵奖励的权重。

这里把 $L_{\text{actor}}$ 定义成需要**最小化**的负 clipped objective，因此总 Loss 中直接加上它；熵越大通常越有利，所以熵项前面带负号。

在 LLM 中，每个有效 response token 都会产生自己的 Actor Loss、Critic Loss 和 Entropy，Prompt 与 Padding 通过 mask 排除。各项先分别做 masked mean，再组合成最终的标量 Loss。

> **说明｜工程实现不一定真的只有一个 Loss**
> 如果 Actor 和 Critic 共享 backbone，通常可以组合成一个 $L_{\text{total}}$，一次反向传播共同更新。如果 Actor 和 Critic 是两个独立模型，也可以分别使用 Actor optimizer 和 Critic optimizer；上面的公式主要表达它们在一次 PPO 更新中的总体目标。

经典 RLHF-PPO 中，KL 惩罚经常已经被加入逐 token Reward。如果某个框架把 KL 写成独立 Loss，则还需要在总 Loss 中加入对应项，具体以代码实现为准。

### 2. 一次完整的 PPO 迭代

与下图一致，PPO 的一次迭代分成三个阶段：

```text
阶段 A：使用当前策略收集一批 rollout 数据
阶段 B：计算并固定 Advantage 与 Return target
阶段 C：固定这批数据，对它连续进行多轮更新
```

阶段 C 完成后会停止使用这批旧数据，再用更新后的策略开始下一轮阶段 A；这只是迭代之间的循环衔接，不再单独编号。

![PPO 一次完整训练迭代](/images/posts/ppo-guide/ppo-training-iteration.png)

#### 阶段 A：收集一批 rollout 数据

首先用当前策略与环境交互，收集固定数量的决策步。这里把决策步总数记作 $N_{\text{step}}$，其中每一步对应一条 state-action transition：

$$
(s_t,a_t,r_t,d_t,
\log\pi_{\text{old}}(a_t\mid s_t),
V_{\text{rollout}}(s_t))
$$

$N_{\text{step}}$ **不是完整轨迹的条数**。例如并行运行 $E=16$ 个环境，每个环境收集 $H=128$ 步，那么：

$$
N_{\text{step}}=E\times H=16\times128=2048
$$

这 2048 个决策步可能来自多条完整 trajectory，也可能包含某些 trajectory 的截断片段。

**不要求一次必须刚好跑完一条完整 trajectory：**

- 如果 episode 在收满 $N_{\text{step}}$ 步之前终止，就重置环境，继续收集下一个 episode；
- 如果收满 $N_{\text{step}}$ 步时 episode 还没有终止，就暂时截断这一段 rollout；
- 对真正终止的位置，下一状态的 Value 取 $0$；
- 对仅因 rollout 长度而截断的位置，可以使用最后状态的 Value 进行 bootstrap。

每个决策步通常保存：

- State 和实际执行的 Action；
- Reward 与终止标记 `done`；
- rollout 时旧策略对该动作的 `old_log_prob`；
- rollout 时 Critic 给出的 `old_value`。

在 LLM 中，一批 rollout 通常包含 $B_{\text{seq}}$ 个 Prompt 及其回答。每个有效 response token 都是一个决策步，因此总决策步数为：

$$
N_{\text{token}}
=
\sum_{b=1}^{B_{\text{seq}}}T_b
$$

其中 $T_b$ 是第 $b$ 条回答的有效 response token 数。这里需要同时区分“回答条数” $B_{\text{seq}}$ 和“token-level 决策步数” $N_{\text{token}}$。

> **要点｜Rollout 阶段不更新参数**
> 采集数据时通常处于推理模式，并使用 `no_grad`。必须先得到一批由同一版本策略生成的数据，之后才能计算固定的 `old_log_prob`、Advantage 和 Return target。

#### 阶段 B：计算并固定 Advantage 与 Return target

收集完成后，根据 Reward、rollout Value 和 `done` 计算：

```text
Reward + old_value + done
             ↓
            GAE
       ┌─────┴─────┐
       ↓           ↓
  Advantage    Return target
  训练 Actor    训练 Critic
```

这些量在接下来的多轮 PPO 更新中保持不变：

- `old_log_prob`：作为概率比的固定分母；
- Advantage：作为 Actor 的固定训练信号；
- Return target：作为 Critic 的固定监督目标。

它们都应当 `detach`，不参与反向传播。

#### 阶段 C：对同一批 rollout 连续更新多次

一批 on-policy 数据的采集成本很高，所以 PPO 不会只使用它做一次梯度更新。通常会：

1. 在 GAE 已经计算完成后，打乱训练样本的索引；
2. 将训练样本切分成多个 mini-batch；
3. 对每个 mini-batch 重新计算当前 Actor 的 `new_log_prob` 和当前 Critic 的 `new_value`；
4. 计算 Actor Loss、Critic Loss 和 Entropy；
5. 执行 `backward()` 和 `optimizer.step()`；
6. 将同一批 rollout 重复训练 $K$ 个 update epochs。

##### Mini-batch 的划分与数据打乱

GAE 计算完成后，rollout buffer 中的 `old_log_prob`、Advantage 和 Return target 已经固定，接下来才把数据交给 DataLoader。

设 DataLoader 实际接收的训练单元数量为 $N_{\text{unit}}$，每个 mini-batch 包含 $M_{\text{unit}}$ 个训练单元，那么一个 update epoch 包含：

$$
\left\lceil
\frac{N_{\text{unit}}}{M_{\text{unit}}}
\right\rceil
$$

个 mini-batch。这里的训练单元不一定是一条完整轨迹：

- 普通前馈 PPO 通常把所有 transition 展平，此时 $N_{\text{unit}}=N_{\text{step}}$；
- LLM PPO 通常以一条 Prompt/Response sequence 作为训练单元，此时 $N_{\text{unit}}=B_{\text{seq}}$；
- 每条 LLM sequence 内部包含多个有效 response token，最终 Loss 对这些 token 做 masked mean；
- 使用 sequence packing 或动态 token budget 时，mini-batch 的实际组织方式由 DataLoader 决定。

数据打乱同样发生在 GAE 计算完成之后。计算 GAE 时必须保留同一条轨迹中 $t$ 与 $t+1$ 的关系，才能从末尾向前递推 Advantage。训练目标固定以后，普通前馈 PPO 可以把不同环境、不同轨迹和不同时间步的 transition 全部展平，再随机打乱 transition 索引，使每个 mini-batch 混合来自不同位置的数据。

LLM PPO 通常随机打乱 Prompt/Response sequence 之间的顺序，而保留一条回答内部的 token 顺序。保留内部顺序不是 PPO Loss 的要求：当每个位置的 Loss 已经算出后，求和或求平均与排列顺序无关：

$$
\sum_t\ell_{\sigma(t)}=\sum_t\ell_t
$$

保留 token 顺序是为了高效地重新计算：

$$
\log\pi_\theta(y_t\mid x,y_{<t})
$$

Transformer 需要看到正确的前缀 $x,y_{<t}$。将完整回答按原顺序送入一次带 causal mask 的前向传播，就能同时得到所有 token 的 `new_log_prob` 和 Value。理论上也可以给每个 token 单独携带完整 prefix，再任意打乱 token 样本，但这会重复计算大量相同前缀，实际训练通常不会这样做。

因此，一批 rollout 对应的梯度更新次数大约是：

$$
K\times\left\lceil\frac{N_{\text{unit}}}{M_{\text{unit}}}\right\rceil
$$

例如：

$$
N_{\text{unit}}=2048,\qquad M_{\text{unit}}=256,\qquad K=4
$$

每个 epoch 有 $2048/256=8$ 个 mini-batch，所以这一批数据一共会执行：

$$
4\times8=32
$$

次梯度更新。

虽然 `old_log_prob`、Advantage 和 Return target 在这 $32$ 次更新中保持不变，但 Actor 和 Critic 的参数在不断改变，所以每个 mini-batch 都需要重新计算 `new_log_prob` 与 `new_value`。

> **要点｜多次利用，但不能无限利用**
> PPO 是 on-policy 算法。同一批 rollout 可以通过 mini-batch 和多个 update epochs 得到充分利用，但更新次数不能无限增加。策略变化过大后，这批数据会变得过旧，概率比也会偏离 $1$。实践中通常使用较小的 $K$，并可通过 clip fraction 或近似 KL 提前停止更新。

#### 完成本轮更新：进入下一轮迭代

完成 $K$ 个 update epochs 后：

1. 停止使用这一批 rollout；
2. 更新后的当前 Actor 成为下一轮采样策略；
3. 使用它重新收集一批新数据，并保存新的 `old_log_prob`；
4. 重复 GAE 与多轮更新过程。

很多实现并不需要真的复制一个独立的 Old Policy 模型。只要在 rollout 时保存动作对应的 `old_log_prob`，就已经固定了计算概率比所需的旧策略信息。

### 3. PyTorch 风格伪代码

下面的代码省略了分布式训练、混合精度和 Value clipping，但保留了一次 PPO 迭代的完整主线：

```python
def masked_mean(x, mask):
    mask = mask.to(x.dtype)
    return (x * mask).sum() / mask.sum().clamp_min(1.0)


trainable_parameters = [
    p
    for group in optimizer.param_groups
    for p in group["params"]
]


for iteration in range(num_iterations):
    # ============================================================
    # 阶段 A：使用当前策略收集 N_step 个决策步
    # ============================================================
    actor.eval()
    critic.eval()

    with torch.no_grad():
        rollout = collect_rollout(
            actor=actor,
            critic=critic,
            horizon=N_step,
        )

        # rollout 中包含：
        # states, actions, rewards, dones, mask,
        # old_log_probs, old_values, next_value

        # ========================================================
        # 阶段 B：计算并固定 Advantage 与 Return target
        # ========================================================
        advantages, returns = compute_gae(
            rewards=rollout.rewards,
            values=rollout.old_values,
            dones=rollout.dones,
            next_value=rollout.next_value,
            gamma=gamma,
            gae_lambda=gae_lambda,
        )

        advantages = masked_normalize(
            advantages,
            rollout.mask,
        )

        # 整个更新阶段都保持固定
        old_log_probs = rollout.old_log_probs.detach()
        advantages = advantages.detach()
        returns = returns.detach()

    # ============================================================
    # 阶段 C：同一批 rollout 重复训练 K 个 update epochs
    # ============================================================
    actor.train()
    critic.train()

    for epoch in range(update_epochs):
        for idx in iterate_minibatches(
            # 普通 PPO 可取 transition 数；
            # LLM PPO 通常取本轮的 sequence / packed-sample 数。
            num_items=rollout.num_training_units,
            minibatch_size=minibatch_size,
            shuffle=True,
        ):
            states = rollout.states[idx]
            actions = rollout.actions[idx]
            mask = rollout.mask[idx]

            # 当前参数下重新计算，因此保留梯度
            new_log_probs, entropy = actor.evaluate_actions(
                states,
                actions,
            )
            new_values = critic(states)

            # ---------- Actor Loss ----------
            log_ratio = new_log_probs - old_log_probs[idx]
            ratio = log_ratio.exp()

            adv = advantages[idx]
            surrogate_1 = ratio * adv
            surrogate_2 = torch.clamp(
                ratio,
                1.0 - clip_eps,
                1.0 + clip_eps,
            ) * adv

            actor_loss = -masked_mean(
                torch.minimum(surrogate_1, surrogate_2),
                mask,
            )

            # ---------- Critic Loss ----------
            critic_loss = 0.5 * masked_mean(
                (new_values - returns[idx]) ** 2,
                mask,
            )

            # ---------- Entropy Bonus ----------
            entropy_bonus = masked_mean(entropy, mask)

            total_loss = (
                actor_loss
                + value_coef * critic_loss
                - entropy_coef * entropy_bonus
            )

            optimizer.zero_grad()
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(
                parameters,
                max_grad_norm,
            )
            optimizer.step()

    # 本批 rollout 到此停止使用。
    # 下一轮会用更新后的 actor 重新采样并保存新的 old_log_probs。
```

如果 Actor 和 Critic 使用两个独立 optimizer，可以分别对 Actor objective 和 Critic Loss 执行反向传播与参数更新；数据收集、GAE 和多轮 mini-batch 复用的主流程不变。

> **要点｜PPO 的最终主线**
> **先用当前策略收集一批 on-policy 数据；再固定 old log-prob、Advantage 和 Return target；然后把同一批数据切成 mini-batch，连续更新多个 epochs；最后停止复用旧数据，用更新后的策略重新采样。**
