import { PHRASE_CATEGORIES, ROUNDS, RULE_LABELS, USEFUL_PHRASES } from './data.js';

/**
 * Normalize Spanish text for accent-insensitive and case-insensitive comparison.
 * Allows learners without Spanish keyboards to type "balon" for "Balón" or "Espana" for "España".
 */
function normalizeAnswer(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¡!¿?.,;:]/g, '')
    .replace(/\s+/g, ' ');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Lightweight Web Audio synthesizer for gentle studio game feedback */
let audioCtx = null;

function playTone(type) {
  if (!state.soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    if (type === 'correct') {
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.065);
        gain.gain.setValueAtTime(0.001, now + idx * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.09, now + idx * 0.065 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.065);
        osc.stop(now + idx * 0.065 + 0.22);
      });
    } else if (type === 'wrong') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(175, now + 0.18);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    } else if (type === 'reveal' || type === 'pass') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(type === 'reveal' ? 440 : 370, now);
      osc.frequency.exponentialRampToValueAtTime(type === 'reveal' ? 520 : 415, now + 0.09);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch {
    // Audio playback is optional
  }
}

/* Native Spanish speech synthesis for optional pronunciation */
function speakSpanish(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 0.94;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech synthesis is optional
  }
}

function createInitialRoundProgress(round) {
  return {
    currentIndex: 0,
    items: round.questions.map(() => ({
      status: 'pending', // 'pending' | 'passed' | 'correct' | 'wrong' | 'revealed'
      userGuess: '',
      answerRevealed: false,
      questionTranslated: false,
      ruleTranslated: false,
      answerTranslated: false,
      feedbackTranslated: false,
      lastMessage: null, // { type: 'correct' | 'wrong' | 'revealed' | 'passed', guess?: string }
    })),
  };
}

const state = {
  activeRoundIndex: 0,
  activeView: 'game', // 'game' | 'phrases' | 'summary'
  activePhraseCategory: 'all',
  soundEnabled: true,
  inputDraft: '',
  phrasesExpanded: USEFUL_PHRASES.map(() => false),
  summaryExpanded: {}, // key: `${roundId}-${idx}` => boolean
  roundsProgress: ROUNDS.map((r) => createInitialRoundProgress(r)),
};

function getCurrentRound() {
  return ROUNDS[state.activeRoundIndex];
}

function getCurrentProgress() {
  return state.roundsProgress[state.activeRoundIndex];
}

function getCurrentQuestion() {
  const round = getCurrentRound();
  const progress = getCurrentProgress();
  return round.questions[progress.currentIndex];
}

function getCurrentItemState() {
  const progress = getCurrentProgress();
  return progress.items[progress.currentIndex];
}

function getRoundStats(progress) {
  let correct = 0;
  let wrong = 0;
  let revealed = 0;
  let remaining = 0;

  for (const item of progress.items) {
    if (item.status === 'correct') correct += 1;
    else if (item.status === 'wrong') wrong += 1;
    else if (item.status === 'revealed') revealed += 1;
    else remaining += 1;
  }

  return {
    correct,
    wrong,
    revealed,
    remaining,
    total: progress.items.length,
    completed: remaining === 0,
  };
}

function getStatusLabel(status) {
  switch (status) {
    case 'correct':
      return 'Верно';
    case 'wrong':
      return 'Ошибка · можно продолжать';
    case 'revealed':
      return 'Ответ открыт · можно продолжать';
    case 'passed':
      return 'Пропущено (Pasapalabra)';
    default:
      return 'Ожидает ответа';
  }
}

function findNextIndex(fromIndex, preferUnresolved = true) {
  const progress = getCurrentProgress();
  const total = progress.items.length;

  if (preferUnresolved) {
    for (let offset = 1; offset <= total; offset += 1) {
      const candidate = (fromIndex + offset) % total;
      const st = progress.items[candidate].status;
      if (st === 'pending' || st === 'passed') {
        return candidate;
      }
    }
  }

  return (fromIndex + 1) % total;
}

function selectLetter(index) {
  const progress = getCurrentProgress();
  progress.currentIndex = index;
  state.inputDraft = '';
  state.activeView = 'game';
  render();
  focusAnswerInput();
}

function moveToNextLetter(preferUnresolved = true) {
  const progress = getCurrentProgress();
  progress.currentIndex = findNextIndex(progress.currentIndex, preferUnresolved);
  state.inputDraft = '';
  render();
  focusAnswerInput();
}

function handlePass() {
  const item = getCurrentItemState();
  if (item.status === 'pending') {
    item.status = 'passed';
  }
  playTone('pass');
  moveToNextLetter(true);
}

function handleViewAnswer() {
  const item = getCurrentItemState();
  item.answerRevealed = true;
  if (item.status === 'pending' || item.status === 'passed') {
    item.status = 'revealed';
  }
  item.lastMessage = { type: 'revealed' };
  playTone('reveal');
  render();
}

