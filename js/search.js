let selectedVideo = null;
let searchRequestId = 0;

async function executeSearch() {
  const requestId = ++searchRequestId;
  const searchInput = document.getElementById('searchInput').value.trim();
  const container = document.getElementById('resultsContainer');

  if (!searchInput) {
    container.textContent = '';
    container.append(statusMessage('请在打字机前留下您的意象。', 'var(--accent-red)'));
    return;
  }

  container.textContent = '';
  container.append(statusMessage('[ 正在暗房中显影底片... ]', 'var(--gold)'));

  try {
    const data = await AnchorApi.request(`/api/search?q=${encodeURIComponent(searchInput)}`);
    if (requestId !== searchRequestId) return;
    renderResults(data.results, data.externalStatus, data);
  } catch (error) {
    if (requestId !== searchRequestId) return;
    container.textContent = '';
    container.append(statusMessage(error.message, 'var(--accent-red)'));
  }
}

function renderResults(results = [], externalStatus, data = {}) {
  const container = document.getElementById('resultsContainer');
  container.textContent = '';
  if (data.queryPlan) container.append(AnchorEvidence.renderPlan(data.queryPlan));
  const partial = data.partialResults || [];
  const external = data.externalResults || [];
  if (!results.length) {
    container.append(statusMessage(partial.length
      ? '没有全部文字条件都得到支持的记录。下面仅是部分相关候选。'
      : '当前资料中没有得到支持的匹配；这不表示所有书籍或电影中都不存在。', '#9a9386'));
  }
  for (const [kind, title, items] of [
    ['primary', data.contractVersion === 2 ? '全部已解析文字条件命中（非镜头核验）' : '旧版结果 · 未提供条件解释', results],
    ['partial', '部分相关 · 请查看缺少的条件', partial],
    ['external', '外部书目资料 · 未验证与查询场景相符', external]
  ]) {
    if (!items.length) continue;
    const group = AnchorApi.createElement('section', 'evidence-group');
    group.dataset.resultGroup = kind;
    group.append(AnchorApi.createElement('h2', '', title));
    for (const work of items) group.append(renderResultCard(work));
    container.append(group);
  }
  if (externalStatus) container.append(AnchorApi.createElement('p', 'provider-note', providerStatusText(externalStatus)));
}

function renderResultCard(work) {
  const card = document.createElement('article');
  card.className = 'result-item';
  if (work.match) card.append(AnchorEvidence.renderMatch(work.match));

  const literature = document.createElement('section');
  literature.className = 'literature-section';
  literature.append(
    AnchorApi.createElement('div', 'tag-line', work.kind === 'movie' ? 'Movie / 电影资料' : 'Chapter / 纸页上的字句'),
    AnchorApi.createElement('p', 'literature-text', work.quote || work.description),
    AnchorApi.createElement('div', 'book-title', work.literatureTitle ? `——《${work.literatureTitle}》 ${work.literatureAuthor || ''}` : '—— 外部电影资料')
  );

  const movie = document.createElement('section');
  movie.className = 'movie-match';
  movie.append(
    AnchorApi.createElement('div', 'tag-line', 'Frame / 显影的胶片'),
    AnchorApi.createElement('h4', 'movie-title', work.movieTitle ? `🎬 ${work.movieTitle}${work.movieYear ? ` (${work.movieYear})` : ''}` : '待匹配电影片段'),
    AnchorApi.createElement('p', 'movie-desc', work.movieTitle ? work.description : '这是来自开放书籍资料的结果，可进入详情页继续评论、分享或等待后续电影匹配。')
  );

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (work.videos?.length) {
    const play = document.createElement('button');
    play.className = 'play-btn';
    play.textContent = '打开视频链接（镜头未核验）';
    play.addEventListener('click', () => openVideo(work.videos[0]));
    actions.append(play);
  }

  const detail = document.createElement('a');
  detail.className = 'btn detail-link';
  detail.href = `work.html?id=${work.id}`;
  detail.textContent = '进入批注页';
  actions.append(detail);

  if (AnchorEvidence.safeUrl(work.externalUrl)) {
    const external = document.createElement('a');
    external.className = 'btn detail-link';
    external.href = work.externalUrl;
    external.target = '_blank';
    external.rel = 'noopener noreferrer';
    external.textContent = '查看外部资料（不代表使用授权）';
    actions.append(external);
  }

  movie.append(actions);
  literature.prepend(AnchorEvidence.renderSourceSummary(work));
  card.append(literature, movie);
  return card;
}

function openVideo(video) {
  const modal = document.getElementById('videoModal');
  const box = document.getElementById('videoPlayerBox');
  selectedVideo = video;
  AnchorApi.renderVideoEmbed(box, video, '电影片段');
  modal.style.display = 'flex';
}

function closeVideo() {
  selectedVideo = null;
  document.getElementById('videoModal').style.display = 'none';
  document.getElementById('videoPlayerBox').textContent = '';
}

function statusMessage(text, color) {
  const node = document.createElement('div');
  node.className = 'empty-state';
  node.style.color = color;
  node.textContent = text;
  return node;
}

function providerStatusText(status = {}) {
  if (status.books === 'skipped' && status.movies === 'skipped') return '已从站内资料库返回匹配结果。';
  return `外部图书：${status.books === 'ok' ? '返回资料' : status.books === 'skipped' ? '未调用' : '无可用结果'}；外部电影：${status.movies === 'ok' ? '返回资料' : status.movies === 'skipped' ? '未调用' : '无可用结果'}。外部结果单独展示，不作为场景证据。`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('searchButton')?.addEventListener('click', executeSearch);
  document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') executeSearch();
  });
});
