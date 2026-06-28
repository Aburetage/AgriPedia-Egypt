const appContainer = document.getElementById('app-container');
const sidebarContainer = document.getElementById('sidebar-menu-container');
const DATA_VERSION = '31';
const versionedDataUrl = path => `${path}${path.includes('?') ? '&' : '?'}v=${DATA_VERSION}`;
// 🌟 ضبط الوضع الداكن واللغة العربية كافتراضي 🌟
let currentLang = localStorage.getItem('lang') || 'ar';
let currentTheme = localStorage.getItem('theme') || 'dark'; 
let activeTabs = {}; 
let appDataIndex = null; 
let lastFocusedElement = null;
let latestChapterRequest = 0;
let deferredPrompt; // متغير تثبيت التطبيق PWA
let glossaryCache = {};
let currentGlossary = [];
let searchIndexCache = {};
let chapterManifestCache = {};
let pendingSearchScroll = null;
let searchDebounceTimer = null;
let searchActiveFilter = 'all';
let activeTermTrigger = null;
let termTooltipPinned = false;
let renderedRoute = '';
let scrollSaveFrame = 0;
let readingToastTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    applyTheme(currentTheme);
    applyLanguage(currentLang);
    registerServiceWorker(); 
    
    loadIndex().then(() => {
        handleRouting(); 
    });

    window.addEventListener('hashchange', () => {
        saveCurrentScrollPosition();
        handleRouting();
    }); 
    
    // أزرار الهيدر
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    document.getElementById('langToggle')?.addEventListener('click', toggleLanguage);
    document.getElementById('menuToggle')?.addEventListener('click', toggleSidebar);
    document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebar);
    document.getElementById('goHomeBtn')?.addEventListener('click', () => { window.location.hash = 'home'; });
    document.getElementById('headerTitle')?.addEventListener('click', () => { window.location.hash = 'home'; });
    document.getElementById('exitReadingMode')?.addEventListener('click', () => setReadingFocus(false));
    
    // نوافذ التواصل
    document.getElementById('infoToggleDesktop')?.addEventListener('click', toggleModal);
    document.getElementById('closeModal')?.addEventListener('click', closeModal);
    document.getElementById('infoModal')?.addEventListener('click', (event) => {
        if (event.target.id === 'infoModal') closeModal();
    });

    // نوافذ البحث
    document.getElementById('searchToggle')?.addEventListener('click', openSearch);
    document.getElementById('closeSearchModal')?.addEventListener('click', closeSearch);
    document.getElementById('searchModal')?.addEventListener('click', (e) => { if (e.target.id === 'searchModal') closeSearch(); });

    // أزرار شريط التنقل السفلي للموبايل
    document.getElementById('bNavHome')?.addEventListener('click', () => { window.location.hash = 'home'; });
    document.getElementById('bNavMenu')?.addEventListener('click', toggleSidebar);
    document.getElementById('bNavTheme')?.addEventListener('click', toggleTheme);
    document.getElementById('bNavInfo')?.addEventListener('click', toggleModal);
    document.getElementById('bNavSearch')?.addEventListener('click', openSearch);

    document.addEventListener('keydown', handleGlobalKeydown);
    
    // التمرير وزر العودة لأعلى
    const backToTopBtn = document.getElementById('back-to-top');
    const progressBar = document.getElementById('scroll-progress');
    window.addEventListener('scroll', () => {
        let scrollTop = window.scrollY || document.documentElement.scrollTop;
        let scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        if(progressBar) progressBar.style.width = scrollHeight > 0 ? Math.min((scrollTop / scrollHeight) * 100, 100) + '%' : '0%';
        if(backToTopBtn) scrollTop > 400 ? backToTopBtn.classList.add('show') : backToTopBtn.classList.remove('show');
        scheduleScrollPositionSave();
        if (activeTermTrigger) hideTermTooltip();
        updateArticleReadingState();
    }, { passive: true });

    // أحداث النقر والتفاعل داخل المحتوى
    appContainer?.addEventListener('click', handleArticleAnchor);
    appContainer?.addEventListener('click', handleSmartTermClick);
    appContainer?.addEventListener('pointerover', handleSmartTermHover);
    appContainer?.addEventListener('pointerout', handleSmartTermLeave);
    appContainer?.addEventListener('focusin', handleSmartTermFocus);
    appContainer?.addEventListener('focusout', handleSmartTermBlur);
    document.body.addEventListener('click', createRipple);
    document.addEventListener('click', handleOutsideTermClick);
    backToTopBtn?.addEventListener('click', () => {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    // 🌟 دعم تثبيت التطبيق (PWA Install) 🌟
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('installAppBtn');
        if(installBtn) {
            installBtn.hidden = false;
            installBtn.classList.add('show');
        }
    });
    const installAppBtn = document.getElementById('installAppBtn');
    if(installAppBtn) {
        installAppBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    installAppBtn.hidden = true;
                    installAppBtn.classList.remove('show');
                }
                deferredPrompt = null;
            }
        });
    }
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        if (installAppBtn) {
            installAppBtn.hidden = true;
            installAppBtn.classList.remove('show');
        }
    });

    // 🌟 Lightbox عارض الصور 🌟
    document.body.addEventListener('click', (e) => {
        if(e.target.tagName === 'IMG' && e.target.closest('.img-wrapper')) {
            const lightboxImg = document.getElementById('lightboxImg');
            const lightboxCaption = document.getElementById('lightboxCaption');
            const lightboxModal = document.getElementById('lightboxModal');
            if(lightboxImg && lightboxModal) {
                lightboxImg.src = e.target.src;
                lightboxCaption.textContent = e.target.closest('.img-wrapper').querySelector('.img-caption')?.textContent || '';
                lightboxModal.classList.add('show');
                document.body.classList.add('modal-open');
            }
        }
    });
    document.getElementById('closeLightbox')?.addEventListener('click', closeLightbox);
    document.getElementById('lightboxModal')?.addEventListener('click', (e) => {
        if(e.target.id === 'lightboxModal') closeLightbox();
    });

    // 🌟 محرك البحث الحي (Full-text Search) 🌟
    const searchInput = document.getElementById('searchInput');
    if(searchInput) {
        searchInput.addEventListener('input', function() {
            window.clearTimeout(searchDebounceTimer);
            searchDebounceTimer = window.setTimeout(() => renderSearchResults(this.value), 120);
        });
    }
    document.getElementById('searchResults')?.addEventListener('click', handleSearchResultClick);
    document.getElementById('searchFilters')?.addEventListener('click', handleSearchFilterClick);
    document.getElementById('searchGlossaryLink')?.addEventListener('click', closeSearch);
});

// دوال فتح وإغلاق البحث وعارض الصور
async function openSearch() {
    const modal = document.getElementById('searchModal');
    if(modal) {
        if (document.getElementById('infoModal')?.classList.contains('show')) closeModal();
        lastFocusedElement = document.activeElement;
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        document.getElementById('searchToggle')?.setAttribute('aria-expanded', 'true');
        document.getElementById('bNavSearch')?.setAttribute('aria-expanded', 'true');
        syncBottomNav('bNavSearch');
        updateSearchLocalizedContent();
        const status = document.getElementById('searchStatus');
        if (status) status.textContent = currentLang === 'ar' ? 'جاري تجهيز فهرس البحث…' : 'Preparing the search index…';
        try {
            await ensureSearchIndex(currentLang);
            renderSearchFilters();
            if (status) status.textContent = '';
            const input = document.getElementById('searchInput');
            renderSearchResults(input?.value || '');
        } catch (error) {
            console.error('Search index failed:', error);
            if (status) status.textContent = currentLang === 'ar' ? 'تعذر تجهيز البحث الآن.' : 'Search is temporarily unavailable.';
        }
        setTimeout(() => document.getElementById('searchInput')?.focus(), 100);
    }
}
function closeSearch() {
    const modal = document.getElementById('searchModal');
    if(modal) {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        document.getElementById('searchToggle')?.setAttribute('aria-expanded', 'false');
        document.getElementById('bNavSearch')?.setAttribute('aria-expanded', 'false');
        if (window.location.hash === '' || window.location.hash === '#home') syncBottomNav('bNavHome');
        else syncBottomNav('none');
        if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
        lastFocusedElement = null;
    }
}

async function ensureSearchIndex(lang) {
    if (searchIndexCache[lang]) return searchIndexCache[lang];
    const response = await fetch(versionedDataUrl(`data/${lang}/search-index.json`));
    if (!response.ok) throw new Error(`Search index failed for ${lang}`);
    const index = (await response.json()).map(entry => ({
        ...entry,
        normalized: entry.normalized || normalizeSearchText(`${entry.chapterTitle} ${entry.tabTitle} ${entry.sectionTitle} ${entry.text}`)
    }));
    searchIndexCache[lang] = index;
    return index;
}

async function ensureGlossary(lang) {
    if (glossaryCache[lang]) return glossaryCache[lang];
    const response = await fetch(versionedDataUrl(`data/${lang}/glossary.json`));
    if (!response.ok) throw new Error(`Glossary failed for ${lang}`);
    const glossary = await response.json();
    glossaryCache[lang] = glossary;
    return glossary;
}

async function fetchChapterManifest(lang, chapterId) {
    chapterManifestCache[lang] ||= {};
    if (chapterManifestCache[lang][chapterId]) return chapterManifestCache[lang][chapterId];
    const response = await fetch(versionedDataUrl(`data/${lang}/${chapterId}.json`));
    if (!response.ok) throw new Error(`Chapter manifest failed for ${chapterId}`);
    const manifest = await response.json();
    chapterManifestCache[lang][chapterId] = manifest;
    return manifest;
}

async function fetchChapterTab(lang, chapterId, tab, tabIndex) {
    if (Array.isArray(tab.content_blocks)) return tab;
    const contentPath = tab.content_path || `${chapterId}/${tabIndex}.json`;
    const response = await fetch(versionedDataUrl(`data/${lang}/${contentPath}`));
    if (!response.ok) throw new Error(`Chapter tab failed for ${chapterId}-${tabIndex}`);
    return response.json();
}

