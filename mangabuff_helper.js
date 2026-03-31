// ==UserScript==
// @name         Mangabuff-helper
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  Autoquiz, autoscroll, automine and reader helpers for mangabuff.ru
// @author       DanexExe
// @match        *://mangabuff.ru/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  if (window.self !== window.top) {
    return;
  }

  const STORAGE_KEY = 'mb_helper_settings_v2';
  const RESUME_SCROLL_KEY = 'mb_helper_resume_scroll';
  const COMMENT_VARIANTS = [
    'Спасибо за главу',
    'Сябки',
    'Спасибо за перевод!',
    'Спасибо за продолжение',
    'Спасибо за труды',
    'Спасибо за выпуск главы',
    'Благодарю за главу!',
    'Спасибо большое!',
    'Сябки!',
    'Спасибо!!',
    'Спасибо за главу ❤',
    'Спасибо за перевод ❤',
    'Огромное спасибо!',
    'Благодарочка!',
    'Спасибо за новую главу!',
    'Спасибо, было круто!',
    'Спасибки ✨'
  ];

  const defaults = {
    autoQuiz: false,
    autoScroll: false,
    autoChapterSwitch: true,
    autoLikes: true,
    autoComments: true,
    autoMine: false,
    quizAnswerDelay: 2000,
    quizRetryDelay: 5000,
    quizPageOnly: false,
    chatUrl: `${location.origin}/chat`,
    scrollStep: 260,
    scrollInterval: 1200,
    commentEveryChapters: 2,
    chaptersSinceComment: 0,
    lastHandledChapterKey: '',
    lastLikedChapterKey: '',
    lastCommentedChapterKey: ''
  };

  const settings = loadSettings();
  const runtime = {
    autoQuizRunning: false,
    autoQuizTimer: null,
    autoScrollInterval: null,
    autoMineInterval: null,
    readerReadyObserver: null,
    bottomHits: 0,
    navigatingToNextChapter: false,
    status: {
      autoQuiz: 'Ожидание',
      autoScroll: 'Ожидание',
      autoChapterSwitch: 'Ожидание',
      autoLikes: 'Ожидание',
      autoComments: 'Ожидание',
      autoMine: 'Ожидание'
    }
  };

  let statusNodes = {};
  let controls = {};
  let toastContainer = null;

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...defaults, ...parsed };
    } catch (error) {
      console.warn('[Mangabuff Helper] Failed to parse settings:', error);
      return { ...defaults };
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function setResumeScrollFlag(enabled) {
    if (enabled) {
      localStorage.setItem(RESUME_SCROLL_KEY, '1');
    } else {
      localStorage.removeItem(RESUME_SCROLL_KEY);
    }
  }

  function shouldResumeScroll() {
    return localStorage.getItem(RESUME_SCROLL_KEY) === '1';
  }

  function isAdminSession() {
    return Boolean(
      window.isAdmin ||
      document.querySelector('.admin-panel__tasks, .super-moder, .admin-panel__show-task-btn') ||
      location.pathname.startsWith('/admin') ||
      location.pathname.startsWith('/super-moderation')
    );
  }

  function showToast(message, tone = 'info') {
    if (!toastContainer) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = `mb-helper-toast mb-helper-toast--${tone}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-visible');
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => toast.remove(), 180);
    }, 2600);
  }

  function getCsrfToken() {
    const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (metaToken) {
      return metaToken;
    }

    const cookieToken = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
      ?.split('=')
      ?.slice(1)
      ?.join('=');

    return cookieToken ? decodeURIComponent(cookieToken) : '';
  }

  function request(path, options = {}) {
    const csrfToken = getCsrfToken();
    const headers = new Headers(options.headers || {});
    headers.set('X-Requested-With', 'XMLHttpRequest');

    if (csrfToken) {
      headers.set('X-CSRF-TOKEN', csrfToken);
      headers.set('X-XSRF-TOKEN', csrfToken);
    }

    return fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      ...options,
      headers
    });
  }

  async function postJson(path, payload) {
    const response = await request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = text;
    }

    return { response, data };
  }

  async function postForm(path, payload) {
    const body = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      body.set(key, value ?? '');
    });

    const response = await request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json, text/plain, */*'
      },
      body: body.toString()
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = text;
    }

    return { response, data };
  }

  function setStatus(feature, message) {
    runtime.status[feature] = message;
    if (statusNodes[feature]) {
      statusNodes[feature].textContent = message;
    }
  }

  function updateCheckboxes() {
    if (controls.autoQuiz) controls.autoQuiz.checked = settings.autoQuiz;
    if (controls.autoScroll) controls.autoScroll.checked = settings.autoScroll;
    if (controls.autoChapterSwitch) controls.autoChapterSwitch.checked = settings.autoChapterSwitch;
    if (controls.autoLikes) controls.autoLikes.checked = settings.autoLikes;
    if (controls.autoComments) controls.autoComments.checked = settings.autoComments;
    if (controls.autoMine) controls.autoMine.checked = settings.autoMine;
    if (controls.scrollStep) controls.scrollStep.value = String(settings.scrollStep);
  }

  function isReaderPage() {
    return Boolean(document.querySelector('.reader__footer, .reader-menu__item--like'));
  }

  function isQuizPage() {
    return Boolean(document.querySelector('.quiz__answer-item, .quiz__question, .quiz'));
  }

  function getChapterLikeButton() {
    return document.querySelector('.reader-menu__item--like[data-id][data-type="mangaChapter"], .favourite-send-btn.reader-menu__item--like[data-id]');
  }

  function getCurrentChapterId() {
    return getChapterLikeButton()?.dataset?.id || '';
  }

  function getCurrentChapterKey() {
    const chapterId = getCurrentChapterId();
    return `${location.pathname}::${chapterId}`;
  }

  function getNextChapterLink() {
    const candidates = Array.from(
      document.querySelectorAll('.reader__footer a.button.button--primary, a.button[rel="next"]')
    );

    return candidates.find((link) => {
      const text = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return link.rel === 'next' || text.includes('след');
    }) || null;
  }

  function updateReaderStatuses() {
    setStatus('autoScroll', settings.autoScroll ? 'Прокрутка включена' : 'Выключен');
    setStatus('autoChapterSwitch', settings.autoChapterSwitch ? 'Переход по главам включён' : 'Выключен');
    setStatus('autoLikes', settings.autoLikes ? 'Лайки включены' : 'Выключен');
    setStatus('autoComments', settings.autoComments ? `Комментарий раз в ${settings.commentEveryChapters} главы` : 'Выключен');
  }

  async function likeCurrentChapter() {
    const button = getChapterLikeButton();
    const chapterId = button?.dataset?.id;
    const chapterType = button?.dataset?.type || 'mangaChapter';
    const chapterKey = getCurrentChapterKey();

    if (!button || !chapterId || settings.lastLikedChapterKey === chapterKey) {
      return;
    }

    if (button.classList.contains('active')) {
      settings.lastLikedChapterKey = chapterKey;
      saveSettings();
      return;
    }

    const { response, data } = await postForm('/favourite', {
      type: chapterType,
      id: chapterId
    });

    if (!response.ok) {
      throw new Error(`Не удалось поставить лайк (${response.status})`);
    }

    button.classList.add('active');
    settings.lastLikedChapterKey = chapterKey;
    saveSettings();
    console.debug('[Mangabuff Helper] Chapter liked:', chapterId, data);
    showToast('Автолайк поставлен', 'success');
  }

  function pickRandomComment() {
    return COMMENT_VARIANTS[Math.floor(Math.random() * COMMENT_VARIANTS.length)];
  }

  async function maybeCommentCurrentChapter() {
    const chapterKey = getCurrentChapterKey();
    const chapterId = getCurrentChapterId();

    if (!chapterId || settings.lastCommentedChapterKey === chapterKey) {
      return false;
    }

    settings.chaptersSinceComment += 1;

    if (settings.chaptersSinceComment < settings.commentEveryChapters) {
      saveSettings();
      return false;
    }

    const commentText = pickRandomComment();
    const { response, data } = await postForm('/comments', {
      text: commentText,
      commentable_id: chapterId,
      commentable_type: 'mangaChapter',
      parent_id: '',
      gif_image: '',
      is_trade: '0',
      is_raffle: '0'
    });

    if (!response.ok) {
      throw new Error(`Не удалось отправить комментарий (${response.status})`);
    }

    if (data && typeof data === 'object' && data.message) {
      console.warn('[Mangabuff Helper] Comment rejected:', data.message);
      settings.chaptersSinceComment = 0;
      settings.lastCommentedChapterKey = chapterKey;
      saveSettings();
      return false;
    }

    settings.chaptersSinceComment = 0;
    settings.lastCommentedChapterKey = chapterKey;
    saveSettings();
    console.debug('[Mangabuff Helper] Comment sent:', commentText, data);
    showToast(`Автокоммент: ${commentText}`, 'success');
    return true;
  }

  async function handleReaderChapterEntry() {
    if (!isReaderPage() || (!settings.autoLikes && !settings.autoComments)) {
      return;
    }

    const chapterKey = getCurrentChapterKey();
    if (!chapterKey || settings.lastHandledChapterKey === chapterKey) {
      return;
    }

    settings.lastHandledChapterKey = chapterKey;
    saveSettings();

    if (settings.autoLikes) {
      try {
        await likeCurrentChapter();
      } catch (error) {
        console.warn('[Mangabuff Helper] Like failed:', error);
      }
    }

    if (settings.autoComments) {
      try {
        await maybeCommentCurrentChapter();
      } catch (error) {
        console.warn('[Mangabuff Helper] Comment failed:', error);
      }
    }

    updateReaderStatuses();
  }

  function maybeSwitchToNextChapter() {
    if (!settings.autoChapterSwitch || runtime.navigatingToNextChapter || !isReaderPage()) {
      return false;
    }

    const nextChapterLink = getNextChapterLink();
    if (nextChapterLink?.href) {
      runtime.navigatingToNextChapter = true;
      setResumeScrollFlag(true);
      setStatus('autoChapterSwitch', 'Переход к следующей главе');
      window.location.href = nextChapterLink.href;
      return true;
    }

    setStatus('autoChapterSwitch', 'Следующая глава не найдена');
    return false;
  }

  function handleReaderBottomReach() {
    if (!isReaderPage()) {
      return;
    }

    const scrollHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const isNearBottom = window.innerHeight + window.scrollY >= scrollHeight - 140;

    if (!isNearBottom) {
      runtime.bottomHits = 0;
      return;
    }

    runtime.bottomHits += 1;
    if (runtime.bottomHits < 3) {
      return;
    }

    if (maybeSwitchToNextChapter() && settings.autoScroll) {
      setStatus('autoScroll', 'Переход по главам');
      return;
    }

    if (settings.autoScroll && settings.autoChapterSwitch) {
      settings.autoScroll = false;
      setResumeScrollFlag(false);
      saveSettings();
      updateCheckboxes();
      stopAutoScroll();
      setStatus('autoScroll', 'Автоскролл выключен');
    }
  }

  function startAutoScroll() {
    if (runtime.autoScrollInterval) {
      return;
    }

    if (!isReaderPage()) {
      setStatus('autoScroll', 'Ожидание страницы главы');
      return;
    }

    runtime.bottomHits = 0;
    runtime.navigatingToNextChapter = false;
    setStatus('autoScroll', 'Прокрутка активна');

    handleReaderChapterEntry();

    runtime.autoScrollInterval = window.setInterval(() => {
      if (!settings.autoScroll) {
        stopAutoScroll();
        return;
      }

      window.scrollBy(0, settings.scrollStep);

      handleReaderBottomReach();
    }, settings.scrollInterval);
  }

  function stopAutoScroll() {
    if (runtime.autoScrollInterval) {
      clearInterval(runtime.autoScrollInterval);
      runtime.autoScrollInterval = null;
    }
    runtime.bottomHits = 0;
    runtime.navigatingToNextChapter = false;
    if (!settings.autoScroll) {
      setResumeScrollFlag(false);
    }
    setStatus('autoScroll', settings.autoScroll ? 'Пауза' : 'Выключен');
  }

  async function sendMineHit() {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${location.origin}/mine/hit`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');

    const csrfToken = getCsrfToken();
    if (csrfToken) {
      xhr.setRequestHeader('X-CSRF-TOKEN', csrfToken);
      xhr.setRequestHeader('X-XSRF-TOKEN', csrfToken);
    }

    return new Promise((resolve, reject) => {
      xhr.onload = () => {
        let data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (error) {
          data = xhr.responseText;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ status: xhr.status, data });
          return;
        }

        const error = new Error(`mine/hit returned ${xhr.status}`);
        error.status = xhr.status;
        error.data = data;
        reject(error);
      };

      xhr.onerror = () => {
        const error = new Error('mine/hit request failed');
        error.status = 0;
        reject(error);
      };
      const body = new URLSearchParams();
      if (csrfToken) {
        body.set('_token', csrfToken);
      }
      xhr.send(body.toString());
    });
  }

  function startAutoMine() {
    if (runtime.autoMineInterval) {
      return;
    }

    setStatus('autoMine', 'Отправка ударов');
    runtime.autoMineInterval = window.setInterval(async () => {
      if (!settings.autoMine) {
        stopAutoMine();
        return;
      }

      const toast = document.querySelector('.toast-error .toast-message');
      const isLimitReached = toast && /лимит ударов/i.test(toast.textContent || '');
      if (isLimitReached) {
        settings.autoMine = false;
        saveSettings();
        updateCheckboxes();
        stopAutoMine();
        setStatus('autoMine', 'Лимит ударов исчерпан');
        return;
      }

      try {
        await sendMineHit();
        setStatus('autoMine', 'Удар отправлен');
      } catch (error) {
        const mineButton = document.querySelector('.main-mine__game-tap');
        if (error?.status === 403 && mineButton && getComputedStyle(mineButton).display !== 'none') {
          mineButton.click();
          setStatus('autoMine', 'XHR 403, использую кнопку');
          return;
        }

        if (error?.status === 403) {
          console.info('[Mangabuff Helper] AutoMine got 403 and was disabled.');
        } else {
          console.warn('[Mangabuff Helper] AutoMine failed:', error);
        }
        settings.autoMine = false;
        saveSettings();
        updateCheckboxes();
        stopAutoMine();
        setStatus('autoMine', error?.status === 403 ? 'mine/hit вернул 403' : 'mine/hit вернул ошибку');
      }
    }, 1500);
  }

  function stopAutoMine() {
    if (runtime.autoMineInterval) {
      clearInterval(runtime.autoMineInterval);
      runtime.autoMineInterval = null;
    }
    if (settings.autoMine) {
      setStatus('autoMine', 'Пауза');
    } else {
      setStatus('autoMine', 'Выключен');
    }
  }

  async function runAutoQuizStep(answer) {
    const { response, data } = await postJson('/quiz/answer', { answer });

    if (!response.ok) {
      throw new Error(`quiz/answer returned ${response.status}`);
    }

    console.info('[Mangabuff Helper] Quiz answer sent successfully:', answer, data);

    if (data?.question?.correct_text) {
      setStatus('autoQuiz', 'Отправляю следующий ответ');
      return window.setTimeout(() => {
        if (settings.autoQuiz) {
          runAutoQuizStep(data.question.correct_text).catch(handleAutoQuizError);
        }
      }, settings.quizAnswerDelay);
    }

    runtime.autoQuizRunning = false;
    setStatus('autoQuiz', 'Квиз завершён');
    scheduleAutoQuizRetry();
    return null;
  }

  function handleAutoQuizError(error) {
    runtime.autoQuizRunning = false;
    console.warn('[Mangabuff Helper] AutoQuiz failed:', error);
    setStatus('autoQuiz', 'Ошибка квиза, повтор позже');
    scheduleAutoQuizRetry();
  }

  function clearAutoQuizTimer() {
    if (runtime.autoQuizTimer) {
      clearTimeout(runtime.autoQuizTimer);
      runtime.autoQuizTimer = null;
    }
  }

  function scheduleAutoQuizRetry() {
    clearAutoQuizTimer();
    if (!settings.autoQuiz || (settings.quizPageOnly && !isQuizPage())) {
      if (settings.autoQuiz && settings.quizPageOnly && !isQuizPage()) {
        setStatus('autoQuiz', 'Ожидание страницы квиза');
      }
      return;
    }

    runtime.autoQuizTimer = window.setTimeout(() => {
      runtime.autoQuizTimer = null;
      if (settings.autoQuiz) {
        startAutoQuiz();
      }
    }, settings.quizRetryDelay);
  }

  async function startAutoQuiz() {
    if (runtime.autoQuizRunning) {
      return;
    }

    if (settings.quizPageOnly && !isQuizPage()) {
      setStatus('autoQuiz', 'Ожидание страницы квиза');
      return;
    }

    runtime.autoQuizRunning = true;
    setStatus('autoQuiz', 'Запускаю квиз');

    try {
      const { response, data } = await postJson('/quiz/start', {});

      if (!response.ok) {
        throw new Error(`quiz/start returned ${response.status}`);
      }

      if (!data?.question?.correct_text) {
        runtime.autoQuizRunning = false;
        setStatus('autoQuiz', isQuizPage() ? 'Нет активного вопроса' : 'Нет активного квиза');
        return;
      }

      setStatus('autoQuiz', 'Первый ответ получен');
      console.info('[Mangabuff Helper] Quiz started successfully:', data);
      runtime.autoQuizTimer = window.setTimeout(() => {
        runtime.autoQuizTimer = null;
        if (settings.autoQuiz) {
          runAutoQuizStep(data.question.correct_text).catch(handleAutoQuizError);
        }
      }, settings.quizAnswerDelay);
    } catch (error) {
      handleAutoQuizError(error);
    }
  }

  function stopAutoQuiz() {
    runtime.autoQuizRunning = false;
    clearAutoQuizTimer();
    setStatus('autoQuiz', settings.autoQuiz ? 'Пауза' : 'Выключен');
  }

  class ModalController {
    constructor(backdrop, modal) {
      this.backdrop = backdrop;
      this.modal = modal;
      this.onBackdropClick = this.close.bind(this);
      this.backdrop.addEventListener('click', this.onBackdropClick);
    }

    open() {
      this.backdrop.classList.add('is-open');
      this.modal.classList.add('is-open');
    }

    close() {
      this.backdrop.classList.remove('is-open');
      this.modal.classList.remove('is-open');
    }
  }

  class DrawerController {
    constructor(drawer, toggle) {
      this.drawer = drawer;
      this.toggle = toggle;
    }

    open() {
      this.drawer.classList.add('is-open');
      this.toggle.classList.add('is-open');
    }

    close() {
      this.drawer.classList.remove('is-open');
      this.toggle.classList.remove('is-open');
    }

    toggleState() {
      if (this.drawer.classList.contains('is-open')) {
        this.close();
      } else {
        this.open();
      }
    }
  }

  function addModalScrollControls(modal) {
    const body = modal.querySelector('.mb-helper-modal-body');
    if (!body) {
      return;
    }

    const controlsBar = document.createElement('div');
    controlsBar.className = 'mb-helper-modal-scrollbar';

    const upButton = document.createElement('button');
    upButton.className = 'mb-helper-button mb-helper-button--ghost';
    upButton.type = 'button';
    upButton.textContent = 'Прокрутить вверх';

    const downButton = document.createElement('button');
    downButton.className = 'mb-helper-button mb-helper-button--ghost';
    downButton.type = 'button';
    downButton.textContent = 'Прокрутить вниз';

    upButton.addEventListener('click', () => {
      body.scrollBy({ top: -220, behavior: 'smooth' });
    });

    downButton.addEventListener('click', () => {
      body.scrollBy({ top: 220, behavior: 'smooth' });
    });

    controlsBar.appendChild(upButton);
    controlsBar.appendChild(downButton);
    modal.appendChild(controlsBar);
  }

  function scheduleReaderResume(attempt = 0) {
    if (isReaderPage()) {
      if (settings.autoScroll) {
        startAutoScroll();
      } else {
        handleReaderChapterEntry();
      }
      return;
    }

    if (attempt >= 30) {
      setStatus('autoScroll', 'Ожидание страницы главы');
      return;
    }

    window.setTimeout(() => {
      scheduleReaderResume(attempt + 1);
    }, 500);
  }

  function ensureReaderAutomationReady() {
    if (!settings.autoScroll) {
      return;
    }

    if (isReaderPage()) {
      if (!runtime.autoScrollInterval) {
        startAutoScroll();
      } else {
        handleReaderChapterEntry();
      }
      return;
    }

    if (runtime.readerReadyObserver || !document.body) {
      return;
    }

    runtime.readerReadyObserver = new MutationObserver(() => {
      if (!settings.autoScroll || !isReaderPage()) {
        return;
      }

      runtime.readerReadyObserver.disconnect();
      runtime.readerReadyObserver = null;
      startAutoScroll();
    });

    runtime.readerReadyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.setTimeout(() => {
      if (runtime.readerReadyObserver) {
        runtime.readerReadyObserver.disconnect();
        runtime.readerReadyObserver = null;
      }
      if (settings.autoScroll && !runtime.autoScrollInterval) {
        scheduleReaderResume();
      }
    }, 15000);
  }

  function createStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .mb-helper-launcher {
        position: fixed;
        left: 20px;
        bottom: 20px;
        z-index: 99998;
        width: 58px;
        height: 58px;
        border: none;
        border-radius: 18px;
        background: linear-gradient(135deg, #ff7a18 0%, #ffb347 100%);
        color: #22140b;
        font-size: 22px;
        font-weight: 800;
        box-shadow: 0 18px 40px rgba(90, 42, 8, 0.26);
        cursor: pointer;
      }

      .mb-helper-panel {
        position: fixed;
        left: 20px;
        bottom: 20px;
        z-index: 99999;
        width: min(360px, calc(100vw - 24px));
        color: #1f2328;
        border-radius: 24px;
        overflow: hidden;
        background:
          radial-gradient(circle at top right, rgba(255, 222, 173, 0.9), transparent 42%),
          linear-gradient(180deg, #fff7eb 0%, #ffffff 100%);
        border: 1px solid rgba(215, 162, 87, 0.35);
        box-shadow: 0 28px 60px rgba(62, 34, 11, 0.22);
        display: none;
        font-family: "Segoe UI", "Trebuchet MS", sans-serif;
      }

      .mb-helper-panel.is-open {
        display: block;
      }

      .mb-helper-header {
        padding: 18px 18px 14px;
        background: linear-gradient(135deg, rgba(255, 174, 66, 0.96), rgba(255, 122, 24, 0.9));
        color: #2f1707;
      }

      .mb-helper-title {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: 0.02em;
      }

      .mb-helper-subtitle {
        margin: 6px 0 0;
        font-size: 12px;
        opacity: 0.85;
      }

      .mb-helper-close {
        position: absolute;
        top: 12px;
        right: 12px;
        border: none;
        background: rgba(255, 255, 255, 0.28);
        color: #2f1707;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 16px;
      }

      .mb-helper-body {
        padding: 14px;
        display: grid;
        gap: 12px;
      }

      .mb-helper-card {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.78);
        border: 1px solid rgba(224, 185, 126, 0.4);
      }

      .mb-helper-checkbox {
        width: 18px;
        height: 18px;
        margin-top: 2px;
        accent-color: #ef6b1c;
      }

      .mb-helper-card-title {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
      }

      .mb-helper-card-text {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: #5d5249;
      }

      .mb-helper-status {
        margin-top: 6px;
        font-size: 11px;
        color: #8a4a17;
        font-weight: 600;
      }

      .mb-helper-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .mb-helper-secondary {
        border: none;
        border-radius: 14px;
        background: #23160d;
        color: #fff8ef;
        padding: 12px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .mb-helper-note {
        font-size: 11px;
        color: #705f52;
        line-height: 1.45;
      }

      .mb-helper-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100000;
        background: rgba(33, 19, 10, 0.48);
        display: none;
        backdrop-filter: blur(3px);
      }

      .mb-helper-backdrop.is-open {
        display: block;
      }

      .mb-helper-modal {
        position: fixed;
        inset: 50% auto auto 50%;
        transform: translate(-50%, -50%);
        width: min(420px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        z-index: 100001;
        display: none;
        grid-template-rows: auto minmax(0, 1fr) auto;
        border-radius: 24px;
        background: linear-gradient(180deg, #fffaf3 0%, #ffffff 100%);
        border: 1px solid rgba(225, 181, 119, 0.4);
        box-shadow: 0 32px 70px rgba(37, 20, 8, 0.3);
        overflow: hidden;
        font-family: "Segoe UI", "Trebuchet MS", sans-serif;
      }

      .mb-helper-modal.is-open {
        display: grid;
      }

      .mb-helper-modal-head {
        padding: 18px 20px 14px;
        background: linear-gradient(135deg, #23160d, #4a2a12);
        color: #fff7ef;
      }

      .mb-helper-modal-title {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
      }

      .mb-helper-modal-text {
        margin: 6px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(255, 247, 239, 0.82);
      }

      .mb-helper-modal-body {
        padding: 18px 20px 20px;
        display: grid;
        gap: 14px;
        overflow-y: auto;
        min-height: 0;
      }

      .mb-helper-field label {
        display: block;
        margin-bottom: 6px;
        font-size: 12px;
        font-weight: 700;
        color: #352014;
      }

      .mb-helper-field input[type="number"],
      .mb-helper-field input[type="range"] {
        width: 100%;
      }

      .mb-helper-field input[type="number"] {
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(152, 95, 35, 0.26);
        background: #fff;
        font-size: 14px;
      }

      .mb-helper-modal-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .mb-helper-modal-scrollbar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 0 20px 18px;
      }

      .mb-helper-button {
        border: none;
        border-radius: 14px;
        padding: 12px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .mb-helper-button--ghost {
        background: #f4e3cf;
        color: #553114;
      }

      .mb-helper-button--primary {
        background: linear-gradient(135deg, #ff7a18, #ffb347);
        color: #2c1707;
      }

      .mb-helper-toast-stack {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 100002;
        display: grid;
        gap: 10px;
        pointer-events: none;
      }

      .mb-helper-toast {
        min-width: 220px;
        max-width: min(360px, calc(100vw - 36px));
        padding: 12px 14px;
        border-radius: 14px;
        color: #fffdf8;
        background: rgba(35, 22, 13, 0.92);
        box-shadow: 0 18px 36px rgba(37, 20, 8, 0.2);
        font-size: 13px;
        line-height: 1.45;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.18s ease, transform 0.18s ease;
      }

      .mb-helper-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      .mb-helper-toast--success {
        background: linear-gradient(135deg, rgba(31, 105, 66, 0.96), rgba(44, 152, 95, 0.96));
      }

      .mb-helper-toast--warning {
        background: linear-gradient(135deg, rgba(133, 77, 17, 0.96), rgba(196, 119, 35, 0.96));
      }

      .mb-helper-chat-toggle {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 99997;
        border: none;
        border-radius: 16px 0 0 16px;
        background: linear-gradient(135deg, #23160d, #4a2a12);
        color: #fff7ef;
        padding: 14px 10px;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: -10px 18px 30px rgba(37, 20, 8, 0.24);
      }

      .mb-helper-chat-toggle.is-open {
        right: min(420px, calc(100vw - 24px));
      }

      .mb-helper-chat-drawer {
        position: fixed;
        right: 0;
        top: 0;
        height: 100vh;
        width: min(420px, calc(100vw - 12px));
        z-index: 99996;
        background: linear-gradient(180deg, #fffaf3 0%, #ffffff 100%);
        border-left: 1px solid rgba(225, 181, 119, 0.4);
        box-shadow: -22px 0 60px rgba(37, 20, 8, 0.18);
        transform: translateX(100%);
        transition: transform 0.2s ease;
        display: grid;
        grid-template-rows: auto auto 1fr;
      }

      .mb-helper-chat-drawer.is-open {
        transform: translateX(0);
      }

      .mb-helper-chat-head {
        padding: 16px 18px;
        background: linear-gradient(135deg, #23160d, #4a2a12);
        color: #fff7ef;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }

      .mb-helper-chat-title {
        margin: 0;
        font-size: 17px;
        font-weight: 800;
      }

      .mb-helper-chat-text {
        margin: 4px 0 0;
        font-size: 12px;
        color: rgba(255, 247, 239, 0.82);
      }

      .mb-helper-chat-close {
        border: none;
        border-radius: 10px;
        width: 32px;
        height: 32px;
        background: rgba(255, 255, 255, 0.2);
        color: #fff7ef;
        cursor: pointer;
      }

      .mb-helper-chat-actions {
        padding: 14px 18px;
        display: grid;
        gap: 10px;
        border-bottom: 1px solid rgba(225, 181, 119, 0.32);
      }

      .mb-helper-chat-actions input {
        box-sizing: border-box;
        width: 100%;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(152, 95, 35, 0.26);
      }

      .mb-helper-chat-frame {
        width: 100%;
        height: 100%;
        border: 0;
        background: #fff;
      }

      .mb-helper-admin-toggle {
        position: fixed;
        right: 0;
        top: calc(50% - 92px);
        transform: translateY(-50%);
        z-index: 99995;
        border: none;
        border-radius: 16px 0 0 16px;
        background: linear-gradient(135deg, #7b1d1d, #bc4747);
        color: #fff8f8;
        padding: 14px 10px;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: -10px 18px 30px rgba(74, 16, 16, 0.24);
      }

      .mb-helper-admin-toggle.is-open {
        right: min(360px, calc(100vw - 24px));
      }

      .mb-helper-admin-drawer {
        position: fixed;
        right: 0;
        top: 0;
        height: 100vh;
        width: min(360px, calc(100vw - 12px));
        z-index: 99994;
        background: linear-gradient(180deg, #fff6f6 0%, #ffffff 100%);
        border-left: 1px solid rgba(188, 71, 71, 0.28);
        box-shadow: -22px 0 60px rgba(74, 16, 16, 0.16);
        transform: translateX(100%);
        transition: transform 0.2s ease;
        display: grid;
        grid-template-rows: auto auto 1fr;
      }

      .mb-helper-admin-drawer.is-open {
        transform: translateX(0);
      }

      .mb-helper-admin-head {
        padding: 16px 18px;
        background: linear-gradient(135deg, #7b1d1d, #bc4747);
        color: #fff8f8;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }

      .mb-helper-admin-links {
        padding: 16px 18px 20px;
        display: grid;
        gap: 10px;
        align-content: start;
        overflow-y: auto;
      }

      .mb-helper-admin-link {
        display: block;
        padding: 12px 14px;
        border-radius: 14px;
        text-decoration: none;
        background: #fff;
        color: #5a1b1b;
        border: 1px solid rgba(188, 71, 71, 0.18);
        font-size: 13px;
        font-weight: 700;
      }

      .mb-helper-admin-text {
        font-size: 12px;
        line-height: 1.45;
        color: #7a4a4a;
      }

      @media (max-width: 640px) {
        .mb-helper-launcher,
        .mb-helper-panel {
          left: 12px;
          bottom: 12px;
        }

        .mb-helper-panel {
          width: calc(100vw - 24px);
        }

        .mb-helper-chat-toggle.is-open {
          right: calc(100vw - 12px);
        }

        .mb-helper-admin-toggle.is-open {
          right: calc(100vw - 12px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createFeatureCard({ title, description, stateKey, statusKey }) {
    const card = document.createElement('label');
    card.className = 'mb-helper-card';

    const checkbox = document.createElement('input');
    checkbox.className = 'mb-helper-checkbox';
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(settings[stateKey]);

    const content = document.createElement('div');
    const titleNode = document.createElement('p');
    titleNode.className = 'mb-helper-card-title';
    titleNode.textContent = title;

    const descriptionNode = document.createElement('p');
    descriptionNode.className = 'mb-helper-card-text';
    descriptionNode.textContent = description;

    const statusNode = document.createElement('div');
    statusNode.className = 'mb-helper-status';
    statusNode.textContent = runtime.status[statusKey];
    statusNodes[statusKey] = statusNode;

    content.appendChild(titleNode);
    content.appendChild(descriptionNode);
    content.appendChild(statusNode);
    card.appendChild(checkbox);
    card.appendChild(content);

    controls[stateKey] = checkbox;

    checkbox.addEventListener('change', () => {
      settings[stateKey] = checkbox.checked;
      saveSettings();

      if (stateKey === 'autoScroll') {
        if (settings.autoScroll) {
          startAutoScroll();
        } else {
          stopAutoScroll();
        }
      }

      if (stateKey === 'autoMine') {
        if (settings.autoMine) {
          startAutoMine();
        } else {
          stopAutoMine();
        }
      }

      if (stateKey === 'autoQuiz') {
        if (settings.autoQuiz) {
          startAutoQuiz();
        } else {
          stopAutoQuiz();
        }
      }

      if (stateKey === 'autoChapterSwitch' || stateKey === 'autoLikes' || stateKey === 'autoComments') {
        updateReaderStatuses();
        handleReaderChapterEntry();
      }
    });

    return card;
  }

  function createActionButton(label) {
    const button = document.createElement('button');
    button.className = 'mb-helper-secondary';
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  function buildUi() {
    createStyles();

    const launcher = document.createElement('button');
    launcher.className = 'mb-helper-launcher';
    launcher.type = 'button';
    launcher.textContent = 'MB';

    const panel = document.createElement('section');
    panel.className = 'mb-helper-panel';

    const header = document.createElement('div');
    header.className = 'mb-helper-header';

    const title = document.createElement('h2');
    title.className = 'mb-helper-title';
    title.textContent = 'Mangabuff-helper';

    const subtitle = document.createElement('p');
    subtitle.className = 'mb-helper-subtitle';
    subtitle.textContent = 'Единая панель для квиза, чтения глав и автошахты.';

    const closeButton = document.createElement('button');
    closeButton.className = 'mb-helper-close';
    closeButton.type = 'button';
    closeButton.textContent = '✕';

    header.appendChild(title);
    header.appendChild(subtitle);
    header.appendChild(closeButton);

    const body = document.createElement('div');
    body.className = 'mb-helper-body';

    body.appendChild(createFeatureCard({
      title: 'AutoQuiz',
      description: 'Берёт правильный ответ из ответа API квиза и продолжает цепочку, пока вопросы не закончатся.',
      stateKey: 'autoQuiz',
      statusKey: 'autoQuiz'
    }));

    body.appendChild(createFeatureCard({
      title: 'AutoScroll',
      description: 'Только прокручивает страницу главы вниз с заданной силой и интервалом.',
      stateKey: 'autoScroll',
      statusKey: 'autoScroll'
    }));

    body.appendChild(createFeatureCard({
      title: 'Auto Chapter',
      description: 'После конца страницы открывает следующую главу. Работает вместе с автоскроллом или при ручной прокрутке до конца.',
      stateKey: 'autoChapterSwitch',
      statusKey: 'autoChapterSwitch'
    }));

    body.appendChild(createFeatureCard({
      title: 'Auto Likes',
      description: 'Ставит один лайк на каждую новую главу по id из кнопки лайка в ридере.',
      stateKey: 'autoLikes',
      statusKey: 'autoLikes'
    }));

    body.appendChild(createFeatureCard({
      title: 'Auto Comments',
      description: 'Отправляет один короткий комментарий через заданное число глав.',
      stateKey: 'autoComments',
      statusKey: 'autoComments'
    }));

    body.appendChild(createFeatureCard({
      title: 'AutoMine',
      description: 'Шлёт XHR POST на /mine/hit, а при 403 пытается использовать штатную кнопку удара.',
      stateKey: 'autoMine',
      statusKey: 'autoMine'
    }));

    const actions = document.createElement('div');
    actions.className = 'mb-helper-actions';

    const scrollSettingsButton = createActionButton('Настроить автоскролл');
    const quizSettingsButton = createActionButton('Настроить автоквиз');
    const commentsSettingsButton = createActionButton('Настроить автокомменты');

    const note = document.createElement('div');
    note.className = 'mb-helper-note';
    note.textContent = 'Модалки разделены по смыслу: скролл, квиз и комментарии. Встроенный чат открывается справа отдельной вкладкой.';

    actions.appendChild(scrollSettingsButton);
    actions.appendChild(quizSettingsButton);
    actions.appendChild(commentsSettingsButton);
    actions.appendChild(note);
    body.appendChild(actions);

    panel.appendChild(header);
    panel.appendChild(body);

    const backdrop = document.createElement('div');
    backdrop.className = 'mb-helper-backdrop';
    toastContainer = document.createElement('div');
    toastContainer.className = 'mb-helper-toast-stack';

    const scrollModal = document.createElement('section');
    scrollModal.className = 'mb-helper-modal';
    scrollModal.innerHTML = `
      <div class="mb-helper-modal-head">
        <h3 class="mb-helper-modal-title">Параметры автоскролла</h3>
        <p class="mb-helper-modal-text">Сила прокрутки отвечает за высоту шага за один тик. Чем больше число, тем быстрее страница уходит вниз.</p>
      </div>
      <div class="mb-helper-modal-body">
        <div class="mb-helper-field">
          <label for="mb-scroll-step-range">Сила прокрутки: <span id="mb-scroll-step-value">${settings.scrollStep}</span> px</label>
          <input id="mb-scroll-step-range" type="range" min="80" max="1200" step="20" value="${settings.scrollStep}">
        </div>
        <div class="mb-helper-field">
          <label for="mb-scroll-step-number">Точное значение</label>
          <input id="mb-scroll-step-number" type="number" min="80" max="1200" step="20" value="${settings.scrollStep}">
        </div>
        <div class="mb-helper-field">
          <label for="mb-scroll-interval-number">Интервал между прокрутками (мс)</label>
          <input id="mb-scroll-interval-number" type="number" min="200" max="5000" step="100" value="${settings.scrollInterval}">
        </div>
        <div class="mb-helper-modal-actions">
          <button class="mb-helper-button mb-helper-button--ghost" type="button" id="mb-scroll-cancel">Закрыть</button>
          <button class="mb-helper-button mb-helper-button--primary" type="button" id="mb-scroll-save">Сохранить</button>
        </div>
      </div>
    `;

    const quizModal = document.createElement('section');
    quizModal.className = 'mb-helper-modal';
    quizModal.innerHTML = `
      <div class="mb-helper-modal-head">
        <h3 class="mb-helper-modal-title">Параметры автоквиза</h3>
        <p class="mb-helper-modal-text">Здесь можно настроить задержку между ответами, повторный запуск и опциональное ожидание страницы квиза.</p>
      </div>
      <div class="mb-helper-modal-body">
        <div class="mb-helper-field">
          <label for="mb-quiz-answer-delay">Задержка между ответами (мс)</label>
          <input id="mb-quiz-answer-delay" type="number" min="500" max="10000" step="100" value="${settings.quizAnswerDelay}">
        </div>
        <div class="mb-helper-field">
          <label for="mb-quiz-retry-delay">Повторный запуск квиза (мс)</label>
          <input id="mb-quiz-retry-delay" type="number" min="1000" max="30000" step="500" value="${settings.quizRetryDelay}">
        </div>
        <div class="mb-helper-field">
          <label><input id="mb-quiz-page-only" type="checkbox" ${settings.quizPageOnly ? 'checked' : ''}> Запускать только на странице квиза</label>
        </div>
        <div class="mb-helper-modal-actions">
          <button class="mb-helper-button mb-helper-button--ghost" type="button" id="mb-quiz-cancel">Закрыть</button>
          <button class="mb-helper-button mb-helper-button--primary" type="button" id="mb-quiz-save">Сохранить</button>
        </div>
      </div>
    `;

    const commentsModal = document.createElement('section');
    commentsModal.className = 'mb-helper-modal';
    commentsModal.innerHTML = `
      <div class="mb-helper-modal-head">
        <h3 class="mb-helper-modal-title">Параметры автокомментов</h3>
        <p class="mb-helper-modal-text">Управляйте автолайками, автокомментариями и частотой отправки комментариев по главам.</p>
      </div>
      <div class="mb-helper-modal-body">
        <div class="mb-helper-field">
          <label><input id="mb-auto-like-toggle" type="checkbox" ${settings.autoLikes ? 'checked' : ''}> Включить автолайки</label>
        </div>
        <div class="mb-helper-field">
          <label><input id="mb-auto-comment-toggle" type="checkbox" ${settings.autoComments ? 'checked' : ''}> Включить автокомментарии</label>
        </div>
        <div class="mb-helper-field">
          <label for="mb-comment-frequency-number">Комментарий раз в N глав</label>
          <input id="mb-comment-frequency-number" type="number" min="1" max="50" step="1" value="${settings.commentEveryChapters}">
        </div>
        <div class="mb-helper-modal-actions">
          <button class="mb-helper-button mb-helper-button--ghost" type="button" id="mb-comments-cancel">Закрыть</button>
          <button class="mb-helper-button mb-helper-button--primary" type="button" id="mb-comments-save">Сохранить</button>
        </div>
      </div>
    `;

    const chatToggle = document.createElement('button');
    chatToggle.className = 'mb-helper-chat-toggle';
    chatToggle.type = 'button';
    chatToggle.textContent = 'Чат';

    const chatDrawer = document.createElement('aside');
    chatDrawer.className = 'mb-helper-chat-drawer';
    chatDrawer.innerHTML = `
      <div class="mb-helper-chat-head">
        <div>
          <p class="mb-helper-chat-title">Встроенный чат</p>
          <p class="mb-helper-chat-text">Открывает чат Mangabuff во встроенной панели без автоматизации сообщений.</p>
        </div>
        <button class="mb-helper-chat-close" type="button" id="mb-chat-close">✕</button>
      </div>
      <div class="mb-helper-chat-actions">
        <input id="mb-chat-url" type="text" value="${settings.chatUrl}">
        <button class="mb-helper-secondary" type="button" id="mb-chat-open-link">Открыть чат в новой вкладке</button>
      </div>
      <iframe id="mb-chat-frame" class="mb-helper-chat-frame" src="${settings.chatUrl}" referrerpolicy="no-referrer"></iframe>
    `;

    let adminToggle = null;
    let adminDrawer = null;
    let adminDrawerController = null;

    if (isAdminSession()) {
      adminToggle = document.createElement('button');
      adminToggle.className = 'mb-helper-admin-toggle';
      adminToggle.type = 'button';
      adminToggle.textContent = 'Admin';

      adminDrawer = document.createElement('aside');
      adminDrawer.className = 'mb-helper-admin-drawer';
      adminDrawer.innerHTML = `
        <div class="mb-helper-admin-head">
          <div>
            <p class="mb-helper-chat-title">Admin Drawer</p>
            <p class="mb-helper-chat-text">Показывается только при уже подтверждённой сервером админ-сессии.</p>
          </div>
          <button class="mb-helper-chat-close" type="button" id="mb-admin-close">✕</button>
        </div>
        <div class="mb-helper-chat-actions">
          <div class="mb-helper-admin-text">Этот блок не выдаёт прав. Он только даёт быстрый доступ к штатным административным страницам сайта.</div>
        </div>
        <div class="mb-helper-admin-links">
          <a class="mb-helper-admin-link" href="${location.origin}/admin" target="_blank" rel="noopener noreferrer">Открыть /admin</a>
          <a class="mb-helper-admin-link" href="${location.origin}/super-moderation" target="_blank" rel="noopener noreferrer">Открыть /super-moderation</a>
          <a class="mb-helper-admin-link" href="${location.origin}/admin/parser-task/getActiveTask" target="_blank" rel="noopener noreferrer">Активная parser task</a>
          <a class="mb-helper-admin-link" href="${location.origin}/moments/create" target="_blank" rel="noopener noreferrer">Создание moments</a>
          <a class="mb-helper-admin-link" href="${location.origin}/cards/create" target="_blank" rel="noopener noreferrer">Создание card</a>
        </div>
      `;
    }

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    document.body.appendChild(backdrop);
    document.body.appendChild(toastContainer);
    document.body.appendChild(scrollModal);
    document.body.appendChild(quizModal);
    document.body.appendChild(commentsModal);
    document.body.appendChild(chatToggle);
    document.body.appendChild(chatDrawer);
    if (adminToggle && adminDrawer) {
      document.body.appendChild(adminToggle);
      document.body.appendChild(adminDrawer);
    }

    addModalScrollControls(scrollModal);
    addModalScrollControls(quizModal);
    addModalScrollControls(commentsModal);

    const scrollModalController = new ModalController(backdrop, scrollModal);
    const quizModalController = new ModalController(backdrop, quizModal);
    const commentsModalController = new ModalController(backdrop, commentsModal);
    const chatDrawerController = new DrawerController(chatDrawer, chatToggle);
    if (adminDrawer && adminToggle) {
      adminDrawerController = new DrawerController(adminDrawer, adminToggle);
    }

    const rangeInput = scrollModal.querySelector('#mb-scroll-step-range');
    const numberInput = scrollModal.querySelector('#mb-scroll-step-number');
    const intervalInput = scrollModal.querySelector('#mb-scroll-interval-number');
    const rangeValue = scrollModal.querySelector('#mb-scroll-step-value');
    const scrollSaveButton = scrollModal.querySelector('#mb-scroll-save');
    const scrollCancelButton = scrollModal.querySelector('#mb-scroll-cancel');

    const quizAnswerDelayInput = quizModal.querySelector('#mb-quiz-answer-delay');
    const quizRetryDelayInput = quizModal.querySelector('#mb-quiz-retry-delay');
    const quizPageOnlyToggle = quizModal.querySelector('#mb-quiz-page-only');
    const quizSaveButton = quizModal.querySelector('#mb-quiz-save');
    const quizCancelButton = quizModal.querySelector('#mb-quiz-cancel');

    const autoLikeToggle = commentsModal.querySelector('#mb-auto-like-toggle');
    const autoCommentToggle = commentsModal.querySelector('#mb-auto-comment-toggle');
    const commentFrequencyInput = commentsModal.querySelector('#mb-comment-frequency-number');
    const commentsSaveButton = commentsModal.querySelector('#mb-comments-save');
    const commentsCancelButton = commentsModal.querySelector('#mb-comments-cancel');

    const chatUrlInput = chatDrawer.querySelector('#mb-chat-url');
    const chatFrame = chatDrawer.querySelector('#mb-chat-frame');
    const chatCloseButton = chatDrawer.querySelector('#mb-chat-close');
    const chatOpenLinkButton = chatDrawer.querySelector('#mb-chat-open-link');
    const adminCloseButton = adminDrawer?.querySelector('#mb-admin-close');

    controls.scrollStep = numberInput;

    function syncScrollInputs(value) {
      const safeValue = Number(value) || settings.scrollStep;
      rangeInput.value = String(safeValue);
      numberInput.value = String(safeValue);
      rangeValue.textContent = String(safeValue);
    }

    function openPanel() {
      panel.classList.add('is-open');
      launcher.style.display = 'none';
    }

    function closePanel() {
      panel.classList.remove('is-open');
      launcher.style.display = '';
    }

    function openScrollModal() {
      syncScrollInputs(settings.scrollStep);
      intervalInput.value = String(settings.scrollInterval);
      scrollModalController.open();
    }

    function openQuizModal() {
      quizAnswerDelayInput.value = String(settings.quizAnswerDelay);
      quizRetryDelayInput.value = String(settings.quizRetryDelay);
      quizPageOnlyToggle.checked = settings.quizPageOnly;
      quizModalController.open();
    }

    function openCommentsModal() {
      autoLikeToggle.checked = settings.autoLikes;
      autoCommentToggle.checked = settings.autoComments;
      commentFrequencyInput.value = String(settings.commentEveryChapters);
      commentsModalController.open();
    }

    launcher.addEventListener('click', openPanel);
    closeButton.addEventListener('click', closePanel);
    scrollSettingsButton.addEventListener('click', openScrollModal);
    quizSettingsButton.addEventListener('click', openQuizModal);
    commentsSettingsButton.addEventListener('click', openCommentsModal);
    scrollCancelButton.addEventListener('click', () => scrollModalController.close());
    quizCancelButton.addEventListener('click', () => quizModalController.close());
    commentsCancelButton.addEventListener('click', () => commentsModalController.close());
    chatToggle.addEventListener('click', () => chatDrawerController.toggleState());
    chatCloseButton.addEventListener('click', () => chatDrawerController.close());
    if (adminToggle && adminDrawerController && adminCloseButton) {
      adminToggle.addEventListener('click', () => adminDrawerController.toggleState());
      adminCloseButton.addEventListener('click', () => adminDrawerController.close());
    }

    chatOpenLinkButton.addEventListener('click', () => {
      const nextChatUrl = chatUrlInput.value.trim() || settings.chatUrl;
      settings.chatUrl = nextChatUrl;
      saveSettings();
      window.open(nextChatUrl, '_blank', 'noopener,noreferrer');
    });

    chatUrlInput.addEventListener('change', () => {
      const nextChatUrl = chatUrlInput.value.trim();
      if (!nextChatUrl) {
        return;
      }
      settings.chatUrl = nextChatUrl;
      saveSettings();
      chatFrame.src = nextChatUrl;
    });

    rangeInput.addEventListener('input', () => syncScrollInputs(rangeInput.value));
    numberInput.addEventListener('input', () => syncScrollInputs(numberInput.value));

    scrollSaveButton.addEventListener('click', () => {
      const nextStep = Number(numberInput.value);
      const nextInterval = Number(intervalInput.value);

      if (!Number.isFinite(nextStep) || nextStep < 80 || nextStep > 1200) {
        alert('Сила прокрутки должна быть в диапазоне от 80 до 1200 px.');
        return;
      }

      if (!Number.isFinite(nextInterval) || nextInterval < 200 || nextInterval > 5000) {
        alert('Интервал должен быть в диапазоне от 200 до 5000 мс.');
        return;
      }

      const scrollWasRunning = settings.autoScroll;
      settings.scrollStep = nextStep;
      settings.scrollInterval = nextInterval;
      saveSettings();
      scrollModalController.close();
      updateCheckboxes();

      if (scrollWasRunning) {
        stopAutoScroll();
        startAutoScroll();
      }
    });

    quizSaveButton.addEventListener('click', () => {
      const nextAnswerDelay = Number(quizAnswerDelayInput.value);
      const nextRetryDelay = Number(quizRetryDelayInput.value);

      if (!Number.isFinite(nextAnswerDelay) || nextAnswerDelay < 500 || nextAnswerDelay > 10000) {
        alert('Задержка между ответами должна быть в диапазоне от 500 до 10000 мс.');
        return;
      }

      if (!Number.isFinite(nextRetryDelay) || nextRetryDelay < 1000 || nextRetryDelay > 30000) {
        alert('Задержка повторного запуска должна быть в диапазоне от 1000 до 30000 мс.');
        return;
      }

      settings.quizAnswerDelay = nextAnswerDelay;
      settings.quizRetryDelay = nextRetryDelay;
      settings.quizPageOnly = quizPageOnlyToggle.checked;
      saveSettings();
      quizModalController.close();
    });

    commentsSaveButton.addEventListener('click', () => {
      const nextCommentFrequency = Number(commentFrequencyInput.value);

      if (!Number.isFinite(nextCommentFrequency) || nextCommentFrequency < 1 || nextCommentFrequency > 50) {
        alert('Частота комментариев должна быть в диапазоне от 1 до 50 глав.');
        return;
      }

      settings.autoLikes = autoLikeToggle.checked;
      settings.autoComments = autoCommentToggle.checked;
      settings.commentEveryChapters = nextCommentFrequency;
      saveSettings();
      commentsModalController.close();
      updateCheckboxes();
      updateReaderStatuses();
      handleReaderChapterEntry();
    });

    updateCheckboxes();
    updateReaderStatuses();
  }

  function initFromSettings() {
    const resumeScroll = shouldResumeScroll();

    if (settings.autoScroll) {
      ensureReaderAutomationReady();
    } else {
      setStatus('autoScroll', 'Выключен');
    }

    if (resumeScroll && settings.autoScroll) {
      setStatus('autoScroll', 'Автоскролл продолжен');
      ensureReaderAutomationReady();
    }

    updateReaderStatuses();

    if (settings.autoMine) {
      startAutoMine();
    } else {
      setStatus('autoMine', 'Выключен');
    }

    if (settings.autoQuiz) {
      startAutoQuiz();
    } else {
      setStatus('autoQuiz', 'Выключен');
    }
  }

  function init() {
    buildUi();
    initFromSettings();

    window.addEventListener('scroll', handleReaderBottomReach, { passive: true });
    window.addEventListener('pageshow', () => {
      if (settings.autoScroll) {
        ensureReaderAutomationReady();
      }
    });

    if (isReaderPage()) {
      handleReaderChapterEntry();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