function handleSubmitAnswer(rawValue) {
  const trimmed = String(rawValue || '').trim();
  const question = getCurrentQuestion();
  const item = getCurrentItemState();

  if (!trimmed) {
    // If the current question was already answered/revealed and input is empty, pressing Enter advances smoothly
    if (item.status === 'correct' || item.answerRevealed || item.status === 'wrong') {
      moveToNextLetter(true);
      return;
    }
    focusAnswerInput();
    return;
  }

  const normalizedInput = normalizeAnswer(trimmed);
  const validList = question.acceptedAnswers
    ? question.acceptedAnswers.map(normalizeAnswer)
    : [normalizeAnswer(question.answerEs)];

  item.userGuess = trimmed;

  if (validList.includes(normalizedInput)) {
    item.status = 'correct';
    item.answerRevealed = true;
    item.lastMessage = { type: 'correct', guess: trimmed };
    state.inputDraft = '';
    playTone('correct');
    render();
  } else {
    // Wrong answer: never end the game, allow retrying, viewing answer, or continuing
    if (item.status !== 'correct') {
      item.status = 'wrong';
    }
    item.lastMessage = { type: 'wrong', guess: trimmed };
    state.inputDraft = trimmed;
    playTone('wrong');
    render();
    focusAnswerInput(true);
  }
}

function resetCurrentRound() {
  const round = getCurrentRound();
  state.roundsProgress[state.activeRoundIndex] = createInitialRoundProgress(round);
  state.inputDraft = '';
  state.activeView = 'game';
  render();
  focusAnswerInput();
}

function switchRound(roundIdx) {
  state.activeRoundIndex = roundIdx;
  state.activeView = 'game';
  state.inputDraft = '';
  render();
  focusAnswerInput();
}

function focusAnswerInput(selectAll = false) {
  requestAnimationFrame(() => {
    const input = document.getElementById('answer-input');
    if (input) {
      input.focus();
      if (selectAll && input.value) {
        input.select();
      }
    }
  });
}

