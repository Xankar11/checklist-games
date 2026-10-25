'use strict';

(() => {
  const GAMES = Array.isArray(window.GAMES) ? window.GAMES : [];
  const META = window.DATA_META || {};
  const TOTAL = GAMES.length;
  const STORAGE_KEY = 'mc250-progress-v1';
  const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTHS_LONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const FAMILIES = {
    action: 'Экшен',
    rpg: 'RPG',
    adventure: 'Приключения',
    platformer: 'Платформеры',
    strategy: 'Стратегии',
    racing: 'Гонки',
    sports: 'Спорт',
    fighting: 'Файтинги',
    sim: 'Симуляторы',
    survival: 'Выживание',
    rhythm: 'Ритм',
    party: 'Вечеринки',
    sandbox: 'Песочница',
    other: 'Другое'
  };

  // Order matters: more specific matches come first.
  const GENRE_RULES = [
    ['fighting', ['fighting']],
    ['racing', ['racing']],
    ['sports', ['football', 'soccer', 'tennis', 'baseball', 'basketball', 'hockey', 'skiing', 'skating']],
    ['rhythm', ['rhythm', 'music']],
    ['party', ['party', 'card']],
    ['survival', ['survival']],
    ['sandbox', ['sandbox']],
    ['strategy', ['strategy', 'rts', 'tactics', 'management', '4x']],
    ['rpg', ['rpg']],
    ['platformer', ['platformer']],
    ['action', ['fps', 'action', 'shooter', 'beat', 'arcade', 'metroidvania', 'shoot']],
    ['adventure', ['adventure', 'point-and-click', 'visual novel']],
    ['sim', ['sim', 'virtual life']]
  ];

  const PLATFORM_GROUPS = [
    { label: 'PC', items: ['PC'] },
    { label: 'PlayStation', items: ['PlayStation 5', 'PlayStation 4', 'PlayStation 3', 'PlayStation 2', 'PlayStation', 'PlayStation Vita', 'PSP'] },
    { label: 'Xbox', items: ['Xbox Series X', 'Xbox One', 'Xbox 360', 'Xbox'] },
    { label: 'Nintendo', items: ['Nintendo Switch 2', 'Nintendo Switch', 'Wii U', 'Wii', 'GameCube', 'Nintendo 64', 'Game Boy Advance', 'DS', '3DS'] },
    { label: 'Sega', items: ['Dreamcast'] }
  ];

  const PLATFORM_LABELS = {
    'PlayStation': 'PlayStation (PS1)',
    'PSP': 'PlayStation Portable',
    'DS': 'Nintendo DS',
    '3DS': 'Nintendo 3DS'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = {
    search: '',
    genre: 'all',
    platform: 'all',
    decade: 'all',
    status: 'all',
    sort: 'rank'
  };

  let progress = {};
  let savedAt = null;
  let storageOk = true;
  let activeSlug = null;
  let suspendedEntry = null;
  let saveTimer = null;
  let toastTimer = null;
  let lastRandomSlug = null;
  const cardRefs = new Map();

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function normalize(value) {
    return String(value)
      .toLocaleLowerCase('ru')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ё/g, 'е')
      .trim();
  }

  function plural(number, one, few, many) {
    const n10 = number % 10;
    const n100 = number % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  function todayISO() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function formatShortDate(value) {
    if (!isValidDate(value)) return '';
    const [year, month, day] = value.split('-').map(Number);
    return `${day} ${MONTHS_SHORT[month - 1]} ${year}`;
  }

  function formatLongDate(value) {
    if (!isValidDate(value)) return '';
    const [year, month, day] = value.split('-').map(Number);
    return `${day} ${MONTHS_LONG[month - 1]} ${year}`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch (error) {
      return '—';
    }
  }

  function scoreClass(score) {
    if (score >= 96) return 'is-top';
    if (score >= 93) return 'is-high';
    return 'is-good';
  }

  function getFamilies(genres) {
    const found = new Set();
    for (const genre of genres || []) {
      const key = String(genre).toLowerCase();
      for (const [family, words] of GENRE_RULES) {
        if (words.some((word) => key.includes(word))) {
          found.add(family);
          break;
        }
      }
    }
    if (!found.size) found.add('other');
    return Array.from(found);
  }

  for (const game of GAMES) {
    game.families = getFamilies(game.genres);
    game.searchText = normalize(game.title);
  }

  const gameBySlug = new Map(GAMES.map((game) => [game.slug, game]));
  const slugSet = new Set(GAMES.map((game) => game.slug));

  const els = {
    topDone: $('#topDone'),
    topPercent: $('#topPercent'),
    topProgress: $('#topProgress'),
    topBar: $('#topBar'),
    ringValue: $('#ringValue'),
    heroPercent: $('#heroPercent'),
    heroCount: $('#heroCount'),
    heroRemaining: $('#heroRemaining'),
    statDone: $('#statDone'),
    statAvg: $('#statAvg'),
    statAvgUnit: $('#statAvgUnit'),
    statYear: $('#statYear'),
    statLeft: $('#statLeft'),
    storageHint: $('#storageHint'),
    resultsCount: $('#resultsCount'),
    gameGrid: $('#gameGrid'),
    emptyState: $('#emptyState'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    searchKbd: $('#searchKbd'),
    genreFilter: $('#genreFilter'),
    platformFilter: $('#platformFilter'),
    decadeFilter: $('#decadeFilter'),
    sortSelect: $('#sortSelect'),
    resetFilters: $('#resetFilters'),
    resetEmpty: $('#resetEmpty'),
    countAll: $('#countAll'),
    countDone: $('#countDone'),
    countNot: $('#countNot'),
    dataUpdated: $('#dataUpdated'),
    footerCount: $('#footerCount'),
    gameDialog: $('#gameDialog'),
    gameCover: $('#gameCover'),
    gameRank: $('#gameRank'),
    gameScore: $('#gameScore'),
    gameEyebrow: $('#gameEyebrow'),
    gameTitle: $('#gameTitle'),
    gameMeta: $('#gameMeta'),
    gameDesc: $('#gameDesc'),
    gameGenres: $('#gameGenres'),
    doneToggle: $('#doneToggle'),
    doneHint: $('#doneHint'),
    detailsFields: $('#detailsFields'),
    doneDate: $('#doneDate'),
    ratingGroup: $('#ratingGroup'),
    ratingClear: $('#ratingClear'),
    saveState: $('#saveState'),
    dataDialog: $('#dataDialog'),
    dataDone: $('#dataDone'),
    dataRated: $('#dataRated'),
    dataSaved: $('#dataSaved'),
    dataMessage: $('#dataMessage'),
    dataStorageNote: $('#dataStorageNote'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    resetBtn: $('#resetBtn'),
    confirmDialog: $('#confirmDialog'),
    confirmTitle: $('#confirmTitle'),
    confirmText: $('#confirmText'),
    confirmOk: $('#confirmOk'),
    toast: $('#toast'),
    toastText: $('#toastText'),
    toastAction: $('#toastAction')
  };

  if (!GAMES.length) {
    els.gameGrid.innerHTML = '<p class="empty">Не удалось загрузить список игр. Проверьте файл data/games.js.</p>';
    return;
  }

  if (META.fetchedAt) {
    els.dataUpdated.textContent = formatShortDate(String(META.fetchedAt).slice(0, 10));
  }

  /* ---------- Filters & cards ---------- */
  function buildGenreOptions() {
    const counts = new Map();
    for (const game of GAMES) {
      for (const family of game.families) {
        counts.set(family, (counts.get(family) || 0) + 1);
      }
    }
    const entries = Object.entries(FAMILIES)
      .filter(([id]) => counts.get(id))
      .sort((a, b) => counts.get(b[0]) - counts.get(a[0]) || a[1].localeCompare(b[1], 'ru'));
    const fragment = document.createDocumentFragment();
    for (const [id, label] of entries) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${label} (${counts.get(id)})`;
      fragment.append(option);
    }
    els.genreFilter.append(fragment);
  }

  function buildPlatformOptions() {
    const allPlatforms = new Set(GAMES.flatMap((game) => game.platforms));
    const grouped = new Set();
    const fragment = document.createDocumentFragment();

    for (const group of PLATFORM_GROUPS) {
      const items = group.items.filter((platform) => allPlatforms.has(platform));
      if (!items.length) continue;
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.label;
      for (const platform of items) {
        const count = GAMES.filter((game) => game.platforms.includes(platform)).length;
        const option = document.createElement('option');
        option.value = platform;
        option.textContent = `${PLATFORM_LABELS[platform] || platform} (${count})`;
        optgroup.append(option);
        grouped.add(platform);
      }
      fragment.append(optgroup);
    }

    const rest = Array.from(allPlatforms).filter((platform) => !grouped.has(platform)).sort();
    if (rest.length) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Другие';
      for (const platform of rest) {
        const count = GAMES.filter((game) => game.platforms.includes(platform)).length;
        const option = document.createElement('option');
        option.value = platform;
        option.textContent = `${platform} (${count})`;
        optgroup.append(option);
      }
      fragment.append(optgroup);
    }
    els.platformFilter.append(fragment);
  }

  function buildDecadeOptions() {
    const counts = new Map();
    for (const game of GAMES) {
      const decade = Math.floor(game.year / 10) * 10;
      counts.set(decade, (counts.get(decade) || 0) + 1);
    }
    const fragment = document.createDocumentFragment();
    for (const decade of Array.from(counts.keys()).sort((a, b) => a - b)) {
      const option = document.createElement('option');
      option.value = String(decade);
      option.textContent = `${decade}-е (${counts.get(decade)})`;
      fragment.append(option);
    }
    els.decadeFilter.append(fragment);
  }

  function buildCards() {
    const fragment = document.createDocumentFragment();
    for (const game of GAMES) {
      const card = node('article', 'card');
      card.dataset.slug = game.slug;

      const open = node('button', 'card__open');
      open.type = 'button';

      const cover = node('span', 'card__cover');
      cover.dataset.fallback = game.title.slice(0, 2).toUpperCase();

      const img = document.createElement('img');
      img.src = game.cover;
      img.alt = `Обложка ${game.title}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 340;
      img.height = 465;
      img.addEventListener('error', () => {
        cover.classList.add('is-missing');
        img.remove();
      });

      const rank = node('span', 'rank-badge', `№ ${game.rank}`);
      rank.setAttribute('aria-hidden', 'true');
      const score = node('span', `score-badge ${scoreClass(game.score)}`, String(game.score));
      score.title = `Metascore ${game.score}`;
      score.setAttribute('aria-hidden', 'true');
      cover.append(img, rank, score);

      const info = node('span', 'card__info');
      const title = node('h3', 'card__title', game.title);
      const genres = game.families.slice(0, 2).map((family) => FAMILIES[family]).join(' / ');
      const meta = node('span', 'card__meta', `${game.year} · ${genres}`);
      info.append(title, meta);
      open.append(cover, info);

      const footer = node('div', 'card__footer');
      const status = node('span', 'card__status', 'Не пройдено');
      const rating = node('span', 'card__rating');
      rating.hidden = true;
      const check = node('button', 'card__check');
      check.type = 'button';
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      footer.append(status, rating, check);

      card.append(open, footer);
      fragment.append(card);
      cardRefs.set(game.slug, { card, open, cover, img, status, rating, check });
    }
    els.gameGrid.append(fragment);
  }

  function updateCardState(game) {
    const refs = cardRefs.get(game.slug);
    if (!refs) return;
    const entry = progress[game.slug];
    const done = Boolean(entry);
    const date = entry && entry.date ? formatShortDate(entry.date) : '';
    const longDate = entry && entry.date ? formatLongDate(entry.date) : '';
    const suffix = done ? `, пройдено${longDate ? ` ${longDate}` : ''}` : ', не пройдено';

    refs.card.classList.toggle('is-done', done);
    refs.status.textContent = done ? `✓ Пройдено${date ? ` · ${date}` : ''}` : 'Не пройдено';
    refs.status.title = longDate;
    refs.rating.hidden = !(entry && entry.rating);
    refs.rating.textContent = entry && entry.rating ? `${entry.rating}/10` : '';
    refs.rating.title = entry && entry.rating ? `Моя оценка: ${entry.rating} из 10` : '';
    refs.check.setAttribute('aria-pressed', String(done));
    refs.check.setAttribute('aria-label', done
      ? `Снять отметку с «${game.title}»`
      : `Отметить «${game.title}» как пройденную`);
    refs.check.title = done ? 'Снять отметку' : 'Отметить как пройденную';
    refs.open.setAttribute('aria-label', `${game.title}, ${game.year}, Metascore ${game.score}${suffix}. Открыть подробности`);
  }

  function buildRatingButtons() {
    const fragment = document.createDocumentFragment();
    for (let value = 1; value <= 10; value += 1) {
      const button = node('button', 'rating__btn', String(value));
      button.type = 'button';
      button.dataset.value = String(value);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.setAttribute('aria-label', `${value} из 10`);
      button.tabIndex = value === 1 ? 0 : -1;
      fragment.append(button);
    }
    els.ratingGroup.append(fragment);
  }

  function updateRatingButtons(rating) {
    for (const button of $$('.rating__btn', els.ratingGroup)) {
      const value = Number(button.dataset.value);
      const checked = rating === value;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked || (rating === null && value === 1) ? 0 : -1;
    }
    els.ratingClear.hidden = !rating;
  }

  function updateStats() {
    const entries = Object.values(progress).filter((entry) => entry && entry.done);
    const done = entries.length;
    const rated = entries.filter((entry) => entry.rating);
    const average = rated.length
      ? rated.reduce((sum, entry) => sum + entry.rating, 0) / rated.length
      : null;
    const currentYear = new Date().getFullYear();
    const thisYear = entries.filter((entry) => (
      isValidDate(entry.date) && Number(entry.date.slice(0, 4)) === currentYear
    )).length;
    const percentExact = TOTAL ? (done / TOTAL) * 100 : 0;
    const percent = done === TOTAL ? 100 : Number(percentExact.toFixed(1));
    const percentLabel = `${String(percent).replace('.', ',')}%`;
    const left = TOTAL - done;

    els.topDone.textContent = String(done);
    els.topPercent.textContent = percentLabel;
    els.topProgress.setAttribute('aria-valuemax', String(TOTAL));
    els.topProgress.setAttribute('aria-valuenow', String(done));
    els.topBar.style.width = `${percentExact}%`;
    els.ringValue.style.strokeDashoffset = String(100 - percentExact);
    els.heroPercent.textContent = percentLabel;
    els.heroCount.textContent = `${done} из ${TOTAL}`;
    els.heroRemaining.textContent = left === 0
      ? 'Все игры пройдены'
      : `${left} ${plural(left, 'игра', 'игры', 'игр')} впереди`;
    els.statDone.textContent = String(done);
    els.statAvg.textContent = average === null ? '—' : average.toFixed(1).replace('.', ',');
    els.statAvgUnit.textContent = average === null ? '' : ' / 10';
    els.statYear.textContent = String(thisYear);
    els.statLeft.textContent = String(left);
    els.countAll.textContent = String(TOTAL);
    els.countDone.textContent = String(done);
    els.countNot.textContent = String(left);
    els.footerCount.textContent = `${done} из ${TOTAL}`;
  }

  function compareGames(a, b) {
    switch (state.sort) {
      case 'score':
        return b.score - a.score || a.rank - b.rank;
      case 'year-new':
        return b.year - a.year || a.rank - b.rank;
      case 'year-old':
        return a.year - b.year || a.rank - b.rank;
      case 'title':
        return a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) || a.rank - b.rank;
      case 'my-rating': {
        const ratingA = progress[a.slug] && progress[a.slug].rating ? progress[a.slug].rating : 0;
        const ratingB = progress[b.slug] && progress[b.slug].rating ? progress[b.slug].rating : 0;
        if (ratingA !== ratingB) return ratingB - ratingA;
        const doneA = progress[a.slug] ? 1 : 0;
        const doneB = progress[b.slug] ? 1 : 0;
        return doneB - doneA || a.rank - b.rank;
      }
      case 'completed': {
        const dateA = progress[a.slug] && progress[a.slug].date ? progress[a.slug].date : '';
        const dateB = progress[b.slug] && progress[b.slug].date ? progress[b.slug].date : '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        const doneA = progress[a.slug] ? 1 : 0;
        const doneB = progress[b.slug] ? 1 : 0;
        return doneB - doneA || a.rank - b.rank;
      }
      default:
        return a.rank - b.rank;
    }
  }

  function isFilterActive() {
    return Boolean(state.search.trim())
      || state.genre !== 'all'
      || state.platform !== 'all'
      || state.decade !== 'all'
      || state.status !== 'all'
      || state.sort !== 'rank';
  }

  function applyFilters() {
    const query = normalize(state.search);
    const visible = GAMES.filter((game) => {
      if (query && !game.searchText.includes(query)) return false;
      if (state.genre !== 'all' && !game.families.includes(state.genre)) return false;
      if (state.platform !== 'all' && !game.platforms.includes(state.platform)) return false;
      if (state.decade !== 'all' && Math.floor(game.year / 10) * 10 !== Number(state.decade)) return false;
      if (state.status === 'done' && !progress[game.slug]) return false;
      if (state.status === 'not' && progress[game.slug]) return false;
      return true;
    }).sort(compareGames);

    const visibleSet = new Set(visible.map((game) => game.slug));
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const currentOrder = Array.from(els.gameGrid.children).filter((card) => !card.hidden);
    const orderChanged = visible.length !== currentOrder.length
      || visible.some((game, index) => cardRefs.get(game.slug)?.card !== currentOrder[index]);

    if (orderChanged) {
      const fragment = document.createDocumentFragment();
      for (const game of visible) {
        const refs = cardRefs.get(game.slug);
        if (refs) fragment.append(refs.card);
      }
      els.gameGrid.append(fragment);
    }
    for (const game of GAMES) {
      const refs = cardRefs.get(game.slug);
      if (refs) refs.card.hidden = !visibleSet.has(game.slug);
    }

    // Перестройка сетки на мгновение убирает карточки из DOM, и браузер
    // сбрасывает прокрутку. Возвращаем её сразу, без плавной анимации.
    if (orderChanged && (window.scrollX !== scrollX || window.scrollY !== scrollY)) {
      const root = document.documentElement;
      const previousBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(scrollX, scrollY);
      root.style.scrollBehavior = previousBehavior;
    }

    els.emptyState.hidden = visible.length !== 0;
    els.gameGrid.hidden = visible.length === 0;
    els.resetFilters.hidden = !isFilterActive();
    els.resultsCount.textContent = visible.length === TOTAL
      ? `${TOTAL} ${plural(TOTAL, 'игра', 'игры', 'игр')}`
      : `Показано ${visible.length} из ${TOTAL}`;

    for (const button of $$('.segmented button')) {
      button.setAttribute('aria-pressed', String(button.dataset.status === state.status));
    }
  }

  function syncSearchUI() {
    const hasQuery = els.searchInput.value.trim().length > 0;
    els.searchClear.hidden = !hasQuery;
    els.searchKbd.hidden = hasQuery;
  }

  function setStatus(status) {
    state.status = status;
    applyFilters();
  }

  function resetFilters() {
    state.search = '';
    state.genre = 'all';
    state.platform = 'all';
    state.decade = 'all';
    state.status = 'all';
    state.sort = 'rank';
    els.searchInput.value = '';
    els.genreFilter.value = 'all';
    els.platformFilter.value = 'all';
    els.decadeFilter.value = 'all';
    els.sortSelect.value = 'rank';
    syncSearchUI();
    applyFilters();
  }

  function syncAll() {
    for (const game of GAMES) updateCardState(game);
    updateStats();
    applyFilters();
    updateDataDialog();
    updateStorageUI();
  }

  /* ---------- Storage ---------- */
  function canUseStorage() {
    try {
      const key = '__mc250_test__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function isoToLocalDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function readStorage() {
    const result = { progress: {}, savedAt: null };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return result;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

      const source = parsed.games && typeof parsed.games === 'object' && !Array.isArray(parsed.games)
        ? parsed.games
        : parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
          ? parsed.progress
          : parsed;

      for (const [slug, value] of Object.entries(source)) {
        if (!slugSet.has(slug) || !value) continue;
        if (value === true) {
          result.progress[slug] = { done: true, date: '', rating: null };
          continue;
        }
        if (typeof value !== 'object' || Array.isArray(value) || value.done === false) continue;
        const date = isValidDate(value.date) ? value.date : '';
        const ratingValue = Number(value.rating);
        const rating = Number.isInteger(ratingValue) && ratingValue >= 1 && ratingValue <= 10 ? ratingValue : null;
        result.progress[slug] = { done: true, date, rating };
      }

      if (typeof parsed.savedAt === 'string') result.savedAt = parsed.savedAt;
    } catch (error) {
      // A broken JSON should not make the whole checklist unusable.
      console.warn('Не удалось прочитать сохранённый прогресс:', error);
    }
    return result;
  }

  function persist() {
    const stamp = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: stamp,
        games: progress
      }));
      storageOk = true;
      savedAt = stamp;
      return true;
    } catch (error) {
      storageOk = false;
      updateStorageUI();
      return false;
    }
  }

  function updateStorageUI() {
    if (storageOk) {
      els.storageHint.textContent = 'Отметки сохраняются в этом браузере.';
      els.storageHint.classList.remove('is-error');
      els.dataStorageNote.textContent = 'Данные не отправляются в интернет. При очистке данных браузера они удалятся.';
    } else {
      els.storageHint.textContent = 'Хранилище браузера недоступно — изменения не сохранятся.';
      els.storageHint.classList.add('is-error');
      els.dataStorageNote.textContent = 'Браузер блокирует локальное хранилище. Скачайте JSON, чтобы не потерять прогресс.';
    }
  }

  function updateDataDialog() {
    const entries = Object.values(progress);
    els.dataDone.textContent = String(entries.length);
    els.dataRated.textContent = String(entries.filter((entry) => entry && entry.rating).length);
    const savedDate = savedAt ? isoToLocalDate(savedAt) : '';
    els.dataSaved.textContent = savedDate ? formatShortDate(savedDate) : '—';
    els.dataSaved.title = savedAt ? formatDateTime(savedAt) : '';
  }

  function resetSaveState() {
    if (saveTimer) window.clearTimeout(saveTimer);
    els.saveState.classList.remove('is-saved', 'is-error');
    els.saveState.textContent = storageOk
      ? 'Изменения сохраняются автоматически'
      : 'Хранилище недоступно — изменения не сохранятся';
  }

  function markSaved() {
    if (saveTimer) window.clearTimeout(saveTimer);
    if (!storageOk) {
      els.saveState.classList.remove('is-saved');
      els.saveState.classList.add('is-error');
      els.saveState.textContent = 'Не сохранено — хранилище недоступно';
      return;
    }
    els.saveState.classList.remove('is-error');
    els.saveState.classList.add('is-saved');
    els.saveState.textContent = 'Сохранено';
    saveTimer = window.setTimeout(() => {
      els.saveState.classList.remove('is-saved');
      els.saveState.textContent = 'Изменения сохраняются автоматически';
    }, 1600);
  }

  /* ---------- Toast & confirmation ---------- */
  function hideToast() {
    els.toast.classList.remove('is-visible');
    window.setTimeout(() => {
      if (!els.toast.classList.contains('is-visible')) els.toast.hidden = true;
    }, 220);
  }

  function showToast(message, action) {
    if (toastTimer) window.clearTimeout(toastTimer);
    els.toastText.textContent = message;
    if (action && typeof action.onClick === 'function') {
      els.toastAction.hidden = false;
      els.toastAction.textContent = action.label || 'Отменить';
      els.toastAction.onclick = () => {
        hideToast();
        action.onClick();
      };
    } else {
      els.toastAction.hidden = true;
      els.toastAction.onclick = null;
    }
    els.toast.hidden = false;
    window.requestAnimationFrame(() => els.toast.classList.add('is-visible'));
    toastTimer = window.setTimeout(hideToast, action ? 6000 : 3500);
  }

  function askConfirm({ title, text, confirmLabel = 'Подтвердить' }) {
    return new Promise((resolve) => {
      els.confirmTitle.textContent = title;
      els.confirmText.textContent = text;
      els.confirmOk.textContent = confirmLabel;
      els.confirmDialog.returnValue = '';
      const onClose = () => {
        els.confirmDialog.removeEventListener('close', onClose);
        syncBodyLock();
        resolve(els.confirmDialog.returnValue === 'confirm');
      };
      els.confirmDialog.addEventListener('close', onClose);
      els.confirmDialog.showModal();
      syncBodyLock();
      const cancel = $('.confirm__actions .btn--ghost', els.confirmDialog);
      if (cancel) cancel.focus();
    });
  }

  function setDataMessage(message, type = '') {
    els.dataMessage.textContent = message;
    els.dataMessage.classList.remove('is-error', 'is-success');
    if (type) els.dataMessage.classList.add(`is-${type}`);
  }

  function syncBodyLock() {
    const anyOpen = Boolean(document.querySelector('dialog[open]'));
    document.body.classList.toggle('has-dialog', anyOpen);
  }

  /* ---------- Game details ---------- */
  function openGame(slug, { random = false } = {}) {
    const game = gameBySlug.get(slug);
    if (!game) return;

    activeSlug = slug;
    suspendedEntry = null;
    renderGameInfo(game, random);
    renderGameState(game);
    resetSaveState();

    if (!els.gameDialog.open) {
      els.gameDialog.showModal();
      syncBodyLock();
      const close = $('.modal__close', els.gameDialog);
      if (close) close.focus();
    }
  }

  function renderGameInfo(game, random) {
    els.gameEyebrow.textContent = random ? 'Случайная игра из списка' : 'Игра из списка Top 250';
    els.gameCover.src = game.cover;
    els.gameCover.alt = `Обложка ${game.title}`;
    els.gameTitle.textContent = game.title;
    els.gameRank.textContent = `№ ${game.rank}`;

    els.gameScore.textContent = String(game.score);
    els.gameScore.classList.remove('is-top', 'is-high', 'is-good');
    els.gameScore.classList.add(scoreClass(game.score));
    els.gameScore.title = `Metascore ${game.score}`;

    const reviewWord = plural(game.reviews, 'рецензия', 'рецензии', 'рецензий');
    const platforms = game.platforms.length ? game.platforms.join(' / ') : 'Платформы не указаны';
    els.gameMeta.textContent = `${game.year} · ${platforms} · Metascore ${game.score} (${game.reviews} ${reviewWord})`;
    els.gameDesc.textContent = game.description || 'Описание для этой игры пока недоступно.';

    const fragment = document.createDocumentFragment();
    const tags = game.genres && game.genres.length
      ? game.genres
      : game.families.map((family) => FAMILIES[family]);
    for (const tag of tags) fragment.append(node('span', 'tag', tag));
    els.gameGenres.replaceChildren(fragment);
  }

  function renderGameState(game) {
    const entry = progress[game.slug];
    const done = Boolean(entry);
    const date = entry && entry.date ? entry.date : '';

    els.doneToggle.checked = done;
    els.detailsFields.disabled = !done;
    els.doneHint.textContent = done
      ? 'Дата и оценка необязательны — можно изменить в любой момент'
      : 'Отметьте игру, чтобы добавить дату и оценку';

    els.doneDate.max = todayISO();
    els.doneDate.value = date;
    updateRatingButtons(entry && entry.rating ? entry.rating : null);
  }

  function setDoneFromModal(checked) {
    if (!activeSlug) return;
    const game = gameBySlug.get(activeSlug);
    if (!game) return;

    if (checked) {
      if (!progress[activeSlug]) {
        const restored = suspendedEntry && typeof suspendedEntry === 'object' ? suspendedEntry : null;
        progress[activeSlug] = {
          done: true,
          date: restored && isValidDate(restored.date) ? restored.date : todayISO(),
          rating: restored && Number.isInteger(restored.rating) ? restored.rating : null
        };
      }
      suspendedEntry = null;
    } else {
      const current = progress[activeSlug];
      suspendedEntry = current ? { ...current } : null;
      delete progress[activeSlug];
    }

    persist();
    syncAll();
    renderGameState(game);
    markSaved();
  }

  function setDateFromModal(value) {
    if (!activeSlug) return;
    const entry = progress[activeSlug];
    if (!entry) return;

    if (value && !isValidDate(value)) {
      els.doneDate.value = entry.date || '';
      showToast('Не удалось распознать дату');
      return;
    }
    if (value && value > todayISO()) {
      entry.date = todayISO();
      els.doneDate.value = entry.date;
      showToast('Дата не может быть в будущем — поставили сегодняшнюю');
    } else {
      entry.date = value || '';
    }

    persist();
    syncAll();
    markSaved();
  }

  function setRating(value) {
    if (!activeSlug) return;
    const entry = progress[activeSlug];
    if (!entry) return;
    const rating = Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
    entry.rating = rating;
    updateRatingButtons(rating);
    persist();
    syncAll();
    markSaved();
    const button = rating ? $(`.rating__btn[data-value="${rating}"]`, els.ratingGroup) : null;
    if (button) button.focus();
  }

  function handleRatingKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = $$('.rating__btn', els.ratingGroup);
    const current = Number(event.target.dataset.value);
    if (!buttons.length || !Number.isInteger(current)) return;
    event.preventDefault();

    let next = current;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = current === 1 ? 10 : current - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = current === 10 ? 1 : current + 1;
    if (event.key === 'Home') next = 1;
    if (event.key === 'End') next = 10;
    setRating(next);
  }

  function closeGame() {
    if (els.gameDialog.open) els.gameDialog.close();
  }

  function openRandom() {
    const left = GAMES.filter((game) => !progress[game.slug]);
    if (!left.length) {
      showToast('Все 250 игр пройдены. Впечатляюще!');
      return;
    }
    const pool = left.length > 1 && lastRandomSlug
      ? left.filter((game) => game.slug !== lastRandomSlug)
      : left;
    const game = pool[Math.floor(Math.random() * pool.length)] || left[0];
    lastRandomSlug = game.slug;
    openGame(game.slug, { random: true });
  }

  function toggleCard(slug) {
    const game = gameBySlug.get(slug);
    if (!game) return;
    const previous = progress[slug];

    if (previous) {
      delete progress[slug];
      persist();
      syncAll();
      showToast(`«${game.title}»: отметка снята`, {
        label: 'Вернуть',
        onClick: () => {
          progress[slug] = previous;
          persist();
          syncAll();
          markSaved();
        }
      });
      return;
    }

    progress[slug] = { done: true, date: todayISO(), rating: null };
    persist();
    syncAll();
    showToast(`«${game.title}» отмечена как пройденная`, {
      label: 'Дата и оценка',
      onClick: () => openGame(slug)
    });

    const refs = cardRefs.get(slug);
    if (refs && !refs.card.hidden) {
      window.requestAnimationFrame(() => refs.check.focus({ preventScroll: true }));
    }
  }

  /* ---------- Import / export ---------- */
  function openDataDialog() {
    updateDataDialog();
    setDataMessage('');
    els.importFile.value = '';
    els.dataDialog.showModal();
    syncBodyLock();
    const close = $('.modal__close', els.dataDialog);
    if (close) close.focus();
  }

  function exportProgress() {
    const payload = {
      app: 'top250-checklist',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: META.source || 'Metacritic',
      total: TOTAL,
      games: progress
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `top250-progress-${todayISO()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const count = Object.keys(progress).length;
    if (els.dataDialog.open) els.dataDialog.close();
    if (count) {
      showToast(`Файл с ${count} ${plural(count, 'отметкой', 'отметками', 'отметками')} скачан`);
    } else {
      showToast('Скачан пустой файл прогресса');
    }
  }

  function sanitizeImported(source) {
    const imported = {};
    let unknown = 0;
    for (const [slug, value] of Object.entries(source)) {
      if (!slugSet.has(slug) || !value) {
        unknown += 1;
        continue;
      }
      if (value === true) {
        imported[slug] = { done: true, date: '', rating: null };
        continue;
      }
      if (typeof value !== 'object' || Array.isArray(value) || value.done === false) {
        unknown += 1;
        continue;
      }
      const date = isValidDate(value.date) ? value.date : '';
      const ratingValue = Number(value.rating);
      const rating = Number.isInteger(ratingValue) && ratingValue >= 1 && ratingValue <= 10 ? ratingValue : null;
      imported[slug] = { done: true, date, rating };
    }
    return { imported, unknown };
  }

  async function handleImport(file) {
    setDataMessage('');
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setDataMessage('Файл слишком большой. Максимум — 5 МБ.', 'error');
      els.importFile.value = '';
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad root');
      const source = parsed.games && typeof parsed.games === 'object' && !Array.isArray(parsed.games)
        ? parsed.games
        : parsed.progress && typeof parsed.progress === 'object' && !Array.isArray(parsed.progress)
          ? parsed.progress
          : parsed;
      const { imported, unknown } = sanitizeImported(source);
      const count = Object.keys(imported).length;

      if (!count) {
        setDataMessage('В файле не найдено ни одной отметки для этого списка.', 'error');
        showToast('Импорт не выполнен: нет подходящих данных');
        return;
      }

      const existing = Object.keys(progress).length;
      if (existing) {
        const confirmed = await askConfirm({
          title: 'Заменить текущий прогресс?',
          text: `В файле ${count} ${plural(count, 'отметка', 'отметки', 'отметок')}. Текущие ${existing} ${plural(existing, 'отметка', 'отметки', 'отметок')} будут заменены.`,
          confirmLabel: 'Заменить'
        });
        if (!confirmed) {
          setDataMessage('Импорт отменён. Текущий прогресс не изменён.');
          return;
        }
      }

      progress = imported;
      if (savedAt) savedAt = null;
      persist();
      syncAll();
      els.dataDialog.close();
      const skipped = unknown ? `, ${unknown} ${plural(unknown, 'запись', 'записи', 'записей')} пропущено` : '';
      showToast(`Импортировано ${count} ${plural(count, 'отметка', 'отметки', 'отметок')}${skipped}`);
    } catch (error) {
      console.warn('Не удалось импортировать прогресс:', error);
      setDataMessage('Не удалось прочитать файл. Убедитесь, что это JSON, скачанный с этого сайта.', 'error');
      showToast('Ошибка импорта');
    } finally {
      els.importFile.value = '';
    }
  }

  async function resetProgress() {
    const count = Object.keys(progress).length;
    if (!count) {
      setDataMessage('Пока нечего сбрасывать — отметок нет.');
      return;
    }

    const confirmed = await askConfirm({
      title: 'Начать заново?',
      text: `Все ${count} ${plural(count, 'отметка', 'отметки', 'отметок')} и оценки будут удалены. Это действие нельзя отменить.`,
      confirmLabel: 'Удалить всё'
    });
    if (!confirmed) return;

    progress = {};
    persist();
    syncAll();
    els.dataDialog.close();
    showToast('Прогресс сброшен');
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    els.searchInput.addEventListener('input', () => {
      state.search = els.searchInput.value;
      syncSearchUI();
      applyFilters();
    });

    els.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.searchInput.value) {
        event.preventDefault();
        els.searchInput.value = '';
        state.search = '';
        syncSearchUI();
        applyFilters();
      }
    });

    els.searchClear.addEventListener('click', () => {
      els.searchInput.value = '';
      state.search = '';
      syncSearchUI();
      applyFilters();
      els.searchInput.focus();
    });

    els.genreFilter.addEventListener('change', () => {
      state.genre = els.genreFilter.value;
      applyFilters();
    });

    els.platformFilter.addEventListener('change', () => {
      state.platform = els.platformFilter.value;
      applyFilters();
    });

    els.decadeFilter.addEventListener('change', () => {
      state.decade = els.decadeFilter.value;
      applyFilters();
    });

    els.sortSelect.addEventListener('change', () => {
      state.sort = els.sortSelect.value;
      applyFilters();
    });

    for (const button of $$('.segmented button')) {
      button.addEventListener('click', () => setStatus(button.dataset.status));
    }

    els.resetFilters.addEventListener('click', resetFilters);
    els.resetEmpty.addEventListener('click', resetFilters);

    els.gameGrid.addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (!card) return;
      const slug = card.dataset.slug;
      if (!slug) return;
      if (event.target.closest('.card__check')) {
        toggleCard(slug);
        return;
      }
      if (event.target.closest('.card__open')) openGame(slug);
    });

    for (const button of $$('[data-random]')) {
      button.addEventListener('click', openRandom);
    }

    for (const button of $$('[data-open-data]')) {
      button.addEventListener('click', openDataDialog);
    }

    for (const button of $$('[data-close]')) {
      button.addEventListener('click', () => {
        const dialog = document.getElementById(button.dataset.close);
        if (dialog && dialog.open) dialog.close();
      });
    }

    for (const dialog of [els.gameDialog, els.dataDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      dialog.addEventListener('close', syncBodyLock);
    }

    els.gameDialog.addEventListener('close', () => {
      activeSlug = null;
      suspendedEntry = null;
    });

    els.doneToggle.addEventListener('change', () => setDoneFromModal(els.doneToggle.checked));
    els.doneDate.addEventListener('change', () => setDateFromModal(els.doneDate.value));

    els.ratingGroup.addEventListener('click', (event) => {
      const button = event.target.closest('.rating__btn');
      if (button) setRating(Number(button.dataset.value));
    });
    els.ratingGroup.addEventListener('keydown', handleRatingKeydown);
    els.ratingClear.addEventListener('click', () => setRating(null));

    els.exportBtn.addEventListener('click', exportProgress);
    els.importBtn.addEventListener('click', () => els.importFile.click());
    els.importFile.addEventListener('change', () => {
      const file = els.importFile.files && els.importFile.files[0];
      handleImport(file);
    });
    els.resetBtn.addEventListener('click', resetProgress);

    document.addEventListener('keydown', (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable)) return;
      event.preventDefault();
      els.searchInput.focus();
      els.searchInput.select();
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      const loaded = readStorage();
      progress = loaded.progress;
      savedAt = loaded.savedAt;
      syncAll();
      const count = Object.keys(progress).length;
      showToast(count
        ? `Прогресс обновлён в другой вкладке: ${count} ${plural(count, 'отметка', 'отметки', 'отметок')}`
        : 'Прогресс очищен в другой вкладке');
    });
  }

  /* ---------- Init ---------- */
  function init() {
    storageOk = canUseStorage();
    const loaded = readStorage();
    progress = loaded.progress;
    savedAt = loaded.savedAt;

    buildGenreOptions();
    buildPlatformOptions();
    buildDecadeOptions();
    buildCards();
    buildRatingButtons();
    bindEvents();
    syncSearchUI();
    syncAll();
  }

  init();
})();

