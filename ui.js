(() => {
  const enso = window.enso;
  if (enso?.theme) document.documentElement.dataset.theme = enso.theme;

  const $ = (id) => document.getElementById(id);
  const call = (method, args = {}) => enso.call(method, args);

  const state = {
    tab: 'hot',
    q: '',
    list: [],
    loading: false,
    error: '',
    currentId: '',
    currentName: '',
    playing: false,
    mime: '',
    favorites: [],
    book: {},
    lastId: '',
    covers: {},
    coverFail: {},
    toastTimer: 0,
    busy: false,
    regionId: 'gd',
    regions: [],
    chipsOpen: false,
  };

  let playSeq = 0;

  let media = {
    ms: null,
    sb: null,
    looping: false,
    objectUrl: '',
  };

  const storage = {
    get(key, fallback) {
      try {
        const raw = enso.storage.get(key);
        return raw == null || raw === '' ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      enso.storage.set(key, JSON.stringify(value));
    },
  };

  state.favorites = Array.isArray(storage.get('favorites', []))
    ? storage.get('favorites', []).filter((x) => typeof x === 'string').slice(0, 100)
    : [];
  state.book =
    storage.get('stationBook', {}) && typeof storage.get('stationBook', {}) === 'object'
      ? storage.get('stationBook', {})
      : {};
  state.lastId = typeof storage.get('lastId', '') === 'string' ? storage.get('lastId', '') : '';
  const savedRegion = storage.get('regionId', 'gd');
  state.regionId = typeof savedRegion === 'string' && savedRegion ? savedRegion : 'gd';
  const vol0 = Number(storage.get('volume', 0.8));
  const volume = Number.isFinite(vol0) ? Math.min(1, Math.max(0, vol0)) : 0.8;
  $('vol').value = String(Math.round(volume * 100));
  $('audio').volume = volume;

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function saveFav() {
    storage.set('favorites', state.favorites);
    storage.set('stationBook', state.book);
  }

  function glyph(name) {
    const ch = String(name || '').trim().charAt(0);
    return ch || '?';
  }

  function skipToFrame(u8) {
    for (let i = 0; i < u8.length - 1; i++) {
      if (u8[i] === 0xff && (u8[i + 1] & 0xe0) === 0xe0) {
        return i === 0 ? u8 : u8.subarray(i);
      }
    }
    return u8;
  }

  function displayed() {
    if (state.tab === 'fav' && !state.q) {
      return state.favorites.map((id) => state.book[id]).filter(Boolean);
    }
    return state.list;
  }

  function renderEmpty() {
    const el = $('empty');
    const rows = displayed();
    if (state.loading) {
      el.hidden = false;
      el.textContent = '加载中…';
      $('list').innerHTML = '';
      return true;
    }
    if (state.error) {
      el.hidden = false;
      el.innerHTML = '';
      el.append(state.error, document.createElement('br'));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '重试';
      btn.onclick = () => load();
      el.append(btn);
      $('list').innerHTML = '';
      return true;
    }
    if (!rows.length) {
      el.hidden = false;
      el.textContent =
        state.tab === 'fav' && !state.q
          ? '还没有收藏的电台'
          : state.tab === 'cat'
            ? '这个地区暂时没有可列出的电台'
            : '没有找到电台';
      $('list').innerHTML = '';
      return true;
    }
    el.hidden = true;
    el.textContent = '';
    return false;
  }

  function renderChips() {
    const bar = $('regionBar');
    const el = $('chips');
    if (state.tab !== 'cat' || state.q) {
      bar.hidden = true;
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const current = state.regions.find((r) => r.id === state.regionId) || state.regions[0];
    bar.hidden = false;
    $('regionCurrent').textContent = current ? current.label : '广东';
    $('regionToggle').classList.toggle('open', state.chipsOpen);
    $('regionToggle').textContent = state.chipsOpen ? '▴' : '▾';
    if (!state.chipsOpen) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = '';
    for (const r of state.regions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.label;
      btn.className = r.id === state.regionId ? 'on' : '';
      btn.addEventListener('click', () => {
        state.chipsOpen = false;
        if (state.regionId === r.id) {
          render();
          return;
        }
        state.regionId = r.id;
        storage.set('regionId', r.id);
        load();
      });
      el.append(btn);
    }
  }

  function render() {
    $('tab-hot').classList.toggle('on', state.tab === 'hot');
    $('tab-cat').classList.toggle('on', state.tab === 'cat');
    $('tab-fav').classList.toggle('on', state.tab === 'fav');
    renderChips();
    if (renderEmpty()) {
      renderPlayer();
      return;
    }
    const ul = $('list');
    ul.innerHTML = '';
    for (const s of displayed()) {
      const row = document.createElement('div');
      const isCurrent = s.id === state.currentId;
      const isPlaying = isCurrent && state.playing;
      row.className =
        'row' + (isPlaying ? ' playing' : isCurrent ? ' current' : '') + (s.playable ? '' : ' dead');
      row.dataset.id = s.id;

      const av = document.createElement('div');
      av.className = 'av';
      if (state.covers[s.id]) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = state.covers[s.id];
        av.append(img);
      } else {
        av.textContent = glyph(s.name);
      }
      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'av-badge';
        badge.setAttribute('aria-hidden', 'true');
        if (isPlaying) {
          const eq = document.createElement('span');
          eq.className = 'av-eq';
          eq.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
          badge.append(eq);
        } else {
          const play = document.createElement('span');
          play.className = 'av-play';
          badge.append(play);
        }
        av.append(badge);
      }

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = s.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      const bits = [
        s.country,
        s.votes ? `热度 ${s.votes}` : '',
        Array.isArray(s.aliases) && s.aliases.length ? s.aliases.join(' / ') : '',
        s.bitrate ? `${s.bitrate}kbps` : '',
        s.playable ? s.codec : '暂不支持',
      ]
        .filter(Boolean)
        .join(' · ');
      sub.textContent = bits;
      meta.append(name, sub);

      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'star' + (state.favorites.includes(s.id) ? ' on' : '');
      star.textContent = state.favorites.includes(s.id) ? '★' : '☆';
      star.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleFav(s);
      });

      row.append(av, meta, star);
      row.addEventListener('click', () => onRow(s));
      ul.append(row);
    }
    renderPlayer();
    queueCovers();
  }

  function renderPlayer() {
    const now = $('now');
    const toggle = $('toggle');
    if (state.playing) {
      now.textContent = state.currentName || '播放中';
      now.classList.add('live');
      toggle.classList.add('is-playing');
      toggle.setAttribute('aria-label', '暂停');
    } else if (state.currentId) {
      now.textContent = state.currentName || '已暂停';
      now.classList.remove('live');
      toggle.classList.remove('is-playing');
      toggle.setAttribute('aria-label', '播放');
    } else {
      now.textContent = '未在播放';
      now.classList.remove('live');
      toggle.classList.remove('is-playing');
      toggle.setAttribute('aria-label', '播放');
    }
    toggle.disabled = !state.currentId && !state.lastId;
    $('halt').disabled = !state.currentId && !state.playing;
  }

  function toggleFav(s) {
    const i = state.favorites.indexOf(s.id);
    if (i >= 0) state.favorites.splice(i, 1);
    else {
      state.favorites.unshift(s.id);
      state.favorites = state.favorites.slice(0, 100);
      state.book[s.id] = s;
    }
    saveFav();
    render();
  }

  let coverBusy = 0;
  function queueCovers() {
    for (const s of displayed()) {
      if (!s.hasFavicon || !s.favicon) continue;
      if (state.covers[s.id] || state.coverFail[s.id]) continue;
      if (coverBusy >= 2) return;
      coverBusy += 1;
      state.coverFail[s.id] = true;
      call('cover', { id: s.id, url: s.favicon })
        .then((res) => {
          if (res?.ok && res.dataUrl) {
            state.covers[s.id] = res.dataUrl;
            delete state.coverFail[s.id];
            render();
          }
        })
        .catch(() => {})
        .finally(() => {
          coverBusy -= 1;
          queueCovers();
        });
    }
  }

  function tearMedia() {
    media.looping = false;
    const audio = $('audio');
    try {
      audio.pause();
    } catch {
      /* ignore */
    }
    if (media.objectUrl) {
      URL.revokeObjectURL(media.objectUrl);
      media.objectUrl = '';
    }
    media.ms = null;
    media.sb = null;
    audio.removeAttribute('src');
    audio.load();
  }

  async function stopAll() {
    media.looping = false;
    tearMedia();
    try {
      await call('stop', {});
    } catch {
      /* ignore */
    }
    state.playing = false;
    renderPlayer();
  }

  async function loopChunks(id) {
    const audio = $('audio');
    while (media.looping && state.currentId === id) {
      let res;
      try {
        res = await call('chunk', { id });
      } catch {
        toast('直播中断，点击重试');
        await stopAll();
        return;
      }
      if (!media.looping || state.currentId !== id) return;
      if (!res?.ok) {
        if (res?.reason === 'stale') return;
        toast('直播中断，点击重试');
        await stopAll();
        return;
      }
      if (res.eof) {
        toast(res.error || '直播中断，点击重试');
        try {
          if (media.ms && media.ms.readyState === 'open') media.ms.endOfStream();
        } catch {
          /* ignore */
        }
        state.playing = false;
        renderPlayer();
        return;
      }
      if (res.empty) {
        await new Promise((r) => setTimeout(r, 280));
        continue;
      }
      const buf = Uint8Array.from(atob(res.b64), (c) => c.charCodeAt(0));
      const sb = media.sb;
      if (!sb) return;
      try {
        if (sb.updating) {
          await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
        }
        if (sb.buffered.length) {
          const start = sb.buffered.start(0);
          const end = sb.buffered.end(sb.buffered.length - 1);
          if (end - start > 30 && audio.currentTime - start > 12) {
            sb.remove(start, Math.max(start, audio.currentTime - 8));
            await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
          }
        }
        sb.appendBuffer(buf);
        await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
      } catch {
        try {
          const aligned = skipToFrame(buf);
          if (aligned === buf || !aligned.length) throw new Error('bad frame');
          if (sb.updating) {
            await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
          }
          sb.appendBuffer(aligned);
          await new Promise((r) => sb.addEventListener('updateend', r, { once: true }));
        } catch {
          toast('无法播放此电台');
          await stopAll();
          return;
        }
      }
    }
  }

  async function startPlay(station) {
    if (state.busy) return;
    const seq = ++playSeq;
    state.busy = true;
    try {
    await stopAll();
    if (seq !== playSeq) return;
    state.currentName = station.name;
    let res;
    try {
      res = await call('open', { id: station.id });
    } catch {
      if (seq === playSeq) toast('无法播放此电台');
      return;
    }
    if (seq !== playSeq) return;
    if (res?.reason === 'unsupported') {
      if (seq === playSeq) toast('此台是 HLS，当前版本还不支持');
      return;
    }
    if (!res?.ok) {
      if (seq === playSeq) toast(res?.error || '无法播放此电台');
      return;
    }
    state.currentId = station.id;
    state.currentName = res.name || station.name;
    state.lastId = station.id;
    storage.set('lastId', station.id);
    state.book[station.id] = station;
    saveFav();

    const audio = $('audio');
    const ms = new MediaSource();
    media.ms = ms;
    media.objectUrl = URL.createObjectURL(ms);
    audio.src = media.objectUrl;
    await new Promise((resolve, reject) => {
      ms.addEventListener(
        'sourceopen',
        () => {
          try {
            const sb = ms.addSourceBuffer(res.mime || 'audio/mpeg');
            media.sb = sb;
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        { once: true },
      );
    }).catch(async () => {
      if (seq === playSeq) {
        toast('无法播放此电台');
        await stopAll();
      }
    });
    if (seq !== playSeq) return;
    if (!media.sb) return;
    media.looping = true;
    state.playing = true;
    render();
    const playP = audio.play().catch(() => {});
    loopChunks(station.id);
    await playP;
    } finally {
      if (seq === playSeq) state.busy = false;
    }
  }

  async function onRow(s) {
    if (state.busy) return;
    if (!s.playable) {
      toast('此台是 HLS，当前版本还不支持');
      return;
    }
    if (state.currentId === s.id && state.playing) {
      await stopAll();
      render();
      return;
    }
    if (state.currentId === s.id && !state.playing) {
      await startPlay(s);
      return;
    }
    await startPlay(s);
  }

  async function load() {
    state.loading = true;
    state.error = '';
    render();
    try {
      let res;
      if (state.q) {
        res = await call('search', { q: state.q });
      } else if (state.tab === 'cat') {
        if (!state.regions.length) {
          const meta = await call('regions', {});
          if (meta?.ok && Array.isArray(meta.regions)) {
            state.regions = meta.regions;
            if (!state.regions.some((r) => r.id === state.regionId)) {
              state.regionId = meta.defaultId || 'gd';
            }
          }
        }
        res = await call('byRegion', { id: state.regionId });
      } else {
        res = await call('discover', {});
      }
      if (!res?.ok) {
        state.list = [];
        state.error = res?.error || '电台目录暂时连不上，请稍后重试';
      } else {
        state.list = res.stations || [];
        for (const s of state.list) state.book[s.id] = s;
        saveFav();
      }
    } catch {
      state.list = [];
      state.error = '电台目录暂时连不上，请稍后重试';
    } finally {
      state.loading = false;
      render();
    }
  }

  $('tab-hot').onclick = () => {
    state.tab = 'hot';
    if (state.q) {
      $('q').value = '';
      state.q = '';
    }
    load();
  };
  $('tab-cat').onclick = () => {
    state.tab = 'cat';
    state.chipsOpen = false;
    if (state.q) {
      $('q').value = '';
      state.q = '';
    }
    load();
  };
  $('tab-fav').onclick = () => {
    state.tab = 'fav';
    state.chipsOpen = false;
    render();
  };

  const toggleChips = () => {
    if (state.tab !== 'cat') return;
    state.chipsOpen = !state.chipsOpen;
    render();
  };
  $('regionToggle').onclick = toggleChips;
  $('regionCurrent').onclick = toggleChips;

  let t = 0;
  $('q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = $('q').value.trim();
      state.tab = 'hot';
      if (!state.q) load();
      else load();
    }, 300);
  });

  $('toggle').onclick = async () => {
    if (state.busy) return;
    if (state.playing) {
      await stopAll();
      render();
      return;
    }
    const id = state.currentId || state.lastId;
    const s = (id && state.book[id]) || displayed().find((x) => x.id === id);
    if (s) await startPlay(s);
  };
  $('halt').onclick = async () => {
    await stopAll();
    state.currentId = '';
    state.currentName = '';
    render();
  };
  $('vol').addEventListener('input', () => {
    const v = Number($('vol').value) / 100;
    $('audio').volume = v;
    storage.set('volume', v);
  });

  window.addEventListener('pagehide', () => {
    media.looping = false;
    call('stop', {}).catch(() => {});
  });

  load();
})();