function prefetchAdjacentTab(lang, chapterId, chapterData, tabIndex) {
    const nextTab = chapterData.tabs[tabIndex + 1];
    if (!nextTab || Array.isArray(nextTab.content_blocks) || navigator.connection?.saveData) return;
    const slowConnection = /(^|-)2g$/.test(navigator.connection?.effectiveType || '');
    if (slowConnection) return;
    const run = () => {
        const contentPath = nextTab.content_path || `${chapterId}/${tabIndex + 1}.json`;
        fetch(versionedDataUrl(`data/${lang}/${contentPath}`)).catch(() => {});
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 1800 });
    else window.setTimeout(run, 700);
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function renderSearchResults(query) {
    const resultsContainer = document.getElementById('searchResults');
    const status = document.getElementById('searchStatus');
    if (!resultsContainer) return;
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length < 2) {
        resultsContainer.innerHTML = `<div class="search-empty-state"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><p>${currentLang === 'ar' ? 'اكتب حرفين على الأقل لبدء البحث داخل المقالات.' : 'Type at least two characters to search the articles.'}</p></div>`;
        if (status) status.textContent = '';
        return;
    }
    const tokens = normalizedQuery.split(' ').filter(Boolean);
    const matches = (searchIndexCache[currentLang] || [])
        .filter(entry => searchActiveFilter === 'all' || `${entry.chapterId}-${entry.tabIndex}` === searchActiveFilter)
        .filter(entry => tokens.every(token => entry.normalized.includes(token)))
        .map(entry => {
            const title = normalizeSearchText(entry.sectionTitle);
            const tab = normalizeSearchText(entry.tabTitle);
            let score = tokens.reduce((total, token) => total + (title.includes(token) ? 12 : 0) + (tab.includes(token) ? 5 : 0), 0);
            if (title.includes(normalizedQuery)) score += 18;
            return { ...entry, score };
        })
        .sort((a, b) => b.score - a.score || a.tabIndex - b.tabIndex || a.sectionIndex - b.sectionIndex)
        .slice(0, 12);
    if (status) status.textContent = matches.length
        ? `${matches.length} ${currentLang === 'ar' ? 'نتيجة' : matches.length === 1 ? 'result' : 'results'}`
        : '';
    if (!matches.length) {
        resultsContainer.innerHTML = `<div class="no-results"><i class="fas fa-seedling" aria-hidden="true"></i><strong>${currentLang === 'ar' ? 'لم نجد نتيجة مطابقة' : 'No matching result found'}</strong><p>${currentLang === 'ar' ? 'جرّب كلمة أقصر أو مصطلحًا علميًا آخر.' : 'Try a shorter phrase or another scientific term.'}</p></div>`;
        return;
    }
    resultsContainer.innerHTML = matches.map(entry => `
        <button type="button" class="search-result-item ripple-btn" data-search-route="${escapeHtml(entry.chapterId)}-${entry.tabIndex}" data-search-target="doc-section-${entry.sectionIndex}">
            <span class="search-result-copy">
                <span class="search-result-meta"><i class="fas fa-book-open" aria-hidden="true"></i>${escapeHtml(entry.tabTitle)}</span>
                <strong>${highlightSearchMatch(entry.sectionTitle, query)}</strong>
                <small>${highlightSearchMatch(createSearchSnippet(entry.text, query), query)}</small>
            </span>
            <i class="fas fa-arrow-left search-result-arrow" aria-hidden="true"></i>
        </button>`).join('');
}

function createSearchSnippet(text, query) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const directIndex = clean.toLowerCase().indexOf(String(query || '').trim().toLowerCase());
    const start = directIndex > 55 ? directIndex - 55 : 0;
    const snippet = clean.slice(start, start + 175);
    return `${start > 0 ? '…' : ''}${snippet}${start + 175 < clean.length ? '…' : ''}`;
}

function highlightSearchMatch(value, query) {
    const escaped = escapeHtml(value);
    const direct = String(query || '').trim();
    if (!direct) return escaped;
    return escaped.replace(new RegExp(`(${escapeRegExp(direct)})`, 'giu'), '<mark>$1</mark>');
}

function highlightArticleSearch(query, target) {
    if (!target || !query) return;
    const tokens = [...new Set(String(query).trim().split(/\s+/).filter(token => token.length >= 2))];
    if (!tokens.length) return;
    const pattern = new RegExp(`(${tokens.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|')})`, 'giu');
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (!parent?.closest('mark, script, style')) textNodes.push(walker.currentNode);
    }
    let firstHit = true;
    textNodes.forEach(node => {
        const source = node.nodeValue || '';
        pattern.lastIndex = 0;
        if (!pattern.test(source)) return;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        source.split(pattern).forEach((part, index) => {
            if (index % 2 === 0) fragment.append(document.createTextNode(part));
            else {
                const mark = document.createElement('mark');
                mark.className = `article-search-hit${firstHit ? ' current' : ''}`;
                mark.textContent = part;
                fragment.append(mark);
                firstHit = false;
            }
        });
        node.replaceWith(fragment);
    });
}

function handleSearchResultClick(event) {
    const result = event.target.closest('[data-search-route]');
    if (!result) return;
    const route = result.dataset.searchRoute;
    pendingSearchScroll = { route, target: result.dataset.searchTarget, query: document.getElementById('searchInput')?.value || '' };
    closeSearch();
    if (window.location.hash === `#${route}`) handleRouting();
    else window.location.hash = route;
}

function renderSearchFilters() {
    const container = document.getElementById('searchFilters');
    if (!container) return;
    const routes = new Map();
    (searchIndexCache[currentLang] || []).forEach(entry => {
        const route = `${entry.chapterId}-${entry.tabIndex}`;
        if (!routes.has(route)) routes.set(route, entry.tabTitle);
    });
    if (searchActiveFilter !== 'all' && !routes.has(searchActiveFilter)) searchActiveFilter = 'all';
    const allLabel = currentLang === 'ar' ? 'كل الفصول' : 'All chapters';
    container.innerHTML = `
        <button type="button" class="search-filter-chip ${searchActiveFilter === 'all' ? 'active' : ''}" data-search-filter="all" aria-pressed="${searchActiveFilter === 'all'}">${allLabel}</button>
        ${[...routes.entries()].map(([route, title]) => `<button type="button" class="search-filter-chip ${searchActiveFilter === route ? 'active' : ''}" data-search-filter="${escapeHtml(route)}" aria-pressed="${searchActiveFilter === route}">${escapeHtml(title)}</button>`).join('')}`;
}

function handleSearchFilterClick(event) {
    const filter = event.target.closest('[data-search-filter]');
    if (!filter) return;
    searchActiveFilter = filter.dataset.searchFilter;
    renderSearchFilters();
    renderSearchResults(document.getElementById('searchInput')?.value || '');
}

function updateSearchLocalizedContent() {
    const isArabic = currentLang === 'ar';
    const title = document.getElementById('searchModalTitle');
    const hint = document.getElementById('searchModalHint');
    const input = document.getElementById('searchInput');
    const tooltipLabel = document.getElementById('termTooltipLabel');
    const filterLabel = document.getElementById('searchFilterLabel');
    const filterGroup = document.getElementById('searchFilters');
    const glossaryLink = document.getElementById('searchGlossaryLink');
    if (title) title.textContent = isArabic ? 'ابحث داخل الموسوعة' : 'Search the encyclopedia';
    if (hint) hint.textContent = isArabic ? 'اكتب مصطلحًا أو موضوعًا للوصول مباشرة إلى المحور المطلوب' : 'Enter a term or topic to jump directly to the relevant section';
    if (input) input.placeholder = isArabic ? 'ابحث عن البريكس، الليكوبين، IRAC...' : 'Search for Brix, lycopene, IRAC...';
    if (tooltipLabel) tooltipLabel.textContent = isArabic ? 'مصطلح علمي' : 'Scientific term';
    if (filterLabel) filterLabel.textContent = isArabic ? 'تصفية حسب الفصل' : 'Filter by chapter';
    if (filterGroup) filterGroup.setAttribute('aria-label', isArabic ? 'تصفية نتائج البحث حسب الفصل' : 'Filter search results by chapter');
    if (glossaryLink) glossaryLink.querySelector('span').textContent = isArabic ? 'دليل المصطلحات' : 'Terminology guide';
    if (searchIndexCache[currentLang]) renderSearchFilters();
}
function closeLightbox() {
    const modal = document.getElementById('lightboxModal');
    if(modal) {
        modal.classList.remove('show');
        document.body.classList.remove('modal-open');
    }
}

// إنشاء تأثير الموجة للأزرار
function createRipple(e) {
    const target = e.target.closest('.ripple-btn');
    if (!target) return;
    const circle = document.createElement('span');
    const diameter = Math.max(target.clientWidth, target.clientHeight);
    const radius = diameter / 2;
    const rect = target.getBoundingClientRect();
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${e.clientX - rect.left - radius}px`;
    circle.style.top = `${e.clientY - rect.top - radius}px`;
    circle.classList.add('ripple');
    const existingRipple = target.querySelector('.ripple');
    if (existingRipple) existingRipple.remove();
    target.appendChild(circle);
}

function scheduleScrollPositionSave() {
    if (!renderedRoute || scrollSaveFrame) return;
    scrollSaveFrame = requestAnimationFrame(() => {
        scrollSaveFrame = 0;
        saveCurrentScrollPosition();
    });
}

function saveCurrentScrollPosition() {
    if (!renderedRoute) return;
    sessionStorage.setItem(`agripedia-scroll:${currentLang}:${renderedRoute}`, String(Math.max(0, Math.round(window.scrollY))));
}

function getSavedScrollPosition(route) {
    const saved = Number(sessionStorage.getItem(`agripedia-scroll:${currentLang}:${route}`));
    return Number.isFinite(saved) && saved >= 0 ? saved : 0;
}

function restoreScrollPosition(route) {
    const top = getSavedScrollPosition(route);
    requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }));
}

function centerScrollableItem(container, item, behavior = 'smooth') {
    if (!container || !item) return;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const delta = ((itemRect.left + itemRect.right) / 2) - ((containerRect.left + containerRect.right) / 2);
    if (Math.abs(delta) > 4) container.scrollBy({ left: delta, behavior });
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW Failed:', err));
    }
}

function handleRouting() {
    if(!appDataIndex) return;
    let hash = window.location.hash.replace('#', '');
    if (!hash || hash === 'home') {
        latestChapterRequest++;
        renderHome(appDataIndex.home);
        syncBottomNav('bNavHome');
        if (window.innerWidth <= 768) closeSidebar();
    } else if (hash === 'glossary') {
        loadGlossaryPage();
        syncBottomNav('none');
    } else {
        const routeMatch = hash.match(/^(.+)-(\d+)$/);
        if (!routeMatch || !getValidChapterIds().has(routeMatch[1])) {
            latestChapterRequest++;
            renderRouteError();
            return;
        }
        const chap = routeMatch[1];
        const tab = Number(routeMatch[2]);
        loadChapter(chap, tab);
        syncBottomNav('none');
    }
}

function handleArticleAnchor(event) {
    const referenceCopy = event.target.closest('[data-reference-copy]');
    if (referenceCopy) {
        const label = referenceCopy.querySelector('span');
        const original = referenceCopy.dataset.copyLabel || label?.textContent || '';
        copyArticleLink(referenceCopy.dataset.referenceCopy || '').then(copied => {
            if (label) label.textContent = copied
                ? (currentLang === 'ar' ? 'تم نسخ المرجع' : 'Reference copied')
                : (currentLang === 'ar' ? 'تعذر النسخ' : 'Copy failed');
            window.setTimeout(() => { if (label) label.textContent = original; }, 1800);
        });
        return;
    }

    const listToggle = event.target.closest('[data-list-toggle]');
    if (listToggle) {
        const list = document.getElementById(listToggle.dataset.listToggle);
        if (!list) return;
        const expanded = listToggle.getAttribute('aria-expanded') === 'true';
        const newExpanded = !expanded;
        list.querySelectorAll('[data-extra-item]').forEach(item => { item.hidden = !newExpanded; });
        listToggle.setAttribute('aria-expanded', String(newExpanded));
        listToggle.querySelector('span').textContent = newExpanded
            ? (currentLang === 'ar' ? 'عرض أقل' : 'Show less')
            : `${currentLang === 'ar' ? 'عرض المزيد' : 'Show more'} (+${listToggle.dataset.extraCount})`;
        return;
    }

    const action = event.target.closest('[data-article-action]');
    if (action) {
        const article = action.closest('.doc-article');
        if (!article) return;
        const actionName = action.dataset.articleAction;
        if (actionName === 'font-increase' || actionName === 'font-decrease') {
            const currentScale = Number(article.dataset.fontScale || 100);
            const change = actionName === 'font-increase' ? 1 : -1;
            const newScale = Math.min(Math.max(currentScale + change, 50), 150);
            article.dataset.fontScale = String(newScale);
            localStorage.setItem('articleFontScale', String(newScale));
            updateArticleFontControls(article);
        } else if (actionName === 'reading-focus') {
            setReadingFocus(!document.body.classList.contains('reading-focus'));
        } else if (actionName === 'print') {
            window.print();
        } else if (actionName === 'copy-link') {
            const shareMenu = action.closest('.doc-share-menu');
            const status = shareMenu?.querySelector('.doc-share-status');
            const copyLabel = action.querySelector('span');
            const originalLabel = action.dataset.copyLabel || copyLabel?.textContent || '';
            copyArticleLink(action.dataset.shareUrl || window.location.href).then(copied => {
                const message = copied
                    ? (currentLang === 'ar' ? 'تم نسخ الرابط' : 'Link copied')
                    : (currentLang === 'ar' ? 'تعذر نسخ الرابط' : 'Could not copy link');
                if (status) status.textContent = message;
                if (copyLabel) copyLabel.textContent = message;
                window.setTimeout(() => {
                    if (status) status.textContent = '';
                    if (copyLabel) copyLabel.textContent = originalLabel;
                }, 1800);
            });
        }
        return;
    }

    const selectedPart = event.target.closest('[data-doc-part-select]');
    if (selectedPart) {
        const partArticle = selectedPart.closest('.doc-article');
        if (partArticle) activateDocPart(partArticle, Number(selectedPart.dataset.docPartSelect));
    }

    const link = event.target.closest('[data-scroll-target]');
    if (!link) return;
    event.preventDefault();
    const article = link.closest('.doc-article');
    const target = article?.querySelector(`#${link.dataset.scrollTarget}`) || document.getElementById(link.dataset.scrollTarget);
    if (!target) return;
    const targetPart = target.closest('[data-doc-part-index]');
    if (article && targetPart?.hidden) activateDocPart(article, Number(targetPart.dataset.docPartIndex));
    const collapsedParent = target.closest('details:not([open])');
    if (collapsedParent) collapsedParent.open = true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));
}

