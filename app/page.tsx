"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  ResultGroup,
  ScriptPreference,
  SearchResponse,
  SearchResultItem,
  SearchSource
} from "@/lib/types";

const sourceOptions: Array<{ label: string; value: SearchSource }> = [
  { label: "bangumi.moe", value: "bangumi-moe" },
  { label: "acg.rip", value: "acg-rip" },
  { label: "動漫花園", value: "dmhy" },
  { label: "nyaa.si", value: "nyaa" }
];

const initialQuery = "机动战士 Gundam";

function formatDate(value?: string): string {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function episodeLabel(item: SearchResultItem): string {
  if (item.episode !== undefined) {
    return item.season ? `S${item.season}E${pad(item.episode)}` : `EP${pad(item.episode)}`;
  }
  if (item.season) return `S${item.season}`;
  return "—";
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export default function HomePage() {
  const [keyword, setKeyword] = useState(initialQuery);
  const [selectedSources, setSelectedSources] = useState<SearchSource[]>(
    sourceOptions.map((option) => option.value)
  );
  const [scriptPref, setScriptPref] = useState<ScriptPreference>("simplified");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRefining, setIsRefining] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  // Monotonic search id so late-arriving refines for stale searches don't
  // overwrite the current result set.
  const searchSeq = useRef(0);

  const allItems = useMemo<SearchResultItem[]>(() => {
    if (!data) return [];
    return [...data.groups.flatMap((g) => g.items), ...data.ungrouped];
  }, [data]);

  async function fetchSearch(
    nextKeyword: string,
    sources: SearchSource[],
    prefer: ScriptPreference,
    refine: boolean
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: nextKeyword,
      limit: "48",
      prefer,
      refine: refine ? "1" : "0"
    });
    if (sources.length) params.set("sources", sources.join(","));
    const response = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message || "搜索失败");
    }
    return (await response.json()) as SearchResponse;
  }

  async function runSearch(
    nextKeyword: string,
    sources: SearchSource[],
    prefer: ScriptPreference
  ) {
    const requestId = ++searchSeq.current;
    // First pass: fast heuristic result so the page renders immediately.
    const fast = await fetchSearch(nextKeyword, sources, prefer, false);
    if (requestId !== searchSeq.current) return; // newer search started
    setData(fast);
    setExpanded(new Set());
    setSelected(new Set());
    setCopyStatus(null);
    setError(null);

    // Second pass: LLM-backed refine runs in the background. Swap in when it
    // arrives as long as the user hasn't kicked off a newer search.
    setIsRefining(true);
    try {
      const refined = await fetchSearch(nextKeyword, sources, prefer, true);
      if (requestId !== searchSeq.current) return;
      setData(refined);
    } catch {
      // Refine failure is silent — fast results stay on screen.
    } finally {
      if (requestId === searchSeq.current) setIsRefining(false);
    }
  }

  useEffect(() => {
    startTransition(() => {
      runSearch(initialQuery, sourceOptions.map((o) => o.value), "simplified").catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "搜索失败");
      });
    });
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => {
      runSearch(keyword, selectedSources, scriptPref).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "搜索失败");
      });
    });
  }

  function toggleSource(source: SearchSource) {
    setSelectedSources((current) =>
      current.includes(source) ? current.filter((s) => s !== source) : [...current, source]
    );
  }

  function toggleGroup(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInGroup(group: ResultGroup, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of group.items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  }

  const selectedItems = useMemo(
    () => allItems.filter((item) => selected.has(item.id)),
    [allItems, selected]
  );

  async function copySelectedMagnets() {
    const magnets = selectedItems.map((i) => i.magnetUrl).filter(Boolean) as string[];
    if (!magnets.length) {
      setCopyStatus("所选项目没有可用磁力链接");
      return;
    }
    try {
      await navigator.clipboard.writeText(magnets.join("\n"));
      setCopyStatus(`已复制 ${magnets.length} 条磁力链接`);
    } catch {
      setCopyStatus("复制失败，请检查浏览器权限");
    }
  }

  function openSelectedMagnets() {
    const magnets = selectedItems.map((i) => i.magnetUrl).filter(Boolean) as string[];
    if (!magnets.length) {
      setCopyStatus("所选项目没有可用磁力链接");
      return;
    }
    // Browsers typically prompt once then hand magnets off to the registered
    // torrent client. Fire sequentially with a small gap so the browser doesn't
    // coalesce them into a single action.
    magnets.forEach((m, idx) => {
      setTimeout(() => {
        window.location.href = m;
      }, idx * 400);
    });
    setCopyStatus(`已触发 ${magnets.length} 个磁力链接`);
  }

  const totalGroups = data?.groups.length ?? 0;
  const totalUngrouped = data?.ungrouped.length ?? 0;

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Bangumi Torrent Finder</p>
          <h1>新番磁力与种子聚合检索</h1>
          <p className="hero-description">
            聚合 bangumi.moe、acg.rip、動漫花園、nyaa.si 搜索结果，自动去重并按番剧分组，支持批量下载。
          </p>
        </div>

        <form className="search-panel" onSubmit={onSubmit}>
          <label className="search-label" htmlFor="keyword">
            搜索关键词
          </label>
          <div className="search-row">
            <input
              id="keyword"
              name="keyword"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="例如：紫云寺家的孩子们 / Gundam / [桜都字幕组]"
            />
            <button type="submit" disabled={isPending || !keyword.trim()}>
              {isPending ? "搜索中..." : "开始搜索"}
            </button>
          </div>

          <div className="sources" role="radiogroup" aria-label="字体偏好">
            {(["simplified", "traditional"] as const).map((value) => {
              const active = scriptPref === value;
              return (
                <label key={value} className={active ? "chip active" : "chip"}>
                  <input
                    type="radio"
                    name="scriptPref"
                    checked={active}
                    onChange={() => setScriptPref(value)}
                  />
                  <span>{value === "simplified" ? "优先简体" : "優先繁體"}</span>
                </label>
              );
            })}
          </div>

          <div className="sources">
            {sourceOptions.map((option) => {
              const checked = selectedSources.includes(option.value);
              return (
                <label key={option.value} className={checked ? "chip active" : "chip"}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSource(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </form>
      </section>

      <section className="results-header">
        <div>
          <h2>搜索结果</h2>
          <p>
            {data
              ? `去重后共 ${data.total} 条 · ${totalGroups} 个番剧组 · ${totalUngrouped} 条独立`
              : "等待查询"}
            {isRefining ? " · 智能合并中..." : ""}
            {error ? ` · ${error}` : ""}
          </p>
        </div>
        {data?.warnings?.length ? (
          <div className="warning-box">
            {data.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}
      </section>

      <div className="batch-bar" role="toolbar" aria-label="批量操作">
        <span>已选 {selected.size} 条</span>
        <button type="button" onClick={copySelectedMagnets} disabled={selected.size === 0}>
          复制磁力
        </button>
        <button type="button" onClick={openSelectedMagnets} disabled={selected.size === 0}>
          打开磁力
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          disabled={selected.size === 0}
        >
          清空选择
        </button>
        {copyStatus ? <span className="batch-status">{copyStatus}</span> : null}
      </div>

      {data?.groups.length ? (
        <section className="result-groups">
          {data.groups.map((group) => {
            const isExpanded = expanded.has(group.key);
            const allSelected = group.items.every((it) => selected.has(it.id));
            const someSelected = !allSelected && group.items.some((it) => selected.has(it.id));
            return (
              <article key={group.key} className="group">
                <header className="group-head">
                  <button
                    type="button"
                    className="group-toggle"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={isExpanded}
                  >
                    <span className="chevron">{isExpanded ? "▾" : "▸"}</span>
                    <span className="group-title">
                      {group.series}
                      {group.season ? ` · S${group.season}` : ""}
                    </span>
                    <span className="group-count">{group.items.length}</span>
                  </button>
                  <label className="group-select">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => selectAllInGroup(group, e.target.checked)}
                    />
                    全选该组
                  </label>
                </header>
                {isExpanded ? (
                  <ItemList items={group.items} selected={selected} onToggleSelect={toggleSelect} />
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}

      {data?.ungrouped.length ? (
        <section className="result-groups">
          <article className="group">
            <header className="group-head">
              <div className="group-toggle static">
                <span className="group-title">未分组 / Ungrouped</span>
                <span className="group-count">{data.ungrouped.length}</span>
              </div>
            </header>
            <ItemList items={data.ungrouped} selected={selected} onToggleSelect={toggleSelect} />
          </article>
        </section>
      ) : null}

      {!data?.groups.length && !data?.ungrouped.length ? (
        <div className="empty-state">
          <p>{isPending ? "正在拉取数据..." : "还没有结果，先搜一部新番试试。"}</p>
        </div>
      ) : null}
    </main>
  );
}

interface ItemListProps {
  items: SearchResultItem[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}

function ItemList({ items, selected, onToggleSelect }: ItemListProps) {
  return (
    <ul className="item-list">
      {items.map((item) => (
        <li key={item.id} className={selected.has(item.id) ? "row selected" : "row"}>
          <label className="row-select">
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => onToggleSelect(item.id)}
            />
          </label>
          <div className="row-main">
            <div className="row-title">{item.title}</div>
            <div className="row-meta">
              <span className="episode-badge">{episodeLabel(item)}</span>
              {item.resolution ? <span className="meta-pill">{item.resolution}</span> : null}
              {item.group ? <span className="meta-pill">{item.group}</span> : null}
              <span className="meta-pill">{formatDate(item.publishedAt)}</span>
              <span className="meta-pill">{item.size || "未知大小"}</span>
              {item.seeders !== undefined ? (
                <span className="meta-pill seeders">做种 {item.seeders}</span>
              ) : null}
              {(item.sources ?? [item.source]).map((s) => (
                <span key={s} className={`source-badge source-${s}`}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="row-actions">
            {item.magnetUrl ? (
              <a href={item.magnetUrl} target="_blank" rel="noreferrer">
                磁力
              </a>
            ) : null}
            {item.torrentUrl ? (
              <a href={item.torrentUrl} target="_blank" rel="noreferrer">
                种子
              </a>
            ) : null}
            {item.detailUrl ? (
              <a href={item.detailUrl} target="_blank" rel="noreferrer">
                详情
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
