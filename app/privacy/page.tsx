import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隐私政策 · Bangumi Torrent Finder",
  description: "Bangumi Torrent Finder 的数据收集、使用与共享说明"
};

export default function PrivacyPage() {
  return (
    <main className="page-shell">
      <section className="hero-card" style={{ gridTemplateColumns: "1fr" }}>
        <div className="hero-copy">
          <p className="eyebrow">Privacy Policy</p>
          <h1>隐私政策</h1>
          <p className="hero-description">
            最后更新：2026-04-17。本站（bangumi.maxlv.net）是一个聚合新番磁力与种子检索结果的工具站。本政策说明我们在提供服务时会处理哪些数据，以及这些数据如何被使用。
          </p>
        </div>
      </section>

      <section className="hero-card" style={{ gridTemplateColumns: "1fr" }}>
        <div className="hero-copy" style={{ display: "grid", gap: 24 }}>
          <div>
            <h2>我们收集的数据</h2>
            <ul>
              <li>
                <strong>搜索关键词：</strong>
                你在搜索框中输入的内容会发送到本站服务端，再由服务端转发到下游搜索源。
              </li>
              <li>
                <strong>请求元数据：</strong>
                服务端会产生常规访问日志，包括 IP 地址、User-Agent、请求时间和请求路径，用于排障与滥用检测。日志通常在 14 天后轮转删除。
              </li>
              <li>
                <strong>本站不使用 Cookie、本地存储或第三方分析脚本</strong>
                来追踪用户。本站也没有账号系统，不收集姓名、邮箱、手机号等身份信息。
              </li>
            </ul>
          </div>

          <div>
            <h2>数据的使用与共享</h2>
            <ul>
              <li>
                <strong>下游检索源：</strong>
                为了聚合结果，搜索关键词会被转发到你所选择的上游站点（bangumi.moe、acg.rip、動漫花園、nyaa.si 等）。这些站点各有自己的隐私政策，本站无法控制。
              </li>
              <li>
                <strong>智能合并（可选）：</strong>
                当「智能合并」生效时，搜索关键词与候选结果的标题会被发送到第三方大语言模型接口（管理员可自行配置具体的服务提供商），用于跨语言去重与分组。返回的结果仅用于当次响应，不用于模型训练。
              </li>
              <li>
                <strong>缓存：</strong>
                为降低上游负载，服务端会将查询结果缓存在本地 SQLite 文件中，默认 15 分钟后过期。缓存以归一化后的查询为 key，不包含 IP 或其他识别信息。
              </li>
              <li>
                <strong>批量下载种子：</strong>
                当你选择「下载种子」时，服务端会代为抓取 .torrent 文件并打包返回。抓取目标是你在结果中选中的链接；服务端不会保留种子文件。
              </li>
              <li>
                我们<strong>不会出售</strong>任何数据，也不会将日志用于广告定向。
              </li>
            </ul>
          </div>

          <div>
            <h2>用户权利</h2>
            <p>
              由于本站不建立账号、不持久化个人信息，一般不存在与特定自然人相关联的数据。如你希望清除最近的访问日志记录，可通过下方联系邮箱提出申请，并附上对应的时间段。
            </p>
          </div>

          <div>
            <h2>未成年人</h2>
            <p>
              本站面向普通公众开放，不刻意针对 13 岁以下的未成年人。若你是未成年人，请在监护人指导下使用。
            </p>
          </div>

          <div>
            <h2>政策变更</h2>
            <p>
              本政策可能随服务更新而调整，更新时会同步修改本页面顶部的「最后更新」日期。继续使用本站即视为接受更新后的政策。
            </p>
          </div>

          <div>
            <h2>联系方式</h2>
            <p>
              如对本政策有任何疑问，可邮件联系：
              <a href="mailto:max.c.lv@gmail.com">max.c.lv@gmail.com</a>
              。
            </p>
          </div>

          <div>
            <Link href="/">← 返回首页</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
