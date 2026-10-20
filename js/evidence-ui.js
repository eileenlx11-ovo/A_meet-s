'use strict';

// No provider or user text is inserted as HTML. Keep fact verification separate
// from literal matching, and never turn a valid-looking URL into a rights claim.
window.AnchorEvidence = (() => {
  const node = (tag, className, text) => AnchorApi.createElement(tag, className, text);
  function safeUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
    catch { return null; }
  }
  function sourceLink(source, label) {
    const url = safeUrl(source?.url);
    if (!url) return node('span', '', '来源链接无效，暂不展示');
    const link = node('a', 'evidence-link', label || source.title || '查看来源');
    link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  }
  function renderPlan(plan) {
    const box = node('section', 'evidence-plan');
    box.append(node('h2', '', '本次检索依据'));
    if (plan.reason) box.append(node('p', 'evidence-warning', plan.reason));
    if (plan.requiredTerms.length) box.append(node('p', '', `已解析条件：${plan.requiredTerms.join('；')}`));
    if (plan.unresolvedTerms.length) box.append(node('p', 'evidence-warning', `未得到可靠解释的文字：${plan.unresolvedTerms.join('；')}`));
    if (plan.excludedTerms.length) box.append(node('p', '', `排除文字：${plan.excludedTerms.join('；')}。只检查当前索引，不证明画面里不存在。`));
    box.append(node('p', 'muted', plan.note)); return box;
  }
  function renderMatch(match) {
    const box = node('details', 'evidence-match');
    const title = match.type === 'exact_metadata' ? '完整书名、电影名或创作者名称命中'
      : match.type === 'all_text_conditions' ? '全部已解析文字条件命中 · 镜头未核验'
      : match.type === 'partial' ? '仅部分相关 · 不代表满足完整请求' : '外部资料 · 未验证场景匹配';
    box.append(node('summary', '', title));
    if (match.matchedTerms.length) box.append(node('p', '', `有文字依据：${match.matchedTerms.join('；')}`));
    if (match.missingTerms.length) box.append(node('p', 'evidence-warning', `缺少文字依据：${match.missingTerms.join('；')}`));
    if (match.unresolvedTerms.length) box.append(node('p', 'evidence-warning', `尚未解释：${match.unresolvedTerms.join('；')}`));
    const list = node('ul', 'evidence-witnesses');
    for (const w of match.witnesses || []) {
      const item = node('li', '');
      item.append(node('p', '', `${w.fieldLabel} / ${w.term} / 原字段位置 ${w.start}–${w.end}`), node('p', '', w.excerpt));
      list.append(item);
    }
    box.append(list); return box;
  }
  function renderSourceSummary(work) {
    const box = node('aside', 'evidence-warning');
    const evidence = work.contentEvidence;
    box.append(node('p', '', work.quote ? evidence?.quote?.label || '站内摘句 · 原文待核验' : '书目或作品描述 · 不是原文引句'));
    box.append(node('p', '', evidence?.relationship?.label || '配对关系待核验'));
    return box;
  }
  function renderSources(work) {
    const box = node('section', 'evidence-sources');
    box.append(node('h2', '', '内容来源与核验范围'), renderSourceSummary(work));
    const evidence = work.contentEvidence;
    if (!evidence) { box.append(node('p', '', '当前后端尚未提供来源信息。')); return box; }
    box.append(node('p', 'muted', evidence.quote.note));
    if (evidence.relationship.note) box.append(node('p', '', evidence.relationship.note));
    for (const s of evidence.relationship.sources || []) box.append(sourceLink(s));
    for (const p of evidence.locatedPassages || []) {
      const section = node('article', 'evidence-passage');
      section.append(node('h3', '', '已定位的参考版本段落（不认证站内中文译句）'),
        sourceLink(p.source), node('p', '', `${p.source.edition}；语言：${p.source.language}；译者：${p.source.translator || '原文，无译者'}`),
        node('p', '', `定位：${p.source.locator}`), node('blockquote', '', p.sourceExcerpt),
        node('p', '', `编辑概述，非出版译文：${p.summaryZh}`), node('p', 'evidence-warning', p.limitations));
      box.append(section);
    }
    if (!(evidence.locatedPassages || []).length) box.append(node('p', '', '尚无已定位的原文段落；页码、版本信息未补齐。'));
    if ((work.videos || []).length) box.append(node('p', 'evidence-warning', '现有视频仅为链接；没有已核验的起止时间、具体媒体版本或同镜头证据。'));
    return box;
  }
  return { safeUrl, renderPlan, renderMatch, renderSourceSummary, renderSources };
})();

document.addEventListener('DOMContentLoaded', async () => {
  const panel = document.getElementById('workEvidence');
  const id = new URLSearchParams(location.search).get('id');
  if (!panel || !/^\d+$/.test(id || '')) return;
  // Independent read-only panel: a sources failure must not break comments or
  // the existing details page. No authentication state or user data is added.
  try {
    const { work } = await AnchorApi.request(`/api/works/${id}`);
    panel.replaceChildren(AnchorEvidence.renderSources(work));
  } catch (error) { panel.textContent = `来源信息暂不可用：${error.message}`; }
});