async function copyArticleLink(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Continue to the selection-based fallback below.
        }
    }
    try {
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        return copied;
    } catch {
        return false;
    }
}

function getValidChapterIds() {
    return new Set(appDataIndex.sidebar.flatMap(group => group.links)
        .filter(link => !link.disabled)
        .map(link => link.target));
}

function renderRouteError() {
    renderedRoute = '';
    setReadingFocus(false, false);
    const isArabic = currentLang === 'ar';
    document.title = `${isArabic ? 'الصفحة غير موجودة' : 'Page not found'} | AgriPedia Egypt`;
    appContainer.innerHTML = `
        <section class="error-state" role="alert">
            <i class="fas fa-map-signs" aria-hidden="true"></i>
            <h2>${isArabic ? 'الصفحة المطلوبة غير موجودة' : 'The requested page was not found'}</h2>
            <p>${isArabic ? 'قد يكون الرابط غير صحيح أو أن هذا القسم لم يُضف بعد.' : 'The link may be invalid, or this section has not been added yet.'}</p>
            <a class="nav-btn ripple-btn" href="#home">${isArabic ? 'العودة إلى الرئيسية' : 'Return home'}</a>
        </section>`;
    updateActiveSidebarLink('none');
    syncBottomNav('none');
}

function renderLoadError() {
    const isArabic = currentLang === 'ar';
    document.title = `${isArabic ? 'تعذر تحميل المحتوى' : 'Unable to load content'} | AgriPedia Egypt`;
    appContainer.innerHTML = `
        <section class="error-state" role="alert">
            <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
            <h2>${isArabic ? 'تعذر تحميل المحتوى' : 'Unable to load content'}</h2>
            <p>${isArabic ? 'تحقق من الاتصال ثم أعد المحاولة.' : 'Check your connection and try again.'}</p>
            <button class="nav-btn ripple-btn" type="button" id="retryLoadBtn">${isArabic ? 'إعادة المحاولة' : 'Try again'}</button>
        </section>`;
    document.getElementById('retryLoadBtn')?.addEventListener('click', () => {
        if (appDataIndex) handleRouting();
        else loadIndex().then(handleRouting);
    });
}

function openModal() {
    const modal = document.getElementById('infoModal');
    if (!modal || modal.classList.contains('show')) return;
    if (document.getElementById('searchModal')?.classList.contains('show')) closeSearch();
    lastFocusedElement = document.activeElement;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('infoToggleDesktop')?.setAttribute('aria-expanded', 'true');
    document.getElementById('bNavInfo')?.setAttribute('aria-expanded', 'true');
    document.getElementById('closeModal')?.focus();
}

function closeModal() {
    const modal = document.getElementById('infoModal');
    if (!modal || !modal.classList.contains('show')) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    document.getElementById('infoToggleDesktop')?.setAttribute('aria-expanded', 'false');
    document.getElementById('bNavInfo')?.setAttribute('aria-expanded', 'false');
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
    lastFocusedElement = null;
}

function toggleModal() {
    const modal = document.getElementById('infoModal');
    if(modal) {
        modal.classList.contains('show') ? closeModal() : openModal();
    }
}

function handleGlobalKeydown(event) {
    const modal = document.getElementById('infoModal');
    const searchModal = document.getElementById('searchModal');

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (searchModal?.classList.contains('show')) closeSearch();
        else openSearch();
        return;
    }
    
    if (event.key === 'Escape') {
        if (activeTermTrigger) hideTermTooltip();
        else if (modal?.classList.contains('show')) closeModal();
        else if (searchModal?.classList.contains('show')) closeSearch();
        else if (document.getElementById('sidebar')?.classList.contains('open')) closeSidebar(true);
        else if (document.getElementById('lightboxModal')?.classList.contains('show')) closeLightbox();
        else if (document.body.classList.contains('reading-focus')) setReadingFocus(false);
        return;
    }
    
    const activeModal = modal?.classList.contains('show') ? modal : searchModal?.classList.contains('show') ? searchModal : null;
    if (!activeModal || event.key !== 'Tab') return;
    const focusable = [...activeModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', currentTheme);
    applyTheme(currentTheme);
}

function applyTheme(theme) {
    const themeBtn = document.getElementById('themeToggle');
    const bNavThemeIcon = document.getElementById('bNavThemeIcon');
    if (theme === 'light') {
        document.body.classList.add('light-mode');
        if(themeBtn) themeBtn.innerHTML = '<i class="fas fa-moon" aria-hidden="true"></i>';
        if(bNavThemeIcon) bNavThemeIcon.className = 'fas fa-moon';
    } else {
        document.body.classList.remove('light-mode');
        if(themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun" aria-hidden="true"></i>';
        if(bNavThemeIcon) bNavThemeIcon.className = 'fas fa-sun';
    }
    const isDark = theme === 'dark';
    if(themeBtn) themeBtn.setAttribute('aria-pressed', String(isDark));
    const bNavTheme = document.getElementById('bNavTheme');
    if(bNavTheme) bNavTheme.setAttribute('aria-pressed', String(isDark));
    updateLocalizedLabels();
}

function toggleLanguage() {
    saveCurrentScrollPosition();
    renderedRoute = '';
    latestChapterRequest++;
    currentLang = currentLang === 'ar' ? 'en' : 'ar';
    localStorage.setItem('lang', currentLang);
    applyLanguage(currentLang);
    loadIndex().then(() => handleRouting());
}

function applyLanguage(lang) {
    const html = document.documentElement;
    const langToggle = document.getElementById('langToggle');
    const title = document.getElementById('headerTitle');
    const arTexts = document.querySelectorAll('.ar-txt');
    const enTexts = document.querySelectorAll('.en-txt');

    if (lang === 'en') {
        html.setAttribute('dir', 'ltr');
        html.setAttribute('lang', 'en');
        document.body.classList.add('en');
        if(langToggle) langToggle.dataset.active = 'en';
        if(title) title.innerText = 'AgriPedia Egypt';
        arTexts.forEach(el => el.style.display = 'none');
        enTexts.forEach(el => el.style.display = 'block');
    } else {
        html.setAttribute('dir', 'rtl');
        html.setAttribute('lang', 'ar');
        document.body.classList.remove('en');
        if(langToggle) langToggle.dataset.active = 'ar';
        if(title) title.innerText = 'AgriPedia Egypt';
        enTexts.forEach(el => el.style.display = 'none');
        arTexts.forEach(el => el.style.display = 'block');
    }
    hideTermTooltip();
    updateSearchLocalizedContent();
    updateLocalizedLabels();
    updateReadingModeLocalizedContent();
}

function updateReadingModeLocalizedContent() {
    const isArabic = currentLang === 'ar';
    const exitButton = document.getElementById('exitReadingMode');
    const toast = document.getElementById('readingModeToast');
    const exitLabel = isArabic ? 'خروج' : 'Exit';
    const exitAriaLabel = isArabic ? 'خروج من وضع القراءة' : 'Exit reading mode';
    if (exitButton) {
        exitButton.setAttribute('aria-label', exitAriaLabel);
        exitButton.querySelector('span').textContent = exitLabel;
    }
    if (toast) toast.querySelector('span').textContent = isArabic
        ? 'وضع القراءة مفعل — Esc للخروج'
        : 'Reading mode on — Esc to exit';
}

function setReadingFocus(enabled, announce = true) {
    document.body.classList.toggle('reading-focus', enabled);
    document.querySelectorAll('[data-article-action="reading-focus"]').forEach(button => button.setAttribute('aria-pressed', String(enabled)));
    const exitButton = document.getElementById('exitReadingMode');
    const toast = document.getElementById('readingModeToast');
    if (exitButton) exitButton.hidden = !enabled;
    window.clearTimeout(readingToastTimer);
    if (!toast) return;
    toast.hidden = !enabled || !announce;
    toast.classList.toggle('show', enabled && announce);
    if (enabled && announce) {
        readingToastTimer = window.setTimeout(() => {
            toast.classList.remove('show');
            window.setTimeout(() => { if (!toast.classList.contains('show')) toast.hidden = true; }, 250);
        }, 2600);
    }
}

function updateLocalizedLabels() {
    const isArabic = currentLang === 'ar';
    const isDark = currentTheme === 'dark';
    const labels = isArabic ? {
        menu: 'فتح فهرس المحتويات', home: 'الذهاب إلى الرئيسية', info: 'معلومات التواصل', search: 'البحث في الموسوعة', closeSearch: 'إغلاق البحث',
        theme: isDark ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن', lang: 'Switch to English',
        top: 'العودة لأعلى', install: 'تثبيت التطبيق', close: 'إغلاق نافذة التواصل', sidebar: 'فهرس المحتويات', nav: 'التنقل الرئيسي', modal: 'معلومات التواصل'
    } : {
        menu: 'Open table of contents', home: 'Go to home', info: 'Contact information', search: 'Search the encyclopedia', closeSearch: 'Close search',
        theme: isDark ? 'Switch to light mode' : 'Switch to dark mode', lang: 'التبديل إلى العربية',
        top: 'Back to top', install: 'Install app', close: 'Close contact dialog', sidebar: 'Table of contents', nav: 'Main navigation', modal: 'Contact information'
    };
    
    const setAttr = (id, attr, value) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, value); };
    setAttr('menuToggle', 'aria-label', labels.menu);
    setAttr('goHomeBtn', 'aria-label', labels.home);
    setAttr('headerTitle', 'aria-label', labels.home);
    setAttr('infoToggleDesktop', 'aria-label', labels.info);
    setAttr('searchToggle', 'aria-label', labels.search);
    setAttr('themeToggle', 'aria-label', labels.theme);
    setAttr('langToggle', 'aria-label', labels.lang);
    setAttr('back-to-top', 'aria-label', labels.top);
    setAttr('installAppBtn', 'aria-label', labels.install);
    const topBtn = document.getElementById('back-to-top');
    if(topBtn) topBtn.title = labels.top;
    const installBtn = document.getElementById('installAppBtn');
    if(installBtn) installBtn.title = labels.install;
    setAttr('closeModal', 'aria-label', labels.close);
    setAttr('closeSearchModal', 'aria-label', labels.closeSearch);
    setAttr('sidebar', 'aria-label', labels.sidebar);
    setAttr('bottomNav', 'aria-label', labels.nav);
    setAttr('infoModal', 'aria-label', labels.modal);
    setAttr('searchModal', 'aria-label', labels.search);
    const searchBtn = document.getElementById('searchToggle');
    if(searchBtn) searchBtn.title = labels.search;
}

