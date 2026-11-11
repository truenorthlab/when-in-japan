// 웹사이트의 유일한 스크립트. 검색과 「오래된 정보」 표시만 한다. 외부로 아무것도 보내지 않는다.
// 없어도 모든 페이지를 읽을 수 있다. 검색 규칙은 앱의 SearchEngine.swift 와 같다.

const STALE_AFTER_MONTHS = 12;

/** 전각·반각, 대소문자, 가타카나·히라가나, 베트남어 성조를 같게 본다. 탁점과 한글은 지우지 않는다. */
export function normalizeSearchText(text) {
  let result = '';
  for (const character of text.normalize('NFKC').toLowerCase()) {
    const code = character.codePointAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) {
      result += String.fromCodePoint(code - 0x60);
    } else if ((code >= 0x00c0 && code <= 0x024f) || (code >= 0x1e00 && code <= 0x1eff)) {
      result += character.replace('đ', 'd').normalize('NFD').replace(/\p{M}/gu, '');
    } else {
      result += character;
    }
  }
  return result;
}

export function searchTokens(query) {
  return normalizeSearchText(query).split(/\s+/u).filter(Boolean);
}

function weightedFields(item, categories) {
  const category = categories.find((candidate) => candidate.id === item.category);
  return [
    [item.title, 6],
    [item.ja.title, 4],
    [item.keywords.join(' '), 3],
    [category ? category.title : '', 2],
    [item.summary, 2],
    [item.ja.summary, 1],
    [[...item.do, ...item.dont].join(' '), 1],
  ].map(([text, weight]) => [normalizeSearchText(text), weight]);
}

/** 모든 낱말이 어딘가에 있는 항목을 점수 순으로 돌려준다. */
export function searchItems(pack, query) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) {
    return [];
  }
  const scored = [];
  pack.items.forEach((item, order) => {
    const fields = weightedFields(item, pack.categories);
    let score = 0;
    for (const token of tokens) {
      const tokenScore = fields
        .filter(([text]) => text.includes(token))
        .reduce((sum, [, weight]) => sum + weight, 0);
      if (tokenScore === 0) {
        return;
      }
      score += tokenScore;
    }
    scored.push({ item, order, score });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.item);
}

/** 확인일에 12개월을 더한 날이 지났는가. 말일은 그 달의 끝으로 맞춘다(scripts/src/stale.ts 와 같다). */
export function isStale(lastVerified, today) {
  const [year, month, day] = lastVerified.split('-').map(Number);
  const total = month - 1 + STALE_AFTER_MONTHS;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = total % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const limit = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  return today > limit;
}

function revealStaleNotices(today) {
  for (const notice of document.querySelectorAll('[data-verified]')) {
    notice.hidden = !isStale(notice.dataset.verified, today);
  }
}

function resultRow(item, form) {
  const labelText = { manner: form.dataset.manner, local_rule: form.dataset.local, law: form.dataset.law };
  const labelClass = { manner: 'manner', local_rule: 'local', law: 'law' };

  const row = document.createElement('a');
  row.className = 'row';
  row.href = `/${form.dataset.language}/item/${item.id}/`;
  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = item.title;
  const summary = document.createElement('span');
  summary.className = 'row-summary';
  summary.textContent = item.summary;
  const chip = document.createElement('span');
  chip.className = `chip ${labelClass[item.label]}`;
  chip.textContent = labelText[item.label];
  row.append(title, summary, chip);

  const entry = document.createElement('li');
  entry.append(row);
  return entry;
}

function renderResults(container, form, items, query) {
  container.replaceChildren();
  if (query.trim() === '') {
    return;
  }
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    const heading = document.createElement('strong');
    heading.textContent = form.dataset.emptyTitle;
    empty.append(heading, document.createElement('br'), form.dataset.emptyHint);
    container.append(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'rows';
  list.append(...items.map((item) => resultRow(item, form)));
  container.append(list);
}

function setUpSearch() {
  const form = document.querySelector('[data-search]');
  const container = document.querySelector('[data-search-results]');
  if (!form || !container) {
    return;
  }
  form.hidden = false;
  form.addEventListener('submit', (event) => event.preventDefault());

  // 팩은 앱이 받는 것과 같은 파일이다. 검색을 시작할 때 한 번만 받는다.
  // 주소는 이 파일(assets/site.js) 기준이라 사이트 경로 접두사를 몰라도 된다.
  let packRequest;
  const loadPack = () => {
    packRequest ??= fetch(new URL(`../content/v1/${form.dataset.language}.json`, import.meta.url)).then((response) => {
      if (!response.ok) {
        throw new Error(`팩 요청 실패: ${response.status}`);
      }
      return response.json();
    });
    return packRequest;
  };

  const field = form.querySelector('input');
  field.addEventListener('input', async () => {
    const query = field.value;
    try {
      const pack = await loadPack();
      // 응답을 기다리는 사이 입력이 바뀌었으면 옛 결과를 그리지 않는다.
      if (query === field.value) {
        renderResults(container, form, searchItems(pack, query), query);
      }
    } catch {
      packRequest = undefined;
    }
  });
}

if (typeof document !== 'undefined') {
  revealStaleNotices(new Date().toISOString().slice(0, 10));
  setUpSearch();
}
