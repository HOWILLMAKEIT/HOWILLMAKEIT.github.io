+++
title = '给 CC Switch 的 Skills 管理页加上搜索功能'
date = '2026-07-14T23:22:00+08:00'
lastmod = '2026-07-15T01:30:00+08:00'
draft = false
description = '当本地安装了上百个 Skill，仅靠滚动列表已经很难定位目标。本文记录如何跨越 React 与 Tauri 边界，为 CC Switch 实现名称、描述和 SKILL.md 正文的本地即时搜索。'

[cover]
  image = '/images/posts/cc-switch-skill-search/skills-search-cover.png'
  alt = 'CC Switch Skills 管理页使用内容范围搜索 ppt'
  caption = 'CC Switch Skills 搜索：通过描述与 SKILL.md 正文定位目标能力'
+++

> 本文记录我为开源桌面工具 **[CC Switch](https://github.com/farion1231/cc-switch)** 增加 Skills 搜索功能的开发过程。相关需求来自 [Issue #1879](https://github.com/farion1231/cc-switch/issues/1879)，完整实现与讨论见 [Pull Request #5359](https://github.com/farion1231/cc-switch/pull/5359)。

## 从滚动查找，到即时过滤

CC Switch 是一款用于统一管理 AI CLI、MCP 和 Skills 的桌面工具。其中，Skill 可以理解为一组以 `SKILL.md` 为入口的本地能力说明与配套资源。

改造前，Skills 管理页只展示已安装列表。当本地只有十几个 Skill 时，滚动浏览已经够用；但数量增加到上百个后，寻找目标逐渐变成一件机械的事：记得名称尚可按首字母查找，只记得功能时，就只能逐项阅读描述。

{{< figure
    class="cc-search-figure"
    src="/images/posts/cc-switch-skill-search/skills-page-before-search.png"
    link="/images/posts/cc-switch-skill-search/skills-page-before-search.png"
    target="_blank"
    rel="noopener"
    alt="CC Switch 改造前的 Skills 管理页，只提供已安装 Skill 列表，没有搜索控件"
    title="图 1 · 改造前：只能浏览已安装列表"
    caption="页面已经安装 188 个 Skills，却没有可用于快速定位目标的搜索入口。"
>}}

为缩短查找路径，我在统计栏与列表之间增加了搜索框，并将搜索范围显式拆分为三种模式：

- **全部**：名称、描述或 `SKILL.md` 正文任一匹配即可；
- **名称**：只匹配 Skill 名称，适合已经记得部分名称时使用；
- **内容**：匹配描述与 `SKILL.md` 正文，适合只记得功能或使用场景时使用。

下面使用同一个关键词 `ppt` 展示三种范围的差异。

### 全部：尽可能召回相关 Skill

“全部”模式同时检查名称和内容。只要名称、描述或正文中的任一字段包含 `ppt`，对应 Skill 就会保留，适合用户只记得模糊线索时使用。

{{< figure
    class="cc-search-figure"
    src="/images/posts/cc-switch-skill-search/skills-search-all-ppt.png"
    link="/images/posts/cc-switch-skill-search/skills-search-all-ppt.png"
    target="_blank"
    rel="noopener"
    alt="CC Switch 在全部范围搜索 ppt，返回名称或内容与 ppt 相关的多个 Skills"
    title="图 2 · 全部范围：同时搜索名称与内容"
    caption="搜索 `ppt` 后返回 6 个结果；名称、描述或正文命中均可进入结果集。"
>}}

### 名称：定位明确的 Skill

切换到“名称”后，搜索范围收窄为 `skill.name`。同样输入 `ppt`，结果从 6 个减少到 1 个，只保留名称直接匹配的 `pptx`。

{{< figure
    class="cc-search-figure"
    src="/images/posts/cc-switch-skill-search/skills-search-name-ppt.png"
    link="/images/posts/cc-switch-skill-search/skills-search-name-ppt.png"
    target="_blank"
    rel="noopener"
    alt="CC Switch 在名称范围搜索 ppt，只返回名称包含 ppt 的 pptx Skill"
    title="图 3 · 名称范围：只匹配 Skill 名称"
    caption="严格按名称过滤可以减少内容相关但名称不匹配的结果，适合目标较明确的查找。"
>}}

### 内容：从功能描述反查 Skill

“内容”模式忽略名称，只检查结构化描述和去除 Front Matter 后的 `SKILL.md` 正文。因此，即使忘记了 Skill 名称，只要记得它与 PPT 制作相关，仍然可以通过功能关键词将其找回。

{{< figure
    class="cc-search-figure"
    src="/images/posts/cc-switch-skill-search/skills-search-content-ppt.png"
    link="/images/posts/cc-switch-skill-search/skills-search-content-ppt.png"
    target="_blank"
    rel="noopener"
    alt="CC Switch 在内容范围搜索 ppt，返回描述或 SKILL.md 正文包含 ppt 的 Skills"
    title="图 4 · 内容范围：搜索描述与 SKILL.md 正文"
    caption="内容搜索把 Skill 的用途转化为检索入口，解决“记得功能，却忘了名称”的查找问题。"
>}}

输入关键词后列表会立即过滤；没有结果时展示明确的空状态。搜索采用字段白名单：只匹配 `name`、`description` 和正文，Skill ID、安装目录、仓库及所有者等来源信息均不参与匹配。

功能看起来只是一个搜索框，但真正的问题是：**前端原有数据里并没有 `SKILL.md` 正文。**

## 数据为什么不能只在前端搜索

CC Switch 使用 Tauri 构建桌面应用。前端负责页面展示，Rust 后端负责数据库和本地文件访问。

数据库中已经保存了 Skill 的 ID、名称、描述和安装目录，但正文仍位于磁盘上的 `SKILL.md` 中。如果只过滤前端现有的数组，最多只能搜索名称和描述，无法回答“哪个 Skill 的文档里提到了 Kubernetes rollout”这类问题。

于是，完整的数据链路被拆成下面几层：

```text
数据库中的 Skill ID / 名称 / 描述 / 安装目录
                         +
               本地 SKILL.md 正文
                         ↓
       Rust 校验目录、读取并整理正文
                         ↓
               Tauri Command / API
                         ↓
              React Query 缓存正文
                         ↓
       页面按 Skill ID 合并元数据与正文
                         ↓
              内存子串匹配并过滤列表
```

Rust 负责安全地读取正文，Tauri Command 暴露调用边界，React Query 负责缓存，页面只处理搜索状态和过滤结果。

## Rust：读取并整理 Skill 正文

后端首先查询所有已安装 Skills，再通过安装目录定位对应的 `SKILL.md`，最终返回：

```text
Skill ID → SKILL.md 正文
```

核心逻辑如下：

```rust
pub fn get_installed_contents(
    db: &Arc<Database>,
) -> Result<HashMap<String, String>> {
    let skills = db.get_all_installed_skills()?;
    let ssot_dir = Self::get_ssot_dir()?;
    let mut contents = HashMap::with_capacity(skills.len());

    for skill in skills.values() {
        let Some(directory) = Self::sanitize_install_name(&skill.directory)
        else {
            log::warn!("Skip invalid Skill directory: {}", skill.directory);
            continue;
        };

        let skill_md = ssot_dir.join(directory).join("SKILL.md");
        match fs::read_to_string(&skill_md) {
            Ok(content) => {
                contents.insert(
                    skill.id.clone(),
                    Self::extract_skill_body(&content).to_string(),
                );
            }
            Err(error) => {
                log::warn!("Failed to read {}: {}", skill_md.display(), error);
            }
        }
    }

    Ok(contents)
}
```

这里有两个重要的边界设计。

第一，安装目录在拼接路径前必须经过校验，不能直接信任数据库中的字符串。第二，单个文件读取失败只记录日志并跳过，不应该让一个异常 Skill 阻塞整个管理页。

### 去除 YAML Front Matter

`SKILL.md` 通常以 YAML Front Matter 开头：

```yaml
---
name: example-skill
description: An example skill
---
```

这些字段已经通过结构化数据参与搜索，没有必要再混入正文。YAML 中还可能包含仓库等来源信息；如果把它一并当作正文，“内容”模式就可能因为名称或仓库字段命中，原本定义好的搜索边界也会失去意义。因此读取文件后会剥离头部，只把正文交给前端：

```rust
fn extract_skill_body(content: &str) -> &str {
    let content = content.trim_start_matches('\u{feff}');
    if !content.starts_with("---") {
        return content;
    }

    let mut sections = content.splitn(3, "---");
    sections.next();
    sections.next();
    sections
        .next()
        .unwrap_or(content)
        .trim_start_matches(['\r', '\n'])
}
```

同时先去掉 UTF-8 BOM，避免一个不可见字符让 Front Matter 判断失效。剥离元数据不会丢失描述：前端仍会通过结构化的 `skill.description` 单独搜索，这里排除的只是正文中重复或不应参与匹配的字段。

需要说明的是，这段轻量实现依赖 CC Switch 管理的 `SKILL.md` 遵循固定格式，并不是通用 YAML 解析器。若未来允许导入任意 Markdown，更稳妥的做法是按“独占一行的 `---`”识别开闭分隔符，并补充 CRLF、未闭合 Front Matter、正文含 `---`、以水平线开头等测试，避免错误截断正文。

## Tauri：建立前后端调用边界

Rust Service 不能被 React 直接调用，因此增加一个 Tauri Command：

```rust
#[tauri::command]
pub fn get_installed_skill_contents(
    app_state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    SkillService::get_installed_contents(&app_state.db)
        .map_err(|error| error.to_string())
}
```

注册命令后，前端 API 层只需要封装一次 `invoke`：

```ts
async getInstalledContents(): Promise<Record<string, string>> {
  return await invoke("get_installed_skill_contents");
}
```

页面不需要知道正文来自数据库还是文件系统，只依赖一个稳定的 `Skill ID → 正文` 接口。

## React Query：在性能与新鲜度之间取平衡

正文不会随每次输入重新读取。`useInstalledSkillContents()` 一次加载全部内容，并交给 React Query 缓存：

```ts
const INSTALLED_SKILL_CONTENTS_STALE_TIME_MS = 30 * 1000;

export function useInstalledSkillContents() {
  return useQuery({
    queryKey: INSTALLED_SKILL_CONTENTS_QUERY_KEY,
    queryFn: () => skillsApi.getInstalledContents(),
    staleTime: INSTALLED_SKILL_CONTENTS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
  });
}
```

这里把正文缓存的新鲜期设为 30 秒：用户连续输入时不会反复读取磁盘，长时间打开页面又不会永久持有旧数据。安装、卸载、更新、导入或恢复 Skill 的 Mutation 完成后，还会主动使查询失效：

```ts
queryClient.invalidateQueries({
  queryKey: INSTALLED_SKILL_CONTENTS_QUERY_KEY,
});
```

存储位置迁移也必须触发同样的失效。否则 Rust 后端已经改为读取新目录，前端却仍可能搜索迁移前缓存的正文：

```ts
export function useMigrateSkillStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: SkillStorageLocation) =>
      skillsApi.migrateStorage(target),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: INSTALLED_SKILL_CONTENTS_QUERY_KEY,
      });
    },
  });
}
```

还有一类变化不经过 CC Switch：用户可能在编辑器或终端里直接修改 `SKILL.md`。`refetchOnWindowFocus: "always"` 使应用窗口重新获得系统焦点时强制读取正文，即使当前缓存还在 30 秒新鲜期内也一样。这里的“切回”指从其他应用回到 CC Switch，而不是在 CC Switch 内部切换页面。

这套策略同时覆盖了三条更新路径：30 秒后的自然过期、应用内操作的主动失效，以及外部编辑后的焦点刷新。

## React：把搜索范围写成清晰的布尔逻辑

页面只维护两个状态：搜索词 `searchQuery` 和搜索范围 `searchScope`。这里没有建立倒排索引，也不做分词和相关性排序；实现本质上是不区分大小写的内存子串匹配。

过滤前先去除查询词两端的空格，并统一转换为小写。这里刻意使用不跟随操作系统语言的 `toLowerCase()`；如果使用 `toLocaleLowerCase()`，在土耳其语或阿塞拜疆语系统中，英文大写 `I` 会变成 `ı`，从而让 `Installed` 无法被 `installed` 匹配：

```ts
const trimmedSearchQuery = searchQuery.trim();
const normalizedSearchQuery = trimmedSearchQuery.toLowerCase();

function includesSearchQuery(
  value: string | undefined,
  normalizedQuery: string,
): boolean {
  return value?.toLowerCase().includes(normalizedQuery) ?? false;
}
```

`includesSearchQuery` 对候选字段执行相同的大小写归一化，并把缺失正文视为不匹配。随后通过 `useMemo` 计算结果：

```ts
const filteredSkills = useMemo(() => {
  if (!skills) return [];
  if (!normalizedSearchQuery) return skills;

  return skills.filter((skill) => {
    const matchesName = includesSearchQuery(
      skill.name,
      normalizedSearchQuery,
    );
    if (searchScope === "name") return matchesName;

    const matchesContent =
      includesSearchQuery(skill.description, normalizedSearchQuery) ||
      includesSearchQuery(skillContents[skill.id], normalizedSearchQuery);
    if (searchScope === "content") return matchesContent;

    return matchesName || matchesContent;
  });
}, [normalizedSearchQuery, searchScope, skillContents, skills]);
```

与其把三种搜索范围分别写成三套流程，这段实现先计算“名称是否匹配”和“内容是否匹配”，再根据范围组合结果。列表渲染也只需从 `skills.map(...)` 改为 `filteredSkills.map(...)`。

此外，页面补充了简体中文、繁体中文、英文和日文文案，并在零结果时显示搜索词，帮助用户判断是范围选错，还是确实没有匹配内容。正文仍在加载时，页面需要保留加载状态，避免把“数据尚未返回”误报为“没有结果”；若正文查询失败，原有名称和描述仍可搜索，但正文匹配会降级失效。

## 如何验证搜索没有越界

搜索功能的测试重点不只是“能搜到”，还包括“不会搜到不该搜的字段”和“修改后不会搜索旧缓存”。搜索过滤测试位于 `tests/components/UnifiedSkillsPanel.test.tsx`，缓存刷新测试位于 `tests/hooks/useSkills.test.tsx`。它们共同覆盖：

- 名称、描述和正文分别能够命中；
- “名称”和“内容”范围可以正确切换；
- ID、目录、仓库及所有者等白名单外字段不会被当作搜索内容；
- 没有结果时显示空状态；
- 存储位置迁移后会使正文缓存失效；
- 从其他应用快速切回时，即使缓存仍然新鲜也会重新读取；
- 英文大小写搜索不受系统语言影响。

例如，下面的用例依次验证名称、描述和正文：

```ts
await user.type(search, "alpha");
expect(screen.getByText("Alpha Helper")).toBeInTheDocument();

await user.clear(search);
await user.type(search, "cleanup");
expect(screen.getByText("Beta Helper")).toBeInTheDocument();

await user.clear(search);
await user.type(search, "kubernetes rollout");
expect(screen.getByText("Gamma Helper")).toBeInTheDocument();
```

Rust 端则单独验证受控格式下的正文提取逻辑，例如带有标准 YAML Front Matter 的内容会只返回正文：

```rust
#[test]
fn extract_skill_body_excludes_front_matter() {
    let content =
        "---\nname: Example\ndescription: Test skill\n---\nSearchable body";

    assert_eq!(
        SkillService::extract_skill_body(content),
        "Searchable body"
    );
}
```

Hook 测试还模拟了用户离开 CC Switch、在外部修改文件后立即切回的过程。即使 30 秒新鲜期尚未结束，窗口重新获得焦点也应读取到新正文：

```ts
focusManager.setFocused(false);

await waitFor(() =>
  expect(result.current.data).toEqual({ skill: "old body" }),
);

act(() => {
  focusManager.setFocused(true);
});

await waitFor(() =>
  expect(result.current.data).toEqual({ skill: "new body" }),
);
```

## 小结

这次改动最终呈现为一个搜索框，但它涉及桌面应用中常见的一组工程取舍：

1. 文件系统访问留在 Rust 侧，前端不感知本地路径；
2. 以 Skill ID 关联结构化信息与 Markdown 正文；
3. 用短期缓存、显式失效和窗口聚焦刷新平衡磁盘 I/O 与正文新鲜度；
4. 将搜索范围定义为可测试的字段边界；
5. 对非法目录和单文件读取失败做局部降级，而不是让整个页面失败。

一个小功能是否可靠，往往不取决于搜索表达式本身，而取决于数据从哪里来、何时更新，以及失败时系统如何退化。