function syncBottomNav(activeId) {
    document.querySelectorAll('.b-nav-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.removeAttribute('aria-current');
    });
    if(activeId !== 'none' && document.getElementById(activeId)) {
        document.getElementById(activeId).classList.add('active');
        document.getElementById(activeId).setAttribute('aria-current', 'page');
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if(sidebar) sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
}

function openSidebar() {
    document.getElementById('sidebar')?.classList.add('open');
    document.getElementById('sidebar')?.setAttribute('aria-hidden', 'false');
    document.getElementById('sidebarOverlay')?.classList.add('open');
    document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'true');
    document.getElementById('bNavMenu')?.setAttribute('aria-expanded', 'true');
    syncBottomNav('bNavMenu');
}

function closeSidebar(restoreFocus = false) {
    const sidebar = document.getElementById('sidebar');
    if(!sidebar) return;
    const wasOpen = sidebar.classList.contains('open');
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
    document.getElementById('sidebarOverlay')?.classList.remove('open');
    document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('bNavMenu')?.setAttribute('aria-expanded', 'false');
    if (window.location.hash === '' || window.location.hash === '#home') syncBottomNav('bNavHome');
    else syncBottomNav('none');
    if (restoreFocus && wasOpen) document.getElementById('menuToggle')?.focus();
}

window.toggleAccordion = function(element) {
    const isOpen = element.parentElement.classList.toggle('active');
    element.setAttribute('aria-expanded', String(isOpen));
};

function showSkeletonLoader() {
    let skeletonHtml = `
        <div class="container content-wrapper" style="padding-top:2rem;">
            <div class="skeleton sk-title"></div>
            <div class="skeleton sk-text"></div>
            <div class="skeleton sk-text short" style="margin-bottom:3rem;"></div>
            <div class="chapter-grid">
                <div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>
            </div>
        </div>`;
    appContainer.innerHTML = skeletonHtml;
}

async function loadIndex() {
    if (!appDataIndex) showSkeletonLoader();
    const requestedLang = currentLang;
    try {
        const response = await fetch(versionedDataUrl(`data/${requestedLang}/index.json`));
        if (!response.ok) throw new Error('Network error');
        const loadedIndex = await response.json();
        if (requestedLang !== currentLang) return;
        appDataIndex = loadedIndex;
        renderSidebar(appDataIndex.sidebar);
    } catch (error) {
        console.error("Error loading index:", error);
        if (requestedLang === currentLang) renderLoadError();
    }
}

async function loadChapter(chapterId, tabIndex = 0) {
    const requestId = ++latestChapterRequest;
    const requestedLang = currentLang;
    saveCurrentScrollPosition();
    renderedRoute = '';
    showSkeletonLoader();
    try {
        const [chapterData, glossary] = await Promise.all([
            fetchChapterManifest(requestedLang, chapterId),
            ensureGlossary(requestedLang)
        ]);
        if (requestId !== latestChapterRequest) return;
        currentGlossary = glossary;
        if (!Array.isArray(chapterData.tabs) || !Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex >= chapterData.tabs.length) {
            renderRouteError();
            return;
        }
        activeTabs[chapterId] = tabIndex;
        activeTabs[chapterId + "_total"] = chapterData.tabs.length; 
        const activeTabData = await fetchChapterTab(requestedLang, chapterId, chapterData.tabs[tabIndex], tabIndex);
        if (requestId !== latestChapterRequest) return;
        renderChapter(chapterData, tabIndex, activeTabData);
        prefetchAdjacentTab(requestedLang, chapterId, chapterData, tabIndex);
    } catch (error) {
        if (requestId !== latestChapterRequest) return;
        console.error(`Error loading ${chapterId}:`, error);
        renderLoadError();
    }
}

function renderSidebar(sidebarData) {
    let html = `<div class="home-link-wrap"><a href="#home" class="active ripple-btn" id="nav-home"><i class="fas fa-home"></i> <span>${currentLang === 'ar' ? 'الرئيسية' : 'Home'}</span></a></div>
        <div class="home-link-wrap glossary-nav-wrap"><a href="#glossary" class="ripple-btn" id="nav-glossary"><i class="fas fa-spell-check"></i> <span>${currentLang === 'ar' ? 'دليل المصطلحات العلمية' : 'Scientific terminology guide'}</span></a></div>`;
    sidebarData.forEach((group) => {
        html += `
        <div class="chapter-group ${group.is_active ? 'active' : ''}">
            <button class="chapter-header ripple-btn" type="button" onclick="toggleAccordion(this)" aria-expanded="${group.is_active ? 'true' : 'false'}">
                <span class="title-wrap"><i class="${group.icon}" aria-hidden="true"></i><span>${group.title}</span></span>
                <i class="fas fa-chevron-down arrow" aria-hidden="true"></i>
            </button>
            <ul class="chapter-links">
                ${group.links.map((link, idx) => link.disabled
                    ? `<li><span class="disabled" aria-disabled="true"><span>${link.text}</span></span></li>`
                    : `<li><a href="#${link.target}-${idx}" class="ripple-btn"><span>${link.text}</span></a></li>`).join('')}
            </ul>
        </div>`;
    });
    sidebarContainer.innerHTML = html;
}

async function loadGlossaryPage() {
    const requestId = ++latestChapterRequest;
    const requestedLang = currentLang;
    saveCurrentScrollPosition();
    renderedRoute = '';
    setReadingFocus(false, false);
    showSkeletonLoader();
    try {
        const glossary = await ensureGlossary(requestedLang);
        if (requestId !== latestChapterRequest || requestedLang !== currentLang) return;
        currentGlossary = glossary;
        renderGlossaryPage(glossary);
    } catch (error) {
        if (requestId !== latestChapterRequest) return;
        console.error('Glossary page failed:', error);
        renderLoadError();
    }
}

function renderGlossaryPage(glossary) {
    const isArabic = currentLang === 'ar';
    const labels = isArabic ? {
        eyebrow: 'المعجم الزراعي التفاعلي', title: 'دليل المصطلحات العلمية',
        lead: 'تعريفات مختصرة وواضحة للمصطلحات العلمية والفنية المستخدمة داخل الموسوعة.',
        search: 'ابحث باسم المصطلح أو الاختصار أو داخل التعريف…', count: 'مصطلحًا',
        aliases: 'يظهر أيضًا باسم', empty: 'لا توجد مصطلحات مطابقة لبحثك.'
    } : {
        eyebrow: 'Interactive agricultural glossary', title: 'Scientific terminology guide',
        lead: 'Clear, concise definitions of the scientific and technical terms used throughout the encyclopedia.',
        search: 'Search by term, abbreviation, or definition…', count: 'terms',
        aliases: 'Also appears as', empty: 'No terms match your search.'
    };
    const sorted = [...glossary].sort((a, b) => a.term.localeCompare(b.term, currentLang === 'ar' ? 'ar' : 'en'));
    document.title = `${labels.title} | AgriPedia Egypt`;
    appContainer.innerHTML = `
        <section class="content-section active glossary-page" aria-labelledby="glossaryPageTitle">
            <header class="glossary-hero">
                <span class="glossary-hero-icon"><i class="fas fa-spell-check" aria-hidden="true"></i></span>
                <div><span class="glossary-eyebrow">${labels.eyebrow}</span><h2 id="glossaryPageTitle">${labels.title}</h2><p>${labels.lead}</p></div>
            </header>
            <div class="glossary-search-panel">
                <label for="glossarySearch"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><input id="glossarySearch" type="search" autocomplete="off" placeholder="${labels.search}"></label>
                <strong id="glossaryCount" aria-live="polite">${sorted.length} ${labels.count}</strong>
            </div>
            <div class="glossary-grid" id="glossaryGrid"></div>
        </section>`;

    const renderCards = (query = '') => {
        const normalizedQuery = normalizeSearchText(query);
        const filtered = sorted.filter(entry => !normalizedQuery || normalizeSearchText([entry.term, entry.scientific, entry.definition, ...(entry.aliases || [])].join(' ')).includes(normalizedQuery));
        const grid = document.getElementById('glossaryGrid');
        const count = document.getElementById('glossaryCount');
        if (count) count.textContent = `${filtered.length} ${labels.count}`;
        if (!grid) return;
        grid.innerHTML = filtered.length ? filtered.map((entry, index) => `
            <article class="glossary-card" id="term-${escapeHtml(entry.id)}">
                <span class="glossary-card-number">${String(index + 1).padStart(2, '0')}</span>
                <h3>${highlightSearchMatch(entry.term, query)}</h3>
                ${entry.scientific ? `<strong>${highlightSearchMatch(entry.scientific, query)}</strong>` : ''}
                <p>${highlightSearchMatch(entry.definition, query)}</p>
                ${(entry.aliases || []).length ? `<div class="glossary-aliases"><span>${labels.aliases}</span>${entry.aliases.slice(0, 5).map(alias => `<small>${highlightSearchMatch(alias, query)}</small>`).join('')}</div>` : ''}
            </article>`).join('') : `<div class="glossary-empty"><i class="fas fa-seedling" aria-hidden="true"></i><p>${labels.empty}</p></div>`;
    };
    renderCards();
    document.getElementById('glossarySearch')?.addEventListener('input', event => renderCards(event.target.value));
    updateActiveSidebarLink('glossary');
    renderedRoute = 'glossary';
    restoreScrollPosition(renderedRoute);
    if (window.innerWidth <= 768) closeSidebar();
}

