"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import type { SearchResponse, SearchSource } from "@/lib/types";

const sourceOptions: Array<{ label: string; value: SearchSource }> = [
  { label: "bangumi.moe", value: "bangumi-moe" },
  { label: "DHT 索引", value: "dht" }
];

const initialQuery = "机动战士 Gundam";

function formatDate(value?: string): string {
  if (!value) {
    return "未知时间";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function HomePage() {
  const [keyword, setKeyword] = useState(initialQuery);
  const [selectedSources, setSelectedSources] = useState<SearchSource[]>(
    sourceOptions.map((option) => option.value)
  );
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runSearch(nextKeyword: string, sources: SearchSource[]) {
    const params = new URLSearchParams({
      q: nextKeyword,
      limit: "24"
    });

    if (sources.length) {
      params.set("sources", sources.join(","));
    }

    const response = await fetch(`/api/search?${params.toString()}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message || "搜索失败");
    }

    const payload = (await response.json()) as SearchResponse;
    setData(payload);
    setError(null);
  }

  useEffect(() => {
    const initialSources = sourceOptions.map((option) => option.value);

    startTransition(() => {
      runSearch(initialQuery, initialSources).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "搜索失败");
      });
    });
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => {
      runSearch(keyword, selectedSources).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "搜索失败");
      });
    });
  }

  function toggleSource(source: SearchSource) {
    setSelectedSources((current) =>
      current.includes(source)
        ? current.filter((item) => item !== source)
        : [...current, source]
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Bangumi Torrent Finder</p>
          <h1>新番磁力与种子聚合检索</h1>
          <p className="hero-description">
            聚合 bangumi.moe 与 DHT 索引结果，统一搜索、预览标签，并快速跳转磁力链接或种子文件。
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
            {data ? `共 ${data.total} 条结果` : "等待查询"} {error ? `· ${error}` : ""}
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

      <section className="results-grid">
        {data?.items?.length ? (
          data.items.map((item) => (
            <article key={`${item.source}-${item.id}`} className="result-card">
              <div className="result-meta">
                <span className={`source-badge source-${item.source}`}>{item.source}</span>
                <span>{formatDate(item.publishedAt)}</span>
              </div>

              <h3>{item.title}</h3>
              {item.subtitle ? <p className="subtitle">{item.subtitle}</p> : null}

              <dl className="stats">
                <div>
                  <dt>大小</dt>
                  <dd>{item.size || "未知"}</dd>
                </div>
                <div>
                  <dt>做种</dt>
                  <dd>{item.seeders ?? "-"}</dd>
                </div>
                <div>
                  <dt>下载</dt>
                  <dd>{item.leechers ?? "-"}</dd>
                </div>
              </dl>

              {item.tags.length ? (
                <div className="tags">
                  {item.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}

              <div className="actions">
                {item.magnetUrl ? (
                  <a href={item.magnetUrl} target="_blank" rel="noreferrer">
                    磁力链接
                  </a>
                ) : null}
                {item.torrentUrl ? (
                  <a href={item.torrentUrl} target="_blank" rel="noreferrer">
                    种子文件
                  </a>
                ) : null}
                {item.detailUrl ? (
                  <a href={item.detailUrl} target="_blank" rel="noreferrer">
                    详情页
                  </a>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <p>{isPending ? "正在拉取数据..." : "还没有结果，先搜一部新番试试。"}</p>
          </div>
        )}
      </section>
    </main>
  );
}
