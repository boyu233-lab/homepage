/*
 * Homepage - 左侧分组导航 + 在线背景切换(配合 custom.css)
 * 1) 把书签/服务分组的标题提取为左侧竖排导航,点击切换显示对应分组的瓷砖;
 *    纯前端实现,不修改 React 节点,只在分组容器内插入一个导航 div;
 *    配置热更新导致重渲染时会自动重建,选中状态存在 localStorage。
 * 2) 页面右下角生成背景切换按钮:极光图案 <-> 在线壁纸,
 *    支持"换一张"(随机历史壁纸),偏好存 localStorage。
 *    图源统一配置在 WALLPAPER_* 常量里:换成自己服务器/NAS 上的图片即可完全自托管,
 *    两组都留空数组则彻底关闭在线请求(浏览器不再向任何第三方发起图片请求)。
 *    每个图源带独立超时并按顺序自动容错,全部失败回退到极光图案,不会留白或卡住。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "homepage.activeGroup";
  var BG_MODE_KEY = "homepage.bgMode";   // "pattern" | "bing"
  var HOME_GROUP = "__home__";           // 左侧「首页」虚拟分组
  var HOME_LABEL = "首页";

  /* ============ 壁纸图源(集中配置,想自托管只改这里) ============
   * - 私有化:把下面两组换成你自己 Nginx / NAS / 对象存储上的图片 URL,
   *   浏览器就只请求你的服务器,不再向第三方暴露访客 IP 与 Referer。
   * - 关闭在线壁纸:两组都写成 [] 即可,页面始终使用纯 CSS 极光背景。
   * - 顺序即优先级,前一个失败/超时会自动尝试下一个。
   * - 单个图源最长等待 WALLPAPER_TIMEOUT_MS 毫秒。
   */
  var WALLPAPER_TODAY = [
    "https://bing.ee123.net/img/?size=1920x1080",
    "https://bing.img.run/1920x1080.php",
    "https://picsum.photos/1920/1080"
  ];
  var WALLPAPER_RANDOM = [
    "https://bing.ee123.net/img/rand?size=1920x1080",
    "https://bing.img.run/rand.php",
    "https://picsum.photos/1920/1080?random"
  ];
  var WALLPAPER_TIMEOUT_MS = 8000;

  var container = null;
  var nav = null;
  var bg = { toggle: null, next: null };

  function lsGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ============ 分组视图与首页面板外框对齐 ============
     首页视图下测量「热搜 + B站音乐」两栏的联合外框(最小 top / 最大 bottom),
     相对主容器写入 :root CSS 变量;custom.css 用这两个变量把分组卡片区
     定位到同一起点、同一高度。两栏并排时任一边变高都会重新对齐。
     数值缓存到 localStorage:首次访问就停在某个分组时也能立刻对齐。 */
  var PANEL_KEY = "homepage.newsPanel";
  var PANEL_SELECTOR = ".information-widget-news, .information-widget-bilibili_music";
  var panelObserver = null;
  var panelTargets = [];

  function applyPanelMetrics(top, height, persist) {
    document.documentElement.style.setProperty("--news-panel-top", top + "px");
    document.documentElement.style.setProperty("--news-panel-height", height + "px");
    if (persist !== false) {
      try { localStorage.setItem(PANEL_KEY, JSON.stringify({ top: top, height: height })); } catch (e) {}
    }
  }

  function restorePanelMetrics() {
    try {
      var raw = localStorage.getItem(PANEL_KEY);
      if (!raw) return;
      var m = JSON.parse(raw);
      if (m && m.top > 0 && m.height > 0) applyPanelMetrics(m.top, m.height, false);
    } catch (e) { /* 缓存损坏就等下次测量 */ }
  }

  function measureNewsPanel() {
    if (!document.body || !document.body.classList.contains("home-view")) return;
    var host = document.querySelector("#inner_wrapper > div");
    if (!host) return;
    var rects = Array.prototype.map.call(
      document.querySelectorAll(PANEL_SELECTOR),
      function (el) { return el.getBoundingClientRect(); }
    ).filter(function (r) { return r.height >= 40; });  // 隐藏 / 占位态不参与测量
    if (!rects.length) return;
    var top = Math.min.apply(null, rects.map(function (r) { return r.top; }));
    var bottom = Math.max.apply(null, rects.map(function (r) { return r.bottom; }));
    var h = host.getBoundingClientRect();
    applyPanelMetrics(Math.max(0, Math.round(top - h.top)), Math.round(bottom - top));
  }

  function watchNewsPanel() {
    if (typeof ResizeObserver === "undefined") return;
    var panels = Array.prototype.slice.call(document.querySelectorAll(PANEL_SELECTOR));
    if (!panels.length) return;
    var same = panelObserver && panelTargets.length === panels.length &&
      panels.every(function (el, i) { return panelTargets[i] === el; });
    if (same) return;
    if (panelObserver) panelObserver.disconnect();
    panelObserver = new ResizeObserver(function () { measureNewsPanel(); });
    panels.forEach(function (el) { panelObserver.observe(el); });
    panelTargets = panels;
  }

  function schedulePanelMeasure() {
    watchNewsPanel();
    // 新闻异步拉取,首屏与几次重绘后各测一次,确保拿到完整列表高度
    setTimeout(measureNewsPanel, 0);
    setTimeout(measureNewsPanel, 350);
    setTimeout(measureNewsPanel, 1200);
  }

  /* ============ 左侧分组导航 ============ */

  function getGroups() {
    if (!container) return [];
    return Array.prototype.filter.call(container.children, function (el) {
      return el.classList.contains("bookmark-group") || el.classList.contains("services-group");
    });
  }

  function groupName(group) {
    var h2 = group.querySelector("h2");
    return h2 ? h2.textContent.trim() : "";
  }

  // 折叠面板(Headless UI Transition)会在 DOM 上写固定 px 高度,
  // 改成网格后内容变高会把最后一行裁掉,这里清掉残留的内联高度/裁切样式
  function unclip(group) {
    var els = [group].concat(Array.prototype.slice.call(
      group.querySelectorAll(":scope > div, :scope > div > div")
    ));
    els.forEach(function (el) {
      el.style.height = "";
      el.style.maxHeight = "";
      el.style.overflow = "";
    });
  }

  // 切换分组时把滚动位置归零,避免沿用上一分组的滚动偏移
  function resetScroll() {
    var inner = document.getElementById("inner_wrapper");
    if (inner) inner.scrollTop = 0;
    if (window.scrollY) window.scrollTo(0, 0);
  }

  // 首页是虚拟分组:只切换 body.home-view,不激活任何书签分组。
  // 搜索框 / 时间 / 新闻的居中堆叠布局全部由 custom.css 在 .home-view 下接管。
  function activate(name) {
    var isHome = name === HOME_GROUP;
    if (document.body) document.body.classList.toggle("home-view", isHome);

    getGroups().forEach(function (g) {
      var active = !isHome && groupName(g) === name;
      g.classList.toggle("nav-active", active);
      if (active) unclip(g);
    });
    if (nav) {
      Array.prototype.forEach.call(nav.children, function (it) {
        it.classList.toggle("active", it.getAttribute("data-group") === name);
      });
    }
    lsSet(STORAGE_KEY, name);
    if (isHome) schedulePanelMeasure();   // 回到首页时刷新新闻窗口尺寸
  }

  function homeIcon() {
    var span = document.createElement("span");
    span.className = "group-nav-home-icon";
    span.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>';
    return span;
  }

  function makeNavItem(name, label, icon, isHome) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group-nav-item" + (isHome ? " group-nav-home" : "");
    btn.setAttribute("data-group", name);
    if (icon) btn.appendChild(icon.cloneNode(true));

    var text = document.createElement("span");
    text.className = "group-nav-name";
    text.textContent = label;
    btn.appendChild(text);

    btn.addEventListener("click", function () {
      activate(name);
      resetScroll();
    });
    return btn;
  }

  function buildNav() {
    var groups = getGroups();
    // 只有 1 个分组时也显示左侧导航，避免配置调整后整块导航突然消失
    if (groups.length < 1) return false;

    if (!nav || !nav.isConnected) {
      nav = document.createElement("div");
      nav.className = "group-nav";
      container.insertBefore(nav, container.firstChild);
      container.classList.add("nav-layout");
    }

    // 分组集合变化时重建导航项(首页固定排第一)
    var names = groups.map(groupName);
    var navNames = [HOME_GROUP].concat(names);
    var existing = Array.prototype.map.call(nav.children, function (el) {
      return el.getAttribute("data-group");
    });
    if (navNames.join("|") !== existing.join("|")) {
      nav.innerHTML = "";
      nav.appendChild(makeNavItem(HOME_GROUP, HOME_LABEL, homeIcon(), true));
      groups.forEach(function (g) {
        var header = g.querySelector(":scope > button");
        var icon = header
          ? header.querySelector(".bookmark-group-icon, .services-group-icon")
          : null;
        nav.appendChild(makeNavItem(groupName(g), groupName(g), icon, false));
      });
    }

    // 恢复上次选中;首次访问默认停在「首页」
    var saved = lsGet(STORAGE_KEY, "");
    var current = container.querySelector(".nav-active");
    if (current && navNames.indexOf(groupName(current)) !== -1) {
      activate(groupName(current));
    } else if (saved && navNames.indexOf(saved) !== -1) {
      activate(saved);
    } else {
      activate(HOME_GROUP);
    }
    return true;
  }

  function initNav() {
    container = document.getElementById("layout-groups")
      || document.getElementById("bookmarks")
      || document.getElementById("services");
    if (!container) return false;
    return buildNav();
  }

  /* ============ 在线背景切换 ============ */

  // 依次尝试多个图源;每个源带超时,失败/超时自动切下一个;random 模式加时间戳防缓存
  function tryLoadWallpaper(urls, index, random, onSuccess, onFail) {
    if (index >= urls.length) { onFail(); return; }
    var url = urls[index];
    if (random || index > 0) {
      url += (url.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
    }

    var settled = false;
    var img = new Image();
    var timer = setTimeout(function () { finish(false); }, WALLPAPER_TIMEOUT_MS);

    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (ok) {
        document.body.style.setProperty("--bing-url", 'url("' + url + '")');
        onSuccess(index);
      } else {
        // 只解绑回调继续尝试下一个源,不强制置空 img.src(避免触发对当前页的额外请求)
        tryLoadWallpaper(urls, index + 1, random, onSuccess, onFail);
      }
    }

    img.onload = function () { finish(true); };
    img.onerror = function () { finish(false); };
    img.src = url;
  }

  function hasWallpaperSources() {
    return WALLPAPER_TODAY.length > 0 || WALLPAPER_RANDOM.length > 0;
  }

  function applyPattern() {
    document.body.classList.remove("bing-bg");
    bg.toggle.textContent = "在线壁纸";
    bg.toggle.title = hasWallpaperSources()
      ? "切换到在线壁纸"
      : "未配置在线壁纸图源(可在 custom.js 顶部 WALLPAPER_* 配置自托管地址)";
    bg.next.style.display = "none";
    lsSet(BG_MODE_KEY, "pattern");
  }

  function applyBing(random) {
    var urls = random ? WALLPAPER_RANDOM : WALLPAPER_TODAY;
    if (!urls.length) {
      applyPattern();
      bg.toggle.title = "未配置在线壁纸图源(可在 custom.js 顶部 WALLPAPER_* 配置自托管地址)";
      return;
    }
    tryLoadWallpaper(urls, 0, random, function (usedIndex) {
      document.body.classList.add("bing-bg");
      bg.toggle.textContent = "极光图案";
      bg.toggle.title = "当前:在线壁纸(图源 #" + (usedIndex + 1) + "),点击切回极光图案";
      bg.next.style.display = "";
      lsSet(BG_MODE_KEY, "bing");
    }, function () {
      // 所有图源都失败或超时时回退到图案背景,不留下空白
      applyPattern();
      bg.toggle.title = "所有壁纸图源都不可达或超时,已保留极光图案背景";
    });
  }

  function setupBgSwitch() {
    if (!document.body || document.getElementById("bg-switch")) return;

    var bar = document.createElement("div");
    bar.id = "bg-switch";
    bar.className = "bg-switch";

    bg.toggle = document.createElement("button");
    bg.toggle.type = "button";
    bg.toggle.className = "bg-switch-btn";

    bg.next = document.createElement("button");
    bg.next.type = "button";
    bg.next.className = "bg-switch-btn bg-switch-mini";
    bg.next.textContent = "换一张";
    bg.next.title = "随机加载一张壁纸";

    bar.appendChild(bg.toggle);
    bar.appendChild(bg.next);
    document.body.appendChild(bar); // 挂在 React 根节点之外,不会被重渲染干扰

    bg.toggle.addEventListener("click", function () {
      if (document.body.classList.contains("bing-bg")) applyPattern();
      else applyBing(false);
    });
    bg.next.addEventListener("click", function () { applyBing(true); });

    if (lsGet(BG_MODE_KEY, "pattern") === "bing") applyBing(false);
    else applyPattern();
  }

  /* ============ 启动:用 MutationObserver 等 React 渲染完成 ============ */
  // 不再用 250ms 定时器轮询:DOM 一有变化就尝试初始化,找到挂载点后断开启动观察器,
  // 改为只监听分组容器自身的重渲染(配置热更新等),减少对官方 DOM id 的时序依赖。
  var rebuildTimer = null;
  var containerObserver = null;

  function watchContainer() {
    if (containerObserver || !container) return;
    containerObserver = new MutationObserver(function () {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(buildNav, 150);
    });
    containerObserver.observe(container, { childList: true });
  }

  function start() {
    setupBgSwitch();
    restorePanelMetrics();               // 先恢复上次测量值,首次就在分组视图也不会错位
    if (initNav()) {
      watchContainer();
      return true;
    }
    return false;
  }

  if (!start()) {
    var startupObserver = new MutationObserver(function () {
      if (start()) startupObserver.disconnect();
    });
    startupObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    // 兜底:DOM 长时间不再变化时,最多观察 30 秒后停止,避免观察器常驻
    setTimeout(function () { startupObserver.disconnect(); }, 30000);
  }
})();