function renderHome(homeData) {
    setReadingFocus(false, false);
    document.title = "AgriPedia Egypt | الموسوعة الزراعية"; 
    let html = `
        <section class="content-section active home-page">
            <section class="home-hero home-reveal" aria-labelledby="home-hero-title">
                <div class="home-hero-copy">
                    <span class="home-eyebrow"><i class="fas fa-location-dot" aria-hidden="true"></i>${homeData.hero.eyebrow}</span>
                    <h2 class="home-hero-title" id="home-hero-title">${homeData.hero.title}</h2>
                    <p class="home-hero-subtitle">${homeData.hero.subtitle}</p>
                    <p class="home-hero-lead">${homeData.hero.text}</p>
                    <div class="home-hero-actions">
                        <button class="home-primary-btn ripple-btn" type="button" data-home-scroll="home-library"><span>${homeData.hero.primary_cta}</span><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                        <button class="home-secondary-btn ripple-btn" type="button" data-home-scroll="home-about"><span>${homeData.hero.secondary_cta}</span><i class="fas fa-compass" aria-hidden="true"></i></button>
                    </div>
                </div>
                <div class="home-hero-visual" aria-hidden="true">
                    <div class="home-orbit orbit-one"><span><i class="fas fa-seedling"></i></span></div>
                    <div class="home-orbit orbit-two"><span><i class="fas fa-droplet"></i></span></div>
                    <div class="home-visual-core"><i class="fas fa-wheat-awn"></i><strong>AgriPedia</strong><small>Egypt</small></div>
                    ${homeData.hero.visual_tags.map((tag, index) => `<span class="home-visual-tag tag-${index + 1}">${tag}</span>`).join('')}
                </div>
            </section>

            <section class="home-pillars home-reveal" aria-label="${homeData.pillars_label}">
                ${homeData.pillars.map(item => `<article class="home-pillar"><i class="${item.icon}" aria-hidden="true"></i><div><strong>${item.title}</strong><span>${item.text}</span></div></article>`).join('')}
            </section>

            <section class="home-story home-reveal" id="home-about">
                <div class="home-section-heading">
                    <span>${homeData.about.kicker}</span>
                    <h2>${homeData.about.title}</h2>
                </div>
                <div class="home-story-grid">
                    <div class="home-story-index"><strong>01</strong><i class="fas fa-microscope" aria-hidden="true"></i><span>${homeData.about.side_note}</span></div>
                    <div class="home-story-copy">${homeData.about.paragraphs.map(text => `<p>${text}</p>`).join('')}</div>
                </div>
            </section>

            <section class="home-journey home-reveal">
                <div class="home-section-heading centered">
                    <span>${homeData.journey.kicker}</span>
                    <h2>${homeData.journey.title}</h2>
                    <p>${homeData.journey.text}</p>
                </div>
                <div class="home-journey-track">
                    ${homeData.journey.steps.map((step, index) => `<article class="home-journey-step"><span class="step-number">${String(index + 1).padStart(2, '0')}</span><i class="${step.icon}" aria-hidden="true"></i><h3>${step.title}</h3><p>${step.text}</p></article>`).join('')}
                </div>
            </section>

            <section class="home-practice home-reveal">
                <div class="home-practice-copy">
                    <span class="home-mini-label">${homeData.practice.kicker}</span>
                    <h2>${homeData.practice.title}</h2>
                    <p>${homeData.practice.text}</p>
                </div>
                <div class="home-practice-grid">
                    ${homeData.practice.tools.map(tool => `<article><i class="${tool.icon}" aria-hidden="true"></i><strong>${tool.title}</strong><span>${tool.text}</span></article>`).join('')}
                </div>
            </section>

            <section class="home-impact home-reveal">
                <div class="home-section-heading">
                    <span>${homeData.impact.kicker}</span>
                    <h2>${homeData.impact.title}</h2>
                    <p>${homeData.impact.text}</p>
                </div>
                <div class="home-impact-grid">
                    ${homeData.impact.items.map(item => `<article><i class="${item.icon}" aria-hidden="true"></i><strong>${item.title}</strong><span>${item.text}</span></article>`).join('')}
                </div>
            </section>

            <section class="home-principles home-reveal">
                <div class="home-section-heading centered">
                    <span>${homeData.principles.kicker}</span>
                    <h2>${homeData.principles.title}</h2>
                    <p>${homeData.principles.text}</p>
                </div>
                <div class="home-principles-grid">
                    ${homeData.principles.items.map((item, index) => `<article><span>${String(index + 1).padStart(2, '0')}</span><i class="${item.icon}" aria-hidden="true"></i><h3>${item.title}</h3><p>${item.text}</p></article>`).join('')}
                </div>
            </section>

            <section class="home-audience home-reveal">
                <div><span class="home-mini-label">${homeData.audience.kicker}</span><h2>${homeData.audience.title}</h2><p>${homeData.audience.text}</p></div>
                <div class="home-audience-list">${homeData.audience.items.map(item => `<span><i class="${item.icon}" aria-hidden="true"></i>${item.text}</span>`).join('')}</div>
            </section>

            <section class="home-library home-reveal" id="home-library">
                <div class="home-section-heading">
                    <span>${homeData.library.kicker}</span>
                    <h2>${homeData.library.title}</h2>
                    <p>${homeData.library.text}</p>
                </div>
                <div class="chapter-grid home-chapter-grid">
                ${homeData.cards.map(card => card.disabled ? `
                    <div class="chapter-card disabled" aria-disabled="true" style="--c-color: var(${card.color});">
                        <i class="${card.icon} c-icon"></i>
                        <h3>${card.title}</h3>
                        <p>${card.desc}</p>
                    </div>` : `
                    <a href="#${card.target}-0" class="chapter-card ripple-btn" style="--c-color: var(${card.color});">
                        <i class="${card.icon} c-icon"></i>
                        <h3>${card.title}</h3>
                        <p>${card.desc}</p>
                    </a>`).join('')}
                </div>
            </section>

            <section class="home-closing home-reveal">
                <i class="fas fa-earth-africa" aria-hidden="true"></i>
                <div><span>${homeData.closing.kicker}</span><h2>${homeData.closing.title}</h2><p>${homeData.closing.text}</p><strong>${homeData.closing.signature}</strong></div>
                <a href="#tuta-0" class="home-closing-link ripple-btn"><span>${homeData.closing.cta}</span><i class="fas fa-arrow-left" aria-hidden="true"></i></a>
            </section>
        </section>
    `;
    appContainer.innerHTML = html;
    appContainer.querySelectorAll('[data-home-scroll]').forEach(button => {
        button.addEventListener('click', () => {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            document.getElementById(button.dataset.homeScroll)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        });
    });
    updateActiveSidebarLink('home');
    renderedRoute = 'home';
    restoreScrollPosition(renderedRoute);
}

function renderChapter(data, initialTab, activeTabData) {
    document.title = `${data.chapter_title} | AgriPedia Egypt`; 
    const chapId = data.id;
    const showChapterNavigation = data.tabs.length > 1;
    let html = `
        <section class="content-section active">
            ${showChapterNavigation ? `<div class="chapter-title-box">
                <span class="chap-num">${data.chapter_number}</span>
                <h2 class="chap-name">${data.chapter_title}</h2>
            </div>
            <div class="chapter-tabs ch-tabs" id="tabs-${chapId}" role="tablist" aria-label="${currentLang === 'ar' ? 'أقسام المقال' : 'Article sections'}">
                ${data.tabs.map((tab, idx) => `<button class="tab-btn ripple-btn ${idx === initialTab ? 'active' : ''}" type="button" role="tab" id="tab-${chapId}-${idx}" aria-selected="${idx === initialTab}" aria-controls="tab-pane-${chapId}-${idx}" tabindex="${idx === initialTab ? '0' : '-1'}" onclick="window.location.hash='${chapId}-${idx}'">${tab.tab_title}</button>`).join('')}
            </div>` : ''}
            <div id="content-${chapId}">
                <div class="tab-content active" id="tab-pane-${chapId}-${initialTab}" role="tabpanel" ${showChapterNavigation ? `aria-labelledby="tab-${chapId}-${initialTab}"` : `aria-label="${escapeHtml(activeTabData.tab_title)}"`}>${buildBlocks(activeTabData.content_blocks)}</div>
            </div>
            ${showChapterNavigation ? `<div class="pagination-controls" id="pagination-${chapId}"></div>` : ''}
        </section>
    `;
    appContainer.innerHTML = html;
    if (showChapterNavigation) {
        requestAnimationFrame(() => {
            const tabStrip = document.getElementById(`tabs-${chapId}`);
            centerScrollableItem(tabStrip, tabStrip?.querySelector('.tab-btn.active'), 'auto');
        });
    }
    if (showChapterNavigation) renderPagination(data);
    updateActiveSidebarLink(chapId, initialTab);
    const currentRoute = `${chapId}-${initialTab}`;
    renderedRoute = currentRoute;
    if (pendingSearchScroll?.route === currentRoute) {
        const pendingResult = pendingSearchScroll;
        const targetId = pendingResult.target;
        pendingSearchScroll = null;
        window.scrollTo({ top: 0, behavior: 'auto' });
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const activeArticle = document.querySelector('.tab-content.active .doc-article');
            const target = activeArticle?.querySelector(`#${targetId}`);
            const targetPart = target?.closest('[data-doc-part-index]');
            if (activeArticle && targetPart?.hidden) activateDocPart(activeArticle, Number(targetPart.dataset.docPartIndex));
            highlightArticleSearch(pendingResult.query, target);
            target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
            updateArticleReadingState();
        }));
    } else {
        restoreScrollPosition(currentRoute);
        requestAnimationFrame(() => requestAnimationFrame(updateArticleReadingState));
    }
    if(window.innerWidth <= 768) closeSidebar();
}

function buildBlocks(blocks) {
    let html = '';
    blocks.forEach(block => {
        if (block.type === 'sec-label') html += `<div class="sec-label"><span class="ic">${block.icon}</span><span>${block.text}</span></div>`;
        else if (block.type === 'card') html += `<div class="card" style="--card-top: ${block.theme};">${block.header_title ? `<div class="card-hdr"><div class="ico" style="color: var(--cyan);"><i class="${block.header_icon}"></i></div><span>${block.header_title}</span></div>` : ''}<div class="info-box">${buildInnerBlocks(block.body)}</div></div>`;
        else if (block.type === 'doc-article') html += buildDocArticle(block.items, block.meta || {});
    });
    return html;
}