function positionRoscoOrbs() {
  const stage = document.getElementById('rosco-stage');
  if (!stage) return;

  const width = stage.clientWidth;
  if (!width) return;

  const isCompact = width < 380;
  const orbSize = isCompact ? 30 : width < 440 ? 34 : 38;
  const orbFont = isCompact ? '0.78rem' : width < 440 ? '0.86rem' : '0.95rem';
  const radius = Math.max(120, width / 2 - orbSize / 2 - 4);

  stage.style.setProperty('--orb-size', `${orbSize}px`);
  stage.style.setProperty('--orb-font', orbFont);

  const orbs = stage.querySelectorAll('.rosco-orb');
  const count = orbs.length;

  orbs.forEach((orb, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const tx = Math.cos(angle) * radius;
    const ty = Math.sin(angle) * radius;
    orb.style.setProperty('--tx', `${tx.toFixed(2)}px`);
    orb.style.setProperty('--ty', `${ty.toFixed(2)}px`);
    if (orb.getAttribute('data-active') === 'true') {
      orb.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(1.26)`;
    } else {
      orb.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
    }
  });
}

/* Icons (minimal inline SVGs for functional affordances only) */
const ICONS = {
  translate: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
  speaker: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  eye: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  arrowRight: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
  skip: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>`,
  soundOn: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  soundOff: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`,
  check: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  xMark: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
};

function renderHeader() {
  return `
    <header class="w-full border-b border-white/10 bg-[#071733]/80 backdrop-blur-md sticky top-0 z-40">
      <div class="max-w-[1280px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-6">
        <button
          type="button"
          data-action="go-game"
          class="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-white hover:text-sky-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 rounded"
        >
          PASAPALABRA
        </button>

        <nav class="flex items-center gap-4 sm:gap-7 overflow-x-auto py-1" aria-label="Навигация раундов">
          ${ROUNDS.map((round, idx) => {
            const isActive = state.activeView === 'game' && state.activeRoundIndex === idx;
            return `
              <button
                type="button"
                data-action="switch-round"
                data-round="${idx}"
                class="text-sm font-semibold whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'text-white border-sky-400'
                    : 'text-slate-300 border-transparent hover:text-white hover:border-white/30'
                }"
              >
                ${escapeHtml(round.ruTitle)}
              </button>
            `;
          }).join('')}
          <button
            type="button"
            data-action="open-phrases"
            class="text-sm font-semibold whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors cursor-pointer ${
              state.activeView === 'phrases'
                ? 'text-white border-sky-400'
                : 'text-slate-300 border-transparent hover:text-white hover:border-white/30'
            }"
          >
            Фразы
          </button>
          <button
            type="button"
            data-action="open-summary"
            class="text-sm font-semibold whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors cursor-pointer ${
              state.activeView === 'summary'
                ? 'text-white border-sky-400'
                : 'text-slate-300 border-transparent hover:text-white hover:border-white/30'
            }"
          >
            Итоги
          </button>
        </nav>

        <div class="shrink-0">
          <button
            type="button"
            data-action="reset-round"
            class="px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 active:bg-sky-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
          >
            Сбросить раунд
          </button>
        </div>
      </div>
    </header>
  `;
}

function renderFeedbackBlock(question, item) {
  const sections = [];

  if (item.lastMessage?.type === 'correct') {
    sections.push(`
      <div class="reveal-slide rounded-xl bg-emerald-950/75 border border-emerald-400/35 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            data-action="toggle-feedback-tr"
            class="inline-flex items-center gap-2 text-left text-emerald-300 hover:text-emerald-200 font-semibold text-sm cursor-pointer group"
            title="Нажмите для перевода на армянский"
          >
            ${ICONS.check}
            <span class="underline decoration-emerald-400/50 underline-offset-4 group-hover:decoration-emerald-200">¡Respuesta correcta!</span>
            <span class="text-xs font-normal text-emerald-300/75">${item.feedbackTranslated ? '— скрыть' : '· перевод'}</span>
          </button>
          <button
            type="button"
            data-action="next-letter"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Следующая буква</span>
            ${ICONS.arrowRight}
          </button>
        </div>
        ${
          item.feedbackTranslated
            ? `<p class="font-armenian text-sm text-emerald-100/95 pl-6">Ճիշտ պատասխան։</p>`
            : ''
        }
        ${renderAnswerRevealCard(question, item, 'emerald')}
      </div>
    `);
  } else if (item.lastMessage?.type === 'wrong') {
    sections.push(`
      <div class="reveal-slide rounded-xl bg-red-950/65 border border-red-400/35 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-start gap-2.5 text-sm text-red-100">
            <span class="text-red-400 mt-0.5">${ICONS.xMark}</span>
            <div>
              <p class="font-semibold text-red-200">
                Неверный ответ: «${escapeHtml(item.lastMessage.guess || item.userGuess)}»
              </p>
              <p class="text-xs text-red-200/80 mt-0.5">
                Игра продолжается — попробуйте ещё раз, посмотрите ответ или перейдите к следующей букве.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-action="next-letter"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Продолжить</span>
            ${ICONS.arrowRight}
          </button>
        </div>
        ${item.answerRevealed ? renderAnswerRevealCard(question, item, 'amber') : ''}
      </div>
    `);
  } else if (item.answerRevealed) {
    sections.push(`
      <div class="reveal-slide rounded-xl bg-amber-950/55 border border-amber-400/35 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-medium text-amber-200/90">
            Ответ открыт — вы можете спокойно продолжать игру.
          </p>
          <button
            type="button"
            data-action="next-letter"
            class="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Продолжить игру</span>
            ${ICONS.arrowRight}
          </button>
        </div>
        ${renderAnswerRevealCard(question, item, 'amber')}
      </div>
    `);
  }

  return sections.join('');
}

function renderAnswerRevealCard(question, item, tone) {
  const borderClass = tone === 'emerald' ? 'border-emerald-400/25 bg-emerald-900/35' : 'border-amber-400/25 bg-amber-900/30';
  const accentText = tone === 'emerald' ? 'text-emerald-200' : 'text-amber-200';

  return `
    <div class="rounded-lg border ${borderClass} p-3.5 flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <button
          type="button"
          data-action="toggle-answer-tr"
          class="flex-1 text-left cursor-pointer group focus-visible:outline-2 focus-visible:outline-sky-400 rounded"
        >
          <span class="block text-xs text-slate-300">Respuesta · нажмите на слово для перевода на армянский</span>
          <span class="mt-0.5 inline-flex items-baseline gap-2.5">
            <span class="font-display text-xl font-bold text-white underline decoration-white/35 underline-offset-4 group-hover:decoration-white">
              ${escapeHtml(question.answerEs)}
            </span>
            <span class="text-xs font-medium ${accentText}">
              ${item.answerTranslated ? 'Скрыть перевод' : '→ Հայերեն'}
            </span>
          </span>
        </button>
        <button
          type="button"
          data-action="speak"
          data-text="${escapeHtml(question.answerEs)}"
          class="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 transition-colors cursor-pointer shrink-0"
          aria-label="Озвучить ответ на испанском"
          title="Произнести по-испански"
        >
          ${ICONS.speaker}
        </button>
      </div>
      ${
        item.answerTranslated
          ? `
            <div class="reveal-slide pt-2 border-t border-white/10">
              <p class="font-armenian text-lg font-semibold text-white">
                ${escapeHtml(question.answerHy)}
              </p>
            </div>
          `
          : ''
      }
    </div>
  `;
}

function renderGameView() {
  const round = getCurrentRound();
  const progress = getCurrentProgress();
  const question = getCurrentQuestion();
  const item = getCurrentItemState();
  const stats = getRoundStats(progress);

  const ruleEs = RULE_LABELS[question.mode].es(question.letter);
  const ruleHy = RULE_LABELS[question.mode].hy(question.letter);
  const nextRoundIdx = (state.activeRoundIndex + 1) % ROUNDS.length;

  return `
    <main class="max-w-[1280px] mx-auto px-4 sm:px-8 py-6 lg:py-10 space-y-10">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        <!-- Left Column: Interactive 27-letter Pasapalabra Rosco -->
        <section class="lg:col-span-6 flex flex-col items-center" aria-label="Алфавитное кольцо Rosco">
          <div id="rosco-stage" class="rosco-stage">
            ${round.questions
              .map((q, idx) => {
                const st = progress.items[idx].status;
                const isActive = idx === progress.currentIndex;
                return `
                  <button
                    type="button"
                    class="rosco-orb"
                    data-action="select-letter"
                    data-index="${idx}"
                    data-status="${st}"
                    data-active="${isActive ? 'true' : 'false'}"
                    aria-label="Буква ${escapeHtml(q.letter)}, ${getStatusLabel(st)}"
                    title="${escapeHtml(q.letter)} — ${getStatusLabel(st)}"
                  >
                    ${escapeHtml(q.letter)}
                  </button>
                `;
              })
              .join('')}

            <!-- Center Rosco Emblem -->
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-12 text-center">
              <span class="font-display text-6xl sm:text-7xl font-extrabold text-white leading-none drop-shadow">
                ${escapeHtml(question.letter)}
              </span>
              <button
                type="button"
                data-action="toggle-rule-tr"
                class="pointer-events-auto mt-2.5 text-sm sm:text-base font-semibold text-sky-200 hover:text-white underline decoration-sky-300/50 underline-offset-4 transition-colors cursor-pointer"
                title="Нажмите для перевода правила на армянский"
              >
                ${escapeHtml(ruleEs)}
              </button>
              ${
                item.ruleTranslated
                  ? `
                    <p class="reveal-slide font-armenian text-xs sm:text-sm text-white/95 mt-1 max-w-[200px]">
                      ${escapeHtml(ruleHy)}
                    </p>
                  `
                  : `
                    <span class="mt-1 text-[11px] text-slate-300/80">
                      Клик — перевод
                    </span>
                  `
              }
              <p class="mt-3 text-xs text-slate-300 tabular-nums">
                ${progress.currentIndex + 1} / ${stats.total} · ${escapeHtml(round.title)}
              </p>
            </div>
          </div>

          <!-- Studio Broadcast Scoreboard Counters -->
          <div class="mt-6 flex flex-wrap items-center justify-center gap-5 sm:gap-7">
            <div class="flex flex-col items-center gap-1.5">
              <div class="studio-counter-orange w-14 h-14 rounded-full flex items-center justify-center font-display text-xl font-extrabold text-white tabular-nums">
                ${stats.remaining}
              </div>
              <span class="text-xs font-medium text-slate-300">Осталось</span>
            </div>

            <div class="flex flex-col items-center gap-1.5">
              <div class="studio-counter-green w-14 h-14 rounded-full flex items-center justify-center font-display text-xl font-extrabold text-white tabular-nums">
                ${stats.correct}
              </div>
              <span class="text-xs font-medium text-slate-300">Верно</span>
            </div>

            <div class="flex flex-col items-center gap-1.5">
              <div class="studio-counter-red w-14 h-14 rounded-full flex items-center justify-center font-display text-xl font-extrabold text-white tabular-nums">
                ${stats.wrong}
              </div>
              <span class="text-xs font-medium text-slate-300">Ошибки</span>
            </div>

            <div class="flex flex-col items-center gap-1.5">
              <div class="studio-counter-amber w-14 h-14 rounded-full flex items-center justify-center font-display text-xl font-extrabold text-white tabular-nums">
                ${stats.revealed}
              </div>
              <span class="text-xs font-medium text-slate-300">Ответы</span>
            </div>
          </div>
        </section>

        <!-- Right Column: Question & Interactive Play Console -->
        <section class="lg:col-span-6">
          <div class="rounded-2xl bg-[#0e2348]/95 border border-white/12 p-5 sm:p-8 shadow-2xl space-y-6">
            <!-- Top Clean Metadata Row (No Pills) -->
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div class="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-300">
                <span class="font-semibold text-white">${escapeHtml(round.ruTitle)}</span>
                <span aria-hidden="true">·</span>
                <span>Буква <strong class="text-sky-300 font-display">${escapeHtml(question.letter)}</strong></span>
                <span aria-hidden="true">·</span>
                <span>${getStatusLabel(item.status)}</span>
              </div>

              <button
                type="button"
                data-action="toggle-sound"
                class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                aria-label="Переключить звуковые эффекты"
              >
                ${state.soundEnabled ? ICONS.soundOn : ICONS.soundOff}
                <span>${state.soundEnabled ? 'Звук вкл' : 'Звук выкл'}</span>
              </button>
            </div>

            <!-- Clickable Spanish Rule + Question Card -->
            <div class="space-y-4">
              <div class="flex items-start justify-between gap-3">
                <button
                  type="button"
                  data-action="toggle-rule-tr"
                  class="text-left group cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400 rounded"
                >
                  <span class="text-sm font-semibold text-sky-300 group-hover:text-sky-200 underline decoration-sky-400/40 underline-offset-4">
                    ${escapeHtml(ruleEs)}
                  </span>
                  ${
                    item.ruleTranslated
                      ? `<span class="font-armenian block text-sm text-slate-200 mt-1">${escapeHtml(ruleHy)}</span>`
                      : `<span class="ml-2 text-xs text-slate-400">· нажмите для перевода</span>`
                  }
                </button>

                <button
                  type="button"
                  data-action="speak"
                  data-text="${escapeHtml(question.questionEs)}"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Прослушать вопрос на испанском"
                >
                  ${ICONS.speaker}
                  <span>Слушать</span>
                </button>
              </div>

              <!-- Clickable Spanish Question Surface -->
              <div
                role="button"
                tabindex="0"
                data-action="toggle-question-tr"
                aria-expanded="${item.questionTranslated ? 'true' : 'false'}"
                class="rounded-xl bg-[#132d59] hover:bg-[#163466] border border-white/12 hover:border-sky-300/40 p-5 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                <p class="text-xl sm:text-2xl font-semibold text-white leading-snug tracking-[0.005em]">
                  ${escapeHtml(question.questionEs)}
                </p>

                <div class="mt-3 flex items-center gap-2 text-xs font-medium text-sky-300">
                  ${ICONS.translate}
                  <span>
                    ${
                      item.questionTranslated
                        ? 'Перевод на армянский открыт (нажмите, чтобы скрыть)'
                        : 'Нажмите на испанский вопрос, чтобы открыть перевод на армянский'
                    }
                  </span>
                </div>

                ${
                  item.questionTranslated
                    ? `
                      <div class="reveal-slide mt-4 pt-4 border-t border-white/12">
                        <p class="font-armenian text-lg sm:text-xl text-sky-100 leading-relaxed">
                          ${escapeHtml(question.questionHy)}
                        </p>
                      </div>
                    `
                    : ''
                }
              </div>
            </div>

            <!-- Answer Input Form -->
            <form id="answer-form" class="space-y-3" autocomplete="off">
              <label for="answer-input" class="block text-xs font-medium text-slate-300">
                Ваш ответ (одно слово на испанском, можно без ударений)
              </label>
              <div class="flex flex-col sm:flex-row gap-2.5">
                <div class="relative flex-1 flex items-center">
                  <input
                    id="answer-input"
                    type="text"
                    value="${escapeHtml(state.inputDraft)}"
                    placeholder="Например: ${question.mode === 'starts' ? `${escapeHtml(question.letter)}...` : `содержит ${escapeHtml(question.letter)}...`}"
                    spellcheck="false"
                    autocomplete="off"
                    class="w-full h-12 pl-4 pr-12 rounded-xl bg-[#081733] border border-white/20 focus:border-sky-400 focus:outline-none text-base text-white placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    data-action="insert-enie"
                    class="absolute right-2 w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-display font-bold text-sky-200 transition-colors cursor-pointer"
                    title="Вставить испанскую букву ñ"
                  >
                    ñ
                  </button>
                </div>

                <button
                  type="submit"
                  class="h-12 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-white"
                >
                  Ответить
                </button>
              </div>
            </form>

            <!-- Dedicated Secondary Actions (Pasapalabra, View Answer, Next Letter) -->
            <div class="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-action="pass-letter"
                class="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-blue-600/80 hover:bg-blue-500 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ${ICONS.skip}
                <span>¡Pasapalabra!</span>
              </button>

              <button
                type="button"
                data-action="view-answer"
                class="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-amber-600/90 hover:bg-amber-500 text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                ${ICONS.eye}
                <span>Посмотреть ответ</span>
              </button>

              <button
                type="button"
                data-action="next-letter"
                class="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-white/10 hover:bg-white/18 text-sm font-semibold text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer ml-auto"
              >
                <span>Следующая буква</span>
                ${ICONS.arrowRight}
              </button>
            </div>

            <!-- Feedback & Answer Reveal Container -->
            ${renderFeedbackBlock(question, item)}

            <!-- Round Complete Banner (Non-blocking, still lets you play/review) -->
            ${
              stats.completed
                ? `
                  <div class="reveal-slide rounded-xl bg-sky-950/80 border border-sky-400/40 p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p class="font-display text-lg font-bold text-white">
                        ${escapeHtml(round.ruTitle)} завершена · ${stats.correct} из ${stats.total} верно
                      </p>
                      <p class="text-xs text-sky-200/85 mt-0.5">
                        Вы можете открыть итоги, перейти к следующему раунду или кликнуть по любой букве на кольце.
                      </p>
                    </div>
                    <div class="flex items-center gap-2.5">
                      <button
                        type="button"
                        data-action="open-summary"
                        class="px-4 py-2 rounded-lg bg-white/12 hover:bg-white/20 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Итоги раунда
                      </button>
                      <button
                        type="button"
                        data-action="switch-round"
                        data-round="${nextRoundIdx}"
                        class="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ${escapeHtml(ROUNDS[nextRoundIdx].ruTitle)} →
                      </button>
                    </div>
                  </div>
                `
                : ''
            }
          </div>

          <p class="mt-3 text-xs text-slate-300/80 text-center lg:text-left">
            Темы раунда: ${escapeHtml(round.topics)}
          </p>
        </section>
      </div>

      <!-- Inline Useful Game Phrases (Player + Host Questions & Answers) -->
      <section class="pt-6 border-t border-white/10 space-y-5" aria-label="Полезные фразы для игры">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 class="font-display text-xl font-bold text-white">
              Frases útiles durante el juego
            </h2>
            <p class="text-xs sm:text-sm text-slate-300 mt-0.5">
              Фразы игрока, вопросы и ответы ведущего · нажмите на испанский текст для перевода на армянский
            </p>
          </div>
          <button
            type="button"
            data-action="toggle-all-phrases"
            class="text-xs font-semibold text-sky-300 hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
          >
            ${areVisiblePhrasesExpanded() ? 'Скрыть все переводы' : 'Открыть все переводы'}
          </button>
        </div>

        ${renderPhraseCategoryTabs()}
        ${renderPhrasesGroups(true)}
      </section>
    </main>
  `;
}

function getFilteredPhraseEntries() {
  return USEFUL_PHRASES.map((phrase, idx) => ({ phrase, idx })).filter(
    ({ phrase }) => state.activePhraseCategory === 'all' || phrase.category === state.activePhraseCategory,
  );
}

function areVisiblePhrasesExpanded() {
  const entries = getFilteredPhraseEntries();
  return entries.length > 0 && entries.every(({ idx }) => state.phrasesExpanded[idx]);
}

function renderPhraseCategoryTabs() {
  return `
    <div class="flex flex-wrap items-center gap-1.5 p-1 bg-[#081733]/90 border border-white/10 rounded-xl w-fit" role="tablist" aria-label="Категории фраз">
      ${PHRASE_CATEGORIES.map((cat) => {
        const isActive = state.activePhraseCategory === cat.id;
        return `
          <button
            type="button"
            role="tab"
            aria-selected="${isActive ? 'true' : 'false'}"
            data-action="filter-phrases"
            data-category="${cat.id}"
            class="px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isActive
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/8'
            }"
          >
            ${escapeHtml(cat.label)}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderPhraseCard(phrase, idx) {
  const isOpen = state.phrasesExpanded[idx];
  return `
    <div class="rounded-xl bg-[#0e2348]/90 border border-white/10 hover:border-sky-300/40 transition-colors p-4 flex flex-col justify-between gap-2.5">
      <div class="flex items-start justify-between gap-2">
        <button
          type="button"
          data-action="toggle-phrase"
          data-index="${idx}"
          aria-expanded="${isOpen ? 'true' : 'false'}"
          class="text-left flex-1 cursor-pointer group focus-visible:outline-2 focus-visible:outline-sky-400 rounded"
        >
          <span class="font-display text-base font-bold text-white group-hover:text-sky-200 leading-snug block">
            ${escapeHtml(phrase.es)}
          </span>
          <span class="block text-[11px] text-sky-300/80 mt-1">
            ${isOpen ? 'Скрыть перевод' : 'Нажмите для перевода'}
          </span>
        </button>
        <button
          type="button"
          data-action="speak"
          data-text="${escapeHtml(phrase.es)}"
          class="p-1.5 rounded-lg bg-white/8 hover:bg-white/18 text-slate-200 transition-colors cursor-pointer shrink-0"
          aria-label="Произнести фразу ${escapeHtml(phrase.es)}"
        >
          ${ICONS.speaker}
        </button>
      </div>
      ${
        isOpen
          ? `
            <p class="reveal-slide font-armenian text-sm text-sky-100 pt-2 border-t border-white/10">
              ${escapeHtml(phrase.hy)}
            </p>
          `
          : ''
      }
    </div>
  `;
}

function renderPhrasesGroups(compactGrid) {
  const groups = [
    {
      id: 'player',
      title: 'Фразы игрока',
      subtitle: 'Что говорит участник во время игры',
    },
    {
      id: 'host-question',
      title: 'Вопросы ведущего',
      subtitle: 'Вопросы, которые вы задаёте игроку в ходе игры',
    },
    {
      id: 'host-answer',
      title: 'Ответы и реакции ведущего',
      subtitle: 'Подсказки, похвала и комментарии во время игры',
    },
  ].filter((g) => state.activePhraseCategory === 'all' || g.id === state.activePhraseCategory);

  const gridClass = compactGrid
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5'
    : 'grid grid-cols-1 md:grid-cols-2 gap-4';

  return `
    <div class="space-y-7">
      ${groups
        .map((group) => {
          const entries = USEFUL_PHRASES.map((phrase, idx) => ({ phrase, idx })).filter(
            ({ phrase }) => phrase.category === group.id,
          );
          return `
            <div class="space-y-3">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 class="font-display text-base sm:text-lg font-bold text-white">
                  ${escapeHtml(group.title)}
                </h3>
                <span class="text-xs text-slate-300/80">${escapeHtml(group.subtitle)}</span>
              </div>
              <div class="${gridClass}">
                ${entries.map(({ phrase, idx }) => renderPhraseCard(phrase, idx)).join('')}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderPhrasesView() {
  return `
    <main class="max-w-[1040px] mx-auto px-4 sm:px-8 py-8 space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-white">
            Frases útiles durante el juego
          </h1>
          <p class="text-sm text-slate-300 mt-1">
            Фразы игрока, вопросы и ответы ведущего · нажмите на испанскую фразу, чтобы открыть перевод на армянский.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            type="button"
            data-action="toggle-all-phrases"
            class="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/18 text-xs sm:text-sm font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            ${areVisiblePhrasesExpanded() ? 'Скрыть все переводы' : 'Открыть все переводы'}
          </button>
          <button
            type="button"
            data-action="go-game"
            class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-xs sm:text-sm font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Вернуться к игре
          </button>
        </div>
      </div>

      ${renderPhraseCategoryTabs()}
      ${renderPhrasesGroups(false)}
    </main>
  `;
}

function renderSummaryView() {
  const round = getCurrentRound();
  const progress = getCurrentProgress();
  const stats = getRoundStats(progress);

  return `
    <main class="max-w-[1160px] mx-auto px-4 sm:px-8 py-8 space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <h1 class="font-display text-2xl sm:text-3xl font-extrabold text-white">
            Итоги · ${escapeHtml(round.ruTitle)}
          </h1>
          <p class="text-sm text-slate-300 mt-1 tabular-nums">
            Верно: ${stats.correct} · Ошибки: ${stats.wrong} · Подсмотрено: ${stats.revealed} · Осталось: ${stats.remaining}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2.5">
          ${ROUNDS.map((r, idx) => `
            <button
              type="button"
              data-action="summary-round"
              data-round="${idx}"
              class="px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                idx === state.activeRoundIndex
                  ? 'bg-sky-600 text-white'
                  : 'bg-white/10 hover:bg-white/18 text-slate-200'
              }"
            >
              ${escapeHtml(r.ruTitle)}
            </button>
          `).join('')}
          <button
            type="button"
            data-action="go-game"
            class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs sm:text-sm font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            Продолжить игру
          </button>
        </div>
      </div>

      <p class="text-xs text-slate-300">
        Нажмите на любую строку на испанском, чтобы открыть перевод на армянский, или нажмите на букву, чтобы вернуться к ней в игре.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        ${round.questions
          .map((q, idx) => {
            const item = progress.items[idx];
            const key = `${round.id}-${idx}`;
            const isOpen = Boolean(state.summaryExpanded[key]);
            const statusText = getStatusLabel(item.status);
            const showAnswer = item.status !== 'pending' && item.status !== 'passed';

            return `
              <div class="rounded-xl bg-[#0e2348]/90 border border-white/10 p-4 flex items-start gap-3.5">
                <button
                  type="button"
                  data-action="select-letter"
                  data-index="${idx}"
                  class="w-10 h-10 rounded-full font-display font-bold text-sm text-white shrink-0 border-2 flex items-center justify-center cursor-pointer transition-transform hover:scale-105 ${
                    item.status === 'correct'
                      ? 'bg-emerald-600 border-emerald-200'
                      : item.status === 'wrong'
                        ? 'bg-red-600 border-red-200'
                        : item.status === 'revealed'
                          ? 'bg-amber-600 border-amber-200'
                          : 'bg-blue-700 border-blue-300'
                  }"
                  title="Перейти к букве ${escapeHtml(q.letter)}"
                >
                  ${escapeHtml(q.letter)}
                </button>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2 text-xs text-slate-300">
                    <span>${escapeHtml(RULE_LABELS[q.mode].es(q.letter))}</span>
                    <span>${statusText}</span>
                  </div>

                  <button
                    type="button"
                    data-action="toggle-summary-row"
                    data-key="${key}"
                    class="mt-1.5 text-left w-full cursor-pointer group focus-visible:outline-2 focus-visible:outline-sky-400 rounded"
                  >
                    <p class="text-sm font-medium text-white group-hover:text-sky-200 leading-snug">
                      ${escapeHtml(q.questionEs)}
                    </p>
                    ${
                      showAnswer
                        ? `<p class="mt-1 text-sm font-display font-bold text-sky-300">Respuesta: ${escapeHtml(q.answerEs)}</p>`
                        : `<p class="mt-1 text-xs text-slate-400">Ещё не открыто (нажмите на букву, чтобы ответить)</p>`
                    }
                  </button>

                  ${
                    isOpen
                      ? `
                        <div class="reveal-slide mt-2.5 pt-2.5 border-t border-white/10 space-y-1">
                          <p class="font-armenian text-sm text-sky-100">${escapeHtml(q.questionHy)}</p>
                          ${
                            showAnswer
                              ? `<p class="font-armenian text-sm font-semibold text-emerald-200">${escapeHtml(q.answerHy)}</p>`
                              : ''
                          }
                        </div>
                      `
                      : ''
                  }
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </main>
  `;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;

  let bodyHtml = '';
  if (state.activeView === 'phrases') {
    bodyHtml = renderPhrasesView();
  } else if (state.activeView === 'summary') {
    bodyHtml = renderSummaryView();
  } else {
    bodyHtml = renderGameView();
  }

  root.innerHTML = `
    <div class="min-h-screen flex flex-col">
      ${renderHeader()}
      <div class="flex-1">
        ${bodyHtml}
      </div>
    </div>
  `;

  if (state.activeView === 'game') {
    positionRoscoOrbs();
  }
}

/* Global event delegation for crisp zero-leak interaction */
function bindEvents() {
  const root = document.getElementById('app');
  if (!root) return;

  root.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.getAttribute('data-action');

    switch (action) {
      case 'go-game':
        state.activeView = 'game';
        render();
        focusAnswerInput();
        break;

      case 'switch-round': {
        const roundIdx = Number(target.getAttribute('data-round'));
        if (!Number.isNaN(roundIdx)) switchRound(roundIdx);
        break;
      }

      case 'summary-round': {
        const roundIdx = Number(target.getAttribute('data-round'));
        if (!Number.isNaN(roundIdx)) {
          state.activeRoundIndex = roundIdx;
          state.activeView = 'summary';
          render();
        }
        break;
      }

      case 'open-phrases':
        state.activeView = 'phrases';
        render();
        break;

      case 'open-summary':
        state.activeView = 'summary';
        render();
        break;

      case 'reset-round':
        resetCurrentRound();
        break;

      case 'select-letter': {
        const idx = Number(target.getAttribute('data-index'));
        if (!Number.isNaN(idx)) selectLetter(idx);
        break;
      }

      case 'toggle-question-tr': {
        const item = getCurrentItemState();
        item.questionTranslated = !item.questionTranslated;
        render();
        break;
      }

      case 'toggle-rule-tr': {
        const item = getCurrentItemState();
        item.ruleTranslated = !item.ruleTranslated;
        render();
        break;
      }

      case 'toggle-answer-tr': {
        const item = getCurrentItemState();
        item.answerTranslated = !item.answerTranslated;
        render();
        break;
      }

      case 'toggle-feedback-tr': {
        const item = getCurrentItemState();
        item.feedbackTranslated = !item.feedbackTranslated;
        render();
        break;
      }

      case 'pass-letter':
        handlePass();
        break;

      case 'view-answer':
        handleViewAnswer();
        break;

      case 'next-letter':
        moveToNextLetter(true);
        break;

      case 'insert-enie': {
        const input = document.getElementById('answer-input');
        if (input) {
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          const nextValue = input.value.slice(0, start) + 'ñ' + input.value.slice(end);
          input.value = nextValue;
          state.inputDraft = nextValue;
          input.focus();
          input.setSelectionRange(start + 1, start + 1);
        }
        break;
      }

      case 'toggle-sound':
        state.soundEnabled = !state.soundEnabled;
        render();
        break;

      case 'speak': {
        event.stopPropagation();
        const text = target.getAttribute('data-text');
        if (text) speakSpanish(text);
        break;
      }

      case 'toggle-phrase': {
        const idx = Number(target.getAttribute('data-index'));
        if (!Number.isNaN(idx)) {
          state.phrasesExpanded[idx] = !state.phrasesExpanded[idx];
          render();
        }
        break;
      }

      case 'filter-phrases': {
        const cat = target.getAttribute('data-category');
        if (cat) {
          state.activePhraseCategory = cat;
          render();
        }
        break;
      }

      case 'toggle-all-phrases': {
        const entries = getFilteredPhraseEntries();
        const allOpen = entries.every(({ idx }) => state.phrasesExpanded[idx]);
        entries.forEach(({ idx }) => {
          state.phrasesExpanded[idx] = !allOpen;
        });
        render();
        break;
      }

      case 'toggle-summary-row': {
        const key = target.getAttribute('data-key');
        if (key) {
          state.summaryExpanded[key] = !state.summaryExpanded[key];
          render();
        }
        break;
      }

      default:
        break;
    }
  });

  root.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-action="toggle-question-tr"]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      const item = getCurrentItemState();
      item.questionTranslated = !item.questionTranslated;
      render();
    }
  });

  root.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'answer-input') {
      state.inputDraft = event.target.value;
    }
  });

  root.addEventListener('submit', (event) => {
    if (event.target && event.target.id === 'answer-form') {
      event.preventDefault();
      const input = document.getElementById('answer-input');
      handleSubmitAnswer(input ? input.value : state.inputDraft);
    }
  });

  window.addEventListener('resize', () => {
    if (state.activeView === 'game') {
      positionRoscoOrbs();
    }
  });
}

/* Boot */
bindEvents();
render();
focusAnswerInput();