function normalizeDocReferences(items) {
    const referenceHeadingIndex = items.findIndex(item => {
        if (item.type !== 'doc-heading' && item.type !== 'doc-paragraph') return false;
        return /^(المراجع|references)$/i.test(String(item.text || '').trim());
    });
    if (referenceHeadingIndex < 0 || items[referenceHeadingIndex + 1]?.type === 'reference-list') return items;

    const references = [];
    const unparsedItems = [];
    let cursor = referenceHeadingIndex + 1;
    while (cursor < items.length) {
        const citation = items[cursor];
        const match = citation.type === 'doc-paragraph'
            ? String(citation.text || '').match(/^\s*(\d+)\s*[.)]\s*(.+)$/s)
            : null;
        if (!match) {
            unparsedItems.push(citation);
            cursor++;
            continue;
        }

        const possibleUrl = items[cursor + 1];
        const url = possibleUrl?.type === 'doc-paragraph' && /^https?:\/\//i.test(String(possibleUrl.text || '').trim())
            ? String(possibleUrl.text).trim()
            : '';
        references.push({ number: Number(match[1]), text: match[2].trim(), url });
        cursor += url ? 2 : 1;
    }
    if (!references.length) return items;

    const originalHeading = items[referenceHeadingIndex];
    const referenceHeading = {
        type: 'doc-heading',
        level: 3,
        text: originalHeading.text,
        id: originalHeading.id || 'article-references'
    };
    return [
        ...items.slice(0, referenceHeadingIndex),
        referenceHeading,
        { type: 'reference-list', items: references },
        ...unparsedItems
    ];
}

function prepareDocPartNavigation(items) {
    const isPartHeading = item => item.type === 'doc-heading'
        && [2, 3].includes(Number(item.level))
        && /^(?:الجزء\s+(?:الأول|الثاني|الثالث|الرابع|الخامس)|Part\s+(?:One|Two|Three|Four|Five))\s*:/i.test(String(item.text || '').trim());
    const partIndexes = items.reduce((indexes, item, index) => {
        if (isPartHeading(item)) indexes.push(index);
        return indexes;
    }, []);
    if (partIndexes.length < 2) return { items, parts: [] };

    const hiddenIndexes = new Set(partIndexes);
    const isIntroduction = text => /^(?:مقدمة|Introduction)$/i.test(String(text || '').trim());
    const parts = partIndexes.map((partIndex, index) => {
        const boundary = partIndexes[index + 1] ?? items.length;
        const headingIndexes = [];
        const sectionIndexes = [];
        for (let cursor = partIndex + 1; cursor < boundary; cursor++) {
            if (items[cursor].type !== 'doc-heading') continue;
            headingIndexes.push(cursor);
            if (Number(items[cursor].level) === 2) sectionIndexes.push(cursor);
        }

        let description = '';
        let targetIndex = sectionIndexes[0];
        const firstHeadingIndex = headingIndexes[0];
        if (firstHeadingIndex !== undefined && firstHeadingIndex !== targetIndex) {
            description = items[firstHeadingIndex].text || '';
            hiddenIndexes.add(firstHeadingIndex);
        } else if (sectionIndexes.length > 1
            && !isIntroduction(items[sectionIndexes[0]]?.text)
            && isIntroduction(items[sectionIndexes[1]]?.text)) {
            description = items[sectionIndexes[0]].text || '';
            hiddenIndexes.add(sectionIndexes[0]);
            targetIndex = sectionIndexes[1];
        }

        return {
            title: items[partIndex].text || '',
            description,
            targetHeading: items[targetIndex]
        };
    }).filter(part => part.targetHeading);

    return {
        items: items.filter((_, index) => !hiddenIndexes.has(index)),
        parts
    };
}

function buildDocArticle(items, meta = {}) {
    items = normalizeDocReferences(items);
    const preparedParts = prepareDocPartNavigation(items);
    items = preparedParts.items;
    const chapterHeadings = items.filter(item => item.type === 'doc-heading' && Number(item.level) === 1 && !item.id);
    const sectionHeadings = items.filter(item => item.type === 'doc-heading' && Number(item.level) === 2);
    const docParts = preparedParts.parts.map(part => {
        const sectionIndex = sectionHeadings.indexOf(part.targetHeading);
        return { ...part, sectionIndex };
    }).filter(part => part.sectionIndex >= 0);
    const sectionPartIndexes = sectionHeadings.map((_, sectionIndex) => {
        if (!docParts.length) return -1;
        let partIndex = 0;
        docParts.forEach((part, index) => {
            if (part.sectionIndex <= sectionIndex) partIndex = index;
        });
        return partIndex;
    });
    const textForReadingTime = items.flatMap(item => {
        if (item.type === 'reference-list') return [];
        if (item.type === 'doc-list') return item.items;
        if (item.type === 'doc-table') return Array.isArray(item.headers)
            ? [...item.headers, ...item.rows.flat()]
            : item.rows.flatMap(row => [row.label, row.value]);
        return item.text ? [item.text] : [];
    }).join(' ');
    const readingMinutes = Math.max(1, Math.ceil(textForReadingTime.trim().split(/\s+/).length / 200));
    const updatedDate = meta.updated_at
        ? new Intl.DateTimeFormat(currentLang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${meta.updated_at}T00:00:00`))
        : '';
    const savedFontScale = Number(localStorage.getItem('articleFontScale'));
    const legacyFontLevel = Math.min(Math.max(Number(localStorage.getItem('articleFontLevel') || 0), 0), 2);
    const storedFontScale = Number.isFinite(savedFontScale) && savedFontScale >= 50 && savedFontScale <= 150
        ? Math.round(savedFontScale)
        : [100, 112, 124][legacyFontLevel];
    const labels = currentLang === 'ar' ? {
        reading: 'دقيقة قراءة', axes: 'محاور', updated: 'آخر تحديث', toc: 'محتويات الفصل',
        parts: 'أجزاء الفصل',
        more: 'عرض المزيد', less: 'عرض أقل', next: 'المحور التالي', tableHint: 'اسحب الجدول أفقيًا لعرض باقي البيانات',
        fontIncrease: 'تكبير الخط', fontDecrease: 'تصغير الخط', focus: 'وضع القراءة', print: 'طباعة الفصل', share: 'مشاركة الفصل',
        whatsapp: 'واتساب', facebook: 'فيسبوك', x: 'X', linkedin: 'لينكدإن', copy: 'نسخ الرابط',
        openReference: 'فتح المصدر', copyReference: 'نسخ المرجع'
    } : {
        reading: 'min read', axes: 'sections', updated: 'Last updated', toc: 'Chapter contents',
        parts: 'Chapter parts',
        more: 'Show more', less: 'Show less', next: 'Next section', tableHint: 'Swipe horizontally to view the rest of the table',
        fontIncrease: 'Increase font', fontDecrease: 'Decrease font', focus: 'Reading mode', print: 'Print chapter', share: 'Share chapter',
        whatsapp: 'WhatsApp', facebook: 'Facebook', x: 'X', linkedin: 'LinkedIn', copy: 'Copy link',
        openReference: 'Open source', copyReference: 'Copy reference'
    };
    const articleTitle = chapterHeadings[1]?.text || '';
    const shareUrl = typeof window !== 'undefined' && window.location ? window.location.href : '';
    const encodedShareUrl = encodeURIComponent(shareUrl);
    const encodedShareText = encodeURIComponent(articleTitle);

    let html = `<article class="doc-article"${docParts.length ? ' data-active-part-index="0"' : ''} data-font-scale="${storedFontScale}" style="--article-text-size: ${(storedFontScale * 0.0096).toFixed(4)}rem;">
        <header class="doc-article-hero">
            <p class="doc-chapter-label">${formatDocText(chapterHeadings[0]?.text || '')}</p>
            <h3 class="doc-article-title">${formatDocText(articleTitle)}</h3>
            <div class="doc-meta-row">
                <span><i class="far fa-clock" aria-hidden="true"></i>${readingMinutes} ${labels.reading}</span>
                <span><i class="fas fa-layer-group" aria-hidden="true"></i>${sectionHeadings.length} ${labels.axes}</span>
                ${updatedDate ? `<span><i class="far fa-calendar-check" aria-hidden="true"></i>${labels.updated}: ${updatedDate}</span>` : ''}
            </div>
            <div class="doc-reader-tools" role="toolbar" aria-label="${currentLang === 'ar' ? 'أدوات القراءة' : 'Reading tools'}">
                <button type="button" data-article-action="font-increase" title="${labels.fontIncrease}" aria-label="${labels.fontIncrease}" ${storedFontScale === 150 ? 'disabled' : ''}>A+</button>
                <span class="doc-font-indicator" aria-live="polite">${storedFontScale}%</span>
                <button type="button" data-article-action="font-decrease" title="${labels.fontDecrease}" aria-label="${labels.fontDecrease}" ${storedFontScale === 50 ? 'disabled' : ''}>A−</button>
                <button type="button" data-article-action="reading-focus" title="${labels.focus}" aria-label="${labels.focus}" aria-pressed="false"><i class="fas fa-book-open" aria-hidden="true"></i></button>
                <button type="button" data-article-action="print" title="${labels.print}" aria-label="${labels.print}"><i class="fas fa-print" aria-hidden="true"></i></button>
                <details class="doc-share-menu">
                    <summary title="${labels.share}" aria-label="${labels.share}"><i class="fas fa-share-nodes" aria-hidden="true"></i></summary>
                    <div class="doc-share-panel">
                        <a href="https://wa.me/?text=${encodedShareText}%20${encodedShareUrl}" target="_blank" rel="noopener noreferrer"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>${labels.whatsapp}</span></a>
                        <a href="https://www.facebook.com/sharer/sharer.php?u=${encodedShareUrl}" target="_blank" rel="noopener noreferrer"><i class="fab fa-facebook-f" aria-hidden="true"></i><span>${labels.facebook}</span></a>
                        <a href="https://twitter.com/intent/tweet?text=${encodedShareText}&url=${encodedShareUrl}" target="_blank" rel="noopener noreferrer"><i class="fab fa-x-twitter" aria-hidden="true"></i><span>${labels.x}</span></a>
                        <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodedShareUrl}" target="_blank" rel="noopener noreferrer"><i class="fab fa-linkedin-in" aria-hidden="true"></i><span>${labels.linkedin}</span></a>
                        <button type="button" data-article-action="copy-link" data-share-url="${escapeHtml(shareUrl)}" data-copy-label="${labels.copy}"><i class="fas fa-link" aria-hidden="true"></i><span>${labels.copy}</span></button>
                        <span class="doc-share-status" role="status" aria-live="polite"></span>
                    </div>
                </details>
            </div>
        </header>
        <div class="doc-navigation-shell">
            ${docParts.length ? `<div class="doc-parts-shell">
                <span class="doc-parts-label"><i class="fas fa-layer-group" aria-hidden="true"></i>${labels.parts}</span>
                <nav class="doc-parts-nav" aria-label="${labels.parts}">
                    ${docParts.map((part, index) => `<a href="#tuta-0" class="doc-part-link" data-doc-part-select="${index}" data-scroll-target="doc-section-${part.sectionIndex + 1}" data-section-index="${part.sectionIndex}"${index === 0 ? ' aria-current="true"' : ''}>
                        <span class="doc-part-index">${String(index + 1).padStart(2, '0')}</span>
                        <span class="doc-part-copy"><strong>${formatDocText(part.title)}</strong>${part.description ? `<small>${formatDocText(part.description)}</small>` : ''}</span>
                    </a>`).join('')}
                </nav>
            </div>` : ''}
            <nav class="doc-toc" aria-label="${labels.toc}">
                ${sectionHeadings.map((heading, index) => `<a href="#tuta-0" data-scroll-target="doc-section-${index + 1}"${docParts.length ? ` data-doc-part-index="${sectionPartIndexes[index]}"${sectionPartIndexes[index] === 0 ? '' : ' hidden'}` : ''}>${formatDocText(heading.text)}</a>`).join('')}
            </nav>
        </div>`;
    let openPanel = false;
    let openSubsection = false;
    let panelCloseMarkup = '';
    let sectionIndex = 0;
    let listIndex = 0;
    const usedGlossaryTerms = new Set();
    const sectionThemes = ['cyan', 'green', 'orange', 'pink', 'amber', 'blue', 'purple', 'green', 'cyan'];
    const sectionIcons = ['fa-circle-info', 'fa-earth-africa', 'fa-map-location-dot', 'fa-chart-line', 'fa-bug', 'fa-location-dot', 'fa-flask-vial', 'fa-shield-halved', 'fa-bullseye'];

    const closeSubsection = () => {
        if (openSubsection) {
            html += '</section>';
            openSubsection = false;
        }
    };

    const closePanel = () => {
        closeSubsection();
        if (openPanel) {
            html += panelCloseMarkup;
            openPanel = false;
            panelCloseMarkup = '';
        }
    };

    items.forEach(item => {
        if (item.type === 'doc-heading' && Number(item.level) === 1 && !item.id) {
            return;
        }

        if (item.type === 'doc-heading' && Number(item.level) === 2) {
            closePanel();
            const currentSectionIndex = sectionIndex;
            const theme = sectionThemes[currentSectionIndex % sectionThemes.length];
            const icon = sectionIcons[currentSectionIndex % sectionIcons.length];
            const partIndex = sectionPartIndexes[currentSectionIndex] ?? -1;
            sectionIndex++;
            html += `<section class="doc-section-card theme-${theme}" id="doc-section-${sectionIndex}"${docParts.length ? ` data-doc-part-index="${partIndex}"${partIndex === 0 ? '' : ' hidden'}` : ''}>
                <header class="doc-section-header">
                    <span class="doc-section-icon"><i class="fas ${icon}" aria-hidden="true"></i></span>
                    <h4 class="doc-section-title">${formatDocText(item.text)}</h4>
                </header>
                <div class="doc-section-body">`;
            openPanel = true;
            panelCloseMarkup = '</div></section>';
            return;
        }

        if (item.type === 'doc-heading' && item.id) {
            closePanel();
            const referenceCount = items.find(entry => entry.type === 'reference-list')?.items.length || 0;
            const referencePartIndex = docParts.length ? docParts.length - 1 : -1;
            html += `<details class="doc-references-panel"${docParts.length ? ` data-doc-part-index="${referencePartIndex}"${referencePartIndex === 0 ? '' : ' hidden'}` : ''}>
                <summary id="${escapeHtml(item.id)}" class="doc-references-title"><span>${formatDocText(item.text)}</span><span class="doc-reference-count">${referenceCount}</span></summary>
                <div class="doc-references-content">`;
            openPanel = true;
            panelCloseMarkup = '</div></details>';
            return;
        }

        if (!openPanel) {
            html += '<section class="doc-section-card theme-cyan"><div class="doc-section-body">';
            openPanel = true;
            panelCloseMarkup = '</div></section>';
        }

        if (item.type === 'doc-heading') {
            const headingLevel = Number(item.level);
            if (headingLevel === 3) {
                closeSubsection();
                html += `<section class="doc-subsection-card"><h5 class="doc-subheading level-3">${formatDocText(item.text)}</h5>`;
                openSubsection = true;
            } else {
                html += `<h6 class="doc-subheading level-${item.level}">${formatDocText(item.text)}</h6>`;
            }
        }
        else if (item.type === 'doc-paragraph') {
            html += isTaxonomyLadderText(item.text)
                ? buildTaxonomyLadder(item.text, usedGlossaryTerms)
                : `<p class="doc-paragraph">${formatDocText(item.text, usedGlossaryTerms)}</p>`;
        }
        else if (item.type === 'doc-quote') html += `<blockquote class="doc-quote">${formatDocText(item.text, usedGlossaryTerms)}</blockquote>`;
        else if (item.type === 'doc-callout') html += `<aside class="doc-callout ${escapeHtml(item.tone)}"><i class="${escapeHtml(item.icon)}" aria-hidden="true"></i><p>${formatDocText(item.text, usedGlossaryTerms)}</p></aside>`;
        else if (item.type === 'doc-list') {
            listIndex++;
            const listId = `doc-list-${listIndex}`;
            const isCompactTermList = item.items.length > 1 && item.items.every(text => text.replace(/<[^>]+>/g, '').trim().length <= 48);
            const listClass = isCompactTermList ? 'doc-term-list' : 'doc-card-grid';
            html += `<ul class="${listClass}" id="${listId}">${item.items.map(text => `<li>${formatDocText(text, usedGlossaryTerms)}</li>`).join('')}</ul>`;
        }
        else if (item.type === 'doc-table') {
            if (Array.isArray(item.headers)) {
                html += `<div class="doc-table-shell"><p class="doc-table-hint"><i class="fas fa-arrows-left-right" aria-hidden="true"></i>${labels.tableHint}</p>
                    <div class="doc-table-wrap"><table class="doc-table doc-table-matrix">
                        <thead><tr>${item.headers.map(header => `<th scope="col">${formatDocText(header, usedGlossaryTerms)}</th>`).join('')}</tr></thead>
                        <tbody>${item.rows.map(row => `<tr>${row.map((cell, index) => index === 0
                            ? `<th scope="row">${formatDocText(cell, usedGlossaryTerms)}</th>`
                            : `<td>${formatDocText(cell, usedGlossaryTerms)}</td>`).join('')}</tr>`).join('')}</tbody>
                    </table></div></div>`;
            } else {
                html += `<div class="doc-table-shell"><p class="doc-table-hint"><i class="fas fa-arrows-left-right" aria-hidden="true"></i>${labels.tableHint}</p>
                    <div class="doc-table-wrap"><table class="doc-table"><tbody>${item.rows.map(row => `
                        <tr><th scope="row">${formatDocText(row.label, usedGlossaryTerms)}</th><td>${formatDocText(row.value, usedGlossaryTerms)}</td></tr>`).join('')}</tbody></table></div></div>`;
            }
        }
        else if (item.type === 'reference-list') {
            html += `<ol class="references-list">${item.items.map(reference => `
                <li id="reference-${reference.number}" class="reference-card">
                    <div class="reference-card-head"><span class="reference-number">[${reference.number}]</span><small>${escapeHtml(getReferenceHost(reference.url))}</small></div>
                    <p class="reference-text">${escapeHtml(reference.text)}</p>
                    <div class="reference-actions">
                        ${reference.url ? `<a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i><span>${labels.openReference}</span></a>` : ''}
                        <button type="button" data-reference-copy="${escapeHtml(`${reference.number}. ${reference.text}${reference.url ? ` ${reference.url}` : ''}`)}" data-copy-label="${labels.copyReference}"><i class="far fa-copy" aria-hidden="true"></i><span>${labels.copyReference}</span></button>
                    </div>
                </li>`).join('')}</ol>`;
        }
    });

    closePanel();
    html += `<button class="doc-next-section" type="button" data-scroll-target="doc-section-2">
        <span>${labels.next}</span><strong>${formatDocText(sectionHeadings[1]?.text || '')}</strong><i class="fas ${currentLang === 'ar' ? 'fa-arrow-down' : 'fa-arrow-down'}" aria-hidden="true"></i>
    </button>`;
    return html + '</article>';
}

function isTaxonomyLadderText(value) {
    const text = String(value || '').trim();
    if (!text.includes('↓')) return false;
    const parts = text.split('↓').map(part => part.trim()).filter(Boolean);
    return parts.length >= 4 && parts.every(part => part.length <= 80);
}

function buildTaxonomyLadder(value, usedGlossaryTerms = null) {
    const text = String(value || '').trim();
    const parts = text.split('↓').map(part => part.trim()).filter(Boolean);
    if (parts.length < 4) return `<p class="doc-paragraph">${formatDocText(text, usedGlossaryTerms)}</p>`;
    return `<div class="taxonomy-ladder" role="list" aria-label="${escapeHtml(text)}">
        ${parts.map((part, index) => `<div class="taxonomy-step" role="listitem">
            <span class="taxonomy-rank">${String(index + 1).padStart(2, '0')}</span>
            <span class="taxonomy-node">${formatDocText(part, usedGlossaryTerms)}</span>
            ${index < parts.length - 1 ? '<span class="taxonomy-arrow" aria-hidden="true">↓</span>' : ''}
        </div>`).join('')}
    </div>`;
}

function updateArticleReadingState() {
    const article = document.querySelector('.tab-content.active .doc-article') || document.querySelector('.doc-article');
    if (!article) return;
    const sections = [...article.querySelectorAll('.doc-section-card[id]:not([hidden])')];
    if (!sections.length) return;
    const navigationBottom = article.querySelector('.doc-navigation-shell')?.getBoundingClientRect().bottom || 0;
    const markerOffset = Math.max(window.innerHeight * 0.35, navigationBottom + 120);
    const marker = window.scrollY + markerOffset;
    const sectionTops = sections.map(section => section.getBoundingClientRect().top + window.scrollY);
    let activeIndex = 0;
    sectionTops.forEach((sectionTop, index) => {
        if (sectionTop <= marker) activeIndex = index;
    });

    const tocLinks = [...article.querySelectorAll('.doc-toc a:not([hidden])')];
    tocLinks.forEach((link, index) => {
        if (index === activeIndex) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
    });
    if (article.dataset.activeSectionIndex !== String(activeIndex)) {
        article.dataset.activeSectionIndex = String(activeIndex);
        const toc = article.querySelector('.doc-toc');
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        centerScrollableItem(toc, tocLinks[activeIndex], behavior);
    }

    const nextButton = article.querySelector('.doc-next-section');
    if (!nextButton) return;
    if (activeIndex >= sections.length - 1) {
        nextButton.hidden = true;
    } else {
        nextButton.hidden = false;
        nextButton.dataset.scrollTarget = sections[activeIndex + 1].id;
        const nextTitle = sections[activeIndex + 1].querySelector('.doc-section-title')?.textContent || '';
        nextButton.querySelector('strong').textContent = nextTitle;
    }
}

function activateDocPart(article, partIndex) {
    if (!article || !Number.isInteger(partIndex) || partIndex < 0) return;
    article.dataset.activePartIndex = String(partIndex);
    article.querySelectorAll('.doc-section-card[data-doc-part-index], .doc-references-panel[data-doc-part-index]').forEach(panel => {
        panel.hidden = Number(panel.dataset.docPartIndex) !== partIndex;
    });
    article.querySelectorAll('.doc-toc a[data-doc-part-index]').forEach(link => {
        link.hidden = Number(link.dataset.docPartIndex) !== partIndex;
        link.removeAttribute('aria-current');
    });
    const visibleTocLinks = [...article.querySelectorAll('.doc-toc a:not([hidden])')];
    visibleTocLinks[0]?.setAttribute('aria-current', 'true');

    const partLinks = [...article.querySelectorAll('.doc-parts-nav .doc-part-link')];
    partLinks.forEach((link, index) => {
        if (index === partIndex) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
    });
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    centerScrollableItem(article.querySelector('.doc-parts-nav'), partLinks[partIndex], behavior);
    article.dataset.activeSectionIndex = '';
    updateArticleReadingState();
}

function updateArticleFontControls(article) {
    const scale = Math.min(Math.max(Number(article.dataset.fontScale || 100), 50), 150);
    const increaseButton = article.querySelector('[data-article-action="font-increase"]');
    const decreaseButton = article.querySelector('[data-article-action="font-decrease"]');
    const indicator = article.querySelector('.doc-font-indicator');
    article.dataset.fontScale = String(scale);
    article.style.setProperty('--article-text-size', `${(scale * 0.0096).toFixed(4)}rem`);
    if (increaseButton) increaseButton.disabled = scale >= 150;
    if (decreaseButton) decreaseButton.disabled = scale <= 50;
    if (indicator) indicator.textContent = `${scale}%`;
}

function buildInnerBlocks(items) {
    let html = '';
    items.forEach(item => {
        if (item.type === 'paragraph') html += `<p>${item.text}</p>`;
        else if (item.type === 'note-box') html += `<div class="note-box"><i class="${item.icon}"></i><div><p>${item.text}</p></div></div>`;
        else if (item.type === 'warning-box') html += `<div class="warning-box"><i class="${item.icon}"></i><div><p>${item.text}</p></div></div>`;
        else if (item.type === 'highlight') html += `<div class="highlight-box ${item.color || ''}">${item.text}</div>`;
        else if (item.type === 'formula') html += `<div class="formula-box">${item.text}</div>`;
        else if (item.type === 'image') html += `<div class="img-wrapper"><img src="${item.src}" alt="${item.caption || ''}" loading="lazy" onload="this.classList.add('loaded')"><p class="img-caption">${item.caption || ''}</p></div>`;
        else if (item.type === 'list') { html += `<ul class="custom-list ${item.class || ''}">`; item.items.forEach(li => html += `<li>${li}</li>`); html += `</ul>`; }
        else if (item.type === 'sub-grid') { html += `<div class="sub-grid">`; item.cards.forEach(c => { html += `<div class="sub-card"><h4>${c.icon ? `<i class="${c.icon}"></i>` : ''} ${c.title}</h4><p style="font-size: 0.85rem;">${c.text}</p></div>`; }); html += `</div>`; }
        else if (item.type === 'doc-heading') {
            const level = Math.min(Math.max(Number(item.level) + 2, 3), 6);
            const id = item.id ? ` id="${escapeHtml(item.id)}"` : '';
            html += `<h${level}${id} class="doc-heading level-${item.level}">${escapeHtml(item.text)}</h${level}>`;
        }
        else if (item.type === 'doc-paragraph') html += `<p class="doc-paragraph">${escapeHtml(item.text)}</p>`;
        else if (item.type === 'doc-quote') html += `<blockquote class="doc-quote">${escapeHtml(item.text)}</blockquote>`;
        else if (item.type === 'doc-list') html += `<ul class="custom-list doc-list">${item.items.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
        else if (item.type === 'reference-list') {
            html += `<ol class="references-list">${item.items.map(reference => `
                <li id="reference-${reference.number}">
                    <p>${escapeHtml(reference.text)}</p>
                    <a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.url)}</a>
                </li>`).join('')}</ol>`;
        }
    });
    return html;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getReferenceHost(value) {
    try {
        return value ? new URL(value).hostname.replace(/^www\./, '') : '';
    } catch {
        return '';
    }
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDocText(value, usedTerms = null) {
    let formatted = escapeHtml(value);
    if (usedTerms && currentGlossary.length) formatted = applySmartTerms(formatted, usedTerms);
    return formatted
        .replace(/\[(\d+)([،,]\s*)(\d+)\]/g, (_, first, separator, second) =>
            `[<a class="citation-link" href="#tuta-0" data-scroll-target="reference-${first}">${first}</a>${separator}<a class="citation-link" href="#tuta-0" data-scroll-target="reference-${second}">${second}</a>]`)
        .replace(/\[(\d+)\]/g, (_, number) =>
            `[<a class="citation-link" href="#tuta-0" data-scroll-target="reference-${number}">${number}</a>]`);
}

function applySmartTerms(text, usedTerms) {
    const aliasMap = new Map();
    currentGlossary.forEach(entry => {
        if (usedTerms.has(entry.id)) return;
        entry.aliases.forEach(alias => aliasMap.set(escapeHtml(alias).toLocaleLowerCase(), entry));
    });
    const aliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
    if (!aliases.length) return text;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${aliases.map(escapeRegExp).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    return text.replace(pattern, (full, prefix, match) => {
        const entry = aliasMap.get(match.toLocaleLowerCase());
        if (!entry || usedTerms.has(entry.id)) return full;
        usedTerms.add(entry.id);
        return `${prefix}<button type="button" class="smart-term" data-term-id="${escapeHtml(entry.id)}" aria-expanded="false" aria-controls="termTooltip">${match}</button>`;
    });
}

function handleSmartTermClick(event) {
    const trigger = event.target.closest('.smart-term');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (activeTermTrigger === trigger && termTooltipPinned) hideTermTooltip();
    else showTermTooltip(trigger, true);
}

function handleSmartTermHover(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const trigger = event.target.closest('.smart-term');
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    if (!termTooltipPinned) showTermTooltip(trigger, false);
}

function handleSmartTermLeave(event) {
    const trigger = event.target.closest('.smart-term');
    if (!trigger || trigger.contains(event.relatedTarget) || termTooltipPinned) return;
    window.setTimeout(() => {
        const tooltip = document.getElementById('termTooltip');
        if (!termTooltipPinned && !trigger.matches(':hover') && !tooltip?.matches(':hover')) hideTermTooltip();
    }, 80);
}

function handleSmartTermFocus(event) {
    const trigger = event.target.closest('.smart-term');
    if (trigger && !termTooltipPinned) showTermTooltip(trigger, false);
}

function handleSmartTermBlur(event) {
    const trigger = event.target.closest('.smart-term');
    if (trigger && !termTooltipPinned && !trigger.contains(event.relatedTarget)) hideTermTooltip();
}

function handleOutsideTermClick(event) {
    if (!termTooltipPinned) return;
    if (!event.target.closest('.smart-term') && !event.target.closest('#termTooltip')) hideTermTooltip();
}

function showTermTooltip(trigger, pinned) {
    const tooltip = document.getElementById('termTooltip');
    const entry = currentGlossary.find(item => item.id === trigger.dataset.termId);
    if (!tooltip || !entry) return;
    if (activeTermTrigger && activeTermTrigger !== trigger) activeTermTrigger.setAttribute('aria-expanded', 'false');
    activeTermTrigger = trigger;
    termTooltipPinned = pinned;
    trigger.setAttribute('aria-expanded', 'true');
    document.getElementById('termTooltipTitle').textContent = entry.term;
    document.getElementById('termTooltipScientific').textContent = entry.scientific || '';
    document.getElementById('termTooltipDefinition').textContent = entry.definition;
    tooltip.hidden = false;
    tooltip.classList.toggle('pinned', pinned);
    positionTermTooltip(trigger, tooltip);
}

function positionTermTooltip(trigger, tooltip) {
    if (window.innerWidth <= 768) {
        tooltip.style.left = '';
        tooltip.style.top = '';
        return;
    }
    const rect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + (rect.width / 2) - (tooltipRect.width / 2), 12), window.innerWidth - tooltipRect.width - 12);
    const preferredTop = rect.top - tooltipRect.height - 12;
    const top = preferredTop >= 12 ? preferredTop : rect.bottom + 12;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function hideTermTooltip() {
    const tooltip = document.getElementById('termTooltip');
    activeTermTrigger?.setAttribute('aria-expanded', 'false');
    if (tooltip) {
        tooltip.hidden = true;
        tooltip.classList.remove('pinned');
    }
    activeTermTrigger = null;
    termTooltipPinned = false;
}

function renderPagination(data) {
    const index = activeTabs[data.id];
    const paginationWrap = document.getElementById(`pagination-${data.id}`);
    if (!paginationWrap) return;

    let html = '';
    if (index > 0) { html += `<button class="nav-btn prev ripple-btn" onclick="window.location.hash='${data.id}-${index - 1}'"><i class="fas ${currentLang === 'ar' ? 'fa-arrow-right' : 'fa-arrow-left'}"></i><div><span class="btn-label">${currentLang === 'ar' ? 'السابق' : 'Previous'}</span><span class="btn-title">${data.tabs[index - 1].tab_title}</span></div></button>`; } else { html += `<div style="flex: 1;"></div>`; }
    if (index < data.tabs.length - 1) { html += `<button class="nav-btn next ripple-btn" onclick="window.location.hash='${data.id}-${index + 1}'"><div><span class="btn-label">${currentLang === 'ar' ? 'التالي' : 'Next'}</span><span class="btn-title">${data.tabs[index + 1].tab_title}</span></div><i class="fas ${currentLang === 'ar' ? 'fa-arrow-left' : 'fa-arrow-right'}"></i></button>`; }
    paginationWrap.innerHTML = html;
}

function updateActiveSidebarLink(target, tabIndex = null) {
    document.querySelectorAll('.sidebar-menu a').forEach(a => {
        a.classList.remove('active');
        a.removeAttribute('aria-current');
    });
    if(target === 'home' || target === 'glossary') {
        const navLink = document.getElementById(target === 'home' ? 'nav-home' : 'nav-glossary');
        if(navLink) {
            navLink.classList.add('active');
            navLink.setAttribute('aria-current', 'page');
        }
        return;
    }
    const links = document.querySelectorAll('.chapter-links a');
    links.forEach(link => {
        if(link.getAttribute('href') === `#${target}-${tabIndex}`) {
            link.classList.add('active');
            link.setAttribute('aria-current', 'page');
            link.closest('.chapter-group')?.classList.add('active');
            link.closest('.chapter-group')?.querySelector('.chapter-header')?.setAttribute('aria-expanded', 'true');
        }
    });
}
